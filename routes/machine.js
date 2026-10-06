const express = require('express')
const router = express.Router()
const { pool } = require('../db')

const {
    authenticate,
    requirePermission
} = require('../middleware/auth')

router.use(authenticate)

const role = req =>
    String(req.authUser?.roleName || '').trim().toLowerCase()

const canManage = req =>
    role(req) === 'owner' ||
    role(req) === 'admin' ||
    role(req) === 'system admin'

function requireOwnerOrAdmin(req, res, next) {
    if (!canManage(req)) {
        return res.status(403).json({
            success: false,
            message: 'Owner or Admin access is required.'
        })
    }

    next()
}

async function verifyLocation(req, locationId, client = pool) {
    const result = await client.query(`
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

router.get(
    '/getmachinebynumber',
    requirePermission('machines.read'),
    async (req, res) => {
        try {
            const {
                machinenumber,
                locationid
            } = req.query

            const result =
                await pool.query(
                    `
                    SELECT
                        m."ID"
                            AS id,

                        m."MachineNumber"
                            AS machinenumber,

                        m."locationid"
                            AS "Locationid",

                        mt."TypeName"
                            AS machinetype,

                        ms."Description"
                            AS status

                    FROM "Machines" m

                    INNER JOIN "MachineStatus" ms
                        ON ms."ID" =
                           m."StatusId"

                    LEFT JOIN "MachineTypes" mt
                        ON mt."ID" =
                           m."MachineTypeId"

                    WHERE
                        m."MachineNumber" = $1

                        AND

                        m."locationid" = $2

                    ORDER BY
                        m."MachineNumber" ASC
                    `,
                    [
                        machinenumber,
                        locationid
                    ]
                )

            if (
                result.rows.length > 0
            ) {
                return res.status(200).json({
                    success: true,
                    code: 20000,
                    message:
                        'get successful!',
                    code: 20000,
                    data:
                        result.rows[0],
                })
            }

            return res.status(200).json({
                success: false,
                message:
                    'no machines found.',
                code: 20000,
            })

        } catch (error) {
            console.error(
                'Get machines error:',
                error
            )

            return res.status(500).json({
                success: false,
                message:
                    'Error while getting machines.',
                code: 50000,
            })
        }
    }
)


async function getMachine(req, machineId, client = pool) {
    const result = await client.query(`
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
    client,
    machineId,
    userId,
    actionType,
    fieldName = null,
    oldValue = null,
    newValue = null,
    reason = null
) {
    await client.query(`
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

function errorResponse(res, error) {
    const map = {
        LOCATION_NOT_FOUND: [404, 'Location not found.'],
        LOCATION_FORBIDDEN: [403, 'You cannot access this location.'],
        MACHINE_NOT_FOUND: [404, 'Machine not found.'],
        MACHINE_FORBIDDEN: [403, 'You cannot access this machine.']
    }

    const known = map[error.message]

    if (known) {
        return res.status(known[0]).json({
            success: false,
            code: known[0] * 100,
            message: known[1]
        })
    }

    console.error(error)

    return res.status(500).json({
        success: false,
        code: 50000,
        message: 'Server error.'
    })
}

// ============================================================
// STATUS
// ============================================================

router.get(
    '/statuses',
    requirePermission('machines.read'),
    async (_req, res) => {
        try {
            const result = await pool.query(`
        SELECT "ID", "Description"
        FROM "MachineStatus"
        ORDER BY "ID"
      `)

            res.json({
                success: true,
                code: 20000,
                data: result.rows
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

// ============================================================
// MACHINES LIST
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

            res.json({
                success: true,
                code: 20000,
                data: result.rows
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

// ============================================================
// GENERATE MACHINE RANGE
// ============================================================

router.post(
    '/generate',
    requirePermission('machines.create'),
    requireOwnerOrAdmin,
    async (req, res) => {
        const client = await pool.connect()

        try {
            const {
                locationId,
                startNumber,
                endNumber,
                machineTypeId
            } = req.body

            const start = Number(startNumber)
            const end = Number(endNumber)
            const locId = Number(locationId)

            if (!locId || !start || !end) {
                return res.status(400).json({
                    success: false,
                    message: 'Location, start number and end number are required.'
                })
            }

            if (start < 1 || end < start) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid machine number range.'
                })
            }

            if (end - start > 999) {
                return res.status(400).json({
                    success: false,
                    message: 'Maximum 1000 machines can be generated at one time.'
                })
            }

            const location = await verifyLocation(
                req,
                locId,
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
        `, [
                    Number(machineTypeId),
                    location.CompanyId
                ])

                if (!typeResult.rowCount) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid machine type.'
                    })
                }

                typeId = Number(machineTypeId)
            }

            const workingStatus = await client.query(`
        SELECT "ID"
        FROM "MachineStatus"
        WHERE LOWER("Description") = 'working'
        LIMIT 1
      `)

            if (!workingStatus.rowCount) {
                return res.status(500).json({
                    success: false,
                    message: 'Working machine status has not been configured.'
                })
            }

            await client.query('BEGIN')

            let created = 0
            let skipped = 0

            for (let number = start; number <= end; number++) {
                const existing = await client.query(`
          SELECT "ID"
          FROM "Machines"
          WHERE locationid = $1
            AND "MachineNumber" = $2
        `, [locId, number])

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
                    workingStatus.rows[0].ID,
                    locId,
                    req.authUser.id
                ])

                await logChange(
                    client,
                    insert.rows[0].ID,
                    req.authUser.id,
                    'Machine Created',
                    'MachineNumber',
                    null,
                    number
                )

                if (typeId) {
                    await logChange(
                        client,
                        insert.rows[0].ID,
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

            res.json({
                success: true,
                code: 20000,
                message: `${created} machine(s) created. ${skipped} duplicate machine(s) skipped.`,
                created,
                skipped
            })
        } catch (error) {
            await client.query('ROLLBACK')
            errorResponse(res, error)
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

            let newTypeId =
                machineTypeId != null && machineTypeId !== ''
                    ? Number(machineTypeId)
                    : null

            let newGameId =
                gameId != null && gameId !== ''
                    ? Number(gameId)
                    : null

            const newStatusId =
                statusId != null && statusId !== ''
                    ? Number(statusId)
                    : oldMachine.StatusId

            if (newTypeId) {
                const type = await client.query(`
          SELECT "ID"
          FROM "MachineTypes"
          WHERE "ID" = $1
            AND "CompanyId" = $2
            AND "IsActive" = true
        `, [newTypeId, companyId])

                if (!type.rowCount) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid machine type.'
                    })
                }
            }

            if (newGameId) {
                if (!newTypeId) {
                    return res.status(400).json({
                        success: false,
                        message: 'A machine type is required before assigning a game.'
                    })
                }

                const game = await client.query(`
          SELECT "ID"
          FROM "Games"
          WHERE "ID" = $1
            AND "CompanyId" = $2
            AND "MachineTypeId" = $3
            AND "IsActive" = true
        `, [
                    newGameId,
                    companyId,
                    newTypeId
                ])

                if (!game.rowCount) {
                    return res.status(400).json({
                        success: false,
                        message: 'The selected game does not support this machine type.'
                    })
                }
            }

            // If type changes and old game no longer matches,
            // automatically clear the game.
            if (
                oldMachine.MachineTypeId !== newTypeId &&
                oldMachine.GameId &&
                !newGameId
            ) {
                newGameId = null
            }

            const status = await client.query(`
        SELECT "Description"
        FROM "MachineStatus"
        WHERE "ID" = $1
      `, [newStatusId])

            if (!status.rowCount) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid machine status.'
                })
            }

            const isNotWorking =
                String(status.rows[0].Description)
                    .trim()
                    .toLowerCase() === 'not working'

            if (
                isNotWorking &&
                !String(statusReason || '').trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Reason is required when machine status is Not Working.'
                })
            }

            const reason = isNotWorking
                ? String(statusReason).trim()
                : null

            await client.query('BEGIN')

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

            if (oldMachine.StatusReason !== reason) {
                await logChange(
                    client,
                    machineId,
                    req.authUser.id,
                    'Status Reason Changed',
                    'StatusReason',
                    oldMachine.StatusReason,
                    reason,
                    reason
                )
            }

            await client.query('COMMIT')

            res.json({
                success: true,
                code: 20000,
                message: 'Machine updated successfully.'
            })
        } catch (error) {
            await client.query('ROLLBACK')
            errorResponse(res, error)
        } finally {
            client.release()
        }
    }
)

// ============================================================
// MACHINE LOGS
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
          ml."OldValue",
          ml."NewValue",
          ml."Reason",
          ml."DateCreated",
          u."Name" AS "ChangedByName"
        FROM "MachineLogs" ml
        LEFT JOIN "Users" u
          ON u."ID" = ml."ChangedBy"
        WHERE ml."MachineId" = $1
        ORDER BY ml."DateCreated" DESC
      `, [machineId])

            res.json({
                success: true,
                code: 20000,
                data: result.rows
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

// ============================================================
// MACHINE TYPES
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
      `, [req.authUser.companyId])

            res.json({
                success: true,
                code: 20000,
                data: result.rows
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

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

            res.json({
                success: true,
                code: 20000,
                data: result.rows[0]
            })
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    message: 'Machine type already exists.'
                })
            }

            errorResponse(res, error)
        }
    }
)

router.put(
    '/types/:id',
    requirePermission('machinetypes.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id)
            const typeName = String(req.body.typeName || '').trim()
            const isActive = req.body.isActive !== false

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
                    message: 'Machine type not found.'
                })
            }

            res.json({
                success: true,
                code: 20000,
                data: result.rows[0]
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

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
                    message: 'Machine type is currently in use and cannot be deleted.'
                })
            }

            await pool.query(`
        DELETE FROM "MachineTypes"
        WHERE "ID" = $1
          AND "CompanyId" = $2
      `, [
                id,
                req.authUser.companyId
            ])

            res.json({
                success: true,
                code: 20000,
                message: 'Machine type deleted.'
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

// ============================================================
// GAMES
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

            let filter = ''

            if (machineTypeId) {
                params.push(Number(machineTypeId))
                filter = `AND g."MachineTypeId" = $2`
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
        ${filter}
        ORDER BY g."GameName"
      `, params)

            res.json({
                success: true,
                code: 20000,
                data: result.rows
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

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
                    message: 'Game name and machine type are required.'
                })
            }

            const type = await pool.query(`
        SELECT "ID"
        FROM "MachineTypes"
        WHERE "ID" = $1
          AND "CompanyId" = $2
      `, [
                machineTypeId,
                req.authUser.companyId
            ])

            if (!type.rowCount) {
                return res.status(400).json({
                    success: false,
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

            res.json({
                success: true,
                code: 20000,
                data: result.rows[0]
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

router.put(
    '/games/:id',
    requirePermission('games.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id)
            const gameName = String(req.body.gameName || '').trim()
            const machineTypeId = Number(req.body.machineTypeId)
            const isActive = req.body.isActive !== false

            if (!gameName || !machineTypeId) {
                return res.status(400).json({
                    success: false,
                    message: 'Game name and machine type are required.'
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
                    message: 'This game is assigned to machines of its current type. Change those machine assignments first.'
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
                    message: 'Game not found.'
                })
            }

            res.json({
                success: true,
                code: 20000,
                data: result.rows[0]
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)

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
                    message: 'Game is currently assigned to a machine. Remove the assignment first.'
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
                    message: 'Game not found.'
                })
            }

            res.json({
                success: true,
                code: 20000,
                message: 'Game deleted.'
            })
        } catch (error) {
            errorResponse(res, error)
        }
    }
)


// ============================================================
// INITIAL MACHINE READINGS
// Stored in existing MachineReadings table.
// INITIAL rows have SessionId = NULL and ReadingType = 'INITIAL'.
// ============================================================

router.get(
    '/initial-readings',
    requirePermission('machines.read'),
    async (req, res) => {
        try {
            const locationId =
                Number(req.query.locationid)

            if (!locationId) {
                return res.status(400).json({
                    success: false,
                    message: 'Location is required.'
                })
            }

            await verifyLocation(
                req,
                locationId
            )

            const result =
                await pool.query(
                    `
                    SELECT
                        m."ID",
                        m."MachineNumber",
                        m."StatusId",
                        ms."Description"
                            AS "Status",

                        mr."ID"
                            AS "InitialReadingId",

                        mr."PreviousIn",
                        mr."PreviousOut",
                        mr."CurrentIn",
                        mr."CurrentOut",
                        mr."ReadingAt"

                    FROM
                        "Machines" m

                    LEFT JOIN
                        "MachineStatus" ms

                        ON
                            ms."ID" =
                                m."StatusId"

                    LEFT JOIN
                        "MachineReadings" mr

                        ON
                            mr."MachineId" =
                                m."ID"

                            AND

                            mr."SessionId"
                                IS NULL

                            AND

                            mr."ReadingType" =
                                'INITIAL'

                    WHERE
                        m.locationid = $1

                    ORDER BY
                        m."MachineNumber"
                    `,
                    [
                        locationId
                    ]
                )

            return res.json({
                success: true,
                code: 20000,
                data: result.rows
            })

        } catch (error) {
            errorResponse(
                res,
                error
            )
        }
    }
)

router.put(
    '/initial-readings/:machineId',
    requirePermission('machines.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const machineId =
                Number(req.params.machineId)

            const locationId =
                Number(req.body.locationId)

            const previousIn =
                Number(req.body.previousIn)

            const previousOut =
                Number(req.body.previousOut)

            const currentIn =
                Number(req.body.currentIn)

            const currentOut =
                Number(req.body.currentOut)

            if (
                !machineId ||
                !locationId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Machine and location are required.'
                })
            }

            const readings = [
                previousIn,
                previousOut,
                currentIn,
                currentOut
            ]

            if (
                readings.some(
                    value =>
                        !Number.isFinite(value) ||
                        value < 0
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'All four readings must be valid non-negative numbers.'
                })
            }

            await verifyLocation(
                req,
                locationId,
                client
            )

            const machine =
                await getMachine(
                    req,
                    machineId,
                    client
                )

            if (
                Number(machine.locationid) !==
                locationId
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        'Machine does not belong to this location.'
                })
            }

            await client.query('BEGIN')

            const existing =
                await client.query(
                    `
                    SELECT "ID"
                    FROM "MachineReadings"
                    WHERE
                        "MachineId" = $1
                        AND
                        "SessionId" IS NULL
                        AND
                        "ReadingType" = 'INITIAL'
                    FOR UPDATE
                    `,
                    [
                        machineId
                    ]
                )

            let result

            if (existing.rowCount) {
                result =
                    await client.query(
                        `
                        UPDATE
                            "MachineReadings"

                        SET
                            "PreviousIn" = $1,
                            "PreviousOut" = $2,
                            "CurrentIn" = $3,
                            "CurrentOut" = $4,
                            "ReadingAt" = NOW()

                        WHERE
                            "ID" = $5

                        RETURNING *
                        `,
                        [
                            previousIn,
                            previousOut,
                            currentIn,
                            currentOut,
                            existing.rows[0].ID
                        ]
                    )
            } else {
                result =
                    await client.query(
                        `
                        INSERT INTO
                            "MachineReadings"
                        (
                            "SessionId",
                            "MachineId",
                            "ReadingType",
                            "PreviousIn",
                            "PreviousOut",
                            "CurrentIn",
                            "CurrentOut",
                            "ReadingAt"
                        )
                        VALUES
                        (
                            NULL,
                            $1,
                            'INITIAL',
                            $2,
                            $3,
                            $4,
                            $5,
                            NOW()
                        )
                        RETURNING *
                        `,
                        [
                            machineId,
                            previousIn,
                            previousOut,
                            currentIn,
                            currentOut
                        ]
                    )
            }

            await client.query('COMMIT')

            return res.json({
                success: true,
                code: 20000,
                message:
                    'Initial machine reading saved.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            await client
                .query('ROLLBACK')
                .catch(() => { })

            errorResponse(
                res,
                error
            )
        } finally {
            client.release()
        }
    }
)

router.delete(
    '/initial-readings/:machineId',
    requirePermission('machines.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        try {
            const machineId =
                Number(req.params.machineId)

            const locationId =
                Number(req.query.locationid)

            if (
                !machineId ||
                !locationId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Machine and location are required.'
                })
            }

            await verifyLocation(
                req,
                locationId
            )

            const machine =
                await getMachine(
                    req,
                    machineId
                )

            if (
                Number(machine.locationid) !==
                locationId
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        'Machine does not belong to this location.'
                })
            }

            await pool.query(
                `
                DELETE FROM
                    "MachineReadings"

                WHERE
                    "MachineId" = $1

                    AND

                    "SessionId"
                        IS NULL

                    AND

                    "ReadingType" =
                        'INITIAL'
                `,
                [
                    machineId
                ]
            )

            return res.json({
                success: true,
                code: 20000,
                message:
                    'Initial machine reading reset.'
            })

        } catch (error) {
            errorResponse(
                res,
                error
            )
        }
    }
)

// ============================================================
// SOFT DELETE MACHINE
// "Delete" changes StatusId to configured Inactive status.
// Machine row and all historical references remain intact.
// ============================================================

router.patch(
    '/deactivate/:machineId',
    requirePermission('machines.update'),
    requireOwnerOrAdmin,
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const machineId =
                Number(req.params.machineId)

            const locationId =
                Number(req.body.locationId)

            if (
                !machineId ||
                !locationId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Machine and location are required.'
                })
            }

            await verifyLocation(
                req,
                locationId,
                client
            )

            const machine =
                await getMachine(
                    req,
                    machineId,
                    client
                )

            if (
                Number(machine.locationid) !==
                locationId
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        'Machine does not belong to this location.'
                })
            }

            const inactiveStatus =
                await client.query(
                    `
                    SELECT "ID"
                    FROM "MachineStatus"
                    WHERE
                        LOWER(
                            TRIM("Description")
                        ) = 'inactive'
                    LIMIT 1
                    `
                )

            if (!inactiveStatus.rowCount) {
                return res.status(500).json({
                    success: false,
                    message:
                        'Inactive machine status has not been configured.'
                })
            }

            const inactiveStatusId =
                Number(
                    inactiveStatus.rows[0].ID
                )

            await client.query('BEGIN')

            await client.query(
                `
                UPDATE "Machines"

                SET
                    "StatusId" = $1,
                    "StatusReason" = NULL,
                    "UpdatedBy" = $2,
                    "DateUpdated" = NOW()

                WHERE
                    "ID" = $3
                    AND
                    locationid = $4
                `,
                [
                    inactiveStatusId,
                    req.authUser.id,
                    machineId,
                    locationId
                ]
            )

            if (
                Number(machine.StatusId) !==
                inactiveStatusId
            ) {
                await logChange(
                    client,
                    machineId,
                    req.authUser.id,
                    'Machine Deactivated',
                    'StatusId',
                    machine.StatusId,
                    inactiveStatusId,
                    'Machine Setup delete action'
                )
            }

            await client.query('COMMIT')

            return res.json({
                success: true,
                code: 20000,
                message:
                    'Machine is now inactive.',
                statusId:
                    inactiveStatusId
            })

        } catch (error) {
            await client
                .query('ROLLBACK')
                .catch(() => { })

            errorResponse(
                res,
                error
            )
        } finally {
            client.release()
        }
    }
)

module.exports = router