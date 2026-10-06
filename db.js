require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,

    ssl:
        process.env.PG_SSL === 'true'
            ? { rejectUnauthorized: false }
            : false,

    max: 20,
    idleTimeoutMillis: 30000,
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL successfully!');
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
});

// pool.query(`SELECT current_database() AS database, current_user AS db_user`)
//     .then((result) => {
//         console.log('RENDER DATABASE CHECK:', result.rows[0]);
//     })
//     .catch((err) => {
//         console.error('RENDER DATABASE ERROR:', err.message);
//     });

module.exports = {
    pool,
};