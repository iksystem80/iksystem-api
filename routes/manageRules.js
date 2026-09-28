const express = require('express')
const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')

module.exports = function () {
    const router = express.Router()

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
        requirePermission('managerules.read'),
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
        requirePermission('managerules.update'),
        async (req, res) => {
            try {
                const body = req.body || {}
                const locationId = Number(body.locationId)

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
                const updatedBy = req.authUser?.id || body.updatedBy || null

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
                        $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16
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
