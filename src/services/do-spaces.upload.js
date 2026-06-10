const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { uploadImageToSpaces } = require('./do-spaces.service');
const ApiError = require('../utils/api-error');

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_CHAT_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/3gpp',
]);

const CHAT_MEDIA_MAX_SIZE_BYTES = 50 * 1024 * 1024;

function resolveChatMediaType(mimetype) {
  if (ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) return 'image';
  if (ALLOWED_CHAT_VIDEO_MIME_TYPES.has(mimetype)) return 'video';
  return null;
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(new ApiError(400, 'Only JPG, PNG, WEBP, and GIF images are allowed.'));
    } else {
      cb(null, true);
    }
  },
});

const chatMediaUpload = multer({
  storage,
  limits: { files: 1, fileSize: CHAT_MEDIA_MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!resolveChatMediaType(file.mimetype)) {
      cb(
        new ApiError(
          400,
          'Only JPG, PNG, WEBP, GIF images and MP4, MOV, WEBM, MKV, 3GP videos are allowed in chat.'
        )
      );
    } else {
      cb(null, true);
    }
  },
});

function buildSpacesObjectKey(folder, originalName) {
  const ext = path.extname(originalName) || '.jpg';
  const safeFolder = folder.replace(/^\/+|\/+$/g, '');
  return `${safeFolder}/${Date.now()}-${crypto.randomUUID()}${ext}`;
}

async function uploadFileToSpaces(file, folder) {
  const fileName = buildSpacesObjectKey(folder, file.originalname);
  const result = await uploadImageToSpaces(file.buffer, fileName, file.mimetype);
  return {
    fileName,
    url: result.Location,
    contentType: file.mimetype,
    size: file.size,
  };
}

async function uploadImagesToSpacesHandler(req, res) {
  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, 'At least one image is required.');
  }

  const uploaded = await Promise.all(
    req.files.map((file) => uploadFileToSpaces(file, 'listings'))
  );

  res.status(201).json({
    success: true,
    message: 'Images uploaded to DigitalOcean Spaces.',
    data: { images: uploaded, photos: uploaded.map((img) => img.url) },
  });
}

module.exports = {
  upload,
  chatMediaUpload,
  uploadImagesToSpacesHandler,
  uploadFileToSpaces,
  resolveChatMediaType,
};
