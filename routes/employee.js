const express = require('express');
const router = express.Router();
const { pool } = require('../db');


// ============================================================
// SAVE EMPLOYEE
// ============================================================

router.post('/saveemployee', async (req, res) => {

    try {

        const {
            username,
            password,
            name,
            locationid
        } = req.body;


        const result = await pool.query(
            `
            INSERT INTO "Users"
            (
                "Username",
                "Password",
                "Name",
                "token",
                "roles",
                "LocationId",
                "Avatar",
                "DateCreated",
                "IsActive"
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
                NOW(),
                true
            )
            RETURNING "ID"
            `,
            [
                username,
                password,
                name,
                'employee-token',
                'employee',
                locationid,
                '/upload/profile.png'
            ]
        );


        return res.status(200).json({
            success: true,
            message: 'Employee saved successful!',
            code: 20000
        });

    } catch (error) {

        console.error('Save employee error:', error);

        return res.status(500).json({
            success: false,
            message: 'Error while saving employee.',
            code: 50000
        });

    }

});


// ============================================================
// GET ALL EMPLOYEES
// ============================================================

router.get('/getall', async (req, res) => {

    try {

        console.log(req.query);

        const { locationid } = req.query;


        const result = await pool.query(
            `
            SELECT
                "ID" AS id,
                "Username" AS username,
                "Password" AS password,
                "Name" AS name,
                "Avatar" AS avatar,
                "DateCreated" AS datecreated,
                "IsActive" AS isactive
            FROM "Users"
            WHERE "LocationId" = $1
              AND "IsActive" = true
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
                message: 'There is an error while getting user info.',
                code: 50000
            });

        }

    } catch (error) {

        console.error('Get employees error:', error);

        return res.status(500).json({
            success: false,
            message: 'Error while getting employees.',
            code: 50000
        });

    }

});


// ============================================================
// DELETE EMPLOYEE
// ============================================================

router.delete('/delete', async (req, res) => {

    try {

        const { id } = req.query;


        const result = await pool.query(
            `
            DELETE FROM "Users"
            WHERE "ID" = $1
            RETURNING "ID"
            `,
            [id]
        );


        return res.status(200).json({
            success: true,
            message: 'Login successful!',
            code: 20000,
            data: result.rows
        });

    } catch (error) {

        console.error('Delete employee error:', error);

        return res.status(500).json({
            success: false,
            message: 'Error while deleting user.',
            code: 50000
        });

    }

});


module.exports = router;
