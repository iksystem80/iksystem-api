const cloudinary = require('cloudinary').v2

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

async function uploadPromotionImage(base64Image) {
  if (!base64Image) {
    throw new Error('Image data is required.')
  }

  const result = await cloudinary.uploader.upload(
    base64Image,
    {
      folder: 'promotions',
      resource_type: 'image'
    }
  )

  return result.secure_url
}

module.exports = {
  uploadPromotionImage
}
