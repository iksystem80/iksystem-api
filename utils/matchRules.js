const DEFAULT_TIME_ZONE = process.env.MATCH_TIMEZONE || 'America/Chicago'

function parseTime(value, fallback = '00:00') {
    const text = String(value || fallback).trim()
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text)
    if (!match) return null

    return {
        hour: Number(match[1]),
        minute: Number(match[2]),
        text: `${match[1]}:${match[2]}`,
        totalMinutes: (Number(match[1]) * 60) + Number(match[2])
    }
}

function normalizeResetTimes(value) {
    let times = value

    if (typeof value === 'string') {
        try {
            times = JSON.parse(value)
        } catch {
            times = value.split(',').map(item => item.trim()).filter(Boolean)
        }
    }

    if (!Array.isArray(times)) return []

    return [...new Set(
        times
            .map(item => parseTime(item))
            .filter(Boolean)
            .sort((a, b) => a.totalMinutes - b.totalMinutes)
            .map(item => item.text)
    )]
}

function getZonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    })

    const parts = formatter.formatToParts(date)
    const map = Object.fromEntries(
        parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    )

    return {
        year: map.year,
        month: map.month,
        day: map.day,
        hour: map.hour,
        minute: map.minute,
        second: map.second
    }
}

function addCalendarDays(parts, days) {
    const temp = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0))
    return {
        year: temp.getUTCFullYear(),
        month: temp.getUTCMonth() + 1,
        day: temp.getUTCDate()
    }
}

function zonedWallTimeToUtc(parts, timeZone) {
    const desiredAsUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour || 0,
        parts.minute || 0,
        parts.second || 0,
        0
    )

    let candidate = new Date(desiredAsUtc)

    for (let i = 0; i < 4; i += 1) {
        const actual = getZonedParts(candidate, timeZone)
        const actualAsUtc = Date.UTC(
            actual.year,
            actual.month - 1,
            actual.day,
            actual.hour,
            actual.minute,
            actual.second,
            0
        )

        const diff = desiredAsUtc - actualAsUtc
        if (diff === 0) break
        candidate = new Date(candidate.getTime() + diff)
    }

    return candidate
}

function buildBoundary(localDate, timeText, timeZone) {
    const parsed = parseTime(timeText)
    if (!parsed) return null

    return zonedWallTimeToUtc(
        {
            year: localDate.year,
            month: localDate.month,
            day: localDate.day,
            hour: parsed.hour,
            minute: parsed.minute,
            second: 0
        },
        timeZone
    )
}

function getDailyWindow(now, resetDayTime, timeZone) {
    const localNow = getZonedParts(now, timeZone)
    const today = {
        year: localNow.year,
        month: localNow.month,
        day: localNow.day
    }

    let start = buildBoundary(today, resetDayTime, timeZone)

    if (!start) {
        start = buildBoundary(today, '00:00', timeZone)
    }

    let startDate = today

    if (now < start) {
        startDate = addCalendarDays(today, -1)
        start = buildBoundary(startDate, resetDayTime, timeZone)
    }

    const endDate = addCalendarDays(startDate, 1)
    const end = buildBoundary(endDate, resetDayTime, timeZone)

    return { start, end }
}

function getShiftWindow(now, resetTimes, timeZone) {
    const normalized = normalizeResetTimes(resetTimes)

    if (!normalized.length) {
        return null
    }

    const localNow = getZonedParts(now, timeZone)
    const today = {
        year: localNow.year,
        month: localNow.month,
        day: localNow.day
    }

    const candidateDates = [
        addCalendarDays(today, -1),
        today,
        addCalendarDays(today, 1)
    ]

    const boundaries = []

    for (const date of candidateDates) {
        for (const time of normalized) {
            const boundary = buildBoundary(date, time, timeZone)
            if (boundary) boundaries.push(boundary)
        }
    }

    boundaries.sort((a, b) => a.getTime() - b.getTime())

    let start = null
    let end = null

    for (const boundary of boundaries) {
        if (boundary <= now) {
            start = boundary
            continue
        }

        if (start) {
            end = boundary
            break
        }
    }

    if (!start || !end) return null

    return { start, end }
}

function minutesRemaining(from, until) {
    return Math.max(0, Math.ceil((until.getTime() - from.getTime()) / 60000))
}

async function getMatchRuleSettings(db, locationId) {
    const result = await db.query(
        `
        SELECT
            "MatchRuleEnabled",
            "MatchCooldownHours",
            "MatchMaxPerDay",
            "MatchResetTimes",
            "MatchResetDayTime"
        FROM "LocationRuleSettings"
        WHERE "LocationId" = $1
        LIMIT 1
        `,
        [locationId]
    )

    if (!result.rowCount) {
        return {
            enabled: false,
            cooldownHours: 0,
            maxPerDay: 0,
            resetTimes: [],
            resetDayTime: '00:00'
        }
    }

    const row = result.rows[0]

    return {
        enabled: Boolean(row.MatchRuleEnabled),
        cooldownHours: Math.max(0, Number(row.MatchCooldownHours || 0)),
        maxPerDay: Math.max(0, Number(row.MatchMaxPerDay || 0)),
        resetTimes: normalizeResetTimes(row.MatchResetTimes),
        resetDayTime: String(row.MatchResetDayTime || '00:00').slice(0, 5)
    }
}

async function checkMatchEligibility(db, {
    customerId,
    locationId,
    now = new Date(),
    timeZone = DEFAULT_TIME_ZONE
}) {
    const customer = Number(customerId)
    const location = Number(locationId)

    if (!Number.isInteger(customer) || customer <= 0) {
        throw new Error('Valid customer id is required.')
    }

    if (!Number.isInteger(location) || location <= 0) {
        throw new Error('Valid location id is required.')
    }

    const settings = await getMatchRuleSettings(db, location)

    const base = {
        ruleEnabled: settings.enabled,
        eligible: true,
        reasonCode: null,
        message: null,
        cooldownUntil: null,
        cooldownRemainingMinutes: 0,
        dailyCount: 0,
        dailyLimit: settings.maxPerDay,
        shiftMatchCount: 0,
        shiftStart: null,
        shiftEnd: null,
        lastMatchAt: null
    }

    // Master switch: disabled means no Match Rule checks at all.
    if (!settings.enabled) {
        return base
    }

    if (!settings.resetTimes.length) {
        return {
            ...base,
            eligible: false,
            reasonCode: 'MATCH_RULE_CONFIG',
            message: 'Match Rule is enabled but no shift reset times are configured.'
        }
    }

    const dailyWindow = getDailyWindow(now, settings.resetDayTime, timeZone)
    const shiftWindow = getShiftWindow(now, settings.resetTimes, timeZone)

    if (!dailyWindow || !shiftWindow) {
        return {
            ...base,
            eligible: false,
            reasonCode: 'MATCH_RULE_CONFIG',
            message: 'Unable to determine the current Match shift.'
        }
    }

    const activity = await db.query(
        `
        SELECT
            COUNT(*) FILTER (
                WHERE "DateAssign" >= $3 AND "DateAssign" < $4
            )::int AS daily_count,

            COUNT(*) FILTER (
                WHERE "DateAssign" >= $5 AND "DateAssign" < $6
            )::int AS shift_count,

            MAX("DateAssign") AS last_match_at
        FROM "CustomerMatch"
        WHERE "CustomerId" = $1
          AND "LocationId" = $2
          AND COALESCE("IsExtraMatch", false) = false
        `,
        [
            customer,
            location,
            dailyWindow.start,
            dailyWindow.end,
            shiftWindow.start,
            shiftWindow.end
        ]
    )

    const row = activity.rows[0] || {}
    const dailyCount = Number(row.daily_count || 0)
    const shiftMatchCount = Number(row.shift_count || 0)
    const lastMatchAt = row.last_match_at ? new Date(row.last_match_at) : null

    const result = {
        ...base,
        dailyCount,
        shiftMatchCount,
        shiftStart: shiftWindow.start.toISOString(),
        shiftEnd: shiftWindow.end.toISOString(),
        lastMatchAt: lastMatchAt ? lastMatchAt.toISOString() : null
    }

    // Daily limit.
    if (settings.maxPerDay > 0 && dailyCount >= settings.maxPerDay) {
        return {
            ...result,
            eligible: false,
            reasonCode: 'DAILY_LIMIT',
            message: `Customer has reached the daily Match limit (${settings.maxPerDay}).`
        }
    }

    // One Match per configured shift.
    if (shiftMatchCount >= 1) {
        return {
            ...result,
            eligible: false,
            reasonCode: 'SHIFT_LIMIT',
            message: 'Customer has already received a Match in the current shift.'
        }
    }

    // Cooldown continues across shift boundaries.
    if (lastMatchAt && settings.cooldownHours > 0) {
        const cooldownUntilDate = new Date(
            lastMatchAt.getTime() + (settings.cooldownHours * 60 * 60 * 1000)
        )

        if (now < cooldownUntilDate) {
            return {
                ...result,
                eligible: false,
                reasonCode: 'COOLDOWN',
                message: 'Customer is still in the Match cooldown period.',
                cooldownUntil: cooldownUntilDate.toISOString(),
                cooldownRemainingMinutes: minutesRemaining(now, cooldownUntilDate)
            }
        }
    }

    return result
}

module.exports = {
    checkMatchEligibility,
    getMatchRuleSettings,
    normalizeResetTimes,
    getShiftWindow,
    getDailyWindow
}
