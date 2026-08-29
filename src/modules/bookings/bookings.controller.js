const asyncHandler = require('../../utils/async-handler');
const {
  validateBookingId,
  validateCreateBookingPayload,
  validateHostBookingsQuery,
  validateGuestBookingsQuery,
} = require('./bookings.validation');
const {
  createBooking,
  getBookingQuote,
  getBookingsForGuest,
  getBookingsForHost,
  getHostReservationStats,
  exportHostBookingsCsv,
  getBookingByIdForUser,
  cancelBooking,
  acceptBookingRequest,
  declineBookingRequest,
} = require('./bookings.service');

const createBookingHandler = asyncHandler(async (req, res) => {
  const payload = validateCreateBookingPayload(req.body);
  const result = await createBooking(payload, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Booking created. Complete payment via the returned checkout URL.',
    data: result,
  });
});

const getBookingQuoteHandler = asyncHandler(async (req, res) => {
  const payload = validateCreateBookingPayload(req.body);
  const quote = await getBookingQuote(payload, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Booking quote generated successfully.',
    data: quote,
  });
});

const getMyBookingsHandler = asyncHandler(async (req, res) => {
  const query = validateGuestBookingsQuery(req.query);
  const result = await getBookingsForGuest(req.user.id, query);

  res.status(200).json({
    success: true,
    message: 'Bookings fetched successfully.',
    data: result,
  });
});

const getHostBookingsHandler = asyncHandler(async (req, res) => {
  const query = validateHostBookingsQuery(req.query);
  const result = await getBookingsForHost(req.user.id, query);

  res.status(200).json({
    success: true,
    message: 'Host bookings fetched successfully.',
    data: result,
  });
});

const getHostReservationStatsHandler = asyncHandler(async (req, res) => {
  const stats = await getHostReservationStats(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Reservation stats fetched successfully.',
    data: stats,
  });
});

const exportHostBookingsHandler = asyncHandler(async (req, res) => {
  const query = validateHostBookingsQuery(req.query);
  const csv = await exportHostBookingsCsv(req.user.id, query);
  const fileDate = new Date().toISOString().slice(0, 10);

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="funsival-reservations-${fileDate}.csv"`
  );
  res.send(csv);
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

const acceptBookingHandler = asyncHandler(async (req, res) => {
  const bookingId = validateBookingId(req.params.bookingId);
  const booking = await acceptBookingRequest(bookingId, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Booking accepted. Guest card has been charged.',
    data: { booking },
  });
});

const declineBookingHandler = asyncHandler(async (req, res) => {
  const bookingId = validateBookingId(req.params.bookingId);
  const reason =
    typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null;
  const booking = await declineBookingRequest(bookingId, req.user.id, reason || null);

  res.status(200).json({
    success: true,
    message: 'Booking declined. Guest authorization has been released.',
    data: { booking },
  });
});

module.exports = {
  createBookingHandler,
  getBookingQuoteHandler,
  getMyBookingsHandler,
  getHostBookingsHandler,
  getHostReservationStatsHandler,
  exportHostBookingsHandler,
  getBookingByIdHandler,
  cancelBookingHandler,
  acceptBookingHandler,
  declineBookingHandler,
};
