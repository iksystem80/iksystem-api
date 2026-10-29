const express = require('express')
const multer = require('multer')
const AdmZip = require('adm-zip')
const { validateImageUpload } = require('../utils/validateImageUpload')
const path = require('path')
const sharp = require('sharp')
const { optimizeImageUpload } = require('../utils/optimizeImageUpload')
const { pool } = require('../db')
const { requireModuleAccess } = require('../utils/moduleAccess')
const { uploadBuffer } = require('../utils/imageStorage')
const pgvector = require('pgvector')
const { initFaceApi, createFaceEmbedding, FaceDetectionError } = require('../face')
const { checkMatchEligibility } = require('../utils/matchRules')
const { setSocketIO } = require('../utils/realtime')

// Several image-upload endpoints put locationid inside a JSON form field.
// Resolve that location after multer parses the body, then check database
// assignments independently of the generic module-permission middleware.
async function requireCustomerUploadLocation(req, res, next) {
    try {
        const nested = req.body?.customer ?? req.body?.checkindata ??
            req.body?.checkoutdata ?? req.body?.matchdata
        let details = {}
        if (nested !== undefined) {
            details = typeof nested === 'string' ? JSON.parse(nested) : nested
        }
        const locationid = Number(details?.locationid ?? req.body?.locationid ?? req.query?.locationid)
        if (!Number.isSafeInteger(locationid) || locationid <= 0) {
            return res.status(400).json({ success: false, code: 40000, message: 'Valid locationid is required.' })
        }

        const location = await pool.query(
            'SELECT "CompanyId" FROM "Locations" WHERE "ID"=$1 LIMIT 1',
            [locationid]
        )
        if (!location.rowCount) {
            return res.status(403).json({ success: false, code: 40300, message: 'Location access denied.' })
        }
        const role = String(req.authUser?.roleName || '').trim().toLowerCase()
        if (role !== 'system admin') {
            if (Number(location.rows[0].CompanyId) !== Number(req.authUser?.companyId)) {
                return res.status(403).json({ success: false, code: 40300, message: 'Location access denied.' })
            }
            if (role !== 'owner') {
                const user = await pool.query(`
                    SELECT 1 FROM "Users" u
                    WHERE u."ID"=$1 AND COALESCE(u."IsActive",true)=true
                      AND (u."LocationId"=$2 OR ($3='admin' AND EXISTS (
                          SELECT 1 FROM "UserLocationAccess" ula
                          WHERE ula."UserId"=u."ID" AND ula."LocationId"=$2
                      ))) LIMIT 1
                `, [Number(req.authUser?.id), locationid, role])
                if (!user.rowCount) {
                    return res.status(403).json({ success: false, code: 40300, message: 'Location access denied.' })
                }
            }
        }
        next()
    } catch (error) {
        if (error instanceof SyntaxError) {
            return res.status(400).json({ success: false, code: 40000, message: 'Invalid customer form data.' })
        }
        console.error('Customer upload location authorization:', error)
        return res.status(500).json({ success: false, code: 50000, message: 'Unable to verify location access.' })
    }
}

// Inspect the image before uploading it to Cloudinary. This does not modify
// the image buffer or the separate face-embedding/matching pipeline.
async function validateCustomerCloudImage(fileBuffer) {
    const invalid = () => Object.assign(new Error('Invalid customer photo.'), { status: 400 })
    if (!Buffer.isBuffer(fileBuffer) || !fileBuffer.length || fileBuffer.length > 5 * 1024 * 1024) {
        throw invalid()
    }

    let metadata
    try {
        metadata = await sharp(fileBuffer, { limitInputPixels: 40_000_000 }).metadata()
    } catch (_) {
        throw invalid()
    }

    // Exclude active formats such as SVG even if the client calls them image/*.
    const allowed = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'gif'])
    if (!allowed.has(metadata.format) || !metadata.width || !metadata.height ||
        metadata.width > 10000 || metadata.height > 10000 ||
        metadata.width * metadata.height > 40_000_000) throw invalid()
}

const uploadToCloudinary = async (fileBuffer, folder) => {
    await validateCustomerCloudImage(fileBuffer)
    // Match Points evidence can be compressed. Registration/check-in photos
    // used by face recognition always retain their original image bytes.
    const cloudinaryBuffer = folder === 'MatchPoints'
        ? await optimizeImageUpload(fileBuffer)
        : fileBuffer
    return uploadBuffer(cloudinaryBuffer, { folder })
}

// ============================================================
// Export router as a function so we can receive Socket.IO "io"
// ============================================================

module.exports = function (io) {
    setSocketIO(io)
    const router = express.Router()

    // Bulk import: JSON + ZIP are parsed in memory; no ZIP entry is ever extracted
    // onto the server filesystem. Keep these limits independent of photo uploads.
    const bulkUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 100 * 1024 * 1024, files: 2 }
    }).fields([{ name: 'customers', maxCount: 1 }, { name: 'photos', maxCount: 1 }])

    router.post('/importcustomers', requireModuleAccess('customers'), bulkUpload,
        requireCustomerUploadLocation, async (req, res) => {
            const rejected = []
            let imported = 0
            try {
                const jsonFile = req.files?.customers?.[0]
                const zipFile = req.files?.photos?.[0]
                if (!jsonFile || !zipFile || jsonFile.size > 2 * 1024 * 1024) {
                    return res.status(400).json({ success: false, message: 'Upload customers.json (max 2 MB) and photos.zip.' })
                }
                let customers
                try { customers = JSON.parse(jsonFile.buffer.toString('utf8')) } catch (_) {
                    return res.status(400).json({ success: false, message: 'Invalid customers JSON.' })
                }
                if (!Array.isArray(customers) || customers.length < 1 || customers.length > 500) {
                    return res.status(400).json({ success: false, message: 'JSON must contain 1 to 500 customers.' })
                }
                const locationId = Number(req.body.locationid)
                const location = await pool.query('SELECT "AllowFaceCheckin" FROM "Locations" WHERE "ID"=$1', [locationId])
                if (!location.rowCount) return res.status(404).json({ success: false, message: 'Location not found.' })
                const allowFaceCheckin = location.rows[0].AllowFaceCheckin !== false

                const zip = new AdmZip(zipFile.buffer)
                const imageEntries = zip.getEntries().filter(entry => !entry.isDirectory &&
                    /\.(jpe?g|png|webp)$/i.test(entry.entryName))
                if (imageEntries.length > 1000) {
                    return res.status(400).json({ success: false, message: 'Too many images in ZIP.' })
                }
                const seen = new Set()
                const photoEntries = new Map()
                for (const entry of imageEntries) {
                    const basename = path.posix.basename(entry.entryName.replace(/\\/g, '/'))
                    if (!photoEntries.has(basename)) photoEntries.set(basename, entry)
                    else photoEntries.set(basename, null) // ambiguous photo name
                }

                for (let i = 0; i < customers.length; i++) {
                    const item = customers[i] || {}
                    const first = String(item.first_name || item.firstname || '').trim()
                    const last = String(item.last_name || item.lastname || '').trim()
                    const phone = String(item.phone || '').replace(/\D/g, '')
                    const identity = { row: item.row || i + 1, first_name: first, last_name: last, phone }
                    const skip = reason => rejected.push({ ...identity, reason })
                    try {
                        if (!first || !last || first.length > 150 || last.length > 150) {
                            skip('Missing or invalid first/last name'); continue
                        }
                        if (phone.length !== 10) { skip('Phone must contain exactly 10 digits'); continue }
                        if (seen.has(phone)) { skip('Duplicate phone within uploaded JSON'); continue }
                        seen.add(phone)
                        const exists = await pool.query('SELECT 1 FROM "Customer" WHERE "locationid"=$1 AND "Phone"=$2 LIMIT 1', [locationId, phone])
                        if (exists.rowCount) { skip('Phone already registered at this location'); continue }
                        const photoName = path.posix.basename(String(item.photo_file || '').replace(/\\/g, '/'))
                        if (!photoName) { skip('Photo filename missing from JSON'); continue }
                        const photo = photoEntries.get(photoName)
                        if (!photo) { skip('Photo missing from ZIP or filename is ambiguous'); continue }
                        if (photo.header.size > 5 * 1024 * 1024 || photo.header.size <= 0) {
                            skip('Photo exceeds 5 MB or is empty'); continue
                        }
                        const buffer = photo.getData()
                        await validateCustomerCloudImage(buffer)
                        const embedding = allowFaceCheckin ? await createFaceEmbedding(buffer) : null
                        const cloud = await uploadToCloudinary(buffer, 'customers')
                        const saved = await pool.query(`
                            INSERT INTO "Customer" ("Firstname", "Lastname", "DOB", "avatar", "Phone", "DateCreated",
                                "locationid", "IsActive", "PhoneVerified", "PhoneVerifiedAt", "VerificationMethod",
                                "Embedding", "CreatedBy", "IsVIP", "IsBlacklist")
                            VALUES ($1, $2, NULL, $3, $4, NOW(), $5, true, false, NULL, NULL, $6, $7, false, false)
                            ON CONFLICT DO NOTHING
                            RETURNING "ID"`, [first, last, cloud.secure_url, phone, locationId,
                            embedding === null ? null : pgvector.toSql(embedding), req.authUser.id])
                        if (saved.rowCount) imported++
                        else skip('Phone already registered at this location')
                    } catch (error) {
                        if (error.code === '23505') skip('Phone already registered at this location')
                        else if (error instanceof FaceDetectionError) skip('Face verification required at this location: ' + error.message)
                        else {
                            console.error('Customer import failed at row', i + 1, error)
                            skip(error.message === 'Invalid customer photo.' ? 'Invalid photo format or size' : 'Unable to save customer or photo')
                        }
                    }
                }
                return res.json({ success: true, imported, notSaved: rejected.length, rejected,
                    total: customers.length, message: `Imported ${imported} of ${customers.length} customers.` })
            } catch (error) {
                console.error('Bulk customer import:', error)
                return res.status(400).json({ success: false, imported, rejected,
                    message: 'Import could not be completed. Check the JSON and photo ZIP.' })
            }
        })

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
        requireModuleAccess('customers'),
        upload.single('image'),
        validateImageUpload,
        requireCustomerUploadLocation,
        async (req, res) => {
            try {
                const { customer } = req.body

                const mycustomer =
                    JSON.parse(customer)

                const phone = String(mycustomer.phone || '').trim()
                const locationId = Number(mycustomer.locationid)

                if (!phone || !Number.isInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid phone number and location are required.',
                        code: 40000
                    })
                }

                // A phone can be registered at different locations, but only
                // once within the same location. Check before face processing
                // and Cloudinary upload to avoid unnecessary work.
                const existingCustomer = await pool.query(
                    `SELECT "ID" FROM "Customer"
                     WHERE "locationid" = $1 AND "Phone" = $2
                     LIMIT 1`,
                    [locationId, phone]
                )

                if (existingCustomer.rowCount > 0) {
                    return res.status(409).json({
                        success: false,
                        message: 'This phone number is already registered at this location.',
                        code: 40900,
                        errorCode: 'DUPLICATE_CUSTOMER_PHONE'
                    })
                }

                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        message:
                            'No file uploaded.',
                        code: 20000
                    })
                }

                // Face enrollment is optional for locations that disable face check-in.
                // Keep the existing strict face validation wherever it is enabled.
                const faceSettings = await pool.query(
                    'SELECT "AllowFaceCheckin" FROM "Locations" WHERE "ID" = $1 LIMIT 1',
                    [locationId]
                )

                if (faceSettings.rowCount === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Location not found.',
                        code: 40400
                    })
                }

                const allowFaceCheckin = faceSettings.rows[0].AllowFaceCheckin !== false
                const embedding = allowFaceCheckin
                    ? await createFaceEmbedding(req.file.buffer)
                    : null

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
                            true,
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
                            phone,
                            locationId,
                            embedding === null ? null : pgvector.toSql(embedding),
                            req.authUser.id,
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
                            'Customer saved as active. Phone remains unverified.',
                        code: 20000,
                        data: dbResult.rows[0],
                    })
                }
            } catch (error) {
                console.log(error)

                if (error.status === 400 && error.message === 'Invalid customer photo.') {
                    return res.status(400).json({ success: false, code: 40000, message: error.message })
                }

                // Database unique index also protects against simultaneous
                // requests that pass the initial duplicate check.
                if (error.code === '23505' &&
                    error.constraint === 'customer_location_phone_unique') {
                    return res.status(409).json({
                        success: false,
                        message: 'This phone number is already registered at this location.',
                        code: 40900,
                        errorCode: 'DUPLICATE_CUSTOMER_PHONE'
                    })
                }

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
        requireModuleAccess('customers'),
        upload.single('image'),
        validateImageUpload,
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
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
                                'MM/DD/YYYY'
                            ) AS dob,
                            c."avatar" AS avatar,
                            c."Phone" AS phone,
                            c."Points" AS points,
                            TO_CHAR(
                                c."DateCreated",
                                'MM/DD/YYYY'
                            ) AS datecreated,

                            (
                                SELECT TO_CHAR(
                                    MAX(visit."CheckInDate"),
                                    'MM/DD/YYYY HH12:MI AM'
                                )
                                FROM "CheckIn" visit
                                WHERE visit."CustomerId" = c."ID"
                                  AND visit."LocationId" = c."locationid"
                            ) AS lastvisited,

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
                            success: true,
                            message:
                                'there is no customers',
                            code: 20000,
                            data: []
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
        async (req, res) => {
            try {
                const {
                    id,
                    locationid
                } = req.query

                const customerId = Number(id)
                const locationId = Number(locationid)
                if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
                    !Number.isSafeInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message: 'Valid customer ID and locationid are required.'
                    })
                }

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
                            AND c."locationid" = $2
                        `,
                        [
                            customerId,
                            locationId
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
                        .status(404)
                        .json({
                            success: false,
                            message:
                                'there is no customers',
                            code: 40400
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
        async (req, res) => {
            try {
                const {
                    id,
                    locationid
                } = req.query

                const customerId = Number(id)
                const locationId = Number(locationid)
                if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
                    !Number.isSafeInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message: 'Valid customer ID and locationid are required.'
                    })
                }

                const result =
                    await pool.query(
                        `
                        DELETE FROM "Customer"
                        WHERE "ID" = $1 AND "locationid" = $2
                        RETURNING "ID"
                        `,
                        [
                            customerId,
                            locationId
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
    // Account activation is independent from customer verification.
    // Check-in still enforces Active / Blacklist / Verification rules.
    // ============================================================

    router.put(
        '/updatestatus',
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
        async (req, res) => {
            try {
                const { id, locationid } = req.query

                const customerId = Number(id)
                const locationId = Number(locationid)
                if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
                    !Number.isSafeInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message: 'Valid customer ID and locationid are required.'
                    })
                }

                const result =
                    await pool.query(
                        `
                        UPDATE "Customer"
                        SET
                            "IsActive" =
                                NOT "IsActive"
                        WHERE "ID" = $1 AND "locationid" = $2
                        RETURNING
                            "ID",
                            "IsActive"
                        `,
                        [customerId, locationId]
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
        requireModuleAccess('checkin'),
        upload.single('image'),
        validateImageUpload,
        requireCustomerUploadLocation,
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
                            "avatar" AS avatar,
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
                                code: 40400,
                            })
                    }

                    customer = result.rows[0]

                    distance =
                        Number(customer.distance)

                    const MAX_DISTANCE = 0.5

                    if (distance > MAX_DISTANCE) {
                        return res
                            .status(404)
                            .json({
                                success: false,
                                matched: false,
                                message: 'Face not recognized.',
                                distance,
                                code: 40400,
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
                            "avatar" AS avatar,
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
                        data: {
                            id: customer.id,
                            firstname: customer.firstname,
                            lastname: customer.lastname,
                            avatar: customer.avatar || null,
                        },
                    })

            } catch (error) {

                console.error(
                    'Check-in error:',
                    error
                )

                if (error.status === 400 && error.message === 'Invalid customer photo.') {
                    return res.status(400).json({ success: false, code: 40000, message: error.message })
                }

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
        requireModuleAccess('checkin'),
        upload.single('image'),
        validateImageUpload,
        requireCustomerUploadLocation,
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
                        return res.status(404).json({ success: false, matched: false, message: 'Face not recognized.', distance, code: 40400 })
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
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
                            c."Points" AS "matchPoints",

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

                            cm."Points" AS "assignedPoints",

                            cm."ImageUrl"

                        FROM "Customer" c

                        INNER JOIN "CheckIn" ck
                            ON ck."CustomerId" =
                               c."ID"

                        -- Multiple point entries (including extra matches)
                        -- belong to one check-in; display that check-in once.
                        LEFT JOIN LATERAL (
                            SELECT
                                (ARRAY_AGG(match_entry."MachineId"
                                    ORDER BY match_entry."IsExtraMatch", match_entry."DateAssign" DESC))[1]
                                    AS "MachineId",
                                SUM(match_entry."Points") AS "Points",
                                (ARRAY_AGG(match_entry."ImageUrl"
                                    ORDER BY match_entry."IsExtraMatch", match_entry."DateAssign" DESC))[1]
                                    AS "ImageUrl"
                            FROM "CustomerMatch" match_entry
                            WHERE match_entry."CheckinId" = ck."ID"
                        ) cm ON true

                        LEFT JOIN "Machines" m
                            ON m."ID" =
                               cm."MachineId"

                        LEFT JOIN "Users" u
                            ON u."ID" =
                               ck."ApprovedBy"

                        WHERE
                            ck."LocationId" = $1
                            AND ck."IsCheckOut" = false
                            AND ck."CheckInDate" >=
                                (NOW() AT TIME ZONE 'America/Chicago') - INTERVAL '24 hours'
                            AND ck."CheckInDate" <= (NOW() AT TIME ZONE 'America/Chicago')

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
                            success: true,
                            message:
                                'there is no customers',
                            code: 20000,
                            data: [],
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
        async (req, res) => {
            try {
                const id = Number(req.query.id)
                const locationId = Number(req.query.locationid)
                const actingUserId = Number(req.authUser?.id)

                if (![id, locationId, actingUserId].every(v => Number.isSafeInteger(v) && v > 0)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid check-in and location are required.',
                        code: 40000
                    })
                }

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
                            AND "LocationId" = $3

                        RETURNING
                            "ID",
                            "Status",
                            "ApprovedBy",
                            "ApprovedDate"
                        `,
                        [
                            actingUserId,
                            id,
                            locationId
                        ]
                    )

                if (!result.rowCount) {
                    return res.status(404).json({
                        success: false,
                        message: 'Check-in not found for this location.',
                        code: 40400
                    })
                }

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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
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
        requireModuleAccess('customers'),
        upload.single('image'),
        validateImageUpload,
        requireCustomerUploadLocation,
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
                const employeeId = Number(req.authUser?.id)

                if (!req.file) return res.status(400).json({ success: false, message: 'Customer photo is required.', code: 40000 })
                if (![customerId, machineId, checkinId, locationId, employeeId].every(v => Number.isInteger(v) && v > 0))
                    return res.status(400).json({ success: false, message: 'Valid customer, machine, check-in, location and employee are required.', code: 40000 })
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
                    SELECT c."Points"::numeric AS points
                    FROM "CheckIn" ck
                    JOIN "Customer" c ON c."ID"=ck."CustomerId"
                    JOIN "Machines" m ON m."ID"=$2 AND m.locationid=$3
                    WHERE ck."ID"=$1
                      AND ck."CustomerId"=$4
                      AND ck."LocationId"=$3
                      AND c."locationid"=$3
                    LIMIT 1
                    FOR UPDATE OF c`, [checkinId, machineId, locationId, customerId])

                if (!validAssignment.rowCount) {
                    await client.query('ROLLBACK')
                    return res.status(400).json({ success: false, message: 'Customer, check-in or machine is not valid for this location.', code: 40000 })
                }

                const points = Number(validAssignment.rows[0].points)
                if (!Number.isFinite(points) || points < 0) {
                    await client.query('ROLLBACK')
                    return res.status(409).json({
                        success: false,
                        message: 'Customer Match Point is not configured correctly.',
                        code: 40900
                    })
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

                const imageResult = await uploadToCloudinary(req.file.buffer, 'MatchPoints')

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
                if (error.status === 400 && error.message === 'Invalid customer photo.') {
                    return res.status(400).json({ success: false, code: 40000, message: error.message })
                }
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
        requireModuleAccess('customers'),
        upload.single('image'),
        validateImageUpload,
        requireCustomerUploadLocation,
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
                const machineNumber = String(data.machineNumber ?? '').trim()

                if (!Number.isInteger(customerId) || customerId <= 0)
                    return res.status(400).json({ success: false, message: 'Valid customer is required.', code: 40000 })
                if (!Number.isInteger(locationId) || locationId <= 0)
                    return res.status(400).json({ success: false, message: 'Valid location is required.', code: 40000 })
                if (!Number.isInteger(employeeId) || employeeId <= 0)
                    return res.status(401).json({ success: false, message: 'Authenticated employee is required.', code: 40100 })
                if (!Number.isFinite(points) || points <= 0)
                    return res.status(400).json({ success: false, message: 'Amount must be greater than zero.', code: 40000 })
                if (!/^\d+$/.test(machineNumber) || Number(machineNumber) <= 0)
                    return res.status(400).json({ success: false, message: 'Valid machine number is required.', code: 40000 })
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

                const machineResult = await client.query(`
                    SELECT m."ID" AS id FROM "Machines" m
                    WHERE m.locationid=$1 AND m."MachineNumber"::text=$2
                    LIMIT 1`, [locationId, machineNumber])
                if (!machineResult.rowCount) {
                    await client.query('ROLLBACK')
                    return res.status(400).json({ success: false, message: 'Machine number not found for this location.', code: 40000 })
                }

                const imageResult = await uploadToCloudinary(req.file.buffer, 'MatchPoints')
                const result = await client.query(`
                    INSERT INTO public."CustomerMatch"
                    ("CustomerId","MachineId","Points","DateAssign","ImageUrl","AssignedBy","LocationId","CheckinId","EmployeeSessionId","IsExtraMatch")
                    VALUES ($1,$2,$3,NOW(),$4,$5,$6,NULL,$7,true)
                    RETURNING "ID" AS id`,
                    [customerId, machineResult.rows[0].id, points, imageResult.secure_url, employeeId, locationId, sessionResult.rows[0].ID])

                await client.query('COMMIT')
                return res.status(201).json({ success: true, message: 'Extra Match saved successfully!', code: 20000, data: result.rows[0] })
            } catch (error) {
                try { await client.query('ROLLBACK') } catch {}
                console.error('Save Extra Match error:', error)
                if (error.status === 400 && error.message === 'Invalid customer photo.') {
                    return res.status(400).json({ success: false, code: 40000, message: error.message })
                }
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
        async (req, res) => {
            let client

            try {
                const {
                    customerid,
                    locationid,
                    points,
                    phone,
                    verificationstatus,
                    isactive,
                    isvip,
                    isblacklist,
                    privilegedmatchrule
                } = req.body

                const actingUserId = Number(req.authUser?.id)
                const locationId = Number(locationid)

                const customerId =
                    Number(customerid)

                const nextPoints =
                    Number(points)

                const nextPhone = String(phone ?? '').replace(/\D/g, '')
                const requestedVerificationStatus = String(verificationstatus ?? '').trim().toLowerCase()

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
                    !Number.isSafeInteger(locationId) ||
                    locationId <= 0 ||
                    !Number.isInteger(actingUserId) ||
                    actingUserId <= 0 ||
                    !Number.isFinite(nextPoints) ||
                    nextPoints < 0 ||
                    nextPhone.length !== 10 ||
                    !['verified', 'unverified', 'bypass'].includes(requestedVerificationStatus)
                ) {
                    return res.status(400).json({
                        success: false,
                        message: 'Valid customer, location, points, phone number and verification status are required.',
                        code: 40000
                    })
                }

                client = await pool.connect()
                await client.query('BEGIN')

                const customerResult =
                    await client.query(
                        `
                        SELECT
                            "Points",
                            "IsActive",
                            "IsVIP",
                            "IsBlacklist",
                            "Phone",
                            "PhoneVerified",
                            "VerificationMethod",
                            "PrivilegedMatchRule"
                        FROM "Customer"
                        WHERE "ID" = $1 AND "locationid" = $2
                        FOR UPDATE
                        `,
                        [customerId, locationId]
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

                const phoneChanged = String(currentCustomer.Phone ?? '').replace(/\D/g, '') !== nextPhone
                // A new phone number must never inherit verification of the old number.
                const nextVerificationStatus = phoneChanged ? 'unverified' : requestedVerificationStatus
                const currentVerificationStatus = currentCustomer.PhoneVerified === true
                    ? 'verified'
                    : String(currentCustomer.VerificationMethod ?? '').trim().toLowerCase() === 'bypass'
                        ? 'bypass'
                        : 'unverified'

                const changes = [
                    {
                        changed: phoneChanged,
                        type: 'PHONE_NUMBER',
                        oldValue: currentCustomer.Phone,
                        newValue: nextPhone,
                        description: `User ${actingUserId} changed customer phone number`
                    },
                    {
                        changed: currentVerificationStatus !== nextVerificationStatus,
                        type: 'PHONE_VERIFICATION',
                        oldValue: currentVerificationStatus,
                        newValue: nextVerificationStatus,
                        description: `User ${actingUserId} changed phone verification to ${nextVerificationStatus}`
                    },
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
                            "IsBlacklist" = $5,
                            "Phone" = $8,
                            "PhoneVerified" = $9,
                            "PhoneVerifiedAt" = CASE WHEN $9 THEN COALESCE("PhoneVerifiedAt", NOW()) ELSE NULL END,
                            "VerificationMethod" = $10
                        WHERE "ID" = $6 AND "locationid" = $7
                        RETURNING
                            "ID" AS id,
                            "Points" AS points,
                            "PrivilegedMatchRule" AS "PrivilegedMatchRule",
                            "IsActive" AS isactive,
                            "IsVIP" AS isvip,
                            "IsBlacklist" AS isblacklist,
                            "Phone" AS phone,
                            "PhoneVerified" AS phoneverified,
                            "VerificationMethod" AS verificationmethod
                        `,
                        [
                            nextPoints,
                            nextPrivileged,
                            nextIsActive,
                            nextIsVip,
                            nextIsBlacklist,
                            customerId,
                            locationId,
                            nextPhone,
                            nextVerificationStatus === 'verified',
                            nextVerificationStatus === 'verified' ? 'manual' : nextVerificationStatus === 'bypass' ? 'bypass' : null
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
                    if (client) await client.query('ROLLBACK')
                } catch {}

                console.error(
                    'Update customer account error:',
                    error
                )

                if (error.code === '23505') {
                    return res.status(409).json({
                        success: false,
                        message: 'This phone number is already registered at this location.',
                        code: 40900
                    })
                }

                return res.status(500).json({
                    success: false,
                    message: 'Error updating customer account.',
                    code: 50000
                })
            } finally {
                if (client) client.release()
            }
        }
    )

    // ============================================================
    // GET CUSTOMER LOGS
    // Permission: customers.read
    // ============================================================

    router.get(
        '/getcustomerlogs',
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
        async (req, res) => {
            try {
                const {
                    id,
                    locationid
                } = req.query

                const customerId = Number(id)
                const locationId = Number(locationid)
                if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
                    !Number.isSafeInteger(locationId) || locationId <= 0) {
                    return res.status(400).json({
                        success: false,
                        code: 40000,
                        message: 'Valid customer ID and locationid are required.'
                    })
                }

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
                            AND EXISTS (
                                SELECT 1 FROM "Customer" c
                                WHERE c."ID" = "CustomerLog"."CustomerID"
                                  AND c."locationid" = $2
                            )

                        ORDER BY
                            "DateCreated" DESC
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
        requireModuleAccess('customers'),
        requireCustomerUploadLocation,
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
