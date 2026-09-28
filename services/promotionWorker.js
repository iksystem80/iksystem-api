const twilio = require('twilio')
const { pool } = require('../db')
const { writePromotionAudit } = require('./promotionAudit')

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
)

let running = false

function buildStatusCallback() {
  const base = process.env.PUBLIC_API_BASE_URL

  if (!base) {
    return undefined
  }

  return `${base.replace(/\/$/, '')}/promotion/twilio/status`
}

async function processQueuedPromotions() {
  if (running) {
    return
  }

  running = true

  try {
    const promotionResult = await pool.query(
      `
      SELECT *
      FROM "Promotions"
      WHERE
        "Status" IN ('Queued', 'Processing')
        AND COALESCE("IsDeleted", false) = false
      ORDER BY "CreatedAt" ASC
      LIMIT 5
      `
    )

    for (const promotion of promotionResult.rows) {
      await pool.query(
        `
        UPDATE "Promotions"
        SET
          "Status" = 'Processing',
          "StartedAt" = COALESCE("StartedAt", NOW())
        WHERE "ID" = $1
        `,
        [promotion.ID]
      )

      const recipientResult = await pool.query(
        `
        SELECT *
        FROM "PromotionRecipients"
        WHERE
          "PromotionId" = $1
          AND "Status" IN ('Pending', 'Queued')
        ORDER BY "ID" ASC
        LIMIT 20
        `,
        [promotion.ID]
      )

      for (const recipient of recipientResult.rows) {
        try {
          const messageOptions = {
            body: promotion.MessageText || '',
            to:
              recipient.Channel === 'WhatsApp'
                ? `whatsapp:${recipient.Phone}`
                : recipient.Phone,
            statusCallback: buildStatusCallback()
          }

          if (recipient.Channel === 'WhatsApp') {
            messageOptions.from = process.env.TWILIO_WHATSAPP_FROM
          } else if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
            messageOptions.messagingServiceSid =
              process.env.TWILIO_MESSAGING_SERVICE_SID
          }

          if (promotion.FinalImageUrl) {
            messageOptions.mediaUrl = [
              promotion.FinalImageUrl
            ]
          }

          const message =
            await client.messages.create(messageOptions)

          await pool.query(
            `
            UPDATE "PromotionRecipients"
            SET
              "Status" = 'Sent',
              "TwilioMessageSid" = $2,
              "TwilioStatus" = $3,
              "SentAt" = NOW(),
              "UpdatedAt" = NOW()
            WHERE "ID" = $1
            `,
            [
              recipient.ID,
              message.sid,
              message.status || 'sent'
            ]
          )

          await pool.query(
            `
            INSERT INTO "PromotionDeliveryLogs"
            (
              "PromotionId",
              "PromotionRecipientId",
              "CustomerId",
              "TwilioMessageSid",
              "Channel",
              "Status",
              "RawPayload"
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            `,
            [
              promotion.ID,
              recipient.ID,
              recipient.CustomerId,
              message.sid,
              recipient.Channel,
              message.status || 'sent',
              JSON.stringify({
                sid: message.sid,
                status: message.status
              })
            ]
          )
        } catch (error) {
          await pool.query(
            `
            UPDATE "PromotionRecipients"
            SET
              "Status" = 'Failed',
              "TwilioStatus" = 'failed',
              "TwilioErrorCode" = $2,
              "TwilioErrorMessage" = $3,
              "FailedAt" = NOW(),
              "UpdatedAt" = NOW()
            WHERE "ID" = $1
            `,
            [
              recipient.ID,
              error.code ? String(error.code) : null,
              error.message || 'Twilio send failed.'
            ]
          )
        }
      }

      const remainingResult = await pool.query(
        `
        SELECT COUNT(*)::integer AS remaining
        FROM "PromotionRecipients"
        WHERE
          "PromotionId" = $1
          AND "Status" IN ('Pending', 'Queued')
        `,
        [promotion.ID]
      )

      if (remainingResult.rows[0].remaining === 0) {
        const failureResult = await pool.query(
          `
          SELECT COUNT(*)::integer AS failures
          FROM "PromotionRecipients"
          WHERE
            "PromotionId" = $1
            AND "Status" IN ('Failed', 'Undelivered')
          `,
          [promotion.ID]
        )

        const status =
          failureResult.rows[0].failures > 0
            ? 'CompletedWithErrors'
            : 'Completed'

        await pool.query(
          `
          UPDATE "Promotions"
          SET
            "Status" = $2,
            "CompletedAt" = NOW()
          WHERE "ID" = $1
          `,
          [promotion.ID, status]
        )

        await writePromotionAudit(
          pool,
          {
            companyId: promotion.CompanyId,
            promotionId: promotion.ID,
            userId: promotion.CreatedBy,
            action: 'PROMOTION_COMPLETED',
            entityType: 'Promotion',
            entityId: promotion.ID,
            details: { status }
          }
        )
      }
    }
  } catch (error) {
    console.error('Promotion worker error:', error)
  } finally {
    running = false
  }
}

function startPromotionWorker() {
  setInterval(
    processQueuedPromotions,
    5000
  )

  processQueuedPromotions()
}

module.exports = {
  startPromotionWorker,
  processQueuedPromotions
}
