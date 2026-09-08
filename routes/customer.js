const express = require('express');
const multer = require('multer');
const { poolPromise, sql } = require('../db'); // Import database resources


// ============================================================
// Export router as a function so we can receive Socket.IO "io"
// ============================================================

module.exports = function (io) {

    const router = express.Router();


    // ============================================================
    // 1. Configure where and how files are saved
    // ============================================================

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'uploads/');
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    });


    // ============================================================
    // 2. Initialize multer with file restrictions
    // ============================================================

    const upload = multer({
        storage: storage,
        limits: { fileSize: 5 * 1024 * 1024 },
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

        const { customer } = req.body;
        const imageFile = req.file;

        const mycustomer = JSON.parse(customer);

        if (!req.file) {
            return res.status(400).json({
                message: 'No file uploaded.',
                code: 20000
            });
        }

        let pool = await poolPromise;

        let result = await pool.request()
            .input('firstname', sql.VarChar, mycustomer.firstname)
            .input('lastname', sql.VarChar, mycustomer.lastname)
            .input('dob', sql.VarChar, mycustomer.dob)
            .input('locationid', sql.Int, mycustomer.locationid)
            .input('avatar', sql.VarChar, imageFile.path.replace(/\\/g, '/'))
            .input('isactive', sql.Int, mycustomer.isactive)
            .input('phone', sql.VarChar, mycustomer.phone)
            .query(`
                INSERT INTO Customer
                (
                    firstname,
                    lastName,
                    dob,
                    avatar,
                    phone,
                    dateCreated,
                    locationid,
                    isActive
                )
                VALUES
                (
                    @firstname,
                    @lastname,
                    @dob,
                    @avatar,
                    @phone,
                    GETDATE(),
                    @locationid,
                    @isactive
                )
            `);

        res.status(200).json({
            success: true,
            message: 'Customer saved successful!',
            code: 20000
        });

    });


    // ============================================================
    // UPLOAD PHOTO
    // ============================================================

    router.post('/uploadphoto', upload.single('image'), async (req, res) => {

        if (!req.file) {
            return res.status(400).json({
                message: 'No file uploaded.',
                code: 20000
            });
        }

        res.status(200).json({
            success: true,
            message: 'get user successful!',
            code: 20000
        });

    });


    // ============================================================
    // GET ALL CUSTOMERS
    // ============================================================

    router.get('/getall', async (req, res) => {

        const { locationid } = req.query;

        let pool = await poolPromise;

        let result = await pool.request()
            .input('locationid', sql.Int, locationid)
            .query(`
                SELECT
                    id,
                    firstname,
                    lastname,
                    convert(varchar(20),dob,103) as dob,
                    avatar,
                    phone,
                    points,
                    convert(varchar(20),datecreated,103) as datecreated,
                    isactive
                FROM Customer
                WHERE locationid=@locationid
            `);

        if (result.recordset.length > 0) {

            res.status(200).json({
                success: true,
                message: 'Login successful!',
                code: 20000,
                data: result.recordset
            });

        } else {

            res.status(200).json({
                success: false,
                message: 'there is no customers',
                code: 20000
            });

        }

    });


    // ============================================================
    // DELETE CUSTOMER
    // ============================================================

    router.delete('/delete', async (req, res) => {

        const { id } = req.query;

        let pool = await poolPromise;

        let result = await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Customer WHERE id=@id');

        res.status(200).json({
            success: true,
            message: 'Delete successful!',
            code: 20000,
            data: result.recordset
        });

    });


    // ============================================================
    // UPDATE STATUS
    // ============================================================

    router.put('/updatestatus', async (req, res) => {

        const { id } = req.query;

        let pool = await poolPromise;

        let result = await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Customer SET isactive=~isactive WHERE id=@id');

        res.status(200).json({
            success: true,
            message: 'Update successful!',
            code: 20000,
            data: result.recordset
        });

    });


    // ============================================================
    // CHECK-IN
    // ============================================================

    router.post('/checkin', upload.single('image'), async (req, res) => {

        try {

            const { checkindata } = req.body;
            const imageFile = req.file;

            const mycheckin = JSON.parse(checkindata);

            console.log("here: " + mycheckin.customernumber);

            if (!req.file) {
                return res.status(400).json({
                    message: 'No file uploaded.',
                    code: 20000
                });
            }

            let pool = await poolPromise;


            // ====================================================
            // Find customer
            // ====================================================

            let result = await pool.request()
                .input('customernumber', sql.VarChar, mycheckin.customernumber)
                .input('locationid', sql.Int, mycheckin.locationid)
                .query(`
                    SELECT
                        id,
                        firstname,
                        lastname
                    FROM Customer
                    WHERE customernumber=@customernumber
                    AND locationid=@locationid
                `);


            if (result.recordset.length > 0) {

                const customer = result.recordset[0];

                console.log(customer);


                // ====================================================
                // Save check-in
                // ====================================================

                let result2 = await pool.request()
                    .input('customerid', sql.Int, customer.id)
                    .input('locationid', sql.Int, mycheckin.locationid)
                    .input(
                        'photo',
                        sql.VarChar,
                        imageFile.path.replace(/\\/g, '/')
                    )
                    .query(`
                        INSERT INTO Checkin
                        (
                            customerid,
                            locationid,
                            checkindate,
                            photo,
                            Status
                        )
                        VALUES
                        (
                            @customerid,
                            @locationid,
                            GETDATE(),
                            @photo,
                            0
                        )
                    `);


                // ====================================================
                // SOCKET.IO EMIT
                // ====================================================
                // Tell all connected Vue clients that a new check-in
                // has been created.
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
                // Response to the client that performed check-in
                // ====================================================

                res.status(200).json({
                    success: true,
                    message: 'Checkin successful!',
                    code: 20000
                });

            } else {

                res.status(200).json({
                    success: true,
                    message: 'Customer not found!',
                    code: 50000
                });

            }

        } catch (error) {

            console.error('Check-in error:', error);

            res.status(500).json({
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

        const { locationid } = req.query;

        let pool = await poolPromise;

        let result = await pool.request()
            .input('locationid', sql.Int, locationid)
            .query(`
                SELECT
                    c.id,
                    (c.firstname +' ' + c.lastname) as fullname,
                    convert(varchar(20),c.dob,103) as dob,
                    c.avatar,
                    c.phone,
                    c.points,
                    convert(varchar(20),c.datecreated,103) as datecreated,
                    c.isactive,
                    c.locationid as customerlocationid,
                    ck.id as checkinid,
                    FORMAT(ck.checkindate, 'hh:mm tt') as checkindate,
                    FORMAT(ck.approveddate, 'hh:mm tt') as approveddate,
                    ck.photo,
                    ck.status,
                    ck.LocationId as checkinlocationid,
                    CONCAT(
                        DATEDIFF(MINUTE, checkindate, GETDATE()) / 60,
                        ' hr ',
                        DATEDIFF(MINUTE, checkindate, GETDATE()) % 60,
                        ' min'
                    ) AS duration,
                    u.name as approvedby

                FROM Customer c
                INNER JOIN Checkin ck ON ck.CustomerId = c.ID
                LEFT JOIN Users u on u.id=ck.approvedby
                WHERE ck.locationid = @locationid
                Order by ck.checkindate desc
            `);

        if (result.recordset.length > 0) {

            res.status(200).json({
                success: true,
                message: 'Login successful!',
                code: 20000,
                data: result.recordset
            });

        } else {

            res.status(200).json({
                success: false,
                message: 'there is no customers',
                code: 20000
            });

        }

    });


    // ============================================================
    // Approve Checkin
    // ============================================================


    router.put('/approvecheckin', async (req, res) => {

        const { id, userid } = req.query;

        let pool = await poolPromise;

        let result = await pool.request()
            .input('id', sql.Int, id)
            .input('userid', sql.Int, userid)
            .query('UPDATE Checkin SET status=1, ApprovedBy=@userid, ApprovedDate=getdate() WHERE id=@id');

        res.status(200).json({
            success: true,
            message: 'Update successful!',
            code: 20000,
            data: result.recordset
        });

    });

    // ============================================================
    // Return Router
    // ============================================================

    return router;

};
