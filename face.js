const path = require('path')
const sharp = require('sharp')

const tf = require('@tensorflow/tfjs')
const wasm = require('@tensorflow/tfjs-backend-wasm')

const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js')

let initialized = false

async function initFaceApi() {
  if (initialized) return

  const wasmDir = path.resolve(
    process.cwd(),
    'node_modules',
    '@tensorflow',
    'tfjs-backend-wasm',
    'dist'
  )

  wasm.setWasmPaths({
    'tfjs-backend-wasm.wasm': path.join(wasmDir, 'tfjs-backend-wasm.wasm'),

    'tfjs-backend-wasm-simd.wasm': path.join(
      wasmDir,
      'tfjs-backend-wasm-simd.wasm'
    ),

    'tfjs-backend-wasm-threaded-simd.wasm': path.join(
      wasmDir,
      'tfjs-backend-wasm-threaded-simd.wasm'
    ),
  })

  console.log('WASM directory:', wasmDir)

  await tf.setBackend('wasm')
  await tf.ready()

  console.log('TensorFlow backend before loading models:', tf.getBackend())

  const modelPath = path.resolve(process.cwd(), 'models')

  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath)

  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath)

  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)

  initialized = true

  console.log('Face recognition models loaded')
  console.log('TensorFlow backend:', tf.getBackend())
}

async function bufferToTensor(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true,
    })

  return tf.tensor3d(
    new Uint8Array(data),
    [info.height, info.width, info.channels],
    'int32'
  )
}

async function createFaceEmbedding(imageBuffer) {
    await initFaceApi()

    const tensor = await bufferToTensor(imageBuffer)

    try {
        const detections = await faceapi
            .detectAllFaces(
                tensor,
                new faceapi.TinyFaceDetectorOptions({
                    inputSize: 416,
                    scoreThreshold: 0.5,
                })
            )
            .withFaceLandmarks()
            .withFaceDescriptors()

        if (detections.length === 0) {
            throw new FaceDetectionError(
                'No face detected.',
                'NO_FACE'
            )
        }

        if (detections.length > 1) {
            throw new FaceDetectionError(
                'More than one face detected.',
                'MULTIPLE_FACES'
            )
        }

        const descriptor = detections[0].descriptor

        return Array.from(descriptor)
    } finally {
        tensor.dispose()
    }
}

class FaceDetectionError extends Error {
    constructor(message, code) {
        super(message)
        this.name = 'FaceDetectionError'
        this.code = code
    }
}

module.exports = {
    initFaceApi,
    createFaceEmbedding,
    FaceDetectionError
}
