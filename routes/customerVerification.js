const express = require('express')
const crypto = require('crypto')
const { pool } = require('../db')
const { requireModuleAccess } = require('../utils/moduleAccess')
const {
    sendCode,
    verifyCode
} = require('../services/twilioVerify')

const router = express.Router()

// LoginAttemptLimits already exists for login throttling. Reuse its persistent
// counter storage under separate hashed keys to protect Twilio Verify against
// repeated sends and code guesses, including across multiple Node instances.
const VERIFICATION_WINDOW_MS = 10 * 60 * 1000
const VERIFICATION_LIMITS = { send: 5, verify: 10 }

async function consumeVerificationAttempt(action, customerId) {
    const limit = VERIFICATION_LIMITS[action]
    const key = crypto.createHash('sha256')
        .update(`customer-verification:${action}:${customerId}`)
        .digest('hex')
    const client = await pool.connect()
    let inTransaction = false

    try {
        await client.query('BEGIN')
        inTransaction = true
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ik-verify:${key}`])
        const existing = await client.query(`
            SELECT "FailureCount", "WindowStartedAt"
            FROM "LoginAttemptLimits" WHERE "Key" = $1
        `, [key])
        const now = Date.now()
        const previous = existing.rows[0]
        const startedAt = previous?.WindowStartedAt
            ? new Date(previous.WindowStartedAt).getTime() : 0
        const freshWindow = !startedAt || now - startedAt >= VERIFICATION_WINDOW_MS
        const attempts = freshWindow ? 0 : Number(previous.FailureCount)
        const remainingMs = freshWindow
            ? VERIFICATION_WINDOW_MS
            : Math.max(1000, VERIFICATION_WINDOW_MS - (now - startedAt))

        if (attempts >= limit) {
            await client.query('COMMIT')
            inTransaction = false
            return { allowed: false, retryAfter: Math.ceil(remainingMs / 1000) }
        }

        await client.query(`
            INSERT INTO "LoginAttemptLimits"
                ("Key", "FailureCount", "WindowStartedAt", "LockedUntil", "UpdatedAt")
            VALUES ($1, $2, $3, NULL, NOW())
            ON CONFLICT ("Key") DO UPDATE SET
                "FailureCount" = EXCLUDED."FailureCount",
                "WindowStartedAt" = EXCLUDED."WindowStartedAt",
                "LockedUntil" = NULL,
                "UpdatedAt" = NOW()
        `, [key, attempts + 1, new Date(freshWindow ? now : startedAt)])
        await client.query('COMMIT')
        inTransaction = false
        return { allowed: true }
    } catch (error) {
        if (inTransaction) await client.query('ROLLBACK').catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

function replyIfRateLimited(res, result) {
    if (result.allowed) return false
    res.set('Retry-After', String(result.retryAfter))
    res.status(429).json({
        success: false,
        code: 42900,
        message: 'Too many verification attempts. Please try again later.'
    })
    return true
}

// ============================================================
// GET CUSTOMER FOR VERIFICATION
// ============================================================

async function getCustomer(customerId) {
    const result = await pool.query(
        `
        SELECT
            "ID" AS id,
            "locationid" AS locationid,
            "Phone" AS phone,
            "IsActive" AS isactive,
            "PhoneVerified" AS phoneverified,
            "PhoneVerifiedAt" AS phoneverifiedat,
            "VerificationMethod" AS verificationmethod
        FROM "Customer"
        WHERE "ID" = $1
        LIMIT 1
        `,
        [customerId]
    )

    return result.rows[0] || null
}

async function verifyCustomerLocation(req, customer) {
    const role = String(req.authUser?.roleName || '').trim().toLowerCase()
    const locationid = Number(customer.locationid)
    const location = await pool.query(
        'SELECT "CompanyId" FROM "Locations" WHERE "ID"=$1 LIMIT 1',
        [locationid]
    )
    if (!location.rowCount) return false
    if (role === 'system admin') return true
    if (Number(location.rows[0].CompanyId) !== Number(req.authUser?.companyId)) return false
    if (role === 'owner') return true

    const assigned = await pool.query(`
        SELECT 1 FROM "Users" u
        WHERE u."ID"=$1 AND COALESCE(u."IsActive",true)=true
          AND (u."LocationId"=$2 OR ($3='admin' AND EXISTS (
              SELECT 1 FROM "UserLocationAccess" ula
              WHERE ula."UserId"=u."ID" AND ula."LocationId"=$2
          ))) LIMIT 1
    `, [Number(req.authUser?.id), locationid, role])
    return assigned.rowCount > 0
}

// ============================================================
// SEND VERIFICATION CODE
// Permission: customers.create
// ============================================================

router.post(
    '/send',
    requireModuleAccess('customers'),
    async (req, res) => {
        try {
            const customerId =
                Number(req.body.customerId)

            if (
                !Number.isInteger(customerId) ||
                customerId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid customer ID is required.',
                    code: 40000
                })
            }

            const customer =
                await getCustomer(customerId)

            if (!customer) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Customer not found.',
                    code: 40400
                })
            }

            if (!(await verifyCustomerLocation(req, customer))) {
                return res.status(403).json({ success: false, code: 40300, message: 'Customer location access denied.' })
            }

            if (!customer.phone) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Customer phone number is missing.',
                    code: 40000
                })
            }

            if (customer.phoneverified === true) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Customer phone is already verified.',
                    code: 40000
                })
            }

            if (replyIfRateLimited(res, await consumeVerificationAttempt('send', customerId))) return

            await sendCode(
                customer.phone
            )

            return res.status(200).json({
                success: true,
                message:
                    'Verification code sent.',
                code: 20000
            })
        } catch (error) {
            // Twilio exceptions can contain the customer's phone number.
            console.error('Customer verification send failed:', {
                code: Number(error?.code) || null,
                status: Number(error?.status) || null
            })

            const invalidPhoneNumber = Number(error?.code) === 60200

            return res.status(400).json({
                success: false,
                message:
                    invalidPhoneNumber
                        ? 'The phone number is invalid. Please check the number and try again.'
                        : 'Unable to send verification code.',
                code: 40000
            })
        }
    }
)

// ============================================================
// VERIFY CODE + ACTIVATE CUSTOMER
// Permission: customers.create
// ============================================================

router.post(
    '/verify',
    requireModuleAccess('customers'),
    async (req, res) => {
        let dbClient = null

        try {
            const customerId =
                Number(req.body.customerId)

            const code =
                String(req.body.code || '').trim()

            if (
                !Number.isInteger(customerId) ||
                customerId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid customer ID is required.',
                    code: 40000,
                })
            }

            if (!code) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Verification code is required.',
                    code: 40000,
                })
            }

            const customer =
                await getCustomer(customerId)

            if (!customer) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Customer not found.',
                    code: 40400,
                })
            }

            if (!(await verifyCustomerLocation(req, customer))) {
                return res.status(403).json({ success: false, code: 40300, message: 'Customer location access denied.' })
            }

            if (customer.phoneverified === true) {
                return res.status(200).json({
                    success: true,
                    alreadyVerified: true,
                    message:
                        'Customer phone is already verified.',
                    code: 20000,
                })
            }

            if (!customer.phone) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Customer phone number is missing.',
                    code: 40000,
                })
            }

            if (replyIfRateLimited(res, await consumeVerificationAttempt('verify', customerId))) return

            const verification =
                await verifyCode(
                    customer.phone,
                    code
                )

            if (!verification.approved) {
                return res.status(400).json({
                    success: false,
                    verified: false,
                    message:
                        'Invalid verification code.',
                    code: 40000,
                })
            }

            dbClient =
                await pool.connect()

            await dbClient.query('BEGIN')

            const result =
                await dbClient.query(
                    `
                    UPDATE "Customer"
                    SET
                        "PhoneVerified" = true,
                        "PhoneVerifiedAt" = NOW(),
                        "VerificationMethod" = 'OTP',
                        "IsActive" = true
                    WHERE "ID" = $1 AND "locationid" = $2
                    RETURNING
                        "ID" AS id,
                        "IsActive" AS isactive,
                        "PhoneVerified" AS phoneverified,
                        "PhoneVerifiedAt" AS phoneverifiedat,
                        "VerificationMethod" AS verificationmethod
                    `,
                    [customerId, customer.locationid]
                )

            if (!result.rowCount) {
                await dbClient.query('ROLLBACK')

                return res.status(404).json({
                    success: false,
                    verified: false,
                    message:
                        'Customer not found.',
                    code: 40400,
                })
            }

            await dbClient.query('COMMIT')

            return res.status(200).json({
                success: true,
                verified: true,
                message:
                    'Phone verified and customer activated.',
                code: 20000,
                data: result.rows[0]
            })
        } catch (error) {
            if (dbClient) {
                try {
                    await dbClient.query('ROLLBACK')
                } catch { }
            }

            console.error('Verify customer phone failed:', {
                code: Number(error?.code) || null,
                status: Number(error?.status) || null
            })

            return res.status(400).json({
                success: false,
                verified: false,
                message:
                    'Unable to verify phone number.',
                code: 40000,
            })
        } finally {
            if (dbClient) {
                dbClient.release()
            }
        }
    }
)

// ============================================================
// BYPASS + ACTIVATE CUSTOMER
// Any user with customers module access and access to the customer's location.
// ============================================================

router.post(
    '/bypass',
    requireModuleAccess('customers'),
    async (req, res) => {
        try {
            const customerId =
                Number(req.body.customerId)

            if (
                !Number.isInteger(customerId) ||
                customerId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid customer ID is required.',
                    code: 40000,
                })
            }

            const customer = await getCustomer(customerId)
            if (!customer) {
                return res.status(404).json({ success: false, code: 40400, message: 'Customer not found.' })
            }
            if (!(await verifyCustomerLocation(req, customer))) {
                return res.status(403).json({ success: false, code: 40300, message: 'Customer location access denied.' })
            }

            const result =
                await pool.query(
                    `
                    UPDATE "Customer"
                    SET
                        "PhoneVerified" = false,
                        "PhoneVerifiedAt" = NULL,
                        "VerificationMethod" = 'Bypass',
                        "IsActive" = true
                    WHERE "ID" = $1 AND "locationid" = $2
                    RETURNING
                        "ID" AS id,
                        "IsActive" AS isactive,
                        "PhoneVerified" AS phoneverified,
                        "PhoneVerifiedAt" AS phoneverifiedat,
                        "VerificationMethod" AS verificationmethod
                    `,
                    [customerId, customer.locationid]
                )

            if (!result.rowCount) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Customer not found.',
                    code: 40400,
                })
            }

            return res.status(200).json({
                success: true,
                bypassed: true,
                message:
                    'Phone verification bypassed and customer activated.',
                code: 20000,
                data: result.rows[0]
            })
        } catch (error) {
            console.error(
                'Customer verification bypass error:',
                error
            )

            return res.status(500).json({
                success: false,
                message:
                    'Unable to bypass customer verification.',
                code: 50000,
            })
        }
    }
)

module.exports = router
