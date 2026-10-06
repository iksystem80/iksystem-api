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
    fileFilter: (req, file, cb) => cb(file.mimetype.startsWith('image/') ? null : new Error('Only images are allowed.'), file.mimetype.startsWith('image/'))
})

const ok = (res, data, message = 'Success.') => res.json({ success: true, code: 20000, message, data })
const fail = (res, http, message) => res.status(http).json({ success: false, code: http * 100, message })
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
const adminRoles = new Set(['owner', 'admin', 'system admin', 'manager'])
const isAdmin = req => adminRoles.has(String(req.authUser?.roleName || '').trim().toLowerCase())

const uploadImage = buffer => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'raffle-winners', resource_type: 'image' }, (error, result) => {
        if (error) reject(error)
        else resolve(result)
    })
    stream.end(buffer)
})

async function activeSession(db, req, lock = false) {
    const result = await db.query(`
        SELECT es."ID", es."UserId", es."LocationId", es."ClockIn", u."Name" AS "employeeName"
        FROM "EmployeeSession" es
        JOIN "Users" u ON u."ID" = es."UserId"
        WHERE es."UserId"=$1 AND es."ClockOut" IS NULL
        ORDER BY es."ClockIn" DESC LIMIT 1 ${lock ? 'FOR UPDATE OF es' : ''}`,
        [Number(req.authUser.id)])
    return result.rows[0] || null
}

async function settings(db, locationId) {
    const result = await db.query(`SELECT "LocationId" AS "locationId", "ExcludedMachineIds" AS "excludedMachineIds",
        "AllowRepeatMachine" AS "allowRepeatMachine", "SpinDurationSeconds" AS "spinDurationSeconds"
        FROM "RaffleSettings" WHERE "LocationId"=$1`, [locationId])
    return result.rows[0] || { locationId, excludedMachineIds: [], allowRepeatMachine: false, spinDurationSeconds: 8 }
}


async function eligibleMachines(db, locationId) {
    const cfg = await settings(db, locationId)
    const excluded = Array.isArray(cfg.excludedMachineIds)
        ? cfg.excludedMachineIds.map(Number).filter(Boolean)
        : []

    const result = await db.query(`SELECT m."ID" AS id, m."MachineNumber" AS "machineNumber"
        FROM "Machines" m
        WHERE m.locationid=$1
        AND NOT (m."ID" = ANY($2::bigint[]))
        ORDER BY
          CASE WHEN m."MachineNumber"::text ~ '^\d+$' THEN m."MachineNumber"::text::bigint END NULLS LAST,
          m."MachineNumber"::text`, [locationId, excluded])

    return { cfg, machines: result.rows }
}

async function spin(db, req, raffleId) {
    const raffleResult = await db.query(`SELECT * FROM "Raffles"
        WHERE "ID"=$1 AND "EmployeeId"=$2 AND "Status"='OPEN' FOR UPDATE`,
        [raffleId, Number(req.authUser.id)])

    const raffle = raffleResult.rows[0]
    if (!raffle) throw Object.assign(new Error('Open raffle was not found.'), { status: 404 })

    const { cfg, machines } = await eligibleMachines(db, raffle.LocationId)
    if (!machines.length) throw Object.assign(new Error('No eligible machines are available for this draw.'), { status: 409 })

    const machine = machines[Math.floor(Math.random() * machines.length)]

    await db.query(`INSERT INTO "RaffleAttempts" ("RaffleId","AttemptNo","MachineId","CustomerId")
        VALUES ($1,1,$2,NULL)`, [raffleId, machine.id])

    return {
        raffleId,
        machine,
        spinDurationSeconds: Number(cfg.spinDurationSeconds || 8)
    }
}

router.get('/state', requirePermission('clock.read'), async (req, res) => {
    try {
        const session = await activeSession(pool, req)
        const locationId = Number(session?.LocationId || req.authUser?.locationId)
        if (!validId(locationId)) return fail(res, 400, 'A valid current location is required.')
        const { cfg, machines } = await eligibleMachines(pool, locationId)
        return ok(res, { session, settings: cfg, machines })
    } catch (error) { console.error('Raffle state:', error); return fail(res, 500, 'Unable to load raffle.') }
})

router.post('/start', requirePermission('clock.read'), async (req, res) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const session = await activeSession(client, req, true)
        if (!session) { await client.query('ROLLBACK'); return fail(res, 409, 'Clock in before starting a raffle.') }
        await client.query(`UPDATE "Raffles"
            SET "Status"='NO_WINNER', "CompletedAt"=NOW()
            WHERE "EmployeeId"=$1 AND "Status"='OPEN'`, [req.authUser.id])

        const created = await client.query(`INSERT INTO "Raffles"
            ("LocationId","EmployeeSessionId","EmployeeId","CreatedBy")
            VALUES ($1,$2,$3,$3) RETURNING "ID"`,
            [session.LocationId, session.ID, session.UserId])

        const raffleId = created.rows[0].ID
        const result = await spin(client, req, raffleId)

        await client.query('COMMIT')
        return ok(res, result, 'Machine selected.')
    } catch (error) {
        await client.query('ROLLBACK'); console.error('Raffle start:', error)
        return fail(res, error.status || 500, error.message || 'Unable to start raffle.')
    } finally { client.release() }
})

router.get('/checked-in-customers', requirePermission('clock.read'), async (req, res) => {
    try {
        const session = await activeSession(pool, req)
        if (!session) return fail(res, 409, 'No active employee session.')
        const result = await pool.query(`SELECT c."ID" AS id, c."Firstname" AS firstname, c."Lastname" AS lastname
            FROM "CheckIn" ck JOIN "Customer" c ON c."ID"=ck."CustomerId"
            WHERE ck."LocationId"=$1 AND ck."IsCheckOut"=false ORDER BY c."Firstname", c."Lastname"`, [session.LocationId])
        return ok(res, result.rows)
    } catch (error) { console.error('Raffle customers:', error); return fail(res, 500, 'Unable to load checked-in customers.') }
})

router.post('/:id/complete', requirePermission('clock.update'), upload.single('image'), async (req, res) => {
    const client = await pool.connect()
    try {
        const amount = Number(req.body.amount)
        const customerId = Number(req.body.customerid)
        if (!Number.isFinite(amount) || amount <= 0 || !validId(customerId)) return fail(res, 400, 'Customer and winning amount are required.')
        if (!req.file) return fail(res, 400, 'Winner photo is required.')

        await client.query('BEGIN')
        const raffleResult = await client.query(`SELECT * FROM "Raffles" WHERE "ID"=$1 AND "EmployeeId"=$2 AND "Status"='OPEN' FOR UPDATE`, [Number(req.params.id), req.authUser.id])
        const raffle = raffleResult.rows[0]
        if (!raffle) { await client.query('ROLLBACK'); return fail(res, 404, 'Open raffle was not found.') }
        const winningAttempt = await client.query(`SELECT "MachineId"
            FROM "RaffleAttempts"
            WHERE "RaffleId"=$1
            ORDER BY "AttemptNo" DESC, "ID" DESC
            LIMIT 1`, [raffle.ID])

        if (!winningAttempt.rowCount) {
            await client.query('ROLLBACK')
            return fail(res, 409, 'This raffle does not have a selected machine.')
        }

        const session = await client.query(`SELECT "ID","UserId","LocationId","ClockIn" FROM "EmployeeSession" WHERE "ID"=$1 AND "UserId"=$2 AND "ClockOut" IS NULL FOR UPDATE`, [raffle.EmployeeSessionId, req.authUser.id])
        if (!session.rowCount) { await client.query('ROLLBACK'); return fail(res, 409, 'The employee session is no longer active.') }
        const s = session.rows[0]
        const customer = await client.query(
            `SELECT "ID" FROM "Customer" WHERE "ID"=$1 LIMIT 1`,
            [customerId]
        )

        if (!customer.rowCount) {
            await client.query('ROLLBACK')
            return fail(res, 404, 'Selected customer was not found.')
        }

        const balance = await client.query(`WITH cash AS (
            SELECT COALESCE(SUM("Amount") FILTER (WHERE "Type" IN ('OPENING','OPENING_TRANSFER','CASH_RECEIVED','TRANSFER_IN')),0) income,
                   COALESCE(SUM("Amount") FILTER (WHERE "Type"='TRANSFER_OUT'),0) transfer_out,
                   COALESCE(SUM("Amount") FILTER (WHERE "Type" IN ('EXPENSE','OWNER_WITHDRAWAL')),0) outflow,
                   COUNT(*)::integer entries FROM "SessionCashTransactions" WHERE "SessionId"=$1
          ), points AS (
            SELECT COALESCE(SUM(cm."Points"),0) total FROM "CustomerMatch" cm
            WHERE cm."EmployeeSessionId"=$1
          ), raffles AS (
            SELECT COALESCE(SUM(r."WinningAmount"),0) total FROM "Raffles" r
            WHERE r."EmployeeSessionId"=$1 AND r."Status"='WINNER'
          ), tickets AS (
            SELECT COALESCE(SUM(t."Amount"),0) total FROM "TicketOuts" t
            WHERE t."EmployeeSessionId"=$1
          ), bonuses AS (
            SELECT COALESCE(SUM(b."Amount"),0) total FROM "BonusAwards" b
            WHERE b."EmployeeSessionId"=$1
          ) SELECT (cash.income-cash.transfer_out-cash.outflow-points.total-raffles.total-tickets.total-bonuses.total)::numeric(14,2) balance, cash.entries
            FROM cash CROSS JOIN points CROSS JOIN raffles CROSS JOIN tickets CROSS JOIN bonuses`,
            [s.ID])
        if (!Number(balance.rows[0].entries)) { await client.query('ROLLBACK'); return fail(res, 409, 'Enter or confirm opening cash before paying a raffle winner.') }
        if (Number(balance.rows[0].balance) < amount) { await client.query('ROLLBACK'); return fail(res, 409, `Insufficient session cash. Available: $${Number(balance.rows[0].balance).toFixed(2)}`) }

        const image = await uploadImage(req.file.buffer)
        await client.query(`UPDATE "Raffles" SET "Status"='WINNER', "WinningMachineId"=$2, "WinnerCustomerId"=$3,
            "WinningAmount"=$4, "WinnerImageUrl"=$5, "SessionTransactionId"=NULL, "CompletedAt"=NOW() WHERE "ID"=$1`,
            [raffle.ID, winningAttempt.rows[0].MachineId, customerId, amount.toFixed(2), image.secure_url])
        await client.query('COMMIT')
        return ok(res, { raffleId: raffle.ID }, 'Raffle winner saved and payout deducted from the employee session.')
    } catch (error) {
        await client.query('ROLLBACK'); console.error('Raffle complete:', error)
        return fail(res, 500, 'Unable to complete raffle.')
    } finally { client.release() }
})

router.get('/settings', requirePermission('clock.read'), async (req, res) => {
    try {
        const locationId = Number(req.query.locationid || req.authUser.locationId)
        if (!validId(locationId)) return fail(res, 400, 'Location is required.')
        const cfg = await settings(pool, locationId)
        const machines = await pool.query(`SELECT "ID" AS id, "MachineNumber" AS "machineNumber"
            FROM "Machines" WHERE locationid=$1
            ORDER BY CASE WHEN "MachineNumber"::text ~ '^\\d+$' THEN "MachineNumber"::text::bigint END NULLS LAST, "MachineNumber"::text`, [locationId])
        return ok(res, { ...cfg, machines: machines.rows })
    } catch (error) { console.error('Raffle settings:', error); return fail(res, 500, 'Unable to load raffle settings.') }
})

router.put('/settings', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Only management can change raffle settings.')
        const locationId = Number(req.body.locationid || req.authUser.locationId)
        const excluded = Array.isArray(req.body.excludedMachineIds) ? req.body.excludedMachineIds.map(Number).filter(validId) : []
        const duration = Math.min(30, Math.max(3, Number(req.body.spinDurationSeconds) || 8))
        await pool.query(`INSERT INTO "RaffleSettings" ("LocationId","ExcludedMachineIds","AllowRepeatMachine","SpinDurationSeconds","UpdatedBy")
            VALUES ($1,$2::jsonb,$3,$4,$5) ON CONFLICT ("LocationId") DO UPDATE SET "ExcludedMachineIds"=EXCLUDED."ExcludedMachineIds",
            "AllowRepeatMachine"=EXCLUDED."AllowRepeatMachine", "SpinDurationSeconds"=EXCLUDED."SpinDurationSeconds", "UpdatedBy"=EXCLUDED."UpdatedBy", "UpdatedAt"=NOW()`,
            [locationId, JSON.stringify(excluded), Boolean(req.body.allowRepeatMachine), duration, req.authUser.id])
        return ok(res, null, 'Raffle settings saved.')
    } catch (error) { console.error('Raffle settings save:', error); return fail(res, 500, 'Unable to save raffle settings.') }
})

router.get('/winners', requirePermission('clock.read'), async (req, res) => {
    try {
        const locationId = Number(req.query.locationid || req.authUser.locationId)
        const result = await pool.query(`SELECT r."WinnerCustomerId" AS "customerId", c."Firstname" AS firstname, c."Lastname" AS lastname,
            c."avatar" AS "customerImage",
            COUNT(*)::integer AS wins, COALESCE(SUM(r."WinningAmount"),0)::numeric(14,2) AS "totalWon", MAX(r."CompletedAt") AS "lastWinAt"
            FROM "Raffles" r JOIN "Customer" c ON c."ID"=r."WinnerCustomerId"
            WHERE r."LocationId"=$1 AND r."Status"='WINNER' GROUP BY r."WinnerCustomerId", c."Firstname", c."Lastname", c."avatar"
            ORDER BY MAX(r."CompletedAt") DESC`, [locationId])
        return ok(res, result.rows)
    } catch (error) { console.error('Raffle winners:', error); return fail(res, 500, 'Unable to load winner history.') }
})

router.get('/winners/:customerId', requirePermission('clock.read'), async (req, res) => {
    try {
        const locationId = Number(req.query.locationid || req.authUser.locationId)
        const customerId = Number(req.params.customerId)
        const result = await pool.query(`SELECT r."ID" AS id, r."WinningAmount" AS amount, r."CompletedAt" AS "wonAt", r."WinnerImageUrl" AS "imageUrl",
            m."MachineNumber" AS "machineNumber", u."Name" AS employee, r."EmployeeSessionId" AS "sessionId"
            FROM "Raffles" r LEFT JOIN "Machines" m ON m."ID"=r."WinningMachineId" LEFT JOIN "Users" u ON u."ID"=r."EmployeeId"
            WHERE r."LocationId"=$1 AND r."WinnerCustomerId"=$2 AND r."Status"='WINNER' ORDER BY r."CompletedAt" DESC`, [locationId, customerId])
        return ok(res, result.rows)
    } catch (error) { console.error('Raffle winner detail:', error); return fail(res, 500, 'Unable to load customer raffle history.') }
})

module.exports = router
