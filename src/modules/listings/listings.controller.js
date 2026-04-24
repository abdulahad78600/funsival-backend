const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const { validateListingId } = require('./listings.validation');
const { getUploadedListingImages } = require('./listing-images');
const {
  createListing,
  getListingsForUser,
  getListingForUser,
  updateListingForUser,
  deleteListingForUser,
} = require('./listings.service');

const uploadListingImagesHandler = asyncHandler(async (req, res) => {
  const uploadedImages = getUploadedListingImages(req.files);

  if (uploadedImages.length === 0) {
    throw new ApiError(400, 'At least one image is required.');
  }

  res.status(201).json({
    success: true,
    message: 'Listing images uploaded successfully.',
    data: {
      images: uploadedImages,
      photos: uploadedImages.map((image) => image.path),
    },
  });
});

const createListingHandler = asyncHandler(async (req, res) => {
  const listing = await createListing(req.body, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Listing created successfully.',
    data: {
      listing,
    },
  });
});

const getMyListingsHandler = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));

  const result = await getListingsForUser(req.user.id, { page, limit });

  res.status(200).json({
    success: true,
    message: 'Listings fetched successfully.',
    data: result,
  });
});

const getListingByIdHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  const listing = await getListingForUser(listingId, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Listing fetched successfully.',
    data: {
      listing,
    },
  });
});

const updateListingHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  const listing = await updateListingForUser(listingId, req.body, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Listing updated successfully.',
    data: {
      listing,
    },
  });
});

const deleteListingHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  await deleteListingForUser(listingId, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Listing deleted successfully.',
  });
});

module.exports = {
  uploadListingImagesHandler,
  createListingHandler,
  getMyListingsHandler,
  getListingByIdHandler,
  updateListingHandler,
  deleteListingHandler,
};
