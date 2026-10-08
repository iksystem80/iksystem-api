const express = require('express')
const { pool } = require('../db')
const { requirePermission } = require('../middleware/auth')
const {
    sendCode,
    verifyCode
} = require('../services/twilioVerify')

const router = express.Router()

// ============================================================
// GET CUSTOMER FOR VERIFICATION
// ============================================================

async function getCustomer(customerId) {
    const result = await pool.query(
        `
        SELECT
            "ID" AS id,
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

// ============================================================
// SEND VERIFICATION CODE
// Permission: customers.create
// ============================================================

router.post(
    '/send',
    requirePermission('customers.create'),
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
            console.error(
                'Customer verification send error:',
                error
            )

            return res.status(400).json({
                success: false,
                message:
                    error.message ||
                    'Unable to send verification code.',
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
    requirePermission('customers.create'),
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

            console.log(
                'Getting customer:',
                customerId
            )

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

            console.log(
                'Calling Twilio Verify:',
                customer.phone
            )

            const verification =
                await verifyCode(
                    customer.phone,
                    code
                )

            console.log(
                'Twilio verification result:',
                verification
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
                    WHERE "ID" = $1
                    RETURNING
                        "ID" AS id,
                        "IsActive" AS isactive,
                        "PhoneVerified" AS phoneverified,
                        "PhoneVerifiedAt" AS phoneverifiedat,
                        "VerificationMethod" AS verificationmethod
                    `,
                    [customerId]
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

            console.error(
                'Verify customer phone error:',
                error
            )

            return res.status(400).json({
                success: false,
                verified: false,
                message:
                    error.message ||
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
// AUTHORIZED BYPASS + ACTIVATE CUSTOMER
// Permission: customers.verification.bypass
// ============================================================

router.post(
    '/bypass',
    requirePermission('customers.create'),
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

            const result =
                await pool.query(
                    `
                    UPDATE "Customer"
                    SET
                        "PhoneVerified" = false,
                        "PhoneVerifiedAt" = NULL,
                        "VerificationMethod" = 'Bypass',
                        "IsActive" = true
                    WHERE "ID" = $1
                    RETURNING
                        "ID" AS id,
                        "IsActive" AS isactive,
                        "PhoneVerified" AS phoneverified,
                        "PhoneVerifiedAt" AS phoneverifiedat,
                        "VerificationMethod" AS verificationmethod
                    `,
                    [customerId]
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
