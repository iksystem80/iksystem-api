const express = require('express')
const { randomUUID } = require('crypto')
const router = express.Router()
const { pool } = require('../db')
const { authenticate, requirePermission } = require('../middleware/auth')
router.use(authenticate)
const money = v => /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(v ?? '').trim()) && Number(v) > 0 ? Number(v).toFixed(2) : null
const id = v => Number.isSafeInteger(Number(v)) && Number(v) > 0
const role = req => String(req.authUser?.roleName || '').trim().toLowerCase()
const admin = req => ['owner', 'admin', 'system admin'].includes(role(req))
const owner = req => ['owner', 'system admin'].includes(role(req))
const note = v => String(v || '').trim().slice(0, 500) || null
const ok = (res, data, message = 'Success.') => res.json({ success: true, code: 20000, message, data })
const fail = (res, status, message) => res.status(status).json({ success: false, code: status * 100, message })
async function allowed(db, req, location) {
    if (!admin(req) || !id(location)) return false
    const r = await db.query('SELECT "CompanyId" FROM "Locations" WHERE "ID"=$1', [location])
    return !!r.rowCount && (role(req) === 'system admin' || Number(r.rows[0].CompanyId) === Number(req.authUser.companyId))
}
async function receiver(db, location, userId, allowedRoles) {
    if (!id(userId)) return false
    const r = await db.query(`SELECT LOWER(BTRIM(r."Name")) AS role FROM "Users" u
    JOIN "Roles" r ON r."ID"=u."RoleId"
    WHERE u."ID"=$1 AND u."LocationId"=$2 AND COALESCE(u."IsActive",true)=true`, [userId, location])
    return !!r.rowCount && (!allowedRoles || allowedRoles.includes(r.rows[0].role))
}
async function account(db, location, kind, userId) {
    const r = await db.query(`INSERT INTO "LocationCashAccounts" ("LocationId","Kind","UserId") VALUES ($1,$2,$3)
  ON CONFLICT DO NOTHING RETURNING "ID"`, [location, kind, userId || null])
    if (r.rowCount) return r.rows[0].ID
    const found = await db.query(`SELECT "ID" FROM "LocationCashAccounts" WHERE "LocationId"=$1 AND "Kind"=$2 AND "UserId" IS NOT DISTINCT FROM $3`, [location, kind, userId || null]); return found.rows[0].ID
}
async function lock(db, location) { await db.query('SELECT pg_advisory_xact_lock(80471,$1::integer)', [location]) }
async function balance(db, accountId) {
    const r = await db.query(`SELECT COALESCE((SELECT SUM("Amount") FROM "LocationCashEntries" WHERE "AccountId"=$1),0)::numeric(14,2) AS balance,
 COALESCE((SELECT SUM("Amount") FROM "LocationCashTransfers" WHERE "FromAccountId"=$1 AND "Status"='Pending'),0)::numeric(14,2)
 + COALESCE((SELECT SUM("Amount") FROM "AdminCashFunding" WHERE "CustodySourceAccountId"=$1 AND "Status"='Pending'),0)::numeric(14,2) AS reserved`, [accountId])
    return { balance: Number(r.rows[0].balance), reserved: Number(r.rows[0].reserved) }
}
async function entry(db, location, accountId, amount, kind, actor, notes, extra = {}) {
    const r = await db.query(`INSERT INTO "LocationCashEntries" ("LocationId","AccountId","Amount","Kind","CreatedBy","Notes","TransferId","ReadingProfitPostingId","FundingId","SessionTransactionId","CapitalId","MovementKey","ExpenseTypeId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING "ID" AS id`, [location, accountId, amount, kind, actor, notes, extra.transferId || null, extra.postingId || null, extra.fundingId || null, extra.transactionId || null, extra.capitalId || null, extra.movementKey || null, extra.expenseTypeId || null]); return r.rows[0]
}
async function movement(req, res, action) {
    const db = await pool.connect()
    try {
        const location = Number(req.body.locationid); if (!(await allowed(db, req, location))) return fail(res, 403, 'Location access denied.')
        const amount = money(req.body.amount); if (!amount) return fail(res, 400, 'Enter a valid positive amount.')
        await db.query('BEGIN'); await lock(db, location)
        const result = await action(db, location, amount)
        if (result.error) { await db.query('ROLLBACK'); return fail(res, result.status || 409, result.error) }
        await db.query('COMMIT'); return ok(res, result.data || null, result.message)
    } catch (e) { try { await db.query('ROLLBACK') } catch { }; console.error('Location cash:', e); return fail(res, 500, 'Unable to record cash movement.') } finally { db.release() }
}
router.get('/overview', requirePermission('clock.read'), async (req, res) => {
    try {
        const location = Number(req.query.locationid); if (!(await allowed(pool, req, location))) return fail(res, 403, 'Location access denied.')
        const accounts = await pool.query(`SELECT a."ID" AS id,a."Kind" AS kind,a."UserId" AS "userId",COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Business Bank') AS name,
  COALESCE(SUM(e."Amount"),0)::numeric(14,2) AS balance,
   (COALESCE((SELECT SUM(t."Amount") FROM "LocationCashTransfers" t WHERE t."FromAccountId"=a."ID" AND t."Status"='Pending'),0)
   +COALESCE((SELECT SUM(f."Amount") FROM "AdminCashFunding" f WHERE f."CustodySourceAccountId"=a."ID" AND f."Status"='Pending'),0))::numeric(14,2) AS reserved
   FROM "LocationCashAccounts" a LEFT JOIN "Users" u ON u."ID"=a."UserId"
  LEFT JOIN "LocationCashEntries" e ON e."AccountId"=a."ID" WHERE a."LocationId"=$1 GROUP BY a."ID",u."Name",u."Username" ORDER BY a."Kind",name`, [location])
        const pending = await pool.query(`SELECT t."ID" AS id,t."Kind" AS kind,t."Amount" AS amount,t."Notes" AS notes,t."CreatedBy" AS "createdBy",t."CreatedAt" AS "createdAt",t."AcceptedAt" AS "acceptedAt",t."AcceptedBy" AS "acceptedBy",t."CancelledAt" AS "cancelledAt",t."Status" AS status,t."ToAccountId" AS "toAccountId",t."FromAccountId" AS "fromAccountId",src."Kind" AS "fromKind",dst."Kind" AS "toKind",src."UserId" AS "fromUserId",dst."UserId" AS "toUserId",COALESCE(s."Name",s."Username",'Bank') AS "fromName",COALESCE(d."Name",d."Username",'Bank') AS "toName" FROM "LocationCashTransfers" t JOIN "LocationCashAccounts" src ON src."ID"=t."FromAccountId" JOIN "LocationCashAccounts" dst ON dst."ID"=t."ToAccountId" LEFT JOIN "Users" s ON s."ID"=src."UserId" LEFT JOIN "Users" d ON d."ID"=dst."UserId" WHERE t."LocationId"=$1 ORDER BY t."CreatedAt" DESC,t."ID" DESC LIMIT 100`, [location])
        const entries = await pool.query(`SELECT e."ID" AS id,e."Kind" AS kind,e."Amount" AS amount,e."Notes" AS notes,e."CreatedAt" AS "createdAt",a."Kind" AS account,e."ReadingProfitPostingId" AS "readingProfitPostingId",e."TransferId" AS "transferId",COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Business Bank') AS holder FROM "LocationCashEntries" e JOIN "LocationCashAccounts" a ON a."ID"=e."AccountId" LEFT JOIN "Users" u ON u."ID"=a."UserId" WHERE e."LocationId"=$1 ORDER BY e."CreatedAt" DESC,e."ID" DESC LIMIT 200`, [location])
        const expenseTypes = await pool.query(`SELECT "ID" AS id,"Name" AS name FROM "ExpenseTypes" WHERE "LocationId"=$1 AND "IsActive"=true ORDER BY "Name"`, [location])
        const unlinked = await pool.query(`SELECT COUNT(*)::integer AS count,COALESCE(SUM(p."Amount"),0)::numeric(14,2) AS amount FROM "ReadingProfitPostings" p WHERE p."LocationId"=$1 AND NOT EXISTS(SELECT 1 FROM "LocationCashEntries" e WHERE e."ReadingProfitPostingId"=p."ID")`, [location])
        const people = await pool.query(`SELECT u."ID" AS id,COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'User') AS name,LOWER(BTRIM(r."Name")) AS role FROM "Users" u JOIN "Roles" r ON r."ID"=u."RoleId" WHERE u."LocationId"=$1 AND COALESCE(u."IsActive",true)=true ORDER BY name`, [location])
        const capital = await pool.query(`SELECT c."ID" AS id,c."Amount" AS amount,c."Status" AS status,c."Notes" AS notes,c."CreatedAt" AS "createdAt",c."CreatedBy" AS "createdBy",c."AcceptedAt" AS "acceptedAt",c."AcceptedBy" AS "acceptedBy",c."CancelledAt" AS "cancelledAt",a."UserId" AS "toUserId",
      COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Admin') AS "toName" FROM "LocationCashCapital" c
      JOIN "LocationCashAccounts" a ON a."ID"=c."ToAccountId" LEFT JOIN "Users" u ON u."ID"=a."UserId"
      WHERE c."LocationId"=$1 ORDER BY c."CreatedAt" DESC,c."ID" DESC LIMIT 50`, [location])
        const funding = await pool.query(`SELECT f."ID" AS id,f."Amount" AS amount,f."ToUserId" AS "toUserId",f."CustodySourceAccountId" AS "sourceAccountId",f."Status" AS status FROM "AdminCashFunding" f WHERE f."LocationId"=$1 AND f."CustodySourceAccountId" IS NOT NULL AND f."Status"='Pending'`, [location])
        const pendingHandovers = await pool.query(`SELECT COALESCE(SUM("Amount"),0)::numeric(14,2) AS amount FROM "SessionCashHandovers" WHERE "LocationId"=$1 AND "Status"='Pending'`, [location])
        const lifetime = await pool.query(`SELECT
     COALESCE(SUM("Amount") FILTER (WHERE "Kind"='INITIAL_CAPITAL'),0)::numeric(14,2) AS "ownerCapitalContributed",
     COALESCE(-SUM("Amount") FILTER (WHERE "Kind"='OWNER_DISTRIBUTION'),0)::numeric(14,2) AS "ownerDistributions"
     FROM "LocationCashEntries" WHERE "LocationId"=$1`, [location])
        return ok(res, { viewerId: Number(req.authUser.id), accounts: accounts.rows, expenseTypes: expenseTypes.rows, people: people.rows, capital: capital.rows, transfers: pending.rows, entries: entries.rows, unlinkedProfit: unlinked.rows[0], pendingEmployeeSupport: funding.rows, pendingEmployeeHandovers: pendingHandovers.rows[0]?.amount || '0.00', lifetime: lifetime.rows[0] })
    } catch (e) { console.error('Cash custody overview:', e); return fail(res, 500, 'Unable to load cash custody overview.') }
})
router.post('/initial-capital', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    if (!owner(req)) return { status: 403, error: 'Owner role required.' }
    if (!id(req.body.touserid)) return { status: 400, error: 'Choose the receiving Admin.' }
    if (!(await receiver(db, location, Number(req.body.touserid), ['admin', 'system admin']))) return { status: 400, error: 'Select an active Admin at this location.' }
    const a = await account(db, location, 'ADMIN', Number(req.body.touserid))
    const r = await db.query(`INSERT INTO "LocationCashCapital" ("LocationId","ToAccountId","Amount","Notes","CreatedBy") VALUES ($1,$2,$3,$4,$5) RETURNING "ID" AS id`, [location, a, amount, note(req.body.notes), req.authUser.id])
    return { data: r.rows[0], message: 'Owner capital sent for Admin receipt confirmation.' }
}))
router.post('/capital/:id/accept', requirePermission('employeesession.update'), async (req, res) => {
    const db = await pool.connect(); try {
        const location = Number(req.body.locationid); if (!(await allowed(db, req, location)) || !id(req.params.id)) return fail(res, 403, 'Access denied.')
        if (!['admin', 'system admin'].includes(role(req))) return fail(res, 403, 'Admin role required.')
        await db.query('BEGIN'); await lock(db, location)
        const r = await db.query(`SELECT c.*,a."UserId" AS receiver FROM "LocationCashCapital" c
     JOIN "LocationCashAccounts" a ON a."ID"=c."ToAccountId"
     WHERE c."ID"=$1 AND c."LocationId"=$2 FOR UPDATE OF c`, [req.params.id, location]); const c = r.rows[0]
        if (!c || c.Status !== 'Pending') { await db.query('ROLLBACK'); return fail(res, 409, 'Capital funding is no longer pending.') }
        if (Number(c.receiver) !== Number(req.authUser.id)) { await db.query('ROLLBACK'); return fail(res, 403, 'Only the designated Admin can confirm receipt.') }
        await entry(db, location, c.ToAccountId, c.Amount, 'INITIAL_CAPITAL', req.authUser.id,
            c.Notes || `Owner capital #${c.ID}`, { capitalId: c.ID })
        await db.query(`UPDATE "LocationCashCapital" SET "Status"='Accepted',"AcceptedBy"=$2,"AcceptedAt"=NOW() WHERE "ID"=$1`, [c.ID, req.authUser.id])
        await db.query('COMMIT'); return ok(res, null, 'Initial capital confirmed and added to Admin custody.')
    } catch (e) { try { await db.query('ROLLBACK') } catch { }; console.error('Accept capital:', e); return fail(res, 500, 'Unable to confirm capital.') } finally { db.release() }
})
router.post('/capital/:id/cancel', requirePermission('employeesession.update'), async (req, res) => {
    const db = await pool.connect(); try {
        const location = Number(req.body.locationid); if (!(await allowed(db, req, location)) || !id(req.params.id)) return fail(res, 403, 'Access denied.')
        await db.query('BEGIN'); await lock(db, location)
        const r = await db.query(`UPDATE "LocationCashCapital" SET "Status"='Cancelled',"CancelledBy"=$3,"CancelledAt"=NOW()
      WHERE "ID"=$1 AND "LocationId"=$2 AND "Status"='Pending' AND "CreatedBy"=$3 RETURNING "ID"`, [req.params.id, location, req.authUser.id])
        if (!r.rowCount) { await db.query('ROLLBACK'); return fail(res, 409, 'Only the Owner who initiated pending capital can cancel it.') }
        await db.query('COMMIT'); return ok(res, null, 'Pending capital cancelled.')
    } catch (e) { try { await db.query('ROLLBACK') } catch { }; return fail(res, 500, 'Unable to cancel pending capital.') } finally { db.release() }
})
router.post('/cutover-opening', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    if (!owner(req)) return { status: 403, error: 'Owner role required.' }
    if (req.body.confirm !== 'RECONCILED') return { status: 400, error: 'Confirm reconciled historical cash using RECONCILED.' }
    const kind = String(req.body.kind || '').toUpperCase(); if (!['OWNER', 'ADMIN', 'BANK'].includes(kind)) return { status: 400, error: 'Invalid account type.' }
    const user = kind === 'BANK' ? null : Number(req.body.userid); if (kind !== 'BANK' && !id(user)) return { status: 400, error: 'Choose custodian.' }
    if (user && !(await receiver(db, location, user, kind === 'OWNER' ? ['owner', 'system admin'] : ['admin', 'system admin']))) return { status: 400, error: 'Custodian role/location does not match the selected ledger.' }
    const a = await account(db, location, kind, user); const existing = await db.query(`SELECT 1 FROM "LocationCashEntries" WHERE "AccountId"=$1
 UNION ALL SELECT 1 FROM "LocationCashCapital" WHERE "ToAccountId"=$1 AND "Status"='Pending'
 UNION ALL SELECT 1 FROM "LocationCashTransfers" WHERE ("FromAccountId"=$1 OR "ToAccountId"=$1) AND "Status"='Pending'
 UNION ALL SELECT 1 FROM "AdminCashFunding" WHERE "CustodySourceAccountId"=$1 AND "Status"='Pending'
 LIMIT 1`, [a]); if (existing.rowCount) return { error: 'This account already has ledger activity or pending cash. Reconcile and resolve pending funds before cutover.' }
    await entry(db, location, a, amount, 'CUTOVER_OPENING', req.authUser.id, note(req.body.notes) || 'Verified historical cash brought forward'); return { message: 'Reconciled opening balance saved.' }
}))
router.post('/transfer', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    const from = String(req.body.fromkind || '').toUpperCase(), to = String(req.body.tokind || '').toUpperCase()
    if (![['OWNER', 'ADMIN'], ['ADMIN', 'OWNER']].some(([a, b]) => a === from && b === to)) return { status: 400, error: 'Use Owner↔Admin transfer.' }
    if (from === 'OWNER' && !owner(req)) return { status: 403, error: 'Owner role required.' }
    if (from === 'ADMIN' && !['admin', 'system admin'].includes(role(req))) return { status: 403, error: 'Admin role required.' }
    const fromUser = Number(req.authUser.id) // Never let the client debit another person's custody ledger.
    const toUser = Number(req.body.touserid); if (!id(toUser)) return { status: 400, error: 'Choose receiving user.' }
    if (!(await receiver(db, location, toUser, to === 'OWNER' ? ['owner', 'system admin'] : ['admin', 'system admin']))) return { status: 400, error: 'Select an active receiving Owner/Admin at this location.' }
    const src = await account(db, location, from, fromUser), dst = await account(db, location, to, toUser)
    const b = await balance(db, src); if (b.balance - b.reserved < Number(amount)) return { error: 'Insufficient unreserved cash in sender custody.' }
    const t = await db.query(`INSERT INTO "LocationCashTransfers" ("LocationId","FromAccountId","ToAccountId","Amount","Kind","Notes","CreatedBy") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "ID" AS id`, [location, src, dst, amount, `${from}_TO_${to}`, note(req.body.notes), req.authUser.id]); return { data: t.rows[0], message: 'Transfer pending receiver confirmation.' }
}))
router.post('/transfers/:id/accept', requirePermission('employeesession.update'), async (req, res) => {
    const db = await pool.connect(); try {
        const location = Number(req.body.locationid); if (!(await allowed(db, req, location)) || !id(req.params.id)) return fail(res, 403, 'Access denied.')
        await db.query('BEGIN'); await lock(db, location)
        const r = await db.query(`SELECT t.*,a."UserId" AS receiver FROM "LocationCashTransfers" t JOIN "LocationCashAccounts" a ON a."ID"=t."ToAccountId" WHERE t."ID"=$1 AND t."LocationId"=$2 FOR UPDATE OF t`, [req.params.id, location]); const t = r.rows[0]
        if (!t || t.Status !== 'Pending') { await db.query('ROLLBACK'); return fail(res, 409, 'Transfer unavailable.') }
        if (Number(t.receiver) !== Number(req.authUser.id)) { await db.query('ROLLBACK'); return fail(res, 403, 'Only the designated receiver can confirm cash.') }
        const b = await balance(db, t.FromAccountId); if (b.balance < Number(t.Amount)) { await db.query('ROLLBACK'); return fail(res, 409, 'Sender has insufficient balance.') }
        await entry(db, location, t.FromAccountId, -Number(t.Amount), 'TRANSFER', req.authUser.id, `Transfer #${t.ID}`, { transferId: t.ID }); await entry(db, location, t.ToAccountId, t.Amount, 'TRANSFER', req.authUser.id, `Transfer #${t.ID}`, { transferId: t.ID }); await db.query(`UPDATE "LocationCashTransfers" SET "Status"='Accepted',"AcceptedBy"=$2,"AcceptedAt"=NOW() WHERE "ID"=$1`, [t.ID, req.authUser.id]); await db.query('COMMIT'); return ok(res, null, 'Cash receipt confirmed.')
    } catch (e) { try { await db.query('ROLLBACK') } catch { }; console.error('Cash transfer accept:', e); return fail(res, 500, 'Unable to confirm transfer.') } finally { db.release() }
})
router.post('/transfers/:id/cancel', requirePermission('employeesession.update'), async (req, res) => {
    const db = await pool.connect(); try {
        const location = Number(req.body.locationid); if (!(await allowed(db, req, location)) || !id(req.params.id)) return fail(res, 403, 'Access denied.'); await db.query('BEGIN'); await lock(db, location)
        const r = await db.query(`UPDATE "LocationCashTransfers" SET "Status"='Cancelled',"CancelledBy"=$3,"CancelledAt"=NOW() WHERE "ID"=$1 AND "LocationId"=$2 AND "Status"='Pending' AND "CreatedBy"=$3 RETURNING "ID"`, [req.params.id, location, req.authUser.id]); if (!r.rowCount) { await db.query('ROLLBACK'); return fail(res, 409, 'Only the initiator can cancel a pending transfer.') } await db.query('COMMIT'); return ok(res, null, 'Transfer cancelled.')
    } catch (e) { try { await db.query('ROLLBACK') } catch { }; return fail(res, 500, 'Unable to cancel transfer.') } finally { db.release() }
})
router.post('/bank-deposit', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    if (!owner(req)) return { status: 403, error: 'Owner role required.' }
    const src = await account(db, location, 'OWNER', req.authUser.id), dst = await account(db, location, 'BANK', null), b = await balance(db, src); if (b.balance - b.reserved < Number(amount)) return { error: 'Owner has insufficient available cash.' }
    const movementKey = randomUUID(); await entry(db, location, src, -Number(amount), 'BANK_DEPOSIT', req.authUser.id, note(req.body.notes), { movementKey }); await entry(db, location, dst, amount, 'BANK_DEPOSIT', req.authUser.id, note(req.body.notes), { movementKey }); return { message: 'Cash deposited to business bank ledger.' }
}))
router.post('/bank-withdrawal', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    if (!owner(req)) return { status: 403, error: 'Owner role required.' }
    const src = await account(db, location, 'BANK', null), dst = await account(db, location, 'OWNER', req.authUser.id), b = await balance(db, src); if (b.balance - b.reserved < Number(amount)) return { error: 'Insufficient business bank ledger balance.' }
    const movementKey = randomUUID(); await entry(db, location, src, -Number(amount), 'BANK_WITHDRAWAL', req.authUser.id, note(req.body.notes), { movementKey }); await entry(db, location, dst, amount, 'BANK_WITHDRAWAL', req.authUser.id, note(req.body.notes), { movementKey }); return { message: 'Bank cash moved into Owner custody.' }
}))
router.post('/expense', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    const source = String(req.body.source || '').toUpperCase()
    if (!['OWNER', 'ADMIN', 'BANK'].includes(source)) return { status: 400, error: 'Choose an expense source.' }
    if (source === 'OWNER' && !owner(req)) return { status: 403, error: 'Owner role required.' }
    if (source === 'ADMIN' && !['admin', 'system admin'].includes(role(req))) return { status: 403, error: 'Admin role required.' }
    if (source === 'BANK' && !owner(req)) return { status: 403, error: 'Owner role required for bank expense.' }
    if (!id(req.body.expensetypeid)) return { status: 400, error: 'Choose an expense type.' }
    const type = await db.query(`SELECT "ID","Name" FROM "ExpenseTypes" WHERE "ID"=$1 AND "LocationId"=$2 AND "IsActive"=true`, [req.body.expensetypeid, location]); if (!type.rowCount) return { status: 400, error: 'Expense type is not active at this location.' }
    const src = await account(db, location, source, source === 'BANK' ? null : req.authUser.id)
    const b = await balance(db, src); if (b.balance - b.reserved < Number(amount)) return { error: 'Insufficient available funds for expense.' }
    await entry(db, location, src, -Number(amount), 'DIRECT_EXPENSE', req.authUser.id,
        `${type.rows[0].Name}${note(req.body.notes) ? ' · ' + note(req.body.notes) : ''}`, { expenseTypeId: Number(req.body.expensetypeid) })
    return { message: 'Direct business expense posted to custody and operating activity.' }
}))
router.post('/owner-distribution', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    if (!owner(req)) return { status: 403, error: 'Owner role required.' }
    const kind = String(req.body.source || 'OWNER').toUpperCase(); if (!['OWNER', 'BANK'].includes(kind)) return { status: 400, error: 'Choose Owner cash or Bank.' }
    const src = await account(db, location, kind, kind === 'OWNER' ? req.authUser.id : null), b = await balance(db, src); if (b.balance - b.reserved < Number(amount)) return { error: 'Insufficient available funds.' }
    await entry(db, location, src, -Number(amount), 'OWNER_DISTRIBUTION', req.authUser.id, note(req.body.notes) || 'Owner distribution'); return { message: 'Owner distribution recorded; funds left the business.' }
}))
router.post('/employee-support', requirePermission('employeesession.update'), (req, res) => movement(req, res, async (db, location, amount) => {
    if (!['admin', 'system admin'].includes(role(req))) return { status: 403, error: 'Admin role required.' }
    const user = Number(req.body.touserid); if (!id(user)) return { status: 400, error: 'Select receiving employee.' }
    const roleRow = await db.query(`SELECT LOWER(BTRIM(r."Name")) AS role FROM "Users" u JOIN "Roles" r ON r."ID"=u."RoleId" WHERE u."ID"=$1 AND u."LocationId"=$2 AND COALESCE(u."IsActive",true)=true`, [user, location]); if (!roleRow.rowCount || ['owner', 'admin', 'system admin'].includes(roleRow.rows[0].role)) return { status: 400, error: 'Choose an active employee (not Owner/Admin).' }
    const src = await account(db, location, 'ADMIN', req.authUser.id), b = await balance(db, src); if (b.balance - b.reserved < Number(amount)) return { error: 'Insufficient unreserved Admin cash.' }
    const funding = await db.query(`INSERT INTO "AdminCashFunding" ("LocationId","FromUserId","ToUserId","FundingType","Amount","Notes","CustodySourceAccountId") VALUES ($1,$2,$3,'BUSINESS_SUPPORT',$4,$5,$6) RETURNING "ID" AS id`, [location, req.authUser.id, user, amount, note(req.body.notes), src]); return { data: funding.rows[0], message: 'Employee support pending confirmation; Admin funds reserved.' }
}))
// Read-only: positive machine-reading cash actually credited to the signed-in Admin custody.
// All-time summary is calculated separately from the capped recent list.
router.get('/machine-collections', requirePermission('clock.read'), async (req, res) => {
    try {
        const location = Number(req.query.locationid)
        if (!(await allowed(pool, req, location))) return fail(res, 403, 'Location access denied.')
        if (role(req) !== 'admin') return fail(res, 403, 'Admin access required.')
        const params = [location, Number(req.authUser.id)]
        const where = `FROM "LocationCashEntries" e
      JOIN "LocationCashAccounts" a ON a."ID" = e."AccountId"
      JOIN "ReadingProfitPostings" p ON p."ID" = e."ReadingProfitPostingId"
      WHERE e."LocationId" = $1 AND a."LocationId" = $1
        AND a."Kind" = 'ADMIN' AND a."UserId" = $2
        AND e."Kind" = 'MACHINE_COLLECTION' AND e."Amount" > 0
        AND p."LocationId" = $1`
        const [totals, recent] = await Promise.all([
            pool.query(`SELECT COUNT(*)::integer AS count, COALESCE(SUM(e."Amount"),0)::numeric(14,2) AS total ${where}`, params),
            pool.query(`SELECT e."ID" AS id, p."ReadingSessionId" AS "readingSessionId",
        e."Amount"::numeric(14,2) AS amount, e."CreatedAt" AS "creditedAt",
        COALESCE(NULLIF(BTRIM(u."Name"),''),u."Username",'Admin') AS "postedByName"
        FROM "LocationCashEntries" e
        JOIN "LocationCashAccounts" a ON a."ID" = e."AccountId"
        JOIN "ReadingProfitPostings" p ON p."ID" = e."ReadingProfitPostingId"
        LEFT JOIN "Users" u ON u."ID" = p."PostedBy"
        WHERE e."LocationId" = $1 AND a."LocationId" = $1
          AND a."Kind" = 'ADMIN' AND a."UserId" = $2
          AND e."Kind" = 'MACHINE_COLLECTION' AND e."Amount" > 0
          AND p."LocationId" = $1
        ORDER BY e."CreatedAt" DESC, e."ID" DESC LIMIT 50`, params)
        ])
        return ok(res, { count: totals.rows[0].count, total: totals.rows[0].total, rows: recent.rows })
    } catch (e) {
        console.error('Admin machine collections:', e)
        return fail(res, 500, 'Unable to load Admin machine collections.')
    }
})

module.exports = router
