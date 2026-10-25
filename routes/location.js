const express = require('express')

const router = express.Router()

const { pool } = require('../db')
const {
    emitAccessStatus,
    emitLocationsRefresh
} = require('../utils/realtime')

const {
    authenticate,
    requireSystemAdmin
} = require('../middleware/auth')

// ============================================================
// GET LOCATIONS BY COMPANY
// ============================================================

router.get(
    '/company/:companyId',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const companyId =
                Number(
                    req.params.companyId
                )

            if (!Number.isSafeInteger(companyId) || companyId <= 0) {
                return res.status(400).json({ success: false, code: 40000, message: 'Valid company is required.' })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        l."ID"
                            AS "id",

                        l."name"
                            AS "name",

                        l."CompanyId"
                            AS "companyId",

                        l."IsActive"
                            AS "isActive",

                        l."IsSuspended"
                            AS "isSuspended",

                        COALESCE(l."AllowFaceCheckin", false)
                            AS "allowFaceCheckin",

                        COUNT(
                            u."ID"
                        )::integer
                            AS "userCount"

                    FROM
                        "Locations" l

                    LEFT JOIN
                        "Users" u

                        ON
                            u."LocationId" =
                                l."ID"

                    WHERE
                        l."CompanyId" = $1

                    GROUP BY
                        l."ID",
                        l."name",
                        l."CompanyId",
                        l."IsActive",
                        l."IsSuspended"

                    ORDER BY
                        l."name"
                    `,
                    [
                        companyId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                data:
                    result.rows
            })

        } catch (error) {
            console.error(
                'Get company locations error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve locations.'
            })
        }
    }
)

// ============================================================
// CREATE LOCATION
// SYSTEM ADMIN ONLY
// ============================================================

router.post(
    '/create',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const {
                companyId,
                name
            } = req.body

            if (
                !Number.isSafeInteger(Number(companyId)) ||
                Number(companyId) <= 0 ||
                typeof name !== 'string' ||
                !name.trim() ||
                name.trim().length > 100
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Company and location name are required.'
                })
            }

            const companyResult =
                await pool.query(
                    `
                    SELECT "ID"

                    FROM "Companies"

                    WHERE
                        "ID" = $1

                        AND
                        "IsActive" = true
                    `,
                    [
                        companyId
                    ]
                )

            if (
                companyResult.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Company not found.'
                })
            }

            const existing =
                await pool.query(
                    `
                    SELECT "ID"

                    FROM "Locations"

                    WHERE
                        "CompanyId" = $1

                        AND
                        LOWER("name") =
                            LOWER($2)
                    `,
                    [
                        companyId,
                        name.trim()
                    ]
                )

            if (
                existing.rowCount
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Location already exists for this company.'
                })
            }

            const result =
                await pool.query(
                    `
                    INSERT INTO "Locations"
                    (
                        "name",
                        "CompanyId",
                        "IsActive",
                        "IsSuspended"
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        true,
                        false
                    )

                    RETURNING
                        "ID",
                        "name",
                        "CompanyId",
                        "IsActive",
                        "IsSuspended"
                    `,
                    [
                        name.trim(),
                        companyId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Location created successfully.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Create location error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to create location.'
            })
        }
    }
)

// ============================================================
// UPDATE LOCATION
// ============================================================

router.put(
    '/update/:id',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const locationId = Number(req.params.id)
            const { name, allowFaceCheckin, isActive, isSuspended, status } = req.body

            if (!Number.isInteger(locationId) || locationId <= 0 ||
                typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Valid location and name (1–100 characters) are required.'
                })
            }

            if (allowFaceCheckin !== undefined && typeof allowFaceCheckin !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Allow Face Check-In must be true or false.'
                })
            }

            if ((isActive !== undefined && typeof isActive !== 'boolean') ||
                (isSuspended !== undefined && typeof isSuspended !== 'boolean')) {
                return res.status(400).json({
                    success: false, code: 40000,
                    message: 'Location active and suspended flags must be true or false.'
                })
            }

            const currentResult = await pool.query(`
                SELECT "ID", "CompanyId", "IsActive", "IsSuspended",
                       COALESCE("AllowFaceCheckin", false) AS "allowFaceCheckin"
                FROM "Locations" WHERE "ID" = $1
            `, [locationId])

            if (!currentResult.rowCount) {
                return res.status(404).json({
                    success: false, code: 40400, message: 'Location not found.'
                })
            }

            const current = currentResult.rows[0]
            const existing = await pool.query(`
                SELECT "ID" FROM "Locations"
                WHERE "CompanyId" = $1 AND LOWER(BTRIM("name")) = LOWER($2)
                  AND "ID" <> $3
                LIMIT 1
            `, [current.CompanyId, name.trim(), locationId])

            if (existing.rowCount) {
                return res.status(409).json({
                    success: false, code: 40900,
                    message: 'Location already exists for this company.'
                })
            }

            // Preserve status for ordinary name/face-check-in edits.
            // Continue supporting callers that explicitly update status here.
            let nextIsActive = current.IsActive
            let nextIsSuspended = current.IsSuspended
            const changesStatus = status !== undefined || isActive !== undefined || isSuspended !== undefined

            if (changesStatus) {
                nextIsActive = isActive !== undefined ? isActive === true : current.IsActive
                nextIsSuspended = isSuspended !== undefined ? isSuspended === true : current.IsSuspended

                if (status !== undefined) {
                    const normalizedStatus = String(status).trim().toLowerCase()
                    if (!['active', 'inactive', 'suspended'].includes(normalizedStatus)) {
                        return res.status(400).json({
                            success: false, code: 40000, message: 'Location status is invalid.'
                        })
                    }
                    nextIsActive = normalizedStatus === 'active'
                    nextIsSuspended = normalizedStatus === 'suspended'
                }

                if (nextIsActive) nextIsSuspended = false

                // Both status endpoints must enforce the same company-state rule.
                // Otherwise /update/:id could reactivate a location in a
                // suspended or inactive company, bypassing /status/:id.
                if (nextIsActive) {
                    const companyState = await pool.query(`
                        SELECT "IsActive", COALESCE("IsSuspended", false) AS "IsSuspended"
                        FROM "Companies" WHERE "ID"=$1 LIMIT 1
                    `, [current.CompanyId])

                    if (!companyState.rowCount ||
                        companyState.rows[0].IsActive !== true ||
                        companyState.rows[0].IsSuspended === true) {
                        return res.status(409).json({
                            success: false, code: 40900,
                            message: 'Activate the company before activating this location.'
                        })
                    }
                }
            }

            const result = await pool.query(`
                UPDATE "Locations"
                SET "name" = $1, "AllowFaceCheckin" = $2,
                    "IsActive" = $3, "IsSuspended" = $4
                WHERE "ID" = $5
                RETURNING "ID" AS "id", "name", "CompanyId" AS "companyId",
                          "IsActive" AS "isActive", "IsSuspended" AS "isSuspended",
                          "AllowFaceCheckin" AS "allowFaceCheckin"
            `, [name.trim(), allowFaceCheckin === undefined ? current.allowFaceCheckin : allowFaceCheckin,
                nextIsActive, nextIsSuspended, locationId])

            const updatedLocation = result.rows[0]
            const updatedStatus = updatedLocation.isSuspended
                ? 'suspended' : updatedLocation.isActive ? 'active' : 'inactive'

            if (changesStatus && (updatedStatus === 'inactive' || updatedStatus === 'suspended')) {
                emitAccessStatus('location', locationId, updatedStatus, updatedLocation.name, {
                    companyId: updatedLocation.companyId
                })
            }

            emitLocationsRefresh(updatedLocation.companyId, 'location-updated', {
                locationId,
                status: updatedStatus
            })

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Location updated successfully.',
                data: updatedLocation
            })
        } catch (error) {
            console.error('Update location error:', error)
            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to update location.'
            })
        }
    }
)


// ============================================================
// LOCATION STATUS
// ACTIVE / INACTIVE / SUSPENDED
// SYSTEM ADMIN ONLY
// ============================================================

router.patch(
    '/status/:id',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const locationId =
                Number(
                    req.params.id
                )

            const normalizedStatus =
                String(
                    req.body.status || ''
                )
                    .trim()
                    .toLowerCase()

            if (
                !Number.isInteger(locationId) ||
                locationId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Valid location is required.'
                })
            }

            if (
                ![
                    'active',
                    'inactive',
                    'suspended'
                ].includes(normalizedStatus)
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Location status is invalid.'
                })
            }

            const isActive =
                normalizedStatus ===
                'active'

            const isSuspended =
                normalizedStatus ===
                'suspended'

            // A location cannot be activated while its company is inactive
            // or suspended. Inactive/suspended location changes are always allowed.
            if (isActive) {
                const companyState =
                    await pool.query(
                        `
                        SELECT
                            c."IsActive",
                            COALESCE(c."IsSuspended", false) AS "IsSuspended"
                        FROM "Locations" l
                        INNER JOIN "Companies" c
                          ON c."ID" = l."CompanyId"
                        WHERE l."ID" = $1
                        LIMIT 1
                        `,
                        [
                            locationId
                        ]
                    )

                if (!companyState.rowCount) {
                    return res.status(404).json({
                        success: false,
                        code: 40400,
                        message:
                            'Location not found.'
                    })
                }

                const company =
                    companyState.rows[0]

                if (
                    company.IsActive !== true ||
                    company.IsSuspended === true
                ) {
                    return res.status(409).json({
                        success: false,
                        code: 40900,
                        message:
                            'Activate the company before activating this location.'
                    })
                }
            }

            const result =
                await pool.query(
                    `
                    UPDATE "Locations"
                    SET
                        "IsActive" = $1,
                        "IsSuspended" = $2
                    WHERE
                        "ID" = $3
                    RETURNING
                        "ID" AS "id",
                        "name" AS "name",
                        "CompanyId" AS "companyId",
                        "IsActive" AS "isActive",
                        "IsSuspended" AS "isSuspended"
                    `,
                    [
                        isActive,
                        isSuspended,
                        locationId
                    ]
                )

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Location not found.'
                })
            }

            const updatedLocation =
                result.rows[0]

            if (
                normalizedStatus === 'inactive' ||
                normalizedStatus === 'suspended'
            ) {
                emitAccessStatus(
                    'location',
                    locationId,
                    normalizedStatus,
                    updatedLocation.name,
                    {
                        companyId:
                            updatedLocation.companyId
                    }
                )
            }

            emitLocationsRefresh(
                updatedLocation.companyId,
                'location-status-changed',
                {
                    locationId,
                    status:
                        normalizedStatus
                }
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Location status updated.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Location status error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update location status.'
            })
        }
    }
)

module.exports = router
