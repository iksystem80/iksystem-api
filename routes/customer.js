const express = require('express')
const multer = require('multer')
const path = require('path')
const { pool } = require('../db')
const cloudinary = require('../config/cloudinary')
const pgvector = require('pgvector')
const { initFaceApi, createFaceEmbedding, FaceDetectionError } = require('../face')
const { requirePermission } = require('../middleware/auth')
const { checkMatchEligibility } = require('../utils/matchRules')

const uploadToCloudinary = (fileBuffer, folder) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: folder,
                resource_type: 'image',
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
// Export router as a function so we can receive Socket.IO "io"
// ============================================================

module.exports = function (io) {
    const router = express.Router()

    // ============================================================
    // Configure file uploads
    // ============================================================

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 5 * 1024 * 1024,
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
        },
    })

    // ============================================================
    // SAVE CUSTOMER
    // Permission: customers.create
    // ============================================================

    router.post(
        '/savecustomer',
        requirePermission('customers.create'),
        upload.single('image'),
        async (req, res) => {
            try {
                const { customer } = req.body

                const mycustomer =
                    JSON.parse(customer)

                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        message:
                            'No file uploaded.',
                        code: 20000
                    })
                }

                const embedding =
                    await createFaceEmbedding(
                        req.file.buffer
                    )

                const result =
                    await uploadToCloudinary(
                        req.file.buffer,
                        'customers'
                    )

                const dbResult =
                    await pool.query(
                        `
                        INSERT INTO "Customer"
                        (
                            "Firstname",
                            "Lastname",
                            "DOB",
                            "avatar",
                            "Phone",
                            "DateCreated",
                            "locationid",
                            "IsActive",
                            "PhoneVerified",
                            "PhoneVerifiedAt",
                            "VerificationMethod",
                            "Embedding",
                            "CreatedBy",
                            "IsVIP",
                            "IsBlacklist"
                        )
                        VALUES
                        (
                            $1,
                            $2,
                            $3,
                            $4,
                            $5,
                            NOW(),
                            $6,
                            false,
                            false,
                            NULL,
                            NULL,
                            $7,
                            $8,
                            false,
                            false
                        )
                        RETURNING
                            "ID" AS id,
                            "Phone" AS phone,
                            "IsActive" AS isactive,
                            "PhoneVerified" AS phoneverified,
                            "VerificationMethod" AS verificationmethod
                        `,
                        [
                            mycustomer.firstname,
                            mycustomer.lastname,
                            mycustomer.dob || null,
                            result.secure_url,
                            mycustomer.phone,
                            mycustomer.locationid,
                            pgvector.toSql(embedding),
                            mycustomer.createdby,
                        ]
                    )

                if (dbResult.rowCount === 0) {
                    return res.status(400).json({
                        success: false,
                        message:
                            'Customer was not saved.',
                        code: 400
                    })
                } else {
                    return res.status(201).json({
                        success: true,
                        message:
                            'Customer saved. Phone verification is required before activation.',
                        code: 20000,
                        data: dbResult.rows[0],
                    })
                }
            } catch (error) {
                console.log(error)

                if (
                    error instanceof
                    FaceDetectionError
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                error.message,
                            code: 400,
                            errorCode:
                                error.code,
                        })
                }

                return res.status(500).json({
                    success: false,
                    message:
                        'Error while saving customer.',
                    code: 50000,
                })
            }
        }
    )

    // ============================================================
    // UPLOAD PHOTO
    // Permission: customers.create
    // ============================================================

    router.post(
        '/uploadphoto',
        requirePermission('customers.create'),
        upload.single('image'),
        async (req, res) => {
            try {
                if (!req.file) {
                    return res
                        .status(400)
                        .json({
                            message:
                                'No file uploaded.',
                            code: 20000,
                        })
                }

                return res.status(200).json({
                    success: true,
                    message:
                        'get user successful!',
                    code: 20000,
                })
            } catch (error) {
                console.error(
                    'Upload photo error:',
                    error
                )

                return res.status(500).json({
                    success: false,
                    message:
                        'Error uploading photo.',
                    code: 50000,
                })
            }
        }
    )

    // ============================================================
    // GET ALL CUSTOMERS
    // Permission: customers.read
    // ============================================================

    router.get(
        '/getall',
        requirePermission('customers.read'),
        async (req, res) => {
            try {
                const {
                    locationid
                } = req.query

                const result =
                    await pool.query(
                        `
                        SELECT
                            c."ID" AS id,
                            c."Firstname" AS firstname,
                            c."Lastname" AS lastname,
                            TO_CHAR(
                                c."DOB",
                                'DD/MM/YYYY'
                            ) AS dob,
                            c."avatar" AS avatar,
                            c."Phone" AS phone,
                            c."Points" AS points,
                            TO_CHAR(
                                c."DateCreated",
                                'DD/MM/YYYY'
                            ) AS datecreated,
                            c."IsActive" AS isactive,
                            c."PhoneVerified" AS phoneverified,
                            c."PhoneVerifiedAt" AS phoneverifiedat,
                            c."VerificationMethod" AS verificationmethod,
                            c."IsVIP" AS isvip,
                            c."IsBlacklist" AS isblacklist,
                            c."PrivilegedMatchRule"
                                AS "PrivilegedMatchRule",
                            u."Name" AS createdby

                        FROM "Customer" AS c

                        INNER JOIN "Users" AS u
                            ON u."ID" =
                               c."CreatedBy"

                        WHERE
                            c."locationid" = $1

                        ORDER BY
                            LOWER(c."Firstname") ASC,
                            LOWER(c."Lastname") ASC,
                            c."ID" ASC
                        `,
                        [
                            locationid
                        ]
                    )

                if (
                    result.rows.length > 0
                ) {
                    return res
                        .status(200)
                        .json({
                            success: true,
                            message:
                                'Success!',
                            code: 20000,
                            data:
                                result.rows,
                        })
                } else {
                    return res
                        .status(200)
                        .json({
                            success: false,
                            message:
                                'there is no customers',
                            code: 20000
                        })
                }
            } catch (error) {
                console.error(
                    'Get customers error:',
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Error while getting customers.',
                        code: 50000,
                    })
            }
        }
    )

    // ============================================================
    // GET CUSTOMER BY ID
    // Permission: customers.read
    // ============================================================

    router.get(
        '/getcustomerbyid',
        requirePermission('customers.read'),
        async (req, res) => {
            try {
                const {
                    id
                } = req.query

                const result =
                    await pool.query(
                        `
                        SELECT
                            c."ID" AS id,
                            c."Firstname" AS firstname,
                            c."Lastname" AS lastname,
                            TO_CHAR(
                                c."DOB",
                                'DD/MM/YYYY'
                            ) AS dob,
                            c."avatar" AS avatar,
                            c."Phone" AS phone,
                            c."Points" AS points,
                            TO_CHAR(
                                c."DateCreated",
                                'DD/MM/YYYY'
                            ) AS datecreated,
                            c."IsActive" AS isactive,
                            c."PhoneVerified" AS phoneverified,
                            c."PhoneVerifiedAt" AS phoneverifiedat,
                            c."VerificationMethod" AS verificationmethod,
                            c."IsVIP" AS isvip,
                            c."IsBlacklist" AS isblacklist,
                            c."PrivilegedMatchRule"
                                AS "PrivilegedMatchRule",
                            u."Name" AS createdby

                        FROM "Customer" AS c

                        INNER JOIN "Users" AS u
                            ON u."ID" =
                               c."CreatedBy"

                        WHERE
                            c."ID" = $1
                        `,
                        [
                            id
                        ]
                    )

                if (
                    result.rows.length > 0
                ) {
                    return res
                        .status(200)
                        .json({
                            success: true,
                            message:
                                'Success!',
                            code: 20000,
                            data:
                                result.rows,
                        })
                } else {
                    return res
                        .status(200)
                        .json({
                            success: false,
                            message:
                                'there is no customers',
                            code: 20000
                        })
                }
            } catch (error) {
                console.error(
                    'Get customers error:',
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Error while getting customers.',
                        code: 50000,
                    })
            }
        }
    )

    // ============================================================
    // DELETE CUSTOMER
    // Permission: customers.delete
    // ============================================================

    router.delete(
        '/delete',
        requirePermission('customers.delete'),
        async (req, res) => {
            try {
                const {
                    id
                } = req.query

                const result =
                    await pool.query(
                        `
                        DELETE FROM "Customer"
                        WHERE "ID" = $1
                        RETURNING "ID"
                        `,
                        [
                            id
                        ]
                    )

                return res.status(200).json({
                    success: true,
                    message:
                        'Delete successful!',
                    code: 20000,
                    data:
                        result.rows
                })
            } catch (error) {
                return res.status(500).json({
                    success: false,
                    message:
                        'Error while deleting customer.',
                    code: 50000
                })
            }
        }
    )

    // ============================================================
    // UPDATE STATUS
    // Permission: customers.update
    // An unverified customer cannot be manually activated here.
    // Activation requires OTP verification or authorized bypass.
    // ============================================================

    router.put(
        '/updatestatus',
        requirePermission('customers.update'),
        async (req, res) => {
            try {
                const { id } = req.query

                const customerResult =
                    await pool.query(
                        `
                        SELECT
                            "ID",
                            "IsActive",
                            "PhoneVerified",
                            "VerificationMethod"
                        FROM "Customer"
                        WHERE "ID" = $1
                        `,
                        [id]
                    )

                if (customerResult.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Customer not found.',
                        code: 40400,
                    })
                }

                const customer = customerResult.rows[0]

                if (
                    customer.IsActive === false &&
                    customer.PhoneVerified !== true &&
                    customer.VerificationMethod !== 'Bypass'
                ) {
                    return res.status(403).json({
                        success: false,
                        message:
                            'Phone verification or authorized bypass is required before activation.',
                        code: 40300,
                    })
                }

                const result =
                    await pool.query(
                        `
                        UPDATE "Customer"
                        SET
                            "IsActive" =
                                NOT "IsActive"
                        WHERE "ID" = $1
                        RETURNING
                            "ID",
                            "IsActive"
                        `,
                        [id]
                    )

                return res.status(200).json({
                    success: true,
                    message: 'Update successful!',
                    code: 20000,
                    data: result.rows
                })
            } catch (error) {
                console.error(
                    'Update customer status error:',
                    error
                )

                return res.status(500).json({
                    success: false,
                    message:
                        'Error while updating customer status.',
                    code: 50000,
                })
            }
        }
    )

    // ============================================================
    // CHECK-IN
    //
    // Using customers.update because check-in changes customer
    // operational state / creates a CheckIn record.
    // ============================================================

    router.post(
        '/checkin',
        requirePermission('checkin.update'),
        upload.single('image'),
        async (req, res) => {
            try {
                const { checkindata } = req.body

                const mycheckin = JSON.parse(checkindata)

                const hasfaceallowed =
                    mycheckin.hasfaceallowed === true ||
                    mycheckin.hasfaceallowed === 'true'

                let customer = null
                let distance = null
                let photoUrl = null

                // ====================================================
                // FACE CHECK-IN
                // ====================================================

                if (hasfaceallowed) {

                    if (!req.file) {
                        return res
                            .status(400)
                            .json({
                                success: false,
                                message: 'Customer photo is required.',
                                code: 40000,
                            })
                    }

                    const embedding =
                        await createFaceEmbedding(
                            req.file.buffer
                        )

                    const vector =
                        pgvector.toSql(embedding)

                    const result =
                        await pool.query(
                            `
                        SELECT
                            "ID" AS id,
                            "Firstname" AS firstname,
                            "Lastname" AS lastname,
                            "Phone" AS phone,
                            "IsActive" AS isactive,
                            "IsBlacklist" AS isblacklist,
                            "PhoneVerified" AS phoneverified,
                            "VerificationMethod" AS verificationmethod,
                            "Embedding" <-> $1::vector AS distance

                        FROM "Customer"

                        WHERE
                            locationid = $2
                            AND "Embedding" IS NOT NULL

                        ORDER BY
                            "Embedding" <-> $1::vector

                        LIMIT 1
                        `,
                            [
                                vector,
                                mycheckin.locationid
                            ]
                        )

                    if (result.rows.length === 0) {
                        return res
                            .status(404)
                            .json({
                                success: false,
                                matched: false,
                                message: 'Customer not found.',
                                code: 50000,
                            })
                    }

                    customer = result.rows[0]

                    distance =
                        Number(customer.distance)

                    const MAX_DISTANCE = 0.5

                    if (distance > MAX_DISTANCE) {
                        return res
                            .status(200)
                            .json({
                                success: false,
                                matched: false,
                                message: 'Face not recognized.',
                                distance,
                                code: 50000,
                            })
                    }

                    if (customer.isactive !== true) {
                        return res.status(403).json({
                            success: false,
                            matched: true,
                            message: 'This customer account is inactive and cannot check in.',
                            code: 40300,
                        })
                    }

                    if (customer.isblacklist === true) {
                        return res.status(403).json({
                            success: false,
                            matched: true,
                            message: 'This customer is blacklisted and cannot check in.',
                            code: 40300,
                        })
                    }

                    const verificationBypassed =
                        String(customer.verificationmethod || '')
                            .toLowerCase() === 'bypass'

                    if (
                        customer.phoneverified !== true &&
                        !verificationBypassed
                    ) {
                        return res.status(403).json({
                            success: false,
                            matched: true,
                            message: 'Customer verification is required before check-in.',
                            code: 40300,
                        })
                    }

                    const imgresult =
                        await uploadToCloudinary(
                            req.file.buffer,
                            'customers'
                        )

                    photoUrl =
                        imgresult.secure_url
                }

                // ====================================================
                // PHONE CHECK-IN
                // ====================================================

                else {

                    if (!mycheckin.phonenumber) {
                        return res
                            .status(400)
                            .json({
                                success: false,
                                message:
                                    'Phone number is required.',
                                code: 40000,
                            })
                    }

                    const result =
                        await pool.query(
                            `
                        SELECT
                            "ID" AS id,
                            "Firstname" AS firstname,
                            "Lastname" AS lastname,
                            "Phone" AS phone,
                            "IsActive" AS isactive,
                            "IsBlacklist" AS isblacklist,
                            "PhoneVerified" AS phoneverified,
                            "VerificationMethod" AS verificationmethod

                        FROM "Customer"

                        WHERE
                            locationid = $1
                            AND "Phone" = $2

                        LIMIT 1
                        `,
                            [
                                mycheckin.locationid,
                                mycheckin.phonenumber
                            ]
                        )

                    if (result.rows.length === 0) {
                        return res
                            .status(404)
                            .json({
                                success: false,
                                matched: false,
                                message:
                                    'Customer not found with this phone number.',
                                code: 50000,
                            })
                    }

                    customer =
                        result.rows[0]

                    if (customer.isactive !== true) {
                        return res.status(403).json({
                            success: false,
                            matched: true,
                            message: 'This customer account is inactive and cannot check in.',
                            code: 40300,
                        })
                    }

                    if (customer.isblacklist === true) {
                        return res.status(403).json({
                            success: false,
                            matched: true,
                            message: 'This customer is blacklisted and cannot check in.',
                            code: 40300,
                        })
                    }

                    const verificationBypassed =
                        String(customer.verificationmethod || '')
                            .toLowerCase() === 'bypass'

                    if (
                        customer.phoneverified !== true &&
                        !verificationBypassed
                    ) {
                        return res.status(403).json({
                            success: false,
                            matched: true,
                            message: 'Customer verification is required before check-in.',
                            code: 40300,
                        })
                    }
                }

                // ====================================================
                // SAVE CHECK-IN
                // ====================================================

                await pool.query(
                    `
                INSERT INTO "CheckIn"
                (
                    "CustomerId",
                    "LocationId",
                    "CheckInDate",
                    "Photo",
                    "Status",
                    "FaceDistance"
                )
                VALUES
                (
                    $1,
                    $2,
                    NOW(),
                    $3,
                    false,
                    $4
                )
                `,
                    [
                        customer.id,
                        mycheckin.locationid,
                        photoUrl,
                        distance
                    ]
                )

                // ====================================================
                // SOCKET.IO EMIT
                // ====================================================

                const location =
                    `location-${mycheckin.locationid}`

                io.to(location).emit(
                    'customer-checkin',
                    {
                        customerId:
                            customer.id,

                        customerNumber:
                            mycheckin.customernumber,

                        locationId:
                            mycheckin.locationid,

                        firstname:
                            customer.firstname,

                        lastname:
                            customer.lastname,
                    }
                )

                // ====================================================
                // RESPONSE
                // ====================================================

                return res
                    .status(200)
                    .json({
                        success: true,
                        message:
                            'Checkin successful!',
                        code: 20000,
                    })

            } catch (error) {

                console.error(
                    'Check-in error:',
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Error while checking in customer.',
                        code: 50000,
                    })
            }
        }
    )


    // ============================================================
    // CHECK-OUT
    // Permission: customers.update
    // Requires CheckIn.CheckOutDate (see migration.sql)
    // ============================================================

    router.post(
        '/checkout',
        requirePermission('checkin.update'),
        upload.single('image'),
        async (req, res) => {
            try {
                let data
                try {
                    data = JSON.parse(req.body.checkoutdata || '{}')
                } catch {
                    return res.status(400).json({ success: false, message: 'Invalid checkout data.', code: 40000 })
                }

                const locationId = Number(data.locationid)
                if (!Number.isInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({ success: false, message: 'Valid location is required.', code: 40000 })
                }

                const hasFaceAllowed = data.hasfaceallowed === true || data.hasfaceallowed === 'true'
                let customer
                let distance = null

                if (hasFaceAllowed) {
                    if (!req.file) {
                        return res.status(400).json({ success: false, message: 'Customer photo is required.', code: 40000 })
                    }

                    const embedding = await createFaceEmbedding(req.file.buffer)
                    const result = await pool.query(`
                        SELECT "ID" AS id, "Firstname" AS firstname, "Lastname" AS lastname,
                               "Embedding" <-> $1::vector AS distance
                        FROM "Customer"
                        WHERE "locationid" = $2 AND "Embedding" IS NOT NULL AND "IsActive" = true
                        ORDER BY "Embedding" <-> $1::vector
                        LIMIT 1
                    `, [pgvector.toSql(embedding), locationId])

                    if (!result.rows.length) {
                        return res.status(404).json({ success: false, matched: false, message: 'Customer not found.', code: 40400 })
                    }

                    customer = result.rows[0]
                    distance = Number(customer.distance)
                    if (distance > 0.5) {
                        return res.status(200).json({ success: false, matched: false, message: 'Face not recognized.', distance, code: 50000 })
                    }
                } else {
                    const phone = String(data.phonenumber || '').replace(/\D/g, '').slice(-10)
                    if (phone.length !== 10) {
                        return res.status(400).json({ success: false, message: 'Valid phone number is required.', code: 40000 })
                    }

                    const result = await pool.query(`
                        SELECT "ID" AS id, "Firstname" AS firstname, "Lastname" AS lastname
                        FROM "Customer"
                        WHERE "locationid" = $1 AND "Phone" = $2 AND "IsActive" = true
                        LIMIT 1
                    `, [locationId, phone])

                    if (!result.rows.length) {
                        return res.status(404).json({ success: false, matched: false, message: 'Customer not found with this phone number.', code: 40400 })
                    }
                    customer = result.rows[0]
                }

                // Atomically close only the latest open visit; do not change approval Status.
                const result = await pool.query(`
                    UPDATE "CheckIn"
                    SET "CheckOutDate" = NOW(), "IsCheckOut" = true
                    WHERE "ID" = (
                        SELECT "ID"
                        FROM "CheckIn"
                        WHERE "CustomerId" = $1 AND "LocationId" = $2
                          AND "CheckOutDate" IS NULL AND "IsCheckOut"=false
                        ORDER BY "CheckInDate" DESC, "ID" DESC
                        LIMIT 1
                        FOR UPDATE
                    )
                    AND "CheckOutDate" IS NULL AND "IsCheckOut"=false
                    RETURNING "ID" AS id, "CustomerId" AS "customerId",
                              "LocationId" AS "locationId", "CheckOutDate" AS "checkOutDate"
                `, [customer.id, locationId])

                if (!result.rowCount) {
                    return res.status(409).json({ success: false, message: 'This customer has no active check-in at this location.', code: 40900 })
                }

                const checkout = result.rows[0]
                io.to(`location-${locationId}`).emit('customer-checkout', {
                    customerId: customer.id,
                    locationId,
                    checkinId: checkout.id,
                    firstname: customer.firstname,
                    lastname: customer.lastname,
                    checkOutDate: checkout.checkOutDate
                })

                return res.status(200).json({
                    success: true,
                    message: 'Checkout successful!',
                    code: 20000,
                    data: { ...checkout, distance }
                })
            } catch (error) {
                if (error instanceof FaceDetectionError) {
                    return res.status(400).json({ success: false, message: error.message, code: 40000, errorCode: error.code })
                }
                console.error('Check-out error:', error)
                return res.status(500).json({ success: false, message: 'Error while checking out customer.', code: 50000 })
            }
        }
    )

    // ============================================================
    // GET CHECK-IN
    // Permission: customers.read
    // ============================================================

    router.get(
        '/getcheckin',
        requirePermission('customers.read'),
        async (req, res) => {
            try {
                const {
                    locationid
                } = req.query

                const result =
                    await pool.query(
                        `
                        SELECT
                            c."ID" AS id,

                            CONCAT(
                                c."Firstname",
                                ' ',
                                c."Lastname"
                            ) AS fullname,

                            TO_CHAR(
                                c."DOB",
                                'DD/MM/YYYY'
                            ) AS dob,

                            c."avatar" AS avatar,

                            c."Phone" AS phone,

                            c."Points" AS points,

                            TO_CHAR(
                                c."DateCreated",
                                'DD/MM/YYYY'
                            ) AS datecreated,

                            TO_CHAR(
                                c."DateCreated",
                                'MM/DD/YYYY'
                            ) AS "registrationDate",

                            (
                                SELECT COUNT(*)
                                FROM "CheckIn" visit
                                WHERE visit."CustomerId" = c."ID"
                                  AND visit."LocationId" = ck."LocationId"
                            )::int AS "totalVisits",

                            (
                                SELECT TO_CHAR(
                                    MAX(previous_visit."CheckInDate"),
                                    'MM/DD/YYYY HH12:MI AM'
                                )
                                FROM "CheckIn" previous_visit
                                WHERE previous_visit."CustomerId" = c."ID"
                                  AND previous_visit."LocationId" = ck."LocationId"
                                  AND previous_visit."CheckInDate" < ck."CheckInDate"
                            ) AS "lastVisit",

                            c."IsActive"
                                AS isactive,

                            c."locationid"
                                AS customerlocationid,

                            c."PrivilegedMatchRule"
                                AS "PrivilegedMatchRule",

                            ck."ID"
                                AS checkinid,

                            TO_CHAR(
                                ck."CheckInDate",
                                'HH12:MI AM'
                            ) AS checkindate,

                            TO_CHAR(
                                ck."ApprovedDate",
                                'HH12:MI AM'
                            ) AS approveddate,

                            ck."Photo"
                                AS photo,

                            ck."Status"
                                AS status,

                            ck."LocationId"
                                AS checkinlocationid,

                            CONCAT(
                                FLOOR(
                                    EXTRACT(
                                        EPOCH FROM
                                        (
                                            NOW() -
                                            ck."CheckInDate"
                                        )
                                    ) / 3600
                                ),
                                ' hr ',
                                FLOOR(
                                    MOD(
                                        EXTRACT(
                                            EPOCH FROM
                                            (
                                                NOW() -
                                                ck."CheckInDate"
                                            )
                                        ) / 60,
                                        60
                                    )
                                ),
                                ' min'
                            ) AS duration,

                            u."Name"
                                AS approvedby,

                            cm."MachineId",

                            m."MachineNumber",

                            cm."Points",

                            cm."ImageUrl"

                        FROM "Customer" c

                        INNER JOIN "CheckIn" ck
                            ON ck."CustomerId" =
                               c."ID"

                        LEFT JOIN "CustomerMatch" cm
                            ON cm."CheckinId" =
                               ck."ID"

                        LEFT JOIN "Machines" m
                            ON m."ID" =
                               cm."MachineId"

                        LEFT JOIN "Users" u
                            ON u."ID" =
                               ck."ApprovedBy"

                        WHERE
                            ck."LocationId" = $1
                            AND ck."IsCheckOut" = false
                            AND ck."CheckInDate" >= NOW() - INTERVAL '24 hours' 

                        ORDER BY
                            ck."CheckInDate" DESC
                        `,
                        [
                            locationid
                        ]
                    )

                if (
                    result.rows.length > 0
                ) {
                    return res
                        .status(200)
                        .json({
                            success: true,
                            message:
                                'Login successful!',
                            code: 20000,
                            data:
                                result.rows,
                        })
                } else {
                    return res
                        .status(200)
                        .json({
                            success: false,
                            message:
                                'there is no customers',
                            code: 20000,
                        })
                }
            } catch (error) {
                console.error(
                    'Get check-in error:',
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Error while getting check-ins.',
                        code: 50000,
                    })
            }
        }
    )

    // ============================================================
    // APPROVE CHECK-IN
    // Permission: customers.update
    // ============================================================

    router.put(
        '/approvecheckin',
        requirePermission('customers.update'),
        async (req, res) => {
            try {
                const {
                    id,
                    userid
                } = req.query

                const result =
                    await pool.query(
                        `
                        UPDATE "CheckIn"

                        SET
                            "Status" = true,
                            "ApprovedBy" = $1,
                            "ApprovedDate" =
                                NOW()

                        WHERE
                            "ID" = $2

                        RETURNING
                            "ID",
                            "Status",
                            "ApprovedBy",
                            "ApprovedDate"
                        `,
                        [
                            userid,
                            id
                        ]
                    )

                return res
                    .status(200)
                    .json({
                        success: true,
                        message:
                            'Update successful!',
                        code: 20000,
                        data:
                            result.rows,
                    })
            } catch (error) {
                console.error(
                    'Approve check-in error:',
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Error while approving check-in.',
                        code: 50000,
                    })
            }
        }
    )

    // ============================================================
    // CHECK MATCH ELIGIBILITY
    // Reusable by any frontend page before attempting a Match.
    // The save routes still validate again server-side.
    // Permission: customers.update
    // ============================================================

    router.get(
        '/checkmatcheligibility',
        requirePermission('customers.update'),
        async (req, res) => {
            try {
                const customerId = Number(req.query.customerid)
                const locationId = Number(req.query.locationid)

                if (!Number.isInteger(customerId) || customerId <= 0 ||
                    !Number.isInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid customer and location are required.',
                        code: 40000
                    })
                }

                const data = await checkMatchEligibility(pool, {
                    customerId,
                    locationId
                })

                return res.status(200).json({
                    success: true,
                    message: data.eligible
                        ? 'Customer is eligible for Match.'
                        : data.message,
                    code: 20000,
                    data
                })
            } catch (error) {
                console.error('Check Match eligibility error:', error)

                return res.status(500).json({
                    success: false,
                    message: 'Unable to check Match eligibility.',
                    code: 50000
                })
            }
        }
    )

    // ============================================================
    // SAVE / ASSIGN MACHINE
    // Permission: customers.update
    // ============================================================

    router.post(
        '/saveassignmachine',
        requirePermission('customers.update'),
        upload.single('image'),
        async (req, res) => {
            const client = await pool.connect()
            try {
                let mycustomer
                try {
                    mycustomer = JSON.parse(req.body.customer || '{}')
                } catch {
                    return res.status(400).json({ success: false, message: 'Invalid machine assignment data.', code: 40000 })
                }

                const customerId = Number(mycustomer.customerid)
                const machineId = Number(mycustomer.machineid)
                const checkinId = Number(mycustomer.checkinid)
                const locationId = Number(mycustomer.locationid)
                const points = Number(mycustomer.points)
                const employeeId = Number(req.authUser?.id)

                if (!req.file) return res.status(400).json({ success: false, message: 'Customer photo is required.', code: 40000 })
                if (![customerId, machineId, checkinId, locationId, employeeId].every(v => Number.isInteger(v) && v > 0))
                    return res.status(400).json({ success: false, message: 'Valid customer, machine, check-in, location and employee are required.', code: 40000 })
                if (!Number.isFinite(points) || points < 0)
                    return res.status(400).json({ success: false, message: 'Match points must be zero or greater.', code: 40000 })

                await client.query('BEGIN')

                const sessionResult = await client.query(`
                    SELECT "ID"
                    FROM "EmployeeSession"
                    WHERE "UserId"=$1 AND "LocationId"=$2 AND "ClockOut" IS NULL
                    ORDER BY "ClockIn" DESC
                    LIMIT 1
                    FOR UPDATE`, [employeeId, locationId])

                if (!sessionResult.rowCount) {
                    await client.query('ROLLBACK')
                    return res.status(409).json({ success: false, message: 'Clock in before assigning match points.', code: 40900 })
                }

                const validAssignment = await client.query(`
                    SELECT 1
                    FROM "CheckIn" ck
                    JOIN "Customer" c ON c."ID"=ck."CustomerId"
                    JOIN "Machines" m ON m."ID"=$2 AND m.locationid=$3
                    WHERE ck."ID"=$1 AND ck."CustomerId"=$4 AND ck."LocationId"=$3
                    LIMIT 1`, [checkinId, machineId, locationId, customerId])

                if (!validAssignment.rowCount) {
                    await client.query('ROLLBACK')
                    return res.status(400).json({ success: false, message: 'Customer, check-in or machine is not valid for this location.', code: 40000 })
                }

                const matchEligibility = await checkMatchEligibility(client, {
                    customerId,
                    locationId
                })

                if (!matchEligibility.eligible) {
                    await client.query('ROLLBACK')
                    return res.status(409).json({
                        success: false,
                        message: matchEligibility.message,
                        code: 40900,
                        data: matchEligibility
                    })
                }

                const imageResult = await uploadToCloudinary(req.file.buffer, 'customers')

                await client.query(`
                    UPDATE "CheckIn"
                    SET "Status"=true, "ApprovedBy"=$1, "ApprovedDate"=NOW()
                    WHERE "ID"=$2`, [employeeId, checkinId])

                await client.query(`
                    INSERT INTO public."CustomerMatch"
                    ("CustomerId","MachineId","Points","DateAssign","ImageUrl","AssignedBy","LocationId","CheckinId","EmployeeSessionId","IsExtraMatch")
                    VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,false)`,
                    [customerId, machineId, points, imageResult.secure_url, employeeId, locationId, checkinId, sessionResult.rows[0].ID])

                await client.query('COMMIT')
                return res.status(200).json({ success: true, message: 'Machine assigned successfully!', code: 20000 })
            } catch (error) {
                try { await client.query('ROLLBACK') } catch {}
                console.error('Save assigning error:', error)
                return res.status(500).json({ success: false, message: 'Error while assigning machine.', code: 50000 })
            } finally {
                client.release()
            }
        }
    )

    // ============================================================
    // SAVE EXTRA MATCH
    // Creates an additional CustomerMatch entry without assigning
    // a machine or changing the customer's check-in approval state.
    // Permission: customers.update
    // ============================================================

    router.post(
        '/saveextramatch',
        requirePermission('customers.update'),
        upload.single('image'),
        async (req, res) => {
            const client = await pool.connect()
            try {
                let data
                try { data = JSON.parse(req.body.customer || req.body.matchdata || '{}') }
                catch { return res.status(400).json({ success: false, message: 'Invalid extra match data.', code: 40000 }) }

                const customerId = Number(data.customerid)
                const locationId = Number(data.locationid)
                const employeeId = Number(req.authUser?.id)
                const points = Number(data.points ?? data.amount)

                if (!Number.isInteger(customerId) || customerId <= 0)
                    return res.status(400).json({ success: false, message: 'Valid customer is required.', code: 40000 })
                if (!Number.isInteger(locationId) || locationId <= 0)
                    return res.status(400).json({ success: false, message: 'Valid location is required.', code: 40000 })
                if (!Number.isInteger(employeeId) || employeeId <= 0)
                    return res.status(401).json({ success: false, message: 'Authenticated employee is required.', code: 40100 })
                if (!Number.isFinite(points) || points <= 0)
                    return res.status(400).json({ success: false, message: 'Amount must be greater than zero.', code: 40000 })
                if (!req.file)
                    return res.status(400).json({ success: false, message: 'Customer points photo is required.', code: 40000 })

                await client.query('BEGIN')

                const sessionResult = await client.query(`
                    SELECT "ID"
                    FROM "EmployeeSession"
                    WHERE "UserId"=$1 AND "LocationId"=$2 AND "ClockOut" IS NULL
                    ORDER BY "ClockIn" DESC
                    LIMIT 1
                    FOR UPDATE`, [employeeId, locationId])

                if (!sessionResult.rowCount) {
                    await client.query('ROLLBACK')
                    return res.status(409).json({ success: false, message: 'Clock in before adding Extra Match.', code: 40900 })
                }

                const customerResult = await client.query(`
                    SELECT "ID" AS id FROM "Customer"
                    WHERE "ID"=$1 AND "locationid"=$2 AND "IsActive"=true LIMIT 1`, [customerId, locationId])
                if (!customerResult.rowCount) {
                    await client.query('ROLLBACK')
                    return res.status(404).json({ success: false, message: 'Customer not found for this location.', code: 40400 })
                }

                const imageResult = await uploadToCloudinary(req.file.buffer, 'customers')
                const result = await client.query(`
                    INSERT INTO public."CustomerMatch"
                    ("CustomerId","MachineId","Points","DateAssign","ImageUrl","AssignedBy","LocationId","CheckinId","EmployeeSessionId","IsExtraMatch")
                    VALUES ($1,NULL,$2,NOW(),$3,$4,$5,NULL,$6,true)
                    RETURNING "ID" AS id`,
                    [customerId, points, imageResult.secure_url, employeeId, locationId, sessionResult.rows[0].ID])

                await client.query('COMMIT')
                return res.status(201).json({ success: true, message: 'Extra Match saved successfully!', code: 20000, data: result.rows[0] })
            } catch (error) {
                try { await client.query('ROLLBACK') } catch {}
                console.error('Save Extra Match error:', error)
                return res.status(500).json({ success: false, message: 'Error while saving Extra Match.', code: 50000 })
            } finally {
                client.release()
            }
        }
    )



    // ============================================================
    // UPDATE CUSTOMER ACCOUNT
    // Permission: customers.update
    // ============================================================

    router.put(
        '/updatecustomeraccount',
        requirePermission('customers.update'),
        async (req, res) => {
            const client = await pool.connect()

            try {
                const {
                    userId,
                    customerid,
                    points,
                    isactive,
                    isvip,
                    isblacklist,
                    privilegedmatchrule
                } = req.body

                const actingUserId =
                    Number(req.authUser?.id || userId)

                const customerId =
                    Number(customerid)

                const nextPoints =
                    Number(points)

                const nextIsActive =
                    isactive === true

                const nextIsVip =
                    isvip === true

                const nextIsBlacklist =
                    isblacklist === true

                const nextPrivileged =
                    privilegedmatchrule === true

                if (
                    !Number.isInteger(customerId) ||
                    customerId <= 0 ||
                    !Number.isInteger(actingUserId) ||
                    actingUserId <= 0 ||
                    !Number.isFinite(nextPoints) ||
                    nextPoints < 0
                ) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid customer, user and point balance are required.',
                        code: 40000
                    })
                }

                await client.query('BEGIN')

                const customerResult =
                    await client.query(
                        `
                        SELECT
                            "Points",
                            "IsActive",
                            "IsVIP",
                            "IsBlacklist",
                            "PhoneVerified",
                            "VerificationMethod",
                            "PrivilegedMatchRule"
                        FROM "Customer"
                        WHERE "ID" = $1
                        FOR UPDATE
                        `,
                        [customerId]
                    )

                if (!customerResult.rowCount) {
                    await client.query('ROLLBACK')

                    return res.status(404).json({
                        success: false,
                        message: 'Customer not found.',
                        code: 40400
                    })
                }

                const currentCustomer =
                    customerResult.rows[0]

                const changes = [
                    {
                        changed:
                            Number(currentCustomer.Points) !== nextPoints,
                        type: 'POINTS',
                        oldValue: currentCustomer.Points,
                        newValue: nextPoints,
                        description:
                            `User ${actingUserId} changed points from ${currentCustomer.Points} to ${nextPoints}`
                    },
                    {
                        changed:
                            currentCustomer.PrivilegedMatchRule !== nextPrivileged,
                        type: 'PRIVILEGED_MATCH_RULE',
                        oldValue: currentCustomer.PrivilegedMatchRule,
                        newValue: nextPrivileged,
                        description:
                            `User ${actingUserId} ${nextPrivileged ? 'enabled' : 'disabled'} Privileged Match Rule`
                    },
                    {
                        changed:
                            currentCustomer.IsActive !== nextIsActive,
                        type: 'ACCOUNT_STATUS',
                        oldValue: currentCustomer.IsActive,
                        newValue: nextIsActive,
                        description:
                            `User ${actingUserId} ${nextIsActive ? 'activated' : 'deactivated'} customer account`
                    },
                    {
                        changed:
                            currentCustomer.IsVIP !== nextIsVip,
                        type: 'VIP_STATUS',
                        oldValue: currentCustomer.IsVIP,
                        newValue: nextIsVip,
                        description:
                            `User ${actingUserId} ${nextIsVip ? 'enabled' : 'disabled'} VIP status`
                    },
                    {
                        changed:
                            currentCustomer.IsBlacklist !== nextIsBlacklist,
                        type: 'BLACKLIST_STATUS',
                        oldValue: currentCustomer.IsBlacklist,
                        newValue: nextIsBlacklist,
                        description:
                            `User ${actingUserId} ${nextIsBlacklist ? 'enabled' : 'disabled'} blacklist status`
                    }
                ]

                for (const change of changes) {
                    if (!change.changed) continue

                    await client.query(
                        `
                        INSERT INTO "CustomerLog"
                        (
                            "CustomerID",
                            "UserID",
                            "LogType",
                            "OldValue",
                            "NewValue",
                            "Description",
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
                            NOW()
                        )
                        `,
                        [
                            customerId,
                            actingUserId,
                            change.type,
                            String(change.oldValue),
                            String(change.newValue),
                            change.description
                        ]
                    )
                }

                const updateResult =
                    await client.query(
                        `
                        UPDATE "Customer"
                        SET
                            "Points" = $1,
                            "PrivilegedMatchRule" = $2,
                            "IsActive" = $3,
                            "IsVIP" = $4,
                            "IsBlacklist" = $5
                        WHERE "ID" = $6
                        RETURNING
                            "ID" AS id,
                            "Points" AS points,
                            "PrivilegedMatchRule" AS "PrivilegedMatchRule",
                            "IsActive" AS isactive,
                            "IsVIP" AS isvip,
                            "IsBlacklist" AS isblacklist,
                            "PhoneVerified" AS phoneverified,
                            "VerificationMethod" AS verificationmethod
                        `,
                        [
                            nextPoints,
                            nextPrivileged,
                            nextIsActive,
                            nextIsVip,
                            nextIsBlacklist,
                            customerId
                        ]
                    )

                await client.query('COMMIT')

                return res.status(200).json({
                    success: true,
                    message: 'Customer account updated successfully.',
                    code: 20000,
                    data: updateResult.rows[0]
                })
            } catch (error) {
                try {
                    await client.query('ROLLBACK')
                } catch {}

                console.error(
                    'Update customer account error:',
                    error
                )

                return res.status(500).json({
                    success: false,
                    message: 'Error updating customer account.',
                    code: 50000
                })
            } finally {
                client.release()
            }
        }
    )

    // ============================================================
    // GET CUSTOMER LOGS
    // Permission: customers.read
    // ============================================================

    router.get(
        '/getcustomerlogs',
        requirePermission('customers.read'),
        async (req, res) => {
            try {
                const {
                    id
                } = req.query

                const result =
                    await pool.query(
                        `
                        SELECT
                            "ID" AS id,
                            "LogType" AS logtype,
                            "OldValue" AS oldvalue,
                            "NewValue" AS newvalue,
                            "Description"
                                AS description,
                            "DateCreated"
                                AS datecreated

                        FROM "CustomerLog"

                        WHERE
                            "CustomerID" = $1

                        ORDER BY
                            "DateCreated" DESC
                        `,
                        [
                            id
                        ]
                    )

                return res
                    .status(200)
                    .json({
                        success: true,
                        message:
                            'Customer logs retrieved successfully.',
                        code: 20000,
                        data:
                            result.rows
                    })
            } catch (error) {
                console.error(
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Unable to retrieve customer logs.',
                        code: 500
                    })
            }
        }
    )


    // ============================================================
    // GET CUSTOMER ACTIVITY
    // Permission: customers.read
    //
    // Returns:
    //   - Check-ins
    //   - Check-outs
    //   - CustomerMatch point activity
    //   - Last 7 CustomerMatch images
    // ============================================================

    router.get(
        '/getcustomeractivity',
        requirePermission('customers.read'),
        async (req, res) => {
            try {
                const {
                    id,
                    locationid
                } = req.query

                const customerId =
                    Number(id)

                const locationId =
                    Number(locationid)

                if (
                    !Number.isInteger(customerId) ||
                    customerId <= 0
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                'Valid customer id is required.',
                            code: 40000
                        })
                }

                if (
                    !Number.isInteger(locationId) ||
                    locationId <= 0
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                'Valid location id is required.',
                            code: 40000
                        })
                }

                // Make sure the customer belongs to the selected location.
                const customerResult =
                    await pool.query(
                        `
                        SELECT
                            "ID"

                        FROM "Customer"

                        WHERE
                            "ID" = $1
                            AND "locationid" = $2

                        LIMIT 1
                        `,
                        [
                            customerId,
                            locationId
                        ]
                    )

                if (
                    customerResult.rowCount === 0
                ) {
                    return res
                        .status(404)
                        .json({
                            success: false,
                            message:
                                'Customer not found for this location.',
                            code: 40400
                        })
                }

                const activityResult =
                    await pool.query(
                        `
                        SELECT *
                        FROM
                        (
                            SELECT
                                CONCAT(
                                    'checkin-',
                                    ck."ID"
                                ) AS id,

                                'CHECK_IN'
                                    AS type,

                                'Customer Checked In'
                                    AS title,

                                ck."CheckInDate"
                                    AS date,

                                'Customer checked in.'
                                    AS description,

                                ck."ID"
                                    AS "checkinId",

                                NULL::integer
                                    AS points,

                                NULL::text
                                    AS "imageUrl",

                                NULL::text
                                    AS "machineNumber",

                                NULL::text
                                    AS "assignedBy"

                            FROM "CheckIn" ck

                            WHERE
                                ck."CustomerId" = $1
                                AND ck."LocationId" = $2


                            UNION ALL


                            SELECT
                                CONCAT(
                                    'checkout-',
                                    ck."ID"
                                ) AS id,

                                'CHECK_OUT'
                                    AS type,

                                'Customer Checked Out'
                                    AS title,

                                ck."CheckOutDate"
                                    AS date,

                                'Customer checked out.'
                                    AS description,

                                ck."ID"
                                    AS "checkinId",

                                NULL::integer
                                    AS points,

                                NULL::text
                                    AS "imageUrl",

                                NULL::text
                                    AS "machineNumber",

                                NULL::text
                                    AS "assignedBy"

                            FROM "CheckIn" ck

                            WHERE
                                ck."CustomerId" = $1
                                AND ck."LocationId" = $2
                                AND ck."CheckOutDate"
                                    IS NOT NULL


                            UNION ALL


                            SELECT
                                CONCAT(
                                    'match-',
                                    cm."ID"
                                ) AS id,

                                'MATCH_POINTS'
                                    AS type,

                                'Match Points Received'
                                    AS title,

                                cm."DateAssign"
                                    AS date,

                                CONCAT(
                                    'Customer received ',
                                    COALESCE(
                                        cm."Points",
                                        0
                                    ),
                                    ' points',
                                    CASE
                                        WHEN
                                            m."MachineNumber"
                                            IS NOT NULL
                                        THEN
                                            CONCAT(
                                                ' from machine ',
                                                m."MachineNumber"
                                            )
                                        ELSE
                                            ''
                                    END,
                                    '.'
                                ) AS description,

                                cm."CheckinId"
                                    AS "checkinId",

                                cm."Points"
                                    AS points,

                                cm."ImageUrl"
                                    AS "imageUrl",

                                m."MachineNumber"::text
                                    AS "machineNumber",

                                u."Name"
                                    AS "assignedBy"

                            FROM "CustomerMatch" cm

                            LEFT JOIN "Machines" m
                                ON m."ID" =
                                   cm."MachineId"

                            LEFT JOIN "Users" u
                                ON u."ID" =
                                   cm."AssignedBy"

                            WHERE
                                cm."CustomerId" = $1
                                AND cm."LocationId" = $2
                        )
                        activity

                        WHERE
                            activity.date
                                IS NOT NULL

                        ORDER BY
                            activity.date DESC
                        `,
                        [
                            customerId,
                            locationId
                        ]
                    )

                const recentImagesResult =
                    await pool.query(
                        `
                        SELECT
                            cm."ID"
                                AS id,

                            cm."Points"
                                AS points,

                            cm."DateAssign"
                                AS date,

                            cm."ImageUrl"
                                AS "imageUrl",

                            cm."CheckinId"
                                AS "checkinId",

                            m."MachineNumber"::text
                                AS "machineNumber",

                            u."Name"
                                AS "assignedBy"

                        FROM "CustomerMatch" cm

                        LEFT JOIN "Machines" m
                            ON m."ID" =
                               cm."MachineId"

                        LEFT JOIN "Users" u
                            ON u."ID" =
                               cm."AssignedBy"

                        WHERE
                            cm."CustomerId" = $1
                            AND cm."LocationId" = $2
                            AND cm."ImageUrl"
                                IS NOT NULL
                            AND BTRIM(
                                cm."ImageUrl"
                            ) <> ''

                        ORDER BY
                            cm."DateAssign" DESC

                        LIMIT 7
                        `,
                        [
                            customerId,
                            locationId
                        ]
                    )

                return res
                    .status(200)
                    .json({
                        success: true,
                        message:
                            'Customer activity retrieved successfully.',
                        code: 20000,
                        data: {
                            activities:
                                activityResult.rows,
                            recentMatchImages:
                                recentImagesResult.rows
                        }
                    })

            } catch (error) {
                console.error(
                    'Get customer activity error:',
                    error
                )

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            'Unable to retrieve customer activity.',
                        code: 50000
                    })
            }
        }
    )

    // ============================================================
    // Return Router
    // ============================================================

    return router
}