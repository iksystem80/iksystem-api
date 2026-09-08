const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const tokens = {
    admin: {
        token: 'admin-token'
    },
    editor: {
        token: 'editor-token'
    }
};

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
};


// ============================================
// Login
// ============================================

router.post('/login', async (req, res) => {

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: 'username and password are required.'
        });
    }

    try {

        const result = await pool.query(
            `
            SELECT
                u."ID",
                u."Username",
                u."token",
                u."LocationId",
                l."name" AS "locationname"
            FROM "Users" u
            INNER JOIN "Locations" l
                ON l."ID" = u."LocationId"
            WHERE u."Username" = $1
              AND u."Password" = $2
            `,
            [username, password]
        );

        if (result.rows.length > 0) {

            const user = result.rows[0];

            return res.status(200).json({
                success: true,
                message: 'Login successful!',
                code: 20000,
                token: user.token,
                userid: user.ID,
                locationid: user.LocationId,
                locationname: user.locationname
            });

        } else {

            return res.status(200).json({
                success: false,
                message: 'Invalid username or password.',
                code: 50000
            });
        }

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            message: 'Internal server error 1.' + err.message
        });
    }
});


// ============================================
// User Info
// ============================================

router.get('/userinfo', async (req, res) => {

    const { token, userid } = req.query;

    try {

        const resultLoc = await pool.query(
            `
            SELECT
                "ID",
                "name",
                "IsActive"
            FROM "Locations"
            `
        );

        const result = await pool.query(
            `
            SELECT
                u."ID",
                u."Name",
                u."token",
                u."roles",
                u."Avatar",
                u."LocationId",
                l."name" AS "locationname"
            FROM "Users" u
            INNER JOIN "Locations" l
                ON l."ID" = u."LocationId"
            WHERE u."ID" = $1
              AND u."IsActive" = true
            `,
            [userid]
        );

        if (result.rows.length > 0) {

            const dbUser = result.rows[0];

            const info = users[token] || {
                roles: [],
                avatar: '',
                name: '',
                locationid: 0,
                location: ''
            };

            info.roles[0] = dbUser.roles;
            info.name = dbUser.Name;
            info.avatar = dbUser.Avatar;
            info.locationid = dbUser.LocationId;
            info.location = dbUser.locationname;

            return res.status(200).json({
                success: true,
                message: 'Login successful!',
                code: 20000,
                data: info,
                locations: resultLoc.rows
            });

        } else {

            return res.status(200).json({
                success: false,
                message: 'There is an error while getting user info.',
                code: 50000
            });
        }

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            message: 'Internal server error 2.' + err.message
        });
    }
});


module.exports = router;
