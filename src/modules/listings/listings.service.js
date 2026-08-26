const mongoose = require('mongoose');

const Listing = require('../../models/listing.model');
const DraftListing = require('../../models/draft-listing.model');
const ListingView = require('../../models/listing-view.model');
const Review = require('../../models/review.model');
const User = require('../../models/user.model');
const Booking = require('../../models/booking.model');
const Wishlist = require('../../models/wishlist.model');
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

// Marks each listing with `isWishlisted` for the signed-in viewer (false when anonymous).
async function attachWishlistFlags(listings = [], viewerId = null) {
  if (!Array.isArray(listings) || listings.length === 0) return [];
  if (!viewerId || !mongoose.Types.ObjectId.isValid(String(viewerId))) {
    return listings.map((listing) => ({ ...listing, isWishlisted: false }));
  }

  const listingIds = listings
    .map((listing) => listing.id || listing._id)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const rows = await Wishlist.find({
    user: new mongoose.Types.ObjectId(String(viewerId)),
    listing: { $in: listingIds },
  }).select('listing');
  const wishlisted = new Set(rows.map((row) => String(row.listing)));

  return listings.map((listing) => ({
    ...listing,
    isWishlisted: wishlisted.has(String(listing.id || listing._id)),
  }));
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

const LISTING_STATUS_FILTERS = ['all', 'active', 'inactive', 'draft'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compareTimeStrings(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

// First upcoming availability slot (today or later) — drives the
// "Availability" column in the listings table.
function resolveNextAvailability(availability = []) {
  if (!Array.isArray(availability) || availability.length === 0) return null;

  const todayStart = startOfUtcDay(new Date()).getTime();
  const upcoming = availability
    .filter((slot) => {
      if (!slot || slot.isAvailable === false || !slot.date) return false;
      const time = new Date(slot.date).getTime();
      return !Number.isNaN(time) && startOfUtcDay(new Date(time)).getTime() >= todayStart;
    })
    .sort((a, b) => {
      const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
      return dateDiff !== 0 ? dateDiff : compareTimeStrings(a.startTime, b.startTime);
    });

  const slot = upcoming[0];
  if (!slot) return null;
  return {
    date: new Date(slot.date).toISOString().slice(0, 10),
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
}

function serializeHostListing(listing) {
  const record = serializeListingRecord(listing.toJSON());
  return {
    ...record,
    status: listing.isActive ? 'active' : 'inactive',
    isDraft: false,
    nextAvailability: resolveNextAvailability(record.availability),
  };
}

function serializeDraftListing(draft) {
  return {
    ...serializeListingRecord(draft.toJSON()),
    status: 'draft',
    isDraft: true,
    nextAvailability: null,
  };
}

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

const HOST_POPULATE_FIELDS = 'email role agencyName city providerProfile';
const HOST_SEARCH_FIELDS = ['basicInformation.activityTitle'];
const ADMIN_SEARCH_FIELDS = [
  'basicInformation.activityTitle',
  'basicInformation.location',
  'placeLocation.city',
];

function buildPaginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

// Shared by the host "My listings" screen and the admin listings screen.
// Returns published + draft listings with status, booking counts, ratings,
// tab totals and pagination. `hostId` scopes to one host; omit it for all hosts.
async function queryListings({
  hostId = null,
  page = 1,
  limit = 10,
  status,
  search,
  category,
  populateHost = false,
  searchFields = HOST_SEARCH_FIELDS,
} = {}) {
  const skip = (page - 1) * limit;

  const normalizedStatus =
    typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (normalizedStatus && !LISTING_STATUS_FILTERS.includes(normalizedStatus)) {
    throw new ApiError(
      400,
      `Invalid status. Allowed values: ${LISTING_STATUS_FILTERS.join(', ')}.`
    );
  }

  const trimmedSearch = typeof search === 'string' ? search.trim() : '';
  const trimmedCategory = typeof category === 'string' ? category.trim() : '';
  const searchRegex = trimmedSearch
    ? new RegExp(escapeRegex(trimmedSearch), 'i')
    : null;
  const categoryRegex = trimmedCategory
    ? new RegExp(`^${escapeRegex(trimmedCategory)}$`, 'i')
    : null;

  const baseFilter = {};
  if (hostId) baseFilter.createdBy = hostId;
  if (searchRegex) {
    if (searchFields.length === 1) {
      baseFilter[searchFields[0]] = searchRegex;
    } else {
      baseFilter.$or = searchFields.map((field) => ({ [field]: searchRegex }));
    }
  }
  if (categoryRegex) baseFilter.category = categoryRegex;

  const listingFilter = { ...baseFilter };
  const draftFilter = { ...baseFilter };
  const withHost = (query) =>
    populateHost ? query.populate('createdBy', HOST_POPULATE_FIELDS) : query;

  const [activeTotal, inactiveTotal, draftTotal] = await Promise.all([
    Listing.countDocuments({ ...listingFilter, isActive: true }),
    Listing.countDocuments({ ...listingFilter, isActive: false }),
    DraftListing.countDocuments(draftFilter),
  ]);
  const tabs = {
    all: activeTotal + inactiveTotal + draftTotal,
    active: activeTotal,
    inactive: inactiveTotal,
    draft: draftTotal,
  };

  let total = 0;
  let items = [];

  if (normalizedStatus === 'draft') {
    total = draftTotal;
    const drafts = await withHost(
      DraftListing.find(draftFilter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
    );
    items = drafts.map(serializeDraftListing);
  } else if (!normalizedStatus || normalizedStatus === 'all') {
    // Drafts are listed first, then published listings (newest first).
    total = tabs.all;
    const drafts = await withHost(
      DraftListing.find(draftFilter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
    );
    const remaining = limit - drafts.length;
    const listingSkip = Math.max(0, skip - draftTotal);
    const listings =
      remaining > 0
        ? await withHost(
            Listing.find(listingFilter)
              .sort({ createdAt: -1 })
              .skip(listingSkip)
              .limit(remaining)
          )
        : [];
    items = [
      ...drafts.map(serializeDraftListing),
      ...listings.map(serializeHostListing),
    ];
  } else {
    total = normalizedStatus === 'active' ? activeTotal : inactiveTotal;
    const listings = await withHost(
      Listing.find({
        ...listingFilter,
        isActive: normalizedStatus === 'active',
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    );
    items = listings.map(serializeHostListing);
  }

  const listingsWithReviews = await attachReviewSummariesToListings(items);

  const listingIds = listingsWithReviews
    .filter((listing) => !listing.isDraft)
    .map((listing) => listing.id)
    .filter(Boolean);
  const bookingCountMap = await buildListingBookingCountMap(listingIds);

  const listingsWithCounts = listingsWithReviews.map((listing) => ({
    ...listing,
    bookingCount: listing.isDraft
      ? 0
      : bookingCountMap.get(String(listing.id)) || 0,
  }));

  return {
    listings: listingsWithCounts,
    tabs,
    pagination: buildPaginationMeta(total, page, limit),
  };
}

async function getListingsForUser(userId, options = {}) {
  return queryListings({ ...options, hostId: userId });
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
  viewerId = null,
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
  const withReviews = await attachReviewSummariesToListings(serializedListings);

  return {
    listings: await attachWishlistFlags(withReviews, viewerId),
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

function recordListingView(listing) {
  const hostId =
    listing.createdBy && listing.createdBy._id
      ? listing.createdBy._id
      : listing.createdBy;
  if (!hostId) return;

  ListingView.create({ listing: listing._id, host: hostId }).catch((error) => {
    console.error('Failed to record listing view.', error);
  });
}

async function getListingById(listingId, { viewerId = null } = {}) {
  const listing = await Listing.findById(listingId).populate(
    'createdBy',
    'email role agencyName city'
  );

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  recordListingView(listing);

  const withReviews = await attachReviewSummariesToListings([
    serializeListingRecord(listing.toJSON()),
  ]);
  const [serializedListing] = await attachWishlistFlags(withReviews, viewerId);
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

function startOfUtcMonth(date, monthOffset = 0) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1)
  );
}

function startOfUtcQuarter(date, quarterOffset = 0) {
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(
    Date.UTC(date.getUTCFullYear(), quarterMonth + quarterOffset * 3, 1)
  );
}

function changePercentage(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (
    Math.round((((current - previous) / previous) * 100 + Number.EPSILON) * 100) /
    100
  );
}

function averageRating(sum, count) {
  return count > 0 ? Math.round((sum / count + Number.EPSILON) * 10) / 10 : null;
}

function sumInPeriod(field, start, end) {
  return {
    $sum: {
      $cond: [
        { $and: [{ $gte: ['$createdAt', start] }, { $lt: ['$createdAt', end] }] },
        field,
        0,
      ],
    },
  };
}

function toOptionalObjectId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

// KPI cards (total listings, listing views, total bookings, average rating)
// plus tab totals. Pass a host ID to scope to one host, or null for all hosts.
async function buildListingStats(hostId = null) {
  const now = new Date();
  const monthStart = startOfUtcMonth(now);
  const previousMonthStart = startOfUtcMonth(now, -1);
  const nextMonthStart = startOfUtcMonth(now, 1);
  const quarterStart = startOfUtcQuarter(now);
  const previousQuarterStart = startOfUtcQuarter(now, -1);
  const nextQuarterStart = startOfUtcQuarter(now, 1);

  const [listingRows, draftCount, viewRows, bookingRows, reviewRows] =
    await Promise.all([
      Listing.aggregate([
        { $match: hostId ? { createdBy: hostId } : {} },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            currentQuarter: sumInPeriod(1, quarterStart, nextQuarterStart),
            previousQuarter: sumInPeriod(1, previousQuarterStart, quarterStart),
          },
        },
      ]),
      DraftListing.countDocuments(hostId ? { createdBy: hostId } : {}),
      ListingView.aggregate([
        { $match: hostId ? { host: hostId } : {} },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            currentMonth: sumInPeriod(1, monthStart, nextMonthStart),
            previousMonth: sumInPeriod(1, previousMonthStart, monthStart),
          },
        },
      ]),
      Booking.aggregate([
        {
          $match: {
            ...(hostId ? { host: hostId } : {}),
            status: {
              $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED],
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            currentMonth: sumInPeriod(1, monthStart, nextMonthStart),
            previousMonth: sumInPeriod(1, previousMonthStart, monthStart),
          },
        },
      ]),
      Review.aggregate([
        { $match: hostId ? { host: hostId } : {} },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            totalSum: { $sum: '$overallRating' },
            currentMonthCount: sumInPeriod(1, monthStart, nextMonthStart),
            currentMonthSum: sumInPeriod(
              '$overallRating',
              monthStart,
              nextMonthStart
            ),
            previousMonthCount: sumInPeriod(1, previousMonthStart, monthStart),
            previousMonthSum: sumInPeriod(
              '$overallRating',
              previousMonthStart,
              monthStart
            ),
          },
        },
      ]),
    ]);

  const listingStats = listingRows[0] || {
    total: 0,
    active: 0,
    currentQuarter: 0,
    previousQuarter: 0,
  };
  const viewStats = viewRows[0] || { total: 0, currentMonth: 0, previousMonth: 0 };
  const bookingStats = bookingRows[0] || {
    total: 0,
    currentMonth: 0,
    previousMonth: 0,
  };
  const reviewStats = reviewRows[0] || {
    totalCount: 0,
    totalSum: 0,
    currentMonthCount: 0,
    currentMonthSum: 0,
    previousMonthCount: 0,
    previousMonthSum: 0,
  };

  const inactiveListings = listingStats.total - listingStats.active;
  const overallRating = averageRating(reviewStats.totalSum, reviewStats.totalCount);
  const currentMonthRating = averageRating(
    reviewStats.currentMonthSum,
    reviewStats.currentMonthCount
  );
  const previousMonthRating = averageRating(
    reviewStats.previousMonthSum,
    reviewStats.previousMonthCount
  );
  const ratingChange =
    currentMonthRating !== null && previousMonthRating !== null
      ? Math.round((currentMonthRating - previousMonthRating + Number.EPSILON) * 10) /
        10
      : null;

  return {
    cards: {
      totalListings: {
        total: listingStats.total,
        currentQuarter: listingStats.currentQuarter,
        previousQuarter: listingStats.previousQuarter,
        quarterChangePercentage: changePercentage(
          listingStats.currentQuarter,
          listingStats.previousQuarter
        ),
      },
      listingViews: {
        total: viewStats.total,
        currentMonth: viewStats.currentMonth,
        previousMonth: viewStats.previousMonth,
        monthChangePercentage: changePercentage(
          viewStats.currentMonth,
          viewStats.previousMonth
        ),
      },
      totalBookings: {
        total: bookingStats.total,
        currentMonth: bookingStats.currentMonth,
        previousMonth: bookingStats.previousMonth,
        monthChangePercentage: changePercentage(
          bookingStats.currentMonth,
          bookingStats.previousMonth
        ),
      },
      averageRating: {
        rating: overallRating,
        reviewCount: reviewStats.totalCount,
        currentMonthRating,
        previousMonthRating,
        changeFromLastMonth: ratingChange,
      },
    },
    tabs: {
      all: listingStats.total + draftCount,
      active: listingStats.active,
      inactive: inactiveListings,
      draft: draftCount,
    },
  };
}

async function getHostListingStats(userId) {
  return buildListingStats(toOptionalObjectId(userId, 'host ID'));
}

async function getAdminListingStats({ hostId } = {}) {
  return buildListingStats(toOptionalObjectId(hostId, 'host ID'));
}

async function getListingsForAdmin({ hostId, ...options } = {}) {
  return queryListings({
    ...options,
    hostId: toOptionalObjectId(hostId, 'host ID'),
    populateHost: true,
    searchFields: ADMIN_SEARCH_FIELDS,
  });
}

async function getListingForAdmin(listingId) {
  const listing = await Listing.findById(listingId).populate(
    'createdBy',
    HOST_POPULATE_FIELDS
  );

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  const [withReviews, viewCount, bookingStatusRows] = await Promise.all([
    attachReviewSummariesToListings([serializeHostListing(listing)]),
    ListingView.countDocuments({ listing: listing._id }),
    Booking.aggregate([
      { $match: { listing: listing._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const bookingsByStatus = Object.values(BOOKING_STATUS).reduce(
    (acc, value) => ({ ...acc, [value]: 0 }),
    {}
  );
  let totalBookings = 0;
  bookingStatusRows.forEach((row) => {
    bookingsByStatus[row._id] = row.count;
    totalBookings += row.count;
  });
  const bookingCount =
    (bookingsByStatus[BOOKING_STATUS.CONFIRMED] || 0) +
    (bookingsByStatus[BOOKING_STATUS.COMPLETED] || 0);

  return {
    ...withReviews[0],
    bookingCount,
    stats: {
      viewCount,
      bookingCount,
      totalBookings,
      bookingsByStatus,
    },
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
  getHostListingStats,
  getListingForUser,
  browseListings,
  getListingById,
  getAvailableSlotsForListing,
  updateListingForUser,
  deleteListingForUser,
  setListingActiveStatus,
  getListingsForAdmin,
  getListingForAdmin,
  getAdminListingStats,
  attachReviewSummariesToListings,
  attachWishlistFlags,
  LISTING_STATUS_FILTERS,
};
