const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const router = express.Router()

const { pool } = require('../db')

const {
    authenticate,
    requireSystemAdmin
} = require('../middleware/auth')

// ============================================================
// GET ALL COMPANIES
// SYSTEM ADMIN ONLY
// ============================================================

router.get(
    '/getall',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const result =
                await pool.query(
                    `
                    SELECT
                        c."ID"
                            AS "id",

                        c."Name"
                            AS "name",

                        c."Code"
                            AS "code",

                        c."IsActive"
                            AS "isActive",

                        c."DateCreated"
                            AS "dateCreated",

                        COUNT(
                            DISTINCT l."ID"
                        )::integer
                            AS "locationCount",

                        COUNT(
                            DISTINCT u."ID"
                        )::integer
                            AS "userCount"

                    FROM
                        "Companies" c

                    LEFT JOIN
                        "Locations" l

                        ON
                            l."CompanyId" =
                                c."ID"

                    LEFT JOIN
                        "Users" u

                        ON
                            u."LocationId" =
                                l."ID"

                    GROUP BY
                        c."ID",
                        c."Name",
                        c."Code",
                        c."IsActive",
                        c."DateCreated"

                    ORDER BY
                        c."Name"
                    `
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                data:
                    result.rows
            })

        } catch (error) {
            console.error(
                'Get companies error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve companies.'
            })
        }
    }
)

// ============================================================
// GET COMPANY
// ============================================================

router.get(
    '/get/:id',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const companyId =
                Number(
                    req.params.id
                )

            const result =
                await pool.query(
                    `
                    SELECT
                        "ID"
                            AS "id",

                        "Name"
                            AS "name",

                        "Code"
                            AS "code",

                        "IsActive"
                            AS "isActive",

                        "DateCreated"
                            AS "dateCreated"

                    FROM
                        "Companies"

                    WHERE
                        "ID" = $1
                    `,
                    [
                        companyId
                    ]
                )

            if (
                result.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Company not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Get company error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve company.'
            })
        }
    }
)

// ============================================================
// CREATE COMPANY
//
// Creates:
//
// Company
// First Location
// Owner User
//
// All inside ONE transaction.
// ============================================================

router.post(
    '/create',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {

        const client =
            await pool.connect()

        try {
            const {
                companyName,
                companyCode,

                locationName,

                ownerName,
                ownerUsername,
                ownerPassword,
                ownerEmail,
                ownerPhone
            } = req.body

            if (
                !companyName ||
                !locationName ||
                !ownerName ||
                !ownerUsername ||
                !ownerPassword
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Company, location and owner information are required.'
                })
            }

            await client.query(
                'BEGIN'
            )

            // ====================================================
            // CHECK COMPANY
            // ====================================================

            const existingCompany =
                await client.query(
                    `
                    SELECT "ID"

                    FROM "Companies"

                    WHERE
                        LOWER("Name") =
                        LOWER($1)

                    LIMIT 1
                    `,
                    [
                        companyName.trim()
                    ]
                )

            if (
                existingCompany.rowCount
            ) {
                await client.query(
                    'ROLLBACK'
                )

                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Company already exists.'
                })
            }

            // ====================================================
            // CHECK USERNAME
            // ====================================================

            const existingUser =
                await client.query(
                    `
                    SELECT "ID"

                    FROM "Users"

                    WHERE
                        LOWER("Username") =
                        LOWER($1)

                    LIMIT 1
                    `,
                    [
                        ownerUsername.trim()
                    ]
                )

            if (
                existingUser.rowCount
            ) {
                await client.query(
                    'ROLLBACK'
                )

                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Username already exists.'
                })
            }

            // ====================================================
            // OWNER ROLE
            // ====================================================

            const roleResult =
                await client.query(
                    `
                    SELECT "ID"

                    FROM "Roles"

                    WHERE
                        LOWER("Name") =
                        'owner'

                        AND
                        "IsActive" = true

                    LIMIT 1
                    `
                )

            if (
                roleResult.rowCount === 0
            ) {
                throw new Error(
                    'Owner role is not configured.'
                )
            }

            const ownerRoleId =
                roleResult.rows[0].ID

            // ====================================================
            // CREATE COMPANY
            // ====================================================

            const companyResult =
                await client.query(
                    `
                    INSERT INTO "Companies"
                    (
                        "Name",
                        "Code",
                        "IsActive",
                        "DateCreated"
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        true,
                        NOW()
                    )

                    RETURNING
                        "ID",
                        "Name"
                    `,
                    [
                        companyName.trim(),
                        companyCode
                            ? companyCode.trim()
                            : null
                    ]
                )

            const company =
                companyResult.rows[0]

            // ====================================================
            // CREATE FIRST LOCATION
            // ====================================================

            const locationResult =
                await client.query(
                    `
                    INSERT INTO "Locations"
                    (
                        "name",
                        "CompanyId",
                        "IsActive"
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        true
                    )

                    RETURNING
                        "ID",
                        "name"
                    `,
                    [
                        locationName.trim(),
                        company.ID
                    ]
                )

            const location =
                locationResult.rows[0]

            // ====================================================
            // CREATE OWNER
            // ====================================================

            const passwordHash =
                await bcrypt.hash(
                    ownerPassword,
                    10
                )

            const token =
                crypto
                    .randomBytes(32)
                    .toString('hex')

            const ownerResult =
                await client.query(
                    `
                    INSERT INTO "Users"
                    (
                        "Username",
                        "Password",
                        "token",
                        "RoleId",
                        "LocationId",
                        "Name",
                        "Email",
                        "Phone",
                        "IsActive",
                        "DateCreated"
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
                        true,
                        NOW()
                    )

                    RETURNING
                        "ID",
                        "Username",
                        "Name"
                    `,
                    [
                        ownerUsername.trim(),
                        passwordHash,
                        token,
                        ownerRoleId,
                        location.ID,
                        ownerName.trim(),
                        ownerEmail || null,
                        ownerPhone || null
                    ]
                )

            await client.query(
                'COMMIT'
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Company created successfully.',
                data: {
                    company:
                        company,
                    location:
                        location,
                    owner:
                        ownerResult.rows[0]
                }
            })

        } catch (error) {
            await client.query(
                'ROLLBACK'
            )

            console.error(
                'Create company error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    error.message ||
                    'Unable to create company.'
            })

        } finally {
            client.release()
        }
    }
)

// ============================================================
// UPDATE COMPANY
// ============================================================

router.put(
    '/update/:id',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const companyId =
                Number(
                    req.params.id
                )

            const {
                name,
                code,
                isActive
            } = req.body

            const result =
                await pool.query(
                    `
                    UPDATE
                        "Companies"

                    SET
                        "Name" = $1,
                        "Code" = $2,
                        "IsActive" = $3,
                        "DateUpdated" = NOW()

                    WHERE
                        "ID" = $4

                    RETURNING
                        "ID"
                    `,
                    [
                        name,
                        code || null,
                        isActive !== false,
                        companyId
                    ]
                )

            if (
                result.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Company not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Company updated successfully.'
            })

        } catch (error) {
            console.error(
                'Update company error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update company.'
            })
        }
    }
)

// ============================================================
// STATUS
// ============================================================

router.patch(
    '/status/:id',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const companyId =
                Number(
                    req.params.id
                )

            const {
                isActive
            } = req.body

            await pool.query(
                `
                UPDATE "Companies"

                SET
                    "IsActive" = $1,
                    "DateUpdated" = NOW()

                WHERE
                    "ID" = $2
                `,
                [
                    Boolean(isActive),
                    companyId
                ]
            )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Company status updated.'
            })

        } catch (error) {
            console.error(
                'Company status error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update company status.'
            })
        }
    }
)

module.exports = router