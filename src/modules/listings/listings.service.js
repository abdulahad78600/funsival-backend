const Listing = require('../../models/listing.model');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const { validateListingPayload } = require('./listings.validation');
const {
  deleteLocalListingPhotos,
  findUnusedLocalListingPhotos,
  serializeListingRecord,
} = require('./listing-images');
const {
  buildEmptyReviewSummary,
  buildListingReviewSummaryMap,
  buildHostReviewSummaryMap,
} = require('../reviews/reviews.service');

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

async function attachReviewSummariesToListings(listings = []) {
  if (!Array.isArray(listings) || listings.length === 0) {
    return [];
  }

  const listingIds = listings.map((listing) => listing.id || listing._id).filter(Boolean);
  const hostIds = listings
    .map((listing) => {
      if (listing.host && listing.host.id) return listing.host.id;
      if (typeof listing.createdBy === 'string') return listing.createdBy;
      if (listing.createdBy && listing.createdBy._id) return listing.createdBy._id.toString();
      return '';
    })
    .filter(Boolean);

  const [listingSummaryMap, hostSummaryMap] = await Promise.all([
    buildListingReviewSummaryMap(listingIds),
    buildHostReviewSummaryMap(hostIds),
  ]);

  return listings.map((listing) => {
    const listingId = String(listing.id || listing._id || '');
    const hostId = listing.host?.id
      ? String(listing.host.id)
      : typeof listing.createdBy === 'string'
        ? listing.createdBy
        : listing.createdBy && listing.createdBy._id
          ? listing.createdBy._id.toString()
          : '';

    return {
      ...listing,
      reviewSummary: listingSummaryMap.get(listingId) || buildEmptyReviewSummary(),
      ...(listing.host
        ? {
            host: {
              ...listing.host,
              reviewSummary: hostSummaryMap.get(hostId) || buildEmptyReviewSummary(),
            },
          }
        : {}),
    };
  });
}

async function ensureHostStripeConnected(userId) {
  const user = await User.findById(userId).select('+stripeConnect');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (!user.stripeConnect || !user.stripeConnect.accountId) {
    throw new ApiError(
      403,
      'Connect your Stripe account before creating a listing.'
    );
  }
  if (!user.stripeConnect.chargesEnabled) {
    throw new ApiError(
      403,
      'Complete your Stripe onboarding before creating a listing.'
    );
  }
}

async function createListing(payload, userId) {
  await ensureHostStripeConnected(userId);

  const validatedPayload = validateListingPayload(payload);

  const listing = await Listing.create({
    ...validatedPayload,
    createdBy: userId,
  });

  const [serializedListing] = await attachReviewSummariesToListings([
    serializeListingRecord(listing.toJSON()),
  ]);
  return serializedListing;
}

async function getListingsForUser(userId, { page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { createdBy: userId };

  const [listings, total] = await Promise.all([
    Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Listing.countDocuments(filter),
  ]);

  const serializedListings = listings.map((listing) => serializeListingRecord(listing.toJSON()));

  return {
    listings: await attachReviewSummariesToListings(serializedListings),
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

  const [serializedListing] = await attachReviewSummariesToListings([
    serializeListingRecord(listing.toJSON()),
  ]);
  return serializedListing;
}

async function browseListings({
  page = 1,
  limit = 10,
  hostId,
  category,
  type,
  city,
  search,
  minPrice,
  maxPrice,
  sort,
} = {}) {
  const skip = (page - 1) * limit;
  const filter = {};

  if (hostId) filter.createdBy = hostId;

  if (category) {
    const categories = String(category)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (categories.length === 1) {
      filter.category = new RegExp(`^${categories[0]}$`, 'i');
    } else if (categories.length > 1) {
      filter.category = { $in: categories.map((value) => new RegExp(`^${value}$`, 'i')) };
    }
  }

  if (type) filter.type = type;
  if (city) filter['placeLocation.city'] = new RegExp(`^${city}$`, 'i');

  if (search) {
    const term = String(search).trim();
    if (term) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { 'basicInformation.activityTitle': regex },
        { 'basicInformation.description': regex },
        { 'basicInformation.location': regex },
        { category: regex },
        { type: regex },
      ];
    }
  }

  const min = minPrice !== undefined && minPrice !== '' ? Number(minPrice) : null;
  const max = maxPrice !== undefined && maxPrice !== '' ? Number(maxPrice) : null;
  if ((min !== null && !Number.isNaN(min)) || (max !== null && !Number.isNaN(max))) {
    const priceRange = {};
    if (min !== null && !Number.isNaN(min)) priceRange.$gte = min;
    if (max !== null && !Number.isNaN(max)) priceRange.$lte = max;
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { 'price.perPerson': priceRange },
          { 'price.hourly': priceRange },
          { 'price.daily': priceRange },
        ],
      },
    ];
  }

  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    'price-asc': { 'price.perPerson': 1, 'price.hourly': 1, 'price.daily': 1 },
    'price-desc': { 'price.perPerson': -1, 'price.hourly': -1, 'price.daily': -1 },
  };
  const sortOption = sortMap[sort] || sortMap.newest;

  const [listings, total] = await Promise.all([
    Listing.find(filter)
      .populate('createdBy', 'email role agencyName city providerProfile')
      .sort(sortOption)
      .skip(skip)
      .limit(limit),
    Listing.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);

  const serializedListings = listings.map((listing) => serializeListingRecord(listing.toJSON()));

  return {
    listings: await attachReviewSummariesToListings(serializedListings),
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

async function getListingById(listingId) {
  const listing = await Listing.findById(listingId).populate(
    'createdBy',
    'email role agencyName city'
  );

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  const [serializedListing] = await attachReviewSummariesToListings([
    serializeListingRecord(listing.toJSON()),
  ]);
  return serializedListing;
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

  const [serializedListing] = await attachReviewSummariesToListings([
    serializeListingRecord(existingListing.toJSON()),
  ]);
  return serializedListing;
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
  browseListings,
  getListingById,
  updateListingForUser,
  deleteListingForUser,
};
