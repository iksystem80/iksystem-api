const express = require('express')

const router = express.Router()

const { pool } = require('../db')

const {
    authenticate,
    requireSystemAdmin
} = require('../middleware/auth')

// ============================================================
// GET LOCATIONS BY COMPANY
// ============================================================

router.get(
    '/company/:companyId',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const companyId =
                Number(
                    req.params.companyId
                )

            const result =
                await pool.query(
                    `
                    SELECT
                        l."ID"
                            AS "id",

                        l."name"
                            AS "name",

                        l."CompanyId"
                            AS "companyId",

                        l."IsActive"
                            AS "isActive",

                        COUNT(
                            u."ID"
                        )::integer
                            AS "userCount"

                    FROM
                        "Locations" l

                    LEFT JOIN
                        "Users" u

                        ON
                            u."LocationId" =
                                l."ID"

                    WHERE
                        l."CompanyId" = $1

                    GROUP BY
                        l."ID",
                        l."name",
                        l."CompanyId",
                        l."IsActive"

                    ORDER BY
                        l."name"
                    `,
                    [
                        companyId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                data:
                    result.rows
            })

        } catch (error) {
            console.error(
                'Get company locations error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to retrieve locations.'
            })
        }
    }
)

// ============================================================
// CREATE LOCATION
// SYSTEM ADMIN ONLY
// ============================================================

router.post(
    '/create',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const {
                companyId,
                name
            } = req.body

            if (
                !companyId ||
                !name
            ) {
                return res.status(400).json({
                    success: false,
                    code: 40000,
                    message:
                        'Company and location name are required.'
                })
            }

            const companyResult =
                await pool.query(
                    `
                    SELECT "ID"

                    FROM "Companies"

                    WHERE
                        "ID" = $1

                        AND
                        "IsActive" = true
                    `,
                    [
                        companyId
                    ]
                )

            if (
                companyResult.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Company not found.'
                })
            }

            const existing =
                await pool.query(
                    `
                    SELECT "ID"

                    FROM "Locations"

                    WHERE
                        "CompanyId" = $1

                        AND
                        LOWER("name") =
                            LOWER($2)
                    `,
                    [
                        companyId,
                        name.trim()
                    ]
                )

            if (
                existing.rowCount
            ) {
                return res.status(409).json({
                    success: false,
                    code: 40900,
                    message:
                        'Location already exists for this company.'
                })
            }

            const result =
                await pool.query(
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
                        "name",
                        "CompanyId",
                        "IsActive"
                    `,
                    [
                        name.trim(),
                        companyId
                    ]
                )

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Location created successfully.',
                data:
                    result.rows[0]
            })

        } catch (error) {
            console.error(
                'Create location error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to create location.'
            })
        }
    }
)

// ============================================================
// UPDATE LOCATION
// ============================================================

router.put(
    '/update/:id',
    authenticate,
    requireSystemAdmin,
    async (req, res) => {
        try {
            const locationId =
                Number(
                    req.params.id
                )

            const {
                name,
                isActive
            } = req.body

            const result =
                await pool.query(
                    `
                    UPDATE
                        "Locations"

                    SET
                        "name" = $1,
                        "IsActive" = $2

                    WHERE
                        "ID" = $3

                    RETURNING
                        "ID"
                    `,
                    [
                        name,
                        isActive !== false,
                        locationId
                    ]
                )

            if (
                result.rowCount === 0
            ) {
                return res.status(404).json({
                    success: false,
                    code: 40400,
                    message:
                        'Location not found.'
                })
            }

            return res.status(200).json({
                success: true,
                code: 20000,
                message:
                    'Location updated successfully.'
            })

        } catch (error) {
            console.error(
                'Update location error:',
                error
            )

            return res.status(500).json({
                success: false,
                code: 50000,
                message:
                    'Unable to update location.'
            })
        }
    }
)

module.exports = router