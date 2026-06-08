const stripe = require('../../services/stripe.client');
const env = require('../../config/env');
const User = require('../../models/user.model');
const Booking = require('../../models/booking.model');
const Listing = require('../../models/listing.model');
const ApiError = require('../../utils/api-error');
const {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  HOST_APPROVAL_WINDOW_DAYS,
} = require('../../constants/booking');
const { sendNotification } = require('../notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../notifications/notifications.validation');

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function toStripeAmount(amount, currency) {
  const upper = (currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) {
    return Math.round(Number(amount));
  }
  return Math.round(Number(amount) * 100);
}

function fromStripeAmount(amount, currency) {
  const upper = (currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) {
    return Number(amount);
  }
  return Number(amount) / 100;
}

function calculateApplicationFee(totalAmount, currency) {
  const percent = env.stripe.applicationFeePercent / 100;
  const fee = Number(totalAmount) * percent;
  return toStripeAmount(fee, currency);
}

function resolveOnboardingReturnUrl(userId) {
  return env.stripe.onboardingReturnUrl.replace('{USER_ID}', String(userId));
}

function resolveCheckoutUrls(bookingId) {
  return {
    successUrl: env.stripe.checkoutSuccessUrl.replace('{BOOKING_ID}', String(bookingId)),
    cancelUrl: env.stripe.checkoutCancelUrl.replace('{BOOKING_ID}', String(bookingId)),
  };
}

function normalizeCountryCode(country) {
  if (typeof country !== 'string') return '';
  const trimmed = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : '';
}

async function getOrCreateConnectedAccount(user, country) {
  if (user.stripeConnect && user.stripeConnect.accountId) {
    return user.stripeConnect.accountId;
  }

  const resolvedCountry = normalizeCountryCode(country) || env.stripe.connectCountry;

  const account = await stripe.accounts.create({
    type: 'express',
    country: resolvedCountry,
    email: user.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
    settings: {
      payouts: {
        schedule: {
          interval: 'daily',
          delay_days: env.stripe.payoutDelayDays,
        },
      },
    },
    metadata: {
      userId: String(user._id),
    },
  });

  user.stripeConnect = {
    ...(user.stripeConnect ? user.stripeConnect.toObject() : {}),
    accountId: account.id,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
  };
  await user.save();

  return account.id;
}

async function createOnboardingLink(userId, { country } = {}) {
  const user = await User.findById(userId).select('+stripeConnect email');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const hasExistingAccount = Boolean(user.stripeConnect && user.stripeConnect.accountId);
  if (!hasExistingAccount) {
    if (!normalizeCountryCode(country)) {
      throw new ApiError(
        400,
        'A valid ISO country code (e.g. "US", "GB") is required to start Stripe onboarding.'
      );
    }
  }

  const accountId = await getOrCreateConnectedAccount(user, country);

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: env.stripe.onboardingRefreshUrl,
    return_url: resolveOnboardingReturnUrl(userId),
    type: 'account_onboarding',
  });

  return {
    url: link.url,
    expiresAt: new Date(link.expires_at * 1000),
    accountId,
  };
}

async function getConnectAccountStatus(userId) {
  const user = await User.findById(userId).select('+stripeConnect');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (!user.stripeConnect || !user.stripeConnect.accountId) {
    return {
      hasAccount: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }

  const account = await stripe.accounts.retrieve(user.stripeConnect.accountId);

  user.stripeConnect.chargesEnabled = Boolean(account.charges_enabled);
  user.stripeConnect.payoutsEnabled = Boolean(account.payouts_enabled);
  user.stripeConnect.detailsSubmitted = Boolean(account.details_submitted);
  user.stripeConnect.disabledReason =
    (account.requirements && account.requirements.disabled_reason) || null;
  if (account.charges_enabled && !user.stripeConnect.onboardedAt) {
    user.stripeConnect.onboardedAt = new Date();
  }
  await user.save();

  return {
    hasAccount: true,
    accountId: account.id,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    disabledReason: user.stripeConnect.disabledReason,
    requirements: account.requirements || null,
  };
}

async function createLoginLink(userId) {
  const user = await User.findById(userId).select('+stripeConnect');
  if (!user || !user.stripeConnect || !user.stripeConnect.accountId) {
    throw new ApiError(400, 'Provider has not started Stripe onboarding.');
  }
  const link = await stripe.accounts.createLoginLink(user.stripeConnect.accountId);
  return { url: link.url };
}

async function createCheckoutSession(bookingId, guestUser) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  if (booking.bookedBy.toString() !== guestUser._id.toString()) {
    throw new ApiError(403, 'You are not allowed to pay for this booking.');
  }

  if (booking.paymentStatus === PAYMENT_STATUS.HELD) {
    throw new ApiError(400, 'Booking is already paid.');
  }
  if (booking.status === BOOKING_STATUS.CANCELLED) {
    throw new ApiError(400, 'Booking is cancelled.');
  }

  const [host, listing] = await Promise.all([
    User.findById(booking.host).select('+stripeConnect email'),
    Listing.findById(booking.listing),
  ]);

  if (!host || !host.stripeConnect || !host.stripeConnect.accountId) {
    throw new ApiError(400, 'Host has not connected a payment account.');
  }
  if (!host.stripeConnect.chargesEnabled) {
    throw new ApiError(400, 'Host payout account is not yet ready to accept payments.');
  }

  const currency = (booking.currency || 'USD').toLowerCase();
  const applicationFeeAmount = calculateApplicationFee(booking.totalAmount, currency);
  const { successUrl, cancelUrl } = resolveCheckoutUrls(booking._id);

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer_email: guestUser.email,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: toStripeAmount(booking.totalAmount, currency),
            product_data: {
              name: (listing && listing.title) || 'Funsival Booking',
              description: `Booking #${booking._id}`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        capture_method: 'manual',
        application_fee_amount: applicationFeeAmount,
        metadata: {
          bookingId: String(booking._id),
          guestId: String(guestUser._id),
          hostId: String(host._id),
        },
      },
      metadata: {
        bookingId: String(booking._id),
        guestId: String(guestUser._id),
        hostId: String(host._id),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    {
      stripeAccount: host.stripeConnect.accountId,
    }
  );

  booking.stripeAccountId = host.stripeConnect.accountId;
  booking.stripeCheckoutSessionId = session.id;
  booking.applicationFeeAmount = fromStripeAmount(applicationFeeAmount, currency);
  booking.paymentStatus = PAYMENT_STATUS.PROCESSING;
  await booking.save();

  return {
    url: session.url,
    sessionId: session.id,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
  };
}

async function markBookingPaid(booking, paymentIntent) {
  if (booking.paymentStatus === PAYMENT_STATUS.HELD) {
    return booking;
  }

  const payoutEligibleAt = new Date();
  payoutEligibleAt.setUTCDate(payoutEligibleAt.getUTCDate() + env.stripe.payoutDelayDays);

  booking.paymentStatus = PAYMENT_STATUS.HELD;
  booking.status = BOOKING_STATUS.CONFIRMED;
  booking.stripePaymentIntentId = paymentIntent.id;
  if (paymentIntent.latest_charge) {
    booking.stripeChargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge.id;
  }
  booking.paidAt = new Date();
  booking.acceptedAt = booking.acceptedAt || new Date();
  booking.payoutEligibleAt = payoutEligibleAt;
  await booking.save();

  sendNotification(booking.bookedBy, {
    type: NOTIFICATION_TYPES.BOOKING_ACCEPTED,
    title: 'Booking confirmed',
    body: 'The host accepted your booking and your card has been charged.',
    data: {
      bookingId: booking._id.toString(),
      listingId: booking.listing ? booking.listing.toString() : '',
    },
  }).catch((error) => console.error('Failed to notify guest of booking acceptance.', error));

  sendNotification(booking.host, {
    type: NOTIFICATION_TYPES.BOOKING_ACCEPTED,
    title: 'Booking accepted',
    body: `Payment of ${booking.currency} ${booking.totalAmount} captured. Funds will be paid out after the ${env.stripe.payoutDelayDays}-day hold.`,
    data: {
      bookingId: booking._id.toString(),
      listingId: booking.listing ? booking.listing.toString() : '',
      payoutEligibleAt: booking.payoutEligibleAt
        ? booking.payoutEligibleAt.toISOString()
        : null,
    },
  }).catch((error) => console.error('Failed to notify host of capture success.', error));

  return booking;
}

async function markBookingAuthorized(booking, paymentIntent) {
  if (booking.paymentStatus === PAYMENT_STATUS.AUTHORIZED) {
    return booking;
  }
  if (
    booking.paymentStatus === PAYMENT_STATUS.HELD ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASED ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDED
  ) {
    return booking;
  }

  const authExpiresAt = new Date();
  authExpiresAt.setUTCDate(authExpiresAt.getUTCDate() + HOST_APPROVAL_WINDOW_DAYS);

  booking.paymentStatus = PAYMENT_STATUS.AUTHORIZED;
  booking.status = BOOKING_STATUS.AWAITING_HOST_APPROVAL;
  booking.stripePaymentIntentId = paymentIntent.id;
  if (paymentIntent.latest_charge) {
    booking.stripeChargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge.id;
  }
  booking.authorizedAt = new Date();
  booking.authExpiresAt = authExpiresAt;
  await booking.save();

  try {
    const bookingsService = require('../bookings/bookings.service');
    await bookingsService.notifyHostOfBookingRequest(booking._id);
  } catch (error) {
    console.error('Failed to send booking-request host notification.', error);
  }

  sendNotification(booking.bookedBy, {
    type: NOTIFICATION_TYPES.BOOKING_REQUEST_SENT,
    title: 'Booking request sent',
    body: 'Your card has been authorized. Waiting for the host to accept — no charge yet.',
    data: {
      bookingId: booking._id.toString(),
      listingId: booking.listing ? booking.listing.toString() : '',
      authExpiresAt: booking.authExpiresAt ? booking.authExpiresAt.toISOString() : null,
    },
  }).catch((error) => console.error('Failed to notify guest of request sent.', error));

  return booking;
}

async function capturePaymentForBooking(bookingId, hostUserId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }
  if (booking.host.toString() !== hostUserId.toString()) {
    throw new ApiError(403, 'You are not allowed to accept this booking.');
  }
  if (booking.paymentStatus !== PAYMENT_STATUS.AUTHORIZED) {
    throw new ApiError(
      400,
      `Only authorized bookings can be captured. Current state: ${booking.paymentStatus}.`
    );
  }
  if (!booking.stripePaymentIntentId || !booking.stripeAccountId) {
    throw new ApiError(400, 'Booking is missing Stripe payment information.');
  }
  if (booking.authExpiresAt && booking.authExpiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      400,
      'The authorization window has expired. The guest needs to book again.'
    );
  }

  const paymentIntent = await stripe.paymentIntents.capture(
    booking.stripePaymentIntentId,
    {},
    { stripeAccount: booking.stripeAccountId }
  );

  await markBookingPaid(booking, paymentIntent);
  return booking;
}

async function cancelAuthorizationForBooking(bookingId, actorUserId, reason) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  const isHost = booking.host.toString() === actorUserId.toString();
  const isGuest = booking.bookedBy.toString() === actorUserId.toString();
  if (!isHost && !isGuest) {
    throw new ApiError(403, 'You are not allowed to cancel this booking.');
  }

  if (booking.paymentStatus !== PAYMENT_STATUS.AUTHORIZED) {
    throw new ApiError(
      400,
      `Only authorized bookings can be released. Current state: ${booking.paymentStatus}.`
    );
  }
  if (!booking.stripePaymentIntentId || !booking.stripeAccountId) {
    throw new ApiError(400, 'Booking is missing Stripe payment information.');
  }

  await stripe.paymentIntents.cancel(
    booking.stripePaymentIntentId,
    { cancellation_reason: 'requested_by_customer' },
    { stripeAccount: booking.stripeAccountId }
  );

  booking.paymentStatus = PAYMENT_STATUS.AUTH_RELEASED;
  booking.status = isHost ? BOOKING_STATUS.DECLINED : BOOKING_STATUS.CANCELLED;
  if (isHost) {
    booking.declinedAt = new Date();
    booking.declinedBy = actorUserId;
    booking.declineReason = reason || null;
  } else {
    booking.cancelledAt = new Date();
    booking.cancelledBy = actorUserId;
  }
  await booking.save();

  return { booking, isHost };
}

async function executeStripeRefund(booking, adminUserId, reason) {
  if (booking.paymentStatus !== PAYMENT_STATUS.HELD) {
    throw new ApiError(
      400,
      'Only bookings in the held state can be refunded. Current state: ' + booking.paymentStatus
    );
  }

  if (!booking.stripePaymentIntentId || !booking.stripeAccountId) {
    throw new ApiError(400, 'Booking is missing Stripe payment information.');
  }

  if (booking.payoutEligibleAt && booking.payoutEligibleAt.getTime() <= Date.now()) {
    throw new ApiError(
      400,
      'The payout hold window has passed. Funds have already been released to the provider.'
    );
  }

  const refund = await stripe.refunds.create(
    {
      payment_intent: booking.stripePaymentIntentId,
      refund_application_fee: true,
      reason: reason && ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)
        ? reason
        : 'requested_by_customer',
      metadata: {
        bookingId: String(booking._id),
        adminId: String(adminUserId),
      },
    },
    {
      stripeAccount: booking.stripeAccountId,
    }
  );

  booking.paymentStatus = PAYMENT_STATUS.REFUNDED;
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.stripeRefundId = refund.id;
  booking.refundedAt = new Date();
  booking.refundedBy = adminUserId;
  booking.refundReason = reason || null;
  booking.cancelledAt = new Date();
  booking.cancelledBy = adminUserId;
  await booking.save();

  return { booking, refund };
}

async function refundBooking(bookingId, adminUserId, reason) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  await executeStripeRefund(booking, adminUserId, reason);

  sendNotification(booking.bookedBy, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: 'Your booking has been refunded',
    body: 'A refund has been issued for your booking. It may take 5-10 days to appear on your card.',
    data: { bookingId: booking._id.toString() },
  }).catch((error) => console.error('Failed to notify guest of refund.', error));

  sendNotification(booking.host, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: 'Booking refunded by admin',
    body: 'A booking on your listing has been refunded by Funsival support.',
    data: { bookingId: booking._id.toString() },
  }).catch((error) => console.error('Failed to notify host of refund.', error));

  return booking.toJSON();
}

async function syncConnectedAccountFromEvent(account) {
  if (!account || !account.id) return;
  const user = await User.findOne({ 'stripeConnect.accountId': account.id }).select(
    '+stripeConnect'
  );
  if (!user) return;

  user.stripeConnect.chargesEnabled = Boolean(account.charges_enabled);
  user.stripeConnect.payoutsEnabled = Boolean(account.payouts_enabled);
  user.stripeConnect.detailsSubmitted = Boolean(account.details_submitted);
  user.stripeConnect.disabledReason =
    (account.requirements && account.requirements.disabled_reason) || null;
  if (account.charges_enabled && !user.stripeConnect.onboardedAt) {
    user.stripeConnect.onboardedAt = new Date();
  }
  await user.save();
}

async function handlePaymentIntentSucceeded(paymentIntent) {
  const bookingId =
    paymentIntent.metadata && paymentIntent.metadata.bookingId
      ? paymentIntent.metadata.bookingId
      : null;
  if (!bookingId) return;

  const booking = await Booking.findById(bookingId);
  if (!booking) return;

  await markBookingPaid(booking, paymentIntent);
}

async function handlePaymentIntentAuthorized(paymentIntent) {
  const bookingId =
    paymentIntent.metadata && paymentIntent.metadata.bookingId
      ? paymentIntent.metadata.bookingId
      : null;
  if (!bookingId) return;

  const booking = await Booking.findById(bookingId);
  if (!booking) return;

  await markBookingAuthorized(booking, paymentIntent);
}

async function handlePaymentIntentCanceled(paymentIntent) {
  const bookingId =
    paymentIntent.metadata && paymentIntent.metadata.bookingId
      ? paymentIntent.metadata.bookingId
      : null;
  if (!bookingId) return;

  const booking = await Booking.findById(bookingId);
  if (!booking) return;

  if (
    booking.paymentStatus === PAYMENT_STATUS.AUTH_RELEASED ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDED ||
    booking.paymentStatus === PAYMENT_STATUS.HELD
  ) {
    return;
  }

  booking.paymentStatus = PAYMENT_STATUS.AUTH_RELEASED;
  if (
    booking.status !== BOOKING_STATUS.DECLINED &&
    booking.status !== BOOKING_STATUS.CANCELLED
  ) {
    booking.status = BOOKING_STATUS.CANCELLED;
    booking.cancelledAt = booking.cancelledAt || new Date();
  }
  await booking.save();
}

async function handleChargeRefunded(charge) {
  if (!charge || !charge.payment_intent) return;
  const booking = await Booking.findOne({ stripePaymentIntentId: charge.payment_intent });
  if (!booking) return;
  if (booking.paymentStatus === PAYMENT_STATUS.REFUNDED) return;

  booking.paymentStatus = PAYMENT_STATUS.REFUNDED;
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.refundedAt = booking.refundedAt || new Date();
  await booking.save();
}

async function handleChargeDispute(dispute) {
  if (!dispute || !dispute.payment_intent) return;
  const booking = await Booking.findOne({ stripePaymentIntentId: dispute.payment_intent });
  if (!booking) return;

  booking.paymentStatus = PAYMENT_STATUS.DISPUTED;
  booking.stripeDisputeId = dispute.id;
  await booking.save();
}

async function handlePayoutPaid(payout) {
  // When a payout actually leaves Stripe and lands in the provider's bank,
  // mark any held bookings whose hold window has elapsed as released.
  const now = new Date();
  const filter = {
    paymentStatus: PAYMENT_STATUS.HELD,
    payoutEligibleAt: { $lte: now },
    stripeAccountId: payout.destination ? String(payout.destination) : { $exists: true },
  };

  const releasedBookings = await Booking.find(filter).select(
    '_id host listing currency totalAmount'
  );

  if (releasedBookings.length === 0) return;

  await Booking.updateMany(filter, { $set: { paymentStatus: PAYMENT_STATUS.RELEASED } });

  for (const booking of releasedBookings) {
    sendNotification(booking.host, {
      type: NOTIFICATION_TYPES.BOOKING_PAYOUT_RELEASED,
      title: 'Payout released',
      body: `Your payout of ${booking.currency} ${booking.totalAmount} is on its way to your bank.`,
      data: {
        bookingId: booking._id.toString(),
        listingId: booking.listing ? booking.listing.toString() : '',
      },
    }).catch((error) => console.error('Failed to notify host of payout release.', error));
  }
}

module.exports = {
  createOnboardingLink,
  getConnectAccountStatus,
  createLoginLink,
  createCheckoutSession,
  capturePaymentForBooking,
  cancelAuthorizationForBooking,
  refundBooking,
  executeStripeRefund,
  syncConnectedAccountFromEvent,
  handlePaymentIntentSucceeded,
  handlePaymentIntentAuthorized,
  handlePaymentIntentCanceled,
  handleChargeRefunded,
  handleChargeDispute,
  handlePayoutPaid,
};
