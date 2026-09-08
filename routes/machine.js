const express = require('express');
const router = express.Router();
const { pool } = require('../db');


// ============================================================
// GENERATE MACHINES
// ============================================================

router.post('/generatemachines', async (req, res) => {

    try {

        const {
            start,
            end,
            locationid
        } = req.body;


        // PostgreSQL generate_series() replaces the SQL Server
        // sys.all_objects number-generation technique.

        await pool.query(
            `
            INSERT INTO "Machines"
            (
                "MachineNumber",
                "locationid",
                "StatusId"
            )
            SELECT
                number,
                $3,
                1
             FROM generate_series($1::integer, $2::integer) AS number
            WHERE NOT EXISTS
            (
                SELECT 1
                FROM "Machines" m
                WHERE m."MachineNumber" = number
                  AND m."locationid" = $3
            )
            `,
            [
                start,
                end,
                locationid
            ]
        );


        return res.status(200).json({
            success: true,
            message: 'Machine generated successful. System skipped the duplicate machine numbers!',
            code: 20000
        });

    } catch (error) {

        console.error('Generate machines error:', error);

        return res.status(500).json({
            success: false,
            message: 'Error while generating machines.',
            code: 50000
        });

    }

});


// ============================================================
// GET ALL MACHINES
// ============================================================

router.get('/getall', async (req, res) => {

    try {

        const {
            locationid
        } = req.query;

        console.log(locationid);


        const result = await pool.query(
            `
            SELECT
                m."ID" AS id,
                m."MachineNumber" AS machinenumber,
                mt."TypeName" AS machinetype,
                g."GameName" AS gamename,
                ms."Description" AS status

            FROM "Machines" m

            INNER JOIN "MachineStatus" ms
                ON ms."ID" = m."StatusId"

            LEFT JOIN "MachineTypes" mt
                ON mt."ID" = m."MachineTypeId"

            LEFT JOIN "Games" g
                ON g."ID" = m."GameId"

            WHERE m."locationid" = $1
            ORDER BY m."MachineNumber" asc
            `,
            [locationid]
        );


        if (result.rows.length > 0) {

            return res.status(200).json({
                success: true,
                message: 'get successful!',
                code: 20000,
                data: result.rows
            });

        } else {

            return res.status(200).json({
                success: false,
                message: 'no machines found.',
                code: 20000
            });

        }

    } catch (error) {

        console.error('Get machines error:', error);

        return res.status(500).json({
            success: false,
            message: 'Error while getting machines.',
            code: 50000
        });

    }

});


module.exports = router;
