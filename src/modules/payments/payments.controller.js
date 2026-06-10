const mongoose = require('mongoose');
const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const paymentsService = require('./payments.service');

function validateBookingId(bookingId) {
  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, 'Invalid booking ID.');
  }
  return bookingId;
}

const startOnboardingHandler = asyncHandler(async (req, res) => {
  const country = req.body && typeof req.body.country === 'string' ? req.body.country : null;
  const result = await paymentsService.createOnboardingLink(req.user._id, { country });
  res.status(200).json({
    success: true,
    message: 'Stripe onboarding link created.',
    data: result,
  });
});

const getConnectStatusHandler = asyncHandler(async (req, res) => {
  const status = await paymentsService.getConnectAccountStatus(req.user._id);
  res.status(200).json({
    success: true,
    message: 'Stripe Connect status fetched.',
    data: status,
  });
});

const createLoginLinkHandler = asyncHandler(async (req, res) => {
  const result = await paymentsService.createLoginLink(req.user._id);
  res.status(200).json({
    success: true,
    message: 'Stripe login link created.',
    data: result,
  });
});

const authorizeBookingPaymentHandler = asyncHandler(async (req, res) => {
  const bookingId = validateBookingId(req.params.bookingId);
  const paymentMethodId =
    req.body && typeof req.body.paymentMethodId === 'string'
      ? req.body.paymentMethodId
      : null;
  const result = await paymentsService.authorizeBookingPayment(
    bookingId,
    req.user,
    paymentMethodId
  );
  res.status(200).json({
    success: true,
    message: 'Card authorization initiated.',
    data: result,
  });
});

const refundBookingHandler = asyncHandler(async (req, res) => {
  const bookingId = validateBookingId(req.params.bookingId);
  const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason : null;
  const booking = await paymentsService.refundBooking(bookingId, req.user._id, reason);
  res.status(200).json({
    success: true,
    message: 'Booking refunded successfully.',
    data: { booking },
  });
});

module.exports = {
  startOnboardingHandler,
  getConnectStatusHandler,
  createLoginLinkHandler,
  authorizeBookingPaymentHandler,
  refundBookingHandler,
};
