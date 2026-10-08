const express = require('express')
const multer = require('multer')
const router = express.Router()

const { pool } = require('../db')
const cloudinary = require('../config/cloudinary')
const { requirePermission } = require('../middleware/auth')

const luckyBirdUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = Boolean(file?.mimetype?.startsWith('image/'))
        cb(allowed ? null : new Error('Only images are allowed.'), allowed)
    }
})

const ok = (res, data, message = 'Success.') => res.json({
    success: true,
    code: 20000,
    message,
    data
})

const fail = (res, http, message) => res.status(http).json({
    success: false,
    code: http * 100,
    message
})

const validId = value =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0

const ALLOWED_DENOMINATIONS = new Set([10, 15, 20])

const uploadLuckyBirdImage = buffer => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
        { folder: 'luckybird-awards', resource_type: 'image' },
        (error, result) => error ? reject(error) : resolve(result)
    )
    stream.end(buffer)
})

async function activeEmployeeSession(db, req, lock = false) {
    const userId = Number(req.authUser?.id || 0)

    if (!validId(userId)) return null

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

async function sessionBalance(db, session) {
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
        ),
        lucky_birds AS (
            SELECT COALESCE(SUM(lb."Amount"),0) total
            FROM "LuckyBirdAwards" lb
            WHERE lb."EmployeeSessionId"=$1
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
                - lucky_birds.total
            )::numeric(14,2) balance,
            cash.entries
        FROM cash
        CROSS JOIN points
        CROSS JOIN raffles
        CROSS JOIN tickets
        CROSS JOIN bonuses
        CROSS JOIN lucky_birds
    `, [session.ID])

    return result.rows[0]
}

// ============================================================
// CURRENT EMPLOYEE SESSION STATE
// ============================================================

router.get(
    '/give/state',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const session = await activeEmployeeSession(pool, req)

            if (!session) {
                return fail(res, 409, 'Clock in before giving a Lucky Bird.')
            }

            const balance = await sessionBalance(pool, session)

            return ok(res, {
                sessionId: session.ID,
                locationId: session.LocationId,
                balance: Number(balance.balance || 0),
                cashReady: Number(balance.entries || 0) > 0
            })
        } catch (error) {
            console.error('Lucky Bird state:', error)
            return fail(res, 500, 'Unable to load Lucky Bird status.')
        }
    }
)

// ============================================================
// MACHINE LOOKUP
// ============================================================

router.get(
    '/give/machine',
    requirePermission('clock.read'),
    async (req, res) => {
        try {
            const session = await activeEmployeeSession(pool, req)

            if (!session) {
                return fail(res, 409, 'Clock in before giving a Lucky Bird.')
            }

            const machineNumber = String(req.query.machinenumber || '').trim()

            if (!machineNumber) {
                return fail(res, 400, 'Machine number is required.')
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
                return fail(
                    res,
                    404,
                    `Machine #${machineNumber} was not found at this location.`
                )
            }

            return ok(res, result.rows[0])
        } catch (error) {
            console.error('Lucky Bird machine:', error)
            return fail(res, 500, 'Unable to find machine.')
        }
    }
)

// ============================================================
// SAVE LUCKY BIRD
// Fixed denominations only: $10 / $15 / $20
// ============================================================

router.post(
    '/give/save',
    requirePermission('clock.update'),
    luckyBirdUpload.single('image'),
    async (req, res) => {
        const client = await pool.connect()

        try {
            const amount = Number(req.body.amount)
            const machineId = Number(req.body.machineid)
            const customerId = Number(req.body.customerid)

            if (!ALLOWED_DENOMINATIONS.has(amount)) {
                return fail(res, 400, 'Lucky Bird amount must be $10, $15 or $20.')
            }

            if (!validId(machineId)) {
                return fail(res, 400, 'Select a valid machine.')
            }

            if (!validId(customerId)) {
                return fail(res, 400, 'Select a valid customer.')
            }

            if (!req.file) {
                return fail(res, 400, 'Capture a photo for the Lucky Bird.')
            }

            await client.query('BEGIN')

            const session = await activeEmployeeSession(client, req, true)

            if (!session) {
                await client.query('ROLLBACK')
                return fail(res, 409, 'Clock in before giving a Lucky Bird.')
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
                return fail(
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
                return fail(
                    res,
                    400,
                    'Selected customer is not valid for your location.'
                )
            }

            const balance = await sessionBalance(client, session)

            if (!Number(balance.entries)) {
                await client.query('ROLLBACK')
                return fail(
                    res,
                    409,
                    'Enter or confirm opening cash before paying a Lucky Bird.'
                )
            }

            if (Number(balance.balance) < amount) {
                await client.query('ROLLBACK')
                return fail(
                    res,
                    409,
                    `Insufficient session cash. Available: $${Number(balance.balance).toFixed(2)}`
                )
            }

            const image = await uploadLuckyBirdImage(req.file.buffer)

            const award = await client.query(`
                INSERT INTO "LuckyBirdAwards"
                (
                    "LocationId",
                    "EmployeeSessionId",
                    "EmployeeId",
                    "LuckyBirdId",
                    "LuckyBirdPayoutId",
                    "LuckyBirdName",
                    "PayoutDescription",
                    "MachineId",
                    "CustomerId",
                    "Amount",
                    "ImageUrl",
                    "CreatedBy"
                )
                VALUES
                ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,$9,$10)
                RETURNING
                    "ID" AS id,
                    "CreatedAt" AS "createdAt"
            `, [
                session.LocationId,
                session.ID,
                session.UserId,
                'Lucky Bird',
                `$${amount} Denomination`,
                machineId,
                customerId,
                amount,
                image.secure_url,
                session.UserId
            ])

            await client.query('COMMIT')

            const customerName =
                `${customer.rows[0].Firstname || ''} ${customer.rows[0].Lastname || ''}`.trim()

            return ok(
                res,
                {
                    id: award.rows[0].id,
                    createdAt: award.rows[0].createdAt,
                    machineId,
                    machineNumber: machine.rows[0].MachineNumber,
                    customerId,
                    customerName,
                    amount,
                    imageUrl: image.secure_url
                },
                'Lucky Bird saved and deducted from your employee session.'
            )
        } catch (error) {
            try {
                await client.query('ROLLBACK')
            } catch {
                // Transaction may not have started.
            }

            console.error('Lucky Bird save:', error)
            return fail(res, 500, 'Unable to save Lucky Bird.')
        } finally {
            client.release()
        }
    }
)

module.exports = router
