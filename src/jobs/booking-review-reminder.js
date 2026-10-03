const Booking = require('../models/booking.model');
const { BOOKING_STATUS } = require('../constants/booking');
const { sendNotification } = require('../modules/notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../modules/notifications/notifications.validation');
const { getBookingCompletionAt, REVIEW_WINDOW_DAYS } = require('../modules/reviews/reviews.service')._private;

const RUN_INTERVAL_MS = 60 * 60 * 1000;

async function sendReviewReminders() {
  const now = new Date();
  const candidates = await Booking.find({
    status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] },
    reviewReminderSentAt: null,
  }).limit(100);

  for (const booking of candidates) {
    const completedAt = getBookingCompletionAt(booking);
    const closesAt = completedAt && new Date(completedAt.getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (!completedAt || completedAt > now || closesAt < now) continue;

    await sendNotification(booking.bookedBy, {
      type: NOTIFICATION_TYPES.BOOKING_REVIEW_REMINDER,
      title: 'How was your reservation?',
      body: `Leave a review within ${REVIEW_WINDOW_DAYS} days of the activity ending.`,
      data: { bookingId: booking._id.toString(), listingId: booking.listing?.toString() || '' },
    });
    booking.reviewReminderSentAt = now;
    await booking.save();
  }
}

function startBookingReviewReminderJob() {
  sendReviewReminders().catch((error) => console.error('Failed to send review reminders.', error));
  const handle = setInterval(() => {
    sendReviewReminders().catch((error) => console.error('Failed to send review reminders.', error));
  }, RUN_INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}

module.exports = { startBookingReviewReminderJob, sendReviewReminders };
