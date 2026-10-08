const twilio = require('twilio')

const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
)

const serviceId = process.env.TWILIO_SERVICE_ID

function ensureConfigured() {
    if (!process.env.TWILIO_ACCOUNT_SID) {
        throw new Error('TWILIO_ACCOUNT_SID is not configured.')
    }

    if (!process.env.TWILIO_AUTH_TOKEN) {
        throw new Error('TWILIO_AUTH_TOKEN is not configured.')
    }

    if (!serviceId) {
        throw new Error('TWILIO_SERVICE_ID is not configured.')
    }
}

function toE164(phone) {
    const raw = String(phone || '').trim()

    if (!raw) {
        throw new Error('Phone number is required.')
    }

    if (raw.startsWith('+')) {
        const internationalDigits = raw.replace(/\D/g, '')

        if (internationalDigits.length < 8 || internationalDigits.length > 15) {
            throw new Error('Invalid phone number.')
        }

        return `+${internationalDigits}`
    }

    const digits = raw.replace(/\D/g, '')

    if (digits.length === 10) {
        return `+1${digits}`
    }

    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`
    }

    throw new Error('Invalid phone number. Use a valid US number or E.164 format.')
}

async function sendCode(phone) {
    ensureConfigured()

    return client.verify.v2
        .services(serviceId)
        .verifications.create({
            to: toE164(phone),
            channel: 'sms'
        })
}

async function verifyCode(phone, code) {
    ensureConfigured()

    if (!code) {
        throw new Error('Verification code is required.')
    }

    const result = await client.verify.v2
        .services(serviceId)
        .verificationChecks.create({
            to: toE164(phone),
            code: String(code).trim()
        })

    return {
        approved: result.status === 'approved',
        status: result.status,
        sid: result.sid
    }
}

module.exports = {
    sendCode,
    verifyCode,
    toE164
}
