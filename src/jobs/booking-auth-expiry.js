const Booking = require('../models/booking.model');
const {
  BOOKING_STATUS,
  PAYMENT_STATUS,
} = require('../constants/booking');
const paymentsService = require('../modules/payments/payments.service');
const { sendNotification } = require('../modules/notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../modules/notifications/notifications.validation');

const RUN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const EXPIRY_BUFFER_MS = 12 * 60 * 60 * 1000; // act 12h before Stripe auto-voids
const REMINDER_WINDOW_MS = 36 * 60 * 60 * 1000; // remind starting 36h before expiry

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

async function expirePendingAuthorizations() {
  const cutoff = new Date(Date.now() + EXPIRY_BUFFER_MS);

  const bookings = await Booking.find({
    status: BOOKING_STATUS.AWAITING_HOST_APPROVAL,
    paymentStatus: PAYMENT_STATUS.AUTHORIZED,
    authExpiresAt: { $lte: cutoff },
  }).limit(50);

  for (const booking of bookings) {
    try {
      await paymentsService.cancelAuthorizationForBooking(
        booking._id,
        booking.host,
        'Auto-declined: host did not respond in time.'
      );

      sendNotification(booking.bookedBy, {
        type: NOTIFICATION_TYPES.BOOKING_DECLINED,
        title: 'Booking expired',
        body: 'The host did not respond in time. Your card was not charged.',
        data: {
          bookingId: booking._id.toString(),
          listingId: booking.listing ? booking.listing.toString() : '',
        },
      }).catch((error) => console.error('Failed to notify guest of auto-decline.', error));

      sendNotification(booking.host, {
        type: NOTIFICATION_TYPES.BOOKING_DECLINED,
        title: 'Booking request expired',
        body: 'A booking request expired because it was not answered in time.',
        data: {
          bookingId: booking._id.toString(),
          listingId: booking.listing ? booking.listing.toString() : '',
        },
      }).catch((error) => console.error('Failed to notify host of auto-decline.', error));
    } catch (error) {
      console.error(`Failed to auto-decline booking ${booking._id}:`, error.message || error);
    }
  }
}

async function runOnce() {
  await remindHostsOfPendingAuthorizations();
  await expirePendingAuthorizations();
}

function startBookingAuthExpiryJob() {
  runOnce().catch((error) =>
    console.error('booking-auth-expiry initial run failed:', error)
  );

  const handle = setInterval(() => {
    runOnce().catch((error) =>
      console.error('booking-auth-expiry interval run failed:', error)
    );
  }, RUN_INTERVAL_MS);

  if (typeof handle.unref === 'function') {
    handle.unref();
  }

  return handle;
}

module.exports = {
  startBookingAuthExpiryJob,
  expirePendingAuthorizations,
  remindHostsOfPendingAuthorizations,
};
