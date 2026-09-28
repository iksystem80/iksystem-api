const express = require('express')
const router = express.Router()
const { pool } = require('../db')
const { authenticate, requirePermission } = require('../middleware/auth')

router.use(authenticate)

router.get('/getall', requirePermission('roles.read'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "ID" AS id, "Name" AS name, "Description" AS description,
              "IsSystem" AS "isSystem", "IsActive" AS "isActive"
       FROM "Roles"
       ORDER BY CASE "Name" WHEN 'Owner' THEN 1 WHEN 'Admin' THEN 2 WHEN 'Manager' THEN 3 WHEN 'Employee' THEN 4 ELSE 5 END, "Name"`
    )
    return res.status(200).json({ success: true, code: 20000, data: result.rows })
  } catch (error) {
    console.error('Get roles error:', error)
    return res.status(500).json({ success: false, code: 50000, message: 'Unable to load roles.' })
  }
})

router.get('/permissions', requirePermission('roles.read'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "ID" AS id, "Code" AS code, "Module" AS module, "Action" AS action, "Description" AS description
       FROM "Permissions"
       ORDER BY "Module", "Action"`
    )
    return res.status(200).json({ success: true, code: 20000, data: result.rows })
  } catch (error) {
    console.error('Get permissions error:', error)
    return res.status(500).json({ success: false, code: 50000, message: 'Unable to load permissions.' })
  }
})

router.get('/:id', requirePermission('roles.read'), async (req, res) => {
  try {
    const roleResult = await pool.query(
      `SELECT "ID" AS id, "Name" AS name, "Description" AS description,
              "IsSystem" AS "isSystem", "IsActive" AS "isActive"
       FROM "Roles" WHERE "ID"=$1 LIMIT 1`,
      [req.params.id]
    )

    if (!roleResult.rowCount) {
      return res.status(404).json({ success: false, code: 40400, message: 'Role not found.' })
    }

    const permissionResult = await pool.query(
      `SELECT "PermissionId" AS "permissionId" FROM "RolePermissions" WHERE "RoleId"=$1`,
      [req.params.id]
    )

    return res.status(200).json({
      success: true,
      code: 20000,
      data: { ...roleResult.rows[0], permissionIds: permissionResult.rows.map(x => x.permissionId) },
    })
  } catch (error) {
    console.error('Get role error:', error)
    return res.status(500).json({ success: false, code: 50000, message: 'Unable to load role.' })
  }
})

router.post('/', requirePermission('roles.create'), async (req, res) => {
  const client = await pool.connect()
  try {
    const { name, description, isActive = true, permissionIds = [] } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ success: false, code: 40000, message: 'Role name is required.' })
    }

    await client.query('BEGIN')
    const result = await client.query(
      `INSERT INTO "Roles" ("Name","Description","IsActive","DateCreated")
       VALUES ($1,$2,$3,NOW()) RETURNING "ID" AS id`,
      [name.trim(), description || null, Boolean(isActive)]
    )

    const roleId = result.rows[0].id
    for (const permissionId of permissionIds) {
      await client.query(
        `INSERT INTO "RolePermissions" ("RoleId","PermissionId") VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [roleId, Number(permissionId)]
      )
    }

    await client.query('COMMIT')
    return res.status(201).json({ success: true, code: 20000, message: 'Role created successfully.', data: { id: roleId } })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Create role error:', error)
    if (error.code === '23505') {
      return res.status(409).json({ success: false, code: 40900, message: 'A role with this name already exists.' })
    }
    return res.status(500).json({ success: false, code: 50000, message: 'Unable to create role.' })
  } finally {
    client.release()
  }
})

router.put('/:id', requirePermission('roles.update'), async (req, res) => {
  const client = await pool.connect()
  try {
    const roleId = Number(req.params.id)
    const { name, description, isActive, permissionIds = [] } = req.body

    const currentResult = await client.query(`SELECT "Name","IsSystem" FROM "Roles" WHERE "ID"=$1`, [roleId])
    if (!currentResult.rowCount) {
      return res.status(404).json({ success: false, code: 40400, message: 'Role not found.' })
    }

    const current = currentResult.rows[0]
    if (current.Name === 'Owner') {
      return res.status(400).json({ success: false, code: 40000, message: 'The Owner role is protected and cannot be modified.' })
    }

    await client.query('BEGIN')
    await client.query(
      `UPDATE "Roles" SET "Name"=$1,"Description"=$2,"IsActive"=$3,"DateUpdated"=NOW() WHERE "ID"=$4`,
      [name.trim(), description || null, Boolean(isActive), roleId]
    )
    await client.query(`DELETE FROM "RolePermissions" WHERE "RoleId"=$1`, [roleId])

    for (const permissionId of permissionIds) {
      await client.query(
        `INSERT INTO "RolePermissions" ("RoleId","PermissionId") VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [roleId, Number(permissionId)]
      )
    }

    await client.query('COMMIT')
    return res.status(200).json({ success: true, code: 20000, message: 'Role updated successfully.' })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Update role error:', error)
    return res.status(500).json({ success: false, code: 50000, message: 'Unable to update role.' })
  } finally {
    client.release()
  }
})

router.delete('/:id', requirePermission('roles.delete'), async (req, res) => {
  try {
    const roleResult = await pool.query(`SELECT "Name","IsSystem" FROM "Roles" WHERE "ID"=$1`, [req.params.id])
    if (!roleResult.rowCount) {
      return res.status(404).json({ success: false, code: 40400, message: 'Role not found.' })
    }

    if (roleResult.rows[0].IsSystem) {
      return res.status(400).json({ success: false, code: 40000, message: 'System roles cannot be deleted.' })
    }

    const used = await pool.query(`SELECT 1 FROM "Users" WHERE "RoleId"=$1 LIMIT 1`, [req.params.id])
    if (used.rowCount) {
      return res.status(409).json({ success: false, code: 40900, message: 'This role is assigned to users and cannot be deleted.' })
    }

    await pool.query(`DELETE FROM "Roles" WHERE "ID"=$1`, [req.params.id])
    return res.status(200).json({ success: true, code: 20000, message: 'Role deleted successfully.' })
  } catch (error) {
    console.error('Delete role error:', error)
    return res.status(500).json({ success: false, code: 50000, message: 'Unable to delete role.' })
  }
})

module.exports = router
