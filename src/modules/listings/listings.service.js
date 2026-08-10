const mongoose = require('mongoose');

const Listing = require('../../models/listing.model');
const User = require('../../models/user.model');
const Booking = require('../../models/booking.model');
const ApiError = require('../../utils/api-error');
const { BOOKING_STATUS, BOOKING_TYPES } = require('../../constants/booking');
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

const LISTING_STATUS_FILTERS = ['all', 'active', 'inactive'];

async function buildListingBookingCountMap(listingIds = []) {
  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return new Map();
  }

  const objectIds = listingIds
    .map((id) => {
      try {
        return new mongoose.Types.ObjectId(String(id));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

  const rows = await Booking.aggregate([
    {
      $match: {
        listing: { $in: objectIds },
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] },
      },
    },
    { $group: { _id: '$listing', count: { $sum: 1 } } },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(String(row._id), row.count);
  });
  return map;
}

async function getListingsForUser(
  userId,
  { page = 1, limit = 10, status, search } = {}
) {
  const skip = (page - 1) * limit;
  const filter = { createdBy: userId };

  const normalizedStatus =
    typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (normalizedStatus && normalizedStatus !== 'all') {
    if (!LISTING_STATUS_FILTERS.includes(normalizedStatus)) {
      throw new ApiError(
        400,
        `Invalid status. Allowed values: ${LISTING_STATUS_FILTERS.join(', ')}.`
      );
    }
    filter.isActive = normalizedStatus === 'active';
  }

  const trimmedSearch = typeof search === 'string' ? search.trim() : '';
  if (trimmedSearch) {
    const regex = new RegExp(
      trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
    filter['basicInformation.activityTitle'] = regex;
  }

  const [listings, total] = await Promise.all([
    Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Listing.countDocuments(filter),
  ]);

  const serializedListings = listings.map((listing) =>
    serializeListingRecord(listing.toJSON())
  );
  const listingsWithReviews = await attachReviewSummariesToListings(serializedListings);

  const listingIds = listingsWithReviews.map((listing) => listing.id).filter(Boolean);
  const bookingCountMap = await buildListingBookingCountMap(listingIds);

  const listingsWithCounts = listingsWithReviews.map((listing) => ({
    ...listing,
    bookingCount: bookingCountMap.get(String(listing.id)) || 0,
  }));

  return {
    listings: listingsWithCounts,
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

async function setListingActiveStatus(listingId, userId, isActive) {
  const listing = await Listing.findOne({ _id: listingId, createdBy: userId });
  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  listing.isActive = Boolean(isActive);
  await listing.save();

  const [serializedListing] = await attachReviewSummariesToListings([
    serializeListingRecord(listing.toJSON()),
  ]);
  return serializedListing;
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

const DEFAULT_SLOT_DURATION_MINUTES = 60;
const MIN_SLOT_DURATION_MINUTES = 15;
const MAX_SLOT_DURATION_MINUTES = 12 * 60;

function timeStringToMinutes(time) {
  const [hours, minutes] = String(time).split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTimeString(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function startOfUtcDay(date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function resolveSlotDurationMinutes(listing) {
  const duration = listing.serviceDetails && listing.serviceDetails.duration;
  if (duration && Number.isFinite(duration.value)) {
    let minutes = null;
    if (duration.unit === 'minutes') minutes = duration.value;
    if (duration.unit === 'hours') minutes = duration.value * 60;
    if (minutes) {
      return Math.max(
        MIN_SLOT_DURATION_MINUTES,
        Math.min(minutes, MAX_SLOT_DURATION_MINUTES)
      );
    }
  }
  return DEFAULT_SLOT_DURATION_MINUTES;
}

async function getBookedIntervalsForDate(listingId, dayStart) {
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const activeBookings = await Booking.find({
    listing: listingId,
    status: {
      $in: [
        BOOKING_STATUS.PENDING,
        BOOKING_STATUS.AWAITING_HOST_APPROVAL,
        BOOKING_STATUS.CONFIRMED,
      ],
    },
    bookingType: { $in: [BOOKING_TYPES.HOURLY, BOOKING_TYPES.PER_HOUR] },
    startDate: { $lt: dayEnd },
    endDate: { $gte: dayStart },
  }).select('startTime endTime slots');

  return activeBookings.flatMap((booking) => {
    const slots =
      Array.isArray(booking.slots) && booking.slots.length > 0
        ? booking.slots
        : [{ startTime: booking.startTime, endTime: booking.endTime }];
    return slots
      .filter((slot) => slot.startTime && slot.endTime)
      .map((slot) => ({
        start: timeStringToMinutes(slot.startTime),
        end: timeStringToMinutes(slot.endTime),
      }));
  });
}

async function getAvailableSlotsForListing(listingId, dateInput) {
  const requestedDate = new Date(dateInput);
  if (!dateInput || Number.isNaN(requestedDate.getTime())) {
    throw new ApiError(400, 'A valid `date` query parameter is required (YYYY-MM-DD).');
  }

  const listing = await Listing.findById(listingId);
  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  const dayStart = startOfUtcDay(requestedDate);
  const windows = (listing.availability || []).filter(
    (entry) =>
      entry.isAvailable !== false &&
      entry.date &&
      startOfUtcDay(entry.date).getTime() === dayStart.getTime()
  );

  const slotDurationMinutes = resolveSlotDurationMinutes(listing);
  const hourlyPrice =
    listing.price && Number.isFinite(listing.price.hourly)
      ? listing.price.hourly
      : null;
  const pricePerSlot =
    hourlyPrice !== null
      ? Number(((hourlyPrice * slotDurationMinutes) / 60).toFixed(2))
      : null;

  const bookedIntervals =
    windows.length > 0
      ? await getBookedIntervalsForDate(listing._id, dayStart)
      : [];

  const slots = [];
  for (const window of windows) {
    const windowStart = timeStringToMinutes(window.startTime);
    const windowEnd = timeStringToMinutes(window.endTime);

    for (
      let slotStart = windowStart;
      slotStart + slotDurationMinutes <= windowEnd;
      slotStart += slotDurationMinutes
    ) {
      const slotEnd = slotStart + slotDurationMinutes;
      const isBooked = bookedIntervals.some(
        (booked) => slotStart < booked.end && booked.start < slotEnd
      );

      slots.push({
        startTime: minutesToTimeString(slotStart),
        endTime: minutesToTimeString(slotEnd),
        durationMinutes: slotDurationMinutes,
        price: pricePerSlot,
        available: !isBooked,
      });
    }
  }

  slots.sort(
    (a, b) => timeStringToMinutes(a.startTime) - timeStringToMinutes(b.startTime)
  );

  return {
    listingId: listing._id.toString(),
    date: dayStart.toISOString().slice(0, 10),
    slotDurationMinutes,
    hourlyPrice,
    currency: (listing.price && listing.price.currency) || 'USD',
    slots,
  };
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
  getAvailableSlotsForListing,
  updateListingForUser,
  deleteListingForUser,
  setListingActiveStatus,
  LISTING_STATUS_FILTERS,
};
