const { uploadDataUrl } = require('../utils/imageStorage')
const sharp = require('sharp')

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp'])
const MIME_FORMATS = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp'
}

function invalidImage() {
  return Object.assign(new Error('Invalid promotion image.'), { status: 400 })
}

async function uploadPromotionImage(base64Image) {
  if (typeof base64Image !== 'string') throw invalidImage()

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(base64Image)
  if (!match) throw invalidImage()

  const encoded = match[2]
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) throw invalidImage()
  const buffer = Buffer.from(encoded, 'base64')
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES ||
      buffer.toString('base64') !== encoded) throw invalidImage()

  let metadata
  try {
    metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata()
  } catch (_) {
    throw invalidImage()
  }

  if (!ALLOWED_FORMATS.has(metadata.format) ||
      metadata.format !== MIME_FORMATS[match[1]] ||
      !metadata.width || !metadata.height ||
      metadata.width > 10000 || metadata.height > 10000 ||
      metadata.width * metadata.height > 40_000_000) throw invalidImage()

  const result = await uploadDataUrl(base64Image, { folder: 'promotions' })

  return result.secure_url
}

module.exports = { uploadPromotionImage }
