const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool } = require('../db');


// ============================================================
// Export router as a function so we can receive Socket.IO "io"
// ============================================================

module.exports = function (io) {

    const router = express.Router();


    // ============================================================
    // Configure file uploads
    // ============================================================

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'uploads/');
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    });


    const upload = multer({
        storage: storage,
        limits: {
            fileSize: 5 * 1024 * 1024
        },
        fileFilter: (req, file, cb) => {

            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Only images are allowed!'), false);
            }

        }
    });


    // ============================================================
    // SAVE CUSTOMER
    // ============================================================

    router.post('/savecustomer', upload.single('image'), async (req, res) => {

        try {

            const { customer } = req.body;
            const imageFile = req.file;

            const mycustomer = JSON.parse(customer);

            if (!req.file) {
                return res.status(400).json({
                    message: 'No file uploaded.',
                    code: 20000
                });
            }

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
                    "IsActive"
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
                    $7
                )
                `,
                [
                    mycustomer.firstname,
                    mycustomer.lastname,
                    mycustomer.dob || null,
                    imageFile.path.replace(/\\/g, '/'),
                    mycustomer.phone,
                    mycustomer.locationid,
                    mycustomer.isactive
                ]
            );

            return res.status(200).json({
                success: true,
                message: 'Customer saved successful!',
                code: 20000
            });

        } catch (error) {

            console.error('Save customer error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while saving customer.',
                code: 50000
            });
        }

    });


    // ============================================================
    // UPLOAD PHOTO
    // ============================================================

    router.post('/uploadphoto', upload.single('image'), async (req, res) => {

        try {

            if (!req.file) {
                return res.status(400).json({
                    message: 'No file uploaded.',
                    code: 20000
                });
            }

            return res.status(200).json({
                success: true,
                message: 'get user successful!',
                code: 20000
            });

        } catch (error) {

            console.error('Upload photo error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error uploading photo.',
                code: 50000
            });
        }

    });


    // ============================================================
    // GET ALL CUSTOMERS
    // ============================================================

    router.get('/getall', async (req, res) => {

        try {

            const { locationid } = req.query;

            const result = await pool.query(
                `
                SELECT
                    "ID" AS id,
                    "Firstname" AS firstname,
                    "Lastname" AS lastname,
                    TO_CHAR("DOB", 'DD/MM/YYYY') AS dob,
                    "avatar" AS avatar,
                    "Phone" AS phone,
                    "Points" AS points,
                    TO_CHAR("DateCreated", 'DD/MM/YYYY') AS datecreated,
                    "IsActive" AS isactive
                FROM "Customer"
                WHERE "locationid" = $1
                `,
                [locationid]
            );

            if (result.rows.length > 0) {

                return res.status(200).json({
                    success: true,
                    message: 'Login successful!',
                    code: 20000,
                    data: result.rows
                });

            } else {

                return res.status(200).json({
                    success: false,
                    message: 'there is no customers',
                    code: 20000
                });

            }

        } catch (error) {

            console.error('Get customers error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while getting customers.',
                code: 50000
            });
        }

    });


    // ============================================================
    // DELETE CUSTOMER
    // ============================================================

    router.delete('/delete', async (req, res) => {

        try {

            const { id } = req.query;

            const result = await pool.query(
                `
                DELETE FROM "Customer"
                WHERE "ID" = $1
                RETURNING "ID"
                `,
                [id]
            );

            return res.status(200).json({
                success: true,
                message: 'Delete successful!',
                code: 20000,
                data: result.rows
            });

        } catch (error) {

            console.error('Delete customer error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while deleting customer.',
                code: 50000
            });
        }

    });


    // ============================================================
    // UPDATE STATUS
    // ============================================================

    router.put('/updatestatus', async (req, res) => {

        try {

            const { id } = req.query;

            const result = await pool.query(
                `
                UPDATE "Customer"
                SET "IsActive" = NOT "IsActive"
                WHERE "ID" = $1
                RETURNING "ID", "IsActive"
                `,
                [id]
            );

            return res.status(200).json({
                success: true,
                message: 'Update successful!',
                code: 20000,
                data: result.rows
            });

        } catch (error) {

            console.error('Update customer status error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while updating customer status.',
                code: 50000
            });
        }

    });


    // ============================================================
    // CHECK-IN
    // ============================================================

    router.post('/checkin', upload.single('image'), async (req, res) => {

        try {

            const { checkindata } = req.body;
            const imageFile = req.file;

            const mycheckin = JSON.parse(checkindata);

            console.log('here: ' + mycheckin.customernumber);

            if (!req.file) {
                return res.status(400).json({
                    message: 'No file uploaded.',
                    code: 20000
                });
            }


            // ====================================================
            // Find customer
            // ====================================================

            const result = await pool.query(
                `
                SELECT
                    "ID" AS id,
                    "Firstname" AS firstname,
                    "Lastname" AS lastname
                FROM "Customer"
                WHERE "CustomerNumber" = $1
                  AND "locationid" = $2
                `,
                [
                    mycheckin.customernumber,
                    mycheckin.locationid
                ]
            );


            if (result.rows.length > 0) {

                const customer = result.rows[0];

                console.log(customer);


                // ====================================================
                // Save check-in
                // ====================================================

                await pool.query(
                    `
                    INSERT INTO "CheckIn"
                    (
                        "CustomerId",
                        "LocationId",
                        "CheckInDate",
                        "Photo",
                        "Status"
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        NOW(),
                        $3,
                        false
                    )
                    `,
                    [
                        customer.id,
                        mycheckin.locationid,
                        imageFile.path.replace(/\\/g, '/')
                    ]
                );


                // ====================================================
                // SOCKET.IO EMIT
                // ====================================================

                const location = `location-${mycheckin.locationid}`;

                io.to(location).emit('customer-checkin', {
                    customerId: customer.id,
                    customerNumber: mycheckin.customernumber,
                    locationId: mycheckin.locationid,
                    firstname: customer.firstname,
                    lastname: customer.lastname
                });


                // ====================================================
                // Response
                // ====================================================

                return res.status(200).json({
                    success: true,
                    message: 'Checkin successful!',
                    code: 20000
                });

            } else {

                return res.status(200).json({
                    success: true,
                    message: 'Customer not found!',
                    code: 50000
                });

            }

        } catch (error) {

            console.error('Check-in error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while checking in customer.',
                code: 50000
            });

        }

    });


    // ============================================================
    // GET CHECK-IN
    // ============================================================

    router.get('/getcheckin', async (req, res) => {

        try {

            const { locationid } = req.query;

            const result = await pool.query(
                `
                SELECT
                    c."ID" AS id,

                    CONCAT(
                        c."Firstname",
                        ' ',
                        c."Lastname"
                    ) AS fullname,

                    TO_CHAR(c."DOB", 'DD/MM/YYYY') AS dob,

                    c."avatar" AS avatar,
                    c."Phone" AS phone,
                    c."Points" AS points,

                    TO_CHAR(
                        c."DateCreated",
                        'DD/MM/YYYY'
                    ) AS datecreated,

                    c."IsActive" AS isactive,

                    c."locationid" AS customerlocationid,

                    ck."ID" AS checkinid,

                    TO_CHAR(
                        ck."CheckInDate",
                        'HH12:MI AM'
                    ) AS checkindate,

                    TO_CHAR(
                        ck."ApprovedDate",
                        'HH12:MI AM'
                    ) AS approveddate,

                    ck."Photo" AS photo,
                    ck."Status" AS status,

                    ck."LocationId" AS checkinlocationid,

                    CONCAT(
                        FLOOR(
                            EXTRACT(
                                EPOCH FROM
                                (NOW() - ck."CheckInDate")
                            ) / 3600
                        ),
                        ' hr ',
                        FLOOR(
                            MOD(
                                EXTRACT(
                                    EPOCH FROM
                                    (NOW() - ck."CheckInDate")
                                ) / 60,
                                60
                            )
                        ),
                        ' min'
                    ) AS duration,

                    u."Name" AS approvedby

                FROM "Customer" c

                INNER JOIN "CheckIn" ck
                    ON ck."CustomerId" = c."ID"

                LEFT JOIN "Users" u
                    ON u."ID" = ck."ApprovedBy"

                WHERE ck."LocationId" = $1

                ORDER BY ck."CheckInDate" DESC
                `,
                [locationid]
            );


            if (result.rows.length > 0) {

                return res.status(200).json({
                    success: true,
                    message: 'Login successful!',
                    code: 20000,
                    data: result.rows
                });

            } else {

                return res.status(200).json({
                    success: false,
                    message: 'there is no customers',
                    code: 20000
                });

            }

        } catch (error) {

            console.error('Get check-in error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while getting check-ins.',
                code: 50000
            });

        }

    });


    // ============================================================
    // APPROVE CHECK-IN
    // ============================================================

    router.put('/approvecheckin', async (req, res) => {

        try {

            const { id, userid } = req.query;

            const result = await pool.query(
                `
                UPDATE "CheckIn"
                SET
                    "Status" = true,
                    "ApprovedBy" = $1,
                    "ApprovedDate" = NOW()
                WHERE "ID" = $2
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
            );

            return res.status(200).json({
                success: true,
                message: 'Update successful!',
                code: 20000,
                data: result.rows
            });

        } catch (error) {

            console.error('Approve check-in error:', error);

            return res.status(500).json({
                success: false,
                message: 'Error while approving check-in.',
                code: 50000
            });

        }

    });


    // ============================================================
    // Return Router
    // ============================================================

    return router;

};
