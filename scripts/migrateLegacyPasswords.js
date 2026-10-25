// Run from Server root:
//   node scripts/migrateLegacyPasswords.js          # inspect counts only
//   node scripts/migrateLegacyPasswords.js --apply  # hash old plaintext values
// Deploy bcrypt-only routes/user.js only after a successful --apply run.
require('dotenv').config()
const bcrypt = require('bcryptjs')
const { pool } = require('../db')

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
const apply = process.argv.includes('--apply')

async function main() {
    const result = await pool.query('SELECT "ID", "Password" FROM "Users" ORDER BY "ID"')
    const legacy = result.rows.filter(row => !BCRYPT_PATTERN.test(row.Password || ''))
    const invalid = legacy.filter(row => typeof row.Password !== 'string' || row.Password.length === 0)

    console.log(`Accounts: ${result.rowCount}; already hashed: ${result.rowCount - legacy.length}; legacy: ${legacy.length}`)
    if (invalid.length) {
        throw new Error(`${invalid.length} accounts have missing/empty passwords. Reset those passwords before migration.`)
    }
    if (!apply) {
        console.log('Dry run only. Run again with --apply to migrate legacy passwords.')
        return
    }

    let migrated = 0
    for (const user of legacy) {
        const hash = await bcrypt.hash(user.Password, 10)
        // Conditional update prevents overwriting a concurrent password change.
        const updated = await pool.query(`
            UPDATE "Users" SET "Password"=$1, "DateUpdated"=NOW()
            WHERE "ID"=$2 AND "Password"=$3
        `, [hash, user.ID, user.Password])
        migrated += updated.rowCount
    }
    const remaining = await pool.query('SELECT "Password" FROM "Users"')
    const count = remaining.rows.filter(row => !BCRYPT_PATTERN.test(row.Password || '')).length
    console.log(`Migrated ${migrated} accounts; legacy remaining: ${count}.`)
    if (count) throw new Error('Some legacy passwords remain. Do not deploy bcrypt-only login yet.')
}

main()
    .catch(error => { console.error('Password migration failed:', error.message); process.exitCode = 1 })
    .finally(() => pool.end())
