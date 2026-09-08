const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db'); // Import database resources

const tokens = {
    admin: {
        token: 'admin-token'
    },
    editor: {
        token: 'editor-token'
    }
}

const users = {
    'admin-token': {
        roles: ['admin'],
        avatar: 'https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif',
        name: 'Admin',
        locationid: 0,
        location: ''
    },
    'employee-token': {
        roles: ['employee'],
        avatar: 'https://wpimg.wallstcn.com/f778738c-e4f8-4870-b634-56703b4acafe.gif',
        name: 'Employee',
        locationid: 0,
        location: ''
    }
}

// Login API Endpoint
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required.' });
    }

    try {
        // Connect to SQL Server
        let pool = await poolPromise;
        //let pool = await sql.connect(dbConfig);

        // Execute parameterized query to protect against SQL Injection
        let result = await pool.request()
            .input('UsernameParam', sql.VarChar, username)
            .input('PasswordParam', sql.VarChar, password)
            .query('SELECT u.id, username, token,locationid,l.name as locationname FROM Users u inner join Locations l on l.id=u.locationid WHERE Username = @UsernameParam AND Password = @PasswordParam');

        if (result.recordset.length > 0) {

            //console.log(result.recordset[0].token)
            // Authentication successful
            res.status(200).json({
                success: true,
                message: 'Login successful!',
                code: 20000,
                token: result.recordset[0].token,
                userid: result.recordset[0].id,
                locationid: result.recordset[0].locationid,
                locationname: result.recordset[0].locationname
            });

            // console.log(res)
        } else {
            // Authentication failed
            res.status(200).json({ success: false, message: 'Invalid username or password.', code: 50000 });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error 1.' + err.message });
    }
});

router.get('/userinfo', async (req, res) => {

    //console.log(req.query)
    const { token, userid } = req.query

    // console.log(token);
    // console.log(userid);

    const info = users[token]

    // Connect to SQL Server
    //let pool = await sql.connect(dbConfig);
    let pool = await poolPromise;

    let resultLoc = await pool.request()
        .query('SELECT id, name, isactive FROM Locations');

    // Execute parameterized query to protect against SQL Injection
    // let result = await pool.request()
    //     .input('useridParam', sql.Int, userid)
    //     .query('SELECT id, name, token, roles, avatar, locationid FROM Users WHERE id=@useridParam and isActive=1');

    let result = await pool.request()
        .input('useridParam', sql.Int, userid)
        .query('SELECT u.id, u.name, token, roles, avatar, locationid ,l.name as locationname FROM Users u inner join Locations l on l.id=u.locationid WHERE u.id=@useridParam and u.isActive=1');


    if (result.recordset.length > 0) {

        const info = users[token]
        info.roles[0] = result.recordset[0].roles
        info.name = result.recordset[0].name
        info.avatar = result.recordset[0].avatar
        info.locationid = result.recordset[0].locationid
        info.location = result.recordset[0].locationname

        //console.log(result.recordset[0].token)
        // Authentication successful

        res.status(200).json({
            success: true,
            message: 'Login successful!',
            code: 20000,
            data: info,
            locations: resultLoc.recordset
        });

        // console.log(res)
    } else {
        // Authentication failed
        res.status(200).json({ success: false, message: 'There is an error while getting user info.', code: 50000 });
    }

    // res.status(200).json(
    //     {
    //         success: true,
    //         message: 'get user successful!',
    //         code: 20000,
    //         data: info,
    //         locations: mylocations
    //     });

});


module.exports = router;