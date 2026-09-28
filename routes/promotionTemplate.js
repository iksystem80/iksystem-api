const express = require('express')
const multer = require('multer')
const router = express.Router()

const { pool } = require('../db')
const { uploadPromotionImage } = require('../services/cloudinaryPromotion')
const { writePromotionAudit } = require('../services/promotionAudit')
const { requirePermission } = require('../middleware/auth')

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype?.startsWith('image/')) {
      return callback(
        new Error('Only image files are allowed.')
      )
    }

    callback(null, true)
  }
})

function userId(req) {
  return Number(req.authUser?.id || 0)
}

function companyId(req) {
  return Number(req.authUser?.companyId || 0)
}

router.get('/list', requirePermission('promotion.template.read'), async (req, res) => {
  try {
    const cid = companyId(req)
    const generatedOnly =
      String(req.query.generatedOnly || '') === 'true'

    const values = [cid]

    let generatedClause = ''

    if (generatedOnly) {
      generatedClause =
        `AND COALESCE("FinalImageUrl",'') <> ''`
    }

    const result = await pool.query(
      `
      SELECT
        "ID" AS id,
        "CompanyId" AS companyid,
        "Name" AS name,
        "Description" AS description,
        "TemplateType" AS templatetype,
        "SourceTemplateId" AS sourcetemplateid,
        "PreviewImageUrl" AS previewimageurl,
        "FinalImageUrl" AS finalimageurl,
        "Width" AS width,
        "Height" AS height,
        "IsSystemTemplate" AS issystemtemplate,
        "CreatedBy" AS createdby,
        "CreatedAt" AS createdat,
        "UpdatedAt" AS updatedat
      FROM "PromotionTemplates"
      WHERE
        COALESCE("IsDeleted", false) = false
        AND "IsActive" = true
        AND
        (
          "IsSystemTemplate" = true
          OR "CompanyId" = $1
        )
        ${generatedClause}
      ORDER BY
        "IsSystemTemplate" DESC,
        "CreatedAt" DESC
      `,
      values
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
      message: 'Unable to load promotion templates.'
    })
  }
})

router.get('/detail', requirePermission('promotion.template.read'), async (req, res) => {
  try {
    const cid = companyId(req)
    const id = Number(req.query.id)

    const result = await pool.query(
      `
      SELECT
        "ID" AS id,
        "CompanyId" AS companyid,
        "Name" AS name,
        "Description" AS description,
        "DesignJson" AS designjson,
        "PreviewImageUrl" AS previewimageurl,
        "FinalImageUrl" AS finalimageurl,
        "Width" AS width,
        "Height" AS height,
        "IsSystemTemplate" AS issystemtemplate
      FROM "PromotionTemplates"
      WHERE
        "ID" = $1
        AND COALESCE("IsDeleted", false) = false
        AND
        (
          "IsSystemTemplate" = true
          OR "CompanyId" = $2
        )
      LIMIT 1
      `,
      [id, cid]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: 40400,
        message: 'Template not found.'
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
      message: 'Unable to load template.'
    })
  }
})

router.post('/create', requirePermission('promotion.template.create'), async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)

    const {
      name,
      description,
      designjson,
      width = 1080,
      height = 1350
    } = req.body

    const result = await pool.query(
      `
      INSERT INTO "PromotionTemplates"
      (
        "CompanyId",
        "Name",
        "Description",
        "DesignJson",
        "Width",
        "Height",
        "IsSystemTemplate",
        "CreatedBy"
      )
      VALUES ($1,$2,$3,$4,$5,$6,false,$7)
      RETURNING
        "ID" AS id
      `,
      [
        cid,
        name,
        description || null,
        designjson ? JSON.stringify(designjson) : null,
        Number(width),
        Number(height),
        uid
      ]
    )

    const id = result.rows[0].id

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        templateId: id,
        userId: uid,
        action: 'TEMPLATE_CREATED',
        entityType: 'PromotionTemplate',
        entityId: id,
        details: { name }
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
      message: 'Unable to create template.'
    })
  }
})

router.put('/update', requirePermission('promotion.template.update'), async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)

    const {
      id,
      name,
      description,
      designjson,
      width,
      height
    } = req.body

    const result = await pool.query(
      `
      UPDATE "PromotionTemplates"
      SET
        "Name" = $3,
        "Description" = $4,
        "DesignJson" = $5,
        "Width" = $6,
        "Height" = $7,
        "UpdatedBy" = $8,
        "UpdatedAt" = NOW()
      WHERE
        "ID" = $1
        AND "CompanyId" = $2
        AND "IsSystemTemplate" = false
        AND COALESCE("IsDeleted", false) = false
      RETURNING "ID" AS id
      `,
      [
        Number(id),
        cid,
        name,
        description || null,
        designjson ? JSON.stringify(designjson) : null,
        Number(width || 1080),
        Number(height || 1350),
        uid
      ]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: 40400,
        message: 'Editable template not found.'
      })
    }

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        templateId: Number(id),
        userId: uid,
        action: 'TEMPLATE_UPDATED',
        entityType: 'PromotionTemplate',
        entityId: Number(id)
      }
    )

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
      message: 'Unable to update template.'
    })
  }
})

router.post('/duplicate', requirePermission('promotion.template.create'), async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)
    const templateId = Number(req.body.templateid)

    const sourceResult = await pool.query(
      `
      SELECT *
      FROM "PromotionTemplates"
      WHERE
        "ID" = $1
        AND COALESCE("IsDeleted", false) = false
        AND
        (
          "IsSystemTemplate" = true
          OR "CompanyId" = $2
        )
      LIMIT 1
      `,
      [templateId, cid]
    )

    if (!sourceResult.rows.length) {
      return res.status(404).json({
        success: false,
        code: 40400,
        message: 'Source template not found.'
      })
    }

    const source = sourceResult.rows[0]

    const copyResult = await pool.query(
      `
      INSERT INTO "PromotionTemplates"
      (
        "CompanyId",
        "Name",
        "Description",
        "TemplateType",
        "SourceTemplateId",
        "DesignJson",
        "PreviewImageUrl",
        "FinalImageUrl",
        "Width",
        "Height",
        "IsSystemTemplate",
        "CreatedBy"
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11)
      RETURNING "ID" AS id
      `,
      [
        cid,
        `${source.Name} Copy`,
        source.Description,
        source.TemplateType,
        source.ID,
        source.DesignJson,
        source.PreviewImageUrl,
        source.FinalImageUrl,
        source.Width,
        source.Height,
        uid
      ]
    )

    const id = copyResult.rows[0].id

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        templateId: id,
        userId: uid,
        action: 'TEMPLATE_DUPLICATED',
        entityType: 'PromotionTemplate',
        entityId: id,
        details: {
          sourceTemplateId: source.ID
        }
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
      message: 'Unable to duplicate template.'
    })
  }
})

router.delete('/delete', requirePermission('promotion.template.delete'), async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)
    const id = Number(req.query.id)

    const result = await pool.query(
      `
      UPDATE "PromotionTemplates"
      SET
        "IsDeleted" = true,
        "UpdatedBy" = $3,
        "UpdatedAt" = NOW()
      WHERE
        "ID" = $1
        AND "CompanyId" = $2
        AND "IsSystemTemplate" = false
      RETURNING "ID" AS id
      `,
      [id, cid, uid]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: 40400,
        message: 'Template not found.'
      })
    }

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        templateId: id,
        userId: uid,
        action: 'TEMPLATE_DELETED',
        entityType: 'PromotionTemplate',
        entityId: id
      }
    )

    return res.json({
      success: true,
      code: 20000
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      code: 50000,
      message: 'Unable to delete template.'
    })
  }
})


// ============================================================
// UPLOAD POSTER ASSET
// ============================================================

router.post(
  '/upload-asset',
  requirePermission('promotion.template.update'),
  assetUpload.single('file'),
  async (req, res) => {
    try {
      const cid = companyId(req)
      const uid = userId(req)

      if (!req.file) {
        return res.status(400).json({
          success: false,
          code: 40000,
          message: 'Please select an image to upload.'
        })
      }

      const base64Image =
        `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`

      const imageUrl =
        await uploadPromotionImage(base64Image)

      await writePromotionAudit(
        pool,
        {
          companyId: cid,
          userId: uid,
          action: 'TEMPLATE_ASSET_UPLOADED',
          entityType: 'PromotionTemplateAsset',
          details: {
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            imageUrl
          }
        }
      )

      return res.json({
        success: true,
        code: 20000,
        data: {
          url: imageUrl
        }
      })
    } catch (error) {
      console.error(
        'Promotion asset upload error:',
        error
      )

      return res.status(500).json({
        success: false,
        code: 50000,
        message:
          error.message ||
          'Unable to upload promotion image.'
      })
    }
  }
)

router.post('/generate', requirePermission('promotion.template.update'), async (req, res) => {
  try {
    const cid = companyId(req)
    const uid = userId(req)

    const {
      id,
      imagebase64,
      designjson
    } = req.body

    const imageUrl =
      await uploadPromotionImage(imagebase64)

    const result = await pool.query(
      `
      UPDATE "PromotionTemplates"
      SET
        "DesignJson" = $3,
        "PreviewImageUrl" = $4,
        "FinalImageUrl" = $4,
        "UpdatedBy" = $5,
        "UpdatedAt" = NOW()
      WHERE
        "ID" = $1
        AND "CompanyId" = $2
        AND "IsSystemTemplate" = false
      RETURNING
        "ID" AS id,
        "FinalImageUrl" AS finalimageurl
      `,
      [
        Number(id),
        cid,
        designjson ? JSON.stringify(designjson) : null,
        imageUrl,
        uid
      ]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: 40400,
        message: 'Editable template not found.'
      })
    }

    await writePromotionAudit(
      pool,
      {
        companyId: cid,
        templateId: Number(id),
        userId: uid,
        action: 'IMAGE_GENERATED',
        entityType: 'PromotionTemplate',
        entityId: Number(id),
        details: {
          finalImageUrl: imageUrl
        }
      }
    )

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
      message: 'Unable to generate final image.'
    })
  }
})

module.exports = router
