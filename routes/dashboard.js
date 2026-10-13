const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth')
const { pool } = require('../db')
const { requireModuleAccess, requireAnyAssignedModule } = require('../utils/moduleAccess')

// ============================================================
// HELPER
// ============================================================

function normalizeRoleName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
}


// ============================================================
// GET DASHBOARD
// ============================================================

router.get(
    '/getdashboard', authenticate,
    async (req, res) => {

        try {

            const {
                locationid
            } = req.query

            if (!locationid) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            'Location is required.',
                        code: 40000,
                    })
            }

            const locationId = Number(locationid)

            const userId = Number(req.authUser.id)

            const roleName = normalizeRoleName(req.authUser.roleName)

            // ====================================================
            // DETERMINE POINT ACCESS
            // ====================================================

            const canSeeAllEmployeePoints =
                roleName === 'owner' ||
                roleName === 'admin' ||
                roleName === 'system admin'

            console.log(
                'Dashboard role:',
                roleName
            )

            console.log(
                'Dashboard user:',
                userId
            )

            console.log(
                'Dashboard location:',
                locationId
            )

            console.log(
                'Can see all points:',
                canSeeAllEmployeePoints
            )

            // ====================================================
            // VERIFY LOCATION ACCESS
            // ====================================================

            if (
                roleName !== 'system admin'
            ) {

                const locationResult =
                    await pool.query(
                        `
                        SELECT
                            "ID",
                            "CompanyId"

                        FROM "Locations"

                        WHERE
                            "ID" = $1

                        LIMIT 1
                        `,
                        [
                            locationId
                        ]
                    )

                if (
                    locationResult.rows.length === 0
                ) {

                    return res
                        .status(404)
                        .json({
                            success: false,
                            message:
                                'Location not found.',
                            code: 50000,
                        })
                }

                const locationCompanyId =
                    Number(
                        locationResult
                            .rows[0]
                            .CompanyId
                    )

                if (
                    locationCompanyId !==
                    Number(
                        req.authUser.companyId
                    )
                ) {

                    return res
                        .status(403)
                        .json({
                            success: false,
                            message:
                                'You do not have access to this location.',
                            code: 50000,
                        })
                }
            }

            // ====================================================
            // DASHBOARD
            // ====================================================

            const result =
                await pool.query(
                    `
                    SELECT

                        -- ==========================================
                        -- TOTAL CUSTOMERS
                        -- ==========================================

                        (
                            SELECT
                                COUNT("ID")

                            FROM "Customer"

                            WHERE
                                "locationid" = $1
                        ) AS "TotalCustomers",


                        -- ==========================================
                        -- TODAY VISITS
                        -- ==========================================

                        (
                            SELECT
                                COUNT("ID")

                            FROM "CheckIn"

                            WHERE
                                "CheckInDate" >=
                                    CURRENT_DATE

                                AND
                                "CheckInDate" <
                                    CURRENT_DATE +
                                    INTERVAL '1 day'

                                AND
                                "LocationId" = $1
                        ) AS "TodayVisits",


                        -- ==========================================
                        -- CURRENT CHECK-INS
                        -- ==========================================

                        (
                            SELECT
                                COUNT("ID")

                            FROM "CheckIn"

                            WHERE
                                "CheckInDate" >=
                                    CURRENT_DATE

                                AND
                                "CheckInDate" <
                                    CURRENT_DATE +
                                    INTERVAL '1 day'

                                AND
                                "IsCheckOut" = false

                                AND
                                "LocationId" = $1
                        ) AS "CurrentCheckin",


                        -- ==========================================
                        -- TODAY MATCH POINTS
                        --
                        -- Owner/Admin/System Admin:
                        --     all employees
                        --
                        -- Other roles:
                        --     only own assigned points
                        -- ==========================================

                        (
                            SELECT
                                COALESCE(
                                    SUM("Points"),
                                    0
                                )

                            FROM "CustomerMatch"

                            WHERE
                                "LocationId" = $1

                                AND
                                "DateAssign" >=
                                    CURRENT_DATE

                                AND
                                "DateAssign" <
                                    CURRENT_DATE +
                                    INTERVAL '1 day'

                                AND
                                (
                                    $2::boolean = true

                                    OR

                                    "AssignedBy" = $3
                                )
                        ) AS "MatchAmount"
                    `,
                    [
                        locationId,
                        canSeeAllEmployeePoints,
                        userId
                    ]
                )

            return res
                .status(200)
                .json({
                    success: true,
                    message:
                        'Dashboard loaded successfully!',
                    code: 20000,
                    data:
                        result.rows,
                })

        } catch (error) {

            console.error(
                'Get dashboard error:',
                error
            )

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        'Error while getting dashboard.',
                    code: 50000,
                })
        }
    }
)


// ============================================================
// MATCH POINTS BY EMPLOYEE
// LAST 7 DAYS
// ============================================================

router.get(
    '/match-points-by-employee',  authenticate,
    requireAnyAssignedModule(),
    async (req, res) => {

        try {

            const locationId =
                Number(
                    req.query.locationid
                )

            if (
                !Number.isInteger(locationId) ||
                locationId <= 0
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            'Valid location id is required.',
                        code: 40000
                    })
            }


            const roleName =
                normalizeRoleName(
                    req.authUser.roleName
                )


            // ====================================================
            // VERIFY LOCATION ACCESS
            // Same security logic used by /getdashboard
            // ====================================================

            if (
                roleName !== 'system admin'
            ) {

                const locationResult =
                    await pool.query(
                        `
                        SELECT
                            "ID",
                            "CompanyId"

                        FROM "Locations"

                        WHERE
                            "ID" = $1

                        LIMIT 1
                        `,
                        [
                            locationId
                        ]
                    )


                if (
                    locationResult.rows.length === 0
                ) {

                    return res
                        .status(404)
                        .json({
                            success: false,
                            message:
                                'Location not found.',
                            code: 50000,
                        })
                }


                const locationCompanyId =
                    Number(
                        locationResult
                            .rows[0]
                            .CompanyId
                    )


                if (
                    locationCompanyId !==
                    Number(
                        req.authUser.companyId
                    )
                ) {

                    return res
                        .status(403)
                        .json({
                            success: false,
                            message:
                                'You do not have access to this location.',
                            code: 50000,
                        })
                }
            }


            // ====================================================
            // GET LAST 7 DAYS
            //
            // Includes:
            // Today
            // Today - 1
            // ...
            // Today - 6
            //
            // All employees at the location are included,
            // even if they have 0 points on a particular day.
            // ====================================================

            const result =
                await pool.query(
                    `
                    WITH date_range AS
                    (
                        SELECT
                            generate_series(
                                (
                                    CURRENT_TIMESTAMP
                                    AT TIME ZONE
                                    'America/Chicago'
                                )::date - 6,

                                (
                                    CURRENT_TIMESTAMP
                                    AT TIME ZONE
                                    'America/Chicago'
                                )::date,

                                interval '1 day'
                            )::date
                                AS activity_date
                    ),


                    employees AS
                    (
                        SELECT
                            u."ID"
                                AS employee_id,

                            u."Name"
                                AS employee_name

                        FROM "Users" u

                        WHERE
                            u."LocationId" = $1
                    ),


                    match_totals AS
                    (
                        SELECT
                            cm."AssignedBy"
                                AS employee_id,

                            cm."DateAssign"::date
                                AS activity_date,

                            COALESCE(
                                SUM(
                                    cm."Points"
                                ),
                                0
                            )::numeric
                                AS total_points

                        FROM "CustomerMatch" cm

                        WHERE
                            cm."LocationId" = $1

                            AND
                            cm."AssignedBy"
                                IS NOT NULL

                            AND
                            cm."DateAssign"::date
                            BETWEEN
                            (
                                (
                                    CURRENT_TIMESTAMP
                                    AT TIME ZONE
                                    'America/Chicago'
                                )::date - 6
                            )
                            AND
                            (
                                CURRENT_TIMESTAMP
                                AT TIME ZONE
                                'America/Chicago'
                            )::date

                        GROUP BY
                            cm."AssignedBy",
                            cm."DateAssign"::date
                    )


                    SELECT
                        d.activity_date,

                        TO_CHAR(
                            d.activity_date,
                            'Dy'
                        ) AS day_label,

                        e.employee_id,

                        e.employee_name,

                        COALESCE(
                            mt.total_points,
                            0
                        ) AS total_points

                    FROM date_range d

                    CROSS JOIN employees e


                    LEFT JOIN match_totals mt

                        ON
                            mt.employee_id =
                            e.employee_id

                        AND
                            mt.activity_date =
                            d.activity_date


                    ORDER BY
                        d.activity_date ASC,
                        e.employee_name ASC,
                        e.employee_id ASC
                    `,
                    [
                        locationId
                    ]
                )


            // ====================================================
            // TRANSFORM DATABASE RESULTS
            //
            // Database result example:
            //
            // Monday + Employee A + 100
            // Monday + Employee B + 120
            // Tuesday + Employee A + 80
            //
            // Frontend result:
            //
            // dates:
            // [
            //   { date, label }
            // ]
            //
            // employees:
            // [
            //   {
            //     id,
            //     name,
            //     data: [100,80,...]
            //   }
            // ]
            // ====================================================

            const rows =
                result.rows || []


            const dateMap =
                new Map()


            const employeeMap =
                new Map()


            for (
                const row of rows
            ) {

                const dateKey =
                    row.activity_date
                        instanceof Date

                        ? row.activity_date
                            .toISOString()
                            .slice(
                                0,
                                10
                            )

                        : String(
                            row.activity_date
                        )
                            .slice(
                                0,
                                10
                            )


                // =================================================
                // DATE
                // =================================================

                if (
                    !dateMap.has(
                        dateKey
                    )
                ) {

                    dateMap.set(
                        dateKey,
                        {
                            date:
                                dateKey,

                            label:
                                row
                                    .day_label
                                    ?.trim()
                                ||
                                dateKey
                        }
                    )
                }


                // =================================================
                // EMPLOYEE
                // =================================================

                if (
                    !employeeMap.has(
                        row.employee_id
                    )
                ) {

                    employeeMap.set(
                        row.employee_id,
                        {
                            id:
                                row.employee_id,

                            name:
                                row.employee_name
                                ||
                                `Employee ${row.employee_id}`,

                            pointsByDate:
                                {}
                        }
                    )
                }


                employeeMap
                    .get(
                        row.employee_id
                    )
                    .pointsByDate[
                        dateKey
                    ] =
                    Number(
                        row.total_points
                        ||
                        0
                    )
            }


            // ====================================================
            // DATES
            // ====================================================

            const dates =
                Array.from(
                    dateMap.values()
                )


            // ====================================================
            // EMPLOYEE SERIES
            // ====================================================

            const employees =
                Array.from(
                    employeeMap.values()
                )
                    .map(
                        employee => ({
                            id:
                                employee.id,

                            name:
                                employee.name,

                            data:
                                dates.map(
                                    date =>
                                        Number(
                                            employee
                                                .pointsByDate[
                                                date.date
                                            ]
                                            ||
                                            0
                                        )
                                )
                        })
                    )


            // ====================================================
            // RETURN
            // ====================================================

            return res
                .status(200)
                .json({
                    success: true,

                    message:
                        'Match point chart data retrieved successfully.',

                    code: 20000,

                    data: {

                        dates,

                        employees,

                        startDate:
                            dates.length
                                ? dates[0].date
                                : null,

                        endDate:
                            dates.length
                                ? dates[
                                    dates.length - 1
                                ].date
                                : null
                    }
                })


        } catch (error) {

            console.error(
                'Get match points by employee error:',
                error
            )


            return res
                .status(500)
                .json({
                    success: false,

                    message:
                        'Unable to retrieve match point chart data.',

                    code: 50000
                })
        }
    }
)


// ============================================================
// ACTIVE EMPLOYEE SESSIONS
// Admin dashboard: current clocked-in employees + live balance
// ============================================================

router.get(
    '/active-employee-sessions',
    authenticate,
    async (req, res) => {
        try {
            const locationId = Number(req.query.locationid)
            const roleName = normalizeRoleName(req.authUser?.roleName)

            if (!Number.isInteger(locationId) || locationId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid location id is required.',
                    code: 40000
                })
            }

            if (!['owner', 'admin', 'system admin'].includes(roleName)) {
                return res.status(403).json({
                    success: false,
                    message: 'Admin dashboard access is required.',
                    code: 40300
                })
            }

            const locationResult = await pool.query(
                `SELECT "ID", "CompanyId" FROM "Locations" WHERE "ID"=$1 LIMIT 1`,
                [locationId]
            )

            if (!locationResult.rowCount) {
                return res.status(404).json({
                    success: false,
                    message: 'Location not found.',
                    code: 40400
                })
            }

            if (roleName !== 'system admin') {
                if (Number(locationResult.rows[0].CompanyId) !== Number(req.authUser?.companyId)) {
                    return res.status(403).json({
                        success: false,
                        message: 'You do not have access to this location.',
                        code: 40300
                    })
                }

                if (roleName === 'admin' && Number(req.authUser?.locationId) !== locationId) {
                    const access = await pool.query(
                        `SELECT 1
                         FROM "UserLocationAccess"
                         WHERE "UserId"=$1 AND "LocationId"=$2
                         LIMIT 1`,
                        [Number(req.authUser.id), locationId]
                    )

                    if (!access.rowCount) {
                        return res.status(403).json({
                            success: false,
                            message: 'You do not have access to this location.',
                            code: 40300
                        })
                    }
                }
            }

            const result = await pool.query(
                `
                WITH active_sessions AS (
                    SELECT
                        es."ID" AS "sessionId",
                        es."UserId" AS "userId",
                        es."LocationId" AS "locationId",
                        es."ClockIn" AS "clockIn",
                        u."Name" AS "name",
                        u."Username" AS "username",
                        u."Avatar" AS "avatar",
                        u."JobTitle" AS "jobTitle"
                    FROM "EmployeeSession" es
                    JOIN "Users" u ON u."ID"=es."UserId"
                    JOIN "Roles" r ON r."ID"=u."RoleId"
                    WHERE es."LocationId"=$1
                      AND es."ClockOut" IS NULL
                      AND COALESCE(u."IsActive",true)=true
                      AND LOWER(BTRIM(r."Name"))='employee'
                )
                SELECT
                    s."sessionId",
                    s."userId",
                    s."clockIn",
                    COALESCE(NULLIF(BTRIM(s."name"),''),s."username",'Employee') AS "name",
                    s."avatar",
                    s."jobTitle",
                    ROUND((EXTRACT(EPOCH FROM (NOW()-s."clockIn"))/60)::numeric,0)::integer AS "elapsedMinutes",
                    (cash.opening + cash.received)::numeric(14,2) AS "openingBank",
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
                    )::numeric(14,2) AS "balance"
                FROM active_sessions s
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='TRANSFER_OUT'),0)::numeric(14,2) AS "transferOut",
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0)::numeric(14,2) AS "cashExpenses",
                        COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals"
                    FROM "SessionCashTransactions" t
                    WHERE t."SessionId"=s."sessionId"
                ) cash ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS "pointsExpense"
                    FROM "CustomerMatch" cm
                    WHERE cm."EmployeeSessionId"=s."sessionId"
                      AND cm."LocationId"=$1
                ) point_cash ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(rf."WinningAmount"),0)::numeric(14,2) AS "raffleExpense"
                    FROM "Raffles" rf
                    WHERE rf."EmployeeSessionId"=s."sessionId"
                      AND rf."Status"='WINNER'
                ) raffle_cash ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(tk."Amount"),0)::numeric(14,2) AS "ticketOutExpense"
                    FROM "TicketOuts" tk
                    WHERE tk."EmployeeSessionId"=s."sessionId"
                ) ticket_cash ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(b."Amount"),0)::numeric(14,2) AS "bonusExpense"
                    FROM "BonusAwards" b
                    WHERE b."EmployeeSessionId"=s."sessionId"
                ) bonus_cash ON true
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(lb."Amount"),0)::numeric(14,2) AS "luckyBirdExpense"
                    FROM "LuckyBirdAwards" lb
                    WHERE lb."EmployeeSessionId"=s."sessionId"
                ) lucky_bird_cash ON true
                ORDER BY s."clockIn" ASC, s."sessionId" ASC
                `,
                [locationId]
            )

            return res.status(200).json({
                success: true,
                message: 'Current employee sessions retrieved successfully.',
                code: 20000,
                data: result.rows
            })
        } catch (error) {
            console.error('Active employee sessions dashboard error:', error)

            return res.status(500).json({
                success: false,
                message: 'Unable to retrieve current employee sessions.',
                code: 50000
            })
        }
    }
)


module.exports = router