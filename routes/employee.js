const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const router = express.Router()

const { pool } = require('../db')

const {
    authenticate,
    requirePermission
} = require('../middleware/auth')

router.use(authenticate)

// ============================================================
// HELPERS
// ============================================================

function normalizeRoleName(value = '') {
    return String(value)
        .trim()
        .toLowerCase()
}

function isSystemAdmin(req) {
    return normalizeRoleName(req.authUser?.roleName) === 'system admin'
}

// ============================================================
// VERIFY LOCATION ACCESS
//
// System Admin:
//   can use any location.
//
// Everyone else:
//   location must belong to their authenticated company.
// ============================================================

async function verifyLocationAccess(
    db,
    req,
    locationId
) {
    const locationResult =
        await db.query(
            `
      SELECT
        l."ID" AS "id",
        l."CompanyId" AS "companyId",
        l."name" AS "name"

      FROM
        "Locations" l

      WHERE
        l."ID" = $1

      LIMIT 1
      `,
            [
                Number(locationId)
            ]
        )

    if (!locationResult.rowCount) {
        return {
            success: false,
            status: 404,
            code: 40400,
            message: 'Location not found.'
        }
    }

    const location =
        locationResult.rows[0]

    if (isSystemAdmin(req)) {
        return {
            success: true,
            location
        }
    }

    if (
        Number(location.companyId) !==
        Number(req.authUser.companyId)
    ) {
        return {
            success: false,
            status: 403,
            code: 40300,
            message:
                'You cannot access a location from another company.'
        }
    }

    return {
        success: true,
        location
    }
}

// ============================================================
// VERIFY USER ACCESS
//
// System Admin:
//   can access any user.
//
// Everyone else:
//   target user's location must belong to same company.
// ============================================================

async function verifyUserAccess(
    db,
    req,
    userId
) {
    const result =
        await db.query(
            `
      SELECT
        u."ID" AS "id",
        u."LocationId" AS "locationId",
        l."CompanyId" AS "companyId",
        r."Name" AS "roleName"

      FROM
        "Users" u

      INNER JOIN
        "Locations" l

        ON
          l."ID" =
            u."LocationId"

      INNER JOIN
        "Roles" r

        ON
          r."ID" =
            u."RoleId"

      WHERE
        u."ID" = $1

      LIMIT 1
      `,
            [
                Number(userId)
            ]
        )

    if (!result.rowCount) {
        return {
            success: false,
            status: 404,
            code: 40400,
            message:
                'User not found.'
        }
    }

    const user =
        result.rows[0]

    if (isSystemAdmin(req)) {
        return {
            success: true,
            user
        }
    }

    if (
        Number(user.companyId) !==
        Number(req.authUser.companyId)
    ) {
        return {
            success: false,
            status: 403,
            code: 40300,
            message:
                'You cannot access a user from another company.'
        }
    }

    return {
        success: true,
        user
    }
}

// ============================================================
// VERIFY ROLE ASSIGNMENT
//
// Only System Admin may assign System Admin role.
// ============================================================

async function verifyRoleAssignment(
    db,
    req,
    roleId
) {
    const result =
        await db.query(
            `
      SELECT
        "ID" AS "id",
        "Name" AS "name",
        "IsActive" AS "isActive"

      FROM
        "Roles"

      WHERE
        "ID" = $1

      LIMIT 1
      `,
            [
                Number(roleId)
            ]
        )

    if (!result.rowCount) {
        return {
            success: false,
            status: 404,
            code: 40400,
            message:
                'Role not found.'
        }
    }

    const role =
        result.rows[0]

    if (!role.isActive) {
        return {
            success: false,
            status: 400,
            code: 40000,
            message:
                'Selected role is inactive.'
        }
    }

    const targetRole =
        normalizeRoleName(
            role.name
        )

    if (
        targetRole === 'system admin' &&
        !isSystemAdmin(req)
    ) {
        return {
            success: false,
            status: 403,
            code: 40300,
            message:
                'Only a System Administrator can assign the System Admin role.'
        }
    }

    return {
        success: true,
        role
    }
}

// ============================================================
// GET ALL USERS
// Permission: users.read
//
// System Admin:
//   can filter by locationid.
//
// Normal company users:
//   requested location must belong to their company.
// ============================================================

router.get(
    '/getall',
    requirePermission('users.read'),
    async (req, res) => {
        try {
            const {
                locationid
            } = req.query

            if (!locationid) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Location is required.'
                })
            }

            const locationAccess =
                await verifyLocationAccess(
                    pool,
                    req,
                    locationid
                )

            if (!locationAccess.success) {
                return res
                    .status(locationAccess.status)
                    .json({
                        success: false,
                        code: locationAccess.code,
                        message:
                            locationAccess.message
                    })
            }

            const result =
                await pool.query(
                    `
          SELECT
            u."ID" AS id,
            u."Username" AS username,
            u."Name" AS name,
            u."Email" AS email,
            u."Phone" AS phone,
            u."JobTitle" AS "jobTitle",
            u."RoleId" AS "roleId",
            r."Name" AS "roleName",
            u."Avatar" AS avatar,
            TO_CHAR(
              u."DateCreated",
              'DD/MM/YYYY'
            ) AS "dateCreated",
            u."IsActive" AS "isActive"

          FROM
            "Users" u

          INNER JOIN
            "Roles" r

            ON
              r."ID" =
                u."RoleId"

          WHERE
            u."LocationId" = $1

          ORDER BY
            u."IsActive" DESC,
            u."Name" ASC
          `,
                    [
                        Number(locationid)
                    ]
                )

            return res.status(200).json({
                success: true,
                message:
                    'Users loaded.',
                code: 20000,
                data:
                    result.rows
            })

        } catch (error) {
            console.error(
                'Get employees error:',
                error
            )

            return res.status(500).json({
                success: false,
                message:
                    'Error while getting users.',
                code: 50000
            })
        }
    }
)

// ============================================================
// GET ONE USER
// Permission: users.read
// ============================================================

router.get(
    '/get/:id',
    requirePermission('users.read'),
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                )

            const userAccess =
                await verifyUserAccess(
                    pool,
                    req,
                    userId
                )

            if (!userAccess.success) {
                return res
                    .status(userAccess.status)
                    .json({
                        success: false,
                        code: userAccess.code,
                        message:
                            userAccess.message
                    })
            }

            const result =
                await pool.query(
                    `
          SELECT
            u."ID" AS id,
            u."Username" AS username,
            u."Name" AS name,
            u."Email" AS email,
            u."Phone" AS phone,
            u."JobTitle" AS "jobTitle",
            u."RoleId" AS "roleId",
            r."Name" AS "roleName",
            u."Avatar" AS avatar,
            u."LocationId" AS "locationId",
            l."CompanyId" AS "companyId",
            u."IsActive" AS "isActive"

          FROM
            "Users" u

          INNER JOIN
            "Roles" r

            ON
              r."ID" =
                u."RoleId"

          INNER JOIN
            "Locations" l

            ON
              l."ID" =
                u."LocationId"

          WHERE
            u."ID" = $1

          LIMIT 1
          `,
                    [
                        userId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Get employee error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to get user.'
            })
        }
    }
)

// ============================================================
// CREATE USER
// Permission: users.create
// ============================================================

router.post(
    '/saveemployee',
    requirePermission('users.create'),
    async (req, res) => {
        try {
            const {
                username,
                password,
                name,
                email,
                phone,
                jobTitle,
                roleId,
                locationid,
                avatar
            } = req.body

            if (
                !username?.trim() ||
                !password ||
                !name?.trim() ||
                !roleId ||
                !locationid
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Name, username, password, role and location are required.'
                })
            }

            // ========================================================
            // LOCATION ACCESS
            // ========================================================

            const locationAccess =
                await verifyLocationAccess(
                    pool,
                    req,
                    locationid
                )

            if (!locationAccess.success) {
                return res
                    .status(locationAccess.status)
                    .json({
                        success: false,
                        code:
                            locationAccess.code,
                        message:
                            locationAccess.message
                    })
            }

            // ========================================================
            // ROLE ACCESS
            // ========================================================

            const roleAccess =
                await verifyRoleAssignment(
                    pool,
                    req,
                    roleId
                )

            if (!roleAccess.success) {
                return res
                    .status(roleAccess.status)
                    .json({
                        success: false,
                        code:
                            roleAccess.code,
                        message:
                            roleAccess.message
                    })
            }

            // ========================================================
            // DUPLICATE USERNAME
            // ========================================================

            const duplicate =
                await pool.query(
                    `
          SELECT
            1

          FROM
            "Users"

          WHERE
            LOWER("Username") =
              LOWER($1)

          LIMIT 1
          `,
                    [
                        username.trim()
                    ]
                )

            if (
                duplicate.rowCount
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Username already exists.'
                })
            }

            // ========================================================
            // CREATE USER
            // ========================================================

            const passwordHash =
                await bcrypt.hash(
                    password,
                    10
                )

            const token =
                crypto
                    .randomBytes(32)
                    .toString('hex')

            const result =
                await pool.query(
                    `
          INSERT INTO "Users"
          (
            "Username",
            "Password",
            "Name",
            "token",
            "RoleId",
            "LocationId",
            "Avatar",
            "Email",
            "Phone",
            "JobTitle",
            "DateCreated",
            "IsActive"
          )

          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            NOW(),
            true
          )

          RETURNING
            "ID" AS id
          `,
                    [
                        username.trim(),
                        passwordHash,
                        name.trim(),
                        token,
                        Number(roleId),
                        Number(locationid),
                        avatar ||
                        '/upload/profile.png',
                        email || null,
                        phone || null,
                        jobTitle || null
                    ]
                )

            return res.status(201).json({
                success: true,
                message:
                    'User saved successfully!',
                code: 20000,
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Save employee error:',
                error
            )

            return res.status(500).json({
                success: false,
                message:
                    'Error while saving user.',
                code: 50000
            })
        }
    }
)

// ============================================================
// UPDATE USER
// Permission: users.update
// ============================================================

router.put(
    '/update/:id',
    requirePermission('users.update'),
    async (req, res) => {
        const client =
            await pool.connect()

        try {
            const {
                username,
                password,
                name,
                email,
                phone,
                jobTitle,
                roleId,
                locationid,
                avatar,
                isActive
            } = req.body

            const userId =
                Number(
                    req.params.id
                )

            if (
                !username?.trim() ||
                !name?.trim() ||
                !roleId ||
                !locationid
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Name, username, role and location are required.'
                })
            }

            // ========================================================
            // TARGET USER ACCESS
            // ========================================================

            const userAccess =
                await verifyUserAccess(
                    client,
                    req,
                    userId
                )

            if (!userAccess.success) {
                return res
                    .status(userAccess.status)
                    .json({
                        success: false,
                        code:
                            userAccess.code,
                        message:
                            userAccess.message
                    })
            }

            // ========================================================
            // NEW LOCATION ACCESS
            // ========================================================

            const locationAccess =
                await verifyLocationAccess(
                    client,
                    req,
                    locationid
                )

            if (!locationAccess.success) {
                return res
                    .status(locationAccess.status)
                    .json({
                        success: false,
                        code:
                            locationAccess.code,
                        message:
                            locationAccess.message
                    })
            }

            // ========================================================
            // ROLE ASSIGNMENT
            // ========================================================

            const roleAccess =
                await verifyRoleAssignment(
                    client,
                    req,
                    roleId
                )

            if (!roleAccess.success) {
                return res
                    .status(roleAccess.status)
                    .json({
                        success: false,
                        code:
                            roleAccess.code,
                        message:
                            roleAccess.message
                    })
            }

            // ========================================================
            // NON SYSTEM ADMIN CANNOT MODIFY SYSTEM ADMIN USER
            // ========================================================

            if (
                normalizeRoleName(
                    userAccess.user.roleName
                ) ===
                'system admin' &&
                !isSystemAdmin(req)
            ) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message:
                        'Only a System Administrator can modify another System Administrator.'
                })
            }

            // ========================================================
            // DUPLICATE USERNAME
            // ========================================================

            const duplicate =
                await client.query(
                    `
          SELECT
            1

          FROM
            "Users"

          WHERE
            LOWER("Username") =
              LOWER($1)

            AND

            "ID" <> $2

          LIMIT 1
          `,
                    [
                        username.trim(),
                        userId
                    ]
                )

            if (
                duplicate.rowCount
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Username already exists.'
                })
            }

            await client.query(
                'BEGIN'
            )

            // ========================================================
            // UPDATE WITH PASSWORD
            // ========================================================

            if (password) {
                const passwordHash =
                    await bcrypt.hash(
                        password,
                        10
                    )

                await client.query(
                    `
          UPDATE "Users"

          SET
            "Username" = $1,
            "Password" = $2,
            "Name" = $3,
            "RoleId" = $4,
            "LocationId" = $5,
            "Avatar" = $6,
            "Email" = $7,
            "Phone" = $8,
            "JobTitle" = $9,
            "IsActive" = $10,
            "DateUpdated" = NOW()

          WHERE
            "ID" = $11
          `,
                    [
                        username.trim(),
                        passwordHash,
                        name.trim(),
                        Number(roleId),
                        Number(locationid),
                        avatar ||
                        '/upload/profile.png',
                        email || null,
                        phone || null,
                        jobTitle || null,
                        Boolean(isActive),
                        userId
                    ]
                )
            } else {
                // ======================================================
                // UPDATE WITHOUT PASSWORD
                // ======================================================

                await client.query(
                    `
          UPDATE "Users"

          SET
            "Username" = $1,
            "Name" = $2,
            "RoleId" = $3,
            "LocationId" = $4,
            "Avatar" = $5,
            "Email" = $6,
            "Phone" = $7,
            "JobTitle" = $8,
            "IsActive" = $9,
            "DateUpdated" = NOW()

          WHERE
            "ID" = $10
          `,
                    [
                        username.trim(),
                        name.trim(),
                        Number(roleId),
                        Number(locationid),
                        avatar ||
                        '/upload/profile.png',
                        email || null,
                        phone || null,
                        jobTitle || null,
                        Boolean(isActive),
                        userId
                    ]
                )
            }

            await client.query(
                'COMMIT'
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'User updated successfully.'
            })

        } catch (error) {
            await client.query(
                'ROLLBACK'
            )

            console.error(
                'Update employee error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Error while updating user.'
            })

        } finally {
            client.release()
        }
    }
)

// ============================================================
// UPDATE STATUS
// Permission: users.update
// ============================================================

router.patch(
    '/status/:id',
    requirePermission('users.update'),
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                )

            if (
                userId ===
                Number(req.authUser.id) &&
                req.body.isActive === false
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'You cannot deactivate your own account.'
                })
            }

            // ========================================================
            // TARGET ACCESS
            // ========================================================

            const userAccess =
                await verifyUserAccess(
                    pool,
                    req,
                    userId
                )

            if (!userAccess.success) {
                return res
                    .status(userAccess.status)
                    .json({
                        success: false,
                        code:
                            userAccess.code,
                        message:
                            userAccess.message
                    })
            }

            if (
                normalizeRoleName(
                    userAccess.user.roleName
                ) ===
                'system admin' &&
                !isSystemAdmin(req)
            ) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message:
                        'Only a System Administrator can modify another System Administrator.'
                })
            }

            const result =
                await pool.query(
                    `
          UPDATE "Users"

          SET
            "IsActive" = $1,
            "DateUpdated" = NOW()

          WHERE
            "ID" = $2

          RETURNING
            "ID"
          `,
                    [
                        Boolean(
                            req.body.isActive
                        ),
                        userId
                    ]
                )

            if (
                !result.rowCount
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'User not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'User status updated.'
            })

        } catch (error) {
            console.error(
                'Status update error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update user status.'
            })
        }
    }
)

// ============================================================
// DELETE USER
// Permission: users.delete
// ============================================================

router.delete(
    '/delete',
    requirePermission('users.delete'),
    async (req, res) => {
        try {
            const {
                id
            } = req.query

            const userId =
                Number(id)

            if (
                userId ===
                Number(
                    req.authUser.id
                )
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'You cannot delete your own account.'
                })
            }

            // ========================================================
            // TARGET ACCESS
            // ========================================================

            const userAccess =
                await verifyUserAccess(
                    pool,
                    req,
                    userId
                )

            if (!userAccess.success) {
                return res
                    .status(userAccess.status)
                    .json({
                        success: false,
                        code:
                            userAccess.code,
                        message:
                            userAccess.message
                    })
            }

            if (
                normalizeRoleName(
                    userAccess.user.roleName
                ) ===
                'system admin' &&
                !isSystemAdmin(req)
            ) {
                return res.status(403).json({
                    success: false,
                    code: 40300,
                    message:
                        'Only a System Administrator can delete another System Administrator.'
                })
            }

            const result =
                await pool.query(
                    `
          DELETE FROM "Users"

          WHERE
            "ID" = $1

          RETURNING
            "ID"
          `,
                    [
                        userId
                    ]
                )

            if (
                !result.rowCount
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'User not found.'
                })
            }

            return res.status(200).json({
                success: true,
                message:
                    'User deleted successfully!',
                code: 20000,
                data:
                    result.rows
            })

        } catch (error) {
            console.error(
                'Delete employee error:',
                error
            )

            if (
                error.code ===
                '23503'
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'This user is already referenced by system records. Deactivate the user instead of deleting it.'
                })
            }

            return res.status(500).json({
                success: false,
                message:
                    'Error while deleting user.',
                code: 50000
            })
        }
    }
)

module.exports = router