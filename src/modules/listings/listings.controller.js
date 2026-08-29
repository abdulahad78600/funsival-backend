const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const { validateListingId } = require('./listings.validation');
const { getUploadedListingImages } = require('./listing-images');
const {
  createListing,
  getListingsForUser,
  getHostListingStats,
  getListingForUser,
  browseListings,
  getListingById,
  getAvailableSlotsForListing,
  updateListingForUser,
  deleteListingForUser,
  setListingActiveStatus,
  getBrowseTypes,
  getBrowseDestinations,
  getListingsForAdmin,
  getListingForAdmin,
  getAdminListingStats,
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
  const { status, search, category } = req.query;

  const result = await getListingsForUser(req.user.id, {
    page,
    limit,
    status,
    search,
    category,
  });

  res.status(200).json({
    success: true,
    message: 'Listings fetched successfully.',
    data: result,
  });
});

const getHostListingStatsHandler = asyncHandler(async (req, res) => {
  const stats = await getHostListingStats(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Listing stats fetched successfully.',
    data: stats,
  });
});

const setListingStatusHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  if (typeof req.body?.isActive !== 'boolean') {
    throw new ApiError(400, '`isActive` must be a boolean.');
  }

  const listing = await setListingActiveStatus(
    listingId,
    req.user.id,
    req.body.isActive
  );

  res.status(200).json({
    success: true,
    message: `Listing ${listing.isActive ? 'activated' : 'deactivated'} successfully.`,
    data: { listing },
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

const browseListingsHandler = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const { hostId, category, type, city, location, from, until, search, minPrice, maxPrice, sort } =
    req.query;

  const result = await browseListings({
    page,
    limit,
    hostId,
    category,
    type,
    city,
    location,
    from,
    until,
    search,
    minPrice,
    maxPrice,
    sort,
    viewerId: req.user ? req.user.id : null,
  });

  res.status(200).json({
    success: true,
    message: 'Listings fetched successfully.',
    data: result,
  });
});

const getBrowseTypesHandler = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const types = await getBrowseTypes({ category: req.query.category, limit });

  res.status(200).json({
    success: true,
    message: 'Adventure types fetched successfully.',
    data: { types },
  });
});

const getBrowseDestinationsHandler = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
  const destinations = await getBrowseDestinations({ limit });

  res.status(200).json({
    success: true,
    message: 'Destinations fetched successfully.',
    data: { destinations },
  });
});

const getPublicListingByIdHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  const listing = await getListingById(listingId, {
    viewerId: req.user ? req.user.id : null,
  });

  res.status(200).json({
    success: true,
    message: 'Listing fetched successfully.',
    data: {
      listing,
    },
  });
});

const getListingSlotsHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  const result = await getAvailableSlotsForListing(listingId, req.query.date);

  res.status(200).json({
    success: true,
    message: 'Listing slots fetched successfully.',
    data: result,
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

const getAdminListingsHandler = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const { hostId, status, search, category } = req.query;

  const result = await getListingsForAdmin({
    page,
    limit,
    hostId,
    status,
    search,
    category,
  });

  res.status(200).json({
    success: true,
    message: 'Listings fetched successfully.',
    data: result,
  });
});

const getAdminListingStatsHandler = asyncHandler(async (req, res) => {
  const stats = await getAdminListingStats({ hostId: req.query.hostId });

  res.status(200).json({
    success: true,
    message: 'Listing stats fetched successfully.',
    data: stats,
  });
});

const getAdminListingByIdHandler = asyncHandler(async (req, res) => {
  const listingId = validateListingId(req.params.listingId);
  const listing = await getListingForAdmin(listingId);

  res.status(200).json({
    success: true,
    message: 'Listing fetched successfully.',
    data: {
      listing,
    },
  });
});

module.exports = {
  uploadListingImagesHandler,
  createListingHandler,
  getMyListingsHandler,
  getHostListingStatsHandler,
  getListingByIdHandler,
  browseListingsHandler,
  getPublicListingByIdHandler,
  getListingSlotsHandler,
  updateListingHandler,
  deleteListingHandler,
  setListingStatusHandler,
  getBrowseTypesHandler,
  getBrowseDestinationsHandler,
  getAdminListingsHandler,
  getAdminListingStatsHandler,
  getAdminListingByIdHandler,
};
