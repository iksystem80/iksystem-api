const express = require('express')
const router = express.Router()
const { pool } = require('../db')

const {
    authenticate,
    requirePermission
} = require('../middleware/auth')

router.use(authenticate)

// ============================================================
// HELPERS
// ============================================================

const role = req =>
    String(req.authUser?.roleName || '')
        .trim()
        .toLowerCase()

const canManage = req =>
    ['owner', 'admin', 'system admin'].includes(role(req))

function requireOwnerOrAdmin(req, res, next) {
    if (!canManage(req)) {
        return res.status(403).json({
            success: false,
            code: 40300,
            message: 'Owner or Admin access is required.'
        })
    }

    next()
}

function success(res, data = null, message = 'Success') {
    return res.status(200).json({
        success: true,
        code: 20000,
        message,
        ...(data !== null ? { data } : {})
    })
}

function errorResponse(res, error) {
    const errors = {
        LOCATION_NOT_FOUND: [404, 40401, 'Location not found.'],
        LOCATION_FORBIDDEN: [403, 40301, 'You cannot access this location.'],
        MACHINE_NOT_FOUND: [404, 40402, 'Machine not found.'],
        MACHINE_FORBIDDEN: [403, 40302, 'You cannot access this machine.']
    }

    const known = errors[error.message]

    if (known) {
        return res.status(known[0]).json({
            success: false,
            code: known[1],
            message: known[2]
        })
    }

    console.error('Machine route error:', error)

    return res.status(500).json({
        success: false,
        code: 50000,
        message: 'Server error.'
    })
}

async function verifyLocation(req, locationId, db = pool) {
    const result = await db.query(`
        SELECT
            l."ID",
            l."CompanyId"
        FROM "Locations" l
        WHERE l."ID" = $1
        LIMIT 1
    `, [locationId])

    if (!result.rowCount) {
        throw new Error('LOCATION_NOT_FOUND')
    }

    const location = result.rows[0]

    if (
        role(req) !== 'system admin' &&
        Number(location.CompanyId) !== Number(req.authUser.companyId)
    ) {
        throw new Error('LOCATION_FORBIDDEN')
    }

    return location
}

async function getMachine(req, machineId, db = pool) {
    const result = await db.query(`
        SELECT
            m.*,
            l."CompanyId"
        FROM "Machines" m
        INNER JOIN "Locations" l
            ON l."ID" = m.locationid
        WHERE m."ID" = $1
        LIMIT 1
    `, [machineId])

    if (!result.rowCount) {
        throw new Error('MACHINE_NOT_FOUND')
    }

    const machine = result.rows[0]

    if (
        role(req) !== 'system admin' &&
        Number(machine.CompanyId) !== Number(req.authUser.companyId)
    ) {
        throw new Error('MACHINE_FORBIDDEN')
    }

    return machine
}

async function logChange(
    db,
    machineId,
    userId,
    actionType,
    fieldName = null,
    oldValue = null,
    newValue = null,
    reason = null
) {
    await db.query(`
        INSERT INTO "MachineLogs"
        (
            "MachineId",
            "ActionType",
            "FieldName",
            "OldValue",
            "NewValue",
            "Reason",
            "ChangedBy"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [
        machineId,
        actionType,
        fieldName,
        oldValue == null ? null : String(oldValue),
        newValue == null ? null : String(newValue),
        reason || null,
        userId
    ])
}

// ============================================================
// GET MACHINE BY NUMBER
// ============================================================

router.get(
    '/getmachinebynumber',
    requirePermission('machines.read'),
    async (req, res) => {
        try {
            const { machinenumber, locationid } = req.query

            if (!machinenumber || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Machine number and location are required.'
                })
            }

            await verifyLocation(req, Number(locationid))

            const result = await pool.query(`
                SELECT
                    m."ID" AS id,
                    m."MachineNumber" AS machinenumber,
                    m.locationid AS "Locationid",
                    mt."TypeName" AS machinetype,
                    ms."Description" AS status
                FROM "Machines" m
                INNER JOIN "MachineStatus" ms
                    ON ms."ID" = m."StatusId"
                LEFT JOIN "MachineTypes" mt
                    ON mt."ID" = m."MachineTypeId"
                WHERE
                    m."MachineNumber" = $1
                    AND m.locationid = $2
                LIMIT 1
            `, [
                machinenumber,
                locationid
            ])

            if (!result.rowCount) {
                return res.status(200).json({
                    success: false,
                    code: 20000,
                    message: 'No machine found.',
                    data: null
                })
            }

            return success(
                res,
                result.rows[0],
                'Machine retrieved successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// MACHINE STATUSES
// ============================================================

router.get(
    '/statuses',
    requirePermission('machines.read'),
    async (_req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    "ID",
                    "Description"
                FROM "MachineStatus"
                ORDER BY "ID"
            `)

            return success(
                res,
                result.rows,
                'Machine statuses retrieved successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// GET ALL MACHINES
// ============================================================

router.get(
    '/getall',
    requirePermission('machines.read'),
    async (req, res) => {
        try {
            const locationId = Number(req.query.locationid)

            if (!locationId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Location is required.'
                })
            }

            await verifyLocation(req, locationId)

            const result = await pool.query(`
                SELECT
                    m."ID",
                    m."MachineNumber",
                    m."MachineTypeId",
                    m."GameId",
                    m."StatusId",
                    m."StatusReason",
                    m.locationid,
                    m."DateCreated",
                    m."DateUpdated",

                    mt."TypeName" AS "MachineTypeName",
                    g."GameName",
                    ms."Description" AS "Status",
                    u."Name" AS "UpdatedByName"

                FROM "Machines" m

                LEFT JOIN "MachineTypes" mt
                    ON mt."ID" = m."MachineTypeId"

                LEFT JOIN "Games" g
                    ON g."ID" = m."GameId"

                LEFT JOIN "MachineStatus" ms
                    ON ms."ID" = m."StatusId"

                LEFT JOIN "Users" u
                    ON u."ID" = m."UpdatedBy"

                WHERE m.locationid = $1
                ORDER BY m."MachineNumber"
            `, [locationId])

            return success(
                res,
                result.rows,
                'Machines retrieved successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// GENERATE MACHINES
// ============================================================

router.post(
    '/generate',
    requirePermission('machines.create'),
    requireOwnerOrAdmin,
    async (req, res) => {
        const client = await pool.connect()
        let transactionStarted = false

        try {
            const {
                locationId,
                startNumber,
                endNumber,
                machineTypeId
            } = req.body

            const locationID = Number(locationId)
            const start = Number(startNumber)
            const end = Number(endNumber)

            if (!locationID || !start || !end) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Location, start number and end number are required.'
                })
            }

            if (start < 1 || end < start) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Invalid machine number range.'
                })
            }

            if ((end - start) > 999) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Maximum 1000 machines can be generated at one time.'
                })
            }

            const location = await verifyLocation(
                req,
                locationID,
                client
            )

            let typeId = null

            if (machineTypeId) {
                const typeResult = await client.query(`
                    SELECT "ID"
                    FROM "MachineTypes"
                    WHERE "ID" = $1
                      AND "CompanyId" = $2
                      AND "IsActive" = true
                    LIMIT 1
                `, [
                    Number(machineTypeId),
                    location.CompanyId
                ])

                if (!typeResult.rowCount) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message: 'Invalid machine type.'
                    })
                }

                typeId = Number(machineTypeId)
            }

            const statusResult = await client.query(`
                SELECT "ID"
                FROM "MachineStatus"
                WHERE LOWER("Description") = 'working'
                LIMIT 1
            `)

            if (!statusResult.rowCount) {
                return res.status(500).json({
                    success: false,
                    code: 50000,
                    message:
                        'Working machine status has not been configured.'
                })
            }

            await client.query('BEGIN')
            transactionStarted = true

            let created = 0
            let skipped = 0

            for (let number = start; number <= end; number++) {
                const existing = await client.query(`
                    SELECT "ID"
                    FROM "Machines"
                    WHERE locationid = $1
                      AND "MachineNumber" = $2
                    LIMIT 1
                `, [
                    locationID,
                    number
                ])

                if (existing.rowCount) {
                    skipped++
                    continue
                }

                const insert = await client.query(`
                    INSERT INTO "Machines"
                    (
                        "MachineNumber",
                        "MachineTypeId",
                        "GameId",
                        "StatusId",
                        locationid,
                        "UpdatedBy"
                    )
                    VALUES ($1,$2,NULL,$3,$4,$5)
                    RETURNING "ID"
                `, [
                    number,
                    typeId,
                    statusResult.rows[0].ID,
                    locationID,
                    req.authUser.id
                ])

                const machineId = insert.rows[0].ID

                await logChange(
                    client,
                    machineId,
                    req.authUser.id,
                    'Machine Created',
                    'MachineNumber',
                    null,
                    number
                )

                if (typeId) {
                    await logChange(
                        client,
                        machineId,
                        req.authUser.id,
                        'Machine Type Assigned',
                        'MachineTypeId',
                        null,
                        typeId
                    )
                }

                created++
            }

            await client.query('COMMIT')
            transactionStarted = false

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    `${created} machine(s) created. ${skipped} duplicate machine(s) skipped.`,
                data: {
                    created,
                    skipped
                }
            })

        } catch (error) {
            if (transactionStarted) {
                await client.query('ROLLBACK')
            }

            return errorResponse(res, error)

        } finally {
            client.release()
        }
    }
)

// ============================================================
// UPDATE MACHINE
// ============================================================

router.put(
    '/update/:id',
    requirePermission('machines.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        const client = await pool.connect()
        let transactionStarted = false

        try {
            const machineId = Number(req.params.id)

            const {
                machineTypeId,
                gameId,
                statusId,
                statusReason
            } = req.body

            const oldMachine = await getMachine(
                req,
                machineId,
                client
            )

            const companyId = oldMachine.CompanyId

            const newTypeId =
                machineTypeId != null &&
                    machineTypeId !== ''
                    ? Number(machineTypeId)
                    : null

            const newGameId =
                gameId != null &&
                    gameId !== ''
                    ? Number(gameId)
                    : null

            const newStatusId =
                statusId != null &&
                    statusId !== ''
                    ? Number(statusId)
                    : oldMachine.StatusId

            if (newTypeId) {
                const type = await client.query(`
                    SELECT "ID"
                    FROM "MachineTypes"
                    WHERE "ID" = $1
                      AND "CompanyId" = $2
                      AND "IsActive" = true
                    LIMIT 1
                `, [
                    newTypeId,
                    companyId
                ])

                if (!type.rowCount) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message: 'Invalid machine type.'
                    })
                }
            }

            if (newGameId) {
                if (!newTypeId) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message:
                            'A machine type is required before assigning a game.'
                    })
                }

                const game = await client.query(`
                    SELECT "ID"
                    FROM "Games"
                    WHERE "ID" = $1
                      AND "CompanyId" = $2
                      AND "MachineTypeId" = $3
                      AND "IsActive" = true
                    LIMIT 1
                `, [
                    newGameId,
                    companyId,
                    newTypeId
                ])

                if (!game.rowCount) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message:
                            'The selected game does not support this machine type.'
                    })
                }
            }

            const statusResult = await client.query(`
                SELECT "Description"
                FROM "MachineStatus"
                WHERE "ID" = $1
                LIMIT 1
            `, [newStatusId])

            if (!statusResult.rowCount) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Invalid machine status.'
                })
            }

            const notWorking =
                String(statusResult.rows[0].Description)
                    .trim()
                    .toLowerCase() === 'not working'

            if (
                notWorking &&
                !String(statusReason || '').trim()
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Reason is required when machine status is Not Working.'
                })
            }

            const reason = notWorking
                ? String(statusReason).trim()
                : null

            await client.query('BEGIN')
            transactionStarted = true

            await client.query(`
                UPDATE "Machines"
                SET
                    "MachineTypeId" = $1,
                    "GameId" = $2,
                    "StatusId" = $3,
                    "StatusReason" = $4,
                    "UpdatedBy" = $5,
                    "DateUpdated" = NOW()
                WHERE "ID" = $6
            `, [
                newTypeId,
                newGameId,
                newStatusId,
                reason,
                req.authUser.id,
                machineId
            ])

            if (oldMachine.MachineTypeId !== newTypeId) {
                await logChange(
                    client,
                    machineId,
                    req.authUser.id,
                    'Machine Type Changed',
                    'MachineTypeId',
                    oldMachine.MachineTypeId,
                    newTypeId
                )
            }

            if (oldMachine.GameId !== newGameId) {
                await logChange(
                    client,
                    machineId,
                    req.authUser.id,
                    'Game Changed',
                    'GameId',
                    oldMachine.GameId,
                    newGameId
                )
            }

            if (oldMachine.StatusId !== newStatusId) {
                await logChange(
                    client,
                    machineId,
                    req.authUser.id,
                    'Status Changed',
                    'StatusId',
                    oldMachine.StatusId,
                    newStatusId,
                    reason
                )
            }

            // if (oldMachine.StatusReason !== reason) {
            //     await logChange(
            //         client,
            //         machineId,
            //         req.authUser.id,
            //         'Status Reason Changed',
            //         'StatusReason',
            //         oldMachine.StatusReason,
            //         reason,
            //         reason
            //     )
            // }

            await client.query('COMMIT')
            transactionStarted = false

            return success(
                res,
                null,
                'Machine updated successfully.'
            )

        } catch (error) {
            if (transactionStarted) {
                await client.query('ROLLBACK')
            }

            return errorResponse(res, error)

        } finally {
            client.release()
        }
    }
)

// ============================================================
// MACHINE HISTORY
// ============================================================

router.get(
    '/logs/:machineId',
    requirePermission('machines.read'),
    async (req, res) => {
        try {
            const machineId = Number(req.params.machineId)

            await getMachine(req, machineId)

            const result = await pool.query(`
                SELECT
                    ml."ID",
                    ml."ActionType",
                    ml."FieldName",

                    CASE
                        WHEN ml."FieldName" = 'GameId' THEN
                            COALESCE(oldGame."GameName", '---')

                        WHEN ml."FieldName" = 'MachineTypeId' THEN
                            COALESCE(oldType."TypeName", '---')

                        WHEN ml."FieldName" = 'StatusId' THEN
                            COALESCE(oldStatus."Description", '---')

                        ELSE
                            COALESCE(ml."OldValue", '---')
                    END AS "OldValue",

                    CASE
                        WHEN ml."FieldName" = 'GameId' THEN
                            COALESCE(newGame."GameName", '---')

                        WHEN ml."FieldName" = 'MachineTypeId' THEN
                            COALESCE(newType."TypeName", '---')

                        WHEN ml."FieldName" = 'StatusId' THEN
                            COALESCE(newStatus."Description", '---')

                        ELSE
                            COALESCE(ml."NewValue", '---')
                    END AS "NewValue",

                    ml."Reason",
                    ml."DateCreated",
                    u."Name" AS "ChangedByName"

                FROM "MachineLogs" ml

                LEFT JOIN "Users" u
                    ON u."ID" = ml."ChangedBy"

                -- Game names
                LEFT JOIN "Games" oldGame
                    ON ml."FieldName" = 'GameId'
                    AND NULLIF(ml."OldValue", '')::integer = oldGame."ID"

                LEFT JOIN "Games" newGame
                    ON ml."FieldName" = 'GameId'
                    AND NULLIF(ml."NewValue", '')::integer = newGame."ID"

                -- Machine type names
                LEFT JOIN "MachineTypes" oldType
                    ON ml."FieldName" = 'MachineTypeId'
                    AND NULLIF(ml."OldValue", '')::integer = oldType."ID"

                LEFT JOIN "MachineTypes" newType
                    ON ml."FieldName" = 'MachineTypeId'
                    AND NULLIF(ml."NewValue", '')::integer = newType."ID"

                -- Status names
                LEFT JOIN "MachineStatus" oldStatus
                    ON ml."FieldName" = 'StatusId'
                    AND NULLIF(ml."OldValue", '')::integer = oldStatus."ID"

                LEFT JOIN "MachineStatus" newStatus
                    ON ml."FieldName" = 'StatusId'
                    AND NULLIF(ml."NewValue", '')::integer = newStatus."ID"

                WHERE ml."MachineId" = $1

                ORDER BY ml."DateCreated" DESC
            `, [machineId])

            return success(
                res,
                result.rows,
                'Machine history retrieved successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)// ============================================================
// MACHINE TYPES - GET
// ============================================================

router.get(
    '/types',
    requirePermission('machinetypes.read'),
    async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    "ID",
                    "TypeName",
                    "IsActive",
                    "DateCreated"
                FROM "MachineTypes"
                WHERE "CompanyId" = $1
                ORDER BY "TypeName"
            `, [
                req.authUser.companyId
            ])

            return success(
                res,
                result.rows,
                'Machine types retrieved successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// MACHINE TYPES - CREATE
// ============================================================

router.post(
    '/types',
    requirePermission('machinetypes.create'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const typeName =
                String(req.body.typeName || '').trim()

            if (!typeName) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Machine type name is required.'
                })
            }

            const result = await pool.query(`
                INSERT INTO "MachineTypes"
                (
                    "TypeName",
                    "CompanyId",
                    "IsActive"
                )
                VALUES ($1,$2,true)
                RETURNING *
            `, [
                typeName,
                req.authUser.companyId
            ])

            return success(
                res,
                result.rows[0],
                'Machine type created successfully.'
            )

        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message: 'Machine type already exists.'
                })
            }

            return errorResponse(res, error)
        }
    }
)

// ============================================================
// MACHINE TYPES - UPDATE
// ============================================================

router.put(
    '/types/:id',
    requirePermission('machinetypes.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id)
            const typeName =
                String(req.body.typeName || '').trim()

            const isActive =
                req.body.isActive !== false

            if (!typeName) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Machine type name is required.'
                })
            }

            const result = await pool.query(`
                UPDATE "MachineTypes"
                SET
                    "TypeName" = $1,
                    "IsActive" = $2,
                    "DateUpdated" = NOW()
                WHERE "ID" = $3
                  AND "CompanyId" = $4
                RETURNING *
            `, [
                typeName,
                isActive,
                id,
                req.authUser.companyId
            ])

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Machine type not found.'
                })
            }

            return success(
                res,
                result.rows[0],
                'Machine type updated successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// MACHINE TYPES - DELETE
// ============================================================

router.delete(
    '/types/:id',
    requirePermission('machinetypes.delete'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id)

            const used = await pool.query(`
                SELECT 1
                FROM "Machines" m
                INNER JOIN "Locations" l
                    ON l."ID" = m.locationid
                WHERE m."MachineTypeId" = $1
                  AND l."CompanyId" = $2

                UNION

                SELECT 1
                FROM "Games"
                WHERE "MachineTypeId" = $1
                  AND "CompanyId" = $2

                LIMIT 1
            `, [
                id,
                req.authUser.companyId
            ])

            if (used.rowCount) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Machine type is currently in use and cannot be deleted.'
                })
            }

            const result = await pool.query(`
                DELETE FROM "MachineTypes"
                WHERE "ID" = $1
                  AND "CompanyId" = $2
                RETURNING "ID"
            `, [
                id,
                req.authUser.companyId
            ])

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Machine type not found.'
                })
            }

            return success(
                res,
                null,
                'Machine type deleted successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// GAMES - GET
// ============================================================

router.get(
    '/games',
    requirePermission('games.read'),
    async (req, res) => {
        try {
            const { machineTypeId } = req.query

            const params = [
                req.authUser.companyId
            ]

            let typeFilter = ''

            if (machineTypeId) {
                params.push(Number(machineTypeId))

                typeFilter =
                    `AND g."MachineTypeId" = $2`
            }

            const result = await pool.query(`
                SELECT
                    g."ID",
                    g."GameName",
                    g."MachineTypeId",
                    g."IsActive",
                    mt."TypeName" AS "MachineTypeName"

                FROM "Games" g

                INNER JOIN "MachineTypes" mt
                    ON mt."ID" = g."MachineTypeId"

                WHERE g."CompanyId" = $1
                ${typeFilter}

                ORDER BY g."GameName"
            `, params)

            return success(
                res,
                result.rows,
                'Games retrieved successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// GAMES - CREATE
// ============================================================

router.post(
    '/games',
    requirePermission('games.create'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const gameName =
                String(req.body.gameName || '').trim()

            const machineTypeId =
                Number(req.body.machineTypeId)

            if (!gameName || !machineTypeId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Game name and machine type are required.'
                })
            }

            const typeResult = await pool.query(`
                SELECT "ID"
                FROM "MachineTypes"
                WHERE "ID" = $1
                  AND "CompanyId" = $2
                  AND "IsActive" = true
                LIMIT 1
            `, [
                machineTypeId,
                req.authUser.companyId
            ])

            if (!typeResult.rowCount) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Invalid machine type.'
                })
            }

            const result = await pool.query(`
                INSERT INTO "Games"
                (
                    "GameName",
                    "MachineTypeId",
                    "CompanyId",
                    "IsActive"
                )
                VALUES ($1,$2,$3,true)
                RETURNING *
            `, [
                gameName,
                machineTypeId,
                req.authUser.companyId
            ])

            return success(
                res,
                result.rows[0],
                'Game created successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// GAMES - UPDATE
// ============================================================

router.put(
    '/games/:id',
    requirePermission('games.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id)

            const gameName =
                String(req.body.gameName || '').trim()

            const machineTypeId =
                Number(req.body.machineTypeId)

            const isActive =
                req.body.isActive !== false

            if (!gameName || !machineTypeId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Game name and machine type are required.'
                })
            }

            const typeResult = await pool.query(`
                SELECT "ID"
                FROM "MachineTypes"
                WHERE "ID" = $1
                  AND "CompanyId" = $2
                LIMIT 1
            `, [
                machineTypeId,
                req.authUser.companyId
            ])

            if (!typeResult.rowCount) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Invalid machine type.'
                })
            }

            const assigned = await pool.query(`
                SELECT 1
                FROM "Machines" m
                INNER JOIN "Locations" l
                    ON l."ID" = m.locationid
                WHERE m."GameId" = $1
                  AND l."CompanyId" = $2
                  AND m."MachineTypeId" <> $3
                LIMIT 1
            `, [
                id,
                req.authUser.companyId,
                machineTypeId
            ])

            if (assigned.rowCount) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'This game is assigned to machines of its current type. Change those machine assignments first.'
                })
            }

            const result = await pool.query(`
                UPDATE "Games"
                SET
                    "GameName" = $1,
                    "MachineTypeId" = $2,
                    "IsActive" = $3,
                    "DateUpdated" = NOW()
                WHERE "ID" = $4
                  AND "CompanyId" = $5
                RETURNING *
            `, [
                gameName,
                machineTypeId,
                isActive,
                id,
                req.authUser.companyId
            ])

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Game not found.'
                })
            }

            return success(
                res,
                result.rows[0],
                'Game updated successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

// ============================================================
// GAMES - DELETE
// ============================================================

router.delete(
    '/games/:id',
    requirePermission('games.delete'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id)

            const assigned = await pool.query(`
                SELECT 1
                FROM "Machines" m
                INNER JOIN "Locations" l
                    ON l."ID" = m.locationid
                WHERE m."GameId" = $1
                  AND l."CompanyId" = $2
                LIMIT 1
            `, [
                id,
                req.authUser.companyId
            ])

            if (assigned.rowCount) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Game is currently assigned to a machine. Remove the assignment first.'
                })
            }

            const result = await pool.query(`
                DELETE FROM "Games"
                WHERE "ID" = $1
                  AND "CompanyId" = $2
                RETURNING "ID"
            `, [
                id,
                req.authUser.companyId
            ])

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Game not found.'
                })
            }

            return success(
                res,
                null,
                'Game deleted successfully.'
            )

        } catch (error) {
            return errorResponse(res, error)
        }
    }
)

module.exports = router