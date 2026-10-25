const sharp = require('sharp')

const ALLOWED_FORMATS = new Set([
  'jpeg', 'png', 'webp', 'gif', 'heif', 'avif', 'tiff'
])

// Runs after multer.memoryStorage() and before the route's business logic.
// Checks image content, without resizing, recompressing, or changing buffers.
async function validateImageUpload(req, res, next) {
  if (!req.file) return next() // Existing route handles a missing image.

  try {
    const buffer = req.file.buffer
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) {
      throw new Error('Invalid image size')
    }

    const image = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata()
    if (!ALLOWED_FORMATS.has(image.format) ||
        !image.width || !image.height ||
        image.width > 10000 || image.height > 10000 ||
        image.width * image.height > 40_000_000 ||
        (image.pages || 1) > 50) {
      throw new Error('Unsupported image')
    }

    return next()
  } catch (_) {
    return res.status(400).json({
      success: false,
      code: 40000,
      message: 'Invalid image file. Please upload a supported photo.'
    })
  }
}

module.exports = { validateImageUpload }
