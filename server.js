const express = require('express')
const http = require('http')
const https = require('https')
const fs = require('fs')
const cors = require('cors')
const bodyParser = require('body-parser')
const crypto = require('crypto')
const { Server } = require('socket.io')
const { getAuthenticatedUser } = require('./middleware/auth')
require('dotenv').config()

const PORT = process.env.PORT || 3000
const USE_HTTPS = process.env.USE_HTTPS === 'true'
console.log('current:' + USE_HTTPS)

// Only these browser origins may read API responses or connect to Socket.IO.
// CORS_ALLOWED_ORIGINS can add environment-specific origins as a comma-separated
// list without requiring another code change (for example, a new dev device).
const allowedOrigins = new Set([
    'https://secure.iklogy.com',
    'https://demo.iklogy.com',
  'https://iklogy.com',
  'https://localhost',
  'https://localhost:5173',
  'https://192.168.1.37:5173',
  'https://192.168.1.37:3000',
  // Capacitor's default embedded webview origins on iOS and Android.
  'capacitor://localhost',
  'http://localhost',
  ...(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
])

const corsOptions = {
  origin(origin, callback) {
    // Native clients, health checks and server-to-server requests often omit
    // Origin. Authentication/authorization still applies to all API routes.
    if (!origin) return callback(null, true)
    return callback(null, allowedOrigins.has(origin))
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}

const app = express()

// Enable only when Node is behind one trusted reverse proxy (such as Nginx).
// Leave unset when Node is directly exposed on a LAN or the public internet.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)

// Coarse flood protection, separate from the stricter PostgreSQL login and
// Twilio verification limits. Use per-session + generous per-IP budgets so
// several employees behind one office connection can work simultaneously.
// This in-process limiter resets on restart; it is a resource safeguard, not
// a substitute for shared/store-backed sensitive-operation limits.
const API_WINDOW_MS = 60 * 1000
const API_SESSION_LIMIT = 600
const API_IP_LIMIT = 5000
const API_ANONYMOUS_IP_LIMIT = 120
const MAX_RATE_KEYS = 15000
const apiCounters = new Map()

function consumeApiBudget(key, limit, now) {
  let record = apiCounters.get(key)
  if (!record || record.expiresAt <= now) {
    // Bound memory even when clients send many distinct session identifiers.
    if (!record && apiCounters.size >= MAX_RATE_KEYS) {
      for (const [storedKey, value] of apiCounters) {
        if (value.expiresAt <= now) apiCounters.delete(storedKey)
      }
    }
    if (!record && apiCounters.size >= MAX_RATE_KEYS) return { allowed: false, retryAfter: 60 }
    record = { count: 0, expiresAt: now + API_WINDOW_MS }
    apiCounters.set(key, record)
  }
  record.count += 1
  return {
    allowed: record.count <= limit,
    retryAfter: Math.max(1, Math.ceil((record.expiresAt - now) / 1000))
  }
}

const apiCleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, value] of apiCounters) {
    if (value.expiresAt <= now) apiCounters.delete(key)
  }
}, API_WINDOW_MS)
apiCleanup.unref?.()

// Do not reveal the Express implementation in response headers.
app.disable('x-powered-by')

// These headers protect API responses without restricting origins used by
// the web app or the Android/iOS Capacitor clients.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store')
  }
  next()
})

app.use(cors(corsOptions))
app.use(async (req, res, next) => {
  if (!(/^\/api\//i.test(req.path)) || req.method === 'OPTIONS') return next()

  const now = Date.now()
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const rawToken = req.headers['x-token'] ||
    (typeof req.headers.authorization === 'string'
      ? req.headers.authorization.replace(/^Bearer\s+/i, '') : '')
  const token = typeof rawToken === 'string' && rawToken.length <= 4096
    ? rawToken.trim() : ''

  const ipResult = consumeApiBudget(`ip:${ip}`, API_IP_LIMIT, now)
  if (!ipResult.allowed) {
    res.set('Retry-After', String(ipResult.retryAfter))
    return res.status(429).json({
      success: false, code: 42900,
      message: 'Too many requests. Please wait a moment and try again.'
    })
  }

  // A caller-controlled x-token value must not grant an authenticated rate
  // budget. Verify the token against the live session before classifying it.
  // Reuse the authenticated user in downstream middleware to avoid a second
  // database lookup on protected routes.
  let authenticated = false
  if (token) {
    try {
      const result = await getAuthenticatedUser(req)
      if (result.success) {
        req.authUser = result.user
        authenticated = true
      }
    } catch (error) {
      // Fail closed to the anonymous budget if session verification fails.
      console.error('API rate-limit session verification failed:', error)
    }
  }

  const scopedResult = authenticated
    ? consumeApiBudget(`token:${crypto.createHash('sha256').update(token).digest('hex')}`, API_SESSION_LIMIT, now)
    : consumeApiBudget(`anonymous:${ip}`, API_ANONYMOUS_IP_LIMIT, now)

  if (!scopedResult.allowed) {
    res.set('Retry-After', String(scopedResult.retryAfter))
    return res.status(429).json({
      success: false,
      code: 42900,
      message: 'Too many requests. Please wait a moment and try again.'
    })
  }
  next()
})
app.use(bodyParser.json({limit: '25mb',}))
app.use(bodyParser.urlencoded({extended: true,limit: '25mb',}))

// ============================================
// HTTP Server
// ============================================
let httpServer

if (USE_HTTPS) {
    const options = {
        key: fs.readFileSync('./certs/localhost-key.pem'),
        cert: fs.readFileSync('./certs/localhost.pem'),
    }
    httpServer = https.createServer(options, app)
} else {
    httpServer = http.createServer(app)
}

// ============================================
// Socket.IO
// ============================================
const io = new Server(httpServer, {
  cors: {
    origin: corsOptions.origin,
    methods: corsOptions.methods,
  },
  // Browser WebSocket upgrades do not enforce CORS themselves.
  allowRequest(req, callback) {
    const origin = req.headers.origin
    callback(null, !origin || allowedOrigins.has(origin))
  },
})

const { setSocketIO } = require('./utils/realtime')
setSocketIO(io)

// ============================================
// Socket.IO authentication and room authorization
// ============================================
const { pool } = require('./db')

function validId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function loadSocketUser(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 4096) return null
  const result = await getAuthenticatedUser({ headers: { 'x-token': token.trim() } })
  return result.success ? result.user : null
}

async function authorizedSocketContext(user, locationId) {
  const id = validId(locationId)
  if (!id) return null

  const location = await pool.query(`
    SELECT l."ID", l."CompanyId"
    FROM "Locations" l
    JOIN "Companies" c ON c."ID" = l."CompanyId"
    WHERE l."ID" = $1
      AND l."IsActive" = true
      AND COALESCE(l."IsSuspended", false) = false
      AND c."IsActive" = true
      AND COALESCE(c."IsSuspended", false) = false
    LIMIT 1
  `, [id])
  if (!location.rowCount) return null

  const companyId = Number(location.rows[0].CompanyId)
  const role = String(user.roleName || '').trim().toLowerCase()
  if (role === 'system admin') return { locationId: id, companyId }
  if (Number(user.companyId) !== companyId) return null
  if (role === 'owner' || Number(user.locationId) === id) {
    return { locationId: id, companyId }
  }
  if (role !== 'admin') return null

  const access = await pool.query(`
    SELECT 1 FROM "UserLocationAccess"
    WHERE "UserId" = $1 AND "LocationId" = $2 LIMIT 1
  `, [user.id, id])
  return access.rowCount ? { locationId: id, companyId } : null
}

function leaveContextRooms(socket) {
  for (const room of socket.rooms) {
    if (room.startsWith('location-') || room.startsWith('company-')) {
      socket.leave(room)
    }
  }
}

// The client must send its current token as `auth: { token }` when connecting.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token
    const user = await loadSocketUser(token)
    if (!user) return next(new Error('Unauthorized socket connection'))
    socket.data.loginToken = token
    socket.data.user = user
    next()
  } catch (error) {
    console.error('Socket authentication failed:', error)
    next(new Error('Unable to authenticate socket connection'))
  }
})

io.on('connection', (socket) => {
  // Re-check credentials on every room change: revoked or expired tokens
  // cannot continue subscribing to new rooms on an existing connection.
  let latestJoinRequest = 0
  async function joinContext(locationId) {
    const requestNumber = ++latestJoinRequest
    try {
      const user = await loadSocketUser(socket.data.loginToken)
    if (!user) {
      leaveContextRooms(socket)
      socket.disconnect(true)
      return
    }

      const context = await authorizedSocketContext(user, locationId)
      if (requestNumber !== latestJoinRequest || !socket.connected) return
      leaveContextRooms(socket)
      if (!context) {
        socket.emit('room-access-denied', { message: 'Location access denied.' })
        return
      }
      socket.join(`location-${context.locationId}`)
      socket.join(`company-${context.companyId}`)
    } catch (error) {
      console.error('Socket room authorization failed:', error)
      leaveContextRooms(socket)
      socket.emit('room-access-denied', { message: 'Unable to verify location access.' })
    }
  }

  // Expired/replaced tokens also disconnect established sockets.
  const sessionCheck = setInterval(async () => {
    try {
      if (!(await loadSocketUser(socket.data.loginToken))) socket.disconnect(true)
    } catch (error) {
      console.error('Socket session validation failed:', error)
      socket.disconnect(true)
    }
  }, 60 * 1000)
  sessionCheck.unref?.()
  socket.on('disconnect', () => clearInterval(sessionCheck))

  socket.on('join-location', (locationId) => {
    void joinContext(locationId)
  })
  socket.on('join-user-context', ({ locationId } = {}) => {
    // Ignore client-provided companyId; derive it from authorized location.
    void joinContext(locationId)
  })
})

// ============================================
// Import Route Modules
// ============================================

const userRoutes = require('./routes/user')
const customerRoutes = require('./routes/customer')(io)
const employeeRoutes = require('./routes/employee')
const machineRoutes = require('./routes/machine')
const dashboardRoutes = require('./routes/dashboard')
const readingRoutes = require('./routes/reading')
const pointWatchingRouter = require('./routes/pointwatching')
const employeeSessionRouter = require('./routes/employeesession')
const bonusRouter = require('./routes/bonus')
const roleRouter = require('./routes/role')
const companyRoutes =require('./routes/company')
const locationRoutes = require('./routes/location')
const promotionTemplateRouter =require('./routes/promotionTemplate')
const promotionRouter =require('./routes/promotion')
const manageRulesRoutes = require('./routes/manageRules')
const employeeFinanceRoutes = require('./routes/employeeFinance')
const locationCashRoutes = require('./routes/locationCash')
const raffleRoutes = require('./routes/raffle')
const ticketOutRoutes = require('./routes/ticketOut')
const customerVerificationRoutes = require('./routes/customerVerification')
const luckyBirdRoutes = require('./routes/luckybird')


const { startPromotionWorker } = require('./services/promotionWorker')
// ============================================
// Mount Routers
// ============================================

app.use('/api/user', userRoutes)
app.use('/api/customer', customerRoutes)
app.use('/api/employee', employeeRoutes)
app.use('/api/machine', machineRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/reading', readingRoutes)
app.use('/api/pointwatching', pointWatchingRouter)
app.use('/api/employeesession', employeeSessionRouter)
app.use('/api/bonus', bonusRouter)
app.use('/api/role', roleRouter)
app.use('/api/company',companyRoutes)
app.use('/api/location', locationRoutes)
app.use('/api/promotion-template',promotionTemplateRouter)
app.use('/api/promotion', promotionRouter)
app.use('/api/managerules', manageRulesRoutes())
app.use('/api/employeefinance', employeeFinanceRoutes)
app.use('/api/locationcash', locationCashRoutes)
app.use('/api/raffle', raffleRoutes)
app.use('/api/ticketout', ticketOutRoutes)
app.use('/api/customerverification', customerVerificationRoutes)
app.use('/api/luckybird', luckyBirdRoutes)

/*
 * Start once after database/app initialization.
 * Do not call this inside a request handler.
 */
startPromotionWorker()

// ============================================
// Health Check
// ============================================

app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'IK API is running' })
})

// Sanitize otherwise-unhandled errors (including upload/JSON parsing
// failures) instead of exposing Express error pages or stack traces.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  const status = Number(error?.status || error?.statusCode)
  const responseStatus = Number.isInteger(status) && status >= 400 && status < 500 ? status : 500
  console.error('Unhandled API request error:', error)
  return res.status(responseStatus).json({
    success: false,
    code: responseStatus * 100,
    message: responseStatus === 413
      ? 'Request is too large.'
      : responseStatus === 400
        ? 'Invalid request data.'
        : responseStatus === 500
          ? 'Unable to process request.'
          : 'Request rejected.'
  })
})

// ============================================
// Start Server
// ============================================
const HOST = process.env.HOST || '0.0.0.0'
httpServer.listen(PORT, HOST, () => {
    console.log(
        `${USE_HTTPS ? 'HTTPS' : 'HTTP'} server running on port ${PORT}`
    )
})
