let socketIO = null

function setSocketIO(io) {
    socketIO = io || null
}

function emitAppRefresh(locationId, targets, action, details = {}) {
    const location = Number(locationId)
    const cleanTargets = [...new Set(
        (Array.isArray(targets) ? targets : [targets])
            .map(value => String(value || '').trim())
            .filter(Boolean)
    )]

    if (!socketIO || !Number.isSafeInteger(location) || location <= 0 || !cleanTargets.length) return false

    socketIO.to(`location-${location}`).emit('app-refresh', {
        locationId: location,
        targets: cleanTargets,
        action: String(action || '').trim() || 'data-changed',
        details: details && typeof details === 'object' ? details : {},
        occurredAt: new Date().toISOString()
    })

    return true
}

module.exports = {
    setSocketIO,
    emitAppRefresh
}
