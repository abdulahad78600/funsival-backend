const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');

const { apiBaseUrl } = require('../../config/env');
const DraftListing = require('../../models/draft-listing.model');
const Listing = require('../../models/listing.model');
const ApiError = require('../../utils/api-error');

const LISTING_IMAGES_ROUTE = '/uploads/listings';
const LISTING_IMAGES_DIRECTORY = path.join(process.cwd(), 'uploads', 'listings');
const MAX_LISTING_IMAGE_COUNT = 10;
const MAX_LISTING_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MIME_TYPE_EXTENSIONS = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

async function ensureListingImagesDirectory() {
  await fs.mkdir(LISTING_IMAGES_DIRECTORY, { recursive: true });
}

function normalizeListingPhotoReference(value) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) return '';

  if (normalizedValue.startsWith(`${LISTING_IMAGES_ROUTE}/`)) {
    return normalizedValue;
  }

  if (normalizedValue.startsWith('uploads/listings/')) {
    return `/${normalizedValue}`;
  }

  try {
    const parsedUrl = new URL(normalizedValue);

    if (parsedUrl.pathname.startsWith(`${LISTING_IMAGES_ROUTE}/`)) {
      return parsedUrl.pathname;
    }

    return normalizedValue;
  } catch {
    return normalizedValue.replace(/\/+$/, '');
  }
}

function buildListingImagePublicUrl(photo) {
  const normalizedPhoto = normalizeListingPhotoReference(photo);

  if (!normalizedPhoto) return '';

  if (/^https?:\/\//i.test(normalizedPhoto)) {
    return normalizedPhoto;
  }

  if (normalizedPhoto.startsWith(`${LISTING_IMAGES_ROUTE}/`)) {
    return `${apiBaseUrl.replace(/\/+$/, '')}${normalizedPhoto}`;
  }

  return normalizedPhoto;
}

function serializeListingRecord(record = {}) {
  return {
    ...record,
    photos: Array.isArray(record.photos)
      ? record.photos.map((photo) => buildListingImagePublicUrl(photo)).filter(Boolean)
      : [],
  };
}

function buildStoredListingImagePath(fileName) {
  return `${LISTING_IMAGES_ROUTE}/${fileName}`;
}

function getListingImageExtension(file) {
  const extensionFromMimeType = MIME_TYPE_EXTENSIONS[file.mimetype];

  if (extensionFromMimeType) {
    return extensionFromMimeType;
  }

  const extensionFromName = path.extname(file.originalname || '').toLowerCase();

  return extensionFromName || '.jpg';
}

function getListingImageAbsolutePath(photo) {
  const normalizedPhoto = normalizeListingPhotoReference(photo);

  if (!normalizedPhoto.startsWith(`${LISTING_IMAGES_ROUTE}/`)) {
    return '';
  }

  const absolutePath = path.resolve(process.cwd(), normalizedPhoto.replace(/^\/+/, ''));

  if (!absolutePath.startsWith(`${LISTING_IMAGES_DIRECTORY}${path.sep}`)) {
    return '';
  }

  return absolutePath;
}

function getEquivalentListingPhotoReferences(photo) {
  const normalizedPhoto = normalizeListingPhotoReference(photo);

  if (!normalizedPhoto) return [];

  if (!normalizedPhoto.startsWith(`${LISTING_IMAGES_ROUTE}/`)) {
    return [normalizedPhoto];
  }

  return [normalizedPhoto, buildListingImagePublicUrl(normalizedPhoto)];
}

async function findUnusedLocalListingPhotos(photos = []) {
  const uniquePhotos = [...new Set(photos.map(normalizeListingPhotoReference).filter(Boolean))];
  const unusedPhotos = [];

  for (const photo of uniquePhotos) {
    if (!photo.startsWith(`${LISTING_IMAGES_ROUTE}/`)) {
      continue;
    }

    const equivalentReferences = getEquivalentListingPhotoReferences(photo);
    const [listingsUsingPhoto, draftsUsingPhoto] = await Promise.all([
      Listing.countDocuments({ photos: { $in: equivalentReferences } }),
      DraftListing.countDocuments({ photos: { $in: equivalentReferences } }),
    ]);

    if (listingsUsingPhoto === 0 && draftsUsingPhoto === 0) {
      unusedPhotos.push(photo);
    }
  }

  return unusedPhotos;
}

async function deleteLocalListingPhotos(photos = []) {
  const absolutePaths = [...new Set(photos.map(getListingImageAbsolutePath).filter(Boolean))];

  await Promise.all(
    absolutePaths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    })
  );
}

function getUploadedListingImages(files = []) {
  return files.map((file) => {
    const imagePath = buildStoredListingImagePath(file.filename);

    return {
      fileName: file.filename,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      path: imagePath,
      url: buildListingImagePublicUrl(imagePath),
    };
  });
}

const uploadListingImages = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      ensureListingImagesDirectory()
        .then(() => callback(null, LISTING_IMAGES_DIRECTORY))
        .catch((error) => callback(error));
    },
    filename: (req, file, callback) => {
      callback(null, `${Date.now()}-${crypto.randomUUID()}${getListingImageExtension(file)}`);
    },
  }),
  limits: {
    files: MAX_LISTING_IMAGE_COUNT,
    fileSize: MAX_LISTING_IMAGE_SIZE,
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(new ApiError(400, 'Only JPG, PNG, WEBP, and GIF images are allowed.'));
      return;
    }

    callback(null, true);
  },
}).array('images', MAX_LISTING_IMAGE_COUNT);

module.exports = {
  LISTING_IMAGES_ROUTE,
  uploadListingImages,
  normalizeListingPhotoReference,
  serializeListingRecord,
  findUnusedLocalListingPhotos,
  deleteLocalListingPhotos,
  getUploadedListingImages,
};
