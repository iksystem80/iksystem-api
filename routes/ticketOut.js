const express = require('express')
const multer = require('multer')
const { pool } = require('../db')
const cloudinary = require('../config/cloudinary')
const { authenticate, requirePermission } = require('../middleware/auth')

const router = express.Router()
router.use(authenticate)

const upload = multer({
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

const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0

const money = value => {
    if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(value ?? '').trim())) return null
    const amount = Number(value)
    return amount > 0 ? amount.toFixed(2) : null
}

const uploadImage = buffer => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
        { folder: 'ticket-out', resource_type: 'image' },
        (error, result) => error ? reject(error) : resolve(result)
    )
    stream.end(buffer)
})

async function activeSession(db, req, lock = false) {
    const result = await db.query(`
    SELECT es."ID", es."UserId", es."LocationId", es."ClockIn"
    FROM "EmployeeSession" es
    WHERE es."UserId"=$1 AND es."ClockOut" IS NULL
    ORDER BY es."ClockIn" DESC
    LIMIT 1 ${lock ? 'FOR UPDATE OF es' : ''}`,
        [Number(req.authUser.id)])

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
    ), points AS (
      SELECT COALESCE(SUM(cm."Points"),0) total
      FROM "CustomerMatch" cm
      WHERE cm."EmployeeSessionId"=$1
    ), raffles AS (
      SELECT COALESCE(SUM(r."WinningAmount"),0) total
      FROM "Raffles" r
      WHERE r."EmployeeSessionId"=$1 AND r."Status"='WINNER'
    ), tickets AS (
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
      (cash.opening + cash.received - cash.transfer_out - cash.expenses - cash.withdrawals - points.total - raffles.total - tickets.total - bonuses.total)::numeric(14,2) balance,
      cash.entries
    FROM cash
    CROSS JOIN points
    CROSS JOIN raffles
    CROSS JOIN tickets
    CROSS JOIN bonuses`,
        [session.ID])

    return result.rows[0]
}

router.get('/state', requirePermission('clock.read'), async (req, res) => {
    try {
        const session = await activeSession(pool, req)

        if (!session) {
            return fail(res, 409, 'Clock in before recording a Ticket Out.')
        }

        const balance = await sessionBalance(pool, session)

        return ok(res, {
            sessionId: session.ID,
            locationId: session.LocationId,
            balance: Number(balance.balance || 0),
            cashReady: Number(balance.entries || 0) > 0
        })
    } catch (error) {
        console.error('Ticket Out state:', error)
        return fail(res, 500, 'Unable to load Ticket Out status.')
    }
})

router.get('/machine', requirePermission('clock.read'), async (req, res) => {
    try {
        const session = await activeSession(pool, req)

        if (!session) {
            return fail(res, 409, 'Clock in before recording a Ticket Out.')
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
      LEFT JOIN "MachineTypes" mt ON mt."ID"=m."MachineTypeId"
      LEFT JOIN "MachineStatus" ms ON ms."ID"=m."StatusId"
      WHERE m.locationid=$1
        AND m."MachineNumber"::text=$2
      LIMIT 1`,
            [session.LocationId, machineNumber])

        if (!result.rowCount) {
            return fail(res, 404, `Machine #${machineNumber} was not found at this location.`)
        }

        return ok(res, result.rows[0])
    } catch (error) {
        console.error('Ticket Out machine:', error)
        return fail(res, 500, 'Unable to find machine.')
    }
})

router.post(
    '/save',
    requirePermission('clock.update'),
    upload.single('image'),
    async (req, res) => {
        const client = await pool.connect()

        try {
            const amount = money(req.body.amount)
            const machineId = Number(req.body.machineid)
            const customerId = Number(req.body.customerid)

            if (!validId(machineId)) {
                return fail(res, 400, 'Select a valid machine.')
            }

            if (!validId(customerId)) {
                return fail(res, 400, 'Select a valid customer.')
            }

            if (!amount) {
                return fail(res, 400, 'Enter a valid Ticket Out amount.')
            }

            if (!req.file) {
                return fail(res, 400, 'Capture a photo of the machine screen.')
            }

            await client.query('BEGIN')

            const session = await activeSession(client, req, true)

            if (!session) {
                await client.query('ROLLBACK')
                return fail(res, 409, 'Clock in before recording a Ticket Out.')
            }

            const machine = await client.query(`
        SELECT "ID", "MachineNumber"
        FROM "Machines"
        WHERE "ID"=$1
          AND locationid=$2
        FOR UPDATE`,
                [machineId, session.LocationId])

            if (!machine.rowCount) {
                await client.query('ROLLBACK')
                return fail(res, 400, 'Selected machine is not valid for your location.')
            }

            const customer = await client.query(`
        SELECT "ID", "Firstname", "Lastname"
        FROM "Customer"
        WHERE "ID"=$1
          AND "locationid"=$2
          AND "IsActive"=true
        LIMIT 1`,
                [customerId, session.LocationId])

            if (!customer.rowCount) {
                await client.query('ROLLBACK')
                return fail(res, 400, 'Selected customer is not valid for your location.')
            }

            const balance = await sessionBalance(client, session)

            if (!Number(balance.entries)) {
                await client.query('ROLLBACK')
                return fail(res, 409, 'Enter or confirm opening cash before paying a Ticket Out.')
            }

            if (Number(balance.balance) < Number(amount)) {
                await client.query('ROLLBACK')
                return fail(
                    res,
                    409,
                    `Insufficient session cash. Available: $${Number(balance.balance).toFixed(2)}`
                )
            }

            const image = await uploadImage(req.file.buffer)

            const ticket = await client.query(`
        INSERT INTO "TicketOuts"
          (
            "LocationId",
            "EmployeeSessionId",
            "EmployeeId",
            "MachineId",
            "CustomerId",
            "Amount",
            "ImageUrl",
            "CreatedBy"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING "ID"`,
                [
                    session.LocationId,
                    session.ID,
                    session.UserId,
                    machineId,
                    customerId,
                    amount,
                    image.secure_url,
                    session.UserId
                ])

            const customerName = `${customer.rows[0].Firstname || ''} ${customer.rows[0].Lastname || ''}`.trim()


            await client.query(`
        UPDATE "TicketOuts"
        SET "SessionTransactionId"=NULL
        WHERE "ID"=$1`,
                [ticket.rows[0].ID])

            await client.query('COMMIT')

            return ok(res, {
                id: ticket.rows[0].ID,
                machineNumber: machine.rows[0].MachineNumber,
                customerId: customer.rows[0].ID,
                customerName,
                amount: Number(amount),
                imageUrl: image.secure_url
            }, 'Ticket Out saved and cash deducted from your employee session.')
        } catch (error) {
            try {
                await client.query('ROLLBACK')
            } catch {
                // Transaction may not have started.
            }

            console.error('Ticket Out save:', error)
            return fail(res, 500, 'Unable to save Ticket Out.')
        } finally {
            client.release()
        }
    }
)

router.get('/recent', requirePermission('clock.read'), async (req, res) => {
    try {
        const session = await activeSession(pool, req)

        if (!session) {
            return ok(res, [])
        }

        const result = await pool.query(`
      SELECT
        t."ID" AS id,
        t."Amount" AS amount,
        t."ImageUrl" AS "imageUrl",
        t."CreatedAt" AS "createdAt",
        t."CustomerId" AS "customerId",
        m."MachineNumber" AS "machineNumber",
        c."Firstname" AS "customerFirstname",
        c."Lastname" AS "customerLastname"
      FROM "TicketOuts" t
      JOIN "Machines" m ON m."ID"=t."MachineId"
      LEFT JOIN "Customer" c ON c."ID"=t."CustomerId"
      WHERE t."EmployeeSessionId"=$1
      ORDER BY t."CreatedAt" DESC, t."ID" DESC
      LIMIT 10`,
            [session.ID])

        return ok(res, result.rows.map(row => ({
            ...row,
            customerName: `${row.customerFirstname || ''} ${row.customerLastname || ''}`.trim()
        })))
    } catch (error) {
        console.error('Ticket Out recent:', error)
        return fail(res, 500, 'Unable to load recent Ticket Outs.')
    }
})

module.exports = router
