const { pool } = require('../db')

// ============================================================
// GET TOKEN FROM REQUEST
// ============================================================

function getToken(req) {
    const xToken =
        req.headers['x-token']

    const authorization =
        req.headers['authorization']

    if (xToken) {
        return xToken
    }

    if (authorization) {
        return authorization.replace(
            /^Bearer\s+/i,
            ''
        )
    }

    return null
}

// ============================================================
// LOAD AUTHENTICATED USER
//
// Returns:
// id
// locationId
// companyId
// roleId
// roleName
// ============================================================

async function getAuthenticatedUser(req) {
    const token =
        getToken(req)

    if (!token) {
        return {
            success: false,
            status: 401,
            code: 40100,
            message:
                'Authentication token is required.'
        }
    }

    const result =
        await pool.query(
            `
            SELECT
                u."ID"
                    AS "id",

                u."LocationId"
                    AS "locationId",

                l."CompanyId"
                    AS "companyId",

                r."ID"
                    AS "roleId",

                r."Name"
                    AS "roleName"

            FROM
                "Users" u

            INNER JOIN
                "Roles" r

                ON
                    r."ID" =
                        u."RoleId"

            LEFT JOIN
                "Locations" l

                ON
                    l."ID" =
                        u."LocationId"

            WHERE
                u."token" = $1

                AND

                u."IsActive" = true

                AND

                r."IsActive" = true

            LIMIT 1
            `,
            [
                token
            ]
        )

    if (!result.rowCount) {
        return {
            success: false,
            status: 401,
            code: 40100,
            message:
                'Invalid or expired session.'
        }
    }

    return {
        success: true,
        user:
            result.rows[0]
    }
}

// ============================================================
// AUTHENTICATE
//
// Use when a route requires login but does not require
// a particular permission.
//
// Example:
//
// router.get(
//     '/profile',
//     authenticate,
//     async (req, res) => {}
// )
// ============================================================

async function authenticate(
    req,
    res,
    next
) {
    try {
        // If another middleware already authenticated,
        // do not query database again.
        if (req.authUser) {
            return next()
        }

        const authResult =
            await getAuthenticatedUser(
                req
            )

        if (!authResult.success) {
            return res
                .status(
                    authResult.status
                )
                .json({
                    success: false,
                    code:
                        authResult.code,
                    message:
                        authResult.message
                })
        }

        req.authUser =
            authResult.user

        return next()

    } catch (error) {
        console.error(
            'Authentication middleware error:',
            error
        )

        return res
            .status(500)
            .json({
                success: false,
                code: 50000,
                message:
                    'Unable to verify session.'
            })
    }
}

// ============================================================
// MODULE ACCESS
//
// CRUD-style permission middleware has been removed.
//
// Page/module authorization is now handled by:
//     routes/utils/moduleAccess.js
//
// That middleware checks:
//     AppModules
//     LocationModules
//     LocationRoleModules
//
// Owner and Admin DO NOT bypass module access.
// System Admin bypass is handled only where appropriate.
// ============================================================

// ============================================================
// REQUIRE SYSTEM ADMIN
//
// Only the top-level System Admin may access these routes.
//
// Useful for:
// Companies
// Locations
// System-level configuration
//
// This middleware also authenticates automatically.
// ============================================================

async function requireSystemAdmin(
    req,
    res,
    next
) {
    try {

        // ====================================================
        // AUTHENTICATE FIRST
        // ====================================================

        if (!req.authUser) {
            const authResult =
                await getAuthenticatedUser(
                    req
                )

            if (
                !authResult.success
            ) {
                return res
                    .status(
                        authResult.status
                    )
                    .json({
                        success: false,
                        code:
                            authResult.code,
                        message:
                            authResult.message
                    })
            }

            req.authUser =
                authResult.user
        }

        // ====================================================
        // CHECK ROLE
        // ====================================================

        const roleName =
            String(
                req.authUser
                    ?.roleName ||
                ''
            )
                .trim()
                .toLowerCase()

        if (
            roleName !==
            'system admin'
        ) {
            return res
                .status(403)
                .json({
                    success: false,
                    code: 40300,
                    message:
                        'System Administrator access is required.'
                })
        }

        return next()

    } catch (error) {
        console.error(
            'System Admin middleware error:',
            error
        )

        return res
            .status(500)
            .json({
                success: false,
                code: 50000,
                message:
                    'Unable to verify System Administrator access.'
            })
    }
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    getAuthenticatedUser,
    authenticate,
    requireSystemAdmin
}