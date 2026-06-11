const mongoose = require('mongoose');

const Booking = require('../../models/booking.model');
const Listing = require('../../models/listing.model');
const Review = require('../../models/review.model');
const User = require('../../models/user.model');
const { BOOKING_STATUS } = require('../../constants/booking');
const ApiError = require('../../utils/api-error');
const { serializeListingRecord } = require('../listings/listing-images');

function buildEmptyReviewSummary() {
  return {
    count: 0,
    overallRating: null,
    accuracy: null,
    quality: null,
    communication: null,
    value: null,
  };
}

function roundRating(value) {
  if (value === null || value === undefined) return null;
  return Number(Number(value).toFixed(1));
}

function buildReviewSummaryFromAggregate(row) {
  if (!row) {
    return buildEmptyReviewSummary();
  }

  return {
    count: row.count || 0,
    overallRating: roundRating(row.overallRating),
    accuracy: roundRating(row.accuracy),
    quality: roundRating(row.quality),
    communication: roundRating(row.communication),
    value: roundRating(row.value),
  };
}

function extractId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return '';
}

function buildPagination(total, page, limit) {
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

function serializeUserSummary(user) {
  if (!user || typeof user !== 'object') {
    const id = extractId(user);
    return id ? { id } : null;
  }

  const profile = user.providerProfile || {};
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  const name = fullName || user.agencyName || user.email || '';

  return {
    id: extractId(user),
    name,
    email: user.email || '',
    role: user.role || '',
    agencyName: user.agencyName || '',
    city: user.city || profile.location?.city || '',
    profileImage: profile.profileImage || '',
  };
}

function serializeReview(review) {
  const reviewObject = review && typeof review.toJSON === 'function' ? review.toJSON() : review;
  if (!reviewObject) return null;

  return {
    ...reviewObject,
    booking: extractId(reviewObject.booking),
    listing: extractId(reviewObject.listing),
    host: extractId(reviewObject.host),
    reviewer: serializeUserSummary(review.reviewer || reviewObject.reviewer),
  };
}

function isBookingReviewable(booking) {
  if (!booking) return false;

  return ![
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.AWAITING_HOST_APPROVAL,
    BOOKING_STATUS.DECLINED,
    BOOKING_STATUS.CANCELLED,
  ].includes(booking.status);
}

function buildReviewStatus(booking, viewerUserId, review) {
  const bookedById = extractId(booking.bookedBy);
  const isGuest = bookedById === viewerUserId.toString();
  const bookingReviewable = isBookingReviewable(booking);
  const hasSubmitted = Boolean(review);

  return {
    canSubmit: isGuest && bookingReviewable && !hasSubmitted,
    canEdit: isGuest && bookingReviewable && hasSubmitted,
    hasSubmitted,
    reason: !isGuest
      ? 'only_booking_guest_can_review'
      : bookingReviewable
        ? null
        : 'booking_not_reviewable',
    reviewId: review ? extractId(review) : '',
    submittedAt: review && review.createdAt ? review.createdAt : null,
  };
}

function normalizeObjectIds(ids = []) {
  return [...new Set(ids.map((value) => extractId(value)).filter(Boolean))]
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

async function buildReviewSummaryMap(field, ids = []) {
  const objectIds = normalizeObjectIds(ids);
  if (objectIds.length === 0) {
    return new Map();
  }

  const rows = await Review.aggregate([
    {
      $match: {
        [field]: { $in: objectIds },
      },
    },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
        overallRating: { $avg: '$overallRating' },
        accuracy: { $avg: '$accuracy' },
        quality: { $avg: '$quality' },
        communication: { $avg: '$communication' },
        value: { $avg: '$value' },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [row._id.toString(), buildReviewSummaryFromAggregate(row)])
  );
}

async function buildListingReviewSummaryMap(listingIds = []) {
  return buildReviewSummaryMap('listing', listingIds);
}

async function buildHostReviewSummaryMap(hostIds = []) {
  return buildReviewSummaryMap('host', hostIds);
}

async function getListingReviewSummary(listingId) {
  const map = await buildListingReviewSummaryMap([listingId]);
  return map.get(extractId(listingId)) || buildEmptyReviewSummary();
}

async function getHostReviewSummary(hostId) {
  const map = await buildHostReviewSummaryMap([hostId]);
  return map.get(extractId(hostId)) || buildEmptyReviewSummary();
}

async function attachReviewDataToBookings(bookings = [], viewerUserId) {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return [];
  }

  const bookingIds = bookings.map((booking) => extractId(booking)).filter(Boolean);
  const reviews = await Review.find({ booking: { $in: bookingIds } })
    .populate('reviewer', 'email role agencyName city providerProfile')
    .sort({ createdAt: -1 });

  const reviewMap = new Map(reviews.map((review) => [extractId(review.booking), review]));

  return bookings.map((booking) => {
    const review = reviewMap.get(extractId(booking)) || null;
    return {
      ...booking,
      reviewStatus: buildReviewStatus(booking, viewerUserId, review),
      review: review ? serializeReview(review) : null,
    };
  });
}

function serializeBookingReviewContext(booking) {
  const listingRecord =
    booking.listing && typeof booking.listing === 'object'
      ? serializeListingRecord(
          typeof booking.listing.toJSON === 'function' ? booking.listing.toJSON() : booking.listing
        )
      : null;

  return {
    booking: {
      id: extractId(booking),
      confirmationNumber: extractId(booking),
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      bookingType: booking.bookingType,
      startDate: booking.startDate,
      endDate: booking.endDate,
      startTime: booking.startTime || null,
      endTime: booking.endTime || null,
      numberOfGuests: booking.numberOfGuests || null,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      listing: listingRecord
        ? {
            id: listingRecord.id || extractId(booking.listing),
            title: listingRecord.basicInformation?.activityTitle || '',
            category: listingRecord.category || '',
            type: listingRecord.type || '',
            photos: listingRecord.photos || [],
          }
        : null,
      host: serializeUserSummary(booking.host),
    },
  };
}

async function loadBookingForReview(bookingId) {
  const booking = await Booking.findById(bookingId)
    .populate('listing')
    .populate('host', 'email role agencyName city providerProfile')
    .populate('bookedBy', 'email role agencyName city providerProfile');

  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  return booking;
}

async function getBookingReviewContext(bookingId, userId) {
  const booking = await loadBookingForReview(bookingId);

  if (extractId(booking.bookedBy) !== userId.toString()) {
    throw new ApiError(403, 'You are not allowed to review this booking.');
  }

  const review = await Review.findOne({ booking: booking._id, reviewer: userId }).populate(
    'reviewer',
    'email role agencyName city providerProfile'
  );

  return {
    ...serializeBookingReviewContext(booking),
    reviewStatus: buildReviewStatus(booking, userId, review),
    review: review ? serializeReview(review) : null,
  };
}

async function submitBookingReview(bookingId, userId, payload) {
  const booking = await loadBookingForReview(bookingId);

  if (extractId(booking.bookedBy) !== userId.toString()) {
    throw new ApiError(403, 'You are not allowed to review this booking.');
  }

  if (!isBookingReviewable(booking)) {
    throw new ApiError(
      400,
      'This booking is not ready for review yet. Reviews can only be submitted for active or completed reservations.'
    );
  }

  let review = await Review.findOne({ booking: booking._id, reviewer: userId });

  if (!review) {
    review = new Review({
      booking: booking._id,
      listing: booking.listing._id || booking.listing,
      host: booking.host._id || booking.host,
      reviewer: userId,
    });
  }

  review.overallRating = payload.overallRating;
  review.accuracy = payload.accuracy;
  review.quality = payload.quality;
  review.communication = payload.communication;
  review.value = payload.value;
  review.comment = payload.comment || '';

  await review.save();
  await review.populate('reviewer', 'email role agencyName city providerProfile');

  return {
    ...serializeBookingReviewContext(booking),
    reviewStatus: buildReviewStatus(booking, userId, review),
    review: serializeReview(review),
    listingReviewSummary: await getListingReviewSummary(booking.listing._id || booking.listing),
    hostReviewSummary: await getHostReviewSummary(booking.host._id || booking.host),
  };
}

async function listListingReviews(listingId, { page = 1, limit = 10 } = {}) {
  const listing = await Listing.findById(listingId).populate(
    'createdBy',
    'email role agencyName city providerProfile'
  );

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  const skip = (page - 1) * limit;
  const filter = { listing: listing._id };

  const [reviews, total, summary] = await Promise.all([
    Review.find(filter)
      .populate('reviewer', 'email role agencyName city providerProfile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments(filter),
    getListingReviewSummary(listing._id),
  ]);

  return {
    listing: serializeListingRecord(listing.toJSON()),
    summary,
    reviews: reviews.map((review) => serializeReview(review)),
    pagination: buildPagination(total, page, limit),
  };
}

async function listHostReviews(hostId, { page = 1, limit = 10 } = {}) {
  const host = await User.findById(hostId).select('email role agencyName city providerProfile');

  if (!host) {
    throw new ApiError(404, 'Provider not found.');
  }

  const skip = (page - 1) * limit;
  const filter = { host: host._id };

  const [reviews, total, summary] = await Promise.all([
    Review.find(filter)
      .populate('reviewer', 'email role agencyName city providerProfile')
      .populate('listing')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments(filter),
    getHostReviewSummary(host._id),
  ]);

  return {
    host: serializeUserSummary(host),
    summary,
    reviews: reviews.map((review) => {
      const serializedReview = serializeReview(review);
      return {
        ...serializedReview,
        listing:
          review.listing && typeof review.listing === 'object'
            ? {
                id: extractId(review.listing),
                title: review.listing.basicInformation?.activityTitle || '',
                photos: serializeListingRecord(review.listing.toJSON()).photos || [],
              }
            : serializedReview.listing,
      };
    }),
    pagination: buildPagination(total, page, limit),
  };
}

module.exports = {
  buildEmptyReviewSummary,
  buildListingReviewSummaryMap,
  buildHostReviewSummaryMap,
  attachReviewDataToBookings,
  getBookingReviewContext,
  submitBookingReview,
  listListingReviews,
  listHostReviews,
};
