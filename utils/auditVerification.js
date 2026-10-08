async function isAuditVerificationEnabled(db, locationId) {
    const location = Number(locationId)

    if (!Number.isInteger(location) || location <= 0) {
        return false
    }

    const result = await db.query(
        `
        SELECT "AuditVerificationEnabled"
        FROM "LocationRuleSettings"
        WHERE "LocationId" = $1
        LIMIT 1
        `,
        [location]
    )

    return result.rowCount > 0 &&
        result.rows[0].AuditVerificationEnabled === true
}

module.exports = {
    isAuditVerificationEnabled
}
