const express = require('express')
const router = express.Router()

const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')
const { isAuditVerificationEnabled } = require('../utils/auditVerification')

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
                 SELECT 1 FROM "CustomerMatch" cm WHERE cm."EmployeeSessionId" = $1
                 UNION ALL
                 SELECT 1 FROM "Raffles" r WHERE r."EmployeeSessionId" = $1 AND r."Status"='WINNER'
                 UNION ALL
                 SELECT 1 FROM "TicketOuts" t WHERE t."EmployeeSessionId" = $1
                 UNION ALL
                 SELECT 1 FROM "BonusAwards" b WHERE b."EmployeeSessionId" = $1
                 UNION ALL
                 SELECT 1 FROM "LuckyBirdAwards" lb WHERE lb."EmployeeSessionId" = $1
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

                    ON cm."EmployeeSessionId" = es."ID"

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
                       COALESCE(c.cash_expenses, 0) AS cash_expenses,
                       COALESCE(r.raffle_expenses, 0) AS raffle_expenses,
                       COALESCE(tk.ticket_expenses, 0) AS ticket_expenses,
                       COALESCE(bn.bonus_expenses, 0) AS bonus_expenses,
                       COALESCE(lb.lucky_bird_expenses, 0) AS lucky_bird_expenses
                FROM selected_sessions es
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(cm."Points"),0) AS points
                    FROM "CustomerMatch" cm
                    WHERE cm."EmployeeSessionId" = es."ID"
                ) p ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'EXPENSE'),0) AS cash_expenses
                    FROM "SessionCashTransactions" t
                    WHERE t."SessionId" = es."ID" AND t."LocationId" = es."LocationId"
                ) c ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(r."WinningAmount"),0) AS raffle_expenses
                    FROM "Raffles" r WHERE r."EmployeeSessionId"=es."ID" AND r."Status"='WINNER'
                ) r ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(t."Amount"),0) AS ticket_expenses
                    FROM "TicketOuts" t WHERE t."EmployeeSessionId"=es."ID"
                ) tk ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(b."Amount"),0) AS bonus_expenses
                    FROM "BonusAwards" b WHERE b."EmployeeSessionId"=es."ID"
                ) bn ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(lb."Amount"),0) AS lucky_bird_expenses
                    FROM "LuckyBirdAwards" lb WHERE lb."EmployeeSessionId"=es."ID"
                ) lb ON true
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
                   COALESCE(SUM(s.raffle_expenses),0)::double precision AS "raffleExpenses",
                   COALESCE(SUM(s.ticket_expenses),0)::double precision AS "ticketOutExpenses",
                   COALESCE(SUM(s.bonus_expenses),0)::double precision AS "bonusExpenses",
                   COALESCE(SUM(s.lucky_bird_expenses),0)::double precision AS "luckyBirdExpenses",
                   COALESCE(SUM(s.cash_expenses + s.raffle_expenses + s.ticket_expenses + s.bonus_expenses + s.lucky_bird_expenses),0)::double precision AS "totalExpenses"
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
                    COALESCE(r.raffle_expenses,0)::double precision AS "raffleExpenses",
                    COALESCE(tk.ticket_expenses,0)::double precision AS "ticketOutExpenses",
                    COALESCE(bn.bonus_expenses,0)::double precision AS "bonusExpenses",
                    COALESCE(lb.lucky_bird_expenses,0)::double precision AS "luckyBirdExpenses",
                    (COALESCE(c.cash_expenses,0)+COALESCE(r.raffle_expenses,0)+COALESCE(tk.ticket_expenses,0)+COALESCE(bn.bonus_expenses,0)+COALESCE(lb.lucky_bird_expenses,0))::double precision AS "totalExpenses",

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
                    ON cm."EmployeeSessionId" = es."ID"
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'EXPENSE'),0) AS cash_expenses
                    FROM "SessionCashTransactions" t
                    WHERE t."SessionId" = es."ID" AND t."LocationId" = es."LocationId"
                ) c ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(r."WinningAmount"),0) AS raffle_expenses
                    FROM "Raffles" r WHERE r."EmployeeSessionId"=es."ID" AND r."Status"='WINNER'
                ) r ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(t."Amount"),0) AS ticket_expenses
                    FROM "TicketOuts" t WHERE t."EmployeeSessionId"=es."ID"
                ) tk ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(b."Amount"),0) AS bonus_expenses
                    FROM "BonusAwards" b WHERE b."EmployeeSessionId"=es."ID"
                ) bn ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(lb."Amount"),0) AS lucky_bird_expenses
                    FROM "LuckyBirdAwards" lb WHERE lb."EmployeeSessionId"=es."ID"
                ) lb ON true
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
                    es."ReadingSessionId", c.cash_expenses, r.raffle_expenses, tk.ticket_expenses, bn.bonus_expenses, lb.lucky_bird_expenses
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
                    COALESCE(SUM(cm."Points"), 0)::double precision AS "totalPoints",
                    (
                        SELECT COUNT(*)::integer
                        FROM "TicketOuts" tk
                        WHERE tk."EmployeeSessionId" = es."ID"
                          AND tk."LocationId" = es."LocationId"
                    ) AS "ticketOutEntries",
                    (
                        SELECT COALESCE(SUM(tk."Amount"), 0)::numeric(14,2)
                        FROM "TicketOuts" tk
                        WHERE tk."EmployeeSessionId" = es."ID"
                          AND tk."LocationId" = es."LocationId"
                    ) AS "ticketOutTotal",
                    (
                        SELECT COUNT(*)::integer
                        FROM "Raffles" r
                        WHERE r."EmployeeSessionId" = es."ID"
                          AND r."LocationId" = es."LocationId"
                          AND r."Status" = 'WINNER'
                    ) AS "raffleEntries",
                    (
                        SELECT COALESCE(SUM(r."WinningAmount"), 0)::numeric(14,2)
                        FROM "Raffles" r
                        WHERE r."EmployeeSessionId" = es."ID"
                          AND r."LocationId" = es."LocationId"
                          AND r."Status" = 'WINNER'
                    ) AS "raffleTotal",
                    (
                        SELECT COUNT(*)::integer
                        FROM "BonusAwards" b
                        WHERE b."EmployeeSessionId" = es."ID"
                          AND b."LocationId" = es."LocationId"
                    ) AS "bonusEntries",
                    (
                        SELECT COALESCE(SUM(b."Amount"), 0)::numeric(14,2)
                        FROM "BonusAwards" b
                        WHERE b."EmployeeSessionId" = es."ID"
                          AND b."LocationId" = es."LocationId"
                    ) AS "bonusTotal",
                    (
                        SELECT COUNT(*)::integer
                        FROM "LuckyBirdAwards" lb
                        WHERE lb."EmployeeSessionId" = es."ID"
                          AND lb."LocationId" = es."LocationId"
                    ) AS "luckyBirdEntries",
                    (
                        SELECT COALESCE(SUM(lb."Amount"), 0)::numeric(14,2)
                        FROM "LuckyBirdAwards" lb
                        WHERE lb."EmployeeSessionId" = es."ID"
                          AND lb."LocationId" = es."LocationId"
                    ) AS "luckyBirdTotal"
                FROM "EmployeeSession" es
                INNER JOIN "Users" u
                    ON u."ID" = es."UserId"
                LEFT JOIN "CustomerMatch" cm
                    ON cm."EmployeeSessionId" = es."ID"
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
                    m."MachineTypeId" AS "machineTypeId",
                    COALESCE(NULLIF(BTRIM(mt."TypeName"), ''), 'Unassigned') AS "machineTypeName",
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
                LEFT JOIN "MachineTypes" mt
                    ON mt."ID" = m."MachineTypeId"
                LEFT JOIN "Users" ru
                    ON ru."ID" = cm."ReviewedBy"
                WHERE
                    cm."EmployeeSessionId" = $1
                    AND cm."LocationId" = $2
                ORDER BY
                    cm."DateAssign" DESC,
                    cm."ID" DESC
                `,
                [
                    session.id,
                    session.locationId
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

            const machineTypeMap = new Map()
            const machineMap = new Map()

            for (const entry of entries) {
                const points = Number(entry.points || 0)
                const typeName = entry.machineTypeName || 'Unassigned'

                const typeItem = machineTypeMap.get(typeName) || {
                    machineTypeName: typeName,
                    totalPoints: 0,
                    entryCount: 0,
                    machineIds: new Set()
                }

                typeItem.totalPoints += points
                typeItem.entryCount += 1
                if (entry.machineId) typeItem.machineIds.add(Number(entry.machineId))
                machineTypeMap.set(typeName, typeItem)

                const machineKey = String(entry.machineId || 'unassigned')
                const machineItem = machineMap.get(machineKey) || {
                    machineId: entry.machineId || null,
                    machineNumber: entry.machineNumber ?? null,
                    machineTypeId: entry.machineTypeId || null,
                    machineTypeName: typeName,
                    totalPoints: 0,
                    entryCount: 0,
                    entries: []
                }

                machineItem.totalPoints += points
                machineItem.entryCount += 1
                machineItem.entries.push(entry)
                machineMap.set(machineKey, machineItem)
            }

            const machineTypeBreakdown = Array.from(machineTypeMap.values())
                .map(item => ({
                    machineTypeName: item.machineTypeName,
                    totalPoints: item.totalPoints,
                    entryCount: item.entryCount,
                    machineCount: item.machineIds.size
                }))
                .sort((a, b) =>
                    Number(b.totalPoints) - Number(a.totalPoints) ||
                    String(a.machineTypeName).localeCompare(String(b.machineTypeName))
                )

            const machines = Array.from(machineMap.values())
                .map(item => ({
                    ...item,
                    entries: item.entries.sort((a, b) =>
                        new Date(a.dateAssign) - new Date(b.dateAssign) ||
                        Number(a.id) - Number(b.id)
                    )
                }))
                .sort((a, b) =>
                    Number(b.totalPoints) - Number(a.totalPoints) ||
                    String(a.machineNumber ?? a.machineId ?? '')
                        .localeCompare(String(b.machineNumber ?? b.machineId ?? ''), undefined, { numeric: true })
                )

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
                    machineTypeBreakdown,
                    machines,
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
// REPORTS - RAFFLE REPORT FOR ONE SESSION
// Permission: employeesession.read
// Raffles is the source of truth and is linked by EmployeeSessionId.
// ============================================================

router.get(
    '/reports/session/:sessionid/raffle',
    requirePermission('employeesession.read'),
    async (req, res) => {
        const sessionid = Number(req.params.sessionid)
        const locationid = Number(req.query.locationid)

        if (!Number.isSafeInteger(sessionid) || sessionid <= 0 ||
            !Number.isSafeInteger(locationid) || locationid <= 0) {
            return res.status(400).json({
                success: false,
                code: 40000,
                message: 'Valid session and location are required.'
            })
        }

        try {
            const sessionResult = await pool.query(`
                SELECT
                    es."ID" AS id,
                    es."UserId" AS "userId",
                    es."LocationId" AS "locationId",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    u."Avatar" AS "employeeAvatar",
                    u."JobTitle" AS "jobTitle",
                    l."CompanyId" AS "companyId"
                FROM "EmployeeSession" es
                JOIN "Users" u ON u."ID" = es."UserId"
                JOIN "Locations" l ON l."ID" = es."LocationId"
                WHERE es."ID" = $1
                  AND es."LocationId" = $2
                LIMIT 1`,
                [sessionid, locationid]
            )

            const session = sessionResult.rows[0]

            if (!session) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Session not found.'
                })
            }

            const auth = req.authUser || {}
            const role = String(auth.roleName || '').trim().toLowerCase()
            const admin = ['owner', 'admin', 'system admin'].includes(role)

            if (!auth.id ||
                (role !== 'system admin' && Number(auth.companyId) !== Number(session.companyId)) ||
                (!admin && (Number(auth.id) !== Number(session.userId) ||
                    Number(auth.locationId) !== locationid))) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message: 'Session access denied.'
                })
            }

            delete session.companyId

            const entriesResult = await pool.query(`
                SELECT
                    r."ID" AS id,
                    r."WinningAmount"::numeric(14,2) AS amount,
                    r."WinnerImageUrl" AS "imageUrl",
                    r."CompletedAt" AS "createdAt",
                    r."WinnerCustomerId" AS "customerId",
                    r."WinningMachineId" AS "machineId",
                    m."MachineNumber" AS "machineNumber",
                    COALESCE(NULLIF(BTRIM(mt."TypeName"), ''), 'Unknown Game') AS game,
                    COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ', c."Firstname", c."Lastname")), ''),
                        CONCAT('Customer #', r."WinnerCustomerId")
                    ) AS "customerName",
                    c."avatar" AS "customerAvatar",
                    COALESCE(r."ReviewStatus", 'Pending') AS "reviewStatus",
                    r."ReviewedBy" AS "reviewedBy",
                    r."ReviewedAt" AS "reviewedAt",
                    COALESCE(NULLIF(BTRIM(ru."Name"), ''), ru."Username") AS "reviewedByName"
                FROM "Raffles" r
                JOIN "Machines" m
                  ON m."ID" = r."WinningMachineId"
                 AND m.locationid = r."LocationId"
                LEFT JOIN "MachineTypes" mt
                  ON mt."ID" = m."MachineTypeId"
                LEFT JOIN "Customer" c
                  ON c."ID" = r."WinnerCustomerId"
                LEFT JOIN "Users" ru
                  ON ru."ID" = r."ReviewedBy"
                WHERE r."EmployeeSessionId" = $1
                  AND r."LocationId" = $2
                  AND r."Status" = 'WINNER'
                ORDER BY r."CompletedAt" DESC, r."ID" DESC`,
                [sessionid, locationid]
            )

            const entries = entriesResult.rows
            const totalAmount = entries.reduce(
                (sum, item) => sum + Number(item.amount || 0),
                0
            )

            const machineIds = new Set(
                entries.map(item => Number(item.machineId)).filter(Boolean)
            )

            const approvedCount = entries.filter(
                item => item.reviewStatus === 'Approved'
            ).length

            const rejectedCount = entries.filter(
                item => item.reviewStatus === 'Rejected'
            ).length

            const pendingReview = entries.filter(
                item => !item.reviewStatus || item.reviewStatus === 'Pending'
            ).length

            const reviewedCount = approvedCount + rejectedCount

            let highest = null
            for (const entry of entries) {
                if (!highest || Number(entry.amount) > Number(highest.amount)) {
                    highest = entry
                }
            }

            const breakdownMap = new Map()
            const machineMap = new Map()

            for (const entry of entries) {
                const game = entry.game || 'Unknown Game'

                const gameItem = breakdownMap.get(game) || {
                    game,
                    totalAmount: 0,
                    winnerCount: 0
                }

                gameItem.totalAmount += Number(entry.amount || 0)
                gameItem.winnerCount += 1
                breakdownMap.set(game, gameItem)

                const machineKey = String(entry.machineId)
                const machineItem = machineMap.get(machineKey) || {
                    machineId: entry.machineId,
                    machineNumber: entry.machineNumber,
                    game,
                    totalAmount: 0,
                    winnerCount: 0,
                    entries: []
                }

                machineItem.totalAmount += Number(entry.amount || 0)
                machineItem.winnerCount += 1
                machineItem.entries.push(entry)
                machineMap.set(machineKey, machineItem)
            }

            const breakdown = Array.from(breakdownMap.values())
                .sort((a, b) =>
                    Number(b.totalAmount) - Number(a.totalAmount) ||
                    String(a.game).localeCompare(String(b.game))
                )

            const machines = Array.from(machineMap.values())
                .map(machine => ({
                    ...machine,
                    entries: machine.entries.sort((a, b) =>
                        new Date(a.createdAt) - new Date(b.createdAt) ||
                        Number(a.id) - Number(b.id)
                    )
                }))
                .sort((a, b) =>
                    Number(b.totalAmount) - Number(a.totalAmount) ||
                    String(a.machineNumber ?? a.machineId)
                        .localeCompare(String(b.machineNumber ?? b.machineId), undefined, { numeric: true })
                )

            const auditVerificationEnabled =
                await isAuditVerificationEnabled(pool, locationid)

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session Raffle report retrieved successfully.',
                data: {
                    session,
                    auditVerificationEnabled,
                    summary: {
                        totalAmount,
                        winnerCount: entries.length,
                        machineCount: machineIds.size,
                        highestAmount: highest ? Number(highest.amount || 0) : 0,
                        highestMachineNumber: highest?.machineNumber ?? null,
                        reviewedCount,
                        pendingReview,
                        approvedCount,
                        rejectedCount
                    },
                    breakdown,
                    machines,
                    entries
                }
            })
        } catch (error) {
            console.error('Session Raffle report error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve Raffle report.'
            })
        }
    }
)

// ============================================================
// REPORTS - REVIEW RAFFLE WINNER PHOTO
// Permission: employeesession.update
// ============================================================

router.put(
    '/reports/raffle/:raffleid/review',
    requirePermission('employeesession.update'),
    async (req, res) => {
        try {
            const raffleid = Number(req.params.raffleid)
            const locationid = Number(req.body.locationid)
            const status = String(req.body.status || '').trim()
            const reviewedBy = Number(req.authUser?.id || 0)

            if (!raffleid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Raffle winner and location are required.'
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

            const auditEnabled =
                await isAuditVerificationEnabled(pool, locationid)

            if (!auditEnabled) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message: 'Audit Verification is not enabled for this location.'
                })
            }

            const result = await pool.query(
                `
                UPDATE "Raffles" r
                SET
                    "ReviewStatus" = $1,
                    "ReviewedBy" = $2,
                    "ReviewedAt" = NOW()
                WHERE
                    r."ID" = $3
                    AND r."LocationId" = $4
                    AND r."Status" = 'WINNER'
                    AND NULLIF(BTRIM(COALESCE(r."WinnerImageUrl", '')), '') IS NOT NULL
                RETURNING
                    r."ID" AS "id",
                    r."ReviewStatus" AS "reviewStatus",
                    r."ReviewedBy" AS "reviewedBy",
                    r."ReviewedAt" AS "reviewedAt"
                `,
                [status, reviewedBy, raffleid, locationid]
            )

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Raffle winner with reviewable photo was not found.'
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
                message: `Raffle photo ${status.toLowerCase()} successfully.`,
                data: {
                    ...result.rows[0],
                    reviewedByName: reviewerResult.rows[0]?.reviewedByName || 'User'
                }
            })
        } catch (error) {
            console.error('Raffle photo review error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to update raffle photo review.'
            })
        }
    }
)

// ============================================================
// REPORTS - TICKET OUT REPORT FOR ONE SESSION
// Permission: employeesession.read
// TicketOuts is the source of truth and is linked by EmployeeSessionId.
// ============================================================

router.get(
    '/reports/session/:sessionid/ticket-out',
    requirePermission('employeesession.read'),
    async (req, res) => {
        const sessionid = Number(req.params.sessionid)
        const locationid = Number(req.query.locationid)

        if (!Number.isSafeInteger(sessionid) || sessionid <= 0 ||
            !Number.isSafeInteger(locationid) || locationid <= 0) {
            return res.status(400).json({
                success: false,
                code: 40000,
                message: 'Valid session and location are required.'
            })
        }

        try {
            const sessionResult = await pool.query(`
                SELECT
                    es."ID" AS id,
                    es."UserId" AS "userId",
                    es."LocationId" AS "locationId",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    u."Avatar" AS "employeeAvatar",
                    u."JobTitle" AS "jobTitle",
                    l."CompanyId" AS "companyId"
                FROM "EmployeeSession" es
                JOIN "Users" u ON u."ID" = es."UserId"
                JOIN "Locations" l ON l."ID" = es."LocationId"
                WHERE es."ID" = $1
                  AND es."LocationId" = $2
                LIMIT 1`,
                [sessionid, locationid]
            )

            const session = sessionResult.rows[0]

            if (!session) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Session not found.'
                })
            }

            const auth = req.authUser || {}
            const role = String(auth.roleName || '').trim().toLowerCase()
            const admin = ['owner', 'admin', 'system admin'].includes(role)

            if (!auth.id ||
                (role !== 'system admin' && Number(auth.companyId) !== Number(session.companyId)) ||
                (!admin && (Number(auth.id) !== Number(session.userId) ||
                    Number(auth.locationId) !== locationid))) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message: 'Session access denied.'
                })
            }

            delete session.companyId

            const entriesResult = await pool.query(`
                SELECT
                    tk."ID" AS id,
                    tk."Amount"::numeric(14,2) AS amount,
                    tk."ImageUrl" AS "imageUrl",
                    tk."CreatedAt" AS "createdAt",
                    tk."CustomerId" AS "customerId",
                    tk."MachineId" AS "machineId",
                    m."MachineNumber" AS "machineNumber",
                    COALESCE(NULLIF(BTRIM(mt."TypeName"), ''), 'Unknown Game') AS game,
                    COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ', c."Firstname", c."Lastname")), ''),
                        CONCAT('Customer #', tk."CustomerId")
                    ) AS "customerName"
                FROM "TicketOuts" tk
                JOIN "Machines" m
                  ON m."ID" = tk."MachineId"
                 AND m.locationid = tk."LocationId"
                LEFT JOIN "MachineTypes" mt
                  ON mt."ID" = m."MachineTypeId"
                LEFT JOIN "Customer" c
                  ON c."ID" = tk."CustomerId"
                WHERE tk."EmployeeSessionId" = $1
                  AND tk."LocationId" = $2
                ORDER BY tk."CreatedAt" DESC, tk."ID" DESC`,
                [sessionid, locationid]
            )

            const entries = entriesResult.rows
            const totalAmount = entries.reduce(
                (sum, item) => sum + Number(item.amount || 0),
                0
            )

            const machineIds = new Set(
                entries.map(item => Number(item.machineId)).filter(Boolean)
            )

            let highest = null
            for (const entry of entries) {
                if (!highest || Number(entry.amount) > Number(highest.amount)) {
                    highest = entry
                }
            }

            const breakdownMap = new Map()
            const machineMap = new Map()

            for (const entry of entries) {
                const game = entry.game || 'Unknown Game'

                const gameItem = breakdownMap.get(game) || {
                    game,
                    totalAmount: 0,
                    ticketCount: 0
                }

                gameItem.totalAmount += Number(entry.amount || 0)
                gameItem.ticketCount += 1
                breakdownMap.set(game, gameItem)

                const machineKey = String(entry.machineId)
                const machineItem = machineMap.get(machineKey) || {
                    machineId: entry.machineId,
                    machineNumber: entry.machineNumber,
                    game,
                    totalAmount: 0,
                    ticketCount: 0,
                    entries: []
                }

                machineItem.totalAmount += Number(entry.amount || 0)
                machineItem.ticketCount += 1
                machineItem.entries.push(entry)
                machineMap.set(machineKey, machineItem)
            }

            const breakdown = Array.from(breakdownMap.values())
                .sort((a, b) =>
                    Number(b.totalAmount) - Number(a.totalAmount) ||
                    String(a.game).localeCompare(String(b.game))
                )

            const machines = Array.from(machineMap.values())
                .map(machine => ({
                    ...machine,
                    entries: machine.entries.sort((a, b) =>
                        new Date(a.createdAt) - new Date(b.createdAt) ||
                        Number(a.id) - Number(b.id)
                    )
                }))
                .sort((a, b) =>
                    Number(b.totalAmount) - Number(a.totalAmount) ||
                    String(a.machineNumber ?? a.machineId)
                        .localeCompare(String(b.machineNumber ?? b.machineId), undefined, { numeric: true })
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session Ticket Out report retrieved successfully.',
                data: {
                    session,
                    summary: {
                        totalAmount,
                        ticketCount: entries.length,
                        machineCount: machineIds.size,
                        highestAmount: highest ? Number(highest.amount || 0) : 0,
                        highestMachineNumber: highest?.machineNumber ?? null
                    },
                    breakdown,
                    machines,
                    entries
                }
            })
        } catch (error) {
            console.error('Session Ticket Out report error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve Ticket Out report.'
            })
        }
    }
)


// ============================================================
// REPORTS - BONUS REPORT FOR ONE SESSION
// Permission: employeesession.read
// BonusAwards is the source of truth and is linked by EmployeeSessionId.
// ============================================================

router.get(
    '/reports/session/:sessionid/bonus',
    requirePermission('employeesession.read'),
    async (req, res) => {
        const sessionid = Number(req.params.sessionid)
        const locationid = Number(req.query.locationid)

        if (!Number.isSafeInteger(sessionid) || sessionid <= 0 ||
            !Number.isSafeInteger(locationid) || locationid <= 0) {
            return res.status(400).json({
                success: false,
                code: 40000,
                message: 'Valid session and location are required.'
            })
        }

        try {
            const sessionResult = await pool.query(`
                SELECT
                    es."ID" AS id,
                    es."UserId" AS "userId",
                    es."LocationId" AS "locationId",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    u."Avatar" AS "employeeAvatar",
                    u."JobTitle" AS "jobTitle",
                    l."CompanyId" AS "companyId"
                FROM "EmployeeSession" es
                JOIN "Users" u ON u."ID" = es."UserId"
                JOIN "Locations" l ON l."ID" = es."LocationId"
                WHERE es."ID" = $1
                  AND es."LocationId" = $2
                LIMIT 1`,
                [sessionid, locationid]
            )

            const session = sessionResult.rows[0]

            if (!session) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Session not found.'
                })
            }

            const auth = req.authUser || {}
            const role = String(auth.roleName || '').trim().toLowerCase()
            const admin = ['owner', 'admin', 'system admin'].includes(role)

            if (!auth.id ||
                (role !== 'system admin' && Number(auth.companyId) !== Number(session.companyId)) ||
                (!admin && (Number(auth.id) !== Number(session.userId) ||
                    Number(auth.locationId) !== locationid))) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message: 'Session access denied.'
                })
            }

            delete session.companyId

            const entriesResult = await pool.query(`
                SELECT
                    b."ID" AS id,
                    b."Amount"::numeric(14,2) AS amount,
                    b."ImageUrl" AS "imageUrl",
                    b."CreatedAt" AS "createdAt",
                    b."CustomerId" AS "customerId",
                    b."MachineId" AS "machineId",
                    b."BonusId" AS "bonusId",
                    b."BonusPayoutId" AS "bonusPayoutId",
                    b."BonusName" AS "bonusName",
                    b."PayoutDescription" AS "payoutDescription",
                    m."MachineNumber" AS "machineNumber",
                    COALESCE(NULLIF(BTRIM(mt."TypeName"), ''), 'Unknown Game') AS game,
                    COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ', c."Firstname", c."Lastname")), ''),
                        CONCAT('Customer #', b."CustomerId")
                    ) AS "customerName",
                    c."avatar" AS "customerAvatar",
                    COALESCE(b."ReviewStatus", 'Pending') AS "reviewStatus",
                    b."ReviewedBy" AS "reviewedBy",
                    b."ReviewedAt" AS "reviewedAt",
                    COALESCE(NULLIF(BTRIM(ru."Name"), ''), ru."Username") AS "reviewedByName"
                FROM "BonusAwards" b
                JOIN "Machines" m
                  ON m."ID" = b."MachineId"
                 AND m.locationid = b."LocationId"
                LEFT JOIN "MachineTypes" mt
                  ON mt."ID" = m."MachineTypeId"
                LEFT JOIN "Customer" c
                  ON c."ID" = b."CustomerId"
                LEFT JOIN "Users" ru
                  ON ru."ID" = b."ReviewedBy"
                WHERE b."EmployeeSessionId" = $1
                  AND b."LocationId" = $2
                ORDER BY b."CreatedAt" DESC, b."ID" DESC`,
                [sessionid, locationid]
            )

            const entries = entriesResult.rows
            const totalAmount = entries.reduce(
                (sum, item) => sum + Number(item.amount || 0),
                0
            )

            const machineIds = new Set(
                entries.map(item => Number(item.machineId)).filter(Boolean)
            )

            const approvedCount = entries.filter(
                item => item.reviewStatus === 'Approved'
            ).length

            const rejectedCount = entries.filter(
                item => item.reviewStatus === 'Rejected'
            ).length

            const pendingReview = entries.filter(
                item => !item.reviewStatus || item.reviewStatus === 'Pending'
            ).length

            const reviewedCount = approvedCount + rejectedCount

            let highest = null
            for (const entry of entries) {
                if (!highest || Number(entry.amount) > Number(highest.amount)) {
                    highest = entry
                }
            }

            const auditVerificationEnabled =
                await isAuditVerificationEnabled(pool, locationid)

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session Bonus report retrieved successfully.',
                data: {
                    session,
                    auditVerificationEnabled,
                    summary: {
                        totalAmount,
                        bonusCount: entries.length,
                        machineCount: machineIds.size,
                        highestAmount: highest ? Number(highest.amount || 0) : 0,
                        highestMachineNumber: highest?.machineNumber ?? null,
                        reviewedCount,
                        pendingReview,
                        approvedCount,
                        rejectedCount
                    },
                    entries
                }
            })
        } catch (error) {
            console.error('Session Bonus report error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve Bonus report.'
            })
        }
    }
)


// ============================================================
// REPORTS - REVIEW BONUS WINNER PHOTO
// Permission: employeesession.update
// ============================================================

router.put(
    '/reports/bonus/:bonusawardid/review',
    requirePermission('employeesession.update'),
    async (req, res) => {
        try {
            const bonusawardid = Number(req.params.bonusawardid)
            const locationid = Number(req.body.locationid)
            const status = String(req.body.status || '').trim()
            const reviewedBy = Number(req.authUser?.id || 0)

            if (!bonusawardid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Bonus award and location are required.'
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

            const auditEnabled =
                await isAuditVerificationEnabled(pool, locationid)

            if (!auditEnabled) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message: 'Audit Verification is not enabled for this location.'
                })
            }

            const result = await pool.query(
                `
                UPDATE "BonusAwards" b
                SET
                    "ReviewStatus" = $1,
                    "ReviewedBy" = $2,
                    "ReviewedAt" = NOW()
                WHERE
                    b."ID" = $3
                    AND b."LocationId" = $4
                    AND NULLIF(BTRIM(COALESCE(b."ImageUrl", '')), '') IS NOT NULL
                RETURNING
                    b."ID" AS "id",
                    b."ReviewStatus" AS "reviewStatus",
                    b."ReviewedBy" AS "reviewedBy",
                    b."ReviewedAt" AS "reviewedAt"
                `,
                [status, reviewedBy, bonusawardid, locationid]
            )

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Bonus award with reviewable photo was not found.'
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
                message: `Bonus photo ${status.toLowerCase()} successfully.`,
                data: {
                    ...result.rows[0],
                    reviewedByName: reviewerResult.rows[0]?.reviewedByName || 'User'
                }
            })
        } catch (error) {
            console.error('Bonus photo review error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to update bonus photo review.'
            })
        }
    }
)


// ============================================================
// ============================================================
// REPORTS - LUCKY BIRD REPORT FOR ONE SESSION
// Permission: employeesession.read
// LuckyBirdAwards is the source of truth and is linked by EmployeeSessionId.
// ============================================================

router.get(
    '/reports/session/:sessionid/lucky-bird',
    requirePermission('employeesession.read'),
    async (req, res) => {
        const sessionid = Number(req.params.sessionid)
        const locationid = Number(req.query.locationid)

        if (!Number.isSafeInteger(sessionid) || sessionid <= 0 ||
            !Number.isSafeInteger(locationid) || locationid <= 0) {
            return res.status(400).json({
                success: false,
                code: 40000,
                message: 'Valid session and location are required.'
            })
        }

        try {
            const sessionResult = await pool.query(`
                SELECT
                    es."ID" AS id,
                    es."UserId" AS "userId",
                    es."LocationId" AS "locationId",
                    es."ClockIn" AS "clockIn",
                    es."ClockOut" AS "clockOut",
                    es."TotalWorkingHours" AS "totalWorkingHours",
                    es."IsPaid" AS "isPaid",
                    COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Employee') AS "employeeName",
                    u."Avatar" AS "employeeAvatar",
                    u."JobTitle" AS "jobTitle",
                    l."CompanyId" AS "companyId"
                FROM "EmployeeSession" es
                JOIN "Users" u ON u."ID" = es."UserId"
                JOIN "Locations" l ON l."ID" = es."LocationId"
                WHERE es."ID" = $1
                  AND es."LocationId" = $2
                LIMIT 1`,
                [sessionid, locationid]
            )

            const session = sessionResult.rows[0]

            if (!session) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Session not found.'
                })
            }

            const auth = req.authUser || {}
            const role = String(auth.roleName || '').trim().toLowerCase()
            const admin = ['owner', 'admin', 'system admin'].includes(role)

            if (!auth.id ||
                (role !== 'system admin' && Number(auth.companyId) !== Number(session.companyId)) ||
                (!admin && (Number(auth.id) !== Number(session.userId) ||
                    Number(auth.locationId) !== locationid))) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message: 'Session access denied.'
                })
            }

            delete session.companyId

            const entriesResult = await pool.query(`
                SELECT
                    lb."ID" AS id,
                    lb."Amount"::numeric(14,2) AS amount,
                    lb."ImageUrl" AS "imageUrl",
                    lb."CreatedAt" AS "createdAt",
                    lb."CustomerId" AS "customerId",
                    lb."MachineId" AS "machineId",
                    lb."LuckyBirdName" AS "luckyBirdName",
                    lb."PayoutDescription" AS "payoutDescription",
                    m."MachineNumber" AS "machineNumber",
                    COALESCE(NULLIF(BTRIM(mt."TypeName"), ''), 'Unknown Game') AS game,
                    COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ', c."Firstname", c."Lastname")), ''),
                        CONCAT('Customer #', lb."CustomerId")
                    ) AS "customerName",
                    c."avatar" AS "customerAvatar",
                    COALESCE(lb."ReviewStatus", 'Pending') AS "reviewStatus",
                    lb."ReviewedBy" AS "reviewedBy",
                    lb."ReviewedAt" AS "reviewedAt",
                    COALESCE(NULLIF(BTRIM(ru."Name"), ''), ru."Username") AS "reviewedByName"
                FROM "LuckyBirdAwards" lb
                JOIN "Machines" m
                  ON m."ID" = lb."MachineId"
                 AND m.locationid = lb."LocationId"
                LEFT JOIN "MachineTypes" mt
                  ON mt."ID" = m."MachineTypeId"
                LEFT JOIN "Customer" c
                  ON c."ID" = lb."CustomerId"
                LEFT JOIN "Users" ru
                  ON ru."ID" = lb."ReviewedBy"
                WHERE lb."EmployeeSessionId" = $1
                  AND lb."LocationId" = $2
                ORDER BY lb."CreatedAt" DESC, lb."ID" DESC`,
                [sessionid, locationid]
            )

            const entries = entriesResult.rows
            const totalAmount = entries.reduce(
                (sum, item) => sum + Number(item.amount || 0),
                0
            )

            const machineIds = new Set(
                entries.map(item => Number(item.machineId)).filter(Boolean)
            )

            const auditVerificationEnabled =
                await isAuditVerificationEnabled(pool, locationid)

            const approvedCount = entries.filter(
                item => item.reviewStatus === 'Approved'
            ).length

            const rejectedCount = entries.filter(
                item => item.reviewStatus === 'Rejected'
            ).length

            const pendingReview = entries.filter(
                item => !item.reviewStatus || item.reviewStatus === 'Pending'
            ).length

            const reviewedCount = approvedCount + rejectedCount

            let highest = null
            for (const entry of entries) {
                if (!highest || Number(entry.amount) > Number(highest.amount)) {
                    highest = entry
                }
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message: 'Session Lucky Bird report retrieved successfully.',
                data: {
                    session,
                    auditVerificationEnabled,
                    summary: {
                        totalAmount,
                        luckyBirdCount: entries.length,
                        machineCount: machineIds.size,
                        highestAmount: highest ? Number(highest.amount || 0) : 0,
                        highestMachineNumber: highest?.machineNumber ?? null,
                        reviewedCount,
                        pendingReview,
                        approvedCount,
                        rejectedCount
                    },
                    entries
                }
            })
        } catch (error) {
            console.error('Session Lucky Bird report error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to retrieve Lucky Bird report.'
            })
        }
    }
)


// ============================================================
// REPORTS - REVIEW LUCKY BIRD PHOTO
// Permission: employeesession.update
// ============================================================

router.put(
    '/reports/lucky-bird/:luckybirdawardid/review',
    requirePermission('employeesession.update'),
    async (req, res) => {
        try {
            const luckybirdawardid = Number(req.params.luckybirdawardid)
            const locationid = Number(req.body.locationid)
            const status = String(req.body.status || '').trim()
            const reviewedBy = Number(req.authUser?.id || 0)

            if (!luckybirdawardid || !locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message: 'Lucky Bird award and location are required.'
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

            const auditEnabled =
                await isAuditVerificationEnabled(pool, locationid)

            if (!auditEnabled) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message: 'Audit Verification is not enabled for this location.'
                })
            }

            const result = await pool.query(
                `
                UPDATE "LuckyBirdAwards" lb
                SET
                    "ReviewStatus" = $1,
                    "ReviewedBy" = $2,
                    "ReviewedAt" = NOW()
                WHERE
                    lb."ID" = $3
                    AND lb."LocationId" = $4
                    AND NULLIF(BTRIM(COALESCE(lb."ImageUrl", '')), '') IS NOT NULL
                RETURNING
                    lb."ID" AS id,
                    lb."ReviewStatus" AS "reviewStatus",
                    lb."ReviewedBy" AS "reviewedBy",
                    lb."ReviewedAt" AS "reviewedAt"
                `,
                [status, reviewedBy, luckybirdawardid, locationid]
            )

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message: 'Lucky Bird award with reviewable photo was not found.'
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
                message: `Lucky Bird photo ${status.toLowerCase()}.`,
                data: {
                    ...result.rows[0],
                    reviewedByName:
                        reviewerResult.rows[0]?.reviewedByName || null
                }
            })
        } catch (error) {
            console.error('Lucky Bird photo review error:', error)

            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to update Lucky Bird photo review.'
            })
        }
    }
)

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

        // Keep this summary shape and arithmetic aligned with employeeFinance.js balanceQuery.
        const totals = await client.query(`
            WITH cash AS (
                SELECT
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='TRANSFER_OUT'),0)::numeric(14,2) AS "transferOut",
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0)::numeric(14,2) AS "cashExpenses",
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0)::numeric(14,2) AS "regularExpense",
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals",
                    COUNT(t."ID")::integer AS entry_count
                FROM "SessionCashTransactions" t
                WHERE t."SessionId"=$1
            ), point_cash AS (
                SELECT
                    COALESCE(SUM(cm."Points") FILTER (WHERE COALESCE(cm."IsExtraMatch",false)=false),0)::numeric(14,2) AS "matchPointExpense",
                    COALESCE(SUM(cm."Points") FILTER (WHERE COALESCE(cm."IsExtraMatch",false)=true),0)::numeric(14,2) AS "extraMatchExpense",
                    COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS "pointsExpense",
                    COUNT(cm."ID")::integer AS "pointsCount"
                FROM "CustomerMatch" cm
                WHERE cm."EmployeeSessionId"=$1
            ), raffle_cash AS (
                SELECT COALESCE(SUM(r."WinningAmount"),0)::numeric(14,2) AS "raffleExpense"
                FROM "Raffles" r
                WHERE r."EmployeeSessionId"=$1
                  AND r."Status"='WINNER'
            ), ticket_cash AS (
                SELECT COALESCE(SUM(tk."Amount"),0)::numeric(14,2) AS "ticketOutExpense"
                FROM "TicketOuts" tk
                WHERE tk."EmployeeSessionId"=$1
            ), bonus_cash AS (
                SELECT COALESCE(SUM(b."Amount"),0)::numeric(14,2) AS "bonusExpense"
                FROM "BonusAwards" b
                WHERE b."EmployeeSessionId"=$1
            ), lucky_bird_cash AS (
                SELECT COALESCE(SUM(lb."Amount"),0)::numeric(14,2) AS "luckyBirdExpense"
                FROM "LuckyBirdAwards" lb
                WHERE lb."EmployeeSessionId"=$1
            )
            SELECT
                cash.opening,
                cash.received,
                (cash.opening + cash.received)::numeric(14,2) AS "openingBank",
                cash."transferOut",
                cash."cashExpenses",
                cash."regularExpense",
                cash."ownerWithdrawals",
                point_cash."matchPointExpense",
                point_cash."extraMatchExpense",
                point_cash."pointsExpense",
                point_cash."pointsCount",
                raffle_cash."raffleExpense",
                ticket_cash."ticketOutExpense",
                bonus_cash."bonusExpense",
                lucky_bird_cash."luckyBirdExpense",
                (
                    cash."cashExpenses"
                    + point_cash."pointsExpense"
                    + raffle_cash."raffleExpense"
                    + ticket_cash."ticketOutExpense"
                    + bonus_cash."bonusExpense"
                    + lucky_bird_cash."luckyBirdExpense"
                )::numeric(14,2) AS expenses,
                (
                    cash.opening
                    + cash.received
                    - cash."transferOut"
                    - cash."cashExpenses"
                    - point_cash."pointsExpense"
                    - raffle_cash."raffleExpense"
                    - ticket_cash."ticketOutExpense"
                    - bonus_cash."bonusExpense"
                    - lucky_bird_cash."luckyBirdExpense"
                    - cash."ownerWithdrawals"
                )::numeric(14,2) AS balance,
                cash.entry_count
            FROM cash
            CROSS JOIN point_cash
            CROSS JOIN raffle_cash
            CROSS JOIN ticket_cash
            CROSS JOIN bonus_cash
            CROSS JOIN lucky_bird_cash`, [sessionid])

        const cash = await client.query(`
            SELECT t."ID" AS id, t."Type" AS type, t."Amount"::numeric(14,2) AS amount,
                   t."CreatedAt" AS "eventAt", t."Notes" AS notes,
                   t."ExpenseTypeId" AS "expenseTypeId", et."Name" AS "expenseTypeName",
                   t."CreditTypeId" AS "creditTypeId", ct."Name" AS "creditTypeName",
                   t."CreatedBy" AS "createdBy", t."FundingId" AS "fundingId",
                   t."TransferId" AS "transferId",
                   f."FundingType" AS "fundingType", f."Status" AS "fundingStatus",
                   COALESCE(NULLIF(BTRIM(fu."Name"),''),fu."Username") AS "fromAdmin",
                   h."FromSessionId" AS "fromSessionId",
                   COALESCE(NULLIF(BTRIM(hu."Name"),''),hu."Username") AS "fromEmployee",
                   COALESCE(NULLIF(BTRIM(actor."Name"),''),actor."Username") AS "createdByName",
                   CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                        THEN COALESCE(NULLIF(BTRIM(actor."Name"),''),actor."Username",'Owner/Admin')
                        ELSE NULL END AS "takenBy"
            FROM "SessionCashTransactions" t
            LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
            LEFT JOIN "CreditTypes" ct ON ct."ID"=t."CreditTypeId"
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
                   COALESCE(cm."IsExtraMatch",false) AS "isExtraMatch",
                   m."MachineNumber" AS "machineNumber",
                   COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',c."Firstname",c."Lastname")),''),
                            CONCAT('Customer #',cm."CustomerId")) AS "customerName"
            FROM "EmployeeSession" es
            JOIN "CustomerMatch" cm ON cm."EmployeeSessionId"=es."ID"
            LEFT JOIN "Customer" c ON c."ID"=cm."CustomerId"
            LEFT JOIN "Machines" m ON m."ID"=cm."MachineId" AND m.locationid=cm."LocationId"
            WHERE es."ID"=$1
            ORDER BY cm."DateAssign",cm."ID"`, [sessionid])

        const raffles = await client.query(`
            SELECT r."ID" AS id, r."WinningAmount"::numeric(14,2) AS amount,
                   r."CompletedAt" AS "eventAt", r."WinnerCustomerId" AS "customerId",
                   r."WinningMachineId" AS "machineId", m."MachineNumber" AS "machineNumber"
            FROM "Raffles" r
            LEFT JOIN "Machines" m ON m."ID"=r."WinningMachineId"
            WHERE r."EmployeeSessionId"=$1 AND r."Status"='WINNER'
            ORDER BY r."CompletedAt",r."ID"`, [sessionid])

        const tickets = await client.query(`
            SELECT t."ID" AS id, t."Amount"::numeric(14,2) AS amount,
                   t."CreatedAt" AS "eventAt", t."CustomerId" AS "customerId",
                   t."MachineId" AS "machineId", m."MachineNumber" AS "machineNumber"
            FROM "TicketOuts" t
            LEFT JOIN "Machines" m ON m."ID"=t."MachineId"
            WHERE t."EmployeeSessionId"=$1
            ORDER BY t."CreatedAt",t."ID"`, [sessionid])

        const bonuses = await client.query(`
            SELECT b."ID" AS id, b."Amount"::numeric(14,2) AS amount,
                   b."CreatedAt" AS "eventAt", b."CustomerId" AS "customerId",
                   b."MachineId" AS "machineId", m."MachineNumber" AS "machineNumber",
                   b."BonusName" AS "bonusName", b."PayoutDescription" AS "payoutDescription"
            FROM "BonusAwards" b
            LEFT JOIN "Machines" m ON m."ID"=b."MachineId"
            WHERE b."EmployeeSessionId"=$1
            ORDER BY b."CreatedAt",b."ID"`, [sessionid])

        const luckyBirds = await client.query(`
            SELECT lb."ID" AS id, lb."Amount"::numeric(14,2) AS amount,
                   lb."CreatedAt" AS "eventAt", lb."CustomerId" AS "customerId",
                   lb."MachineId" AS "machineId", m."MachineNumber" AS "machineNumber",
                   lb."LuckyBirdName" AS "luckyBirdName", lb."PayoutDescription" AS "payoutDescription"
            FROM "LuckyBirdAwards" lb
            LEFT JOIN "Machines" m ON m."ID"=lb."MachineId"
            WHERE lb."EmployeeSessionId"=$1
            ORDER BY lb."CreatedAt",lb."ID"`, [sessionid])

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
                ...row,
                kind: 'POINTS',
                type: row.isExtraMatch ? 'EXTRA_MATCH' : 'MATCH_POINT',
                expenseTypeName: row.isExtraMatch ? 'Extra Match' : 'Match Point',
                signedAmount: -Number(row.amount),
                notes: [
                    row.customerName || (row.customerId ? `Customer #${row.customerId}` : null),
                    row.machineNumber ? `Machine #${row.machineNumber}` : null
                ].filter(Boolean).join(' · ') || null
            })),
            ...raffles.rows.map(row => ({
                ...row,
                kind: 'RAFFLE',
                type: 'RAFFLE',
                expenseTypeName: 'Raffle',
                signedAmount: -Number(row.amount),
                notes: `Raffle #${row.id}${row.machineNumber ? ` · Machine #${row.machineNumber}` : ''}`
            })),
            ...tickets.rows.map(row => ({
                ...row,
                kind: 'TICKET_OUT',
                type: 'TICKET_OUT',
                expenseTypeName: 'Ticket Out',
                signedAmount: -Number(row.amount),
                notes: `Ticket Out #${row.id}${row.machineNumber ? ` · Machine #${row.machineNumber}` : ''}`
            })),
            ...bonuses.rows.map(row => ({
                ...row,
                kind: 'BONUS',
                type: 'BONUS',
                expenseTypeName: 'Bonus',
                signedAmount: -Number(row.amount),
                notes: [
                    row.bonusName || `Bonus #${row.id}`,
                    row.payoutDescription || null,
                    row.machineNumber ? `Machine #${row.machineNumber}` : null
                ].filter(Boolean).join(' · ')
            })),
            ...luckyBirds.rows.map(row => ({
                ...row,
                kind: 'LUCKY_BIRD',
                type: 'LUCKY_BIRD',
                expenseTypeName: 'Lucky Bird',
                signedAmount: -Number(row.amount),
                notes: [
                    row.luckyBirdName || `Lucky Bird #${row.id}`,
                    row.payoutDescription || null,
                    row.machineNumber ? `Machine #${row.machineNumber}` : null
                ].filter(Boolean).join(' · ')
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