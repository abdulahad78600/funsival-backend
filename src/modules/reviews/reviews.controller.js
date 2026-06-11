const asyncHandler = require('../../utils/async-handler');
const {
  validateObjectId,
  validateSubmitReviewPayload,
  validatePaginationQuery,
} = require('./reviews.validation');
const {
  getBookingReviewContext,
  submitBookingReview,
  listListingReviews,
  listHostReviews,
} = require('./reviews.service');

const getMyBookingReviewHandler = asyncHandler(async (req, res) => {
  const bookingId = validateObjectId(req.params.bookingId, 'booking ID');
  const result = await getBookingReviewContext(bookingId, req.user._id);

  res.status(200).json({
    success: true,
    message: 'Booking review context fetched successfully.',
    data: result,
  });
});

const submitBookingReviewHandler = asyncHandler(async (req, res) => {
  const bookingId = validateObjectId(req.params.bookingId, 'booking ID');
  const payload = validateSubmitReviewPayload(req.body);
  const result = await submitBookingReview(bookingId, req.user._id, payload);

  res.status(200).json({
    success: true,
    message: 'Review submitted successfully.',
    data: result,
  });
});

const listListingReviewsHandler = asyncHandler(async (req, res) => {
  const listingId = validateObjectId(req.params.listingId, 'listing ID');
  const pagination = validatePaginationQuery(req.query);
  const result = await listListingReviews(listingId, pagination);

  res.status(200).json({
    success: true,
    message: 'Listing reviews fetched successfully.',
    data: result,
  });
});

const listHostReviewsHandler = asyncHandler(async (req, res) => {
  const hostId = validateObjectId(req.params.hostId, 'provider ID');
  const pagination = validatePaginationQuery(req.query);
  const result = await listHostReviews(hostId, pagination);

  res.status(200).json({
    success: true,
    message: 'Provider reviews fetched successfully.',
    data: result,
  });
});

module.exports = {
  getMyBookingReviewHandler,
  submitBookingReviewHandler,
  listListingReviewsHandler,
  listHostReviewsHandler,
};
