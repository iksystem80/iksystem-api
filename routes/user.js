const express = require('express')
const bcrypt = require('bcryptjs')
const multer = require('multer')

const router = express.Router()

const { pool } = require('../db')
const { optimizeImageUpload } = require('../utils/optimizeImageUpload')
const { validateImageUpload } = require('../utils/validateImageUpload')
const { uploadBuffer } = require('../utils/imageStorage')
const { authenticate } = require('../middleware/auth')
const {
    notifySessionReplaced,
    findSessionReview,
    forgetSessionReview,
    notifySessionRevoked
} = require('../utils/realtime')

// ============================================================
// HELPERS
// ============================================================

function looksLikeBcrypt(value = '') {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
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

async function uploadProfileImage(fileBuffer) {
    const cloudinaryBuffer = await optimizeImageUpload(fileBuffer)
    return uploadBuffer(cloudinaryBuffer, { folder: 'users' })
}

// ============================================================
// LOGIN
// ============================================================

const crypto = require('crypto')

// PostgreSQL-backed failed-login limits: 3 failures per 60 seconds, followed by
// a 60-second restriction. Both account and IP are counted. Shared by all
// server instances and protected against simultaneous requests by advisory locks.
const LOGIN_WINDOW_MS = 60 * 1000
const LOGIN_LOCK_MS = 60 * 1000
const LOGIN_MAX_FAILURES = 3
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('ik-login-invalid-password-placeholder', 10)

function loginKeys(username, ip) {
    const key = value => crypto.createHash('sha256').update(value).digest('hex')
    return [key(`account:${username}`), key(`ip:${ip}`)].sort()
}

async function lockLoginKeys(client, keys) {
    for (const key of keys) {
        // PostgreSQL advisory locks release when the transaction completes.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ik-login:${key}`])
    }
}

async function readLoginLimits(client, keys, now) {
    const result = await client.query(`
        SELECT "Key", "FailureCount", "WindowStartedAt", "LockedUntil"
        FROM "LoginAttemptLimits" WHERE "Key" = ANY($1::text[])
    `, [keys])
    const limits = new Map(result.rows.map(row => [row.Key, row]))
    let lockUntil = 0
    for (const row of limits.values()) {
        const until = row.LockedUntil ? new Date(row.LockedUntil).getTime() : 0
        if (until > now) lockUntil = Math.max(lockUntil, until)
    }
    return { limits, lockUntil }
}

async function recordLoginFailure(client, keys, limits, now) {
    for (const key of keys) {
        const previous = limits.get(key)
        const windowStart = previous?.WindowStartedAt
            ? new Date(previous.WindowStartedAt).getTime() : 0
        const lastLock = previous?.LockedUntil
            ? new Date(previous.LockedUntil).getTime() : 0
        const freshWindow = !windowStart || now - windowStart >= LOGIN_WINDOW_MS ||
            (lastLock && lastLock <= now)
        const count = freshWindow ? 1 : Number(previous.FailureCount) + 1
        const lockUntil = count >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_LOCK_MS) : null
        await client.query(`
            INSERT INTO "LoginAttemptLimits"
                ("Key", "FailureCount", "WindowStartedAt", "LockedUntil", "UpdatedAt")
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT ("Key") DO UPDATE SET
                "FailureCount" = EXCLUDED."FailureCount",
                "WindowStartedAt" = EXCLUDED."WindowStartedAt",
                "LockedUntil" = EXCLUDED."LockedUntil",
                "UpdatedAt" = NOW()
        `, [key, count, new Date(freshWindow ? now : windowStart), lockUntil])
    }
}

router.post('/login', async (req, res) => {
    const username = req.body?.username
    const password = req.body?.password
    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username.trim() || !password || username.length > 256 || password.length > 1024) {
        return res.status(400).json({
            success: false, code: 40000, message: 'Valid username and password are required.'
        })
    }

    const normalizedUsername = username.trim().toLowerCase()
    const keys = loginKeys(normalizedUsername, req.ip || req.socket.remoteAddress || 'unknown')
    const client = await pool.connect().catch(error => {
        console.error('Login database connection error:', error)
        return null
    })
    if (!client) {
        return res.status(500).json({ success: false, code: 50000, message: 'Unable to sign in.' })
    }

    const resultResponse = (status, data) => ({ status, data })
    let inTransaction = false
    let replacedSession = null
    try {
        await client.query('BEGIN')
        inTransaction = true
        await lockLoginKeys(client, keys)
        const now = Date.now()
        const { limits, lockUntil } = await readLoginLimits(client, keys, now)
        if (lockUntil > now) {
            await client.query('COMMIT')
            inTransaction = false
            res.set('Retry-After', String(Math.max(1, Math.ceil((lockUntil - now) / 1000))))
            return res.status(429).json({
                success: false, code: 42900,
                message: 'Too many failed login attempts. Try again in one minute.'
            })
        }

        const processLogin = async () => {
            const result = await client.query(
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
                    `, [normalizedUsername])
            const user = result.rows[0]
            // Perform a bcrypt comparison even for nonexistent accounts to
            // reduce username-enumeration timing differences.
            const validPassword = user?.IsActive && looksLikeBcrypt(user.Password)
                ? await bcrypt.compare(password, user.Password)
                : (await bcrypt.compare(password, DUMMY_BCRYPT_HASH), false)

            if (!validPassword) {
                await recordLoginFailure(client, keys, limits, now)
                return resultResponse(401, {
                    success: false, code: 40100, message: 'Invalid username or password.'
                })
            }

            // Correct credentials reset the failed-attempt counters. Preserve
            // existing company/location suspension checks and response format.
            await client.query('DELETE FROM "LoginAttemptLimits" WHERE "Key" = ANY($1::text[])', [keys])
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
                    return resultResponse(403, {
                        success: false,
                        code: 40300,
                        message:
                            'Your account is not assigned to a location.'
                    })
                }

                if (
                    !user.CompanyId
                ) {
                    return resultResponse(403, {
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
                    return resultResponse(403, {
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
                    return resultResponse(403, {
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
                    return resultResponse(403, {
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
                    return resultResponse(403, {
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


            // Issue a fresh, unpredictable session token with a fixed expiry.
            // The existing frontend token property and header contract are unchanged.
            const sessionToken = crypto.randomBytes(32).toString('hex')
            await client.query(`
                UPDATE "Users"
                SET "token" = $1,
                    "TokenExpiresAt" = NOW() + INTERVAL '24 hours',
                    "DateUpdated" = NOW()
                WHERE "ID" = $2
            `, [sessionToken, user.ID])

            if (typeof user.token === 'string' && user.token) {
                replacedSession = { userId: user.ID, oldToken: user.token, newToken: sessionToken }
            }

            return resultResponse(200, {
                success: true, message: 'Login successful!', code: 20000,
                token: sessionToken, userid: user.ID,
                locationid: user.LocationId, locationname: user.locationname,
                companyid: user.CompanyId || null,
                companyname: user.CompanyName || '',
                roleid: user.RoleId, rolename: user.RoleName
            })
        }

        const response = await processLogin()
        await client.query('COMMIT')
        inTransaction = false
        if (response.status === 200 && replacedSession) {
            // Emit only AFTER commit so the previous session is already invalid.
            try {
                notifySessionReplaced(
                    replacedSession.userId,
                    replacedSession.oldToken,
                    replacedSession.newToken
                )
            } catch (notificationError) {
                console.error('Login replacement notification error:', notificationError)
            }
        }
        return res.status(response.status).json(response.data)
    } catch (error) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {})
        console.error('Login error:', error)
        return res.status(500).json({ success: false, code: 50000, message: 'Unable to sign in.' })
    } finally {
        client.release()
    }
})

// A revoked old token cannot use normal authenticated routes. This endpoint
// accepts ONLY a valid one-time takeover proof plus that old token; it can
// revoke ONLY the particular newer session which replaced it.
router.post('/report-unrecognized-login', async (req, res) => {
    const oldToken = req.headers['x-token']
    const challenge = req.body?.challenge
    const review = findSessionReview(challenge, oldToken)
    if (!review) {
        return res.status(410).json({
            success: false, code: 41000,
            message: 'Security confirmation expired or is invalid. Please secure your account.'
        })
    }

    try {
        const result = await pool.query(`
            UPDATE "Users"
            SET "token" = NULL,
                "TokenExpiresAt" = NULL,
                "DateUpdated" = NOW()
            WHERE "ID" = $1 AND "token" = $2
            RETURNING "ID"
        `, [review.userId, review.expectedNewToken])

        // The next login might already have replaced the reviewed session.
        // Never revoke an unrelated, later token with a stale confirmation.
        forgetSessionReview(challenge)
        if (!result.rowCount) {
            return res.status(409).json({
                success: false, code: 40900,
                message: 'That session is no longer current. Please secure your account.'
            })
        }

        notifySessionRevoked(review.userId, review.expectedNewToken)
        return res.status(200).json({
            success: true, code: 20000,
            message: 'The unrecognized session has been revoked.'
        })
    } catch (error) {
        console.error('Unrecognized login revocation error:', error)
        return res.status(500).json({
            success: false, code: 50000,
            message: 'Unable to revoke the session. Please contact an administrator.'
        })
    }
})

// ============================================================
// USER INFO
// ============================================================

router.get(
    '/userinfo',
    authenticate,
    async (req, res) => {
        const {
            userid,
            locationid
        } = req.query

        // Keep the existing userid contract, but never accept session tokens
        // in URLs (which can be retained by browser/proxy access logs).
        if (!Number.isSafeInteger(Number(userid)) || Number(userid) <= 0 ||
            Number(userid) !== Number(req.authUser.id)) {
            return res.status(403).json({
                success: false,
                code: 40300,
                message:
                    'User access denied.'
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

                        u."IsActive" = true

                        AND

                        r."IsActive" = true

                    LIMIT 1
                    `,
                    [
                        req.authUser.id
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
                    'Internal server error.'
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
    validateImageUpload,
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

            if (!name || name.length > 100 || typeof req.body?.name !== 'string') {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Name must be between 1 and 100 characters.'
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

            const currentPassword = req.body?.currentPassword
            const newPassword = req.body?.newPassword

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
                typeof currentPassword !== 'string' ||
                typeof newPassword !== 'string' ||
                !currentPassword ||
                !newPassword ||
                currentPassword.length > 1024 ||
                newPassword.length > 1024
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
                    : false

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
                    : false

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

            const updated = await pool.query(
                `
                UPDATE
                    "Users"
                SET
                    "Password" = $1,
                    "DateUpdated" = NOW()
                WHERE
                    "ID" = $2
                    AND "Password" = $3
                    AND "IsActive" = true
                RETURNING "ID"
                `,
                [
                    passwordHash,
                    userId,
                    storedPassword
                ]
            )

            // Another request may have changed the password after it was
            // checked. Do not overwrite a newer password using stale proof.
            if (!updated.rowCount) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message: 'Password changed during this request. Please try again.'
                })
            }

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
