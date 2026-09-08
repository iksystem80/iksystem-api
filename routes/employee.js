const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db'); // Import database resources

router.post('/saveemployee', async (req, res) => {

    //console.log(req.body);
    const { username, password, name, locationid } = req.body;

    //let pool = await sql.connect(dbConfig);
    let pool = await poolPromise;

    // Execute parameterized query to protect against SQL Injection
    let result = await pool.request()
        .input('username', sql.VarChar, username)
        .input('password', sql.VarChar, password)
        .input('name', sql.VarChar, name)
        .input('token', sql.VarChar, 'employee-token')
        .input('role', sql.VarChar, 'employee')
        .input('locationid', sql.Int, locationid)
        .input('avatar', sql.VarChar, '/upload/profile.png')
        .query('Insert into Users (Username, Password, Name,token, roles,locationid,avatar, DateCreated,IsActive) Values (@username,@password,@name,@token,@role,@locationid,@avatar,getdate(),1)');

    res.status(200).json({
        success: true,
        message: 'Employee saved successful!',
        code: 20000
    });
});

router.get('/getall', async (req, res) => {

    console.log(req.query)
    const { locationid } = req.query

    //let pool = await sql.connect(dbConfig);
    let pool = await poolPromise;

    // Execute parameterized query to protect against SQL Injection
    let result = await pool.request()
        .input('locationid', sql.Int, locationid)
        .query('SELECT id, username, password, name, avatar, datecreated, isactive FROM Users WHERE locationid=@locationid and isActive=1');

    if (result.recordset.length > 0) {

        res.status(200).json({
            success: true,
            message: 'Login successful!',
            code: 20000,
            data: result.recordset
        });

        // console.log(res)
    } else {
        // Authentication failed
        res.status(200).json({ success: false, message: 'There is an error while getting user info.', code: 50000 });
    }
});

router.delete('/delete', async (req, res) => {
    const { id } = req.query;

    //let pool = await sql.connect(dbConfig);
    let pool = await poolPromise;

    // Execute parameterized query to protect against SQL Injection
    let result = await pool.request()
        .input('id', sql.Int, id)
        .query('Delete FROM Users WHERE id=@id');

    //if (result.recordset.length > 0) {

        res.status(200).json({
            success: true,
            message: 'Login successful!',
            code: 20000,
            data: result.recordset
        });

        // console.log(res)
    // } else {
    // // Authentication failed
    //     res.status(200).json({ success: false, message: 'There is an error while deleting user.', code: 50000 });
    // }
})

module.exports = router;