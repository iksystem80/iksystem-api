const express = require('express')
const router = express.Router()

const { pool } = require('../db')
const { writePromotionAudit } = require('../services/promotionAudit')
const { requirePermission } = require('../middleware/auth')

function userId(req) {
  return Number(req.authUser?.id || 0)
}

function companyId(req) {
  return Number(req.authUser?.companyId || 0)
}

function locationId(req) {
  return Number(req.authUser?.locationId || 0)
}

router.get(
  '/list',
  requirePermission('promotion.read'),
  async (req, res) => {
  try {
    const cid = companyId(req)

    const result = await pool.query(
      `
      SELECT
        p."ID" AS id,
        p."Name" AS name,
        p."Channel" AS channel,
        p."Status" AS status,
        p."CreatedAt" AS createdat,
        COUNT(pr."ID")::integer AS recipientcount
      FROM "Promotions" p
      LEFT JOIN "PromotionRecipients" pr
        ON pr."PromotionId" = p."ID"
      WHERE
        p."CompanyId" = $1
        AND COALESCE(p."IsDeleted", false) = false
      GROUP BY
        p."ID",
        p."Name",
        p."Channel",
        p."Status",
        p."CreatedAt"
      ORDER BY
        p."CreatedAt" DESC
      `,
      [cid]
    )

    return res.json({
      success: true,
      code: 20000,
      data: result.rows
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to load promotions.'
    })
  }
  }
)

router.get(
  '/detail',
  requirePermission('promotion.read'),
  async (req, res) => {
  try {
    const cid = companyId(req)
    const id = Number(req.query.id)

    const result = await pool.query(
      `
      SELECT
        "ID" AS id,
        "TemplateId" AS templateid,
        "LocationId" AS locationid,
        "Name" AS name,
        "MessageText" AS messagetext,
        "Channel" AS channel,
        "FinalImageUrl" AS finalimageurl,
        "Status" AS status,
        "CreatedAt" AS createdat,
        "StartedAt" AS startedat,
        "CompletedAt" AS completedat
      FROM "Promotions"
      WHERE
        "ID" = $1
        AND "CompanyId" = $2
        AND COALESCE("IsDeleted", false) = false
      LIMIT 1
      `,
      [id, cid]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: 40400,
        message: 'Promotion not found.'
      })
    }

    return res.json({
      success: true,
      code: 20000,
      data: result.rows[0]
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to load promotion.'
    })
  }
  }
)

router.post(
  '/create',
  requirePermission('promotion.create'),
  async (req, res) => {
  try {
    const cid = companyId(req)
    const lid = locationId(req)
    const uid = userId(req)

    const {
      templateid,
      name,
      messagetext,
      channel,
      finalimageurl
    } = req.body

    const result = await pool.query(
      `
      INSERT INTO "Promotions"
      (
        "CompanyId",
        "LocationId",
        "TemplateId",
        "Name",
        "MessageText",
        "Channel",
        "FinalImageUrl",
        "Status",
        "CreatedBy"
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,'Draft',$8)
      RETURNING
        "ID" AS id
      `,
      [
        cid,
        lid || null,
        templateid || null,
        name,
        messagetext || null,
        channel || null,
        finalimageurl || null,
        uid
      ]
    )

    const id = result.rows[0].id

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        promotionId: id,
        templateId: templateid || null,
        userId: uid,
        action: 'PROMOTION_CREATED',
        entityType: 'Promotion',
        entityId: id,
        details: { channel }
      }
    )

    return res.json({
      success: true,
      code: 20000,
      data: { id }
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to create promotion.'
    })
  }
  }
)

router.put(
  '/update',
  requirePermission('promotion.update'),
  async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)

    const {
      id,
      templateid,
      name,
      messagetext,
      channel,
      finalimageurl
    } = req.body

    const result = await pool.query(
      `
      UPDATE "Promotions"
      SET
        "TemplateId" = $3,
        "Name" = $4,
        "MessageText" = $5,
        "Channel" = $6,
        "FinalImageUrl" = $7,
        "UpdatedBy" = $8,
        "UpdatedAt" = NOW()
      WHERE
        "ID" = $1
        AND "CompanyId" = $2
        AND "Status" = 'Draft'
      RETURNING "ID" AS id
      `,
      [
        Number(id),
        cid,
        templateid || null,
        name,
        messagetext || null,
        channel || null,
        finalimageurl || null,
        uid
      ]
    )

    if (!result.rows.length) {
      return res.status(400).json({
        success: false,
        code: 40000,
        message: 'Only draft promotions can be updated.'
      })
    }

    return res.json({
      success: true,
      code: 20000,
      data: result.rows[0]
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to update promotion.'
    })
  }
  }
)

router.post(
  '/recipients',
  requirePermission('promotion.update'),
  async (req, res) => {
    const client =
      await pool.connect()

    try {
      const cid =
        companyId(req)

      const uid =
        userId(req)

      const {
        promotionid,
        customerids = []
      } = req.body

      const promotionId =
        Number(promotionid)

      const requestedCustomerIds =
        [
          ...new Set(
            (Array.isArray(customerids)
              ? customerids
              : []
            )
              .map(value => Number(value))
              .filter(value =>
                Number.isInteger(value) &&
                value > 0
              )
          )
        ]

      await client.query('BEGIN')

      const promotionResult =
        await client.query(
          `
            SELECT
              "ID",
              "LocationId",
              "Channel"

            FROM "Promotions"

            WHERE
              "ID" = $1
              AND "CompanyId" = $2
              AND "Status" = 'Draft'

            FOR UPDATE
          `,
          [
            promotionId,
            cid
          ]
        )

      if (!promotionResult.rows.length) {
        await client.query('ROLLBACK')

        return res.status(404).json({
          success: false,
          code: 40400,
          message:
            'Draft promotion not found.'
        })
      }

      const promotion =
        promotionResult.rows[0]

      await client.query(
        `
          DELETE FROM "PromotionRecipients"
          WHERE "PromotionId" = $1
        `,
        [promotionId]
      )

      let eligibleCustomers = []

      if (requestedCustomerIds.length) {
        const customerResult =
          await client.query(
            `
              SELECT
                c."ID" AS id,
                c."Firstname" AS firstname,
                c."Lastname" AS lastname,
                c."Phone" AS phone

              FROM "Customer" c

              WHERE
                c."ID" = ANY($1::int[])
                AND c."locationid" = $2
                AND c."IsActive" = true
                AND COALESCE(
                  c."IsBlacklist",
                  false
                ) = false
                AND NULLIF(
                  BTRIM(
                    COALESCE(
                      c."Phone",
                      ''
                    )
                  ),
                  ''
                ) IS NOT NULL
            `,
            [
              requestedCustomerIds,
              promotion.LocationId
            ]
          )

        eligibleCustomers =
          customerResult.rows

        if (
          eligibleCustomers.length !==
          requestedCustomerIds.length
        ) {
          await client.query('ROLLBACK')

          return res.status(400).json({
            success: false,
            code: 40000,
            message:
              'One or more selected customers are no longer eligible for this promotion.'
          })
        }

        for (
          const customer
          of eligibleCustomers
        ) {
          const customerName =
            `${customer.firstname || ''} ${customer.lastname || ''}`
              .trim()

          await client.query(
            `
              INSERT INTO "PromotionRecipients"
              (
                "PromotionId",
                "CustomerId",
                "CustomerName",
                "Phone",
                "Channel",
                "Status"
              )
              VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                'Pending'
              )
            `,
            [
              promotionId,
              customer.id,
              customerName || null,
              customer.phone,
              promotion.Channel
            ]
          )
        }
      }

      await writePromotionAudit(
        client,
        {
          companyId: cid,
          promotionId,
          userId: uid,
          action: 'CUSTOMERS_SELECTED',
          entityType: 'Promotion',
          entityId: promotionId,
          details: {
            customerCount:
              eligibleCustomers.length
          }
        }
      )

      await client.query('COMMIT')

      return res.json({
        success: true,
        code: 20000,
        data: {
          count:
            eligibleCustomers.length
        }
      })
    } catch (error) {
      await client.query('ROLLBACK')

      console.error(error)

      return res.status(500).json({
        success: false,
        code: 50000,
        message:
          'Unable to save promotion recipients.'
      })
    } finally {
      client.release()
    }
  }
)

router.get(
  '/recipients',
  requirePermission('promotion.read'),
  async (req, res) => {
  try {
    const cid = companyId(req)
    const id = Number(req.query.id)

    const result = await pool.query(
      `
      SELECT
        pr."ID" AS id,
        pr."CustomerId" AS customerid,
        pr."CustomerName" AS customername,
        pr."Phone" AS phone,
        pr."Channel" AS channel,
        pr."Status" AS status,
        pr."TwilioStatus" AS twiliostatus,
        pr."TwilioErrorCode" AS twilioerrorcode,
        pr."TwilioErrorMessage" AS twilioerrormessage,
        pr."SentAt" AS sentat,
        pr."DeliveredAt" AS deliveredat,
        pr."FailedAt" AS failedat
      FROM "PromotionRecipients" pr
      INNER JOIN "Promotions" p
        ON p."ID" = pr."PromotionId"
      WHERE
        pr."PromotionId" = $1
        AND p."CompanyId" = $2
      ORDER BY pr."ID" ASC
      `,
      [id, cid]
    )

    return res.json({
      success: true,
      code: 20000,
      data: result.rows
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to load recipients.'
    })
  }
  }
)

router.post(
  '/send',
  requirePermission('promotion.send'),
  async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)
    const id = Number(req.body.id)

    const recipientCountResult = await pool.query(
      `
      SELECT COUNT(*)::integer AS count
      FROM "PromotionRecipients" pr
      INNER JOIN "Promotions" p
        ON p."ID" = pr."PromotionId"
      WHERE
        pr."PromotionId" = $1
        AND p."CompanyId" = $2
      `,
      [id, cid]
    )

    if (recipientCountResult.rows[0].count === 0) {
      return res.status(400).json({
        success: false,
        code: 40000,
        message: 'Promotion has no recipients.'
      })
    }

    const result = await pool.query(
      `
      UPDATE "Promotions"
      SET
        "Status" = 'Queued',
        "UpdatedBy" = $3,
        "UpdatedAt" = NOW()
      WHERE
        "ID" = $1
        AND "CompanyId" = $2
        AND "Status" = 'Draft'
      RETURNING *
      `,
      [id, cid, uid]
    )

    if (!result.rows.length) {
      return res.status(400).json({
        success: false,
        code: 40000,
        message: 'Only draft promotions can be sent.'
      })
    }

    await pool.query(
      `
      UPDATE "PromotionRecipients"
      SET
        "Status" = 'Queued',
        "QueuedAt" = NOW(),
        "UpdatedAt" = NOW()
      WHERE "PromotionId" = $1
      `,
      [id]
    )

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        promotionId: id,
        userId: uid,
        action: 'PROMOTION_SEND_STARTED',
        entityType: 'Promotion',
        entityId: id
      }
    )

    return res.json({
      success: true,
      code: 20000,
      data: {
        id,
        status: 'Queued'
      }
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to queue promotion.'
    })
  }
  }
)

router.post('/twilio/status', async (req, res) => {
  try {
    const sid =
      req.body.MessageSid ||
      req.body.SmsSid

    const status =
      req.body.MessageStatus ||
      req.body.SmsStatus

    const errorCode =
      req.body.ErrorCode || null

    const errorMessage =
      req.body.ErrorMessage || null

    const recipientResult = await pool.query(
      `
      SELECT *
      FROM "PromotionRecipients"
      WHERE "TwilioMessageSid" = $1
      LIMIT 1
      `,
      [sid]
    )

    if (!recipientResult.rows.length) {
      return res.sendStatus(204)
    }

    const recipient = recipientResult.rows[0]

    const normalizedStatus =
      status === 'delivered'
        ? 'Delivered'
        : status === 'failed'
          ? 'Failed'
          : status === 'undelivered'
            ? 'Undelivered'
            : status === 'sent'
              ? 'Sent'
              : recipient.Status

    await pool.query(
      `
      UPDATE "PromotionRecipients"
      SET
        "Status" = $2,
        "TwilioStatus" = $3,
        "TwilioErrorCode" = $4,
        "TwilioErrorMessage" = $5,
        "DeliveredAt" =
          CASE
            WHEN $3 = 'delivered'
            THEN NOW()
            ELSE "DeliveredAt"
          END,
        "FailedAt" =
          CASE
            WHEN $3 IN ('failed','undelivered')
            THEN NOW()
            ELSE "FailedAt"
          END,
        "UpdatedAt" = NOW()
      WHERE "ID" = $1
      `,
      [
        recipient.ID,
        normalizedStatus,
        status,
        errorCode,
        errorMessage
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
        "ErrorCode",
        "ErrorMessage",
        "RawPayload"
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        recipient.PromotionId,
        recipient.ID,
        recipient.CustomerId,
        sid,
        recipient.Channel,
        status,
        errorCode,
        errorMessage,
        JSON.stringify(req.body)
      ]
    )

    return res.sendStatus(204)
  } catch (error) {
    console.error('Twilio callback error:', error)
    return res.sendStatus(204)
  }
})

router.get(
  '/logs',
  requirePermission('promotion.logs.read'),
  async (req, res) => {
  try {
    const cid = companyId(req)
    const id = Number(req.query.id)

    const auditResult = await pool.query(
      `
      SELECT
        a."ID" AS id,
        a."Action" AS action,
        a."Details" AS details,
        a."CreatedAt" AS createdat
      FROM "PromotionAuditLogs" a
      INNER JOIN "Promotions" p
        ON p."ID" = a."PromotionId"
      WHERE
        a."PromotionId" = $1
        AND p."CompanyId" = $2
      ORDER BY
        a."CreatedAt" DESC
      `,
      [id, cid]
    )

    const deliveryResult = await pool.query(
      `
      SELECT
        l."ID" AS id,
        l."PromotionRecipientId" AS promotionrecipientid,
        l."TwilioMessageSid" AS twiliomessagesid,
        l."Status" AS status,
        l."ErrorCode" AS errorcode,
        l."ErrorMessage" AS errormessage,
        l."CreatedAt" AS createdat
      FROM "PromotionDeliveryLogs" l
      INNER JOIN "Promotions" p
        ON p."ID" = l."PromotionId"
      WHERE
        l."PromotionId" = $1
        AND p."CompanyId" = $2
      ORDER BY
        l."CreatedAt" DESC
      `,
      [id, cid]
    )

    return res.json({
      success: true,
      code: 20000,
      data: {
        audit: auditResult.rows,
        delivery: deliveryResult.rows
      }
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to load promotion logs.'
    })
  }
  }
)

module.exports = router
