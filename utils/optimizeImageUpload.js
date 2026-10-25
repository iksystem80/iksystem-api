const sharp = require('sharp')

const MAX_SIDE = 1600
const JPEG_QUALITY = 82

// Cloudinary-only optimization. Never mutate the original request buffer:
// face embeddings and bonus image hashes must continue using original bytes.
async function optimizeImageUpload(originalBuffer) {
  if (!Buffer.isBuffer(originalBuffer) || !originalBuffer.length) {
    throw new TypeError('An image buffer is required.')
  }

  const metadata = await sharp(originalBuffer, { limitInputPixels: 40_000_000 }).metadata()

  // Keep animated images intact; flattening one frame would change their content.
  if ((metadata.pages || 1) > 1) return originalBuffer

  const transformer = sharp(originalBuffer, { limitInputPixels: 40_000_000 })
    .rotate() // Honor EXIF camera orientation.
    .resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true
    })

  // Preserve transparency, including profile pictures with transparent edges.
  let optimized
  try {
    optimized = metadata.hasAlpha
      ? await transformer.webp({ quality: JPEG_QUALITY, effort: 4 }).toBuffer()
      : await transformer.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  } catch (_) {
    // Keep an already-validated supported image if its encoder is unavailable.
    return originalBuffer
  }

  // Already-small/efficient images are uploaded unchanged.
  return optimized.length < originalBuffer.length ? optimized : originalBuffer
}

module.exports = { optimizeImageUpload }
