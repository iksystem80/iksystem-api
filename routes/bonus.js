const express = require('express')
const multer = require('multer')
const router = express.Router()

const { pool } = require('../db')
const cloudinary = require('../config/cloudinary')
const { requirePermission } = require('../middleware/auth')

const bonusGiveUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = Boolean(file?.mimetype?.startsWith('image/'))
        cb(allowed ? null : new Error('Only images are allowed.'), allowed)
    }
})

const bonusGiveOk = (res, data, message = 'Success.') => res.json({
    success: true,
    code: 20000,
    message,
    data
})

const bonusGiveFail = (res, http, message) => res.status(http).json({
    success: false,
    code: http * 100,
    message
})

const bonusGiveValidId = value =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0

const uploadBonusImage = buffer => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
        { folder: 'bonus-awards', resource_type: 'image' },
        (error, result) => error ? reject(error) : resolve(result)
    )
    stream.end(buffer)
})

async function activeBonusGiveSession(db, req, lock = false) {
    const userId = Number(req.authUser?.id || 0)

    if (!bonusGiveValidId(userId)) return null

    const result = await db.query(`
        SELECT es."ID", es."UserId", es."LocationId", es."ClockIn"
        FROM "EmployeeSession" es
        WHERE es."UserId"=$1
          AND es."ClockOut" IS NULL
        ORDER BY es."ClockIn" DESC
        LIMIT 1 ${lock ? 'FOR UPDATE OF es' : ''}
    `, [userId])

    return result.rows[0] || null
}

async function bonusGiveSessionBalance(db, session) {
    const result = await db.query(`
        WITH cash AS (
            SELECT
                COALESCE(SUM("Amount") FILTER (WHERE "Type" IN ('OPENING','OPENING_TRANSFER')),0) opening,
                COALESCE(SUM("Amount") FILTER (WHERE "Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0) received,
                COALESCE(SUM("Amount") FILTER (WHERE "Type"='TRANSFER_OUT'),0) transfer_out,
                COALESCE(SUM("Amount") FILTER (WHERE "Type"='EXPENSE'),0) expenses,
                COALESCE(SUM("Amount") FILTER (WHERE "Type"='OWNER_WITHDRAWAL'),0) withdrawals,
                COUNT("ID")::integer entries
            FROM "SessionCashTransactions"
            WHERE "SessionId"=$1
        ),
        points AS (
            SELECT COALESCE(SUM(cm."Points"),0) total
            FROM "CustomerMatch" cm
            WHERE cm."EmployeeSessionId"=$1
        ),
        raffles AS (
            SELECT COALESCE(SUM(r."WinningAmount"),0) total
            FROM "Raffles" r
            WHERE r."EmployeeSessionId"=$1
              AND r."Status"='WINNER'
        ),
        tickets AS (
            SELECT COALESCE(SUM(t."Amount"),0) total
            FROM "TicketOuts" t
            WHERE t."EmployeeSessionId"=$1
        ),
        bonuses AS (
            SELECT COALESCE(SUM(b."Amount"),0) total
            FROM "BonusAwards" b
            WHERE b."EmployeeSessionId"=$1
        )
        SELECT
            (
                cash.opening
                + cash.received
                - cash.transfer_out
                - cash.expenses
                - cash.withdrawals
                - points.total
                - raffles.total
                - tickets.total
                - bonuses.total
            )::numeric(14,2) balance,
            cash.entries
        FROM cash
        CROSS JOIN points
        CROSS JOIN raffles
        CROSS JOIN tickets
        CROSS JOIN bonuses
    `, [session.ID])

    return result.rows[0]
}

const activeBonusScheduleExistsSql = bonusAlias => `
    EXISTS (
        SELECT 1
        FROM "BonusScheduleBlock" sb
        JOIN "BonusScheduleDay" sd
          ON sd."ScheduleBlockId"=sb."ID"
        WHERE sb."BonusId"=${bonusAlias}."ID"
          AND (
            (
                sb."IsAllDay"=true
                AND sd."DayOfWeek"=
                    EXTRACT(
                        ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')
                    )::integer
            )
            OR
            (
                sb."IsAllDay"=false
                AND sb."EndDayOffset"=0
                AND sd."DayOfWeek"=
                    EXTRACT(
                        ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')
                    )::integer
                AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::time >= sb."StartTime"
                AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::time <= sb."EndTime"
            )
            OR
            (
                sb."IsAllDay"=false
                AND sb."EndDayOffset"=1
                AND sd."DayOfWeek"=
                    EXTRACT(
                        ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')
                    )::integer
                AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::time >= sb."StartTime"
            )
            OR
            (
                sb."IsAllDay"=false
                AND sb."EndDayOffset"=1
                AND sd."DayOfWeek"=(
                    (
                        EXTRACT(
                            ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')
                        )::integer + 5
                    ) % 7
                ) + 1
                AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::time <= sb."EndTime"
            )
          )
    )
`


// ============================================================
// VALIDATE BONUS PAYLOAD
// ============================================================

function validateBonusPayload({
    name,
    locationId,
    payouts = [],
    scheduleBlocks = [],
    requireLocation = true
}) {
    if (!name?.trim()) {
        return 'Bonus name is required.'
    }

    if (requireLocation && !locationId) {
        return 'Location is required.'
    }

    if (!Array.isArray(payouts) || payouts.length === 0) {
        return 'At least one payout is required.'
    }

    for (const payout of payouts) {
        if (!payout.description?.trim()) {
            return 'Each payout requires a description.'
        }

        const amount = Number(payout.amount)

        if (Number.isNaN(amount) || amount < 0) {
            return 'Each payout must have a valid non-negative amount.'
        }
    }

    if (
        !Array.isArray(scheduleBlocks) ||
        scheduleBlocks.length === 0
    ) {
        return 'At least one schedule block is required.'
    }

    for (const block of scheduleBlocks) {
        if (
            !Array.isArray(block.days) ||
            block.days.length === 0
        ) {
            return 'Each schedule block requires at least one day.'
        }

        for (const day of block.days) {
            const dayNumber = Number(day)

            if (
                !Number.isInteger(dayNumber) ||
                dayNumber < 1 ||
                dayNumber > 7
            ) {
                return 'Invalid schedule day.'
            }
        }

        if (!block.isAllDay) {
            if (!block.startTime || !block.endTime) {
                return 'Start and end time are required for timed schedule blocks.'
            }

            const endDayOffset =
                Number(block.endDayOffset ?? 0)

            if (
                endDayOffset !== 0 &&
                endDayOffset !== 1
            ) {
                return 'End day offset must be 0 or 1.'
            }

            /*
             * Same-day blocks should end after they start.
             *
             * Example:
             * 3:00 PM -> 4:00 PM = valid
             *
             * Overnight:
             * 8:00 PM -> 12:02 AM must use EndDayOffset = 1
             */
            if (
                endDayOffset === 0 &&
                block.endTime <= block.startTime
            ) {
                return 'End time must be after start time for a same-day schedule.'
            }
        }
    }

    return null
}

// ============================================================
// INSERT PAYOUTS
// ============================================================

async function insertPayouts(
    client,
    bonusId,
    payouts
) {
    for (
        let index = 0;
        index < payouts.length;
        index++
    ) {
        const payout =
            payouts[index]

        await client.query(
            `
            INSERT INTO "BonusPayout"
            (
                "BonusId",
                "Description",
                "Amount",
                "SortOrder"
            )
            VALUES
            (
                $1,
                $2,
                $3,
                $4
            )
            `,
            [
                bonusId,
                payout.description.trim(),
                Number(payout.amount),
                index
            ]
        )
    }
}

// ============================================================
// INSERT SCHEDULE BLOCKS
// ============================================================

async function insertScheduleBlocks(
    client,
    bonusId,
    scheduleBlocks
) {
    for (
        let index = 0;
        index < scheduleBlocks.length;
        index++
    ) {
        const block =
            scheduleBlocks[index]

        const isAllDay =
            Boolean(block.isAllDay)

        const endDayOffset =
            isAllDay
                ? 0
                : Number(
                    block.endDayOffset ?? 0
                )

        const blockResult =
            await client.query(
                `
                INSERT INTO "BonusScheduleBlock"
                (
                    "BonusId",
                    "IsAllDay",
                    "StartTime",
                    "EndTime",
                    "EndDayOffset",
                    "SortOrder"
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6
                )
                RETURNING
                    "ID" AS "id"
                `,
                [
                    bonusId,
                    isAllDay,
                    isAllDay
                        ? null
                        : block.startTime,
                    isAllDay
                        ? null
                        : block.endTime,
                    endDayOffset,
                    index
                ]
            )

        const scheduleBlockId =
            blockResult.rows[0].id

        const uniqueDays = [
            ...new Set(
                block.days.map(Number)
            )
        ]

        for (const day of uniqueDays) {
            await client.query(
                `
                INSERT INTO "BonusScheduleDay"
                (
                    "ScheduleBlockId",
                    "DayOfWeek"
                )
                VALUES
                (
                    $1,
                    $2
                )
                `,
                [
                    scheduleBlockId,
                    day
                ]
            )
        }
    }
}

// ============================================================
// GET ACTIVE BONUSES RIGHT NOW
//
// IMPORTANT:
// This route is deliberately above /:id.
//
// Supports:
// - All-day schedules
// - Same-day schedules
// - Overnight schedules
//
// Example:
// Monday 8 PM -> Tuesday 12:02 AM
//
// At Tuesday 12:01 AM we must look for a Monday schedule.
// ============================================================

router.get(
    '/active/current/list',
    requirePermission('bonus.read'),
    async (req, res) => {
        try {
            const locationId =
                Number(
                    req.query.locationid
                )

            if (!locationId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Location is required.'
                })
            }

            const result =
                await pool.query(
                    `
                    SELECT DISTINCT
                        b."ID" AS "id",
                        b."Name" AS "name",
                        b."IsActive" AS "isActive"

                    FROM "Bonus" b

                    INNER JOIN
                        "BonusScheduleBlock" sb
                            ON sb."BonusId" = b."ID"

                    INNER JOIN
                        "BonusScheduleDay" sd
                            ON sd."ScheduleBlockId" = sb."ID"

                    WHERE
                        b."LocationId" = $1

                        AND
                        b."IsActive" = true

                        AND
                        (
                            (
                                sb."IsAllDay" = true

                                AND

                                sd."DayOfWeek" =
                                    EXTRACT(
                                        ISODOW FROM NOW()
                                    )::integer
                            )

                            OR

                            (
                                sb."IsAllDay" = false

                                AND
                                sb."EndDayOffset" = 0

                                AND
                                sd."DayOfWeek" =
                                    EXTRACT(
                                        ISODOW FROM NOW()
                                    )::integer

                                AND
                                CURRENT_TIME >=
                                    sb."StartTime"

                                AND
                                CURRENT_TIME <=
                                    sb."EndTime"
                            )

                            OR

                            (
                                sb."IsAllDay" = false

                                AND
                                sb."EndDayOffset" = 1

                                AND
                                sd."DayOfWeek" =
                                    EXTRACT(
                                        ISODOW FROM NOW()
                                    )::integer

                                AND
                                CURRENT_TIME >=
                                    sb."StartTime"
                            )

                            OR

                            (
                                sb."IsAllDay" = false

                                AND
                                sb."EndDayOffset" = 1

                                AND
                                sd."DayOfWeek" =
                                (
                                    (
                                        EXTRACT(
                                            ISODOW FROM NOW()
                                        )::integer + 5
                                    ) % 7
                                ) + 1

                                AND
                                CURRENT_TIME <=
                                    sb."EndTime"
                            )
                        )

                    ORDER BY
                        b."Name"
                    `,
                    [
                        locationId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Active bonuses retrieved successfully.',
                data:
                    result.rows
            })
        } catch (error) {
            console.error(
                'Get current active bonuses error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve active bonuses.'
            })
        }
    }
)


// ============================================================
// BONUS GIVE FLOW - CURRENT EMPLOYEE SESSION STATE
// ============================================================

router.get(
    '/give/state',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const session = await activeBonusGiveSession(pool, req)

            if (!session) {
                return bonusGiveFail(res, 409, 'Clock in before giving a Bonus.')
            }

            const balance = await bonusGiveSessionBalance(pool, session)

            return bonusGiveOk(res, {
                sessionId: session.ID,
                locationId: session.LocationId,
                balance: Number(balance.balance || 0),
                cashReady: Number(balance.entries || 0) > 0
            })
        } catch (error) {
            console.error('Bonus give state:', error)
            return bonusGiveFail(res, 500, 'Unable to load Bonus status.')
        }
    }
)

// ============================================================
// BONUS GIVE FLOW - MACHINE LOOKUP
// ============================================================

router.get(
    '/give/machine',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const session = await activeBonusGiveSession(pool, req)

            if (!session) {
                return bonusGiveFail(res, 409, 'Clock in before giving a Bonus.')
            }

            const machineNumber = String(req.query.machinenumber || '').trim()

            if (!machineNumber) {
                return bonusGiveFail(res, 400, 'Machine number is required.')
            }

            const result = await pool.query(`
                SELECT
                    m."ID" AS id,
                    m."MachineNumber" AS "machineNumber",
                    mt."TypeName" AS "machineType",
                    ms."Description" AS status
                FROM "Machines" m
                LEFT JOIN "MachineTypes" mt
                  ON mt."ID"=m."MachineTypeId"
                LEFT JOIN "MachineStatus" ms
                  ON ms."ID"=m."StatusId"
                WHERE m.locationid=$1
                  AND m."MachineNumber"::text=$2
                LIMIT 1
            `, [session.LocationId, machineNumber])

            if (!result.rowCount) {
                return bonusGiveFail(
                    res,
                    404,
                    `Machine #${machineNumber} was not found at this location.`
                )
            }

            return bonusGiveOk(res, result.rows[0])
        } catch (error) {
            console.error('Bonus give machine:', error)
            return bonusGiveFail(res, 500, 'Unable to find machine.')
        }
    }
)

// ============================================================
// BONUS GIVE FLOW - ACTIVE BONUSES + PAYOUT OPTIONS
// Employee flow intentionally uses clock.read, not bonus.read.
// ============================================================

router.get(
    '/give/active/list',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const session = await activeBonusGiveSession(pool, req)

            if (!session) {
                return bonusGiveFail(res, 409, 'Clock in before giving a Bonus.')
            }

            const result = await pool.query(`
                SELECT
                    b."ID" AS id,
                    b."Name" AS name,
                    COALESCE(
                        JSONB_AGG(
                            JSONB_BUILD_OBJECT(
                                'id', bp."ID",
                                'description', bp."Description",
                                'amount', bp."Amount"::double precision,
                                'sortOrder', bp."SortOrder"
                            )
                            ORDER BY bp."SortOrder", bp."ID"
                        ) FILTER (WHERE bp."ID" IS NOT NULL),
                        '[]'::jsonb
                    ) AS payouts
                FROM "Bonus" b
                LEFT JOIN "BonusPayout" bp
                  ON bp."BonusId"=b."ID"
                 AND bp."Amount" > 0
                WHERE b."LocationId"=$1
                  AND b."IsActive"=true
                  AND ${activeBonusScheduleExistsSql('b')}
                GROUP BY b."ID", b."Name"
                HAVING COUNT(bp."ID") > 0
                ORDER BY b."Name", b."ID"
            `, [session.LocationId])

            return bonusGiveOk(
                res,
                result.rows,
                'Active bonuses retrieved successfully.'
            )
        } catch (error) {
            console.error('Bonus give active list:', error)
            return bonusGiveFail(res, 500, 'Unable to load active bonuses.')
        }
    }
)

// ============================================================
// BONUS GIVE FLOW - SAVE AWARD
// BonusAwards is the expense source of truth.
// No SessionCashTransactions EXPENSE row is created.
// ============================================================

router.post(
    '/give/save',
    requirePermission('clock.update'),
    bonusGiveUpload.single('image'),
    async (req, res) => {
        const client = await pool.connect()

        try {
            const bonusId = Number(req.body.bonusid)
            const payoutId = Number(req.body.payoutid)
            const machineId = Number(req.body.machineid)
            const customerId = Number(req.body.customerid)

            if (!bonusGiveValidId(bonusId)) {
                return bonusGiveFail(res, 400, 'Select a valid bonus.')
            }

            if (!bonusGiveValidId(payoutId)) {
                return bonusGiveFail(res, 400, 'Select a valid payout amount.')
            }

            if (!bonusGiveValidId(machineId)) {
                return bonusGiveFail(res, 400, 'Select a valid machine.')
            }

            if (!bonusGiveValidId(customerId)) {
                return bonusGiveFail(res, 400, 'Select a valid customer.')
            }

            if (!req.file) {
                return bonusGiveFail(res, 400, 'Capture a photo for the Bonus.')
            }

            await client.query('BEGIN')

            const session = await activeBonusGiveSession(client, req, true)

            if (!session) {
                await client.query('ROLLBACK')
                return bonusGiveFail(res, 409, 'Clock in before giving a Bonus.')
            }

            const machine = await client.query(`
                SELECT "ID", "MachineNumber"
                FROM "Machines"
                WHERE "ID"=$1
                  AND locationid=$2
                FOR UPDATE
            `, [machineId, session.LocationId])

            if (!machine.rowCount) {
                await client.query('ROLLBACK')
                return bonusGiveFail(
                    res,
                    400,
                    'Selected machine is not valid for your location.'
                )
            }

            const customer = await client.query(`
                SELECT "ID", "Firstname", "Lastname"
                FROM "Customer"
                WHERE "ID"=$1
                  AND "locationid"=$2
                  AND "IsActive"=true
                LIMIT 1
            `, [customerId, session.LocationId])

            if (!customer.rowCount) {
                await client.query('ROLLBACK')
                return bonusGiveFail(
                    res,
                    400,
                    'Selected customer is not valid for your location.'
                )
            }

            // Re-check bonus, payout and schedule at the moment of save.
            const payout = await client.query(`
                SELECT
                    b."ID" AS "bonusId",
                    b."Name" AS "bonusName",
                    bp."ID" AS "payoutId",
                    bp."Description" AS "payoutDescription",
                    bp."Amount"::numeric(14,2) AS amount
                FROM "Bonus" b
                JOIN "BonusPayout" bp
                  ON bp."BonusId"=b."ID"
                WHERE b."ID"=$1
                  AND bp."ID"=$2
                  AND b."LocationId"=$3
                  AND b."IsActive"=true
                  AND bp."Amount" > 0
                  AND ${activeBonusScheduleExistsSql('b')}
                LIMIT 1
            `, [bonusId, payoutId, session.LocationId])

            if (!payout.rowCount) {
                await client.query('ROLLBACK')
                return bonusGiveFail(
                    res,
                    409,
                    'This bonus or payout is no longer active for the current schedule.'
                )
            }

            const amount = Number(payout.rows[0].amount)

            const balance = await bonusGiveSessionBalance(client, session)

            if (!Number(balance.entries)) {
                await client.query('ROLLBACK')
                return bonusGiveFail(
                    res,
                    409,
                    'Enter or confirm opening cash before paying a Bonus.'
                )
            }

            if (Number(balance.balance) < amount) {
                await client.query('ROLLBACK')
                return bonusGiveFail(
                    res,
                    409,
                    `Insufficient session cash. Available: $${Number(balance.balance).toFixed(2)}`
                )
            }

            const image = await uploadBonusImage(req.file.buffer)

            const award = await client.query(`
                INSERT INTO "BonusAwards"
                (
                    "LocationId",
                    "EmployeeSessionId",
                    "EmployeeId",
                    "BonusId",
                    "BonusPayoutId",
                    "BonusName",
                    "PayoutDescription",
                    "MachineId",
                    "CustomerId",
                    "Amount",
                    "ImageUrl",
                    "CreatedBy"
                )
                VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                RETURNING
                    "ID" AS id,
                    "CreatedAt" AS "createdAt"
            `, [
                session.LocationId,
                session.ID,
                session.UserId,
                payout.rows[0].bonusId,
                payout.rows[0].payoutId,
                payout.rows[0].bonusName,
                payout.rows[0].payoutDescription,
                machineId,
                customerId,
                amount,
                image.secure_url,
                session.UserId
            ])

            await client.query('COMMIT')

            const customerName =
                `${customer.rows[0].Firstname || ''} ${customer.rows[0].Lastname || ''}`.trim()

            return bonusGiveOk(
                res,
                {
                    id: award.rows[0].id,
                    createdAt: award.rows[0].createdAt,
                    bonusId: payout.rows[0].bonusId,
                    bonusName: payout.rows[0].bonusName,
                    payoutId: payout.rows[0].payoutId,
                    payoutDescription: payout.rows[0].payoutDescription,
                    machineId,
                    machineNumber: machine.rows[0].MachineNumber,
                    customerId,
                    customerName,
                    amount,
                    imageUrl: image.secure_url
                },
                'Bonus saved and deducted from your employee session.'
            )
        } catch (error) {
            try {
                await client.query('ROLLBACK')
            } catch {
                // Transaction may not have started.
            }

            console.error('Bonus give save:', error)
            return bonusGiveFail(res, 500, 'Unable to save Bonus.')
        } finally {
            client.release()
        }
    }
)

// ============================================================
// GET ALL BONUSES BY LOCATION
// ============================================================

router.get(
    '/',
    requirePermission('bonus.read'),
    async (req, res) => {
        try {
            const locationId =
                Number(
                    req.query.locationid
                )

            if (!locationId) {
                return res.status(400).json({
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
                        b."ID" AS "id",
                        b."Name" AS "name",
                        b."IsActive" AS "isActive",

                        COUNT(
                            DISTINCT bp."ID"
                        )::integer
                            AS "payoutCount",

                        COUNT(
                            DISTINCT sb."ID"
                        )::integer
                            AS "blockCount",

                        COALESCE(
                            BOOL_AND(
                                sb."IsAllDay"
                            ),
                            false
                        )
                            AS "allDay"

                    FROM "Bonus" b

                    LEFT JOIN "BonusPayout" bp
                        ON bp."BonusId" =
                           b."ID"

                    LEFT JOIN "BonusScheduleBlock" sb
                        ON sb."BonusId" =
                           b."ID"

                    WHERE
                        b."LocationId" = $1

                    GROUP BY
                        b."ID",
                        b."Name",
                        b."IsActive"

                    ORDER BY
                        b."Name"
                    `,
                    [
                        locationId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Bonuses retrieved successfully.',
                data:
                    result.rows
            })
        } catch (error) {
            console.error(
                'Get bonuses error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve bonuses.'
            })
        }
    }
)

// ============================================================
// GET SINGLE BONUS
// ============================================================

router.get(
    '/:id',
    requirePermission('bonus.read'),
    async (req, res) => {
        try {
            const bonusId =
                Number(
                    req.params.id
                )

            if (!bonusId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Invalid bonus.'
                })
            }

            const bonusResult =
                await pool.query(
                    `
                    SELECT
                        "ID"
                            AS "id",

                        "Name"
                            AS "name",

                        "IsActive"
                            AS "isActive",

                        "LocationId"
                            AS "locationId",

                        "DateCreated"
                            AS "dateCreated",

                        "DateUpdated"
                            AS "dateUpdated"

                    FROM "Bonus"

                    WHERE
                        "ID" = $1
                    `,
                    [
                        bonusId
                    ]
                )

            if (
                bonusResult.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Bonus not found.'
                })
            }

            const payoutResult =
                await pool.query(
                    `
                    SELECT
                        "ID"
                            AS "id",

                        "Description"
                            AS "description",

                        "Amount"::double precision
                            AS "amount",

                        "SortOrder"
                            AS "sortOrder"

                    FROM "BonusPayout"

                    WHERE
                        "BonusId" = $1

                    ORDER BY
                        "SortOrder",
                        "ID"
                    `,
                    [
                        bonusId
                    ]
                )

            const scheduleResult =
                await pool.query(
                    `
                    SELECT
                        sb."ID"
                            AS "id",

                        sb."IsAllDay"
                            AS "isAllDay",

                        sb."StartTime"
                            AS "startTime",

                        sb."EndTime"
                            AS "endTime",

                        sb."EndDayOffset"
                            AS "endDayOffset",

                        sb."SortOrder"
                            AS "sortOrder",

                        COALESCE(
                            ARRAY_AGG(
                                sd."DayOfWeek"
                                ORDER BY
                                    sd."DayOfWeek"
                            )
                            FILTER (
                                WHERE
                                    sd."DayOfWeek"
                                        IS NOT NULL
                            ),
                            '{}'
                        )
                            AS "days"

                    FROM
                        "BonusScheduleBlock" sb

                    LEFT JOIN
                        "BonusScheduleDay" sd

                        ON
                            sd."ScheduleBlockId" =
                                sb."ID"

                    WHERE
                        sb."BonusId" = $1

                    GROUP BY
                        sb."ID"

                    ORDER BY
                        sb."SortOrder",
                        sb."ID"
                    `,
                    [
                        bonusId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Bonus retrieved successfully.',

                data: {
                    ...bonusResult.rows[0],

                    payouts:
                        payoutResult.rows,

                    scheduleBlocks:
                        scheduleResult.rows
                }
            })
        } catch (error) {
            console.error(
                'Get bonus error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve bonus.'
            })
        }
    }
)

// ============================================================
// CREATE BONUS
// ============================================================

router.post(
    '/',
    requirePermission('bonus.create'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const {
                name,
                isActive = true,
                locationId,
                payouts = [],
                scheduleBlocks = []
            } = req.body

            const validationError =
                validateBonusPayload({
                    name,
                    locationId,
                    payouts,
                    scheduleBlocks,
                    requireLocation: true
                })

            if (validationError) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        validationError
                })
            }

            await client.query(
                'BEGIN'
            )

            const bonusResult =
                await client.query(
                    `
                    INSERT INTO "Bonus"
                    (
                        "Name",
                        "IsActive",
                        "LocationId"
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3
                    )
                    RETURNING
                        "ID" AS "id"
                    `,
                    [
                        name.trim(),
                        Boolean(isActive),
                        Number(locationId)
                    ]
                )

            const bonusId =
                bonusResult.rows[0].id

            await insertPayouts(
                client,
                bonusId,
                payouts
            )

            await insertScheduleBlocks(
                client,
                bonusId,
                scheduleBlocks
            )

            await client.query(
                'COMMIT'
            )

            return res.status(201).json({
                success: true,
                code: 20000,
                message:
                    'Bonus created successfully.',

                data: {
                    id:
                        bonusId
                }
            })
        } catch (error) {
            await client.query(
                'ROLLBACK'
            )

            console.error(
                'Create bonus error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to create bonus.'
            })
        } finally {
            client.release()
        }
    }
)

// ============================================================
// UPDATE BONUS
// ============================================================

router.put(
    '/:id',
    requirePermission('bonus.update'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const bonusId =
                Number(
                    req.params.id
                )

            if (!bonusId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Invalid bonus.'
                })
            }

            const {
                name,
                isActive,
                payouts = [],
                scheduleBlocks = []
            } = req.body

            const validationError =
                validateBonusPayload({
                    name,
                    payouts,
                    scheduleBlocks,
                    requireLocation: false
                })

            if (validationError) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        validationError
                })
            }

            await client.query(
                'BEGIN'
            )

            const updateResult =
                await client.query(
                    `
                    UPDATE "Bonus"

                    SET
                        "Name" = $1,

                        "IsActive" = $2,

                        "DateUpdated" =
                            NOW()

                    WHERE
                        "ID" = $3
                    `,
                    [
                        name.trim(),
                        Boolean(isActive),
                        bonusId
                    ]
                )

            if (
                updateResult.rowCount === 0
            ) {
                await client.query(
                    'ROLLBACK'
                )

                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Bonus not found.'
                })
            }

            // Delete old payout rows
            await client.query(
                `
                DELETE FROM "BonusPayout"
                WHERE
                    "BonusId" = $1
                `,
                [
                    bonusId
                ]
            )

            /*
             * BonusScheduleDay rows are automatically deleted
             * because BonusScheduleDay -> BonusScheduleBlock
             * uses ON DELETE CASCADE.
             */
            await client.query(
                `
                DELETE FROM "BonusScheduleBlock"
                WHERE
                    "BonusId" = $1
                `,
                [
                    bonusId
                ]
            )

            await insertPayouts(
                client,
                bonusId,
                payouts
            )

            await insertScheduleBlocks(
                client,
                bonusId,
                scheduleBlocks
            )

            await client.query(
                'COMMIT'
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Bonus saved successfully.'
            })
        } catch (error) {
            await client.query(
                'ROLLBACK'
            )

            console.error(
                'Update bonus error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to save bonus.'
            })
        } finally {
            client.release()
        }
    }
)

// ============================================================
// ENABLE / DISABLE BONUS
// ============================================================

router.patch(
    '/:id/status',
    requirePermission('bonus.update'),
    async (req, res) => {
        try {
            const bonusId =
                Number(
                    req.params.id
                )

            const {
                isActive
            } = req.body

            if (!bonusId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Invalid bonus.'
                })
            }

            if (
                typeof isActive !==
                'boolean'
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Status must be true or false.'
                })
            }

            const result =
                await pool.query(
                    `
                    UPDATE "Bonus"

                    SET
                        "IsActive" = $1,

                        "DateUpdated" =
                            NOW()

                    WHERE
                        "ID" = $2
                    `,
                    [
                        isActive,
                        bonusId
                    ]
                )

            if (
                result.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Bonus not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,

                message:
                    isActive
                        ? 'Bonus activated successfully.'
                        : 'Bonus deactivated successfully.'
            })
        } catch (error) {
            console.error(
                'Bonus status error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update bonus status.'
            })
        }
    }
)

// ============================================================
// DELETE BONUS
// ============================================================

router.delete(
    '/:id',
    requirePermission('bonus.delete'),
    async (req, res) => {
        try {
            const bonusId =
                Number(
                    req.params.id
                )

            if (!bonusId) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Invalid bonus.'
                })
            }

            const result =
                await pool.query(
                    `
                    DELETE FROM "Bonus"
                    WHERE
                        "ID" = $1
                    `,
                    [
                        bonusId
                    ]
                )

            if (
                result.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Bonus not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Bonus deleted successfully.'
            })
        } catch (error) {
            console.error(
                'Delete bonus error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to delete bonus.'
            })
        }
    }
)

module.exports = router