require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,

    // When TLS is enabled, verify the PostgreSQL server certificate.
    // PG_SSL_CA may hold a PEM certificate (including escaped newlines).
    // If unset, Node.js verifies using its trusted CA certificates.
    ssl:
        process.env.PG_SSL === 'true'
            ? {
                rejectUnauthorized: true,
                ...(process.env.PG_SSL_CA
                    ? { ca: process.env.PG_SSL_CA.replace(/\\n/g, '\n') }
                    : {}),
            }
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

module.exports = {
    pool,
};
