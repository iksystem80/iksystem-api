const express = require('express')
const router = express.Router()
const { pool } = require('../db')
const { authenticate, requirePermission } = require('../middleware/auth')
router.use(authenticate)

const ok = (res, data, message = 'Success.') => res.json({ success: true, code: 20000, message, data })
const fail = (res, http, message) => res.status(http).json({ success: false, code: http * 100, message })
const adminRoles = new Set(['owner', 'admin', 'system admin'])
const isAdmin = req => adminRoles.has(String(req.authUser?.roleName || '').trim().toLowerCase())
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
const money = (value, allowZero = false) => {
    if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(value ?? '').trim())) return null
    const [units, decimals = ''] = String(value).trim().split('.')
    const cents = Number(units) * 100 + Number(decimals.padEnd(2, '0'))
    return (cents > 0 || (allowZero && cents === 0)) ? (cents / 100).toFixed(2) : null
}
const note = value => String(value || '').trim().slice(0, 500) || null

// Stable newest-first ordering across different money-trail tables.
// Closing and handover can share a timestamp (same DB transaction); their
// independent table IDs are not comparable, so use explicit event priority.
const trailPriority = type => type === 'EMPLOYEE_HANDOVER' ? 2 : type === 'SESSION_CLOSING' ? 1 : 0
const trailRecordNumber = id => {
    const match = String(id || '').match(/-(\d+)$/)
    return match ? Number(match[1]) : 0
}
const compareTrailEvents = (a, b) =>
    new Date(b.eventAt) - new Date(a.eventAt) ||
    trailPriority(b.type) - trailPriority(a.type) ||
    trailRecordNumber(b.id) - trailRecordNumber(a.id) ||
    String(b.id || '').localeCompare(String(a.id || ''))


const quickRanges = new Set(['today', 'week', '30d'])
const quickRange = value => quickRanges.has(String(value || '').trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : 'today'

const validDateOnly = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))

const timestamptzQuickStart = param => `CASE
    WHEN ${param} = 'today' THEN
        ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date::timestamp AT TIME ZONE 'America/Chicago')
    WHEN ${param} = 'week' THEN
        (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')
    ELSE NOW() - interval '30 days'
END`

const localQuickStart = param => `CASE
    WHEN ${param} = 'today' THEN
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date::timestamp
    WHEN ${param} = 'week' THEN
        date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')
    ELSE (NOW() - interval '30 days') AT TIME ZONE 'America/Chicago'
END`

const reportDateParams = req => {
    const startDate = String(req.query.startdate || '').trim() || null
    const endDate = String(req.query.enddate || '').trim() || null
    if (!validDateOnly(startDate) || !validDateOnly(endDate)) return null
    if ((startDate && !endDate) || (!startDate && endDate)) return null
    if (startDate && endDate && startDate > endDate) return null
    return { startDate, endDate }
}

async function authorizedLocation(db, req, locationId) {
    if (!req.authUser || !validId(locationId)) return false
    const result = await db.query('SELECT "CompanyId" FROM "Locations" WHERE "ID" = $1', [Number(locationId)])
    if (!result.rowCount) return false
    if (String(req.authUser.roleName || '').trim().toLowerCase() === 'system admin') return true
    if (Number(result.rows[0].CompanyId) !== Number(req.authUser.companyId)) return false
    // Regular employees can only interact with their own assigned location.
    if (!isAdmin(req) && Number(req.authUser.locationId) !== Number(locationId)) return false
    return true
}

async function ownSession(db, req, sessionId, lock = false) {
    if (!validId(sessionId) || !validId(req.authUser?.id)) return null
    const result = await db.query(`SELECT es."ID", es."UserId", es."LocationId", es."ClockIn", es."ClockOut"
        FROM "EmployeeSession" es WHERE es."ID" = $1 AND es."UserId" = $2 ${lock ? 'FOR UPDATE' : ''}`,
        [Number(sessionId), Number(req.authUser.id)])
    const session = result.rows[0]
    if (!session || !(await authorizedLocation(db, req, session.LocationId))) return null
    return session
}

// One source of truth for points: CustomerMatch. No duplicate expense entries are inserted.
// CustomerMatch.DateAssign is a local timestamp; EmployeeSession.ClockIn/Out are timestamptz.
// Use the same America/Chicago interpretation for both session boundaries.
const pointsWindow = (sessionAlias = 'es', matchAlias = 'cm') => `
    ${matchAlias}."AssignedBy" = ${sessionAlias}."UserId"
    AND ${matchAlias}."LocationId" = ${sessionAlias}."LocationId"
    AND ${matchAlias}."DateAssign" >= (${sessionAlias}."ClockIn" AT TIME ZONE 'America/Chicago')
    AND ${matchAlias}."DateAssign" <= (COALESCE(${sessionAlias}."ClockOut", NOW()) AT TIME ZONE 'America/Chicago')`

// Summary used by /current, manual expenses, and the atomic handover.
// "expenses" means ALL expenses: manually logged cash expenses + assigned point cash.
const balanceQuery = `
    WITH s AS (
        SELECT "ID", "UserId", "LocationId", "ClockIn", "ClockOut"
        FROM "EmployeeSession" WHERE "ID" = $1
    ),
    cash AS (
        SELECT
            COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')), 0)::numeric(14,2) AS opening,
            COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')), 0)::numeric(14,2) AS received,
            COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'EXPENSE'), 0)::numeric(14,2) AS "cashExpenses",
            COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'OWNER_WITHDRAWAL'), 0)::numeric(14,2) AS "ownerWithdrawals",
            COUNT(t."ID")::integer AS entry_count
        FROM s LEFT JOIN "SessionCashTransactions" t ON t."SessionId" = s."ID"
    ),
    point_cash AS (
        SELECT COALESCE(SUM(cm."Points"), 0)::numeric(14,2) AS "pointsExpense",
               COUNT(cm."ID")::integer AS "pointsCount"
        FROM s LEFT JOIN "CustomerMatch" cm ON ${pointsWindow('s', 'cm')}
    )
    SELECT cash.opening, cash.received, cash."cashExpenses", cash."ownerWithdrawals",
           point_cash."pointsExpense", point_cash."pointsCount",
           (cash."cashExpenses" + point_cash."pointsExpense")::numeric(14,2) AS expenses,
           (cash.opening + cash.received - cash."cashExpenses" - point_cash."pointsExpense" - cash."ownerWithdrawals")::numeric(14,2) AS balance,
           cash.entry_count
    FROM cash CROSS JOIN point_cash`

// Point assignments display as read-only items in the ledger. They are NOT writable
// SessionCashTransactions rows, so repeated loading cannot double-charge the customer.
const pointsLedgerQuery = `
    SELECT CONCAT('points-', cm."ID") AS id, 'POINTS_EXPENSE' AS type,
           cm."Points"::numeric(14,2) AS amount,
           (cm."DateAssign" AT TIME ZONE 'America/Chicago') AS "createdAt",
           cm."CustomerId" AS "customerId", cm."MachineId" AS "machineId",
           cm."ID" AS "matchId",
           CONCAT('Customer #', cm."CustomerId", ' · Machine #', COALESCE(cm."MachineId"::text, '—')) AS notes,
           NULL::integer AS "expenseTypeId", 'Cash Points Expense' AS "expenseTypeName"
    FROM "EmployeeSession" es
    JOIN "CustomerMatch" cm ON ${pointsWindow('es', 'cm')}
    WHERE es."ID" = $1`

// Server-side source of truth for completed reading-session profit.
// Profit = SUM((Current IN - Previous IN) - (Current OUT - Previous OUT)).
// The browser never supplies the amount that is posted to finance.
const readingSessionProfitQuery = `
    SELECT COALESCE(SUM(
        (COALESCE(current_reading."CurrentIn",0) - COALESCE(previous_reading.currentin,0))
        -
        (COALESCE(current_reading."CurrentOut",0) - COALESCE(previous_reading.currentout,0))
    ),0)::numeric(14,2) AS profit
    FROM "MachineReadings" current_reading
    JOIN "ReadingSessions" current_session
      ON current_session."ID" = current_reading."SessionId"
    LEFT JOIN LATERAL (
        SELECT previous_mr."CurrentIn" AS currentin,
               previous_mr."CurrentOut" AS currentout
        FROM "MachineReadings" previous_mr
        JOIN "ReadingSessions" previous_session
          ON previous_session."ID" = previous_mr."SessionId"
        WHERE previous_mr."MachineId" = current_reading."MachineId"
          AND previous_mr."SessionId" <> current_reading."SessionId"
          AND previous_mr."ReadingAt" < current_reading."ReadingAt"
          AND previous_session."Status" = 2
          AND COALESCE(previous_session."isDeleted",false) = false
        ORDER BY previous_mr."ReadingAt" DESC, previous_mr."ID" DESC
        LIMIT 1
    ) previous_reading ON true
    WHERE current_reading."SessionId" = $1
      AND current_session."LocationId" = $2
      AND current_session."Status" = 2
      AND COALESCE(current_session."isDeleted",false) = false`



// Unified custody events, one row per business movement rather than one row per debit/credit.
// Machine collection, employee support, and employee withdrawal already have existing
// READING_PROFIT / ADMIN_FUNDING / OWNER_WITHDRAWAL trail rows; do not show duplicates.
async function custodyTrail(locationId, filter = {}) {
    const dates = filter.dates || null
    const params = [locationId, filter.range || null, filter.days || null,
        dates?.startDate || null, dates?.endDate || null, filter.employeeId || null]
    const timeWhere = col => `AND ($2::text IS NULL OR ${col} >= ${timestamptzQuickStart('$2')})
        AND ($3::integer IS NULL OR ${col} >= NOW() - ($3::integer * interval '1 day'))
        AND ($4::date IS NULL OR ${col} >= ($4::date::timestamp AT TIME ZONE 'America/Chicago'))
        AND ($5::date IS NULL OR ${col} < (($5::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))`
    const result = await pool.query(`
        SELECT ('custody-capital-' || c."ID")::text AS id,c."CreatedAt" AS "eventAt",
            'CUSTODY_INITIAL_CAPITAL'::text AS type,c."Amount"::numeric(14,2) AS amount,
            c."Status"::text AS status,NULL::bigint AS "sessionId",c."CreatedBy" AS "employeeId",
            COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Admin') AS employee,
            NULL::text AS "fromName",COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Admin') AS "toName",
            ('Owner capital · ' || COALESCE(c."Notes",'Pending Admin receipt'))::text AS description,
            NULL::numeric(14,2) AS variance
        FROM "LocationCashCapital" c
        JOIN "LocationCashAccounts" a ON a."ID"=c."ToAccountId"
        LEFT JOIN "Users" u ON u."ID"=a."UserId"
        WHERE c."LocationId"=$1 ${timeWhere('c."CreatedAt"')}
          AND ($6::integer IS NULL OR c."CreatedBy"=$6 OR a."UserId"=$6)
        UNION ALL
        SELECT ('custody-transfer-' || t."ID")::text AS id,t."CreatedAt" AS "eventAt",
            ('CUSTODY_' || t."Kind")::text AS type,t."Amount"::numeric(14,2) AS amount,
            t."Status"::text AS status,NULL::bigint AS "sessionId",t."CreatedBy" AS "employeeId",
            COALESCE(NULLIF(BTRIM(src_user."Name"),''),src_user."Username",'Owner/Admin') AS employee,
            COALESCE(NULLIF(BTRIM(src_user."Name"),''),src_user."Username",'Owner/Admin') AS "fromName",
            COALESCE(NULLIF(BTRIM(dst_user."Name"),''),dst_user."Username",'Owner/Admin') AS "toName",
            (t."Kind" || ' · ' || COALESCE(t."Notes",'Cash custody transfer'))::text AS description,
            NULL::numeric(14,2) AS variance
        FROM "LocationCashTransfers" t
        JOIN "LocationCashAccounts" src ON src."ID"=t."FromAccountId"
        JOIN "LocationCashAccounts" dst ON dst."ID"=t."ToAccountId"
        LEFT JOIN "Users" src_user ON src_user."ID"=src."UserId"
        LEFT JOIN "Users" dst_user ON dst_user."ID"=dst."UserId"
        WHERE t."LocationId"=$1 ${timeWhere('t."CreatedAt"')}
          AND ($6::integer IS NULL OR src."UserId"=$6 OR dst."UserId"=$6 OR t."CreatedBy"=$6)
        UNION ALL
        SELECT ('custody-entry-' || e."ID")::text,e."CreatedAt",
            ('CUSTODY_' || e."Kind")::text,e."Amount"::numeric(14,2),
            'Posted'::text,NULL::bigint,e."CreatedBy",
            COALESCE(NULLIF(BTRIM(holder."Name"),''),holder."Username",'Business Bank'),
            NULL::text,NULL::text,COALESCE(e."Notes",e."Kind")::text,NULL::numeric(14,2)
        FROM "LocationCashEntries" e
        JOIN "LocationCashAccounts" a ON a."ID"=e."AccountId"
        LEFT JOIN "Users" holder ON holder."ID"=a."UserId"
        WHERE e."LocationId"=$1
          AND (e."Kind" IN ('CUTOVER_OPENING','OWNER_DISTRIBUTION','DIRECT_EXPENSE')
              OR (e."Kind" IN ('BANK_DEPOSIT','BANK_WITHDRAWAL') AND a."Kind"='BANK'))
          ${timeWhere('e."CreatedAt"')}
          AND ($6::integer IS NULL OR e."CreatedBy"=$6 OR a."UserId"=$6)
        ORDER BY "eventAt" DESC,id DESC`, params)
    return result.rows
}

// Employee session and live transaction ledger; authenticated user identity is server-derived.
router.get('/current', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!req.authUser?.id || !validId(req.query.locationid)) return fail(res, 400, 'Valid location is required.')
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        const sessionResult = await pool.query(`SELECT "ID" AS id, "ClockIn" AS "clockIn", "ClockOut" AS "clockOut"
            FROM "EmployeeSession" WHERE "UserId" = $1 AND "LocationId" = $2 AND "ClockOut" IS NULL
            ORDER BY "ClockIn" DESC LIMIT 1`, [Number(req.authUser.id), locationId])
        const session = sessionResult.rows[0] || null
        const types = await pool.query(`SELECT "ID" AS id, "Name" AS name, "IsActive" AS "isActive"
            FROM "ExpenseTypes" WHERE "LocationId" = $1 ORDER BY "Name"`, [locationId])
        const pending = await pool.query(`SELECT h."ID" AS id, h."Amount" AS amount,
            h."CreatedAt" AS "createdAt", h."Notes" AS notes, h."FromSessionId" AS "fromSessionId",
            COALESCE(NULLIF(BTRIM(u."Name"), ''),u."Username",'Employee') AS "fromEmployee"
            FROM "SessionCashHandovers" h JOIN "Users" u ON u."ID" = h."FromUserId"
            WHERE h."ToUserId" = $1 AND h."LocationId" = $2 AND h."Status" = 'Pending'
            ORDER BY h."CreatedAt", h."ID"`, [Number(req.authUser.id), locationId])
        const pendingAdminFunding = await pool.query(`
            SELECT f."ID" AS id, f."Amount" AS amount, f."FundingType" AS "fundingType",
                   f."CreatedAt" AS "createdAt", f."Notes" AS notes,
                   COALESCE(NULLIF(BTRIM(u."Name"), ''), u."Username", 'Owner/Admin') AS "fromAdmin"
            FROM "AdminCashFunding" f
            JOIN "Users" u ON u."ID" = f."FromUserId"
            WHERE f."ToUserId" = $1
              AND f."LocationId" = $2
              AND f."Status" = 'Pending'
            ORDER BY f."CreatedAt", f."ID"`,
            [Number(req.authUser.id), locationId])
        let transactions = [], summary = null, closing = null
        if (session) {
            const [entries, totals, closed, pointEntries] = await Promise.all([
                pool.query(`SELECT t."ID" AS id, t."Type" AS type, t."Amount" AS amount,
                    t."Notes" AS notes, t."CreatedAt" AS "createdAt", t."ExpenseTypeId" AS "expenseTypeId",
                    t."CreatedBy" AS "createdBy",
                    e."Name" AS "expenseTypeName",
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                         ELSE NULL END AS "takenBy"
                    FROM "SessionCashTransactions" t
                    LEFT JOIN "ExpenseTypes" e ON e."ID" = t."ExpenseTypeId"
                    LEFT JOIN "Users" created_by ON created_by."ID"=t."CreatedBy"
                    WHERE t."SessionId" = $1 ORDER BY t."CreatedAt" DESC,t."ID" DESC`, [session.id]),
                pool.query(balanceQuery, [session.id]),
                pool.query('SELECT "ClosingBalance" AS balance FROM "SessionCashClosings" WHERE "SessionId" = $1', [session.id]),
                pool.query(pointsLedgerQuery, [session.id])
            ])
            transactions = [...entries.rows, ...pointEntries.rows]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            summary = totals.rows[0]; closing = closed.rows[0] || null
        }
        const recipients = await pool.query(`SELECT "ID" AS id,
            COALESCE(NULLIF(BTRIM("Name"),''),"Username",'Employee') AS name
            FROM "Users" WHERE "LocationId" = $1 AND "ID" <> $2 AND "IsActive" = true ORDER BY name`,
            [locationId, Number(req.authUser.id)])
        return ok(res, {
            session, summary, closing, transactions,
            pending: pending.rows,
            pendingAdminFunding: pendingAdminFunding.rows,
            expenseTypes: types.rows,
            recipients: recipients.rows
        })
    } catch (e) { console.error('Finance current:', e); return fail(res, 500, 'Unable to load finances.') }
})

// Opening cash is entered once. A pending incoming handover must be confirmed first.
router.post('/opening', requirePermission('clock.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        const amount = money(req.body.amount, true)
        if (amount === null) return fail(res, 400, 'Enter a nonnegative opening balance with up to two decimals.')

        await client.query('BEGIN')
        const s = await ownSession(client, req, req.body.sessionid, true)
        if (!s) { await client.query('ROLLBACK'); return fail(res, 403, 'Session access denied.') }
        if (s.ClockOut) { await client.query('ROLLBACK'); return fail(res, 409, 'Session is closed.') }
        // Serialize with ledger activation; prevent an unbacked manual cash credit after cutover.
        await client.query('SELECT pg_advisory_xact_lock(80471,$1::integer)', [s.LocationId])
        if (Number(amount) > 0) {
            const custody = await client.query(`SELECT 1 FROM "LocationCashAccounts" WHERE "LocationId"=$1 LIMIT 1`, [s.LocationId])
            if (custody.rowCount) { await client.query('ROLLBACK'); return fail(res, 409, 'Use confirmed Admin funding or employee handover; manual cash opening is disabled for custody-ledger locations.') }
        }

        const pending = await client.query(`
            SELECT 1
            FROM "SessionCashHandovers"
            WHERE "ToUserId"=$1 AND "LocationId"=$2 AND "Status"='Pending'
            UNION ALL
            SELECT 1
            FROM "AdminCashFunding"
            WHERE "ToUserId"=$1 AND "LocationId"=$2 AND "Status"='Pending'
            LIMIT 1`, [s.UserId, s.LocationId])
        if (pending.rowCount) {
            await client.query('ROLLBACK')
            return fail(res, 409, 'Confirm pending cash funding or handover before setting an opening balance.')
        }
        const existing = await client.query(`SELECT "ID" FROM "SessionCashTransactions" WHERE "SessionId"=$1 LIMIT 1`, [s.ID])
        if (existing.rowCount) { await client.query('ROLLBACK'); return fail(res, 409, 'Session already has cash activity.') }
        await client.query(`INSERT INTO "SessionCashTransactions"
            ("SessionId","LocationId","Type","Amount","Notes","CreatedBy")
            VALUES ($1,$2,'OPENING',$3,$4,$5)`, [s.ID, s.LocationId, amount, note(req.body.notes), s.UserId])
        await client.query('COMMIT'); return ok(res, null, 'Opening cash saved.')
    } catch (e) { await client.query('ROLLBACK'); console.error('Finance opening:', e); return fail(res, 500, 'Unable to save opening cash.') }
    finally { client.release() }
})

router.post('/transaction', requirePermission('clock.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        const amount = money(req.body.amount)
        const type = req.body.type
        if (!amount || !['CASH_RECEIVED', 'EXPENSE'].includes(type)) return fail(res, 400, 'Invalid type or amount.')

        await client.query('BEGIN')
        const s = await ownSession(client, req, req.body.sessionid, true)
        if (!s) { await client.query('ROLLBACK'); return fail(res, 403, 'Session access denied.') }
        if (s.ClockOut) { await client.query('ROLLBACK'); return fail(res, 409, 'Session is closed.') }
        await client.query('SELECT pg_advisory_xact_lock(80471,$1::integer)', [s.LocationId])
        if (type === 'CASH_RECEIVED') {
            const custody = await client.query(`SELECT 1 FROM "LocationCashAccounts" WHERE "LocationId"=$1 LIMIT 1`, [s.LocationId])
            if (custody.rowCount) { await client.query('ROLLBACK'); return fail(res, 409, 'Additional employee cash must be sent by Admin through Business Support and confirmed by the employee.') }
        }

        const sum = (await client.query(balanceQuery, [s.ID])).rows[0]
        if (!sum.entry_count) { await client.query('ROLLBACK'); return fail(res, 409, 'Enter or confirm opening cash first.') }
        let expenseTypeId = null
        if (type === 'EXPENSE') {
            if (!validId(req.body.expensetypeid)) { await client.query('ROLLBACK'); return fail(res, 400, 'Expense type required.') }
            const t = await client.query(`SELECT "ID" FROM "ExpenseTypes" WHERE "ID"=$1 AND "LocationId"=$2 AND "IsActive"=true`,
                [Number(req.body.expensetypeid), s.LocationId])
            if (!t.rowCount) { await client.query('ROLLBACK'); return fail(res, 400, 'Invalid or inactive expense type.') }
            if (Number(sum.balance) < Number(amount)) { await client.query('ROLLBACK'); return fail(res, 409, 'Insufficient session cash.') }
            expenseTypeId = Number(req.body.expensetypeid)
        }
        await client.query(`INSERT INTO "SessionCashTransactions"
            ("SessionId","LocationId","Type","Amount","ExpenseTypeId","Notes","CreatedBy")
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [s.ID, s.LocationId, type, amount, expenseTypeId, note(req.body.notes), s.UserId])
        await client.query('COMMIT'); return ok(res, null, 'Transaction recorded.')
    } catch (e) { await client.query('ROLLBACK'); console.error('Finance transaction:', e); return fail(res, 500, 'Unable to record transaction.') }
    finally { client.release() }
})

// Atomic closing + handover: never credit recipient until explicit acceptance.
router.post('/handover-and-clockout', requirePermission('clock.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        if (!validId(req.body.touserid)) return fail(res, 400, 'Choose the receiving employee.')
        await client.query('BEGIN')
        const s = await ownSession(client, req, req.body.sessionid, true)
        if (!s) { await client.query('ROLLBACK'); return fail(res, 403, 'Session access denied.') }
        if (s.ClockOut) { await client.query('ROLLBACK'); return fail(res, 409, 'Session already closed.') }
        const recipient = await client.query(`SELECT "ID" FROM "Users" WHERE "ID"=$1 AND "LocationId"=$2
            AND "IsActive"=true AND "ID"<>$3`, [Number(req.body.touserid), s.LocationId, s.UserId])
        if (!recipient.rowCount) { await client.query('ROLLBACK'); return fail(res, 400, 'Invalid receiving employee.') }
        const totals = (await client.query(balanceQuery, [s.ID])).rows[0]
        if (!totals.entry_count) { await client.query('ROLLBACK'); return fail(res, 409, 'Opening cash must be recorded first.') }
        if (Number(totals.balance) < 0) { await client.query('ROLLBACK'); return fail(res, 409, 'Closing balance cannot be negative.') }

        const actualCash = req.body.actualcash === undefined || req.body.actualcash === null || req.body.actualcash === ''
            ? Number(totals.balance).toFixed(2)
            : money(req.body.actualcash, true)
        if (actualCash === null) {
            await client.query('ROLLBACK')
            return fail(res, 400, 'Physical cash counted must be a nonnegative amount with up to two decimals.')
        }

        const variance = (Number(actualCash) - Number(totals.balance)).toFixed(2)

        const transfer = await client.query(`INSERT INTO "SessionCashHandovers"
            ("FromSessionId","FromUserId","ToUserId","LocationId","Amount","Notes")
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING "ID" AS id`,
            [s.ID, s.UserId, Number(req.body.touserid), s.LocationId, actualCash, note(req.body.notes)])

        await client.query(`INSERT INTO "SessionCashClosings"
            ("SessionId","LocationId","ClosingBalance","ActualCash","Variance","HandoverId","ClosedBy")
            VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [s.ID, s.LocationId, totals.balance, actualCash, variance, transfer.rows[0].id, s.UserId])
        await client.query(`UPDATE "EmployeeSession" SET "ClockOut"=NOW(),
            "TotalWorkingHours"=ROUND((EXTRACT(EPOCH FROM (NOW()-"ClockIn"))/3600)::numeric,2)
            WHERE "ID"=$1 AND "ClockOut" IS NULL`, [s.ID])
        await client.query('COMMIT')
        return ok(res, {
            handoverId: transfer.rows[0].id,
            closingBalance: totals.balance,
            actualCash,
            variance
        }, 'Clocked out. Cash is pending recipient confirmation.')
    } catch (e) {
        await client.query('ROLLBACK'); console.error('Finance handover:', e)
        if (e.code === '23505') return fail(res, 409, 'Session has already been handed over.')
        return fail(res, 500, 'Unable to complete handover.')
    }
    finally { client.release() }
})

// Only designated recipient, on their own active session, can accept. One accepted transfer = one credit.
router.post('/handovers/:id/accept', requirePermission('clock.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        if (!validId(req.params.id)) return fail(res, 400, 'Invalid handover.')
        await client.query('BEGIN')
        const s = await ownSession(client, req, req.body.sessionid, true)
        if (!s) { await client.query('ROLLBACK'); return fail(res, 403, 'Session access denied.') }
        if (s.ClockOut) { await client.query('ROLLBACK'); return fail(res, 409, 'Clock in to accept cash.') }
        const h = await client.query(`SELECT * FROM "SessionCashHandovers" WHERE "ID"=$1 FOR UPDATE`, [Number(req.params.id)])
        const transfer = h.rows[0]
        if (!transfer || transfer.ToUserId !== s.UserId || transfer.LocationId !== s.LocationId) {
            await client.query('ROLLBACK'); return fail(res, 403, 'Handover is not assigned to you.')
        }
        if (transfer.Status !== 'Pending') { await client.query('ROLLBACK'); return fail(res, 409, 'Handover already accepted.') }
        const existing = (await client.query(balanceQuery, [s.ID])).rows[0]
        const ledgerType = existing.entry_count === 0 ? 'OPENING_TRANSFER' : 'TRANSFER_IN'
        await client.query(`INSERT INTO "SessionCashTransactions"
            ("SessionId","LocationId","Type","Amount","TransferId","Notes","CreatedBy")
            VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [s.ID, s.LocationId, ledgerType, transfer.Amount, transfer.ID, `Handover from session #${transfer.FromSessionId}`, s.UserId])
        await client.query(`UPDATE "SessionCashHandovers" SET "Status"='Accepted',
            "ToSessionId"=$1,"AcceptedAt"=NOW(),"AcceptedBy"=$2 WHERE "ID"=$3`,
            [s.ID, s.UserId, transfer.ID])
        await client.query('COMMIT'); return ok(res, { amount: transfer.Amount }, 'Cash handover confirmed and credited.')
    } catch (e) {
        await client.query('ROLLBACK'); console.error('Finance accept:', e)
        if (e.code === '23505') return fail(res, 409, 'This handover has already been credited.')
        return fail(res, 500, 'Unable to accept handover.')
    }
    finally { client.release() }
})

// Historical session cash reconciliation; employees see their own, admins see their location.
// Quick filters use Austin/Chicago calendar boundaries: today or current week.
router.get('/history', requirePermission('clock.read'), async (req, res) => {
    try {
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')

        const range = quickRange(req.query.range)
        const records = await pool.query(`
            SELECT es."ID" AS id, es."ClockIn" AS "clockIn", es."ClockOut" AS "clockOut",
                COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS "employeeName",
                cash.opening, cash.received, cash."cashExpenses", cash."ownerWithdrawals",
                points."pointsExpense", points."pointsCount",
                (cash."cashExpenses" + points."pointsExpense")::numeric(14,2) AS expenses,
                (cash.opening + cash.received - cash."cashExpenses" - points."pointsExpense" - cash."ownerWithdrawals")::numeric(14,2) AS "calculatedBalance",
                c."ClosingBalance" AS "closingBalance",
                c."ActualCash" AS "actualCash",
                c."Variance" AS variance,
                h."Status" AS "handoverStatus",
                COALESCE(NULLIF(BTRIM(to_user."Name"),''),to_user."Username") AS "recipientName"
            FROM "EmployeeSession" es
            JOIN "Users" u ON u."ID" = es."UserId"
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'EXPENSE'),0)::numeric(14,2) AS "cashExpenses",
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" = 'OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals",
                       COUNT(t."ID")::integer AS entry_count
                FROM "SessionCashTransactions" t WHERE t."SessionId" = es."ID"
            ) cash ON TRUE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS "pointsExpense",
                       COUNT(cm."ID")::integer AS "pointsCount"
                FROM "CustomerMatch" cm WHERE ${pointsWindow('es', 'cm')}
            ) points ON TRUE
            LEFT JOIN "SessionCashClosings" c ON c."SessionId" = es."ID"
            LEFT JOIN "SessionCashHandovers" h ON h."ID" = c."HandoverId"
            LEFT JOIN "Users" to_user ON to_user."ID" = h."ToUserId"
            WHERE es."LocationId" = $1
              AND es."ClockIn" >= ${timestamptzQuickStart('$2')}
              AND ($3::boolean OR es."UserId" = $4)
              AND (cash.entry_count > 0 OR points."pointsCount" > 0)
            ORDER BY es."ClockIn" DESC
            LIMIT 300`,
            [locationId, range, isAdmin(req), Number(req.authUser.id)])

        return ok(res, records.rows)
    } catch (e) {
        console.error('Finance history:', e)
        return fail(res, 500, 'Unable to load session cash history.')
    }
})

// Full Session Cash History report.
// Empty start/end dates mean all-time. Admins may filter employees;
// regular employees are always restricted to their own sessions.
router.get('/history/report', requirePermission('clock.read'), async (req, res) => {
    try {
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')

        const dates = reportDateParams(req)
        if (!dates) return fail(res, 400, 'Start and end dates must both be valid YYYY-MM-DD dates.')

        const requestedEmployeeId = validId(req.query.employeeid) ? Number(req.query.employeeid) : null
        const employeeId = isAdmin(req) ? requestedEmployeeId : Number(req.authUser.id)

        const employees = isAdmin(req)
            ? await pool.query(`
                SELECT "ID" AS id,
                       COALESCE(NULLIF(BTRIM("Name"),''),"Username",'Employee') AS name
                FROM "Users"
                WHERE "LocationId"=$1
                ORDER BY name`, [locationId])
            : { rows: [] }

        const records = await pool.query(`
            SELECT es."ID" AS id, es."ClockIn" AS "clockIn", es."ClockOut" AS "clockOut",
                es."UserId" AS "employeeId",
                COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS "employeeName",
                cash.opening, cash.received, cash."cashExpenses", cash."ownerWithdrawals",
                points."pointsExpense", points."pointsCount",
                (cash."cashExpenses" + points."pointsExpense")::numeric(14,2) AS expenses,
                (cash.opening + cash.received - cash."cashExpenses" - points."pointsExpense" - cash."ownerWithdrawals")::numeric(14,2) AS "calculatedBalance",
                c."ClosingBalance" AS "closingBalance",
                c."ActualCash" AS "actualCash",
                c."Variance" AS variance,
                h."Status" AS "handoverStatus",
                COALESCE(NULLIF(BTRIM(to_user."Name"),''),to_user."Username") AS "recipientName"
            FROM "EmployeeSession" es
            JOIN "Users" u ON u."ID" = es."UserId"
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0)::numeric(14,2) AS "cashExpenses",
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals",
                       COUNT(t."ID")::integer AS entry_count
                FROM "SessionCashTransactions" t WHERE t."SessionId"=es."ID"
            ) cash ON TRUE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS "pointsExpense",
                       COUNT(cm."ID")::integer AS "pointsCount"
                FROM "CustomerMatch" cm WHERE ${pointsWindow('es', 'cm')}
            ) points ON TRUE
            LEFT JOIN "SessionCashClosings" c ON c."SessionId"=es."ID"
            LEFT JOIN "SessionCashHandovers" h ON h."ID"=c."HandoverId"
            LEFT JOIN "Users" to_user ON to_user."ID"=h."ToUserId"
            WHERE es."LocationId"=$1
              AND ($2::date IS NULL OR es."ClockIn" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
              AND ($3::date IS NULL OR es."ClockIn" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
              AND ($4::integer IS NULL OR es."UserId"=$4)
              AND (cash.entry_count > 0 OR points."pointsCount" > 0)
            ORDER BY es."ClockIn" DESC`,
            [locationId, dates.startDate, dates.endDate, employeeId])

        const rows = records.rows
        const summary = rows.reduce((acc, row) => {
            acc.sessionCount += 1
            acc.opening += Number(row.opening || 0)
            acc.received += Number(row.received || 0)
            acc.cashExpenses += Number(row.cashExpenses || 0)
            acc.ownerWithdrawals += Number(row.ownerWithdrawals || 0)
            acc.pointsExpense += Number(row.pointsExpense || 0)
            acc.expenses += Number(row.expenses || 0)
            if (row.closingBalance != null) acc.expectedClosing += Number(row.closingBalance || 0)
            if (row.actualCash != null) acc.actualCash += Number(row.actualCash || 0)
            const variance = Number(row.variance || 0)
            acc.variance += variance
            if (variance < 0) acc.short += Math.abs(variance)
            if (variance > 0) acc.over += variance
            return acc
        }, {
            sessionCount: 0, opening: 0, received: 0, cashExpenses: 0, ownerWithdrawals: 0,
            pointsExpense: 0, expenses: 0, expectedClosing: 0, actualCash: 0,
            variance: 0, short: 0, over: 0
        })

        return ok(res, {
            summary,
            employees: employees.rows,
            filters: { startDate: dates.startDate, endDate: dates.endDate, employeeId },
            rows
        })
    } catch (e) {
        console.error('Finance full history report:', e)
        return fail(res, 500, 'Unable to load full session cash report.')
    }
})



// ============================================================
// READING SESSION PROFIT -> FINANCE
// One completed reading session may be posted only once.
// Amount and actor are always resolved by the server.
// ============================================================

router.get('/reading-profit/:sessionId', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.query.locationid)
        const sessionId = Number(req.params.sessionId)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        if (!validId(sessionId)) return fail(res, 400, 'Valid reading session is required.')

        const result = await pool.query(`
            SELECT p."ID" AS id, p."ReadingSessionId" AS "readingSessionId",
                   p."Amount" AS amount, p."PostedBy" AS "postedBy",
                   p."PostedAt" AS "postedAt", p."Notes" AS notes,
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'User') AS "postedByName"
            FROM "ReadingProfitPostings" p
            JOIN "Users" u ON u."ID"=p."PostedBy"
            WHERE p."ReadingSessionId"=$1 AND p."LocationId"=$2
            LIMIT 1`, [sessionId, locationId])

        return ok(res, { posting: result.rows[0] || null })
    } catch (e) {
        console.error('Reading profit status:', e)
        return fail(res, 500, 'Unable to load reading profit posting status.')
    }
})

router.post('/reading-profit/:sessionId', requirePermission('employeesession.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.body.locationid)
        const sessionId = Number(req.params.sessionId)
        if (!(await authorizedLocation(client, req, locationId))) return fail(res, 403, 'Location access denied.')
        if (!validId(sessionId)) return fail(res, 400, 'Valid reading session is required.')

        await client.query('BEGIN')

        const sessionResult = await client.query(`
            SELECT "ID","LocationId","Status","EndedAt"
            FROM "ReadingSessions"
            WHERE "ID"=$1 AND "LocationId"=$2
              AND COALESCE("isDeleted",false)=false
            FOR UPDATE`, [sessionId, locationId])

        const readingSession = sessionResult.rows[0]
        if (!readingSession) {
            await client.query('ROLLBACK')
            return fail(res, 404, 'Reading session was not found.')
        }
        if (Number(readingSession.Status) !== 2) {
            await client.query('ROLLBACK')
            return fail(res, 409, 'Only completed reading sessions can be posted to finance.')
        }

        const existing = await client.query(`
            SELECT p."ID" AS id, p."ReadingSessionId" AS "readingSessionId",
                   p."Amount" AS amount, p."PostedBy" AS "postedBy",
                   p."PostedAt" AS "postedAt", p."Notes" AS notes,
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'User') AS "postedByName"
            FROM "ReadingProfitPostings" p
            JOIN "Users" u ON u."ID"=p."PostedBy"
            WHERE p."ReadingSessionId"=$1 AND p."LocationId"=$2
            FOR UPDATE OF p`, [sessionId, locationId])

        if (existing.rowCount) {
            await client.query('ROLLBACK')
            return fail(res, 409, `Reading session #${sessionId} profit has already been posted to finance.`)
        }

        const total = (await client.query(readingSessionProfitQuery, [sessionId, locationId])).rows[0]
        const profit = Number(total?.profit || 0)
        if (!Number.isFinite(profit)) {
            await client.query('ROLLBACK')
            return fail(res, 500, 'Unable to calculate reading session profit.')
        }

        const inserted = await client.query(`
            INSERT INTO "ReadingProfitPostings"
                ("LocationId","ReadingSessionId","Amount","PostedBy","Notes")
            VALUES ($1,$2,$3,$4,$5)
            RETURNING "ID" AS id, "ReadingSessionId" AS "readingSessionId",
                      "Amount" AS amount, "PostedBy" AS "postedBy",
                      "PostedAt" AS "postedAt", "Notes" AS notes`,
            [locationId, sessionId, profit.toFixed(2), Number(req.authUser.id),
                `Profit from completed reading session #${sessionId}`])

        // Physical machine collection is credited once to the posting Admin's custody.
        // Historic postings are deliberately not backfilled: they need cutover reconciliation.
        if (profit > 0) {
            await client.query('SELECT pg_advisory_xact_lock(80471,$1::integer)', [locationId])
            await client.query(`INSERT INTO "LocationCashAccounts" ("LocationId","Kind","UserId")
                VALUES ($1,'ADMIN',$2) ON CONFLICT DO NOTHING`, [locationId, Number(req.authUser.id)])
            const accountResult = await client.query(`SELECT "ID" FROM "LocationCashAccounts"
                WHERE "LocationId"=$1 AND "Kind"='ADMIN' AND "UserId"=$2`, [locationId, Number(req.authUser.id)])
            await client.query(`INSERT INTO "LocationCashEntries"
                ("LocationId","AccountId","Amount","Kind","ReadingProfitPostingId","CreatedBy","Notes")
                VALUES ($1,$2,$3,'MACHINE_COLLECTION',$4,$5,$6)`,
                [locationId, accountResult.rows[0].ID, profit.toFixed(2), inserted.rows[0].id,
                    Number(req.authUser.id), `Physical machine collection · Reading session #${sessionId}`])
        }

        const actor = await client.query(`
            SELECT COALESCE(NULLIF(BTRIM("Name"),''),"Username",'User') AS name
            FROM "Users" WHERE "ID"=$1`, [Number(req.authUser.id)])

        await client.query('COMMIT')

        return ok(res, {
            posting: { ...inserted.rows[0], postedByName: actor.rows[0]?.name || 'User' }
        }, 'Reading result posted to finance and positive physical cash credited to collector custody.')
    } catch (e) {
        try { await client.query('ROLLBACK') } catch { }
        console.error('Post reading profit:', e)
        if (e.code === '23505') return fail(res, 409, 'This reading session profit has already been posted.')
        return fail(res, 500, 'Unable to post reading session profit.')
    } finally {
        client.release()
    }
})

// ============================================================
// OWNER / ADMIN FUNDING & COMPLETE MONEY TRAIL
// Existing employee session finance behavior above is unchanged.
// ============================================================

// Activity metrics only; never used as a running balance. Inclusive Chicago business dates.
router.get('/admin/activity', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        const startDate = String(req.query.startdate || '')
        const endDate = String(req.query.enddate || '')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate ||
            !Number.isFinite(Date.parse(startDate)) || !Number.isFinite(Date.parse(endDate)))
            return fail(res, 400, 'Valid start and end dates are required.')
        const result = await pool.query(`
            WITH b AS (
                SELECT ($2::date::timestamp AT TIME ZONE 'America/Chicago') AS start_at,
                       (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago') AS end_at,
                       $2::date::timestamp AS start_local, ($3::date + 1)::timestamp AS end_local
            ), funding AS (
                SELECT COALESCE(SUM(f."Amount") FILTER (WHERE f."Status"='Accepted' AND f."AcceptedAt">=b.start_at AND f."AcceptedAt"<b.end_at),0) AS "fundedAccepted",
                       COALESCE(SUM(f."Amount") FILTER (WHERE f."Status"='Pending' AND f."CreatedAt">=b.start_at AND f."CreatedAt"<b.end_at),0) AS "fundedPending"
                FROM "AdminCashFunding" f CROSS JOIN b WHERE f."LocationId"=$1
            ), cash AS (
                SELECT COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0) AS "employeeCashExpenses",
                       COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0) AS "ownerWithdrawals"
                FROM "SessionCashTransactions" t CROSS JOIN b
                WHERE t."LocationId"=$1 AND t."CreatedAt">=b.start_at AND t."CreatedAt"<b.end_at
            ), direct_expenses AS (
                SELECT COALESCE(-SUM(e."Amount"),0) AS "directBusinessExpenses"
                FROM "LocationCashEntries" e CROSS JOIN b
                WHERE e."LocationId"=$1 AND e."Kind"='DIRECT_EXPENSE'
                  AND e."CreatedAt">=b.start_at AND e."CreatedAt"<b.end_at
            ), points AS (
                SELECT COALESCE(SUM(cm."Points"),0) AS "pointsExpense"
                FROM "CustomerMatch" cm CROSS JOIN b
                WHERE cm."LocationId"=$1 AND cm."DateAssign">=b.start_local AND cm."DateAssign"<b.end_local
            ), profit AS (
                SELECT COALESCE(SUM(p."Amount"),0) AS "readingProfit"
                FROM "ReadingProfitPostings" p CROSS JOIN b
                WHERE p."LocationId"=$1 AND p."PostedAt">=b.start_at AND p."PostedAt"<b.end_at
            ), closing AS (
                SELECT COALESCE(SUM(CASE WHEN c."Variance">0 THEN c."Variance" ELSE 0 END),0) AS over,
                       COALESCE(SUM(CASE WHEN c."Variance"<0 THEN ABS(c."Variance") ELSE 0 END),0) AS short
                FROM "SessionCashClosings" c CROSS JOIN b
                WHERE c."LocationId"=$1 AND c."ClosedAt">=b.start_at AND c."ClosedAt"<b.end_at
            ) SELECT funding.*, cash.*, direct_expenses.*,
                     (cash."employeeCashExpenses" + direct_expenses."directBusinessExpenses") AS "cashExpenses",
                     points.*, profit.*, closing.*
              FROM funding CROSS JOIN cash CROSS JOIN direct_expenses CROSS JOIN points CROSS JOIN profit CROSS JOIN closing`,
            [locationId, startDate, endDate])
        return ok(res, { summary: result.rows[0], startDate, endDate })
    } catch (e) { console.error('Finance activity:', e); return fail(res, 500, 'Unable to load financial activity.') }
})

// Owner/Admin dashboard: selectable employees, business funding,
// reconciliation totals, and complete immutable money trail.
router.get('/admin/overview', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        const days = Math.min(365, Math.max(1, Number(req.query.days) || 30))

        const employees = await pool.query(`
            SELECT u."ID" AS id,
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS name,
                   u."JobTitle" AS "jobTitle",
                   EXISTS (
                       SELECT 1 FROM "EmployeeSession" es
                       WHERE es."UserId"=u."ID"
                         AND es."LocationId"=$1
                         AND es."ClockOut" IS NULL
                   ) AS "clockedIn"
            FROM "Users" u
            WHERE u."LocationId"=$1
              AND COALESCE(u."IsActive",true)=true
              AND u."ID"<>$2
            ORDER BY name`,
            [locationId, Number(req.authUser.id)])

        const cashHolders = await pool.query(`
            SELECT es."ID" AS "sessionId", es."UserId" AS "userId",
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS name,
                   es."ClockIn" AS "clockIn",
                   (
                     cash.opening + cash.received
                     - cash."cashExpenses"
                     - cash."ownerWithdrawals"
                     - points."pointsExpense"
                   )::numeric(14,2) AS "currentCash"
            FROM "EmployeeSession" es
            JOIN "Users" u ON u."ID"=es."UserId"
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('OPENING','OPENING_TRANSFER')),0)::numeric(14,2) AS opening,
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type" IN ('CASH_RECEIVED','TRANSFER_IN')),0)::numeric(14,2) AS received,
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='EXPENSE'),0)::numeric(14,2) AS "cashExpenses",
                    COALESCE(SUM(t."Amount") FILTER (WHERE t."Type"='OWNER_WITHDRAWAL'),0)::numeric(14,2) AS "ownerWithdrawals"
                FROM "SessionCashTransactions" t
                WHERE t."SessionId"=es."ID"
            ) cash ON TRUE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS "pointsExpense"
                FROM "CustomerMatch" cm
                WHERE ${pointsWindow('es', 'cm')}
            ) points ON TRUE
            WHERE es."LocationId"=$1
              AND es."ClockOut" IS NULL
            ORDER BY name`,
            [locationId])

        const funding = await pool.query(`
            SELECT f."ID" AS id, f."FundingType" AS "fundingType",
                   f."Amount" AS amount, f."Status" AS status,
                   f."Notes" AS notes, f."CreatedAt" AS "createdAt",
                   f."AcceptedAt" AS "acceptedAt", f."ToSessionId" AS "toSessionId", f."CustodySourceAccountId" AS "custodySourceAccountId",
                   COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Owner/Admin') AS "fromName",
                   COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS "toName"
            FROM "AdminCashFunding" f
            JOIN "Users" src ON src."ID"=f."FromUserId"
            JOIN "Users" dst ON dst."ID"=f."ToUserId"
            WHERE f."LocationId"=$1
              AND f."CreatedAt" >= NOW() - ($2::integer * interval '1 day')
            ORDER BY f."CreatedAt" DESC, f."ID" DESC
            LIMIT 300`, [locationId, days])

        // Seven most recent withdrawals for this location (not a seven-day date filter).
        const withdrawals = await pool.query(`
            SELECT t."ID" AS id, t."SessionId" AS "sessionId",
                   t."Amount" AS amount, t."Notes" AS notes,
                   t."CreatedAt" AS "createdAt",
                   COALESCE(NULLIF(BTRIM(employee."Name"),''),employee."Username",'Employee') AS "employeeName",
                   COALESCE(NULLIF(BTRIM(actor."Name"),''),actor."Username",'Owner/Admin') AS "takenBy"
            FROM "SessionCashTransactions" t
            JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
            JOIN "Users" employee ON employee."ID"=es."UserId"
            LEFT JOIN "Users" actor ON actor."ID"=t."CreatedBy"
            WHERE t."LocationId"=$1 AND es."LocationId"=$1
              AND t."Type"='OWNER_WITHDRAWAL'
            ORDER BY t."CreatedAt" DESC, t."ID" DESC
            LIMIT 7`, [locationId])

        const summary = await pool.query(`
            WITH funding AS (
                SELECT
                    COALESCE(SUM("Amount") FILTER (WHERE "Status"='Accepted'),0)::numeric(14,2) AS "fundedAccepted",
                    COALESCE(SUM("Amount") FILTER (WHERE "Status"='Pending'),0)::numeric(14,2) AS "fundedPending"
                FROM "AdminCashFunding"
                WHERE "LocationId"=$1
                  AND "CreatedAt" >= NOW() - ($2::integer * interval '1 day')
            ),
            manual_expenses AS (
                SELECT COALESCE(SUM(t."Amount"),0)::numeric(14,2) AS amount
                FROM "SessionCashTransactions" t
                JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
                WHERE t."LocationId"=$1
                  AND t."Type"='EXPENSE'
                  AND t."CreatedAt" >= NOW() - ($2::integer * interval '1 day')
            ),
            owner_withdrawals AS (
                SELECT COALESCE(SUM(t."Amount"),0)::numeric(14,2) AS amount
                FROM "SessionCashTransactions" t
                WHERE t."LocationId"=$1
                  AND t."Type"='OWNER_WITHDRAWAL'
                  AND t."CreatedAt" >= NOW() - ($2::integer * interval '1 day')
            ),
            point_expenses AS (
                SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS amount
                FROM "CustomerMatch" cm
                WHERE cm."LocationId"=$1
                  AND cm."DateAssign" >= ((NOW() - ($2::integer * interval '1 day')) AT TIME ZONE 'America/Chicago')
            ),
            closings AS (
                SELECT
                    COALESCE(SUM(c."ClosingBalance"),0)::numeric(14,2) AS "expectedClosing",
                    COALESCE(SUM(c."ActualCash"),0)::numeric(14,2) AS "actualClosing",
                    COALESCE(SUM(c."Variance"),0)::numeric(14,2) AS variance,
                    COALESCE(SUM(CASE WHEN c."Variance" < 0 THEN ABS(c."Variance") ELSE 0 END),0)::numeric(14,2) AS short,
                    COALESCE(SUM(CASE WHEN c."Variance" > 0 THEN c."Variance" ELSE 0 END),0)::numeric(14,2) AS over
                FROM "SessionCashClosings" c
                WHERE c."LocationId"=$1
                  AND c."ClosedAt" >= NOW() - ($2::integer * interval '1 day')
            )
            SELECT funding.*, (manual_expenses.amount + COALESCE((SELECT -SUM(e."Amount") FROM "LocationCashEntries" e
                 WHERE e."LocationId"=$1 AND e."Kind"='DIRECT_EXPENSE'
                 AND e."CreatedAt" >= NOW() - ($2::integer * interval '1 day')),0))::numeric(14,2) AS "cashExpenses",
                   owner_withdrawals.amount AS "ownerWithdrawals",
                   point_expenses.amount AS "pointsExpense",
                   closings."expectedClosing", closings."actualClosing",
                   closings.variance, closings.short, closings.over
            FROM funding, manual_expenses, owner_withdrawals, point_expenses, closings`,
            [locationId, days])

        const trail = await pool.query(`
            SELECT * FROM (
                SELECT
                    ('funding-' || f."ID")::text AS id,
                    f."CreatedAt" AS "eventAt",
                    'ADMIN_FUNDING'::text AS type,
                    f."Amount"::numeric(14,2) AS amount,
                    f."Status"::text AS status,
                    NULL::bigint AS "sessionId",
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS employee,
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Owner/Admin') AS "fromName",
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS "toName",
                    CASE WHEN f."FundingType"='INITIAL_OPENING' THEN 'Opening balance funding'
                         ELSE 'Business support funding' END AS description,
                    NULL::numeric(14,2) AS variance
                FROM "AdminCashFunding" f
                JOIN "Users" src ON src."ID"=f."FromUserId"
                JOIN "Users" dst ON dst."ID"=f."ToUserId"
                WHERE f."LocationId"=$1
                  AND f."CreatedAt" >= NOW() - ($2::integer * interval '1 day')

                UNION ALL

                SELECT
                    ('transaction-' || t."ID")::text,
                    t."CreatedAt",
                    t."Type"::text,
                    t."Amount"::numeric(14,2),
                    'Posted'::text,
                    es."ID",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                         ELSE NULL END,
                    NULL::text,
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN ('Cash taken by ' || COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                               || COALESCE(' · ' || NULLIF(t."Notes",''),''))
                         ELSE COALESCE(et."Name", t."Notes", t."Type") END::text,
                    NULL::numeric(14,2)
                FROM "SessionCashTransactions" t
                JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
                JOIN "Users" u ON u."ID"=es."UserId"
                LEFT JOIN "Users" created_by ON created_by."ID"=t."CreatedBy"
                LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                WHERE t."LocationId"=$1
                  AND t."CreatedAt" >= NOW() - ($2::integer * interval '1 day')

                UNION ALL

                SELECT
                    ('points-' || cm."ID")::text,
                    (cm."DateAssign" AT TIME ZONE 'America/Chicago'),
                    'POINTS_EXPENSE'::text,
                    cm."Points"::numeric(14,2),
                    'Posted'::text,
                    es."ID",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    NULL::text, NULL::text,
                    ('Customer #' || cm."CustomerId" || ' · Machine #' || COALESCE(cm."MachineId"::text,'—'))::text,
                    NULL::numeric(14,2)
                FROM "CustomerMatch" cm
                JOIN "EmployeeSession" es
                  ON es."UserId"=cm."AssignedBy"
                 AND es."LocationId"=cm."LocationId"
                 AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                 AND cm."DateAssign" <= (COALESCE(es."ClockOut",NOW()) AT TIME ZONE 'America/Chicago')
                JOIN "Users" u ON u."ID"=es."UserId"
                WHERE cm."LocationId"=$1
                  AND cm."DateAssign" >= ((NOW() - ($2::integer * interval '1 day')) AT TIME ZONE 'America/Chicago')

                UNION ALL

                SELECT
                    ('handover-' || h."ID")::text,
                    h."CreatedAt",
                    'EMPLOYEE_HANDOVER'::text,
                    h."Amount"::numeric(14,2),
                    h."Status"::text,
                    h."FromSessionId",
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Employee'),
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Employee'),
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee'),
                    'Employee cash handover'::text,
                    NULL::numeric(14,2)
                FROM "SessionCashHandovers" h
                JOIN "Users" src ON src."ID"=h."FromUserId"
                JOIN "Users" dst ON dst."ID"=h."ToUserId"
                WHERE h."LocationId"=$1
                  AND h."CreatedAt" >= NOW() - ($2::integer * interval '1 day')

                UNION ALL

                SELECT
                    ('closing-' || c."SessionId")::text,
                    c."ClosedAt",
                    'SESSION_CLOSING'::text,
                    c."ActualCash"::numeric(14,2),
                    'Closed'::text,
                    c."SessionId",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    NULL::text, NULL::text,
                    ('Expected ' || c."ClosingBalance"::text || ' · Actual ' || c."ActualCash"::text)::text,
                    c."Variance"::numeric(14,2)
                FROM "SessionCashClosings" c
                JOIN "EmployeeSession" es ON es."ID"=c."SessionId"
                JOIN "Users" u ON u."ID"=es."UserId"
                WHERE c."LocationId"=$1
                  AND c."ClosedAt" >= NOW() - ($2::integer * interval '1 day')
            ) x
            ORDER BY "eventAt" DESC, CASE WHEN type = 'EMPLOYEE_HANDOVER' THEN 2 WHEN type = 'SESSION_CLOSING' THEN 1 ELSE 0 END DESC, id DESC
            LIMIT 500`, [locationId, days])

        const [readingProfitPeriod, readingProfitBalance, readingProfitTrail] = await Promise.all([
            pool.query(`SELECT COALESCE(SUM("Amount"),0)::numeric(14,2) AS amount
                        FROM "ReadingProfitPostings"
                        WHERE "LocationId"=$1
                          AND "PostedAt" >= NOW() - ($2::integer * interval '1 day')`, [locationId, days]),
            pool.query(`SELECT COALESCE(SUM("Amount"),0)::numeric(14,2) AS amount
                        FROM "ReadingProfitPostings" WHERE "LocationId"=$1`, [locationId]),
            pool.query(`SELECT ('reading-profit-' || p."ID")::text AS id, p."PostedAt" AS "eventAt",
                               'READING_PROFIT'::text AS type, p."Amount"::numeric(14,2) AS amount,
                               'Posted'::text AS status, p."ReadingSessionId" AS "sessionId",
                               COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Owner/Admin') AS employee,
                               COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Owner/Admin') AS "fromName",
                               NULL::text AS "toName",
                               ('Reading session #' || p."ReadingSessionId" || ' profit')::text AS description,
                               NULL::numeric(14,2) AS variance
                        FROM "ReadingProfitPostings" p
                        JOIN "Users" u ON u."ID"=p."PostedBy"
                        WHERE p."LocationId"=$1
                          AND p."PostedAt" >= NOW() - ($2::integer * interval '1 day')`, [locationId, days])
        ])

        const custodyRows = await custodyTrail(locationId, { days })
        const combinedTrail = [...trail.rows, ...readingProfitTrail.rows, ...custodyRows]
            .sort(compareTrailEvents)
            .slice(0, 500)

        return ok(res, {
            employees: employees.rows,
            cashHolders: cashHolders.rows,
            funding: funding.rows,
            withdrawals: withdrawals.rows,
            summary: {
                ...(summary.rows[0] || {}),
                readingProfit: readingProfitPeriod.rows[0]?.amount || '0.00',
                readingProfitBalance: readingProfitBalance.rows[0]?.amount || '0.00'
            },
            trail: combinedTrail
        })
    } catch (e) {
        console.error('Admin finance overview:', e)
        return fail(res, 500, 'Unable to load owner/admin finance overview.')
    }
})

// Quick Complete Money Trail for the transaction page.
// Exact calendar filters: today or current week.
router.get('/admin/trail', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        const range = quickRange(req.query.range)

        const trail = await pool.query(`
            SELECT * FROM (
                SELECT ('funding-' || f."ID")::text AS id, f."CreatedAt" AS "eventAt",
                    'ADMIN_FUNDING'::text AS type, f."Amount"::numeric(14,2) AS amount,
                    f."Status"::text AS status, NULL::bigint AS "sessionId",
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS employee,
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Owner/Admin') AS "fromName",
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS "toName",
                    CASE WHEN f."FundingType"='INITIAL_OPENING' THEN 'Opening balance funding'
                         ELSE 'Business support funding' END AS description,
                    NULL::numeric(14,2) AS variance
                FROM "AdminCashFunding" f
                JOIN "Users" src ON src."ID"=f."FromUserId"
                JOIN "Users" dst ON dst."ID"=f."ToUserId"
                WHERE f."LocationId"=$1
                  AND f."CreatedAt" >= ${timestamptzQuickStart('$2')}

                UNION ALL

                SELECT ('transaction-' || t."ID")::text, t."CreatedAt", t."Type"::text,
                    t."Amount"::numeric(14,2), 'Posted'::text, es."ID",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                         ELSE NULL END,
                    NULL::text,
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN ('Cash taken by ' || COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                               || COALESCE(' · ' || NULLIF(t."Notes",''),''))
                         ELSE COALESCE(et."Name",t."Notes",t."Type") END::text,
                    NULL::numeric(14,2)
                FROM "SessionCashTransactions" t
                JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
                JOIN "Users" u ON u."ID"=es."UserId"
                LEFT JOIN "Users" created_by ON created_by."ID"=t."CreatedBy"
                LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                WHERE t."LocationId"=$1
                  AND t."CreatedAt" >= ${timestamptzQuickStart('$2')}

                UNION ALL

                SELECT ('points-' || cm."ID")::text,
                    (cm."DateAssign" AT TIME ZONE 'America/Chicago'),
                    'POINTS_EXPENSE'::text, cm."Points"::numeric(14,2), 'Posted'::text,
                    es."ID", COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    NULL::text, NULL::text,
                    ('Customer #' || cm."CustomerId" || ' · Machine #' || COALESCE(cm."MachineId"::text,'—'))::text,
                    NULL::numeric(14,2)
                FROM "CustomerMatch" cm
                JOIN "EmployeeSession" es
                  ON es."UserId"=cm."AssignedBy"
                 AND es."LocationId"=cm."LocationId"
                 AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                 AND cm."DateAssign" <= (COALESCE(es."ClockOut",NOW()) AT TIME ZONE 'America/Chicago')
                JOIN "Users" u ON u."ID"=es."UserId"
                WHERE cm."LocationId"=$1
                  AND cm."DateAssign" >= ${localQuickStart('$2')}

                UNION ALL

                SELECT ('handover-' || h."ID")::text, h."CreatedAt",
                    'EMPLOYEE_HANDOVER'::text, h."Amount"::numeric(14,2), h."Status"::text,
                    h."FromSessionId",
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Employee'),
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Employee'),
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee'),
                    'Employee cash handover'::text, NULL::numeric(14,2)
                FROM "SessionCashHandovers" h
                JOIN "Users" src ON src."ID"=h."FromUserId"
                JOIN "Users" dst ON dst."ID"=h."ToUserId"
                WHERE h."LocationId"=$1
                  AND h."CreatedAt" >= ${timestamptzQuickStart('$2')}

                UNION ALL

                SELECT ('closing-' || c."SessionId")::text, c."ClosedAt",
                    'SESSION_CLOSING'::text, c."ActualCash"::numeric(14,2), 'Closed'::text,
                    c."SessionId",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    NULL::text, NULL::text,
                    ('Expected ' || c."ClosingBalance"::text || ' · Actual ' || c."ActualCash"::text)::text,
                    c."Variance"::numeric(14,2)
                FROM "SessionCashClosings" c
                JOIN "EmployeeSession" es ON es."ID"=c."SessionId"
                JOIN "Users" u ON u."ID"=es."UserId"
                WHERE c."LocationId"=$1
                  AND c."ClosedAt" >= ${timestamptzQuickStart('$2')}
            ) x
            ORDER BY "eventAt" DESC, CASE WHEN type = 'EMPLOYEE_HANDOVER' THEN 2 WHEN type = 'SESSION_CLOSING' THEN 1 ELSE 0 END DESC, id DESC
            LIMIT 500`,
            [locationId, range])

        const readingProfitTrail = await pool.query(`
            SELECT ('reading-profit-' || p."ID")::text AS id, p."PostedAt" AS "eventAt",
                   'READING_PROFIT'::text AS type, p."Amount"::numeric(14,2) AS amount,
                   'Posted'::text AS status, p."ReadingSessionId" AS "sessionId",
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Owner/Admin') AS employee,
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Owner/Admin') AS "fromName",
                   NULL::text AS "toName",
                   ('Reading session #' || p."ReadingSessionId" || ' profit')::text AS description,
                   NULL::numeric(14,2) AS variance
            FROM "ReadingProfitPostings" p
            JOIN "Users" u ON u."ID"=p."PostedBy"
            WHERE p."LocationId"=$1
              AND p."PostedAt" >= ${timestamptzQuickStart('$2')}`, [locationId, range])

        const custodyRows = await custodyTrail(locationId, { range })
        const combined = [...trail.rows, ...readingProfitTrail.rows, ...custodyRows]
            .sort(compareTrailEvents)
            .slice(0, 500)
        return ok(res, combined)
    } catch (e) {
        console.error('Admin quick money trail:', e)
        return fail(res, 500, 'Unable to load complete money trail.')
    }
})

// Full owner/admin Money Trail report.
// Blank dates = all time. Optional employee filter.
router.get('/admin/trail/report', requirePermission('clock.read'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.query.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')

        const dates = reportDateParams(req)
        if (!dates) return fail(res, 400, 'Start and end dates must both be valid YYYY-MM-DD dates.')
        const employeeId = validId(req.query.employeeid) ? Number(req.query.employeeid) : null

        const employees = await pool.query(`
            SELECT "ID" AS id,
                   COALESCE(NULLIF(BTRIM("Name"),''),"Username",'Employee') AS name
            FROM "Users"
            WHERE "LocationId"=$1
            ORDER BY name`, [locationId])

        const trail = await pool.query(`
            SELECT * FROM (
                SELECT ('funding-' || f."ID")::text AS id, f."CreatedAt" AS "eventAt",
                    'ADMIN_FUNDING'::text AS type, f."Amount"::numeric(14,2) AS amount,
                    f."Status"::text AS status, f."ToSessionId" AS "sessionId",
                    f."ToUserId" AS "employeeId",
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS employee,
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Owner/Admin') AS "fromName",
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee') AS "toName",
                    CASE WHEN f."FundingType"='INITIAL_OPENING' THEN 'Opening balance funding'
                         ELSE 'Business support funding' END AS description,
                    NULL::numeric(14,2) AS variance
                FROM "AdminCashFunding" f
                JOIN "Users" src ON src."ID"=f."FromUserId"
                JOIN "Users" dst ON dst."ID"=f."ToUserId"
                WHERE f."LocationId"=$1
                  AND ($2::date IS NULL OR f."CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR f."CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR f."ToUserId"=$4)

                UNION ALL

                SELECT ('transaction-' || t."ID")::text, t."CreatedAt", t."Type"::text,
                    t."Amount"::numeric(14,2), 'Posted'::text, es."ID", es."UserId",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                         ELSE NULL END,
                    NULL::text,
                    CASE WHEN t."Type"='OWNER_WITHDRAWAL'
                         THEN ('Cash taken by ' || COALESCE(NULLIF(BTRIM(created_by."Name"),''),created_by."Username",'Owner/Admin')
                               || COALESCE(' · ' || NULLIF(t."Notes",''),''))
                         ELSE COALESCE(et."Name",t."Notes",t."Type") END::text,
                    NULL::numeric(14,2)
                FROM "SessionCashTransactions" t
                JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
                JOIN "Users" u ON u."ID"=es."UserId"
                LEFT JOIN "Users" created_by ON created_by."ID"=t."CreatedBy"
                LEFT JOIN "ExpenseTypes" et ON et."ID"=t."ExpenseTypeId"
                WHERE t."LocationId"=$1
                  AND ($2::date IS NULL OR t."CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR t."CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR es."UserId"=$4)

                UNION ALL

                SELECT ('points-' || cm."ID")::text,
                    (cm."DateAssign" AT TIME ZONE 'America/Chicago'),
                    'POINTS_EXPENSE'::text, cm."Points"::numeric(14,2), 'Posted'::text,
                    es."ID", es."UserId",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    NULL::text, NULL::text,
                    ('Customer #' || cm."CustomerId" || ' · Machine #' || COALESCE(cm."MachineId"::text,'—'))::text,
                    NULL::numeric(14,2)
                FROM "CustomerMatch" cm
                JOIN "EmployeeSession" es
                  ON es."UserId"=cm."AssignedBy"
                 AND es."LocationId"=cm."LocationId"
                 AND cm."DateAssign" >= (es."ClockIn" AT TIME ZONE 'America/Chicago')
                 AND cm."DateAssign" <= (COALESCE(es."ClockOut",NOW()) AT TIME ZONE 'America/Chicago')
                JOIN "Users" u ON u."ID"=es."UserId"
                WHERE cm."LocationId"=$1
                  AND ($2::date IS NULL OR cm."DateAssign" >= $2::date::timestamp)
                  AND ($3::date IS NULL OR cm."DateAssign" < ($3::date + 1)::timestamp)
                  AND ($4::integer IS NULL OR cm."AssignedBy"=$4)

                UNION ALL

                SELECT ('handover-' || h."ID")::text, h."CreatedAt",
                    'EMPLOYEE_HANDOVER'::text, h."Amount"::numeric(14,2), h."Status"::text,
                    h."FromSessionId", h."FromUserId",
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Employee'),
                    COALESCE(NULLIF(BTRIM(src."Name"),''),src."Username",'Employee'),
                    COALESCE(NULLIF(BTRIM(dst."Name"),''),dst."Username",'Employee'),
                    'Employee cash handover'::text, NULL::numeric(14,2)
                FROM "SessionCashHandovers" h
                JOIN "Users" src ON src."ID"=h."FromUserId"
                JOIN "Users" dst ON dst."ID"=h."ToUserId"
                WHERE h."LocationId"=$1
                  AND ($2::date IS NULL OR h."CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR h."CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR h."FromUserId"=$4 OR h."ToUserId"=$4)

                UNION ALL

                SELECT ('closing-' || c."SessionId")::text, c."ClosedAt",
                    'SESSION_CLOSING'::text, c."ActualCash"::numeric(14,2), 'Closed'::text,
                    c."SessionId", es."UserId",
                    COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee'),
                    NULL::text, NULL::text,
                    ('Expected ' || c."ClosingBalance"::text || ' · Actual ' || c."ActualCash"::text)::text,
                    c."Variance"::numeric(14,2)
                FROM "SessionCashClosings" c
                JOIN "EmployeeSession" es ON es."ID"=c."SessionId"
                JOIN "Users" u ON u."ID"=es."UserId"
                WHERE c."LocationId"=$1
                  AND ($2::date IS NULL OR c."ClosedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR c."ClosedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR es."UserId"=$4)
            ) x
            ORDER BY "eventAt" DESC, CASE WHEN type = 'EMPLOYEE_HANDOVER' THEN 2 WHEN type = 'SESSION_CLOSING' THEN 1 ELSE 0 END DESC, id DESC`,
            [locationId, dates.startDate, dates.endDate, employeeId])

        const summaryResult = await pool.query(`
            WITH funding AS (
                SELECT
                    COALESCE(SUM("Amount") FILTER (WHERE "Status"='Accepted'),0)::numeric(14,2) AS "fundedAccepted",
                    COALESCE(SUM("Amount") FILTER (WHERE "Status"='Pending'),0)::numeric(14,2) AS "fundedPending"
                FROM "AdminCashFunding"
                WHERE "LocationId"=$1
                  AND ($2::date IS NULL OR "CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR "CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR "ToUserId"=$4)
            ),
            manual_expenses AS (
                SELECT COALESCE(SUM(t."Amount"),0)::numeric(14,2) AS amount
                FROM "SessionCashTransactions" t
                JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
                WHERE t."LocationId"=$1 AND t."Type"='EXPENSE'
                  AND ($2::date IS NULL OR t."CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR t."CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR es."UserId"=$4)
            ),
            owner_withdrawals AS (
                SELECT COALESCE(SUM(t."Amount"),0)::numeric(14,2) AS amount
                FROM "SessionCashTransactions" t
                JOIN "EmployeeSession" es ON es."ID"=t."SessionId"
                WHERE t."LocationId"=$1
                  AND t."Type"='OWNER_WITHDRAWAL'
                  AND ($2::date IS NULL OR t."CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR t."CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR es."UserId"=$4)
            ),
            point_expenses AS (
                SELECT COALESCE(SUM(cm."Points"),0)::numeric(14,2) AS amount
                FROM "CustomerMatch" cm
                WHERE cm."LocationId"=$1
                  AND ($2::date IS NULL OR cm."DateAssign" >= $2::date::timestamp)
                  AND ($3::date IS NULL OR cm."DateAssign" < ($3::date + 1)::timestamp)
                  AND ($4::integer IS NULL OR cm."AssignedBy"=$4)
            ),
            closings AS (
                SELECT
                    COALESCE(SUM(c."ClosingBalance"),0)::numeric(14,2) AS "expectedClosing",
                    COALESCE(SUM(c."ActualCash"),0)::numeric(14,2) AS "actualClosing",
                    COALESCE(SUM(c."Variance"),0)::numeric(14,2) AS variance,
                    COALESCE(SUM(CASE WHEN c."Variance"<0 THEN ABS(c."Variance") ELSE 0 END),0)::numeric(14,2) AS short,
                    COALESCE(SUM(CASE WHEN c."Variance">0 THEN c."Variance" ELSE 0 END),0)::numeric(14,2) AS over
                FROM "SessionCashClosings" c
                JOIN "EmployeeSession" es ON es."ID"=c."SessionId"
                WHERE c."LocationId"=$1
                  AND ($2::date IS NULL OR c."ClosedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR c."ClosedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR es."UserId"=$4)
            )
            SELECT funding.*, (manual_expenses.amount + COALESCE((SELECT -SUM(e."Amount") FROM "LocationCashEntries" e
                WHERE e."LocationId"=$1 AND e."Kind"='DIRECT_EXPENSE'
                  AND ($2::date IS NULL OR e."CreatedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($3::date IS NULL OR e."CreatedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
                  AND ($4::integer IS NULL OR e."CreatedBy"=$4)),0))::numeric(14,2) AS "cashExpenses",
                   owner_withdrawals.amount AS "ownerWithdrawals",
                   point_expenses.amount AS "pointsExpense",
                   closings."expectedClosing", closings."actualClosing",
                   closings.variance, closings.short, closings.over
            FROM funding, manual_expenses, owner_withdrawals, point_expenses, closings`,
            [locationId, dates.startDate, dates.endDate, employeeId])

        const readingProfitTrail = await pool.query(`
            SELECT ('reading-profit-' || p."ID")::text AS id, p."PostedAt" AS "eventAt",
                   'READING_PROFIT'::text AS type, p."Amount"::numeric(14,2) AS amount,
                   'Posted'::text AS status, p."ReadingSessionId" AS "sessionId",
                   p."PostedBy" AS "employeeId",
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Owner/Admin') AS employee,
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Owner/Admin') AS "fromName",
                   NULL::text AS "toName",
                   ('Reading session #' || p."ReadingSessionId" || ' profit')::text AS description,
                   NULL::numeric(14,2) AS variance
            FROM "ReadingProfitPostings" p
            JOIN "Users" u ON u."ID"=p."PostedBy"
            WHERE p."LocationId"=$1
              AND ($2::date IS NULL OR p."PostedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
              AND ($3::date IS NULL OR p."PostedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
              AND ($4::integer IS NULL OR p."PostedBy"=$4)`,
            [locationId, dates.startDate, dates.endDate, employeeId])

        const readingProfitSummary = await pool.query(`
            SELECT COALESCE(SUM("Amount"),0)::numeric(14,2) AS amount
            FROM "ReadingProfitPostings"
            WHERE "LocationId"=$1
              AND ($2::date IS NULL OR "PostedAt" >= ($2::date::timestamp AT TIME ZONE 'America/Chicago'))
              AND ($3::date IS NULL OR "PostedAt" < (($3::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
              AND ($4::integer IS NULL OR "PostedBy"=$4)`,
            [locationId, dates.startDate, dates.endDate, employeeId])

        const custodyRows = await custodyTrail(locationId, { dates, employeeId })
        const combinedRows = [...trail.rows, ...readingProfitTrail.rows, ...custodyRows]
            .sort(compareTrailEvents)

        return ok(res, {
            summary: { ...(summaryResult.rows[0] || {}), readingProfit: readingProfitSummary.rows[0]?.amount || '0.00' },
            employees: employees.rows,
            filters: { startDate: dates.startDate, endDate: dates.endDate, employeeId },
            rows: combinedRows
        })
    } catch (e) {
        console.error('Full admin money trail:', e)
        return fail(res, 500, 'Unable to load full money trail report.')
    }
})

// Owner/Admin removes physical cash from an employee's active session.
// This is NOT an operating expense; it is a separate audited session debit.
router.post('/admin/withdrawal', requirePermission('employeesession.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        if (String(req.authUser?.roleName || '').trim().toLowerCase() !== 'admin') return fail(res, 403, 'Only an Admin can receive cash directly from an employee.')

        const locationId = Number(req.body.locationid)
        const sessionId = Number(req.body.sessionid)
        const amount = money(req.body.amount)

        if (!(await authorizedLocation(client, req, locationId))) {
            return fail(res, 403, 'Location access denied.')
        }
        if (!validId(sessionId)) return fail(res, 400, 'Choose an employee with an active session.')
        if (amount === null) return fail(res, 400, 'Enter a positive withdrawal amount with up to two decimals.')

        await client.query('BEGIN')

        const sessionResult = await client.query(`
            SELECT es."ID", es."UserId", es."LocationId", es."ClockIn", es."ClockOut",
                   COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Employee') AS "employeeName"
            FROM "EmployeeSession" es
            JOIN "Users" u ON u."ID"=es."UserId"
            WHERE es."ID"=$1
              AND es."LocationId"=$2
            FOR UPDATE OF es`,
            [sessionId, locationId])

        const session = sessionResult.rows[0]
        if (!session) {
            await client.query('ROLLBACK')
            return fail(res, 404, 'Active employee session was not found.')
        }
        if (session.ClockOut) {
            await client.query('ROLLBACK')
            return fail(res, 409, 'This employee session is already closed.')
        }

        const totals = (await client.query(balanceQuery, [sessionId])).rows[0]
        const available = Number(totals?.balance || 0)
        const requested = Number(amount)

        if (available <= 0) {
            await client.query('ROLLBACK')
            return fail(res, 409, 'This session has no available cash to withdraw.')
        }
        if (requested > available) {
            await client.query('ROLLBACK')
            return fail(res, 409, `Withdrawal exceeds available session cash (${available.toFixed(2)}).`)
        }

        const inserted = await client.query(`
            INSERT INTO "SessionCashTransactions"
                ("SessionId","LocationId","Type","Amount","Notes","CreatedBy")
            VALUES ($1,$2,'OWNER_WITHDRAWAL',$3,$4,$5)
            RETURNING "ID" AS id, "Amount" AS amount, "CreatedAt" AS "createdAt"`,
            [
                sessionId,
                locationId,
                amount,
                note(req.body.notes) || 'Owner/Admin cash withdrawal',
                Number(req.authUser.id)
            ])

        const newBalance = (available - requested).toFixed(2)
        // Employee physical cash moved to the receiving Owner/Admin's custody.
        // Keep existing employee session debit and its new custody credit atomic.
        await client.query('SELECT pg_advisory_xact_lock(80471,$1::integer)', [locationId])
        const holderKind = 'ADMIN'
        await client.query(`INSERT INTO "LocationCashAccounts" ("LocationId","Kind","UserId")
            VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [locationId, holderKind, req.authUser.id])
        const destination = await client.query(`SELECT "ID" FROM "LocationCashAccounts" WHERE "LocationId"=$1 AND "Kind"=$2 AND "UserId"=$3`,
            [locationId, holderKind, req.authUser.id])
        await client.query(`INSERT INTO "LocationCashEntries"
            ("LocationId","AccountId","Amount","Kind","SessionTransactionId","CreatedBy","Notes")
            VALUES ($1,$2,$3,'EMPLOYEE_CASH_TAKEN',$4,$5,$6)`,
            [locationId, destination.rows[0].ID, amount, inserted.rows[0].id, req.authUser.id,
                `Physical cash received from employee session #${sessionId}`])

        await client.query('COMMIT')

        return ok(res, {
            ...inserted.rows[0],
            sessionId,
            employeeId: session.UserId,
            employeeName: session.employeeName,
            previousBalance: available.toFixed(2),
            currentBalance: newBalance
        }, 'Cash withdrawn from employee session.')
    } catch (e) {
        try { await client.query('ROLLBACK') } catch { }
        console.error('Owner/Admin cash withdrawal:', e)
        return fail(res, 500, 'Unable to withdraw cash from employee session.')
    } finally {
        client.release()
    }
})

// Owner/Admin creates physical business cash for an employee.
// The employee must explicitly confirm receipt before their session is credited.
router.post('/admin/funding', requirePermission('employeesession.update'), async (req, res) => {
    try {
        if (String(req.authUser?.roleName || '').trim().toLowerCase() !== 'admin') return fail(res, 403, 'Only an Admin can send business support directly to employees.')
        const locationId = Number(req.body.locationid)
        const toUserId = Number(req.body.touserid)
        const amount = money(req.body.amount)
        const fundingType = String(req.body.fundingtype || '').trim()

        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        if (!validId(toUserId)) return fail(res, 400, 'Choose the receiving employee.')
        if (amount === null) return fail(res, 400, 'Enter a positive amount with up to two decimals.')
        if (!['INITIAL_OPENING', 'BUSINESS_SUPPORT'].includes(fundingType))
            return fail(res, 400, 'Funding type must be Initial Opening or Business Support.')
        const custodyStarted = await pool.query(`SELECT 1 FROM "LocationCashEntries" WHERE "LocationId"=$1 LIMIT 1`, [locationId])
        if (custodyStarted.rowCount) return fail(res, 409, 'Use the custody ledger to send Admin cash to employees; legacy funding creates unbacked cash.')

        const employee = await pool.query(`
            SELECT "ID" FROM "Users"
            WHERE "ID"=$1 AND "LocationId"=$2 AND COALESCE("IsActive",true)=true
            LIMIT 1`, [toUserId, locationId])
        if (!employee.rowCount) return fail(res, 400, 'Receiving employee is not active at this location.')

        if (fundingType === 'INITIAL_OPENING') {
            const existingPending = await pool.query(`
                SELECT 1 FROM "AdminCashFunding"
                WHERE "ToUserId"=$1 AND "LocationId"=$2
                  AND "FundingType"='INITIAL_OPENING' AND "Status"='Pending'
                LIMIT 1`, [toUserId, locationId])
            if (existingPending.rowCount) return fail(res, 409, 'This employee already has pending opening balance funding.')
        }

        const result = await pool.query(`
            INSERT INTO "AdminCashFunding"
                ("LocationId","FromUserId","ToUserId","FundingType","Amount","Notes")
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING "ID" AS id, "FundingType" AS "fundingType",
                      "Amount" AS amount, "Status" AS status, "CreatedAt" AS "createdAt"`,
            [locationId, Number(req.authUser.id), toUserId, fundingType, amount, note(req.body.notes)])

        return ok(res, result.rows[0],
            fundingType === 'INITIAL_OPENING'
                ? 'Opening balance funding is waiting for employee confirmation.'
                : 'Business support cash is waiting for employee confirmation.')
    } catch (e) {
        console.error('Admin funding:', e)
        return fail(res, 500, 'Unable to create business funding.')
    }
})

// Owner/Admin can edit funding only while it is still Pending.
// Accepted funding is intentionally immutable for audit integrity.
router.put('/admin/funding/:id', requirePermission('employeesession.update'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')

        const fundingId = Number(req.params.id)
        const locationId = Number(req.body.locationid)
        const toUserId = Number(req.body.touserid)
        const amount = money(req.body.amount)
        const fundingType = String(req.body.fundingtype || '').trim()

        if (!validId(fundingId)) return fail(res, 400, 'Invalid funding record.')
        if (!(await authorizedLocation(pool, req, locationId)))
            return fail(res, 403, 'Location access denied.')
        if (!validId(toUserId)) return fail(res, 400, 'Choose the receiving employee.')
        if (amount === null)
            return fail(res, 400, 'Enter a positive amount with up to two decimals.')
        if (!['INITIAL_OPENING', 'BUSINESS_SUPPORT'].includes(fundingType))
            return fail(res, 400, 'Funding type must be Initial Opening or Business Support.')

        const employee = await pool.query(`
            SELECT "ID" FROM "Users"
            WHERE "ID"=$1 AND "LocationId"=$2 AND COALESCE("IsActive",true)=true
            LIMIT 1`, [toUserId, locationId])

        if (!employee.rowCount)
            return fail(res, 400, 'Receiving employee is not active at this location.')

        const existing = await pool.query(`
            SELECT "ID","Status"
            FROM "AdminCashFunding"
            WHERE "ID"=$1 AND "LocationId"=$2
            LIMIT 1`, [fundingId, locationId])

        if (!existing.rowCount)
            return fail(res, 404, 'Funding record was not found.')

        if (existing.rows[0].Status !== 'Pending')
            return fail(res, 409, 'Only pending funding can be edited.')
        const linked = await pool.query(`SELECT "CustodySourceAccountId" FROM "AdminCashFunding" WHERE "ID"=$1`, [fundingId])
        if (linked.rows[0]?.CustodySourceAccountId) return fail(res, 409, 'Custody-backed employee support cannot be edited. Cancel and resend it.')

        if (fundingType === 'INITIAL_OPENING') {
            const duplicate = await pool.query(`
                SELECT 1
                FROM "AdminCashFunding"
                WHERE "ToUserId"=$1
                  AND "LocationId"=$2
                  AND "FundingType"='INITIAL_OPENING'
                  AND "Status"='Pending'
                  AND "ID"<>$3
                LIMIT 1`,
                [toUserId, locationId, fundingId])

            if (duplicate.rowCount)
                return fail(res, 409, 'This employee already has another pending opening balance funding.')
        }

        const result = await pool.query(`
            UPDATE "AdminCashFunding"
            SET "ToUserId"=$1,
                "FundingType"=$2,
                "Amount"=$3,
                "Notes"=$4
            WHERE "ID"=$5
              AND "LocationId"=$6
              AND "Status"='Pending'
            RETURNING
                "ID" AS id,
                "ToUserId" AS "toUserId",
                "FundingType" AS "fundingType",
                "Amount" AS amount,
                "Status" AS status,
                "Notes" AS notes,
                "CreatedAt" AS "createdAt"`,
            [toUserId, fundingType, amount, note(req.body.notes), fundingId, locationId])

        if (!result.rowCount)
            return fail(res, 409, 'Funding is no longer pending and cannot be edited.')

        return ok(res, result.rows[0], 'Pending funding updated successfully.')
    } catch (e) {
        console.error('Admin funding edit:', e)
        return fail(res, 500, 'Unable to update funding.')
    }
})

// Pending funding can be cancelled only before the employee accepts it.
router.post('/admin/funding/:id/cancel', requirePermission('employeesession.update'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Owner/Admin access required.')
        const locationId = Number(req.body.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        if (!validId(req.params.id)) return fail(res, 400, 'Invalid funding record.')

        const result = await pool.query(`
            UPDATE "AdminCashFunding"
            SET "Status"='Cancelled',"CancelledAt"=NOW(),"CancelledBy"=$1
            WHERE "ID"=$2 AND "LocationId"=$3 AND "Status"='Pending'
            RETURNING "ID" AS id`,
            [Number(req.authUser.id), Number(req.params.id), locationId])

        if (!result.rowCount) return fail(res, 409, 'Funding was not found or is no longer pending.')
        return ok(res, result.rows[0], 'Pending business funding cancelled.')
    } catch (e) {
        console.error('Admin funding cancel:', e)
        return fail(res, 500, 'Unable to cancel funding.')
    }
})

// Employee confirms physical cash created by Owner/Admin.
// INITIAL_OPENING must be the first session cash activity.
// BUSINESS_SUPPORT is added as additional cash.
router.post('/admin/funding/:id/accept', requirePermission('clock.update'), async (req, res) => {
    const client = await pool.connect()
    try {
        if (!validId(req.params.id)) return fail(res, 400, 'Invalid funding record.')
        await client.query('BEGIN')

        const s = await ownSession(client, req, req.body.sessionid, true)
        if (!s) {
            await client.query('ROLLBACK')
            return fail(res, 403, 'Clock in to accept business cash.')
        }
        if (s.ClockOut) {
            await client.query('ROLLBACK')
            return fail(res, 409, 'Session is closed.')
        }

        const fundingResult = await client.query(`
            SELECT * FROM "AdminCashFunding"
            WHERE "ID"=$1
            FOR UPDATE`, [Number(req.params.id)])
        const funding = fundingResult.rows[0]

        if (!funding || funding.ToUserId !== s.UserId || funding.LocationId !== s.LocationId) {
            await client.query('ROLLBACK')
            return fail(res, 403, 'Funding is not assigned to you.')
        }
        if (funding.Status !== 'Pending') {
            await client.query('ROLLBACK')
            return fail(res, 409, 'Funding is no longer pending.')
        }

        const totals = (await client.query(balanceQuery, [s.ID])).rows[0]

        let ledgerType = 'CASH_RECEIVED'
        if (funding.FundingType === 'INITIAL_OPENING') {
            if (Number(totals.entry_count || 0) > 0) {
                await client.query('ROLLBACK')
                return fail(res, 409, 'This session already has cash activity. Ask Owner/Admin to send Business Support instead.')
            }
            ledgerType = 'OPENING'
        }

        await client.query(`
            INSERT INTO "SessionCashTransactions"
                ("SessionId","LocationId","Type","Amount","FundingId","Notes","CreatedBy")
            VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                s.ID, s.LocationId, ledgerType, funding.Amount, funding.ID,
                funding.FundingType === 'INITIAL_OPENING'
                    ? `Opening balance from Owner/Admin${funding.Notes ? ` · ${funding.Notes}` : ''}`
                    : `Business support from Owner/Admin${funding.Notes ? ` · ${funding.Notes}` : ''}`,
                s.UserId
            ])

        if (funding.CustodySourceAccountId) {
            // Exactly one matching Admin debit, atomically tied to the employee session credit.
            // A location-level lock serializes this with custody transfers and reservations.
            await client.query('SELECT pg_advisory_xact_lock(80471,$1::integer)', [s.LocationId])
            const src = await client.query(`SELECT COALESCE(SUM("Amount"),0)::numeric AS balance
                FROM "LocationCashEntries" WHERE "AccountId"=$1`, [funding.CustodySourceAccountId])
            if (Number(src.rows[0].balance) < Number(funding.Amount)) {
                await client.query('ROLLBACK')
                return fail(res, 409, 'Admin cash balance is insufficient; employee receipt not credited.')
            }
            await client.query(`INSERT INTO "LocationCashEntries"
                ("LocationId","AccountId","Amount","Kind","FundingId","CreatedBy","Notes")
                VALUES ($1,$2,$3,'EMPLOYEE_SUPPORT',$4,$5,$6)`,
                [s.LocationId, funding.CustodySourceAccountId, -Number(funding.Amount), funding.ID, s.UserId,
                `Cash delivered to employee session #${s.ID}`])
        }
        await client.query(`
            UPDATE "AdminCashFunding"
            SET "Status"='Accepted',"ToSessionId"=$1,"AcceptedAt"=NOW(),"AcceptedBy"=$2
            WHERE "ID"=$3`,
            [s.ID, s.UserId, funding.ID])

        await client.query('COMMIT')
        return ok(res, { amount: funding.Amount, fundingType: funding.FundingType },
            funding.FundingType === 'INITIAL_OPENING'
                ? 'Owner/Admin opening balance confirmed and credited.'
                : 'Owner/Admin business support confirmed and credited.')
    } catch (e) {
        await client.query('ROLLBACK')
        console.error('Admin funding accept:', e)
        if (e.code === '23505') return fail(res, 409, 'This funding has already been credited.')
        return fail(res, 500, 'Unable to accept business funding.')
    } finally {
        client.release()
    }
})

router.post('/expense-types', requirePermission('employeesession.update'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Admin access required.')
        const locationId = Number(req.body.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        const name = String(req.body.name || '').trim()
        if (!name || name.length > 100) return fail(res, 400, 'Expense type name must be 1–100 characters.')
        const result = await pool.query(`INSERT INTO "ExpenseTypes" ("LocationId","Name","CreatedBy")
            VALUES ($1,$2,$3) RETURNING "ID" AS id,"Name" AS name`, [locationId, name, Number(req.authUser.id)])
        return ok(res, result.rows[0], 'Expense type created.')
    } catch (e) {
        if (e.code === '23505') return fail(res, 409, 'Expense type already exists.')
        console.error('Finance expense type:', e); return fail(res, 500, 'Unable to create expense type.')
    }
})

router.patch('/expense-types/:id', requirePermission('employeesession.update'), async (req, res) => {
    try {
        if (!isAdmin(req)) return fail(res, 403, 'Admin access required.')
        const locationId = Number(req.body.locationid)
        if (!(await authorizedLocation(pool, req, locationId))) return fail(res, 403, 'Location access denied.')
        if (!validId(req.params.id) || typeof req.body.isactive !== 'boolean') return fail(res, 400, 'Valid expense type and status required.')
        const result = await pool.query(`UPDATE "ExpenseTypes" SET "IsActive"=$1
            WHERE "ID"=$2 AND "LocationId"=$3 RETURNING "ID" AS id`,
            [req.body.isactive, Number(req.params.id), locationId])
        if (!result.rowCount) return fail(res, 404, 'Expense type not found.')
        return ok(res, result.rows[0], 'Expense type updated.')
    } catch (e) { console.error('Finance expense status:', e); return fail(res, 500, 'Unable to update expense type.') }
})

module.exports = router
