const express = require('express')
const router = express.Router()

const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')

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