const Booking = require('../models/booking.model');
const {
  BOOKING_STATUS,
  PAYMENT_STATUS,
} = require('../constants/booking');
const paymentsService = require('../modules/payments/payments.service');
const { sendNotification } = require('../modules/notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../modules/notifications/notifications.validation');
const { hasBookingDatePassed } = require('../utils/booking-clock');

const RUN_INTERVAL_MS = 60 * 1000;
const EXPIRY_BUFFER_MS = 12 * 60 * 60 * 1000; // act 12h before Stripe auto-voids
const REMINDER_WINDOW_MS = 36 * 60 * 60 * 1000; // remind starting 36h before expiry
const STALE_UNPAID_MAX_AGE_MS = 30 * 60 * 1000; // give abandoned checkouts 30 min

async function remindHostsOfPendingAuthorizations() {
  const now = Date.now();
  const reminderCutoff = new Date(now + REMINDER_WINDOW_MS);
  const expiryCutoff = new Date(now + EXPIRY_BUFFER_MS);

  const bookings = await Booking.find({
    status: BOOKING_STATUS.AWAITING_HOST_APPROVAL,
    paymentStatus: PAYMENT_STATUS.AUTHORIZED,
    authExpiresAt: { $gt: expiryCutoff, $lte: reminderCutoff },
    requestReminderSentAt: null,
  }).limit(50);

  for (const booking of bookings) {
    const hoursLeft = Math.max(
      1,
      Math.ceil((booking.authExpiresAt.getTime() - now) / (1000 * 60 * 60))
    );

    sendNotification(booking.host, {
      type: NOTIFICATION_TYPES.BOOKING_REQUEST_REMINDER,
      title: 'Booking request expiring soon',
      body: `Action needed: this booking request will auto-decline in about ${hoursLeft} hours.`,
      data: {
        bookingId: booking._id.toString(),
        listingId: booking.listing ? booking.listing.toString() : '',
        authExpiresAt: booking.authExpiresAt.toISOString(),
      },
    }).catch((error) =>
      console.error('Failed to send booking-request reminder.', error)
    );

    booking.requestReminderSentAt = new Date();
    await booking.save();
  }
}

async function expirePendingAuthorizations(now = new Date()) {
  const cutoff = new Date(now.getTime() + EXPIRY_BUFFER_MS);

  const bookings = await Booking.find({
    status: BOOKING_STATUS.AWAITING_HOST_APPROVAL,
    paymentStatus: PAYMENT_STATUS.AUTHORIZED,
    $or: [
      { authExpiresAt: { $lte: cutoff } },
      // Include all possible local dates; the exact cutoff is checked below.
      { startDate: { $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) } },
    ],
  }).populate('listing', 'timeZone placeLocation').sort({ startDate: 1 }).limit(500);

  for (const booking of bookings) {
    const datePassed = hasBookingDatePassed(booking, booking.listing, now);
    const authorizationExpiring = booking.authExpiresAt && booking.authExpiresAt <= cutoff;
    if (!datePassed && !authorizationExpiring) continue;
    const listingId = (booking.listing?._id || booking.listing?.id || booking.listing)?.toString() || '';
    try {
      await paymentsService.cancelAuthorizationForBooking(
        booking._id,
        booking.host,
        datePassed
          ? 'Automatically rejected: booking date passed without provider acceptance.'
          : 'Auto-declined: host did not respond in time.'
      );

      sendNotification(booking.bookedBy, {
        type: NOTIFICATION_TYPES.BOOKING_DECLINED,
        title: 'Booking rejected',
        body: datePassed
          ? 'The booking date passed without provider acceptance. Your card authorization was released.'
          : 'The host did not respond in time. Your card was not charged.',
        data: {
          bookingId: booking._id.toString(),
          listingId,
        },
      }).catch((error) => console.error('Failed to notify guest of auto-decline.', error));

      sendNotification(booking.host, {
        type: NOTIFICATION_TYPES.BOOKING_DECLINED,
        title: 'Booking request rejected',
        body: datePassed
          ? 'The booking date passed without your acceptance. The request was automatically rejected.'
          : 'A booking request expired because it was not answered in time.',
        data: {
          bookingId: booking._id.toString(),
          listingId,
        },
      }).catch((error) => console.error('Failed to notify host of auto-decline.', error));
    } catch (error) {
      console.error(`Failed to auto-decline booking ${booking._id}:`, error.message || error);
    }
  }
}

// PENDING bookings whose payment never completed (declined card, abandoned
// checkout, server crash mid-request) still count as active in the slot
// conflict checks. Cancel them once they are clearly abandoned so the time
// slots they were holding open up again.
async function cancelStaleUnpaidBookings() {
  const cutoff = new Date(Date.now() - STALE_UNPAID_MAX_AGE_MS);

  const bookings = await Booking.find({
    status: BOOKING_STATUS.PENDING,
    paymentStatus: {
      $in: [PAYMENT_STATUS.REQUIRES_PAYMENT, PAYMENT_STATUS.FAILED],
    },
    createdAt: { $lte: cutoff },
  }).limit(100);

  for (const booking of bookings) {
    try {
      booking.status = BOOKING_STATUS.CANCELLED;
      booking.cancelledAt = booking.cancelledAt || new Date();
      await booking.save();
    } catch (error) {
      console.error(
        `Failed to cancel stale unpaid booking ${booking._id}:`,
        error.message || error
      );
    }
  }
}

async function runOnce() {
  await remindHostsOfPendingAuthorizations();
  await expirePendingAuthorizations();
  await cancelStaleUnpaidBookings();
}

function startBookingAuthExpiryJob() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      console.error('booking-auth-expiry run failed:', error);
    } finally {
      running = false;
    }
  }
  tick();
  const handle = setInterval(tick, RUN_INTERVAL_MS);

  if (typeof handle.unref === 'function') {
    handle.unref();
  }

  return handle;
}

module.exports = {
  startBookingAuthExpiryJob,
  expirePendingAuthorizations,
  remindHostsOfPendingAuthorizations,
  cancelStaleUnpaidBookings,
};
