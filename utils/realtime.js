let socketIO = null

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
    emitAppRefresh,
    emitAccessStatus,
    emitLocationsRefresh
}
