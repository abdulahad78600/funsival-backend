const Booking = require("../models/booking.model");
const { BOOKING_STATUS } = require("../constants/booking");
const { calendarDate, resolveListingTimeZone, localBookingInstant } = require('../utils/booking-clock');

const RUN_INTERVAL_MS = 60 * 1000;

function getBookingCompletionAt(booking) {
  const date = new Date(booking?.endDate || booking?.startDate);
  if (Number.isNaN(date.getTime())) return null;

  const endTime = booking.slots?.length
    ? booking.slots.map(slot => slot.endTime).filter(Boolean).sort().at(-1)
    : booking.endTime;
  return localBookingInstant(calendarDate(date), endTime || '23:59', resolveListingTimeZone(booking.listing || {}));
}

async function completeEndedBookings(now = new Date()) {
  const candidateCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const candidates = await Booking.find({
    status: BOOKING_STATUS.CONFIRMED,
    $or: [
      { endDate: { $lte: candidateCutoff } },
      { endDate: null, startDate: { $lte: candidateCutoff } },
    ],
  }).populate('listing', 'timeZone placeLocation').limit(500);

  let completed = 0;
  for (const booking of candidates) {
    const completedAt = getBookingCompletionAt(booking);
    if (!completedAt || completedAt > now) continue;

    const result = await Booking.updateOne(
      { _id: booking._id, status: BOOKING_STATUS.CONFIRMED },
      { $set: { status: BOOKING_STATUS.COMPLETED } },
    );
    completed += result.modifiedCount || 0;
  }
  return completed;
}

function startBookingCompletionJob() {
  completeEndedBookings().catch((error) =>
    console.error("Failed to complete ended bookings.", error),
  );
  const handle = setInterval(() => {
    completeEndedBookings().catch((error) =>
      console.error("Failed to complete ended bookings.", error),
    );
  }, RUN_INTERVAL_MS);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

module.exports = {
  startBookingCompletionJob,
  completeEndedBookings,
  getBookingCompletionAt,
};
