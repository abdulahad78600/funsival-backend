const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const reviewsService = require('../src/modules/reviews/reviews.service');
const Review = require('../src/models/review.model');
const Booking = require('../src/models/booking.model');
const Listing = require('../src/models/listing.model');

function chainableQuery(result) {
  const query = {
    populate: () => query,
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

test('bookings are reviewable once confirmed or completed, never while pending/declined/cancelled', () => {
  const { isBookingReviewable } = reviewsService._private;
  assert.equal(isBookingReviewable({ status: 'confirmed' }), true);
  assert.equal(isBookingReviewable({ status: 'completed' }), true);
  assert.equal(isBookingReviewable({ status: 'pending' }), false);
  assert.equal(isBookingReviewable({ status: 'awaiting_host_approval' }), false);
  assert.equal(isBookingReviewable({ status: 'declined' }), false);
  assert.equal(isBookingReviewable({ status: 'cancelled' }), false);
});

test('review status tells the UI whether to show Write / Edit / nothing', () => {
  const { buildReviewStatus } = reviewsService._private;
  const guest = new mongoose.Types.ObjectId();
  const booking = { bookedBy: guest, status: 'completed' };

  const fresh = buildReviewStatus(booking, guest, null);
  assert.equal(fresh.canSubmit, true);
  assert.equal(fresh.canEdit, false);
  assert.equal(fresh.reason, null);

  const submitted = buildReviewStatus(booking, guest, { _id: 'r1', createdAt: 'x' });
  assert.equal(submitted.canSubmit, false);
  assert.equal(submitted.canEdit, true);
  assert.equal(submitted.reviewId, 'r1');

  const stranger = buildReviewStatus(booking, new mongoose.Types.ObjectId(), null);
  assert.equal(stranger.canSubmit, false);
  assert.equal(stranger.reason, 'only_booking_guest_can_review');

  const pending = buildReviewStatus({ ...booking, status: 'pending' }, guest, null);
  assert.equal(pending.canSubmit, false);
  assert.equal(pending.reason, 'booking_not_reviewable');
});

test('rating distribution is always 5→1 with zero-filled bars and percentages', () => {
  const { buildRatingDistribution } = reviewsService._private;
  const dist = buildRatingDistribution([
    { _id: 5, count: 6 },
    { _id: 4, count: 3 },
    { _id: 1, count: 1 },
  ]);
  assert.deepEqual(dist, [
    { stars: 5, count: 6, percentage: 60 },
    { stars: 4, count: 3, percentage: 30 },
    { stars: 3, count: 0, percentage: 0 },
    { stars: 2, count: 0, percentage: 0 },
    { stars: 1, count: 1, percentage: 10 },
  ]);
  assert.deepEqual(buildRatingDistribution([]).map((d) => d.percentage), [0, 0, 0, 0, 0]);
});

test('listing reviews include summary, distribution, reviewer info, and pagination', async () => {
  const listingId = new mongoose.Types.ObjectId();
  const reviewerId = new mongoose.Types.ObjectId();
  const listingDoc = {
    _id: listingId,
    toJSON: () => ({ id: listingId.toString(), basicInformation: { activityTitle: 'Dirt Bike' }, photos: [] }),
  };
  const reviewDoc = {
    reviewer: { _id: reviewerId, email: 'sam@example.com', role: 'user', providerProfile: { firstName: 'Sam', lastName: 'Lee' } },
    toJSON: () => ({
      id: 'rev1',
      booking: 'b1',
      listing: listingId,
      host: 'h1',
      reviewer: reviewerId,
      overallRating: 5,
      accuracy: 5,
      quality: 4,
      communication: 5,
      value: 4,
      comment: 'Great ride!',
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
  };

  const originalFindById = Listing.findById;
  const originalFind = Review.find;
  const originalCount = Review.countDocuments;
  const originalAggregate = Review.aggregate;

  Listing.findById = () => ({ populate: async () => listingDoc });
  Review.find = () => chainableQuery([reviewDoc]);
  Review.countDocuments = async () => 42;
  Review.aggregate = async (pipeline) => {
    const group = pipeline[1].$group;
    if (group._id && typeof group._id === 'object' && group._id.$round) {
      return [{ _id: 5, count: 30 }, { _id: 4, count: 12 }];
    }
    return [{ _id: listingId, count: 42, overallRating: 4.71, accuracy: 4.8, quality: 4.6, communication: 4.7, value: 4.5 }];
  };

  try {
    const result = await reviewsService.listListingReviews(listingId.toString(), { page: 1, limit: 10 });

    assert.equal(result.listing.id, listingId.toString());
    assert.equal(result.summary.count, 42);
    assert.equal(result.summary.overallRating, 4.7);
    assert.deepEqual(result.summary.distribution.slice(0, 2), [
      { stars: 5, count: 30, percentage: 71.4 },
      { stars: 4, count: 12, percentage: 28.6 },
    ]);
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].comment, 'Great ride!');
    assert.equal(result.reviews[0].reviewer.id, reviewerId.toString());
    assert.equal(result.pagination.total, 42);
    assert.equal(result.pagination.totalPages, 5);
  } finally {
    Listing.findById = originalFindById;
    Review.find = originalFind;
    Review.countDocuments = originalCount;
    Review.aggregate = originalAggregate;
  }
});

test('a guest can delete their own review; strangers and missing reviews are rejected', async () => {
  const guest = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const hostId = new mongoose.Types.ObjectId();
  const bookingDoc = {
    _id: new mongoose.Types.ObjectId(),
    bookedBy: { _id: guest },
    host: { _id: hostId },
    listing: { _id: listingId, toJSON: () => ({ id: listingId.toString(), photos: [] }) },
    status: 'completed',
  };

  const originalFindById = Booking.findById;
  const originalFindOneAndDelete = Review.findOneAndDelete;
  const originalAggregate = Review.aggregate;

  Booking.findById = () => chainableQuery(bookingDoc);
  Review.aggregate = async () => [];

  try {
    Review.findOneAndDelete = async () => ({ _id: 'rev1' });
    const result = await reviewsService.deleteBookingReview(bookingDoc._id.toString(), guest);
    assert.equal(result.review, null);
    assert.equal(result.reviewStatus.canSubmit, true);
    assert.equal(result.reviewStatus.hasSubmitted, false);
    assert.equal(result.listingReviewSummary.count, 0);

    Review.findOneAndDelete = async () => null;
    await assert.rejects(
      () => reviewsService.deleteBookingReview(bookingDoc._id.toString(), guest),
      /Review not found/
    );
    await assert.rejects(
      () => reviewsService.deleteBookingReview(bookingDoc._id.toString(), new mongoose.Types.ObjectId()),
      /not allowed/
    );
  } finally {
    Booking.findById = originalFindById;
    Review.findOneAndDelete = originalFindOneAndDelete;
    Review.aggregate = originalAggregate;
  }
});
