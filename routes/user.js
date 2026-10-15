const express = require('express')
const bcrypt = require('bcryptjs')
const multer = require('multer')

const router = express.Router()

const { pool } = require('../db')
const cloudinary = require('../config/cloudinary')
const { authenticate } = require('../middleware/auth')

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

const profileUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true)
        } else {
            cb(
                new Error('Only images are allowed!'),
                false
            )
        }
    }
})

function uploadProfileImage(fileBuffer) {
    return new Promise((resolve, reject) => {
        const uploadStream =
            cloudinary.uploader.upload_stream(
                {
                    folder: 'users',
                    resource_type: 'image'
                },
                (error, result) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(result)
                    }
                }
            )

        uploadStream.end(fileBuffer)
    })
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

                        COALESCE(
                            c."IsSuspended",
                            false
                        )
                            AS "CompanyIsSuspended",

                        l."IsActive"
                            AS "LocationIsActive",

                        COALESCE(
                            l."IsSuspended",
                            false
                        )
                            AS "LocationIsSuspended"

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
                    user.CompanyIsSuspended ===
                    true
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your company is suspended.',
                        statusType:
                            'suspended',
                        statusScope:
                            'company',
                        statusName:
                            user.CompanyName || ''
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
                            'Your company is deactivated.',
                        statusType:
                            'inactive',
                        statusScope:
                            'company',
                        statusName:
                            user.CompanyName || ''
                    })
                }

                if (
                    user.LocationIsSuspended ===
                    true
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your location is suspended.',
                        statusType:
                            'suspended',
                        statusScope:
                            'location',
                        statusName:
                            user.locationname || ''
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
                            'Your location is deactivated.',
                        statusType:
                            'inactive',
                        statusScope:
                            'location',
                        statusName:
                            user.locationname || ''
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
            userid,
            locationid
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
                        u."Username",
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

                        COALESCE(
                            c."IsSuspended",
                            false
                        )
                            AS "CompanyIsSuspended",

                        l."IsActive"
                            AS "LocationIsActive",

                        COALESCE(
                            l."IsSuspended",
                            false
                        )
                            AS "LocationIsSuspended"

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
                    dbUser.CompanyIsSuspended ===
                    true
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your company is suspended.',
                        statusType:
                            'suspended',
                        statusScope:
                            'company',
                        statusName:
                            dbUser.CompanyName || ''
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
                            'Your company is deactivated.',
                        statusType:
                            'inactive',
                        statusScope:
                            'company',
                        statusName:
                            dbUser.CompanyName || ''
                    })
                }
            }

// ====================================================
            // RESOLVE EFFECTIVE LOCATION
            // ====================================================
            // System Admin does not require a current location.
            // Normal company users load permissions for the selected location,
            // falling back to their account's home/default location.
            let effectiveLocationId = null
            let effectiveLocation = null

            if (
                normalizedRole !==
                'system admin'
            ) {
                effectiveLocationId =
                    locationid
                        ? Number(locationid)
                        : Number(dbUser.LocationId || 0)

                if (
                    !Number.isInteger(effectiveLocationId) ||
                    effectiveLocationId <= 0
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'A valid location is required.'
                    })
                }

                const locationResult =
                    await pool.query(
                        `
                        SELECT
                            l."ID",
                            l."name",
                            l."CompanyId",
                            l."AllowFaceCheckin",
                            l."IsActive" AS "LocationIsActive",
                            COALESCE(l."IsSuspended", false) AS "LocationIsSuspended",
                            c."Name" AS "CompanyName",
                            c."IsActive" AS "CompanyIsActive",
                            COALESCE(c."IsSuspended", false) AS "CompanyIsSuspended"
                        FROM "Locations" l
                        INNER JOIN "Companies" c
                          ON c."ID" = l."CompanyId"
                        WHERE l."ID" = $1
                        LIMIT 1
                        `,
                        [
                            effectiveLocationId
                        ]
                    )

                effectiveLocation =
                    locationResult.rows[0] || null

                if (
                    !effectiveLocation ||
                    Number(effectiveLocation.CompanyId) !==
                        Number(dbUser.CompanyId)
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Location access denied.'
                    })
                }

                // Owner can work across every location in the company.
                // Admin can use the primary location plus explicitly assigned
                // additional locations. Other roles stay on their primary location.
                if (
                    normalizedRole !== 'owner' &&
                    Number(effectiveLocationId) !== Number(dbUser.LocationId)
                ) {
                    let hasAdditionalAccess = false

                    if (normalizedRole === 'admin') {
                        const accessResult = await pool.query(
                            `
                            SELECT 1
                            FROM "UserLocationAccess"
                            WHERE "UserId" = $1
                              AND "LocationId" = $2
                            LIMIT 1
                            `,
                            [
                                Number(dbUser.ID),
                                Number(effectiveLocationId)
                            ]
                        )

                        hasAdditionalAccess = accessResult.rowCount > 0
                    }

                    if (!hasAdditionalAccess) {
                        return res.status(403).json({
                            success: false,
                            code: 40300,
                            message:
                                'You do not have access to this location.'
                        })
                    }
                }

                if (
                    effectiveLocation.CompanyIsSuspended ===
                    true
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your company is suspended.',
                        statusType:
                            'suspended',
                        statusScope:
                            'company',
                        statusName:
                            effectiveLocation.CompanyName || ''
                    })
                }

                if (
                    effectiveLocation.CompanyIsActive ===
                    false
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your company is deactivated.',
                        statusType:
                            'inactive',
                        statusScope:
                            'company',
                        statusName:
                            effectiveLocation.CompanyName || ''
                    })
                }

                if (
                    effectiveLocation.LocationIsSuspended ===
                    true
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your location is suspended.',
                        statusType:
                            'suspended',
                        statusScope:
                            'location',
                        statusName:
                            effectiveLocation.name || ''
                    })
                }

                if (
                    effectiveLocation.LocationIsActive ===
                    false
                ) {
                    return res.status(403).json({
                        success: false,
                        code: 40300,
                        message:
                            'Your location is deactivated.',
                        statusType:
                            'inactive',
                        statusScope:
                            'location',
                        statusName:
                            effectiveLocation.name || ''
                    })
                }
            }

            // ====================================================
            // LOAD LOCATION + ROLE MODULE ACCESS
            // CRUD permissions are no longer used. The frontend keeps the
            // existing `permissions` array name, but it now contains module codes.
            // ====================================================
            let permissionResult
            if (normalizedRole === 'system admin') {
                permissionResult = await pool.query(`
                    SELECT "Code" AS code
                    FROM "AppModules"
                    WHERE "IsActive"=true
                    ORDER BY "SortOrder","Code"`)
            } else {
                permissionResult = await pool.query(`
                    SELECT m."Code" AS code
                    FROM "LocationRoleModules" lrm
                    JOIN "LocationModules" lm
                      ON lm."LocationId"=lrm."LocationId" AND lm."ModuleId"=lrm."ModuleId"
                    JOIN "AppModules" m
                      ON m."ID"=lrm."ModuleId" AND m."IsActive"=true
                    WHERE lrm."LocationId"=$1
                      AND lrm."RoleId"=$2
                    ORDER BY m."SortOrder",m."Code"`, [effectiveLocationId, dbUser.RoleId])
            }
            const permissions = permissionResult.rows.map(row => row.code)
// ====================================================
            // LOAD AVAILABLE LOCATIONS
            //
            // System Admin:
            //   all company locations
            //
            // Owner: all company locations
            // Admin: primary + explicitly assigned locations
            // Other roles: primary location only
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

                            COALESCE(l."IsSuspended", false) = false

                            AND
                            (
                                c."ID" IS NULL

                                OR
                                (
                                    c."IsActive" = true
                                    AND
                                    COALESCE(c."IsSuspended", false) = false
                                )
                            )

                        ORDER BY
                            c."Name",
                            l."name"
                        `
                    )

            } else if (normalizedRole === 'owner') {
                resultLoc =
                    await pool.query(
                        `
                        SELECT
                            l."ID",
                            l."name",
                            l."IsActive",
                            l."CompanyId",
                            l."AllowFaceCheckin" AS "AllowFaceCheckin",
                            c."Name" AS "companyName"
                        FROM "Locations" l
                        INNER JOIN "Companies" c
                          ON c."ID" = l."CompanyId"
                        WHERE l."CompanyId" = $1
                          AND l."IsActive" = true
                          AND COALESCE(l."IsSuspended", false) = false
                          AND c."IsActive" = true
                          AND COALESCE(c."IsSuspended", false) = false
                        ORDER BY l."name"
                        `,
                        [dbUser.CompanyId]
                    )
            } else if (normalizedRole === 'admin') {
                resultLoc =
                    await pool.query(
                        `
                        SELECT DISTINCT
                            l."ID",
                            l."name",
                            l."IsActive",
                            l."CompanyId",
                            l."AllowFaceCheckin" AS "AllowFaceCheckin",
                            c."Name" AS "companyName"
                        FROM "Locations" l
                        INNER JOIN "Companies" c
                          ON c."ID" = l."CompanyId"
                        WHERE l."CompanyId" = $1
                          AND (
                                l."ID" = $2
                                OR EXISTS (
                                    SELECT 1
                                    FROM "UserLocationAccess" ula
                                    WHERE ula."UserId" = $3
                                      AND ula."LocationId" = l."ID"
                                )
                              )
                          AND l."IsActive" = true
                          AND COALESCE(l."IsSuspended", false) = false
                          AND c."IsActive" = true
                          AND COALESCE(c."IsSuspended", false) = false
                        ORDER BY l."name"
                        `,
                        [
                            dbUser.CompanyId,
                            dbUser.LocationId,
                            dbUser.ID
                        ]
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
                            l."AllowFaceCheckin" AS "AllowFaceCheckin",
                            c."Name" AS "companyName"
                        FROM "Locations" l
                        INNER JOIN "Companies" c
                          ON c."ID" = l."CompanyId"
                        WHERE l."ID" = $1
                          AND l."CompanyId" = $2
                          AND l."IsActive" = true
                          AND COALESCE(l."IsSuspended", false) = false
                          AND c."IsActive" = true
                          AND COALESCE(c."IsSuspended", false) = false
                        LIMIT 1
                        `,
                        [
                            dbUser.LocationId,
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

                    username:
                        dbUser.Username || '',

                    avatar:
                        dbUser.Avatar || '',

                    name:
                        dbUser.Name || '',

                    companyid:
                        dbUser.CompanyId || null,

                    companyname:
                        dbUser.CompanyName || '',

                    locationid:
                        normalizedRole === 'system admin'
                            ? null
                            : effectiveLocationId,

                    location:
                        normalizedRole === 'system admin'
                            ? ''
                            : (
                                effectiveLocation?.name ||
                                dbUser.locationname ||
                                ''
                            ),

                    allowfacecheckin:
                        normalizedRole === 'system admin'
                            ? false
                            : (
                                effectiveLocation
                                    ? Boolean(effectiveLocation.AllowFaceCheckin)
                                    : Boolean(dbUser.AllowFaceCheckin)
                            )
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


// ============================================================
// MY PROFILE
// Authenticated user may update only their own name + avatar.
// Username / role / location / status are intentionally not editable here.
// ============================================================

router.put(
    '/profile',
    authenticate,
    profileUpload.single('avatar'),
    async (req, res) => {
        try {
            const userId =
                Number(req.authUser?.id)

            const name =
                String(req.body?.name || '')
                    .trim()

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {
                return res.status(401).json({
                    success: false,
                    code: 40100,
                    message:
                        'Authenticated user is required.'
                })
            }

            if (!name) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Name is required.'
                })
            }

            let avatar = null

            if (req.file) {
                const uploadResult =
                    await uploadProfileImage(
                        req.file.buffer
                    )

                avatar =
                    uploadResult.secure_url
            }

            const result =
                await pool.query(
                    `
                    UPDATE "Users"
                    SET
                        "Name" = $1,
                        "Avatar" =
                            CASE
                                WHEN $2::text IS NULL
                                    THEN "Avatar"
                                ELSE $2
                            END,
                        "DateUpdated" = NOW()
                    WHERE
                        "ID" = $3
                        AND "IsActive" = true
                    RETURNING
                        "ID" AS id,
                        "Username" AS username,
                        "Name" AS name,
                        "Avatar" AS avatar
                    `,
                    [
                        name,
                        avatar,
                        userId
                    ]
                )

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'User account was not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Profile updated successfully.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Update profile error:',
                error
            )

            if (
                error?.code ===
                'LIMIT_FILE_SIZE'
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Avatar image must be 5 MB or smaller.'
                })
            }

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update profile.'
            })
        }
    }
)

// ============================================================
// CHANGE MY PASSWORD
// Current password is required. Username is never changed here.
// ============================================================

router.put(
    '/profile/password',
    authenticate,
    async (req, res) => {
        try {
            const userId =
                Number(req.authUser?.id)

            const currentPassword =
                String(
                    req.body?.currentPassword ||
                    ''
                )

            const newPassword =
                String(
                    req.body?.newPassword ||
                    ''
                )

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {
                return res.status(401).json({
                    success: false,
                    code: 40100,
                    message:
                        'Authenticated user is required.'
                })
            }

            if (
                !currentPassword ||
                !newPassword
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Current password and new password are required.'
                })
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        "Password"
                    FROM
                        "Users"
                    WHERE
                        "ID" = $1
                        AND "IsActive" = true
                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                )

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'User account was not found.'
                })
            }

            const storedPassword =
                result.rows[0].Password

            const validCurrentPassword =
                looksLikeBcrypt(storedPassword)
                    ? await bcrypt.compare(
                        currentPassword,
                        storedPassword
                    )
                    : currentPassword ===
                        storedPassword

            if (!validCurrentPassword) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Current password is incorrect.'
                })
            }

            const samePassword =
                looksLikeBcrypt(storedPassword)
                    ? await bcrypt.compare(
                        newPassword,
                        storedPassword
                    )
                    : newPassword ===
                        storedPassword

            if (samePassword) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'New password must be different from the current password.'
                })
            }

            const passwordHash =
                await bcrypt.hash(
                    newPassword,
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
                    passwordHash,
                    userId
                ]
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Password updated successfully.'
            })

        } catch (error) {
            console.error(
                'Change password error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update password.'
            })
        }
    }
)

module.exports = router