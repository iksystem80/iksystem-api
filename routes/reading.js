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
                    source.id,
                    source.sessionid,
                    source.machineid,
                    source.machinenumber,
                    source.readingtype,
                    source.previousin,
                    source.previousout,
                    source.currentin,
                    source.currentout,
                    source.readingat

                FROM
                (
                    -- Most recent completed normal reading.
                    SELECT
                        mr."ID" AS id,
                        mr."SessionId" AS sessionid,
                        mr."MachineId" AS machineid,
                        m."MachineNumber" AS machinenumber,
                        mr."ReadingType" AS readingtype,
                        mr."PreviousIn" AS previousin,
                        mr."PreviousOut" AS previousout,
                        mr."CurrentIn" AS currentin,
                        mr."CurrentOut" AS currentout,
                        mr."ReadingAt" AS readingat,
                        1 AS sourcepriority

                    FROM "MachineReadings" mr

                    INNER JOIN "ReadingSessions" rs
                        ON rs."ID" = mr."SessionId"

                    INNER JOIN "Machines" m
                        ON m."ID" = mr."MachineId"

                    WHERE
                        mr."MachineId" = $1
                        AND rs."LocationId" = $2
                        AND rs."Status" = 3
                        AND COALESCE(rs."isDeleted", false) = false
                        AND ($3::bigint IS NULL OR mr."SessionId" <> $3::bigint)
                        AND mr."ReadingType" <> 'INITIAL'

                    UNION ALL

                    -- Setup baseline used only when no completed reading exists.
                    SELECT
                        mr."ID" AS id,
                        NULL::bigint AS sessionid,
                        mr."MachineId" AS machineid,
                        m."MachineNumber" AS machinenumber,
                        mr."ReadingType" AS readingtype,
                        mr."PreviousIn" AS previousin,
                        mr."PreviousOut" AS previousout,
                        mr."CurrentIn" AS currentin,
                        mr."CurrentOut" AS currentout,
                        mr."ReadingAt" AS readingat,
                        0 AS sourcepriority

                    FROM "MachineReadings" mr

                    INNER JOIN "Machines" m
                        ON m."ID" = mr."MachineId"

                    WHERE
                        mr."MachineId" = $1
                        AND m.locationid = $2
                        AND mr."SessionId" IS NULL
                        AND mr."ReadingType" = 'INITIAL'
                ) source

                ORDER BY
                    source.sourcepriority DESC,
                    source.readingat DESC,
                    source.id DESC

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
                previousin,
                previousout,
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

            if (
                (previousin === null || previousin === undefined) !==
                (previousout === null || previousout === undefined)
            ) {
                return errorResponse(
                    res,
                    400,
                    'Previous IN and Previous OUT must both be provided or both be empty.',
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
            // Resolve canonical Previous IN / OUT
            //
            // Completed readings have priority. INITIAL is only the
            // baseline when no completed reading exists yet.
            // --------------------------------------------------------

            const previousResult =
                await client.query(
                    `
                    SELECT
                        source.currentin,
                        source.currentout

                    FROM
                    (
                        SELECT
                            mr."CurrentIn" AS currentin,
                            mr."CurrentOut" AS currentout,
                            mr."ReadingAt" AS readingat,
                            mr."ID" AS sourceid,
                            1 AS sourcepriority

                        FROM "MachineReadings" mr

                        INNER JOIN "ReadingSessions" rs
                            ON rs."ID" = mr."SessionId"

                        WHERE
                            mr."MachineId" = $1
                            AND rs."LocationId" = $2
                            AND rs."Status" = 3
                            AND COALESCE(rs."isDeleted", false) = false
                            AND mr."SessionId" <> $3
                            AND mr."ReadingType" <> 'INITIAL'

                        UNION ALL

                        SELECT
                            mr."CurrentIn" AS currentin,
                            mr."CurrentOut" AS currentout,
                            mr."ReadingAt" AS readingat,
                            mr."ID" AS sourceid,
                            0 AS sourcepriority

                        FROM "MachineReadings" mr

                        WHERE
                            mr."MachineId" = $1
                            AND mr."SessionId" IS NULL
                            AND mr."ReadingType" = 'INITIAL'
                    ) source

                    ORDER BY
                        source.sourcepriority DESC,
                        source.readingat DESC,
                        source.sourceid DESC

                    LIMIT 1
                    `,
                    [
                        machineid,
                        locationid,
                        sessionid
                    ]
                )

            const canonicalPreviousIn =
                previousResult.rows.length
                    ? previousResult.rows[0].currentin
                    : null

            const canonicalPreviousOut =
                previousResult.rows.length
                    ? previousResult.rows[0].currentout
                    : null

            // Client displays/sends the same baseline. Reject a stale
            // screen if another completed reading changed the baseline.
            if (
                previousResult.rows.length &&
                (
                    Number(previousin) !== Number(canonicalPreviousIn) ||
                    Number(previousout) !== Number(canonicalPreviousOut)
                )
            ) {
                await client.query('ROLLBACK')

                return errorResponse(
                    res,
                    409,
                    'Previous reading changed. Reload this machine before saving.',
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
                        "PreviousIn",
                        "PreviousOut",
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
                        $5,
                        $6,
                        NOW()
                    )

                    RETURNING
                        "ID" AS id
                    `,
                    [
                        sessionid,
                        machineid,
                        canonicalPreviousIn,
                        canonicalPreviousOut,
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
                        mr."PreviousIn" AS previousin,
                        mr."PreviousOut" AS previousout,
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
// 1 = IN_PROGRESS
// 2 = RECONCILE
// 3 = COMPLETED
// ============================================================

router.put(
    '/endsession',
    requirePermission('reading.update'),
    async (req, res) => {
        const client = await pool.connect()

        try {
            const {
                sessionid,
                locationid
            } = req.body

            if (!sessionid || !locationid) {
                return errorResponse(
                    res,
                    400,
                    'Session and location are required.',
                    40000
                )
            }

            await client.query('BEGIN')

            const sessionResult = await client.query(
                `
                SELECT
                    "ID",
                    "Status",
                    "LocationId"

                FROM "ReadingSessions"

                WHERE
                    "ID" = $1
                    AND COALESCE("isDeleted", false) = false

                FOR UPDATE
                `,
                [sessionid]
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

            const session = sessionResult.rows[0]

            if (Number(session.LocationId) !== Number(locationid)) {
                await client.query('ROLLBACK')
                return errorResponse(
                    res,
                    403,
                    'Session does not belong to this location.',
                    40300
                )
            }

            const status = Number(session.Status)

            if (status === 3) {
                await client.query('ROLLBACK')
                return errorResponse(
                    res,
                    409,
                    'This reading session has already been completed.',
                    40900
                )
            }

            // Every linked employee session must be closed before either
            // entering reconciliation or completing reconciliation.
            const coverage = await client.query(
                `
                SELECT
                    COUNT(*)::integer AS total,
                    COUNT(*) FILTER (WHERE "ClockOut" IS NULL)::integer AS open
                FROM "EmployeeSession"
                WHERE "ReadingSessionId" = $1
                  AND "LocationId" = $2
                `,
                [sessionid, locationid]
            )

            const totalLinked = Number(coverage.rows[0]?.total || 0)
            const openLinked = Number(coverage.rows[0]?.open || 0)

            if (totalLinked === 0) {
                await client.query('ROLLBACK')
                return errorResponse(
                    res,
                    409,
                    'Select at least one completed employee session before reconciling this reading session.',
                    40900
                )
            }

            if (openLinked > 0) {
                await client.query('ROLLBACK')
                return errorResponse(
                    res,
                    409,
                    'Cannot reconcile this reading session because one or more linked employee sessions are still open.',
                    40900
                )
            }

            if (status === 1) {
                const countResult = await client.query(
                    `
                    SELECT COUNT(*)::integer AS count
                    FROM "MachineReadings"
                    WHERE "SessionId" = $1
                    `,
                    [sessionid]
                )

                if (Number(countResult.rows[0].count) === 0) {
                    await client.query('ROLLBACK')
                    return errorResponse(
                        res,
                        400,
                        'At least one machine reading is required before reconciliation.',
                        40000
                    )
                }

                const result = await client.query(
                    `
                    UPDATE "ReadingSessions"
                    SET
                        "Status" = 2,
                        "EndedAt" = NOW()
                    WHERE "ID" = $1
                    RETURNING
                        "ID" AS id,
                        "StartedAt" AS startedat,
                        "EndedAt" AS endedat,
                        "Status" AS status
                    `,
                    [sessionid]
                )

                await client.query('COMMIT')

                return success(
                    res,
                    result.rows[0],
                    'Reading session moved to reconciliation successfully.'
                )
            }

            // Status 2 -> 3: reconciliation is confirmed and locked.
            const result = await client.query(
                `
                UPDATE "ReadingSessions"
                SET "Status" = 3
                WHERE "ID" = $1
                RETURNING
                    "ID" AS id,
                    "StartedAt" AS startedat,
                    "EndedAt" AS endedat,
                    "Status" AS status
                `,
                [sessionid]
            )

            await client.query('COMMIT')

            return success(
                res,
                result.rows[0],
                'Reading reconciliation completed successfully.'
            )

        } catch (error) {
            try { await client.query('ROLLBACK') } catch (_) { }

            console.error(
                'End / reconcile reading session error:',
                error
            )

            return errorResponse(
                res,
                500,
                'Unable to update reading session status.'
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
// GET RECONCILIATION / COMPLETED READING SESSIONS
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
                    AND rs."Status" IN (2, 3)
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
                message: 'Reading sessions loaded successfully.',
                data: result.rows
            })

        } catch (error) {
            console.error(
                'Reading sessions list error:',
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
// GET RECONCILIATION / COMPLETED SESSION REPORT
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
                        AND "Status" IN (2, 3)
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
                            current_reading."PreviousIn",
                            0
                        ) AS previousin,

                        COALESCE(
                            current_reading."PreviousOut",
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
                                current_reading."PreviousIn",
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
                                current_reading."PreviousOut",
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
                                    current_reading."PreviousIn",
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
                                    current_reading."PreviousOut",
                                    0
                                )
                            )
                        ) AS difference,
                        COALESCE(machine_points.points, 0)::numeric(14,2) AS machinepoints,
                        COALESCE(ticket_outs.amount, 0)::numeric(14,2) AS ticketout,
                        COALESCE(ticket_outs."ticketCount", 0)::integer AS ticketcount,
                        COALESCE(ticket_outs."employeeNames", '') AS ticketemployees

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

                    -- Ticket Out paid during covered employee sessions for this
                    -- exact machine. Ticket Outs from machines not included in
                    -- this Reading Session are intentionally excluded.
                    LEFT JOIN LATERAL (
                        SELECT
                            COALESCE(SUM(t."Amount"), 0) AS amount,
                            COUNT(t."ID")::integer AS "ticketCount",
                            STRING_AGG(
                                DISTINCT COALESCE(
                                    NULLIF(BTRIM(u."Name"), ''),
                                    u."Username",
                                    'Employee'
                                ),
                                ' · '
                                ORDER BY COALESCE(
                                    NULLIF(BTRIM(u."Name"), ''),
                                    u."Username",
                                    'Employee'
                                )
                            ) AS "employeeNames"
                        FROM "TicketOuts" t
                        INNER JOIN "EmployeeSession" es
                            ON es."ID" = t."EmployeeSessionId"
                        INNER JOIN "Users" u
                            ON u."ID" = es."UserId"
                        WHERE t."MachineId" = current_reading."MachineId"
                          AND t."LocationId" = current_session."LocationId"
                          AND es."ReadingSessionId" = current_reading."SessionId"
                          AND es."LocationId" = current_session."LocationId"
                          AND es."ClockOut" IS NOT NULL
                    ) ticket_outs ON TRUE

                    WHERE
                        current_reading."SessionId" = $1

                        AND
                        current_reading."ReadingType" <> 'INITIAL'

                        AND
                        current_session."LocationId" = $2

                        AND
                        current_session."Status" IN (2, 3)

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
                    COALESCE(points."assignmentCount", 0)::integer AS "assignmentCount",
                    COALESCE(covered_points."coveredPoints", 0)::numeric(14,2) AS "coveredPoints",
                    COALESCE(pulls."totalPull", 0)::numeric(14,2) AS "totalPull"
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
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(cm."Points"), 0) AS "coveredPoints"
                    FROM "CustomerMatch" cm
                    WHERE cm."AssignedBy" = es."UserId"
                      AND cm."LocationId" = es."LocationId"
                      AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                      AND cm."DateAssign" <= (es."ClockOut" AT TIME ZONE 'America/Chicago')
                      AND EXISTS (
                          SELECT 1
                          FROM "MachineReadings" mr
                          WHERE mr."SessionId" = es."ReadingSessionId"
                            AND mr."MachineId" = cm."MachineId"
                      )
                ) covered_points ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(t."Amount"), 0) AS "totalPull"
                    FROM "SessionCashTransactions" t
                    JOIN "CreditTypes" ct
                      ON ct."ID" = t."CreditTypeId"
                     AND ct."LocationId" = t."LocationId"
                    WHERE t."SessionId" = es."ID"
                      AND t."LocationId" = es."LocationId"
                      AND t."Type" = 'CASH_RECEIVED'
                      AND ct."Code" = 'PULL'
                ) pulls ON TRUE
                WHERE es."ReadingSessionId" = $1
                  AND es."LocationId" = $2
                  AND es."ClockOut" IS NOT NULL
                ORDER BY es."ClockIn", es."ID"
            `, [Number(sessionid), Number(locationid)])


            // Total PULL is the physical cash already removed from machines during
            // the employee sessions linked to this reading session.
            // CreditTypes.Code is the stable identifier; display text is never used.
            const pullResult = await pool.query(`
                SELECT
                    COALESCE(SUM(t."Amount"), 0)::numeric(14,2) AS "totalPull"
                FROM "EmployeeSession" es
                JOIN "SessionCashTransactions" t
                  ON t."SessionId" = es."ID"
                 AND t."LocationId" = es."LocationId"
                JOIN "CreditTypes" ct
                  ON ct."ID" = t."CreditTypeId"
                 AND ct."LocationId" = t."LocationId"
                WHERE es."ReadingSessionId" = $1
                  AND es."LocationId" = $2
                  AND es."ClockOut" IS NOT NULL
                  AND t."Type" = 'CASH_RECEIVED'
                  AND ct."Code" = 'PULL'
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
                    employeeSessions: coveredEmployees.rows,
                    reconciliation: {
                        totalPull: Number(pullResult.rows[0]?.totalPull || 0)
                    }
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

// ============================================================
// WEEKLY REPORT
// Current/selected week is always Monday through Sunday.
// Day availability is driven by completed/reconciliation reading sessions.
// ============================================================

function weeklyReportDate(value) {
    const text = String(value || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
    const date = new Date(`${text}T00:00:00Z`)
    return Number.isNaN(date.getTime()) ? null : date
}

function weeklyReportNumber(value) {
    const number = Number(value || 0)
    return Number.isFinite(number) ? number : 0
}

router.get(
    '/weeklyreport/week',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const locationId = Number(req.query.locationid)
            const startText = String(req.query.startdate || '').trim()
            const endText = String(req.query.enddate || '').trim()
            const start = weeklyReportDate(startText)
            const end = weeklyReportDate(endText)

            if (!Number.isSafeInteger(locationId) || locationId <= 0 || !start || !end) {
                return errorResponse(res, 400, 'Location and a valid Monday-Sunday week are required.', 40000)
            }

            const days = Math.round((end.getTime() - start.getTime()) / 86400000)
            if (days !== 6 || start.getUTCDay() !== 1 || end.getUTCDay() !== 0) {
                return errorResponse(res, 400, 'Weekly Report must use a Monday through Sunday date range.', 40000)
            }

            const result = await pool.query(`
                SELECT
                    TO_CHAR(d.day_date::date, 'YYYY-MM-DD') AS date,
                    TO_CHAR(d.day_date, 'Dy') AS day,
                    COALESCE(
                        JSONB_AGG(
                            JSONB_BUILD_OBJECT(
                                'id', sessions.id,
                                'startedAt', sessions.startedat,
                                'endedAt', sessions.endedat,
                                'status', sessions.status,
                                'readingCount', sessions.readingcount
                            )
                            ORDER BY sessions.endedat DESC NULLS LAST, sessions.id DESC
                        ) FILTER (WHERE sessions.id IS NOT NULL),
                        '[]'::jsonb
                    ) AS sessions
                FROM GENERATE_SERIES($2::date, $3::date, INTERVAL '1 day') AS d(day_date)
                LEFT JOIN LATERAL (
                    SELECT
                        rs."ID" AS id,
                        rs."StartedAt" AS startedat,
                        rs."EndedAt" AS endedat,
                        rs."Status" AS status,
                        COUNT(mr."ID")::integer AS readingcount
                    FROM "ReadingSessions" rs
                    INNER JOIN "MachineReadings" mr
                        ON mr."SessionId" = rs."ID"
                       AND mr."ReadingType" <> 'INITIAL'
                    WHERE rs."LocationId" = $1
                      AND rs."Status" IN (2, 3)
                      AND COALESCE(rs."isDeleted", false) = false
                      AND (COALESCE(rs."EndedAt", rs."StartedAt") AT TIME ZONE 'America/Chicago')::date = d.day_date::date
                    GROUP BY rs."ID", rs."StartedAt", rs."EndedAt", rs."Status"
                    ORDER BY rs."EndedAt" DESC NULLS LAST, rs."ID" DESC
                ) sessions ON TRUE
                GROUP BY d.day_date
                ORDER BY d.day_date
            `, [locationId, startText, endText])

            return success(res, {
                startDate: startText,
                endDate: endText,
                days: result.rows
            }, 'Weekly Report days loaded successfully.')
        } catch (error) {
            console.error('Weekly Report week error:', error)
            return errorResponse(res, 500, 'Unable to load Weekly Report days.')
        }
    }
)

router.get(
    '/weeklyreport/day',
    requirePermission('reading.read'),
    async (req, res) => {
        try {
            const locationId = Number(req.query.locationid)
            const sessionId = Number(req.query.sessionid)

            if (!Number.isSafeInteger(locationId) || locationId <= 0 ||
                !Number.isSafeInteger(sessionId) || sessionId <= 0) {
                return errorResponse(res, 400, 'Location and Reading Session are required.', 40000)
            }

            const sessionResult = await pool.query(`
                SELECT
                    rs."ID" AS id,
                    rs."StartedAt" AS "startedAt",
                    rs."EndedAt" AS "endedAt",
                    rs."Status" AS status,
                    (COALESCE(rs."EndedAt", rs."StartedAt") AT TIME ZONE 'America/Chicago')::date::text AS date
                FROM "ReadingSessions" rs
                WHERE rs."ID"=$1
                  AND rs."LocationId"=$2
                  AND rs."Status" IN (2,3)
                  AND COALESCE(rs."isDeleted",false)=false
                  AND EXISTS (
                      SELECT 1
                      FROM "MachineReadings" mr
                      WHERE mr."SessionId"=rs."ID"
                        AND mr."ReadingType" <> 'INITIAL'
                  )
                LIMIT 1
            `, [sessionId, locationId])

            if (!sessionResult.rowCount) {
                return errorResponse(res, 404, 'Reading Session was not found for this location.', 40400)
            }

            const session = sessionResult.rows[0]

            const readingsResult = await pool.query(`
                SELECT
                    mr."ID" AS id,
                    mr."MachineId" AS machineid,
                    m."MachineNumber" AS machinenumber,
                    COALESCE(NULLIF(BTRIM(mt."TypeName"),''),'Unassigned') AS machinetypename,
                    COALESCE(mr."PreviousIn",0)::numeric AS previousin,
                    COALESCE(mr."PreviousOut",0)::numeric AS previousout,
                    COALESCE(mr."CurrentIn",0)::numeric AS currentin,
                    COALESCE(mr."CurrentOut",0)::numeric AS currentout,
                    (COALESCE(mr."CurrentIn",0)-COALESCE(mr."PreviousIn",0))::numeric AS dailyin,
                    (COALESCE(mr."CurrentOut",0)-COALESCE(mr."PreviousOut",0))::numeric AS dailyout,
                    ((COALESCE(mr."CurrentIn",0)-COALESCE(mr."PreviousIn",0))
                     -(COALESCE(mr."CurrentOut",0)-COALESCE(mr."PreviousOut",0)))::numeric AS difference,
                    COALESCE(points.amount,0)::numeric(14,2) AS points,
                    COALESCE(ticket_outs.amount,0)::numeric(14,2) AS ticketout,
                    COALESCE(ticket_outs."ticketCount",0)::integer AS ticketcount,
                    COALESCE(ticket_outs."employeeNames",'') AS ticketemployees,
                    (((COALESCE(mr."CurrentIn",0)-COALESCE(mr."PreviousIn",0))
                      -(COALESCE(mr."CurrentOut",0)-COALESCE(mr."PreviousOut",0)))
                      -COALESCE(points.amount,0))::numeric(14,2) AS net,
                    mr."ReadingAt" AS readingat
                FROM "MachineReadings" mr
                INNER JOIN "Machines" m ON m."ID"=mr."MachineId"
                LEFT JOIN "MachineTypes" mt ON mt."ID"=m."MachineTypeId"
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(cm."Points"),0) AS amount
                    FROM "CustomerMatch" cm
                    INNER JOIN "EmployeeSession" es ON es."ID"=cm."EmployeeSessionId"
                    WHERE es."ReadingSessionId"=$1
                      AND es."LocationId"=$2
                      AND cm."MachineId"=mr."MachineId"
                ) points ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(t."Amount"),0) AS amount,
                        COUNT(t."ID")::integer AS "ticketCount",
                        STRING_AGG(
                            DISTINCT COALESCE(
                                NULLIF(BTRIM(u."Name"),''),
                                u."Username",
                                'Employee'
                            ),
                            ' · '
                            ORDER BY COALESCE(
                                NULLIF(BTRIM(u."Name"),''),
                                u."Username",
                                'Employee'
                            )
                        ) AS "employeeNames"
                    FROM "TicketOuts" t
                    INNER JOIN "EmployeeSession" es ON es."ID"=t."EmployeeSessionId"
                    INNER JOIN "Users" u ON u."ID"=es."UserId"
                    WHERE t."MachineId"=mr."MachineId"
                      AND t."LocationId"=$2
                      AND es."ReadingSessionId"=$1
                      AND es."LocationId"=$2
                      AND es."ClockOut" IS NOT NULL
                ) ticket_outs ON TRUE
                WHERE mr."SessionId"=$1
                  AND mr."ReadingType" <> 'INITIAL'
                ORDER BY m."MachineNumber", mr."ID"
            `, [sessionId, locationId])

            const expenseResult = await pool.query(`
                WITH covered AS (
                    SELECT "ID"
                    FROM "EmployeeSession"
                    WHERE "ReadingSessionId"=$1
                      AND "LocationId"=$2
                      AND "ClockOut" IS NOT NULL
                ), expense_rows AS (
                    SELECT
                        COALESCE(NULLIF(BTRIM(et."Name"),''),'Expense') AS category,
                        SUM(t."Amount")::numeric(14,2) AS amount
                    FROM "SessionCashTransactions" t
                    INNER JOIN covered c ON c."ID"=t."SessionId"
                    LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                    WHERE t."LocationId"=$2
                      AND t."Type"='EXPENSE'
                    GROUP BY COALESCE(NULLIF(BTRIM(et."Name"),''),'Expense')

                    UNION ALL

                    SELECT
                        COALESCE(NULLIF(BTRIM(et."Name"),''),'Expense') AS category,
                        SUM(t."Amount")::numeric(14,2) AS amount
                    FROM "ReadingSessionCashTransactions" t
                    LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                    WHERE t."ReadingSessionId"=$1
                      AND t."LocationId"=$2
                      AND t."Type"='EXPENSE'
                    GROUP BY COALESCE(NULLIF(BTRIM(et."Name"),''),'Expense')

                    UNION ALL

                    SELECT
                        CASE WHEN COALESCE(cm."IsExtraMatch",false)
                             THEN 'Extra Match' ELSE 'Match Point' END AS category,
                        SUM(COALESCE(cm."Points",0))::numeric(14,2) AS amount
                    FROM "CustomerMatch" cm
                    INNER JOIN covered c ON c."ID"=cm."EmployeeSessionId"
                    GROUP BY CASE WHEN COALESCE(cm."IsExtraMatch",false)
                                  THEN 'Extra Match' ELSE 'Match Point' END

                    UNION ALL

                    SELECT 'Raffle' AS category,
                           SUM(COALESCE(r."WinningAmount",0))::numeric(14,2) AS amount
                    FROM "Raffles" r
                    INNER JOIN covered c ON c."ID"=r."EmployeeSessionId"
                    WHERE r."Status"='WINNER'

                    UNION ALL

                    SELECT 'Bonus' AS category,
                           SUM(COALESCE(ba."Amount",0))::numeric(14,2) AS amount
                    FROM "BonusAwards" ba
                    INNER JOIN covered c ON c."ID"=ba."EmployeeSessionId"
                )
                SELECT category, SUM(COALESCE(amount,0))::numeric(14,2) AS amount
                FROM expense_rows
                WHERE COALESCE(amount,0) <> 0
                GROUP BY category
                ORDER BY category
            `, [sessionId, locationId])

            const employeeResult = await pool.query(`
                SELECT
                    es."ID" AS id,
                    es."UserId" AS "userId",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS name,
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    COALESCE(cash.opening,0)::numeric(14,2) AS opening,
                    COALESCE(cash.received,0)::numeric(14,2) AS received,
                    COALESCE(cash."ownerWithdrawals",0)::numeric(14,2) AS "ownerWithdrawals",
                    COALESCE(expense.amount,0)::numeric(14,2) AS expenses,
                    COALESCE(expense.details,'[]'::jsonb) AS "expenseDetails",
                    COALESCE(sc."ClosingBalance",0)::numeric(14,2) AS "closingBalance",
                    COALESCE(sc."ActualCash",0)::numeric(14,2) AS "actualCash",
                    COALESCE(sc."Variance",0)::numeric(14,2) AS variance
                FROM "EmployeeSession" es
                INNER JOIN "Users" u ON u."ID"=es."UserId"
                LEFT JOIN "SessionCashClosings" sc ON sc."SessionId"=es."ID"
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals"
                    FROM "SessionCashTransactions" t
                    WHERE t."SessionId"=es."ID"
                      AND t."LocationId"=es."LocationId"
                ) cash ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(x.amount),0)::numeric(14,2) AS amount,
                        COALESCE(
                            JSONB_AGG(
                                JSONB_BUILD_OBJECT(
                                    'type', x.type,
                                    'category', x.category,
                                    'amount', x.amount,
                                    'details', x.details,
                                    'createdAt', x.created_at
                                )
                                ORDER BY x.created_at, x.sort_group, x.sort_id
                            ) FILTER (WHERE x.amount <> 0),
                            '[]'::jsonb
                        ) AS details
                    FROM (
                        -- Same expense sources used by Employee Transactions / balanceQuery:
                        -- manual EXPENSE + Match/Extra Match + Raffle + Ticket Out + Bonus.
                        SELECT
                            'EXPENSE'::text AS type,
                            COALESCE(NULLIF(BTRIM(et."Name"),''),'Expense')::text AS category,
                            COALESCE(t."Amount",0)::numeric(14,2) AS amount,
                            COALESCE(NULLIF(BTRIM(t."Notes"),''),'Cash expense')::text AS details,
                            t."CreatedAt" AS created_at,
                            1 AS sort_group,
                            t."ID"::bigint AS sort_id
                        FROM "SessionCashTransactions" t
                        LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                        WHERE t."SessionId"=es."ID"
                          AND t."LocationId"=es."LocationId"
                          AND t."Type"='EXPENSE'

                        UNION ALL

                        SELECT
                            CASE WHEN COALESCE(cm."IsExtraMatch",false)
                                 THEN 'EXTRA_MATCH' ELSE 'MATCH_POINT' END::text AS type,
                            CASE WHEN COALESCE(cm."IsExtraMatch",false)
                                 THEN 'Extra Match' ELSE 'Match Point' END::text AS category,
                            COALESCE(cm."Points",0)::numeric(14,2) AS amount,
                            ('Customer #' || cm."CustomerId"::text ||
                             CASE WHEN cm."MachineId" IS NOT NULL
                                  THEN ' · Machine #' || COALESCE(m_cm."MachineNumber"::text,cm."MachineId"::text)
                                  ELSE '' END)::text AS details,
                            cm."DateAssign" AS created_at,
                            2 AS sort_group,
                            cm."ID"::bigint AS sort_id
                        FROM "CustomerMatch" cm
                        LEFT JOIN "Machines" m_cm ON m_cm."ID"=cm."MachineId"
                        WHERE cm."EmployeeSessionId"=es."ID"
                          AND cm."LocationId"=es."LocationId"

                        UNION ALL

                        SELECT
                            'RAFFLE'::text AS type,
                            'Raffle'::text AS category,
                            COALESCE(r."WinningAmount",0)::numeric(14,2) AS amount,
                            ('Raffle #' || r."ID"::text ||
                             ' · Customer #' || COALESCE(r."WinnerCustomerId"::text,'—') ||
                             ' · Machine #' || COALESCE(m_r."MachineNumber"::text,'—'))::text AS details,
                            r."CompletedAt" AS created_at,
                            3 AS sort_group,
                            r."ID"::bigint AS sort_id
                        FROM "Raffles" r
                        LEFT JOIN "Machines" m_r ON m_r."ID"=r."WinningMachineId"
                        WHERE r."EmployeeSessionId"=es."ID"
                          AND r."Status"='WINNER'

                        UNION ALL

                        SELECT
                            'TICKET_OUT'::text AS type,
                            'Ticket Out'::text AS category,
                            COALESCE(tk."Amount",0)::numeric(14,2) AS amount,
                            ('Ticket Out #' || tk."ID"::text ||
                             ' · Customer #' || COALESCE(tk."CustomerId"::text,'—') ||
                             ' · Machine #' || COALESCE(m_tk."MachineNumber"::text,'—'))::text AS details,
                            tk."CreatedAt" AS created_at,
                            4 AS sort_group,
                            tk."ID"::bigint AS sort_id
                        FROM "TicketOuts" tk
                        LEFT JOIN "Machines" m_tk ON m_tk."ID"=tk."MachineId"
                        WHERE tk."EmployeeSessionId"=es."ID"

                        UNION ALL

                        SELECT
                            'BONUS'::text AS type,
                            'Bonus'::text AS category,
                            COALESCE(b."Amount",0)::numeric(14,2) AS amount,
                            (COALESCE(NULLIF(BTRIM(b."BonusName"),''),'Bonus') ||
                             ' · ' || COALESCE(NULLIF(BTRIM(b."PayoutDescription"),''),'Payout') ||
                             ' · Customer #' || COALESCE(b."CustomerId"::text,'—') ||
                             ' · Machine #' || COALESCE(m_b."MachineNumber"::text,'—'))::text AS details,
                            b."CreatedAt" AS created_at,
                            5 AS sort_group,
                            b."ID"::bigint AS sort_id
                        FROM "BonusAwards" b
                        LEFT JOIN "Machines" m_b ON m_b."ID"=b."MachineId"
                        WHERE b."EmployeeSessionId"=es."ID"
                    ) x
                ) expense ON TRUE
                WHERE es."ReadingSessionId"=$1
                  AND es."LocationId"=$2
                  AND es."ClockOut" IS NOT NULL
                ORDER BY es."ClockIn", es."ID"
            `, [sessionId, locationId])

            const cashMetaResult = await pool.query(`
                WITH covered AS (
                    SELECT "ID"
                    FROM "EmployeeSession"
                    WHERE "ReadingSessionId"=$1
                      AND "LocationId"=$2
                      AND "ClockOut" IS NOT NULL
                )
                SELECT
                    COALESCE((
                        SELECT SUM(t."Amount")
                        FROM "SessionCashTransactions" t
                        INNER JOIN covered c ON c."ID"=t."SessionId"
                        LEFT JOIN "SessionCashHandovers" h ON h."ID"=t."TransferId"
                        WHERE t."LocationId"=$2
                          AND (
                              t."Type"='OPENING'
                              OR (
                                  t."Type"='OPENING_TRANSFER'
                                  AND (
                                      h."FromSessionId" IS NULL
                                      OR NOT EXISTS (
                                          SELECT 1 FROM covered source_session
                                          WHERE source_session."ID"=h."FromSessionId"
                                      )
                                  )
                              )
                          )
                    ),0)::numeric(14,2) AS "openingBalance",

                    COALESCE((
                        SELECT SUM(t."Amount")
                        FROM "SessionCashTransactions" t
                        INNER JOIN covered c ON c."ID"=t."SessionId"
                        LEFT JOIN "CreditTypes" ct
                          ON ct."ID"=t."CreditTypeId"
                         AND ct."LocationId"=t."LocationId"
                        WHERE t."LocationId"=$2
                          AND t."Type"='CASH_RECEIVED'
                          AND UPPER(COALESCE(ct."Code",'')) IN ('SHORT_PAYMENT','EMPLOYEE_SHORT_PAYMENT')
                    ),0)::numeric(14,2) AS "employeeShortPayment",

                    COALESCE((
                        SELECT SUM(sc."ActualCash")
                        FROM "SessionCashClosings" sc
                        INNER JOIN covered c ON c."ID"=sc."SessionId"
                        LEFT JOIN "SessionCashHandovers" h ON h."ID"=sc."HandoverId"
                        WHERE sc."LocationId"=$2
                          AND (
                              sc."HandoverId" IS NULL
                              OR h."ToSessionId" IS NULL
                              OR NOT EXISTS (
                                  SELECT 1 FROM covered destination_session
                                  WHERE destination_session."ID"=h."ToSessionId"
                              )
                          )
                    ),0)::numeric(14,2) AS "employeeSessionCloseAmount",

                    COALESCE((
                        SELECT SUM(rp."Amount")
                        FROM "ReadingProfitPostings" rp
                        WHERE rp."LocationId"=$2
                          AND rp."ReadingSessionId"=$1
                    ),0)::numeric(14,2) AS "machineCollectionAmount",

                    (
                        COALESCE((
                            SELECT SUM(sc."ActualCash")
                            FROM "SessionCashClosings" sc
                            INNER JOIN covered c ON c."ID"=sc."SessionId"
                            LEFT JOIN "SessionCashHandovers" h ON h."ID"=sc."HandoverId"
                            WHERE sc."LocationId"=$2
                              AND (
                                  sc."HandoverId" IS NULL
                                  OR h."ToSessionId" IS NULL
                                  OR NOT EXISTS (
                                      SELECT 1 FROM covered destination_session
                                      WHERE destination_session."ID"=h."ToSessionId"
                                  )
                              )
                        ),0)
                        +
                        COALESCE((
                            SELECT SUM(rp."Amount")
                            FROM "ReadingProfitPostings" rp
                            WHERE rp."LocationId"=$2
                              AND rp."ReadingSessionId"=$1
                        ),0)
                    )::numeric(14,2) AS "endingBalance"
            `, [sessionId, locationId])

            const readingSessionCashResult = await pool.query(`
                SELECT
                    t."ID" AS id,
                    t."Type" AS type,
                    t."Amount"::numeric(14,2) AS amount,
                    t."ExpenseTypeId" AS "expenseTypeId",
                    t."CreditTypeId" AS "creditTypeId",
                    COALESCE(et."Name",'Expense') AS "expenseTypeName",
                    COALESCE(ct."Name",'Credit') AS "creditTypeName",
                    t."Notes" AS notes,
                    t."CreatedBy" AS "createdBy",
                    t."LegacyLocationCashEntryId" AS "legacyLocationCashEntryId",
                    t."CreatedAt" AS "createdAt",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Admin') AS "createdByName"
                FROM "ReadingSessionCashTransactions" t
                LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                LEFT JOIN "CreditTypes" ct ON ct."ID"=t."CreditTypeId"
                LEFT JOIN "Users" u ON u."ID"=t."CreatedBy"
                WHERE t."ReadingSessionId"=$1
                  AND t."LocationId"=$2
                ORDER BY t."CreatedAt", t."ID"
            `, [sessionId, locationId])


            // --------------------------------------------------------
            // DATA ANALYTICS
            // --------------------------------------------------------
            // Shift boundaries come from Manage Rules. For the current
            // location, two reset times define the operational shifts.
            // Example: 06:00 -> 18:00 = Morning, 18:00 -> 06:00 = Night.
            const ruleResult = await pool.query(`
                SELECT
                    COALESCE("MatchRuleEnabled", false) AS "matchRuleEnabled",
                    COALESCE(NULLIF(BTRIM("MatchRuleName"), ''), 'MATCH') AS "matchRuleName",
                    COALESCE("MatchCooldownHours", 0) AS "matchCooldownHours",
                    COALESCE("MatchMaxPerDay", 0) AS "matchMaxPerDay",
                    COALESCE("MatchResetTimes", '[]'::jsonb) AS "matchResetTimes",
                    "MatchResetDayTime"::text AS "matchResetDayTime"
                FROM "LocationRuleSettings"
                WHERE "LocationId"=$1
                LIMIT 1
            `, [locationId])

            const ruleRow = ruleResult.rows[0] || {}
            const rawResetTimes = Array.isArray(ruleRow.matchResetTimes)
                ? ruleRow.matchResetTimes
                : []

            const validResetTimes = rawResetTimes
                .map(value => String(value || '').slice(0, 5))
                .filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
                .sort()

            let morningStart = validResetTimes[0] || String(ruleRow.matchResetDayTime || '06:00').slice(0, 5)
            let nightStart = validResetTimes[1] || '18:00'

            // If only one reset exists, create a 12-hour opposite boundary.
            if (validResetTimes.length < 2) {
                const [hours, minutes] = morningStart.split(':').map(Number)
                const oppositeHour = (hours + 12) % 24
                nightStart = `${String(oppositeHour).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}`
            }

            const analyticsActivityResult = await pool.query(`
                WITH covered AS (
                    SELECT "ID"
                    FROM "EmployeeSession"
                    WHERE "ReadingSessionId"=$1
                      AND "LocationId"=$2
                      AND "ClockOut" IS NOT NULL
                ),
                pull_rows AS (
                    SELECT
                        COALESCE(t."Amount",0)::numeric(14,2) AS amount,
                        (t."CreatedAt" AT TIME ZONE 'America/Chicago')::time AS local_time
                    FROM "SessionCashTransactions" t
                    INNER JOIN covered c ON c."ID"=t."SessionId"
                    INNER JOIN "CreditTypes" ct
                      ON ct."ID"=t."CreditTypeId"
                     AND ct."LocationId"=t."LocationId"
                    WHERE t."LocationId"=$2
                      AND t."Type"='CASH_RECEIVED'
                      AND UPPER(COALESCE(ct."Code",''))='PULL'
                ),
                match_rows AS (
                    SELECT
                        COALESCE(cm."Points",0)::numeric(14,2) AS points,
                        cm."CustomerId" AS customer_id,
                        cm."DateAssign"::time AS local_time
                    FROM "CustomerMatch" cm
                    INNER JOIN covered c ON c."ID"=cm."EmployeeSessionId"
                    WHERE cm."LocationId"=$2
                )
                SELECT
                    COALESCE((SELECT SUM(amount) FROM pull_rows),0)::numeric(14,2) AS "totalPulls",
                    COALESCE((SELECT SUM(points) FROM match_rows),0)::numeric(14,2) AS "matchPoints",
                    COALESCE((SELECT COUNT(DISTINCT customer_id) FROM match_rows),0)::integer AS customers,
                    COALESCE((SELECT COUNT(*) FROM match_rows),0)::integer AS "matchCount",

                    COALESCE((
                        SELECT SUM(amount)
                        FROM pull_rows
                        WHERE local_time >= $3::time AND local_time < $4::time
                    ),0)::numeric(14,2) AS "morningPulls",
                    COALESCE((
                        SELECT SUM(points)
                        FROM match_rows
                        WHERE local_time >= $3::time AND local_time < $4::time
                    ),0)::numeric(14,2) AS "morningMatchPoints",
                    COALESCE((
                        SELECT COUNT(DISTINCT customer_id)
                        FROM match_rows
                        WHERE local_time >= $3::time AND local_time < $4::time
                    ),0)::integer AS "morningCustomers",
                    COALESCE((
                        SELECT COUNT(*)
                        FROM match_rows
                        WHERE local_time >= $3::time AND local_time < $4::time
                    ),0)::integer AS "morningMatchCount",

                    COALESCE((
                        SELECT SUM(amount)
                        FROM pull_rows
                        WHERE local_time >= $4::time OR local_time < $3::time
                    ),0)::numeric(14,2) AS "nightPulls",
                    COALESCE((
                        SELECT SUM(points)
                        FROM match_rows
                        WHERE local_time >= $4::time OR local_time < $3::time
                    ),0)::numeric(14,2) AS "nightMatchPoints",
                    COALESCE((
                        SELECT COUNT(DISTINCT customer_id)
                        FROM match_rows
                        WHERE local_time >= $4::time OR local_time < $3::time
                    ),0)::integer AS "nightCustomers",
                    COALESCE((
                        SELECT COUNT(*)
                        FROM match_rows
                        WHERE local_time >= $4::time OR local_time < $3::time
                    ),0)::integer AS "nightMatchCount"
            `, [sessionId, locationId, morningStart, nightStart])

            const analyticsTicketResult = await pool.query(`
                SELECT
                    COALESCE(SUM(tk."Amount"),0)::numeric(14,2) AS "ticketOutTotal"
                FROM "TicketOuts" tk
                INNER JOIN "EmployeeSession" es ON es."ID"=tk."EmployeeSessionId"
                WHERE es."ReadingSessionId"=$1
                  AND es."LocationId"=$2
                  AND es."ClockOut" IS NOT NULL
            `, [sessionId, locationId])

            const closingAccountsResult = await pool.query(`
                SELECT
                    a."ID" AS id,
                    a."Kind" AS kind,
                    a."UserId" AS "userId",
                    CASE
                        WHEN a."Kind"='BANK' THEN 'Business Bank'
                        ELSE COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",a."Kind")
                    END AS name,
                    COALESCE(SUM(e."Amount"),0)::numeric(14,2) AS balance
                FROM "LocationCashAccounts" a
                LEFT JOIN "Users" u ON u."ID"=a."UserId"
                LEFT JOIN "LocationCashEntries" e
                  ON e."AccountId"=a."ID"
                 AND (
                      e."CreatedAt" <= COALESCE($2::timestamptz, NOW())
                      OR EXISTS (
                          SELECT 1
                          FROM "ReadingProfitPostings" rp
                          WHERE rp."ID"=e."ReadingProfitPostingId"
                            AND rp."LocationId"=$1
                            AND rp."ReadingSessionId"=$3
                      )
                 )
                WHERE a."LocationId"=$1
                  AND (
                      a."CreatedAt" <= COALESCE($2::timestamptz, NOW())
                      OR EXISTS (
                          SELECT 1
                          FROM "LocationCashEntries" linked_entry
                          INNER JOIN "ReadingProfitPostings" linked_posting
                            ON linked_posting."ID"=linked_entry."ReadingProfitPostingId"
                          WHERE linked_entry."AccountId"=a."ID"
                            AND linked_posting."LocationId"=$1
                            AND linked_posting."ReadingSessionId"=$3
                      )
                  )
                GROUP BY a."ID",a."Kind",a."UserId",u."Name",u."Username"
                ORDER BY CASE a."Kind" WHEN 'BANK' THEN 1 WHEN 'OWNER' THEN 2 ELSE 3 END, name
            `, [
                locationId,
                session.endedAt || session.startedAt,
                sessionId
            ])

            const readings = readingsResult.rows.map(row => ({
                ...row,
                previousin: weeklyReportNumber(row.previousin),
                previousout: weeklyReportNumber(row.previousout),
                currentin: weeklyReportNumber(row.currentin),
                currentout: weeklyReportNumber(row.currentout),
                dailyin: weeklyReportNumber(row.dailyin),
                dailyout: weeklyReportNumber(row.dailyout),
                difference: weeklyReportNumber(row.difference),
                points: weeklyReportNumber(row.points),
                ticketout: weeklyReportNumber(row.ticketout),
                ticketcount: Number(row.ticketcount || 0),
                ticketemployees: row.ticketemployees || '',
                net: weeklyReportNumber(row.net)
            }))

            const typeMap = new Map()
            for (const row of readings) {
                const key = row.machinetypename || 'Unassigned'
                const current = typeMap.get(key) || {
                    machineType: key,
                    in: 0,
                    out: 0,
                    difference: 0,
                    points: 0,
                    net: 0,
                    machineCount: 0
                }
                current.in += row.dailyin
                current.out += row.dailyout
                current.difference += row.difference
                current.points += row.points
                current.net += row.net
                current.machineCount += 1
                typeMap.set(key, current)
            }

            // Use the SAME machine-type aggregates displayed in the
            // Reading tab as the source of truth for session totals.
            // IN / OUT are DAILY meter movement, not lifetime readings:
            // Daily IN  = CurrentIn  - PreviousIn
            // Daily OUT = CurrentOut - PreviousOut
            const machineTypeTotals =
                Array.from(typeMap.values())

            const readingTotals =
                machineTypeTotals.reduce(
                    (acc, row) => {
                        acc.totalIn +=
                            weeklyReportNumber(row.in)

                        acc.totalOut +=
                            weeklyReportNumber(row.out)

                        acc.grossProfit +=
                            weeklyReportNumber(
                                row.difference
                            )

                        acc.points +=
                            weeklyReportNumber(row.points)

                        acc.net +=
                            weeklyReportNumber(row.net)

                        return acc
                    },
                    {
                        totalIn: 0,
                        totalOut: 0,
                        grossProfit: 0,
                        points: 0,
                        net: 0
                    }
                )

            const expenses = expenseResult.rows.map(row => ({
                category: row.category,
                amount: weeklyReportNumber(row.amount)
            }))
            const allExpenses = expenses.reduce((sum, row) => sum + row.amount, 0)

            // Percentage tab uses Reading Total IN as the common denominator.
            // Keep the category rollup here so the frontend only presents values and
            // does not duplicate financial classification logic.
            const expenseAmountBy = predicate => expenses.reduce(
                (sum, row) => predicate(String(row.category || '').trim().toUpperCase())
                    ? sum + weeklyReportNumber(row.amount)
                    : sum,
                0
            )

            // Match Point Given includes regular Match Point and Extra Match because
            // both are points awarded toward machines for this Reading Session.
            const matchPointGivenAmount = expenseAmountBy(category =>
                category === 'MATCH POINT' || category === 'EXTRA MATCH'
            )
            const raffleGivenAmount = expenseAmountBy(category => category === 'RAFFLE')
            const bonusGivenAmount = expenseAmountBy(category => category === 'BONUS')
            const payrollAmount = expenseAmountBy(category => category.includes('PAYROLL'))
            const allOtherExpenseAmount = Math.max(
                0,
                allExpenses - matchPointGivenAmount - raffleGivenAmount - bonusGivenAmount - payrollAmount
            )

            const percentageOfReadingIn = amount =>
                readingTotals.totalIn
                    ? (weeklyReportNumber(amount) / readingTotals.totalIn) * 100
                    : 0

            const machinePayoutAmount = readingTotals.totalOut
            const machineHoldAmount = readingTotals.grossProfit
            const operatingExpenseAmount = allExpenses
            const remainingMarginAmount = machineHoldAmount - operatingExpenseAmount

            const percentageMetrics = {
                baseAmount: readingTotals.totalIn,
                machinePayout: {
                    amount: machinePayoutAmount,
                    percentage: percentageOfReadingIn(machinePayoutAmount)
                },
                machineHold: {
                    amount: machineHoldAmount,
                    percentage: percentageOfReadingIn(machineHoldAmount)
                },
                operatingExpense: {
                    amount: operatingExpenseAmount,
                    percentage: percentageOfReadingIn(operatingExpenseAmount)
                },
                remainingMargin: {
                    amount: remainingMarginAmount,
                    percentage: percentageOfReadingIn(remainingMarginAmount)
                },
                important: {
                    matchPointGiven: {
                        amount: matchPointGivenAmount,
                        percentage: percentageOfReadingIn(matchPointGivenAmount)
                    },
                    raffleGiven: {
                        amount: raffleGivenAmount,
                        percentage: percentageOfReadingIn(raffleGivenAmount)
                    },
                    bonusGiven: {
                        amount: bonusGivenAmount,
                        percentage: percentageOfReadingIn(bonusGivenAmount)
                    },
                    payroll: {
                        amount: payrollAmount,
                        percentage: percentageOfReadingIn(payrollAmount)
                    },
                    allOtherExpense: {
                        amount: allOtherExpenseAmount,
                        percentage: percentageOfReadingIn(allOtherExpenseAmount)
                    }
                }
            }

            const readingSessionTransactions = readingSessionCashResult.rows.map(row => ({
                ...row,
                amount: weeklyReportNumber(row.amount)
            }))
            const adminCredits = readingSessionTransactions
                .filter(row => row.type === 'CREDIT')
                .reduce((sum, row) => sum + row.amount, 0)
            const adminExpenses = readingSessionTransactions
                .filter(row => row.type === 'EXPENSE')
                .reduce((sum, row) => sum + row.amount, 0)

            const cashMeta = cashMetaResult.rows[0] || {}
            const openingBalance = weeklyReportNumber(cashMeta.openingBalance)
            const employeeShortPayment = weeklyReportNumber(cashMeta.employeeShortPayment)

            // Base E/B comes from employee session closings + reading profit posting.
            // Admin has no EmployeeSession, so ReadingSession-level CREDIT / EXPENSE
            // must move the Reading Session ending balance directly.
            const employeeSessionCloseAmount = weeklyReportNumber(cashMeta.employeeSessionCloseAmount)
            const machineCollectionAmount = weeklyReportNumber(cashMeta.machineCollectionAmount)
            const baseEndingBalance = weeklyReportNumber(cashMeta.endingBalance)
            const endingBalance = baseEndingBalance + adminCredits - adminExpenses

            const totalIn = openingBalance + readingTotals.totalIn + employeeShortPayment + adminCredits
            const totalOut = readingTotals.totalOut + allExpenses
            const difference = totalIn - totalOut
            const shortOver = endingBalance - difference

            // Calculated Net Profit = Difference - Opening Balance.
            const calculatedNetProfit = difference - openingBalance

            // Actual Net Profit = Ending Balance - Opening Balance.
            // This includes the effect of Short / Over.
            const actualNetProfit = endingBalance - openingBalance

            // Sequential employee-to-admin cash flow used by the Weekly Report.
            // Employee rows mirror the Employee Finance closing calculation.
            const sessionBreakdown = employeeResult.rows.map(row => {
                const opening = weeklyReportNumber(row.opening)
                const received = weeklyReportNumber(row.received)
                const expenses = weeklyReportNumber(row.expenses)
                const ownerWithdrawals = weeklyReportNumber(row.ownerWithdrawals)
                const calculated = opening + received - expenses - ownerWithdrawals
                const actual = weeklyReportNumber(row.actualCash)
                const shortOver = weeklyReportNumber(row.variance)

                return {
                    id: row.id,
                    name: row.name,
                    clockIn: row.clockIn,
                    clockOut: row.clockOut,
                    opening,
                    received,
                    expenses,
                    ownerWithdrawals,
                    calculated,
                    actual,
                    shortOver
                }
            })

            const adminBreakdown = {
                id: Number(sessionId),
                name: 'Admin',
                isAdmin: true,
                // Admin has no EmployeeSession. The employee-session close becomes the
                // Admin opening position, while machine collection + Admin reading
                // credits share the same Pull / Credits column used by employee rows.
                opening: employeeSessionCloseAmount,
                received: machineCollectionAmount + adminCredits,
                employeeSessionCloseAmount,
                machineCollectionAmount,
                credits: adminCredits,
                expenses: adminExpenses,
                calculated: endingBalance,
                actual: endingBalance,
                shortOver: 0
            }

            const analyticsActivity = analyticsActivityResult.rows[0] || {}
            const totalPulls = weeklyReportNumber(analyticsActivity.totalPulls)
            const totalMatchPoints = weeklyReportNumber(analyticsActivity.matchPoints)
            const totalCustomers = Number(analyticsActivity.customers || 0)
            const totalMatchCount = Number(analyticsActivity.matchCount || 0)
            const morningPulls = weeklyReportNumber(analyticsActivity.morningPulls)
            const morningMatchPoints = weeklyReportNumber(analyticsActivity.morningMatchPoints)
            const morningCustomers = Number(analyticsActivity.morningCustomers || 0)
            const morningMatchCount = Number(analyticsActivity.morningMatchCount || 0)
            const nightPulls = weeklyReportNumber(analyticsActivity.nightPulls)
            const nightMatchPoints = weeklyReportNumber(analyticsActivity.nightMatchPoints)
            const nightCustomers = Number(analyticsActivity.nightCustomers || 0)
            const nightMatchCount = Number(analyticsActivity.nightMatchCount || 0)
            const ticketOutTotal = weeklyReportNumber(analyticsTicketResult.rows[0]?.ticketOutTotal)

            const employeeVarianceRows = employeeResult.rows.map(row => ({
                id: row.id,
                name: row.name,
                variance: weeklyReportNumber(row.variance),
                opening: weeklyReportNumber(row.opening),
                expenses: weeklyReportNumber(row.expenses),
                actualCash: weeklyReportNumber(row.actualCash)
            }))
            const employeeShortOver = employeeVarianceRows.reduce(
                (sum, row) => sum + row.variance,
                0
            )

            // Equation X is a diagnostic reconciliation:
            // Pulls Gap + Match Tickets + Employee Short/Over.
            const pullsGap = totalPulls - readingTotals.totalIn
            const matchTickets = readingTotals.totalOut - ticketOutTotal
            const equationX = pullsGap + matchTickets + employeeShortOver
            const equationDifference = equationX - shortOver

            // LocationCashEntries still provide the established custody/account balance.
            // New ReadingSession Admin transactions intentionally do NOT write to that ledger,
            // so overlay only the new (non-legacy) ReadingSession transactions here.
            // Migrated legacy expenses already exist in LocationCashEntries and must not be
            // applied a second time to the account balance.
            const adminAccountAdjustments = new Map()
            for (const transaction of readingSessionTransactions) {
                if (transaction.legacyLocationCashEntryId) continue

                const userId = Number(transaction.createdBy)
                if (!Number.isFinite(userId) || userId <= 0) continue

                const signedAmount = transaction.type === 'CREDIT'
                    ? transaction.amount
                    : transaction.type === 'EXPENSE'
                        ? -transaction.amount
                        : 0

                adminAccountAdjustments.set(
                    userId,
                    (adminAccountAdjustments.get(userId) || 0) + signedAmount
                )
            }

            const accounts = closingAccountsResult.rows.map(row => {
                const userId = Number(row.userId)
                const baseBalance = weeklyReportNumber(row.balance)
                const readingAdjustment = Number.isFinite(userId)
                    ? (adminAccountAdjustments.get(userId) || 0)
                    : 0

                return {
                    ...row,
                    balance: baseBalance + readingAdjustment
                }
            })
            const accountSubtotal = accounts.reduce((sum, row) => sum + row.balance, 0)

            return success(res, {
                session,
                cashFlow: {
                    openingBalance,

                    // Daily meter movement for the selected Reading Session.
                    dailyIn: readingTotals.totalIn,
                    dailyOut: readingTotals.totalOut,

                    // Keep existing keys for compatibility.
                    readingTotalIn: readingTotals.totalIn,
                    readingTotalOut: readingTotals.totalOut,

                    employeeShortPayment,
                    adminCredits,
                    adminExpenses,
                    totalIn,
                    allExpenses,
                    totalOut,
                    difference,
                    endingBalance,
                    shortOver,

                    // Retained for backward compatibility.
                    netProfit: calculatedNetProfit,
                    calculatedNetProfit,
                    actualNetProfit,
                    sessionBreakdown,
                    adminBreakdown
                },
                reading: {
                    totals: readingTotals,
                    byMachineType: machineTypeTotals,
                    machines: readings
                },
                expenses: {
                    categories: expenses,
                    total: allExpenses,
                    adminDetails: readingSessionTransactions
                        .filter(row => row.type === 'EXPENSE')
                        .map(row => ({
                            id: row.id,
                            category: row.expenseTypeName || 'Expense',
                            details: row.notes || 'Admin expense',
                            amount: row.amount,
                            employeeName: row.createdByName || 'Admin',
                            sessionId,
                            createdAt: row.createdAt
                        })),
                    employeeSessions: employeeResult.rows.map(row => {
                        // The Expenses tab intentionally excludes Ticket Out because
                        // Ticket Out is already presented separately in Money Out.
                        // Keep row.expenses untouched elsewhere (for Cash Flow), and
                        // only expose the filtered amount/details in this tab payload.
                        const expenseDetails = (Array.isArray(row.expenseDetails)
                            ? row.expenseDetails
                            : [])
                            .filter(item =>
                                String(item?.type || '').toUpperCase() !== 'TICKET_OUT' &&
                                String(item?.category || '').trim().toUpperCase() !== 'TICKET OUT'
                            )
                            .map(item => ({
                                ...item,
                                amount: weeklyReportNumber(item.amount)
                            }))

                        const expenses = expenseDetails.reduce(
                            (sum, item) => sum + weeklyReportNumber(item.amount),
                            0
                        )

                        return {
                            ...row,
                            opening: weeklyReportNumber(row.opening),
                            received: weeklyReportNumber(row.received),
                            ownerWithdrawals: weeklyReportNumber(row.ownerWithdrawals),
                            expenses,
                            calculated: weeklyReportNumber(row.opening) + weeklyReportNumber(row.received) - expenses - weeklyReportNumber(row.ownerWithdrawals),
                            expenseDetails,
                            closingBalance: weeklyReportNumber(row.closingBalance),
                            actualCash: weeklyReportNumber(row.actualCash),
                            variance: weeklyReportNumber(row.variance)
                        }
                    })
                },
                readingSessionCash: {
                    credits: readingSessionTransactions.filter(row => row.type === 'CREDIT'),
                    expenses: readingSessionTransactions.filter(row => row.type === 'EXPENSE'),
                    creditTotal: adminCredits,
                    expenseTotal: adminExpenses
                },
                analytics: {
                    matchRule: {
                        enabled: Boolean(ruleRow.matchRuleEnabled),
                        name: ruleRow.matchRuleName || 'MATCH',
                        cooldownHours: weeklyReportNumber(ruleRow.matchCooldownHours),
                        maxPerDay: weeklyReportNumber(ruleRow.matchMaxPerDay),
                        resetTimes: validResetTimes,
                        resetDayTime: ruleRow.matchResetDayTime || null
                    },
                    shifts: {
                        morning: {
                            start: morningStart,
                            end: nightStart,
                            pulls: morningPulls,
                            matchPoints: morningMatchPoints,
                            customers: morningCustomers,
                            matchCount: morningMatchCount,
                            averageMatchPerCustomer: morningCustomers
                                ? morningMatchPoints / morningCustomers
                                : 0
                        },
                        night: {
                            start: nightStart,
                            end: morningStart,
                            pulls: nightPulls,
                            matchPoints: nightMatchPoints,
                            customers: nightCustomers,
                            matchCount: nightMatchCount,
                            averageMatchPerCustomer: nightCustomers
                                ? nightMatchPoints / nightCustomers
                                : 0
                        }
                    },
                    dailyActivity: {
                        totalPulls,
                        matchPoints: totalMatchPoints,
                        customers: totalCustomers,
                        matchCount: totalMatchCount,
                        averageMatchPerCustomer: totalCustomers
                            ? totalMatchPoints / totalCustomers
                            : 0
                    },
                    reconciliation: {
                        readingTotalIn: readingTotals.totalIn,
                        employeeTotalPulls: totalPulls,
                        pullsGap,
                        readingTotalOut: readingTotals.totalOut,
                        ticketOutTotal,
                        matchTickets,
                        employeeShortOver,
                        equationX,
                        weeklyReport: shortOver,
                        difference: equationDifference,
                        matched: Math.abs(equationDifference) < 0.01,
                        employees: employeeVarianceRows
                    }
                },
                closingBalance: {
                    accounts,
                    subtotal: accountSubtotal,
                    employeeSessionCloseAmount,
                    machineCollectionAmount,
                    adminCredits,
                    adminExpenses,
                    ebTotal: endingBalance
                },
                percentages: percentageMetrics
            }, 'Weekly Report day loaded successfully.')
        } catch (error) {
            console.error('Weekly Report day error:', error)
            return errorResponse(res, 500, 'Unable to load Weekly Report day.')
        }
    }
)

module.exports = router