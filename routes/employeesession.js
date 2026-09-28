const express = require('express')
const router = express.Router()

const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')

// ============================================================
// CLOCK IN
// Permission: employeesession.update
// ============================================================

router.post(
    '/clockin',
    requirePermission('clock.update'),
    async (req, res) => {
        try {
            const {
                userid,
                locationid
            } = req.body

            if (!userid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'User and location are required.'
                })
            }

            // Check if employee already has an active session
            const activeSession =
                await pool.query(
                    `
                    SELECT
                        "ID" AS "id",
                        "ClockIn" AS "clockIn",
                        "LocationId" AS "locationId"

                    FROM "EmployeeSession"

                    WHERE
                        "UserId" = $1
                        AND "ClockOut" IS NULL

                    LIMIT 1
                    `,
                    [
                        userid
                    ]
                )

            if (
                activeSession.rowCount > 0
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'You are already clocked in.',
                    data:
                        activeSession.rows[0]
                })
            }

            const result =
                await pool.query(
                    `
                    INSERT INTO "EmployeeSession"
                    (
                        "UserId",
                        "LocationId",
                        "ClockIn",
                        "TotalWorkingHours",
                        "IsPaid"
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        NOW(),
                        0,
                        false
                    )
                    RETURNING
                        "ID" AS "id",
                        "UserId" AS "userId",
                        "LocationId" AS "locationId",
                        "ClockIn" AS "clockIn",
                        "ClockOut" AS "clockOut",
                        "TotalWorkingHours"
                            AS "totalWorkingHours",
                        "IsPaid" AS "isPaid"
                    `,
                    [
                        userid,
                        locationid
                    ]
                )

            return res.status(201).json({
                success: true,
                code: 20000,
                message:
                    'Clocked in successfully.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Clock-in error:',
                error
            )

            if (
                error.code === '23505'
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'You are already clocked in.'
                })
            }

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to clock in.'
            })
        }
    }
)

// ============================================================
// CLOCK OUT
// Permission: employeesession.update
// ============================================================

router.post(
    '/clockout',
    requirePermission('clock.update'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const {
                userid
            } = req.body

            if (!userid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'User is required.'
                })
            }

            // The regular clock-out endpoint is self-service. Never trust a
            // browser-supplied user ID to close another employee's session.
            if (Number(req.authUser?.id) !== Number(userid)) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message: 'You may only clock out your own session.'
                })
            }

            await client.query(
                'BEGIN'
            )

            // Get current active session
            const sessionResult =
                await client.query(
                    `
                    SELECT
                        "ID",
                        "ClockIn"

                    FROM "EmployeeSession"

                    WHERE
                        "UserId" = $1
                        AND "ClockOut" IS NULL

                    ORDER BY
                        "ClockIn" DESC

                    LIMIT 1

                    FOR UPDATE
                    `,
                    [
                        userid
                    ]
                )

            if (
                sessionResult.rowCount === 0
            ) {
                await client.query(
                    'ROLLBACK'
                )

                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'You are not currently clocked in.'
                })
            }

            const sessionId =
                sessionResult.rows[0].ID

            // Cash-enabled sessions must be closed via /employeefinance/handover-and-clockout.
            // Otherwise the employee could bypass the financial handover workflow.
            const financeActivity = await client.query(
                `SELECT 1 FROM "SessionCashTransactions" WHERE "SessionId" = $1
                 UNION ALL
                 SELECT 1 FROM "CustomerMatch" cm
                 JOIN "EmployeeSession" es ON es."ID" = $1
                 WHERE cm."AssignedBy" = es."UserId"
                   AND cm."LocationId" = es."LocationId"
                   AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                   AND cm."DateAssign" <= (NOW() AT TIME ZONE 'America/Chicago')
                 LIMIT 1`,
                [sessionId]
            )
            if (financeActivity.rowCount > 0) {
                await client.query('ROLLBACK')
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message: 'Cash activity exists in this session. Go to Employee Transactions, complete the handover, and clock out there.'
                })
            }

            const result =
                await client.query(
                    `
                    UPDATE "EmployeeSession"

                    SET
                        "ClockOut" = NOW(),

                        "TotalWorkingHours" =
                            ROUND(
                                (
                                    EXTRACT(
                                        EPOCH FROM
                                        (
                                            NOW() -
                                            "ClockIn"
                                        )
                                    ) / 3600
                                )::numeric,
                                2
                            )

                    WHERE
                        "ID" = $1

                    RETURNING
                        "ID" AS "id",
                        "UserId" AS "userId",
                        "LocationId" AS "locationId",
                        "ClockIn" AS "clockIn",
                        "ClockOut" AS "clockOut",
                        "TotalWorkingHours"
                            AS "totalWorkingHours",
                        "IsPaid" AS "isPaid"
                    `,
                    [
                        sessionId
                    ]
                )

            await client.query(
                'COMMIT'
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Clocked out successfully.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            await client.query(
                'ROLLBACK'
            )

            console.error(
                'Clock-out error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to clock out.'
            })

        } finally {
            client.release()
        }
    }
)

// ============================================================
// CURRENT STATUS
// Permission: employeesession.read
// ============================================================

router.get(
    '/status/:userid',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const userid =
                Number(
                    req.params.userid
                )

            if (!userid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Invalid user.'
                })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        es."ID" AS "id",
                        es."UserId" AS "userId",
                        es."LocationId" AS "locationId",
                        es."ClockIn" AS "clockIn",
                        es."ClockOut" AS "clockOut",

                        EXTRACT(
                            EPOCH FROM
                            (
                                NOW() -
                                es."ClockIn"
                            )
                        )::integer
                            AS "elapsedSeconds"

                    FROM "EmployeeSession" es

                    WHERE
                        es."UserId" = $1
                        AND es."ClockOut" IS NULL

                    ORDER BY
                        es."ClockIn" DESC

                    LIMIT 1
                    `,
                    [
                        userid
                    ]
                )

            if (
                result.rowCount === 0
            ) {
                return res.status(200).json({
                    success: true,
                    code: 20000,

                    data: {
                        clockedIn: false,
                        session: null
                    }
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,

                data: {
                    clockedIn: true,
                    session:
                        result.rows[0]
                }
            })

        } catch (error) {
            console.error(
                'Clock status error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve clock status.'
            })
        }
    }
)

// ============================================================
// EMPLOYEE SESSION HISTORY
// Permission: employeesession.read
// ============================================================

router.get(
    '/employee/:userid',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const userid =
                Number(
                    req.params.userid
                )

            const locationid =
                Number(
                    req.query.locationid
                )

            const days =
                Math.min(
                    Number(
                        req.query.days || 14
                    ),
                    90
                )

            if (
                !userid ||
                !locationid
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'User and location are required.'
                })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        es."ID" AS "id",

                        es."ClockIn"
                            AS "clockIn",

                        es."ClockOut"
                            AS "clockOut",

                        es."TotalWorkingHours"
                            AS "totalWorkingHours",

                        es."IsPaid"
                            AS "isPaid",

                        CASE
                            WHEN
                                es."ClockOut"
                                    IS NULL
                            THEN
                                'IN_PROGRESS'
                            ELSE
                                'CLOSED'
                        END AS "status",

                        COALESCE(
                            COUNT(
                                cm."ID"
                            ),
                            0
                        )::integer
                            AS "entries",

                        COALESCE(
                            SUM(
                                cm."Points"
                            ),
                            0
                        )::double precision
                            AS "points"

                    FROM
                        "EmployeeSession" es

                    LEFT JOIN
                        "CustomerMatch" cm

                        ON
                            cm."AssignedBy" =
                                es."UserId"

                        AND
                            cm."LocationId" =
                                es."LocationId"

                        AND
                            cm."DateAssign" >=
                                es."ClockIn"

                        AND
                        (
                            es."ClockOut"
                                IS NULL

                            OR

                            cm."DateAssign" <=
                                es."ClockOut"
                        )

                    WHERE
                        es."UserId" = $1

                        AND
                        es."LocationId" = $2

                        AND
                        es."ClockIn" >=
                            CURRENT_DATE
                            - ($3::integer - 1)

                    GROUP BY
                        es."ID",
                        es."ClockIn",
                        es."ClockOut",
                        es."TotalWorkingHours",
                        es."IsPaid"

                    ORDER BY
                        es."ClockIn" DESC
                    `,
                    [
                        userid,
                        locationid,
                        days
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Employee sessions retrieved successfully.',
                data:
                    result.rows
            })

        } catch (error) {
            console.error(
                'Employee session error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve employee sessions.'
            })
        }
    }
)



// Session report dates are inclusive America/Chicago calendar dates.
function reportDateFilter(query) {
    const { startDate, endDate } = query
    if (startDate == null && endDate == null) return { startDate: null, endDate: null }
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    if (!valid(startDate) || !valid(endDate) || startDate > endDate)
        return null
    return { startDate, endDate }
}

// ============================================================
// REPORTS - EMPLOYEE SESSION SUMMARY
// Permission: employeesession.read
// ============================================================

router.get('/reports/employees', requirePermission('employeesession.read'), async (req, res) => {
    try {
        const locationid = Number(req.query.locationid)
        const dates = reportDateFilter(req.query)
        if (!Number.isSafeInteger(locationid) || locationid <= 0 || !dates)
            return res.status(400).json({ success: false, code: 40000, message: 'Valid location and date range are required.' })
        const result = await pool.query(`
            WITH selected_sessions AS (
                SELECT es.* FROM "EmployeeSession" es
                WHERE es."LocationId" = $1
                  AND ($2::date IS NULL OR (es."ClockIn" AT TIME ZONE 'America/Chicago')::date >= $2::date)
                  AND ($3::date IS NULL OR (es."ClockIn" AT TIME ZONE 'America/Chicago')::date <= $3::date)
            ), session_totals AS (
                SELECT es."ID", es."UserId", es."ClockIn", es."ClockOut",
                       es."ReadingSessionId", es."TotalWorkingHours",
                       COALESCE(p.points, 0) AS points,
                       COALESCE(c.cash_expenses, 0) AS cash_expenses
                FROM selected_sessions es
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(cm."Points"),0) AS points
                    FROM "CustomerMatch" cm
                    WHERE cm."AssignedBy" = es."UserId" AND cm."LocationId" = es."LocationId"
                      AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                      AND cm."DateAssign" <= (COALESCE(es."ClockOut", NOW()) AT TIME ZONE 'America/Chicago')
                ) p ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'EXPENSE'),0) AS cash_expenses
                    FROM "SessionCashTransactions" t
                    WHERE t."SessionId" = es."ID" AND t."LocationId" = es."LocationId"
                ) c ON true
            )
            SELECT u."ID" AS "userId",
                   COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "name",
                   u."Username" AS "username", u."Avatar" AS "avatar", u."JobTitle" AS "jobTitle",
                   COUNT(s."ID")::integer AS "sessionCount",
                   COUNT(s."ID") FILTER (WHERE s."ReadingSessionId" IS NOT NULL)::integer AS "readingIncludedCount",
                   MAX(s."ClockIn") AS "lastSession",
                   COALESCE(SUM(s."TotalWorkingHours"),0)::double precision AS "totalWorkingHours",
                   COUNT(s."ID") FILTER (WHERE s."ClockOut" IS NULL)::integer AS "activeSessionCount",
                   COALESCE(SUM(s.points),0)::double precision AS "totalPoints",
                   COALESCE(SUM(s.cash_expenses),0)::double precision AS "cashExpenses",
                   COALESCE(SUM(s.cash_expenses),0)::double precision AS "totalExpenses"
            FROM "Users" u JOIN session_totals s ON s."UserId" = u."ID"
            WHERE u."LocationId" = $1 AND COALESCE(u."IsActive",true) = true
            GROUP BY u."ID", u."Name", u."Username", u."Avatar", u."JobTitle"
            ORDER BY COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') ASC
        `, [locationid, dates.startDate, dates.endDate])
        return res.json({ success: true, code: 20000, message: 'Employee session summary retrieved successfully.', data: result.rows })
    } catch (error) {
        console.error('Employee session summary error:', error)
        return res.status(500).json({ success: false, code: 50000, message: 'Unable to retrieve employee session summary.' })
    }
})

// ============================================================
// REPORTS - SESSIONS FOR ONE EMPLOYEE
// Permission: employeesession.read
// ============================================================

router.get(
    '/reports/employee/:userid/sessions',
    requirePermission('employeesession.read'),
    async (req, res) => {
        try {
            const userid = Number(req.params.userid)
            const locationid = Number(req.query.locationid)
            const dates = reportDateFilter(req.query)

            if (!userid || !locationid || !dates) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'User and location are required.'
                })
            }

            const employeeResult = await pool.query(
                `
                SELECT
                    u."ID" AS "userId",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "name",
                    u."Username" AS "username",
                    u."Avatar" AS "avatar",
                    u."JobTitle" AS "jobTitle"
                FROM "Users" u
                WHERE
                    u."ID" = $1
                    AND u."LocationId" = $2
                LIMIT 1
                `,
                [userid, locationid]
            )

            if (employeeResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Employee not found.'
                })
            }

            const sessionsResult = await pool.query(
                `
                SELECT
                    es."ID" AS "id",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    es."ReadingSessionId" AS "readingSessionId",
                    CASE
                        WHEN es."ClockOut" IS NULL THEN 'IN_PROGRESS'
                        ELSE 'CLOSED'
                    END AS "status",
                    COUNT(cm."ID")::integer AS "entries",

                    COALESCE(SUM(cm."Points"), 0)::double precision AS "points",
                    COALESCE(c.cash_expenses,0)::double precision AS "cashExpenses",
                    COALESCE(c.cash_expenses,0)::double precision AS "totalExpenses",

                    COUNT(cm."ID") FILTER (
                        WHERE NULLIF(BTRIM(COALESCE(cm."ImageUrl", '')), '') IS NOT NULL
                    )::integer AS "photoCount",

                    COUNT(cm."ID") FILTER (
                        WHERE NULLIF(BTRIM(COALESCE(cm."ImageUrl", '')), '') IS NOT NULL
                          AND cm."ReviewStatus" = 'Approved'
                    )::integer AS "approvedCount",

                    COUNT(cm."ID") FILTER (
                        WHERE NULLIF(BTRIM(COALESCE(cm."ImageUrl", '')), '') IS NOT NULL
                          AND cm."ReviewStatus" = 'Rejected'
                    )::integer AS "rejectedCount",

                    COUNT(cm."ID") FILTER (
                        WHERE NULLIF(BTRIM(COALESCE(cm."ImageUrl", '')), '') IS NOT NULL
                          AND (
                              cm."ReviewStatus" IS NULL
                              OR cm."ReviewStatus" = 'Pending'
                          )
                    )::integer AS "remainingReview"
                FROM "EmployeeSession" es
                LEFT JOIN "CustomerMatch" cm
                    ON cm."AssignedBy" = es."UserId"
                    AND cm."LocationId" = es."LocationId"
                    AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                    AND (
                        cm."DateAssign" <= (COALESCE(es."ClockOut", NOW()) AT TIME ZONE 'America/Chicago')
                    )
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'EXPENSE'),0) AS cash_expenses
                    FROM "SessionCashTransactions" t
                    WHERE t."SessionId" = es."ID" AND t."LocationId" = es."LocationId"
                ) c ON true
                WHERE
                    es."UserId" = $1
                    AND es."LocationId" = $2
                    AND ($3::date IS NULL OR (es."ClockIn" AT TIME ZONE 'America/Chicago')::date >= $3::date)
                    AND ($4::date IS NULL OR (es."ClockIn" AT TIME ZONE 'America/Chicago')::date <= $4::date)
                GROUP BY
                    es."ID",
                    es."ClockIn",
                    es."ClockOut",
                    es."TotalWorkingHours",
                    es."IsPaid",
                    es."ReadingSessionId", c.cash_expenses
                ORDER BY es."ClockIn" DESC
                `,
                [userid, locationid, dates.startDate, dates.endDate]
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Employee report sessions retrieved successfully.',
                data: {
                    employee: employeeResult.rows[0],
                    sessions: sessionsResult.rows
                }
            })
        } catch (error) {
            console.error('Employee report sessions error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve employee report sessions.'
            })
        }
    }
)

// ============================================================
// REPORTS - SESSION REPORT HUB DATA
// Permission: employeesession.read
// ============================================================

router.get(
    '/reports/session/:sessionid',
    requirePermission('employeesession.read'),
    async (req, res) => {
        try {
            const sessionid = Number(req.params.sessionid)
            const locationid = Number(req.query.locationid)

            if (!sessionid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Session and location are required.'
                })
            }

            const result = await pool.query(
                `
                SELECT
                    es."ID" AS "id",
                    es."UserId" AS "userId",
                    es."LocationId" AS "locationId",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    u."Avatar" AS "employeeAvatar",
                    u."JobTitle" AS "jobTitle",
                    COUNT(cm."ID")::integer AS "pointEntries",
                    COALESCE(SUM(cm."Points"), 0)::double precision AS "totalPoints"
                FROM "EmployeeSession" es
                INNER JOIN "Users" u
                    ON u."ID" = es."UserId"
                LEFT JOIN "CustomerMatch" cm
                    ON cm."AssignedBy" = es."UserId"
                    AND cm."LocationId" = es."LocationId"
                    AND cm."DateAssign" >= es."ClockIn"
                    AND (
                        es."ClockOut" IS NULL
                        OR cm."DateAssign" <= es."ClockOut"
                    )
                WHERE
                    es."ID" = $1
                    AND es."LocationId" = $2
                GROUP BY
                    es."ID",
                    es."UserId",
                    es."LocationId",
                    es."ClockIn",
                    es."ClockOut",
                    es."TotalWorkingHours",
                    es."IsPaid",
                    u."ID",
                    u."Name",
                    u."Username",
                    u."Avatar",
                    u."JobTitle"
                LIMIT 1
                `,
                [sessionid, locationid]
            )

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Session not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session report retrieved successfully.',
                data: result.rows[0]
            })
        } catch (error) {
            console.error('Session report error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve session report.'
            })
        }
    }
)

// ============================================================
// REPORTS - POINTS REPORT FOR ONE SESSION
// Permission: employeesession.read
// ============================================================

router.get(
    '/reports/session/:sessionid/points',
    requirePermission('employeesession.read'),
    async (req, res) => {
        try {
            const sessionid = Number(req.params.sessionid)
            const locationid = Number(req.query.locationid)

            if (!sessionid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Session and location are required.'
                })
            }

            const sessionResult = await pool.query(
                `
                SELECT
                    es."ID" AS "id",
                    es."UserId" AS "userId",
                    es."LocationId" AS "locationId",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    u."Avatar" AS "employeeAvatar",
                    u."JobTitle" AS "jobTitle"
                FROM "EmployeeSession" es
                INNER JOIN "Users" u
                    ON u."ID" = es."UserId"
                WHERE
                    es."ID" = $1
                    AND es."LocationId" = $2
                LIMIT 1
                `,
                [sessionid, locationid]
            )

            if (sessionResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Session not found.'
                })
            }

            const session = sessionResult.rows[0]

            const entriesResult = await pool.query(
                `
                SELECT
                    cm."ID" AS "id",
                    cm."CustomerId" AS "customerId",
                    cm."MachineId" AS "machineId",
                    m."MachineNumber" AS "machineNumber",
                    cm."Points"::double precision AS "points",
                    cm."DateAssign" AS "dateAssign",
                    cm."ImageUrl" AS "imageUrl",
                    cm."AssignedBy" AS "assignedBy",
                    cm."LocationId" AS "locationId",
                    cm."CheckinId" AS "checkinId",
                    COALESCE(cm."ReviewStatus", 'Pending') AS "reviewStatus",
                    cm."ReviewedBy" AS "reviewedBy",
                    cm."ReviewedAt" AS "reviewedAt",
                    COALESCE(NULLIF(BTRIM(ru."Name"), ''), ru."Username") AS "reviewedByName",
                    CONCAT_WS(
                        ' ',
                        NULLIF(BTRIM(c."Firstname"), ''),
                        NULLIF(BTRIM(c."Lastname"), '')
                    ) AS "customerName",
                    c."Phone" AS "customerPhone"
                FROM "CustomerMatch" cm
                LEFT JOIN "Customer" c
                    ON c."ID" = cm."CustomerId"
                LEFT JOIN "Machines" m
                    ON m."ID" = cm."MachineId"
                    AND m.locationid = cm."LocationId"
                LEFT JOIN "Users" ru
                    ON ru."ID" = cm."ReviewedBy"
                WHERE
                    cm."AssignedBy" = $1
                    AND cm."LocationId" = $2
                    AND cm."DateAssign" >= $3
                    AND (
                        $4::timestamptz IS NULL
                        OR cm."DateAssign" <= $4
                    )
                ORDER BY
                    cm."DateAssign" DESC,
                    cm."ID" DESC
                `,
                [
                    session.userId,
                    session.locationId,
                    session.clockIn,
                    session.clockOut
                ]
            )

            const entries = entriesResult.rows.map((row) => ({
                ...row,
                customerName:
                    row.customerName && row.customerName.trim()
                        ? row.customerName.trim()
                        : `Customer #${row.customerId}`
            }))

            const totalPoints = entries.reduce(
                (sum, item) => sum + Number(item.points || 0),
                0
            )

            const withPhoto = entries.filter(
                (item) => Boolean(item.imageUrl)
            ).length

            const approvedCount = entries.filter(
                (item) => item.reviewStatus === 'Approved'
            ).length

            const rejectedCount = entries.filter(
                (item) => item.reviewStatus === 'Rejected'
            ).length

            const pendingReview = entries.filter(
                (item) => !item.reviewStatus || item.reviewStatus === 'Pending'
            ).length

            const reviewedCount = approvedCount + rejectedCount

            const breakdownMap = new Map()

            for (const entry of entries) {
                const points = Number(entry.points || 0)
                const key = String(points)
                const current = breakdownMap.get(key) || {
                    points,
                    count: 0,
                    total: 0
                }

                current.count += 1
                current.total += points
                breakdownMap.set(key, current)
            }

            const breakdown = Array.from(breakdownMap.values())
                .sort((a, b) => b.points - a.points)

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session points report retrieved successfully.',
                data: {
                    session,
                    summary: {
                        totalPoints,
                        assignmentCount: entries.length,
                        withPhoto,
                        withoutPhoto: entries.length - withPhoto,
                        reviewedCount,
                        pendingReview,
                        approvedCount,
                        rejectedCount
                    },
                    breakdown,
                    entries
                }
            })
        } catch (error) {
            console.error('Session points report error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve session points report.'
            })
        }
    }
)


// ============================================================
// REPORTS - REVIEW CUSTOMER MATCH PHOTO
// Permission: employeesession.update
// ============================================================

router.put(
    '/reports/points/:matchid/review',
    requirePermission('employeesession.update'),
    async (req, res) => {
        try {
            const matchid = Number(req.params.matchid)
            const locationid = Number(req.body.locationid)
            const status = String(req.body.status || '').trim()
            const reviewedBy = Number(req.authUser?.id || 0)

            if (!matchid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Point entry and location are required.'
                })
            }

            if (!['Approved', 'Rejected'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Review status must be Approved or Rejected.'
                })
            }

            if (!reviewedBy) {
                return res.status(401).json({
                    success: false,
                    code: 40100,
                    message: 'Authenticated user is required.'
                })
            }

            const result = await pool.query(
                `
                UPDATE "CustomerMatch" cm
                SET
                    "ReviewStatus" = $1,
                    "ReviewedBy" = $2,
                    "ReviewedAt" = NOW()
                WHERE
                    cm."ID" = $3
                    AND cm."LocationId" = $4
                    AND NULLIF(BTRIM(COALESCE(cm."ImageUrl", '')), '') IS NOT NULL
                RETURNING
                    cm."ID" AS "id",
                    cm."ReviewStatus" AS "reviewStatus",
                    cm."ReviewedBy" AS "reviewedBy",
                    cm."ReviewedAt" AS "reviewedAt"
                `,
                [status, reviewedBy, matchid, locationid]
            )

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Point entry with reviewable photo was not found.'
                })
            }

            const reviewerResult = await pool.query(
                `
                SELECT
                    COALESCE(NULLIF(BTRIM("Name"), ''), "Username", 'User') AS "reviewedByName"
                FROM "Users"
                WHERE "ID" = $1
                LIMIT 1
                `,
                [reviewedBy]
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message: `Photo ${status.toLowerCase()} successfully.`,
                data: {
                    ...result.rows[0],
                    reviewedByName: reviewerResult.rows[0]?.reviewedByName || 'User'
                }
            })
        } catch (error) {
            console.error('Point photo review error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to update photo review.'
            })
        }
    }
)

// ============================================================
// REPORTS - READ-ONLY SHIFT CASH REPORT FOR ONE EMPLOYEE SESSION
// Uses the same cash types and America/Chicago point window as finance.
// No money is written, posted, transferred or recalculated in finance tables.
// ============================================================
router.get('/reports/session/:sessionid/shift', requirePermission('employeesession.read'), async (req, res) => {
    const sessionid = Number(req.params.sessionid)
    const locationid = Number(req.query.locationid)
    if (!Number.isSafeInteger(sessionid) || sessionid <= 0 ||
        !Number.isSafeInteger(locationid) || locationid <= 0) {
        return res.status(400).json({ success: false, code: 40000, message: 'Valid session and location are required.' })
    }

    const client = await pool.connect()
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const found = await client.query(`
            SELECT es."ID" AS id, es."UserId" AS "userId", es."LocationId" AS "locationId",
                   es."ClockIn" AS "clockIn", es."ClockOut" AS "clockOut",
                   es."TotalWorkingHours" AS "totalWorkingHours", es."ReadingSessionId" AS "readingSessionId",
                   COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                   l."CompanyId" AS "companyId"
            FROM "EmployeeSession" es
            JOIN "Users" u ON u."ID" = es."UserId"
            JOIN "Locations" l ON l."ID" = es."LocationId"
            WHERE es."ID" = $1 AND es."LocationId" = $2 LIMIT 1`, [sessionid, locationid])
        const session = found.rows[0]
        if (!session) {
            await client.query('ROLLBACK')
            return res.status(404).json({ success: false, code: 40400, message: 'Session not found.' })
        }
        const auth = req.authUser || {}
        const role = String(auth.roleName || '').trim().toLowerCase()
        const admin = ['owner', 'admin', 'system admin'].includes(role)
        if (!auth.id ||
            (role !== 'system admin' && Number(auth.companyId) !== Number(session.companyId)) ||
            (!admin && (Number(auth.id) !== Number(session.userId) || Number(auth.locationId) !== locationid))) {
            await client.query('ROLLBACK')
            return res.status(403).json({ success: false, code: 40300, message: 'Session access denied.' })
        }
        delete session.companyId

        // Identical components and arithmetic to employeeFinance.js balanceQuery.
        const totals = await client.query(`
            WITH cash AS (
                SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0)::numeric(14,2) AS "cashExpenses",
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals",
                       COUNT(t."ID")::integer AS entry_count
                FROM "SessionCashTransactions" t WHERE t."SessionId"=$1
            ), point_cash AS (
                SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS "pointsExpense",
                       COUNT(cm."ID")::integer AS "pointsCount"
                FROM "EmployeeSession" es
                LEFT JOIN "CustomerMatch" cm ON
                    cm."AssignedBy"=es."UserId" AND cm."LocationId"=es."LocationId"
                    AND cm."DateAssign">=(es."ClockIn" AT TIME ZONE 'America/Chicago')
                    AND cm."DateAssign"<=(COALESCE(es."ClockOut",NOW()) AT TIME ZONE 'America/Chicago')
                WHERE es."ID"=$1
            )
            SELECT cash.opening, cash.received, cash."cashExpenses", cash."ownerWithdrawals",
                   point_cash."pointsExpense", point_cash."pointsCount",
                   (cash."cashExpenses"+point_cash."pointsExpense")::numeric(14,2) AS expenses,
                   (cash.opening+cash.received-cash."cashExpenses"-point_cash."pointsExpense"-cash."ownerWithdrawals")::numeric(14,2) AS balance,
                   cash.entry_count
            FROM cash CROSS JOIN point_cash`, [sessionid])

        const cash = await client.query(`
            SELECT t."ID" AS id, t."Type" AS type, t."Amount"::numeric(14,2) AS amount,
                   t."CreatedAt" AS "eventAt", t."Notes" AS notes,
                   t."ExpenseTypeId" AS "expenseTypeId", et."Name" AS "expenseTypeName",
                   t."CreatedBy" AS "createdBy", t."FundingId" AS "fundingId",
                   t."TransferId" AS "transferId",
                   f."FundingType" AS "fundingType", f."Status" AS "fundingStatus",
                   COALESCE(NULLIF(BTRIM(fu."Name"),''),fu."Username") AS "fromAdmin",
                   h."FromSessionId" AS "fromSessionId",
                   COALESCE(NULLIF(BTRIM(hu."Name"),''),hu."Username") AS "fromEmployee",
                   COALESCE(NULLIF(BTRIM(actor."Name"),''),actor."Username") AS "createdByName"
            FROM "SessionCashTransactions" t
            LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
            LEFT JOIN "AdminCashFunding" f ON f."ID"=t."FundingId"
            LEFT JOIN "Users" fu ON fu."ID"=f."FromUserId"
            LEFT JOIN "SessionCashHandovers" h ON h."ID"=t."TransferId"
            LEFT JOIN "Users" hu ON hu."ID"=h."FromUserId"
            LEFT JOIN "Users" actor ON actor."ID"=t."CreatedBy"
            WHERE t."SessionId"=$1 AND t."LocationId"=$2
            ORDER BY t."CreatedAt",t."ID"`, [sessionid, locationid])

        const points = await client.query(`
            SELECT cm."ID" AS id, cm."Points"::numeric(14,2) AS amount,
                   (cm."DateAssign" AT TIME ZONE 'America/Chicago') AS "eventAt",
                   cm."CustomerId" AS "customerId", cm."MachineId" AS "machineId",
                   m."MachineNumber" AS "machineNumber",
                   COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',c."Firstname",c."Lastname")),''),
                            CONCAT('Customer #',cm."CustomerId")) AS "customerName"
            FROM "EmployeeSession" es
            JOIN "CustomerMatch" cm ON cm."AssignedBy"=es."UserId"
                AND cm."LocationId"=es."LocationId"
                AND cm."DateAssign">=(es."ClockIn" AT TIME ZONE 'America/Chicago')
                AND cm."DateAssign"<=(COALESCE(es."ClockOut",NOW()) AT TIME ZONE 'America/Chicago')
            LEFT JOIN "Customer" c ON c."ID"=cm."CustomerId"
            LEFT JOIN "Machines" m ON m."ID"=cm."MachineId" AND m.locationid=cm."LocationId"
            WHERE es."ID"=$1
            ORDER BY cm."DateAssign",cm."ID"`, [sessionid])

        const closingResult = await client.query(`
            SELECT c."ClosingBalance" AS "closingBalance", c."ActualCash" AS "actualCash",
                   c."Variance" AS variance, c."ClosedAt" AS "closedAt", c."HandoverId" AS "handoverId",
                   h."Amount" AS "handoverAmount", h."Status" AS "handoverStatus",
                   h."CreatedAt" AS "handoverCreatedAt", h."AcceptedAt" AS "handoverAcceptedAt",
                   h."Notes" AS "handoverNotes", h."ToSessionId" AS "toSessionId",
                   COALESCE(NULLIF(BTRIM(recipient."Name"),''),recipient."Username") AS "recipientName"
            FROM "SessionCashClosings" c
            LEFT JOIN "SessionCashHandovers" h ON h."ID"=c."HandoverId"
            LEFT JOIN "Users" recipient ON recipient."ID"=h."ToUserId"
            WHERE c."SessionId"=$1 AND c."LocationId"=$2
            LIMIT 1`, [sessionid, locationid])

        const summary = totals.rows[0]
        const transactions = [
            ...cash.rows.map(row => ({
                ...row, kind: 'CASH', signedAmount:
                    ['EXPENSE', 'OWNER_WITHDRAWAL'].includes(row.type) ? -Number(row.amount) : Number(row.amount)
            })),
            ...points.rows.map(row => ({
                ...row, kind: 'POINTS', type: 'POINTS_EXPENSE',
                signedAmount: -Number(row.amount), notes: null
            }))
        ].sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt) ||
            (a.kind === b.kind ? Number(a.id) - Number(b.id) : a.kind === 'CASH' ? -1 : 1))
        let running = 0
        for (const transaction of transactions) {
            running = Math.round((running + transaction.signedAmount) * 100) / 100
            transaction.runningBalance = running
        }
        await client.query('COMMIT')
        return res.json({
            success: true, code: 20000, message: 'Shift report retrieved successfully.',
            data: { session, summary, transactions, closing: closingResult.rows[0] || null }
        })
    } catch (error) {
        try { await client.query('ROLLBACK') } catch (_) { }
        console.error('Shift report error:', error)
        return res.status(500).json({ success: false, code: 50000, message: 'Unable to retrieve shift report.' })
    } finally { client.release() }
})

module.exports = router