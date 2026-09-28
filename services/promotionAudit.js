async function writePromotionAudit(
  pool,
  {
    companyId = null,
    promotionId = null,
    templateId = null,
    userId = null,
    action,
    entityType = null,
    entityId = null,
    details = null
  }
) {
  await pool.query(
    `
    INSERT INTO "PromotionAuditLogs"
    (
      "CompanyId",
      "PromotionId",
      "TemplateId",
      "UserId",
      "Action",
      "EntityType",
      "EntityId",
      "Details"
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      companyId,
      promotionId,
      templateId,
      userId,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null
    ]
  )
}

module.exports = {
  writePromotionAudit
}
