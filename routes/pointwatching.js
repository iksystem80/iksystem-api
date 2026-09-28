const express = require('express')

const router = express.Router()

const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')

/*
====================================================
GET EMPLOYEES
Permission: pointwatching.read
====================================================
*/

router.get(
    '/employees',
    requirePermission('pointwatching.read'),
    async (req, res) => {
        try {
            const locationId =
                Number(req.query.locationid)

            if (!locationId) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        code: 40000,
                        message:
                            'Location is required.'
                    })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        u."ID" AS "id",
                        u."Name" AS "name",
                        u."Avatar" AS "avatar",

                        COALESCE(
                            r."Name",
                            ''
                        ) AS "role"

                    FROM "Users" u

                    LEFT JOIN "Roles" r
                        ON r."ID" =
                           u."RoleId"

                    WHERE
                        u."LocationId" = $1

                        AND
                        u."IsActive" = true

                    ORDER BY
                        u."Name"
                    `,
                    [
                        locationId
                    ]
                )

            return res
                .status(200)
                .json({
                    success: true,
                    code: 20000,
                    message:
                        'Employees retrieved successfully.',
                    data:
                        result.rows
                })

        } catch (error) {
            console.error(
                'Point watching employees error:',
                error
            )

            return res
                .status(500)
                .json({
                    success: false,
                    code: 50000,
                    message:
                        'Unable to retrieve employees.'
                })
        }
    }
)

/*
====================================================
POINTS BY DATE
Permission: pointwatching.read
====================================================
*/

router.get(
    '/by-date',
    requirePermission('pointwatching.read'),
    async (req, res) => {
        try {
            const locationId =
                Number(
                    req.query.locationid
                )

            const date =
                req.query.date

            if (!locationId) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        code: 40000,
                        message:
                            'Location is required.'
                    })
            }

            if (
                !date ||
                !/^\d{4}-\d{2}-\d{2}$/.test(
                    date
                )
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        code: 40000,
                        message:
                            'A valid date is required.'
                    })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        cm."ID"
                            AS "id",

                        cm."CustomerId"
                            AS "customerId",

                        CONCAT_WS(
                            ' ',
                            c."Firstname",
                            c."Lastname"
                        )
                            AS "fullName",

                        c.avatar
                            AS "avatar",

                        c."Phone"
                            AS "phone",

                        cm."Points"::double precision
                            AS "points",

                        cm."DateAssign"
                            AS "dateAssign",

                        cm."ImageUrl"
                            AS "pointPhoto",

                        cm."AssignedBy"
                            AS "employeeId",

                        u."Name"
                            AS "employeeName",

                        u."Avatar"
                            AS "employeeAvatar",

                        m."MachineNumber"
                            AS "machineNumber",

                        ci."Photo"
                            AS "checkinPhoto",

                        cm."CheckinId"
                            AS "checkinId"

                    FROM
                        "CustomerMatch" cm

                    INNER JOIN
                        "Customer" c
                        ON c."ID" =
                           cm."CustomerId"

                    LEFT JOIN
                        "Users" u
                        ON u."ID" =
                           cm."AssignedBy"

                    LEFT JOIN
                        "Machines" m
                        ON m."ID" =
                           cm."MachineId"

                    LEFT JOIN
                        "CheckIn" ci
                        ON ci."ID" =
                           cm."CheckinId"

                    WHERE
                        cm."LocationId" = $1

                        AND
                        cm."DateAssign" >=
                            $2::date

                        AND
                        cm."DateAssign" <
                            $2::date
                            + INTERVAL '1 day'

                    ORDER BY
                        cm."DateAssign" DESC
                    `,
                    [
                        locationId,
                        date
                    ]
                )

            return res
                .status(200)
                .json({
                    success: true,
                    code: 20000,
                    message:
                        'Point entries retrieved successfully.',
                    data:
                        result.rows
                })

        } catch (error) {
            console.error(
                'Points by date error:',
                error
            )

            return res
                .status(500)
                .json({
                    success: false,
                    code: 50000,
                    message:
                        'Unable to retrieve point entries.'
                })
        }
    }
)

/*
====================================================
POINTS BY EMPLOYEE
Permission: pointwatching.read
====================================================
*/

router.get(
    '/by-employee/:employeeId',
    requirePermission('pointwatching.read'),
    async (req, res) => {
        try {
            const employeeId =
                Number(
                    req.params.employeeId
                )

            const locationId =
                Number(
                    req.query.locationid
                )

            let days =
                Number(
                    req.query.days || 14
                )

            if (
                !employeeId ||
                !locationId
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        code: 40000,
                        message:
                            'Employee and location are required.'
                    })
            }

            if (
                !Number.isInteger(days) ||
                days < 1
            ) {
                days = 14
            }

            if (days > 90) {
                days = 90
            }

            // ======================================================
            // EMPLOYEE
            // ======================================================

            const employeeResult =
                await pool.query(
                    `
                    SELECT
                        u."ID"
                            AS "id",

                        u."Name"
                            AS "name",

                        u."Avatar"
                            AS "avatar",

                        COALESCE(
                            r."Name",
                            ''
                        )
                            AS "role"

                    FROM
                        "Users" u

                    LEFT JOIN
                        "Roles" r

                        ON
                            r."ID" =
                                u."RoleId"

                    WHERE
                        u."ID" = $1

                        AND

                        u."LocationId" = $2
                    `,
                    [
                        employeeId,
                        locationId
                    ]
                )

            if (
                employeeResult.rowCount === 0
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        code: 40400,
                        message:
                            'Employee not found.'
                    })
            }

            // ======================================================
            // SESSIONS
            // ======================================================

            const sessionsResult =
                await pool.query(
                    `
                    SELECT
                        es."ID"
                            AS "id",

                        es."ClockIn"
                            AS "clockIn",

                        es."ClockOut"
                            AS "clockOut",

                        es."TotalWorkingHours"::double precision
                            AS "totalWorkingHours",

                        es."IsPaid"
                            AS "isPaid",

                        CASE

                            WHEN
                                es."ClockOut" IS NULL

                            THEN
                                'IN_PROGRESS'

                            ELSE
                                'CLOSED'

                        END
                            AS "status",

                        COALESCE(
                            COUNT(cm."ID"),
                            0
                        )::integer
                            AS "entries",

                        COALESCE(
                            SUM(cm."Points"),
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
                            es."ClockOut" IS NULL

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
                        employeeId,
                        locationId,
                        days
                    ]
                )

            const sessions =
                sessionsResult.rows

            // ======================================================
            // SUMMARY
            // ======================================================

            const uniqueDays =
                new Set()

            let totalPoints =
                0

            let totalEntries =
                0

            let totalHours =
                0

            let activeSessions =
                0

            sessions.forEach(
                session => {
                    const date =
                        new Date(
                            session.clockIn
                        )

                    const dayKey =
                        [
                            date.getFullYear(),
                            date.getMonth(),
                            date.getDate()
                        ].join('-')

                    uniqueDays.add(
                        dayKey
                    )

                    totalPoints +=
                        Number(
                            session.points || 0
                        )

                    totalEntries +=
                        Number(
                            session.entries || 0
                        )

                    if (
                        session.status ===
                        'IN_PROGRESS'
                    ) {
                        activeSessions += 1
                    } else {
                        totalHours +=
                            Number(
                                session.totalWorkingHours ||
                                0
                            )
                    }
                }
            )

            // Add running active-session hours
            sessions
                .filter(
                    session =>
                        session.status ===
                        'IN_PROGRESS'
                )
                .forEach(
                    session => {
                        const start =
                            new Date(
                                session.clockIn
                            ).getTime()

                        const current =
                            Date.now()

                        totalHours +=
                            Math.max(
                                0,
                                (
                                    current -
                                    start
                                ) /
                                1000 /
                                3600
                            )
                    }
                )

            const summary = {
                daysWorked:
                    uniqueDays.size,

                totalSessions:
                    sessions.length,

                pointsGiven:
                    totalPoints,

                totalEntries:
                    totalEntries,

                totalWorkingHours:
                    Number(
                        totalHours.toFixed(2)
                    ),

                activeSessions:
                    activeSessions
            }

            return res
                .status(200)
                .json({
                    success: true,
                    code: 20000,

                    message:
                        'Employee point activity retrieved successfully.',

                    data: {
                        employee:
                            employeeResult.rows[0],

                        summary,

                        sessions
                    }
                })

        } catch (error) {
            console.error(
                'Points by employee error:',
                error
            )

            return res
                .status(500)
                .json({
                    success: false,
                    code: 50000,
                    message:
                        'Unable to retrieve employee point activity.'
                })
        }
    }
)

// ============================================================
// POINT ENTRIES INSIDE ONE EMPLOYEE SESSION
// Permission: pointwatching.read
// ============================================================

router.get(
    '/session/:sessionId/entries',
    requirePermission('pointwatching.read'),
    async (req, res) => {
        try {
            const sessionId =
                Number(
                    req.params.sessionId
                )

            if (!sessionId) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        code: 40000,
                        message:
                            'Invalid session.'
                    })
            }

            // ======================================================
            // GET SESSION
            // ======================================================

            const sessionResult =
                await pool.query(
                    `
                    SELECT
                        "ID"
                            AS "id",

                        "UserId"
                            AS "userId",

                        "LocationId"
                            AS "locationId",

                        "ClockIn"
                            AS "clockIn",

                        "ClockOut"
                            AS "clockOut"

                    FROM
                        "EmployeeSession"

                    WHERE
                        "ID" = $1
                    `,
                    [
                        sessionId
                    ]
                )

            if (
                sessionResult.rowCount === 0
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        code: 40400,
                        message:
                            'Employee session not found.'
                    })
            }

            const session =
                sessionResult.rows[0]

            // ======================================================
            // GET POINT ENTRIES BETWEEN CLOCK IN AND CLOCK OUT
            // ======================================================

            const result =
                await pool.query(
                    `
                    SELECT
                        cm."ID"
                            AS "id",

                        cm."CustomerId"
                            AS "customerId",

                        CONCAT_WS(
                            ' ',
                            c."Firstname",
                            c."Lastname"
                        )
                            AS "fullName",

                        c.avatar
                            AS "avatar",

                        c."Phone"
                            AS "phone",

                        cm."Points"::double precision
                            AS "points",

                        cm."DateAssign"
                            AS "dateAssign",

                        cm."ImageUrl"
                            AS "pointPhoto",

                        cm."CheckinId"
                            AS "checkinId",

                        m."MachineNumber"
                            AS "machineNumber",

                        ci."Photo"
                            AS "checkinPhoto"

                    FROM
                        "CustomerMatch" cm

                    INNER JOIN
                        "Customer" c

                        ON
                            c."ID" =
                                cm."CustomerId"

                    LEFT JOIN
                        "Machines" m

                        ON
                            m."ID" =
                                cm."MachineId"

                    LEFT JOIN
                        "CheckIn" ci

                        ON
                            ci."ID" =
                                cm."CheckinId"

                    WHERE
                        cm."AssignedBy" = $1

                        AND

                        cm."LocationId" = $2

                        AND

                        cm."DateAssign" >= $3

                        AND
                        (
                            $4::timestamptz IS NULL

                            OR

                            cm."DateAssign" <= $4
                        )

                    ORDER BY
                        cm."DateAssign" DESC
                    `,
                    [
                        session.userId,
                        session.locationId,
                        session.clockIn,
                        session.clockOut
                    ]
                )

            return res
                .status(200)
                .json({
                    success: true,
                    code: 20000,

                    message:
                        'Session point entries retrieved successfully.',

                    data:
                        result.rows
                })

        } catch (error) {
            console.error(
                'Session point entries error:',
                error
            )

            return res
                .status(500)
                .json({
                    success: false,
                    code: 50000,

                    message:
                        'Unable to retrieve session point entries.'
                })
        }
    }
)

module.exports = router