const twilio = require('twilio')
const { pool } = require('../db')
const { writePromotionAudit } = require('./promotionAudit')

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
)

let running = false

function buildStatusCallback() {
  // Must be identical to the URL used by the webhook signature validator in
  // routes/promotion.js. Do not reconstruct it from a different base URL.
  return (process.env.TWILIO_PROMOTION_CALLBACK_URL || '').trim()
}

async function processQueuedPromotions() {
  if (running) {
    return
  }

  running = true

  try {
    const callbackUrl = buildStatusCallback()
    if (!callbackUrl) {
      // Keep queued recipients untouched until the callback can be verified.
      return
    }
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
        // Atomically claim the recipient before calling Twilio. A second
        // worker/process can read the same queued row, but cannot claim it.
        // The Sending state is deliberately not auto-retried after a crash:
        // an external send may have succeeded before its SID was saved.
        const claimed = await pool.query(`
          UPDATE "PromotionRecipients"
          SET "Status" = 'Sending', "UpdatedAt" = NOW()
          WHERE "ID" = $1 AND "PromotionId" = $2
            AND "Status" IN ('Pending', 'Queued')
          RETURNING "ID"
        `, [recipient.ID, promotion.ID])
        if (!claimed.rowCount) continue

        let message
        try {
          const messageOptions = {
            body: promotion.MessageText || '',
            to:
              recipient.Channel === 'WhatsApp'
                ? `whatsapp:${recipient.Phone}`
                : recipient.Phone,
            statusCallback: callbackUrl
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

          message = await client.messages.create(messageOptions)
        } catch (error) {
          // No automatic retry: an interrupted Twilio request may have
          // been delivered even when the client did not receive a response.
          // Keep transport-ambiguous errors for manual reconciliation.
          const isDefiniteRejection = Number(error.status) >= 400 && Number(error.status) < 500
          await pool.query(`
            UPDATE "PromotionRecipients"
            SET "Status" = $2,
                "TwilioStatus" = $3,
                "TwilioErrorCode" = $4,
                "TwilioErrorMessage" = $5,
                "FailedAt" = CASE WHEN $2 = 'Failed' THEN NOW() ELSE "FailedAt" END,
                "UpdatedAt" = NOW()
            WHERE "ID" = $1 AND "Status" = 'Sending'
          `, [
            recipient.ID,
            isDefiniteRejection ? 'Failed' : 'NeedsReview',
            isDefiniteRejection ? 'failed' : 'unknown',
            error.code ? String(error.code) : null,
            error.message || 'Twilio send result is uncertain.'
          ])
          continue
        }

        // Database/log failures after Twilio accepted a message must not
        // turn the recipient back into a retryable state.
        await pool.query(
          `
            UPDATE "PromotionRecipients"
            SET
              "Status" = 'Sent',
              "TwilioMessageSid" = $2,
              "TwilioStatus" = $3,
              "SentAt" = NOW(),
              "UpdatedAt" = NOW()
            WHERE "ID" = $1 AND "Status" = 'Sending'
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
      }

      const remainingResult = await pool.query(
        `
        SELECT COUNT(*)::integer AS remaining
        FROM "PromotionRecipients"
        WHERE
          "PromotionId" = $1
          AND "Status" IN ('Pending', 'Queued', 'Sending', 'NeedsReview')
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

        const completed = await pool.query(
          `
          UPDATE "Promotions"
          SET
            "Status" = $2,
            "CompletedAt" = NOW()
          WHERE "ID" = $1
            AND "Status" IN ('Queued', 'Processing')
            AND NOT EXISTS (
              SELECT 1 FROM "PromotionRecipients"
              WHERE "PromotionId" = $1
                AND "Status" IN ('Pending', 'Queued', 'Sending', 'NeedsReview')
            )
          RETURNING "ID"
          `,
          [promotion.ID, status]
        )

        if (completed.rowCount) await writePromotionAudit(
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
