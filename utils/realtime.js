const crypto = require('crypto')

let socketIO = null

// Single-process, short-lived proofs for a browser whose token was just replaced.
// The old token cannot call authenticated APIs after login B, so the proof is
// needed for a tightly scoped "that wasn't me" revocation endpoint.
const SESSION_REVIEW_TTL_MS = 10 * 60 * 1000
const sessionReviews = new Map()

function tokenDigest(token) {
    return crypto.createHash('sha256').update(token).digest('hex')
}

function pruneSessionReviews() {
    const now = Date.now()
    for (const [challenge, item] of sessionReviews) {
        if (item.expiresAt <= now) sessionReviews.delete(challenge)
    }
}

function notifySessionReplaced(userId, oldToken, newToken) {
    if (!socketIO || !Number.isSafeInteger(Number(userId)) ||
        typeof oldToken !== 'string' || !oldToken ||
        typeof newToken !== 'string' || !newToken || oldToken === newToken) return false

    // Only authenticated connections from the replaced session are notified.
    const previousSockets = [...socketIO.sockets.sockets.values()].filter(socket =>
        Number(socket.data.user?.id) === Number(userId) &&
        socket.data.loginToken === oldToken
    )
    if (!previousSockets.length) return false

    pruneSessionReviews()
    const challenge = crypto.randomBytes(32).toString('hex')
    const expiresAt = Date.now() + SESSION_REVIEW_TTL_MS
    sessionReviews.set(challenge, {
        userId: Number(userId),
        oldTokenDigest: tokenDigest(oldToken),
        expectedNewToken: newToken,
        expiresAt
    })

    for (const socket of previousSockets) {
        socket.emit('session-replaced', { challenge, expiresAt: new Date(expiresAt).toISOString() })
    }
    return true
}

function findSessionReview(challenge, previousToken) {
    pruneSessionReviews()
    if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/.test(challenge) ||
        typeof previousToken !== 'string' || !previousToken) return null

    const item = sessionReviews.get(challenge)
    if (!item) return null

    // Constant-time digest comparison. The challenge alone is not enough:
    // the old browser must also prove possession of its prior session token.
    const actual = Buffer.from(tokenDigest(previousToken), 'hex')
    const expected = Buffer.from(item.oldTokenDigest, 'hex')
    return crypto.timingSafeEqual(actual, expected) ? item : null
}

function forgetSessionReview(challenge) {
    sessionReviews.delete(challenge)
}

function notifySessionRevoked(userId, token) {
    if (!socketIO) return false
    let notified = false
    for (const socket of socketIO.sockets.sockets.values()) {
        if (Number(socket.data.user?.id) === Number(userId) &&
            socket.data.loginToken === token) {
            socket.emit('session-revoked', { reason: 'unrecognized-login' })
            notified = true
        }
    }
    return notified
}

function setSocketIO(io) {
    socketIO = io || null
}

function cleanPositiveId(value) {
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0
        ? id
        : null
}

function emitAppRefresh(locationId, targets, action, details = {}) {
    const location = cleanPositiveId(locationId)
    const cleanTargets = [...new Set(
        (Array.isArray(targets) ? targets : [targets])
            .map(value => String(value || '').trim())
            .filter(Boolean)
    )]

    if (!socketIO || !location || !cleanTargets.length) return false

    socketIO.to(`location-${location}`).emit('app-refresh', {
        locationId: location,
        targets: cleanTargets,
        action: String(action || '').trim() || 'data-changed',
        details: details && typeof details === 'object' ? details : {},
        occurredAt: new Date().toISOString()
    })

    return true
}

function emitAccessStatus(scope, id, status, name = '', details = {}) {
    const cleanScope =
        String(scope || '')
            .trim()
            .toLowerCase()

    const entityId =
        cleanPositiveId(id)

    const cleanStatus =
        String(status || '')
            .trim()
            .toLowerCase()

    if (
        !socketIO ||
        !entityId ||
        !['company', 'location'].includes(cleanScope) ||
        !['inactive', 'suspended'].includes(cleanStatus)
    ) {
        return false
    }

    socketIO
        .to(`${cleanScope}-${entityId}`)
        .emit('access-status', {
            scope: cleanScope,
            status: cleanStatus,
            id: entityId,
            name: String(name || '').trim(),
            details: details && typeof details === 'object' ? details : {},
            occurredAt: new Date().toISOString()
        })

    return true
}

function emitLocationsRefresh(companyId, action = 'location-status-changed', details = {}) {
    const company =
        cleanPositiveId(companyId)

    if (!socketIO || !company) return false

    socketIO
        .to(`company-${company}`)
        .emit('locations-refresh', {
            companyId: company,
            action: String(action || '').trim() || 'location-status-changed',
            details: details && typeof details === 'object' ? details : {},
            occurredAt: new Date().toISOString()
        })

    return true
}

module.exports = {
    setSocketIO,
    notifySessionReplaced,
    findSessionReview,
    forgetSessionReview,
    notifySessionRevoked,
    emitAppRefresh,
    emitAccessStatus,
    emitLocationsRefresh
}
