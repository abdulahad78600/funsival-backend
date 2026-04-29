const asyncHandler = require('../../utils/async-handler');
const {
  validateBookingId,
  validateCreateBookingPayload,
} = require('./bookings.validation');
const {
  createBooking,
  getBookingsForGuest,
  getBookingsForHost,
  getBookingByIdForUser,
  cancelBooking,
} = require('./bookings.service');

function parsePaginationQuery(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit };
}

const createBookingHandler = asyncHandler(async (req, res) => {
  const payload = validateCreateBookingPayload(req.body);
  const booking = await createBooking(payload, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Booking created successfully.',
    data: { booking },
  });
});

const getMyBookingsHandler = asyncHandler(async (req, res) => {
  const pagination = parsePaginationQuery(req.query);
  const result = await getBookingsForGuest(req.user.id, pagination);

  res.status(200).json({
    success: true,
    message: 'Bookings fetched successfully.',
    data: result,
  });
});

const getHostBookingsHandler = asyncHandler(async (req, res) => {
  const pagination = parsePaginationQuery(req.query);
  const result = await getBookingsForHost(req.user.id, pagination);

  res.status(200).json({
    success: true,
    message: 'Host bookings fetched successfully.',
    data: result,
  });
});

const getBookingByIdHandler = asyncHandler(async (req, res) => {
  const bookingId = validateBookingId(req.params.bookingId);
  const booking = await getBookingByIdForUser(bookingId, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Booking fetched successfully.',
    data: { booking },
  });
});

const cancelBookingHandler = asyncHandler(async (req, res) => {
  const bookingId = validateBookingId(req.params.bookingId);
  const booking = await cancelBooking(bookingId, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Booking cancelled successfully.',
    data: { booking },
  });
});

module.exports = {
  createBookingHandler,
  getMyBookingsHandler,
  getHostBookingsHandler,
  getBookingByIdHandler,
  cancelBookingHandler,
};
