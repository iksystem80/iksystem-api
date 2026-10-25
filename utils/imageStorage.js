const cloudinary = require('../config/cloudinary')

// The only module that talks to the current image-storage provider.
// Callers handle image validation and optional optimization first.
// A future VM backend can replace these two functions without changing routes.
const provider = (process.env.IMAGE_STORAGE_PROVIDER || 'cloudinary').trim().toLowerCase()
if (provider !== 'cloudinary') {
  throw new Error(`Unsupported IMAGE_STORAGE_PROVIDER: ${provider}`)
}

function validFolder(folder) {
  if (typeof folder !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(folder)) {
    throw new TypeError('A valid image-storage folder is required.')
  }
  return folder
}

function uploadBuffer(buffer, { folder } = {}) {
  validFolder(folder)
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return Promise.reject(new TypeError('Image buffer is required.'))
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => error ? reject(error) : resolve(result)
    )
    stream.on('error', reject)
    stream.end(buffer)
  })
}

function uploadDataUrl(dataUrl, { folder } = {}) {
  validFolder(folder)
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return Promise.reject(new TypeError('Image data URL is required.'))
  }

  return cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image'
  })
}

module.exports = { uploadBuffer, uploadDataUrl }
