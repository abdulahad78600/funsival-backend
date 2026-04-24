const Listing = require('../../models/listing.model');
const ApiError = require('../../utils/api-error');
const { validateListingPayload } = require('./listings.validation');
const {
  deleteLocalListingPhotos,
  findUnusedLocalListingPhotos,
  serializeListingRecord,
} = require('./listing-images');

function mergeListingPayload(existingListing, payload) {
  const currentListing = existingListing.toObject({ depopulate: true });

  return {
    category: payload.category ?? currentListing.category,
    type: payload.type ?? currentListing.type,
    basicInformation: {
      ...currentListing.basicInformation,
      ...(payload.basicInformation || {}),
    },
    serviceDetails: {
      ...currentListing.serviceDetails,
      ...(payload.serviceDetails || {}),
      duration: {
        ...currentListing.serviceDetails.duration,
        ...((payload.serviceDetails && payload.serviceDetails.duration) || {}),
      },
      ...(payload.serviceDetails && payload.serviceDetails.whatsIncluded
        ? { whatsIncluded: payload.serviceDetails.whatsIncluded }
        : {}),
      ...(payload.serviceDetails && payload.serviceDetails.requirements
        ? { requirements: payload.serviceDetails.requirements }
        : {}),
    },
    placeLocation: {
      ...currentListing.placeLocation,
      ...(payload.placeLocation || {}),
    },
    photos: payload.photos ?? currentListing.photos,
    availability: payload.availability ?? currentListing.availability,
    price: {
      ...currentListing.price,
      ...(payload.price || {}),
    },
  };
}

async function cleanupUnusedListingPhotos(photos = []) {
  try {
    const unusedPhotos = await findUnusedLocalListingPhotos(photos);
    await deleteLocalListingPhotos(unusedPhotos);
  } catch (error) {
    console.error('Failed to clean up listing images.', error);
  }
}

async function createListing(payload, userId) {
  const validatedPayload = validateListingPayload(payload);

  const listing = await Listing.create({
    ...validatedPayload,
    createdBy: userId,
  });

  return serializeListingRecord(listing.toJSON());
}

async function getListingsForUser(userId, { page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { createdBy: userId };

  const [listings, total] = await Promise.all([
    Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Listing.countDocuments(filter),
  ]);

  return {
    listings: listings.map((listing) => serializeListingRecord(listing.toJSON())),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1,
    },
  };
}

async function getListingForUser(listingId, userId) {
  const listing = await Listing.findOne({ _id: listingId, createdBy: userId });

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  return serializeListingRecord(listing.toJSON());
}

async function updateListingForUser(listingId, payload, userId) {
  const existingListing = await Listing.findOne({ _id: listingId, createdBy: userId });

  if (!existingListing) {
    throw new ApiError(404, 'Listing not found.');
  }

  const mergedPayload = mergeListingPayload(existingListing, payload);
  const validatedPayload = validateListingPayload(mergedPayload);
  const removedPhotos = existingListing.photos.filter(
    (photo) => !validatedPayload.photos.includes(photo)
  );

  existingListing.set(validatedPayload);
  await existingListing.save();
  await cleanupUnusedListingPhotos(removedPhotos);

  return serializeListingRecord(existingListing.toJSON());
}

async function deleteListingForUser(listingId, userId) {
  const listing = await Listing.findOneAndDelete({ _id: listingId, createdBy: userId });

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  await cleanupUnusedListingPhotos(listing.photos);
}

module.exports = {
  createListing,
  getListingsForUser,
  getListingForUser,
  updateListingForUser,
  deleteListingForUser,
};
