const express = require('express')
const router = express.Router()

const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')

// ============================================================
// HELPERS
// ============================================================

function success(res, data = null, message = 'Success') {
    return res.status(200).json({
        success: true,
        code: 20000,
        message,
        ...(data !== null ? { data } : {})
    })
}

function errorResponse(
    res,
    status,
    message,
    code = 50000
) {
    return res.status(status).json({
        success: false,
        code,
        message
    })
}

// ============================================================
// EMPLOYEE SESSION COVERAGE
// ============================================================
// Returns completed, unassigned employee sessions plus those already attached
// to this OPEN reading session. The server always rechecks on write.
router.get('/employee-sessions', requirePermission('reading.read'), async (req, res) => {
    try {
        const locationId = Number(req.query.locationid)
        const sessionId = Number(req.query.sessionid)
        if (!Number.isSafeInteger(locationId) || locationId <= 0 ||
            !Number.isSafeInteger(sessionId) || sessionId <= 0) {
            return errorResponse(res, 400, 'Reading session and location are required.', 40000)
        }
        const session = await pool.query(`
            SELECT "ID" FROM "ReadingSessions"
            WHERE "ID"=$1 AND "LocationId"=$2 AND "Status"=1
              AND COALESCE("isDeleted",false)=false`, [sessionId, locationId])
        if (!session.rowCount) return errorResponse(res, 404, 'Open reading session was not found at this location.', 40400)

        const result = await pool.query(`
            SELECT es."ID" AS id, es."UserId" AS "userId",
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS "employeeName",
                   es."ClockIn" AS "clockIn", es."ClockOut" AS "clockOut",
                   es."ReadingSessionId" AS "readingSessionId"
            FROM "EmployeeSession" es
            JOIN "Users" u ON u."ID"=es."UserId"
            WHERE es."LocationId"=$1 AND es."ClockOut" IS NOT NULL
              AND (es."ReadingSessionId" IS NULL OR es."ReadingSessionId"=$2)
            ORDER BY es."ClockOut" DESC, es."ID" DESC`, [locationId, sessionId])
        return success(res, result.rows, 'Eligible employee sessions loaded.')
    } catch (error) {
        console.error('Reading employee coverage lookup:', error)
        return errorResponse(res, 500, 'Unable to load employee sessions.')
    }
})

router.put('/employee-sessions', requirePermission('reading.update'), async (req, res) => {
    const locationId = Number(req.body.locationid)
    const sessionId = Number(req.body.sessionid)
    const ids = req.body.employeesessionids
    if (!Number.isSafeInteger(locationId) || locationId <= 0 ||
        !Number.isSafeInteger(sessionId) || sessionId <= 0 ||
        !Array.isArray(ids) || ids.length === 0 || ids.length > 500 ||
        ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0) ||
        new Set(ids.map(Number)).size !== ids.length) {
        return errorResponse(res, 400, 'Select at least one valid, unique employee session.', 40000)
    }
    const employeeIds = ids.map(Number)
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const reading = await client.query(`
            SELECT "ID" FROM "ReadingSessions"
            WHERE "ID"=$1 AND "LocationId"=$2 AND "Status"=1
              AND COALESCE("isDeleted",false)=false FOR UPDATE`, [sessionId, locationId])
        if (!reading.rowCount) {
            await client.query('ROLLBACK')
            return errorResponse(res, 409, 'Reading session is no longer open.', 40900)
        }
        // Serialize assignment attempts across different open reading sessions.
        const selected = await client.query(`
            SELECT "ID", "ClockOut", "ReadingSessionId" FROM "EmployeeSession"
            WHERE "ID" = ANY($1::bigint[]) AND "LocationId"=$2
            ORDER BY "ID" FOR UPDATE`, [employeeIds, locationId])
        if (selected.rowCount !== employeeIds.length || selected.rows.some(row =>
            row.ClockOut === null || (row.ReadingSessionId !== null && Number(row.ReadingSessionId) !== sessionId))) {
            await client.query('ROLLBACK')
            return errorResponse(res, 409, 'One or more employee sessions are in progress, belong to another location, or were already assigned to another reading session. Refresh and select again.', 40900)
        }
        await client.query(`UPDATE "EmployeeSession" SET "ReadingSessionId"=NULL
            WHERE "ReadingSessionId"=$1 AND "LocationId"=$2
              AND NOT ("ID" = ANY($3::bigint[]))`, [sessionId, locationId, employeeIds])
        const updated = await client.query(`UPDATE "EmployeeSession" SET "ReadingSessionId"=$1
            WHERE "ID" = ANY($2::bigint[]) AND "LocationId"=$3
              AND "ClockOut" IS NOT NULL
              AND ("ReadingSessionId" IS NULL OR "ReadingSessionId"=$1)
            RETURNING "ID" AS id`, [sessionId, employeeIds, locationId])
        if (updated.rowCount !== employeeIds.length) {
            await client.query('ROLLBACK')
            return errorResponse(res, 409, 'Employee sessions changed while saving. Refresh and try again.', 40900)
        }
        await client.query('COMMIT')
        return success(res, { sessionId, employeeSessionIds: employeeIds }, 'Employee session coverage saved.')
    } catch (error) {
        try { await client.query('ROLLBACK') } catch (_) { }
        console.error('Save reading employee coverage:', error)
        return errorResponse(res, 500, 'Unable to save employee session coverage.')
    } finally { client.release() }
})

// ============================================================
// START NEW READING SESSION
// Permission: reading.create
// ============================================================

router.post(
    '/startnewsession',
    requirePermission('reading.create'),
    async (req, res) => {
        try {
            const {
                locationid
            } = req.query

            if (!locationid) {
                return errorResponse(
                    res,
                    400,
                    'Location is required.',
                    40000
                )
            }

            const result = await pool.query(
                `
                INSERT INTO "ReadingSessions"
                (
                    "DateCreated",
                    "StartedAt",
                    "Status",
                    "LocationId",
                    "isDeleted"
                )
                VALUES
                (
                    NOW(),
                    NOW(),
                    1,
                    $1,
                    false
                )
                RETURNING
                    "ID" AS id,
                    "DateCreated" AS datecreated,
                    "StartedAt" AS startedat,
                    "EndedAt" AS endedat,
                    "Status" AS status,
                    "LocationId" AS locationid
                `,
                [
                    locationid
                ]
            )

            const session =
                result.rows[0]

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session created successfully.',
                SessionId: session.id,
                data: session
            })

        } catch (error) {
            console.error(
                'Start reading session error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Error while creating new session.'
            )
        }
    }
)

// ============================================================
// GET ACTIVE READING SESSIONS
// Permission: reading.read
// ============================================================

router.get(
    '/getactivesession',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const {
                locationid
            } = req.query

            if (!locationid) {
                return errorResponse(
                    res,
                    400,
                    'Location is required.',
                    40000
                )
            }

            const result = await pool.query(
                `
                SELECT
                    rs."ID" AS ID,

                    rs."DateCreated" AS datecreated,
                    rs."StartedAt" AS startedat,
                    rs."EndedAt" AS endedat,

                    rs."Status" AS status,
                    rs."LocationId" AS locationid,

                    COUNT(
                        mr."ID"
                    )::integer AS totalcount

                FROM
                    "ReadingSessions" rs

                LEFT JOIN
                    "MachineReadings" mr

                    ON
                        mr."SessionId" =
                            rs."ID"

                WHERE
                    rs."LocationId" = $1

                    AND

                    rs."Status" = 1

                    AND

                    COALESCE(
                        rs."isDeleted",
                        false
                    ) = false

                GROUP BY
                    rs."ID",
                    rs."DateCreated",
                    rs."StartedAt",
                    rs."EndedAt",
                    rs."Status",
                    rs."LocationId"

                ORDER BY
                    rs."StartedAt" DESC,
                    rs."ID" DESC
                `,
                [
                    locationid
                ]
            )

            return success(
                res,
                result.rows,
                'Active sessions loaded successfully.'
            )

        } catch (error) {
            console.error(
                'Get active sessions error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Error while getting active sessions.'
            )
        }
    }
)

// ============================================================
// GET MOST RECENT PREVIOUS MACHINE READING
// Permission: reading.read
//
// Only uses COMPLETED sessions so the value represents the
// last confirmed/finalized reading.
// ============================================================

router.get(
    '/previousreading',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const {
                machineid,
                locationid,
                sessionid
            } = req.query

            if (
                !machineid ||
                !locationid
            ) {
                return errorResponse(
                    res,
                    400,
                    'Machine and location are required.',
                    40000
                )
            }

            const result = await pool.query(
                `
                SELECT
                    mr."ID" AS id,
                    mr."SessionId" AS sessionid,
                    mr."MachineId" AS machineid,

                    m."MachineNumber" AS machinenumber,

                    mr."ReadingType" AS readingtype,
                    mr."CurrentIn" AS currentin,
                    mr."CurrentOut" AS currentout,
                    mr."ReadingAt" AS readingat

                FROM
                    "MachineReadings" mr

                INNER JOIN
                    "ReadingSessions" rs

                    ON
                        rs."ID" =
                            mr."SessionId"

                INNER JOIN
                    "Machines" m

                    ON
                        m."ID" =
                            mr."MachineId"

                WHERE
                    mr."MachineId" = $1

                    AND

                    rs."LocationId" = $2

                    AND

                    rs."Status" = 2

                    AND

                    COALESCE(
                        rs."isDeleted",
                        false
                    ) = false

                    AND
                    (
                        $3::bigint IS NULL

                        OR

                        mr."SessionId" <> $3::bigint
                    )

                ORDER BY
                    mr."ReadingAt" DESC,
                    mr."ID" DESC

                LIMIT 1
                `,
                [
                    machineid,
                    locationid,
                    sessionid || null
                ]
            )

            return success(
                res,
                result.rows[0] || null,
                result.rows.length
                    ? 'Previous reading found.'
                    : 'No previous reading found.'
            )

        } catch (error) {
            console.error(
                'Get previous reading error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Unable to get previous machine reading.'
            )
        }
    }
)

// ============================================================
// SAVE MACHINE READING
// Permission: reading.create
// ============================================================

router.post(
    '/savereading',
    requirePermission('reading.create'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const {
                sessionid,
                machineid,
                readingin,
                readingout,
                locationid
            } = req.body

            if (
                !sessionid ||
                !machineid ||
                !locationid
            ) {
                return errorResponse(
                    res,
                    400,
                    'Session, machine and location are required.',
                    40000
                )
            }

            if (
                readingin === null ||
                readingin === undefined ||
                readingout === null ||
                readingout === undefined
            ) {
                return errorResponse(
                    res,
                    400,
                    'Current IN and Current OUT are required.',
                    40000
                )
            }

            await client.query('BEGIN')

            // --------------------------------------------------------
            // Confirm session is still OPEN
            // --------------------------------------------------------

            const sessionResult =
                await client.query(
                    `
                    SELECT
                        "ID",
                        "Status",
                        "LocationId"

                    FROM
                        "ReadingSessions"

                    WHERE
                        "ID" = $1

                        AND

                        COALESCE(
                            "isDeleted",
                            false
                        ) = false

                    FOR UPDATE
                    `,
                    [
                        sessionid
                    ]
                )

            if (!sessionResult.rows.length) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    404,
                    'Reading session was not found.',
                    40400
                )
            }

            const session =
                sessionResult.rows[0]

            if (
                Number(session.Status) !== 1
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    409,
                    'This session is already closed and cannot be changed.',
                    40900
                )
            }

            if (
                Number(session.LocationId) !==
                Number(locationid)
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    403,
                    'Session does not belong to this location.',
                    40300
                )
            }

            // --------------------------------------------------------
            // Validate machine belongs to this location
            // --------------------------------------------------------

            const machineResult =
                await client.query(
                    `
                    SELECT
                        "ID",
                        "MachineNumber"

                    FROM
                        "Machines"

                    WHERE
                        "ID" = $1

                        AND

                        locationid = $2
                    `,
                    [
                        machineid,
                        locationid
                    ]
                )

            if (!machineResult.rows.length) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    404,
                    'Machine was not found at this location.',
                    40400
                )
            }

            // --------------------------------------------------------
            // Prevent same machine twice inside one session
            // --------------------------------------------------------

            const duplicate =
                await client.query(
                    `
                    SELECT
                        "ID"

                    FROM
                        "MachineReadings"

                    WHERE
                        "SessionId" = $1

                        AND

                        "MachineId" = $2

                    LIMIT 1
                    `,
                    [
                        sessionid,
                        machineid
                    ]
                )

            if (duplicate.rows.length) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    409,
                    'A reading for this machine already exists in this session. Delete it before taking another reading.',
                    40900
                )
            }

            // --------------------------------------------------------
            // Insert reading
            // --------------------------------------------------------

            const result =
                await client.query(
                    `
                    INSERT INTO
                        "MachineReadings"
                    (
                        "SessionId",
                        "MachineId",
                        "ReadingType",
                        "CurrentIn",
                        "CurrentOut",
                        "ReadingAt"
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        'Manual',
                        $3,
                        $4,
                        NOW()
                    )

                    RETURNING
                        "ID" AS id
                    `,
                    [
                        sessionid,
                        machineid,
                        readingin,
                        readingout
                    ]
                )

            await client.query('COMMIT')

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Reading saved successfully.',
                ReadingId: result.rows[0].id,
                data: result.rows[0]
            })

        } catch (error) {
            await client.query('ROLLBACK')

            console.error(
                'Save reading error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Error while saving reading.'
            )

        } finally {
            client.release()
        }
    }
)

// ============================================================
// GET READINGS FOR SESSION
// Permission: reading.read
// ============================================================

router.get(
    '/getreadings',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const {
                sessionid,
                locationid
            } = req.query

            console.log(
                'GET READINGS:',
                {
                    sessionid,
                    locationid
                }
            )

            if (!sessionid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Session ID and Location ID are required.'
                })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        mr."ID" AS id,
                        mr."SessionId" AS sessionid,
                        mr."MachineId" AS machineid,

                        m."MachineNumber" AS machinenumber,

                        mr."ReadingType" AS readingtype,
                        mr."CurrentIn" AS currentin,
                        mr."CurrentOut" AS currentout,
                        mr."ReadingAt" AS readingat

                    FROM "MachineReadings" mr

                    INNER JOIN "ReadingSessions" rs
                        ON rs."ID" = mr."SessionId"

                    INNER JOIN "Machines" m
                        ON m."ID" = mr."MachineId"

                    WHERE
                        mr."SessionId" = $1
                        AND rs."LocationId" = $2
                        AND COALESCE(
                            rs."isDeleted",
                            false
                        ) = false

                    ORDER BY
                        m."MachineNumber" ASC,
                        mr."ReadingAt" ASC
                    `,
                    [
                        Number(sessionid),
                        Number(locationid)
                    ]
                )

            console.log(
                'READINGS FOUND:',
                result.rows.length,
                result.rows
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Session readings loaded successfully.',
                data: result.rows
            })

        } catch (error) {
            console.error(
                'Get session readings error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to load session readings.'
            })
        }
    }
)

// ============================================================
// COMPLETE / CLOSE SESSION
// Permission: reading.update
//
// Status:
// 1 = Open
// 2 = Completed
// ============================================================

router.put(
    '/endsession',
    requirePermission('reading.update'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const {
                sessionid,
                locationid
            } = req.body

            if (
                !sessionid ||
                !locationid
            ) {
                return errorResponse(
                    res,
                    400,
                    'Session and location are required.',
                    40000
                )
            }

            await client.query('BEGIN')

            const sessionResult =
                await client.query(
                    `
                    SELECT
                        "ID",
                        "Status",
                        "LocationId"

                    FROM
                        "ReadingSessions"

                    WHERE
                        "ID" = $1

                        AND

                        COALESCE(
                            "isDeleted",
                            false
                        ) = false

                    FOR UPDATE
                    `,
                    [
                        sessionid
                    ]
                )

            if (!sessionResult.rows.length) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    404,
                    'Reading session was not found.',
                    40400
                )
            }

            const session =
                sessionResult.rows[0]

            if (
                Number(session.LocationId) !==
                Number(locationid)
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    403,
                    'Session does not belong to this location.',
                    40300
                )
            }

            if (
                Number(session.Status) !== 1
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    409,
                    'This session has already been completed.',
                    40900
                )
            }

            const coverageCount = await client.query(`SELECT COUNT(*)::integer AS count
                FROM "EmployeeSession" WHERE "ReadingSessionId"=$1 AND "LocationId"=$2
                  AND "ClockOut" IS NOT NULL`, [sessionid, locationid])
            if (coverageCount.rows[0].count === 0) {
                await client.query('ROLLBACK')
                return errorResponse(res, 409, 'Select at least one completed employee session before closing this reading session.', 40900)
            }

            const countResult =
                await client.query(
                    `
                    SELECT
                        COUNT(*)::integer AS count

                    FROM
                        "MachineReadings"

                    WHERE
                        "SessionId" = $1
                    `,
                    [
                        sessionid
                    ]
                )

            if (
                Number(
                    countResult.rows[0].count
                ) === 0
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    400,
                    'At least one machine reading is required before closing the session.',
                    40000
                )
            }

            const result =
                await client.query(
                    `
                    UPDATE
                        "ReadingSessions"

                    SET
                        "Status" = 2,
                        "EndedAt" = NOW()

                    WHERE
                        "ID" = $1

                    RETURNING
                        "ID" AS id,
                        "StartedAt" AS startedat,
                        "EndedAt" AS endedat,
                        "Status" AS status
                    `,
                    [
                        sessionid
                    ]
                )

            await client.query('COMMIT')

            return success(
                res,
                result.rows[0],
                'Reading session completed successfully.'
            )

        } catch (error) {
            await client.query('ROLLBACK')

            console.error(
                'End session error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Unable to complete reading session.'
            )

        } finally {
            client.release()
        }
    }
)

// ============================================================
// DELETE OPEN READING SESSION
// Permission: reading.delete
// ============================================================

router.delete(
    '/deletesession',
    requirePermission('reading.delete'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const {
                id,
                locationid
            } = req.query

            if (
                !id ||
                !locationid
            ) {
                return errorResponse(
                    res,
                    400,
                    'Session and location are required.',
                    40000
                )
            }

            await client.query('BEGIN')

            const sessionResult =
                await client.query(
                    `
                    SELECT
                        "ID",
                        "Status"

                    FROM
                        "ReadingSessions"

                    WHERE
                        "ID" = $1

                        AND

                        "LocationId" = $2

                        AND

                        COALESCE(
                            "isDeleted",
                            false
                        ) = false

                    FOR UPDATE
                    `,
                    [
                        id,
                        locationid
                    ]
                )

            if (!sessionResult.rows.length) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    404,
                    'Session was not found.',
                    40400
                )
            }

            if (
                Number(
                    sessionResult.rows[0].Status
                ) !== 1
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    409,
                    'Completed sessions cannot be deleted.',
                    40900
                )
            }

            await client.query(`UPDATE "EmployeeSession" SET "ReadingSessionId"=NULL
                WHERE "ReadingSessionId"=$1`, [id])

            await client.query(
                `
                DELETE FROM
                    "MachineReadings"

                WHERE
                    "SessionId" = $1
                `,
                [
                    id
                ]
            )

            await client.query(
                `
                DELETE FROM
                    "ReadingSessions"

                WHERE
                    "ID" = $1
                `,
                [
                    id
                ]
            )

            await client.query('COMMIT')

            return success(
                res,
                {
                    id: Number(id)
                },
                'Session deleted successfully.'
            )

        } catch (error) {
            await client.query('ROLLBACK')

            console.error(
                'Delete session error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Error while deleting session.'
            )

        } finally {
            client.release()
        }
    }
)

// ============================================================
// DELETE MACHINE READING
// Permission: reading.delete
//
// Readings can only be deleted while the session is open.
// ============================================================

router.delete(
    '/deletereading',
    requirePermission('reading.delete'),
    async (req, res) => {
        try {
            const {
                id,
                locationid
            } = req.query

            if (
                !id ||
                !locationid
            ) {
                return errorResponse(
                    res,
                    400,
                    'Reading and location are required.',
                    40000
                )
            }

            const result =
                await pool.query(
                    `
                    DELETE FROM
                        "MachineReadings" mr

                    USING
                        "ReadingSessions" rs

                    WHERE
                        mr."ID" = $1

                        AND

                        mr."SessionId" =
                            rs."ID"

                        AND

                        rs."LocationId" = $2

                        AND

                        rs."Status" = 1

                    RETURNING
                        mr."ID" AS id
                    `,
                    [
                        id,
                        locationid
                    ]
                )

            if (!result.rows.length) {
                return errorResponse(
                    res,
                    409,
                    'Reading was not found or its session has already been closed.',
                    40900
                )
            }

            return success(
                res,
                result.rows[0],
                'Reading deleted successfully.'
            )

        } catch (error) {
            console.error(
                'Delete reading error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Error while deleting reading.'
            )
        }
    }
)

// ============================================================
// GET COMPLETED READING SESSIONS
// ============================================================

router.get(
    '/completedsessions',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const { locationid } = req.query

            if (!locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Location ID is required.'
                })
            }

            const result = await pool.query(
                `
                SELECT
                    rs."ID" AS id,
                    rs."DateCreated" AS datecreated,
                    rs."StartedAt" AS startedat,
                    rs."EndedAt" AS endedat,
                    rs."Status" AS status,
                    rs."LocationId" AS locationid,

                    COUNT(mr."ID")::integer AS totalcount

                FROM "ReadingSessions" rs

                LEFT JOIN "MachineReadings" mr
                    ON mr."SessionId" = rs."ID"

                WHERE
                    rs."LocationId" = $1
                    AND rs."Status" = 2
                    AND COALESCE(
                        rs."isDeleted",
                        false
                    ) = false

                GROUP BY
                    rs."ID",
                    rs."DateCreated",
                    rs."StartedAt",
                    rs."EndedAt",
                    rs."Status",
                    rs."LocationId"

                ORDER BY
                    rs."EndedAt" DESC,
                    rs."ID" DESC
                `,
                [
                    Number(locationid)
                ]
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Completed sessions loaded successfully.',
                data: result.rows
            })

        } catch (error) {
            console.error(
                'Completed reading sessions error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to load completed reading sessions.'
            })
        }
    }
)


// ============================================================
// GET COMPLETED SESSION REPORT
// ============================================================

router.get(
    '/sessionreport',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const {
                sessionid,
                locationid
            } = req.query

            if (!sessionid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Session ID and Location ID are required.'
                })
            }

            // --------------------------------------------------------
            // VERIFY COMPLETED SESSION
            // --------------------------------------------------------

            const sessionResult =
                await pool.query(
                    `
                    SELECT
                        "ID" AS id,
                        "StartedAt" AS startedat,
                        "EndedAt" AS endedat,
                        "Status" AS status,
                        "LocationId" AS locationid

                    FROM "ReadingSessions"

                    WHERE
                        "ID" = $1
                        AND "LocationId" = $2
                        AND "Status" = 2
                        AND COALESCE(
                            "isDeleted",
                            false
                        ) = false

                    LIMIT 1
                    `,
                    [
                        Number(sessionid),
                        Number(locationid)
                    ]
                )

            if (
                sessionResult.rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Completed reading session was not found.'
                })
            }

            // --------------------------------------------------------
            // REPORT
            // --------------------------------------------------------

            const reportResult =
                await pool.query(
                    `
                    SELECT
                        current_reading."ID"
                            AS id,

                        current_reading."SessionId"
                            AS sessionid,

                        current_reading."MachineId"
                            AS machineid,

                        m."MachineNumber"
                            AS machinenumber,
                        mt."ID" AS machinetypeid,
                        COALESCE(NULLIF(BTRIM(mt."TypeName"), ''), 'Unassigned') AS machinetypename,
                        COALESCE(
                            previous_reading.currentin,
                            0
                        ) AS previousin,

                        COALESCE(
                            previous_reading.currentout,
                            0
                        ) AS previousout,

                        current_reading."CurrentIn"
                            AS currentin,

                        current_reading."CurrentOut"
                            AS currentout,

                        current_reading."ReadingAt"
                            AS readingat,
                        (
                            COALESCE(
                                current_reading."CurrentIn",
                                0
                            )
                            -
                            COALESCE(
                                previous_reading.currentin,
                                0
                            )
                        ) AS dailyin,

                        (
                            COALESCE(
                                current_reading."CurrentOut",
                                0
                            )
                            -
                            COALESCE(
                                previous_reading.currentout,
                                0
                            )
                        ) AS dailyout,

                        (
                            (
                                COALESCE(
                                    current_reading."CurrentIn",
                                    0
                                )
                                -
                                COALESCE(
                                    previous_reading.currentin,
                                    0
                                )
                            )
                            -
                            (
                                COALESCE(
                                    current_reading."CurrentOut",
                                    0
                                )
                                -
                                COALESCE(
                                    previous_reading.currentout,
                                    0
                                )
                            )
                        ) AS difference,
                        COALESCE(machine_points.points, 0)::numeric(14,2) AS machinepoints

                    FROM "MachineReadings"
                        current_reading


                    INNER JOIN "Machines" m
                        ON
                            m."ID" =
                            current_reading."MachineId"


                    -- Resolve the machine type for this machine. The JSON access
                    -- accommodates MachineTypeId / TypeId naming variations.
                    LEFT JOIN "MachineTypes" mt
                        ON mt."ID" = COALESCE(
                            NULLIF(to_jsonb(m)->>'MachineTypeId', '')::integer,
                            NULLIF(to_jsonb(m)->>'TypeId', '')::integer,
                            NULLIF(to_jsonb(m)->>'machinetypeid', '')::integer,
                            NULLIF(to_jsonb(m)->>'typeid', '')::integer
                        )

                    INNER JOIN "ReadingSessions"
                        current_session
                        ON
                            current_session."ID" =
                            current_reading."SessionId"
                  
                    -- Count each customer point assignment at most once, even if
                    -- an employee has more than one covered work session.
                    -- The linked session IDs, not the reading session's start/end,
                    -- define the exact employee shifts included in the report.
                    LEFT JOIN LATERAL (
                        SELECT COALESCE(SUM(cm."Points"),0) AS points
                        FROM "CustomerMatch" cm
                        WHERE cm."MachineId" = current_reading."MachineId"
                          AND cm."LocationId" = current_session."LocationId"
                          AND EXISTS (
                              SELECT 1 FROM "EmployeeSession" es
                              WHERE es."ReadingSessionId" = current_reading."SessionId"
                                AND es."LocationId" = current_session."LocationId"
                                AND es."UserId" = cm."AssignedBy"
                                AND es."ClockOut" IS NOT NULL
                                AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                                AND cm."DateAssign" <= (es."ClockOut" AT TIME ZONE 'America/Chicago')
                          )
                    ) machine_points ON TRUE

                    LEFT JOIN LATERAL (
                        SELECT
                            previous_mr."CurrentIn"
                                AS currentin,

                            previous_mr."CurrentOut"
                                AS currentout,

                            previous_mr."ReadingAt"
                                AS readingat

                        FROM "MachineReadings"
                            previous_mr

                        INNER JOIN "ReadingSessions"
                            previous_session
                            ON
                                previous_session."ID" =
                                previous_mr."SessionId"

                        WHERE
                            previous_mr."MachineId" =
                                current_reading."MachineId"

                            AND
                            previous_mr."SessionId" <>
                                current_reading."SessionId"

                            AND
                            previous_mr."ReadingAt" <
                                current_reading."ReadingAt"

                            AND
                            previous_session."Status" = 2

                            AND
                            COALESCE(
                                previous_session."isDeleted",
                                false
                            ) = false

                        ORDER BY
                            previous_mr."ReadingAt" DESC,
                            previous_mr."ID" DESC

                        LIMIT 1

                    ) previous_reading
                        ON true


                    WHERE
                        current_reading."SessionId" = $1

                        AND
                        current_session."LocationId" = $2

                        AND
                        current_session."Status" = 2

                        AND
                        COALESCE(
                            current_session."isDeleted",
                            false
                        ) = false


                    ORDER BY
                        m."MachineNumber" ASC
                    `,
                    [
                        Number(sessionid),
                        Number(locationid)
                    ]
                )


            // Employee-specific point totals use the same local-time window as
            // the existing machine-points calculation and employee finance.
            // LATERAL aggregation avoids duplicating employee session rows.
            const coveredEmployees = await pool.query(`
                SELECT
                    es."ID" AS id,
                    es."UserId" AS "userId",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    COALESCE(points."totalPoints", 0)::numeric(14,2) AS "sessionPoints",
                    COALESCE(points."assignmentCount", 0)::integer AS "assignmentCount"
                FROM "EmployeeSession" es
                JOIN "Users" u ON u."ID" = es."UserId"
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(cm."Points"), 0) AS "totalPoints",
                        COUNT(cm."ID") AS "assignmentCount"
                    FROM "CustomerMatch" cm
                    WHERE cm."AssignedBy" = es."UserId"
                      AND cm."LocationId" = es."LocationId"
                      AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                      AND cm."DateAssign" <= (es."ClockOut" AT TIME ZONE 'America/Chicago')
                ) points ON TRUE
                WHERE es."ReadingSessionId" = $1
                  AND es."LocationId" = $2
                  AND es."ClockOut" IS NOT NULL
                ORDER BY es."ClockIn", es."ID"
            `, [Number(sessionid), Number(locationid)])

            // --------------------------------------------------------
            // RESPONSE
            // --------------------------------------------------------

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Reading report loaded successfully.',

                data: {
                    session:
                        sessionResult.rows[0],

                    readings:
                        reportResult.rows,
                    employeeSessions: coveredEmployees.rows
                }
            })

        } catch (error) {
            console.error(
                'Reading report error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to load reading report.'
            })
        }
    }
)
module.exports = router