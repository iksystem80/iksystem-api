require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    ssl: {
        rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL successfully!');
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = {
    pool
};
