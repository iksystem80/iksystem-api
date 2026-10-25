const express = require('express')
const { pool } = require('../db')
const { requireModuleAccess } = require('../utils/moduleAccess')
const { authenticate } = require('../middleware/auth')

module.exports = function () {
    const router = express.Router()
    router.use(authenticate)

    async function requireLocationAccess(req, res, next) {
        const locationId = Number(req.method === 'GET' ? req.query.locationid : req.body?.locationid)
        if (!Number.isSafeInteger(locationId) || locationId <= 0) {
            return res.status(400).json({ success: false, code: 40000, message: 'Valid location id is required.' })
        }
        try {
            const location = await pool.query(`SELECT "CompanyId" FROM "Locations" WHERE "ID"=$1 LIMIT 1`, [locationId])
            if (!location.rowCount) {
                return res.status(404).json({ success: false, code: 40400, message: 'Location not found.' })
            }
            const role = String(req.authUser?.roleName || '').trim().toLowerCase()
            if (role !== 'system admin') {
                if (Number(location.rows[0].CompanyId) !== Number(req.authUser?.companyId)) {
                    return res.status(403).json({ success: false, code: 40300, message: 'Location access denied.' })
                }
                if (role !== 'owner') {
                    const access = await pool.query(`
                        SELECT 1 FROM "Users" u WHERE u."ID"=$1
                          AND COALESCE(u."IsActive",true)=true
                          AND (u."LocationId"=$2 OR ($3='admin' AND EXISTS (
                            SELECT 1 FROM "UserLocationAccess" ula
                            WHERE ula."UserId"=u."ID" AND ula."LocationId"=$2
                          ))) LIMIT 1
                    `, [req.authUser.id, locationId, role])
                    if (!access.rowCount) {
                        return res.status(403).json({ success: false, code: 40300, message: 'Location access denied.' })
                    }
                }
            }
            return next()
        } catch (error) {
            console.error('Manage rules location authorization:', error)
            return res.status(500).json({ success: false, code: 50000, message: 'Unable to verify location access.' })
        }
    }

    const nonnegativeInteger = value =>
        Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 2147483647

    function parseBoolean(value) {
        return value === true || value === 'true' || value === 1 || value === '1'
    }

    function normalizeResetTimes(value) {
        let times = value

        if (typeof value === 'string') {
            try {
                times = JSON.parse(value)
            } catch {
                times = value.split(',').map(item => item.trim()).filter(Boolean)
            }
        }

        if (!Array.isArray(times)) return []

        const validTime = /^([01]\d|2[0-3]):([0-5]\d)$/

        return [...new Set(
            times
                .map(item => String(item).trim())
                .filter(item => validTime.test(item))
        )]
    }

    function toResponse(row) {
        return {
            id: row.ID,
            locationId: row.LocationId,
            matchRuleEnabled: row.MatchRuleEnabled,
            matchRuleName: row.MatchRuleName,
            matchCooldownHours: row.MatchCooldownHours,
            matchMaxPerDay: row.MatchMaxPerDay,
            matchResetTimes: row.MatchResetTimes || [],
            matchResetDayTime: row.MatchResetDayTime,
            nfcTicketOutEnabled: row.NfcTicketOutEnabled,
            auditVerificationEnabled: row.AuditVerificationEnabled,
            luckyBirdEnabled: row.LuckyBirdEnabled,
            luckyBirdMaxCustomersPerDay: Number(row.LuckyBirdMaxCustomersPerDay || 0),
            phoneVerificationRequired: row.PhoneVerificationRequired,
            nuVueBoostEnabled: row.NuVueBoostEnabled,
            ticketPhotoRequired: row.TicketPhotoRequired,
            ticketPhotoMinAmount: Number(row.TicketPhotoMinAmount || 0),
            vipMatchEnabled: row.VipMatchEnabled,
            vipMatchMinPoints: row.VipMatchMinPoints,
            updatedAt: row.UpdatedAt,
            updatedBy: row.UpdatedBy
        }
    }

    router.get(
        '/get',
        requireModuleAccess('settings.manage-rules'),
        requireLocationAccess,
        async (req, res) => {
            try {
                const locationId = Number(req.query.locationid)

                if (!Number.isInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid location id is required.',
                        code: 40000
                    })
                }

                await pool.query(
                    `
                    INSERT INTO "LocationRuleSettings" ("LocationId")
                    VALUES ($1)
                    ON CONFLICT ("LocationId") DO NOTHING
                    `,
                    [locationId]
                )

                const result = await pool.query(
                    `
                    SELECT *
                    FROM "LocationRuleSettings"
                    WHERE "LocationId" = $1
                    LIMIT 1
                    `,
                    [locationId]
                )

                return res.status(200).json({
                    success: true,
                    message: 'Manage rules retrieved successfully.',
                    code: 20000,
                    data: toResponse(result.rows[0])
                })
            } catch (error) {
                console.error('Get manage rules error:', error)

                return res.status(500).json({
                    success: false,
                    message: 'Unable to retrieve manage rules.',
                    code: 50000
                })
            }
        }
    )

    router.put(
        '/update',
        requireModuleAccess('settings.manage-rules'),
        requireLocationAccess,
        async (req, res) => {
            try {
                const body = req.body || {}
                const locationId = Number(body.locationid)

                if (!Number.isInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid location id is required.',
                        code: 40000
                    })
                }

                const matchRuleName = String(body.matchRuleName || 'MATCH').trim().slice(0, 100)
                const cooldownHours = Math.max(0, Number(body.matchCooldownHours || 0))
                const maxMatchesPerDay = Math.max(0, Number(body.matchMaxPerDay || 0))
                const resetTimes = normalizeResetTimes(body.matchResetTimes)
                const resetDayTime = String(body.matchResetDayTime || '07:00')
                const ticketPhotoMinAmount = Math.max(0, Number(body.ticketPhotoMinAmount || 0))
                const vipMatchMinPoints = Math.max(0, Number(body.vipMatchMinPoints || 0))
                const luckyBirdEnabled = parseBoolean(body.luckyBirdEnabled)
                const luckyBirdMaxCustomersPerDay = Math.max(1, Math.floor(Number(body.luckyBirdMaxCustomersPerDay || 1)))
                const updatedBy = req.authUser.id

                if (![cooldownHours, maxMatchesPerDay, vipMatchMinPoints,
                    luckyBirdMaxCustomersPerDay].every(nonnegativeInteger) ||
                    luckyBirdMaxCustomersPerDay < 1 ||
                    !Number.isFinite(ticketPhotoMinAmount) ||
                    ticketPhotoMinAmount > 9999999999.99 ||
                    !/^([01]\d|2[0-3]):[0-5]\d$/.test(resetDayTime)) {
                    return res.status(400).json({ success: false, code: 40000,
                        message: 'Invalid rule numbers or reset time.' })
                }

                const result = await pool.query(
                    `
                    INSERT INTO "LocationRuleSettings"
                    (
                        "LocationId",
                        "MatchRuleEnabled",
                        "MatchRuleName",
                        "MatchCooldownHours",
                        "MatchMaxPerDay",
                        "MatchResetTimes",
                        "MatchResetDayTime",
                        "NfcTicketOutEnabled",
                        "AuditVerificationEnabled",
                        "LuckyBirdEnabled",
                        "LuckyBirdMaxCustomersPerDay",
                        "PhoneVerificationRequired",
                        "NuVueBoostEnabled",
                        "TicketPhotoRequired",
                        "TicketPhotoMinAmount",
                        "VipMatchEnabled",
                        "VipMatchMinPoints",
                        "UpdatedAt",
                        "UpdatedBy"
                    )
                    VALUES
                    (
                        $1, $2, $3, $4, $5, $6::jsonb, $7::time,
                        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18
                    )
                    ON CONFLICT ("LocationId")
                    DO UPDATE SET
                        "MatchRuleEnabled" = EXCLUDED."MatchRuleEnabled",
                        "MatchRuleName" = EXCLUDED."MatchRuleName",
                        "MatchCooldownHours" = EXCLUDED."MatchCooldownHours",
                        "MatchMaxPerDay" = EXCLUDED."MatchMaxPerDay",
                        "MatchResetTimes" = EXCLUDED."MatchResetTimes",
                        "MatchResetDayTime" = EXCLUDED."MatchResetDayTime",
                        "NfcTicketOutEnabled" = EXCLUDED."NfcTicketOutEnabled",
                        "AuditVerificationEnabled" = EXCLUDED."AuditVerificationEnabled",
                        "LuckyBirdEnabled" = EXCLUDED."LuckyBirdEnabled",
                        "LuckyBirdMaxCustomersPerDay" = EXCLUDED."LuckyBirdMaxCustomersPerDay",
                        "PhoneVerificationRequired" = EXCLUDED."PhoneVerificationRequired",
                        "NuVueBoostEnabled" = EXCLUDED."NuVueBoostEnabled",
                        "TicketPhotoRequired" = EXCLUDED."TicketPhotoRequired",
                        "TicketPhotoMinAmount" = EXCLUDED."TicketPhotoMinAmount",
                        "VipMatchEnabled" = EXCLUDED."VipMatchEnabled",
                        "VipMatchMinPoints" = EXCLUDED."VipMatchMinPoints",
                        "UpdatedAt" = NOW(),
                        "UpdatedBy" = EXCLUDED."UpdatedBy"
                    RETURNING *
                    `,
                    [
                        locationId,
                        parseBoolean(body.matchRuleEnabled),
                        matchRuleName,
                        cooldownHours,
                        maxMatchesPerDay,
                        JSON.stringify(resetTimes),
                        resetDayTime,
                        parseBoolean(body.nfcTicketOutEnabled),
                        parseBoolean(body.auditVerificationEnabled),
                        luckyBirdEnabled,
                        luckyBirdMaxCustomersPerDay,
                        parseBoolean(body.phoneVerificationRequired),
                        parseBoolean(body.nuVueBoostEnabled),
                        parseBoolean(body.ticketPhotoRequired),
                        ticketPhotoMinAmount,
                        parseBoolean(body.vipMatchEnabled),
                        vipMatchMinPoints,
                        updatedBy
                    ]
                )

                return res.status(200).json({
                    success: true,
                    message: 'Manage rules updated successfully.',
                    code: 20000,
                    data: toResponse(result.rows[0])
                })
            } catch (error) {
                console.error('Update manage rules error:', error)

                return res.status(500).json({
                    success: false,
                    message: 'Unable to update manage rules.',
                    code: 50000
                })
            }
        }
    )

    return router
}
