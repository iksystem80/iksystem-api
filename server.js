const express = require('express')
const http = require('http')
const https = require('https')
const fs = require('fs')
const cors = require('cors')
const bodyParser = require('body-parser')
const path = require('path')
const { Server } = require('socket.io')
require('dotenv').config()

const PORT = process.env.PORT || 3000
const USE_HTTPS = process.env.USE_HTTPS === 'true'
console.log('current:' + USE_HTTPS)

const app = express()

app.use(cors())
app.use(bodyParser.json({limit: '25mb',}))
app.use(bodyParser.urlencoded({extended: true,limit: '25mb',}))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

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
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
})

// ============================================
// Socket.IO connection
// ============================================

io.on('connection', (socket) => {
  socket.on('join-location', (locationId) => {
    const location = `location-${locationId}`

    socket.join(location)
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
        

/*
 * Start once after database/app initialization.
 * Do not call this inside a request handler.
 */
startPromotionWorker()

// ============================================
// Health Check
// ============================================

app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'IK System API is running' })
})

// ============================================
// Start Server
// ============================================

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
        `${USE_HTTPS ? 'HTTPS' : 'HTTP'} server running on port ${PORT}`
    )
})
