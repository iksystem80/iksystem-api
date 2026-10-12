const { pool } = require('../db')
const { getAuthenticatedUser } = require('../middleware/auth')

const normalizedRole = req => String(req.authUser?.roleName || '').trim().toLowerCase()
const isSystemAdmin = req => normalizedRole(req) === 'system admin'

async function ensureAuthenticated(req, res) {
    if (req.authUser) return true

    const authResult = await getAuthenticatedUser(req)

    if (!authResult.success) {
        res.status(authResult.status).json({
            success: false,
            code: authResult.code,
            message: authResult.message
        })
        return false
    }

    req.authUser = authResult.user
    return true
}

function requestLocationId(req) {
    const value = req.body?.locationid ?? req.query?.locationid ?? req.params?.locationid ?? req.authUser?.locationId
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function resolveRoleId(req) {
    const direct = Number(req.authUser?.roleId ?? req.authUser?.roleid)
    if (Number.isSafeInteger(direct) && direct > 0) return direct
    const userId = Number(req.authUser?.id)
    if (!Number.isSafeInteger(userId) || userId <= 0) return null
    const result = await pool.query('SELECT "RoleId" FROM "Users" WHERE "ID"=$1 LIMIT 1', [userId])
    return result.rowCount ? Number(result.rows[0].RoleId) : null
}

async function hasModuleAccess(req, codes) {
    if (!req.authUser) return false
    if (isSystemAdmin(req)) return true

    const locationId = requestLocationId(req)
    const roleId = await resolveRoleId(req)
    if (!locationId || !roleId) return false

    // Normal users are never allowed to switch authorization context to another location.
    const assignedLocation = Number(req.authUser?.locationId)
    if (Number.isSafeInteger(assignedLocation) && assignedLocation > 0 && assignedLocation !== locationId) return false

    const wanted = (Array.isArray(codes) ? codes : [codes]).map(x => String(x || '').trim()).filter(Boolean)
    if (!wanted.length) return false

    const result = await pool.query(`
        SELECT 1
        FROM "AppModules" m
        JOIN "LocationModules" lm
          ON lm."ModuleId"=m."ID" AND lm."LocationId"=$1
        JOIN "LocationRoleModules" lrm
          ON lrm."ModuleId"=m."ID" AND lrm."LocationId"=$1 AND lrm."RoleId"=$2
        LEFT JOIN "AppModules" parent ON parent."ID"=m."ParentId"
        WHERE m."Code" = ANY($3::text[])
          AND m."IsActive"=true
          AND (
            m."ParentId" IS NULL OR (
              EXISTS (SELECT 1 FROM "LocationModules" plm WHERE plm."LocationId"=$1 AND plm."ModuleId"=m."ParentId")
              AND EXISTS (SELECT 1 FROM "LocationRoleModules" prm WHERE prm."LocationId"=$1 AND prm."RoleId"=$2 AND prm."ModuleId"=m."ParentId")
            )
          )
        LIMIT 1`, [locationId, roleId, wanted])
    return result.rowCount > 0
}

function requireModuleAccess(codes) {
    return async (req, res, next) => {
        try {
            if (!(await ensureAuthenticated(req, res))) return
            if (await hasModuleAccess(req, codes)) return next()
            return res.status(403).json({
                success: false,
                code: 40300,
                message: 'This page/module is not assigned to your role.'
            })
        } catch (error) {
            console.error('Module access check failed:', error)
            return res.status(500).json({
                success: false,
                code: 50000,
                message: 'Unable to verify module access.'
            })
        }
    }
}

function requireAnyAssignedModule() {
    return async (req, res, next) => {
        try {
            if (!(await ensureAuthenticated(req, res))) return
            if (isSystemAdmin(req)) return next()
            const locationId = requestLocationId(req)
            const roleId = await resolveRoleId(req)
            if (!locationId || !roleId) return res.status(403).json({ success: false, code: 40300, message: 'No location/module access.' })
            const result = await pool.query(`SELECT 1 FROM "LocationRoleModules" r
                JOIN "LocationModules" l ON l."LocationId"=r."LocationId" AND l."ModuleId"=r."ModuleId"
                JOIN "AppModules" m ON m."ID"=r."ModuleId" AND m."IsActive"=true
                WHERE r."LocationId"=$1 AND r."RoleId"=$2 LIMIT 1`, [locationId, roleId])
            if (result.rowCount) return next()
            return res.status(403).json({ success: false, code: 40300, message: 'No modules are assigned to your role.' })
        } catch (error) {
            console.error('Any module access check failed:', error)
            return res.status(500).json({ success: false, code: 50000, message: 'Unable to verify module access.' })
        }
    }
}

module.exports = { hasModuleAccess, requireModuleAccess, requireAnyAssignedModule, requestLocationId, isSystemAdmin }
