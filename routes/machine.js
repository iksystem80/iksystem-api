const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db'); // Import database resources

router.post('/generatemachines', async (req, res) => {

    //console.log(req.body);
    const { start, end, locationid } = req.body;

    //let pool = await sql.connect(dbConfig);
    let pool = await poolPromise;

    // Execute parameterized query to protect against SQL Injection
    let result = await pool.request()
        .input('start', sql.Int, start)
        .input('end', sql.Int, end)
        .input('locationid', sql.Int, locationid)
        .query(`;WITH Numbers AS
        (
            SELECT TOP (@end - @start + 1)
                   ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
            FROM sys.all_objects a
            CROSS JOIN sys.all_objects b
        )

        INSERT INTO Machines (MachineNumber, locationid, StatusId)
        SELECT @start + n - 1, @locationid , 1
        FROM Numbers N
        WHERE NOT EXISTS
        (
            SELECT 1
            FROM Machines M
            WHERE M.MachineNumber = @start + N.n - 1 And locationid=@locationid
        );`);

    res.status(200).json({
        success: true,
        message: 'Machine generated successful. System skipped the duplicate machine numbers!',
        code: 20000
    });
});

router.get('/getall', async (req, res) => {

    // console.log("body: " + req.query)
    const { locationid } = req.query

    console.log(locationid)

    //let pool = await sql.connect(dbConfig);
    let pool = await poolPromise;

    // Execute parameterized query to protect against SQL Injection
    let result = await pool.request()
        .input('locationid', sql.Int, locationid)
        .query(`SELECT m.id, m.machinenumber, mt.typename as machinetype, g.gamename, ms.description as status 
                FROM Machines m
                inner join MachineStatus ms on ms.ID = m.StatusId
                left join MachineTypes mt on mt.Id=m.MachineTypeId
                left join Games g on g.id=m.GameId WHERE locationid=@locationid`);

    if (result.recordset.length > 0) {

        res.status(200).json({
            success: true,
            message: 'get successful!',
            code: 20000,
            data: result.recordset
        });

        // console.log(res)
    } else {
        // Authentication failed
        res.status(200).json({ success: false, message: 'no machines found.', code: 20000 });
    }
});


module.exports = router;