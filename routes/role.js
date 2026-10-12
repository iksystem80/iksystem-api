const express = require('express')
const router = express.Router()
const { pool } = require('../db')
const { authenticate } = require('../middleware/auth')
const { requireModuleAccess, isSystemAdmin } = require('../utils/moduleAccess')

router.use(authenticate)

const ok = (res, data, message = 'Success.') => res.json({ success: true, code: 20000, message, data })
const fail = (res, status, message) => res.status(status).json({ success: false, code: status * 100, message })
const roleName = req => String(req.authUser?.roleName || '').trim().toLowerCase()
const roleManager = req => ['system admin','owner','admin'].includes(roleName(req))

function locationId(req) {
  const raw = req.query.locationid ?? req.body.locationid ?? req.authUser?.locationId
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

async function locationAllowed(req, id) {
  if (!id) return false
  if (isSystemAdmin(req)) {
    const found = await pool.query('SELECT 1 FROM "Locations" WHERE "ID"=$1 AND COALESCE("IsActive",true)=true', [id])
    return found.rowCount > 0
  }
  return Number(req.authUser?.locationId) === Number(id)
}

async function normalizeModuleIds(db, ids, allowedIds = null) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(x => Number.isSafeInteger(x) && x > 0))]
  if (!clean.length) return []
  const rows = await db.query(`SELECT "ID","ParentId" FROM "AppModules" WHERE "IsActive"=true AND "ID"=ANY($1::int[])`, [clean])
  const selected = new Set(rows.rows.map(x => Number(x.ID)))
  for (const row of rows.rows) if (row.ParentId) selected.add(Number(row.ParentId))
  if (allowedIds) {
    const allowed = new Set(allowedIds.map(Number))
    return [...selected].filter(x => allowed.has(x))
  }
  return [...selected]
}

async function moduleTree() {
  const result = await pool.query(`SELECT "ID" AS id,"Code" AS code,"Name" AS name,"ParentId" AS "parentId","SortOrder" AS "sortOrder"
    FROM "AppModules" WHERE "IsActive"=true ORDER BY "SortOrder","Name"`)
  const byId = new Map(result.rows.map(row => [Number(row.id), { ...row, children: [] }]))
  const roots = []
  for (const item of byId.values()) {
    if (item.parentId && byId.has(Number(item.parentId))) byId.get(Number(item.parentId)).children.push(item)
    else roots.push(item)
  }
  return { flat: result.rows, tree: roots }
}

const accessRoles = requireModuleAccess('settings.roles')
const managerAccess = async (req, res, next) => {
  if (!roleManager(req)) return fail(res, 403, 'Owner/Admin access required.')
  if (isSystemAdmin(req)) return next()
  return accessRoles(req, res, next)
}

router.get('/getall', managerAccess, async (req, res) => {
  try {
    const loc = locationId(req)
    if (!(await locationAllowed(req, loc))) return fail(res, 403, 'Location access denied.')
    const result = await pool.query(`SELECT "ID" AS id,"Name" AS name,"Description" AS description,
      "IsSystem" AS "isSystem","IsActive" AS "isActive"
      FROM "Roles" WHERE LOWER(BTRIM("Name")) <> 'system admin'
      ORDER BY CASE "Name" WHEN 'Owner' THEN 1 WHEN 'Admin' THEN 2 WHEN 'Manager' THEN 3 WHEN 'Employee' THEN 4 ELSE 5 END,"Name"`)
    return ok(res, result.rows)
  } catch (error) { console.error('Get roles error:', error); return fail(res, 500, 'Unable to load roles.') }
})

// Compatibility endpoint name. It now returns module hierarchy, not CRUD permissions.
router.get('/permissions', managerAccess, async (req, res) => {
  try {
    const loc = locationId(req)
    if (!(await locationAllowed(req, loc))) return fail(res, 403, 'Location access denied.')
    const modules = await moduleTree()
    const locationRows = await pool.query('SELECT "ModuleId" AS id FROM "LocationModules" WHERE "LocationId"=$1', [loc])
    return ok(res, { modules: modules.tree, flat: modules.flat, locationModuleIds: locationRows.rows.map(x => Number(x.id)), locationId: loc })
  } catch (error) { console.error('Get modules error:', error); return fail(res, 500, 'Unable to load modules.') }
})

router.put('/location-modules', managerAccess, async (req, res) => {
  if (!isSystemAdmin(req)) return fail(res, 403, 'System Admin access required.')
  const client = await pool.connect()
  try {
    const loc = locationId(req)
    if (!(await locationAllowed(req, loc))) return fail(res, 403, 'Location access denied.')
    const moduleIds = await normalizeModuleIds(client, req.body.moduleIds)
    await client.query('BEGIN')
    await client.query('DELETE FROM "LocationModules" WHERE "LocationId"=$1', [loc])
    for (const moduleId of moduleIds) await client.query('INSERT INTO "LocationModules" ("LocationId","ModuleId","AssignedBy") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [loc, moduleId, req.authUser.id])
    // If System Admin removes a location module, remove all role assignments to it too.
    await client.query(`DELETE FROM "LocationRoleModules" WHERE "LocationId"=$1 AND NOT ("ModuleId"=ANY($2::int[]))`, [loc, moduleIds.length ? moduleIds : [0]])
    await client.query('COMMIT')
    return ok(res, { moduleIds }, 'Location modules updated.')
  } catch (error) { try { await client.query('ROLLBACK') } catch {} ; console.error('Update location modules:', error); return fail(res, 500, 'Unable to update location modules.') }
  finally { client.release() }
})

router.get('/:id', managerAccess, async (req, res) => {
  try {
    const loc = locationId(req)
    if (!(await locationAllowed(req, loc))) return fail(res, 403, 'Location access denied.')
    const roleResult = await pool.query(`SELECT "ID" AS id,"Name" AS name,"Description" AS description,"IsSystem" AS "isSystem","IsActive" AS "isActive"
      FROM "Roles" WHERE "ID"=$1 AND LOWER(BTRIM("Name")) <> 'system admin' LIMIT 1`, [req.params.id])
    if (!roleResult.rowCount) return fail(res, 404, 'Role not found.')
    const assigned = await pool.query('SELECT "ModuleId" AS id FROM "LocationRoleModules" WHERE "LocationId"=$1 AND "RoleId"=$2', [loc, req.params.id])
    return ok(res, { ...roleResult.rows[0], moduleIds: assigned.rows.map(x => Number(x.id)) })
  } catch (error) { console.error('Get role error:', error); return fail(res, 500, 'Unable to load role.') }
})

router.post('/', managerAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    const loc = locationId(req)
    if (!(await locationAllowed(req, loc))) return fail(res, 403, 'Location access denied.')
    const { name, description, isActive = true } = req.body
    if (!name?.trim()) return fail(res, 400, 'Role name is required.')
    if (String(name).trim().toLowerCase() === 'system admin') return fail(res, 400, 'System Admin is reserved.')
    const allowedRows = await client.query('SELECT "ModuleId" AS id FROM "LocationModules" WHERE "LocationId"=$1', [loc])
    const allowed = allowedRows.rows.map(x => Number(x.id))
    const moduleIds = await normalizeModuleIds(client, req.body.moduleIds, allowed)
    await client.query('BEGIN')
    const result = await client.query(`INSERT INTO "Roles" ("Name","Description","IsActive","DateCreated") VALUES ($1,$2,$3,NOW()) RETURNING "ID" AS id`, [name.trim(), description || null, Boolean(isActive)])
    const roleId = result.rows[0].id
    for (const moduleId of moduleIds) await client.query('INSERT INTO "LocationRoleModules" ("LocationId","RoleId","ModuleId","AssignedBy") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [loc, roleId, moduleId, req.authUser.id])
    await client.query('COMMIT')
    return res.status(201).json({ success: true, code: 20000, message: 'Role created successfully.', data: { id: roleId } })
  } catch (error) { try { await client.query('ROLLBACK') } catch {}; console.error('Create role error:', error); if (error.code === '23505') return fail(res, 409, 'A role with this name already exists.'); return fail(res, 500, 'Unable to create role.') }
  finally { client.release() }
})

router.put('/:id', managerAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    const loc = locationId(req)
    if (!(await locationAllowed(req, loc))) return fail(res, 403, 'Location access denied.')
    const roleId = Number(req.params.id)
    const currentResult = await client.query('SELECT "Name","IsSystem" FROM "Roles" WHERE "ID"=$1', [roleId])
    if (!currentResult.rowCount || String(currentResult.rows[0].Name).trim().toLowerCase() === 'system admin') return fail(res, 404, 'Role not found.')
    const current = currentResult.rows[0]
    const allowedRows = await client.query('SELECT "ModuleId" AS id FROM "LocationModules" WHERE "LocationId"=$1', [loc])
    const allowed = allowedRows.rows.map(x => Number(x.id))
    const moduleIds = await normalizeModuleIds(client, req.body.moduleIds, allowed)
    await client.query('BEGIN')
    // System role identity stays protected, but its module assignment is editable per location.
    if (!current.IsSystem) {
      if (!req.body.name?.trim()) { await client.query('ROLLBACK'); return fail(res, 400, 'Role name is required.') }
      await client.query('UPDATE "Roles" SET "Name"=$1,"Description"=$2,"IsActive"=$3,"DateUpdated"=NOW() WHERE "ID"=$4', [req.body.name.trim(), req.body.description || null, Boolean(req.body.isActive), roleId])
    }
    await client.query('DELETE FROM "LocationRoleModules" WHERE "LocationId"=$1 AND "RoleId"=$2', [loc, roleId])
    for (const moduleId of moduleIds) await client.query('INSERT INTO "LocationRoleModules" ("LocationId","RoleId","ModuleId","AssignedBy") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [loc, roleId, moduleId, req.authUser.id])
    await client.query('COMMIT')
    return ok(res, null, 'Role module access updated successfully.')
  } catch (error) { try { await client.query('ROLLBACK') } catch {}; console.error('Update role error:', error); return fail(res, 500, 'Unable to update role.') }
  finally { client.release() }
})

router.delete('/:id', managerAccess, async (req, res) => {
  try {
    const roleResult = await pool.query('SELECT "Name","IsSystem" FROM "Roles" WHERE "ID"=$1', [req.params.id])
    if (!roleResult.rowCount || String(roleResult.rows[0].Name).trim().toLowerCase() === 'system admin') return fail(res, 404, 'Role not found.')
    if (roleResult.rows[0].IsSystem) return fail(res, 400, 'System roles cannot be deleted.')
    const used = await pool.query('SELECT 1 FROM "Users" WHERE "RoleId"=$1 LIMIT 1', [req.params.id])
    if (used.rowCount) return fail(res, 409, 'This role is assigned to users and cannot be deleted.')
    await pool.query('DELETE FROM "Roles" WHERE "ID"=$1', [req.params.id])
    return ok(res, null, 'Role deleted successfully.')
  } catch (error) { console.error('Delete role error:', error); return fail(res, 500, 'Unable to delete role.') }
})

module.exports = router
