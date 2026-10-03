const Booking = require('../models/booking.model');
const { BOOKING_STATUS } = require('../constants/booking');

const RUN_INTERVAL_MS = 5 * 60 * 1000;

function getBookingCompletionAt(booking) {
  const date = new Date(booking?.endDate || booking?.startDate);
  if (Number.isNaN(date.getTime())) return null;

  const match = /^(\d{2}):(\d{2})$/.exec(String(booking?.endTime || '23:59'));
  date.setUTCHours(match ? Number(match[1]) : 23, match ? Number(match[2]) : 59, 0, 0);
  return date;
}

async function completeEndedBookings(now = new Date()) {
  // Completion follows the reservation end, independently of the payout hold.
  const candidates = await Booking.find({
    status: BOOKING_STATUS.CONFIRMED,
    $or: [
      { endDate: { $lte: now } },
      { endDate: null, startDate: { $lte: now } },
    ],
  }).limit(500);

  let completed = 0;
  for (const booking of candidates) {
    const completedAt = getBookingCompletionAt(booking);
    if (!completedAt || completedAt > now) continue;

    const result = await Booking.updateOne(
      { _id: booking._id, status: BOOKING_STATUS.CONFIRMED },
      { $set: { status: BOOKING_STATUS.COMPLETED } }
    );
    completed += result.modifiedCount || 0;
  }
  return completed;
}

function startBookingCompletionJob() {
  completeEndedBookings().catch((error) =>
    console.error('Failed to complete ended bookings.', error)
  );
  const handle = setInterval(() => {
    completeEndedBookings().catch((error) =>
      console.error('Failed to complete ended bookings.', error)
    );
  }, RUN_INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}

module.exports = {
  startBookingCompletionJob,
  completeEndedBookings,
  getBookingCompletionAt,
};
