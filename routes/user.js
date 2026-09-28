const express = require('express')
const bcrypt = require('bcryptjs')

const router = express.Router()

const { pool } = require('../db')

// ============================================================
// HELPERS
// ============================================================

function looksLikeBcrypt(value = '') {
    return /^\$2[aby]\$/.test(value)
}

function normalizeRoleName(value = '') {
    return String(value)
        .trim()
        .toLowerCase()
}

// ============================================================
// LOGIN
// ============================================================

router.post(
    '/login',
    async (req, res) => {
        const {
            username,
            password
        } = req.body

        if (
            !username ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                code: 40000,
                message:
                    'Username and password are required.'
            })
        }

        try {
            const result =
                await pool.query(
                    `
                    SELECT
                        u."ID",
                        u."Username",
                        u."Password",
                        u."token",
                        u."LocationId",
                        u."RoleId",
                        u."IsActive",

                        r."Name"
                            AS "RoleName",

                        l."name"
                            AS "locationname",

                        l."CompanyId"
                            AS "CompanyId",

                        c."Name"
                            AS "CompanyName",

                        c."IsActive"
                            AS "CompanyIsActive",

                        l."IsActive"
                            AS "LocationIsActive"

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

                    LEFT JOIN
                        "Companies" c

                        ON
                            c."ID" =
                                l."CompanyId"

                    WHERE
                        LOWER(
                            u."Username"
                        ) =
                        LOWER($1)

                    LIMIT 1
                    `,
                    [
                        username.trim()
                    ]
                )

            if (
                !result.rowCount ||
                !result.rows[0].IsActive
            ) {
                return res.status(401).json({
                    success: false,
                    message:
                        'Invalid username or password.',
                    code: 40100
                })
            }

            const user =
                result.rows[0]

            let validPassword =
                false

            // ====================================================
            // PASSWORD CHECK
            // ====================================================

            if (
                looksLikeBcrypt(
                    user.Password
                )
            ) {
                validPassword =
                    await bcrypt.compare(
                        password,
                        user.Password
                    )
            } else {
                validPassword =
                    password ===
                    user.Password
            }

            if (
                !validPassword
            ) {
                return res.status(401).json({
                    success: false,
                    message:
                        'Invalid username or password.',
                    code: 40100
                })
            }

            const roleName =
                normalizeRoleName(
                    user.RoleName
                )

            // ====================================================
            // NORMAL COMPANY USER VALIDATION
            //
            // System Admin is allowed to exist outside a normal
            // company/location relationship.
            // ====================================================

            if (
                roleName !==
                'system admin'
            ) {
                if (
                    !user.LocationId
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your account is not assigned to a location.'
                    })
                }

                if (
                    user.LocationIsActive ===
                    false
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your assigned location is inactive.'
                    })
                }

                if (
                    !user.CompanyId
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your account is not assigned to a company.'
                    })
                }

                if (
                    user.CompanyIsActive ===
                    false
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your company is inactive.'
                    })
                }
            }

            // ====================================================
            // UPGRADE OLD PLAINTEXT PASSWORD
            // ====================================================

            if (
                !looksLikeBcrypt(
                    user.Password
                )
            ) {
                const hash =
                    await bcrypt.hash(
                        password,
                        10
                    )

                await pool.query(
                    `
                    UPDATE
                        "Users"

                    SET
                        "Password" = $1,
                        "DateUpdated" = NOW()

                    WHERE
                        "ID" = $2
                    `,
                    [
                        hash,
                        user.ID
                    ]
                )
            }

            // ====================================================
            // SUCCESS
            // ====================================================

            return res.status(200).json({
                success: true,
                message:
                    'Login successful!',
                code: 20000,

                token:
                    user.token,

                userid:
                    user.ID,

                locationid:
                    user.LocationId,

                locationname:
                    user.locationname,

                companyid:
                    user.CompanyId || null,

                companyname:
                    user.CompanyName || '',

                roleid:
                    user.RoleId,

                rolename:
                    user.RoleName
            })

        } catch (err) {
            console.error(
                'Login error:',
                err
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Internal server error. ' +
                    err.message
            })
        }
    }
)

// ============================================================
// USER INFO
// ============================================================

router.get(
    '/userinfo',
    async (req, res) => {
        const {
            token,
            userid
        } = req.query

        if (
            !token ||
            !userid
        ) {
            return res.status(400).json({
                success: false,
                code: 40000,
                message:
                    'Token and user ID are required.'
            })
        }

        try {

            // ====================================================
            // LOAD CURRENT USER FIRST
            // ====================================================

            const result =
                await pool.query(
                    `
                    SELECT
                        u."ID",
                        u."Name",
                        u."token",
                        u."Avatar",
                        u."LocationId",
                        u."RoleId",

                        r."Name"
                            AS "RoleName",

                        l."name"
                            AS "locationname",

                        l."CompanyId"
                            AS "CompanyId",

                        l."AllowFaceCheckin"
                            AS "AllowFaceCheckin",

                        c."Name"
                            AS "CompanyName",

                        c."IsActive"
                            AS "CompanyIsActive",

                        l."IsActive"
                            AS "LocationIsActive"

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

                    LEFT JOIN
                        "Companies" c

                        ON
                            c."ID" =
                                l."CompanyId"

                    WHERE
                        u."ID" = $1

                        AND

                        u."token" = $2

                        AND

                        u."IsActive" = true

                        AND

                        r."IsActive" = true

                    LIMIT 1
                    `,
                    [
                        userid,
                        token
                    ]
                )

            if (
                !result.rowCount
            ) {
                return res.status(401).json({
                    success: false,
                    message:
                        'Unable to get user information.',
                    code: 40100
                })
            }

            const dbUser =
                result.rows[0]

            const roleName =
                dbUser.RoleName

            const normalizedRole =
                normalizeRoleName(
                    roleName
                )

            // ====================================================
            // VALIDATE COMPANY / LOCATION FOR NORMAL USERS
            // ====================================================

            if (
                normalizedRole !==
                'system admin'
            ) {
                if (
                    !dbUser.LocationId
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your account is not assigned to a location.'
                    })
                }

                if (
                    dbUser.LocationIsActive ===
                    false
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your assigned location is inactive.'
                    })
                }

                if (
                    !dbUser.CompanyId
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your account is not assigned to a company.'
                    })
                }

                if (
                    dbUser.CompanyIsActive ===
                    false
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your company is inactive.'
                    })
                }
            }

            // ====================================================
            // LOAD ROLE PERMISSIONS
            // ====================================================

            const permissionResult =
                await pool.query(
                    `
                    SELECT
                        p."Code"
                            AS "code"

                    FROM
                        "RolePermissions" rp

                    INNER JOIN
                        "Permissions" p

                        ON
                            p."ID" =
                                rp."PermissionId"

                    WHERE
                        rp."RoleId" = $1

                    ORDER BY
                        p."Code"
                    `,
                    [
                        dbUser.RoleId
                    ]
                )

            const permissions =
                permissionResult.rows.map(
                    row =>
                        row.code
                )

            // ====================================================
            // LOAD AVAILABLE LOCATIONS
            //
            // System Admin:
            //   all company locations
            //
            // Other roles:
            //   only locations in their own company
            // ====================================================

            let resultLoc

            if (
                normalizedRole ===
                'system admin'
            ) {
                resultLoc =
                    await pool.query(
                        `
                        SELECT
                            l."ID",
                            l."name",
                            l."IsActive",
                            l."CompanyId",
                            l."AllowFaceCheckin"
                            AS "AllowFaceCheckin",
                            c."Name"
                                AS "companyName"

                        FROM
                            "Locations" l

                        LEFT JOIN
                            "Companies" c

                            ON
                                c."ID" =
                                    l."CompanyId"

                        WHERE
                            l."IsActive" = true

                            AND
                            (
                                c."ID" IS NULL

                                OR

                                c."IsActive" = true
                            )

                        ORDER BY
                            c."Name",
                            l."name"
                        `
                    )

            } else {
                resultLoc =
                    await pool.query(
                        `
                        SELECT
                            l."ID",
                            l."name",
                            l."IsActive",
                            l."CompanyId",
                            l."AllowFaceCheckin"
                            AS "AllowFaceCheckin",
                            c."Name"
                                AS "companyName"

                        FROM
                            "Locations" l

                        INNER JOIN
                            "Companies" c

                            ON
                                c."ID" =
                                    l."CompanyId"

                        WHERE
                            l."CompanyId" = $1

                            AND

                            l."IsActive" = true

                            AND

                            c."IsActive" = true

                        ORDER BY
                            l."name"
                        `,
                        [
                            dbUser.CompanyId
                        ]
                    )
            }

            // ====================================================
            // RESPONSE
            // ====================================================

            return res.status(200).json({
                success: true,
                message:
                    'User information loaded.',
                code: 20000,

                data: {
                    roles: [
                        roleName.toLowerCase()
                    ],

                    roleid:
                        dbUser.RoleId,

                    rolename:
                        roleName,

                    permissions,

                    avatar:
                        dbUser.Avatar || '',

                    name:
                        dbUser.Name || '',

                    companyid:
                        dbUser.CompanyId || null,

                    companyname:
                        dbUser.CompanyName || '',

                    locationid:
                        dbUser.LocationId,

                    location:
                        dbUser.locationname || '',

                    allowfacecheckin:
                        dbUser.AllowFaceCheckin
                },

                locations:
                    resultLoc.rows
            })

        } catch (err) {
            console.error(
                'User info error:',
                err
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Internal server error. ' +
                    err.message
            })
        }
    }
)

module.exports = router