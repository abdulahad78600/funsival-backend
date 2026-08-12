const stripe = require('../../services/stripe.client');
const env = require('../../config/env');
const User = require('../../models/user.model');
const Booking = require('../../models/booking.model');
const Listing = require('../../models/listing.model');
const Withdrawal = require('../../models/withdrawal.model');
const RefundRequest = require('../../models/refund-request.model');
const ApiError = require('../../utils/api-error');
const {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYMENT_FLOW,
  HOST_APPROVAL_WINDOW_DAYS,
  WITHDRAWAL_STATUS,
  REFUND_REQUEST_STATUS,
} = require('../../constants/booking');
const { sendNotification } = require('../notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../notifications/notifications.validation');

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EARNING_PAYMENT_STATUSES = [
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.REFUNDING,
  PAYMENT_STATUS.RELEASING,
  PAYMENT_STATUS.RELEASED,
];
const EARNING_TRANSACTION_STATUSES = [
  ...EARNING_PAYMENT_STATUSES,
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.DISPUTED,
];

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
  const configuredPercent = Number(env.stripe.applicationFeePercent);
  const percent = Math.min(
    100,
    Math.max(0, Number.isFinite(configuredPercent) ? configuredPercent : 10)
  ) / 100;
  const fee = Number(totalAmount) * percent;
  return toStripeAmount(fee, currency);
}

function calculatePaymentSplit(totalAmount, currency) {
  const total = toStripeAmount(totalAmount, currency);
  const applicationFee = Math.min(total, calculateApplicationFee(totalAmount, currency));
  return {
    total,
    applicationFee,
    merchant: Math.max(0, total - applicationFee),
  };
}

function calculatePayoutEligibleAt(paidAt, delayDays = env.stripe.payoutDelayDays) {
  const paidAtDate = paidAt instanceof Date ? paidAt : new Date(paidAt);
  return new Date(paidAtDate.getTime() + delayDays * DAY_IN_MS);
}

function isPayoutEligible(payoutEligibleAt, now = new Date()) {
  if (!payoutEligibleAt) return false;
  return new Date(payoutEligibleAt).getTime() <= new Date(now).getTime();
}

function getEarningsWindow(range = '7d', now = new Date()) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (Number.isNaN(current.getTime())) {
    throw new TypeError('A valid date is required to build an earnings window.');
  }

  if (range === '12m') {
    return {
      startDate: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 11, 1)),
      endDate: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)),
      interval: 'month',
    };
  }

  if (range === '24h') {
    const endDate = new Date(
      Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth(),
        current.getUTCDate(),
        current.getUTCHours() + 1
      )
    );
    return {
      startDate: new Date(endDate.getTime() - DAY_IN_MS),
      endDate,
      interval: 'hour',
    };
  }

  const days = range === '30d' ? 30 : 7;
  const endDate = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1)
  );
  return {
    startDate: new Date(endDate.getTime() - days * DAY_IN_MS),
    endDate,
    interval: 'day',
  };
}

function getBucketKey(date, interval) {
  if (interval === 'hour') {
    return `${date.toISOString().slice(0, 13)}:00:00.000Z`;
  }
  return date.toISOString().slice(0, 10);
}

function buildBucketKeys(startDate, endDate, interval) {
  const keys = [];
  const cursor = new Date(startDate);

  while (cursor < endDate) {
    keys.push(getBucketKey(cursor, interval));
    if (interval === 'month') {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else if (interval === 'hour') {
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return keys;
}

function emptyEarningsPoint(periodStart) {
  return {
    periodStart,
    grossEarnings: 0,
    platformFees: 0,
    netEarnings: 0,
    pendingEarnings: 0,
    availableEarnings: 0,
    refundedEarnings: 0,
    disputedEarnings: 0,
    bookingCount: 0,
    refundCount: 0,
    disputeCount: 0,
  };
}

function normalizeMoney(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeEarningsPoint(point) {
  return {
    ...point,
    grossEarnings: normalizeMoney(point.grossEarnings),
    platformFees: normalizeMoney(point.platformFees),
    netEarnings: normalizeMoney(point.netEarnings),
    pendingEarnings: normalizeMoney(point.pendingEarnings),
    availableEarnings: normalizeMoney(point.availableEarnings),
    refundedEarnings: normalizeMoney(point.refundedEarnings),
    disputedEarnings: normalizeMoney(point.disputedEarnings),
  };
}

function summarizeEarnings(points) {
  const summary = emptyEarningsPoint(undefined);
  delete summary.periodStart;

  for (const point of points) {
    for (const field of Object.keys(summary)) {
      summary[field] += Number(point[field]) || 0;
    }
  }

  return normalizeEarningsPoint(summary);
}

function mapEarningStatus(paymentStatus) {
  if (paymentStatus === PAYMENT_STATUS.HELD) return 'pending';
  if (paymentStatus === PAYMENT_STATUS.REFUNDING) return 'refunding';
  if (paymentStatus === PAYMENT_STATUS.RELEASING) return 'processing';
  if (paymentStatus === PAYMENT_STATUS.RELEASED) return 'available';
  if (paymentStatus === PAYMENT_STATUS.REFUNDED) return 'refunded';
  if (paymentStatus === PAYMENT_STATUS.DISPUTED) return 'disputed';
  return paymentStatus;
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
        // Manual payouts: released held funds stay in the connected account's
        // Stripe balance until the provider withdraws their current balance.
        schedule: {
          interval: 'manual',
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
    transfersEnabled: account.capabilities && account.capabilities.transfers === 'active',
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
  };
  await user.save();

  return account.id;
}

async function ensureManualPayoutSchedule(accountId, retrievedAccount = null) {
  const account = retrievedAccount || (await stripe.accounts.retrieve(accountId));
  const payoutSchedule =
    account.settings && account.settings.payouts && account.settings.payouts.schedule;

  if (payoutSchedule && payoutSchedule.interval === 'manual') {
    return account;
  }

  return stripe.accounts.update(accountId, {
    settings: {
      payouts: {
        schedule: { interval: 'manual' },
      },
    },
  });
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
  await ensureManualPayoutSchedule(accountId);
  const returnUrl = resolveOnboardingReturnUrl(userId);

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: env.stripe.onboardingRefreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  return {
    url: link.url,
    expiresAt: new Date(link.expires_at * 1000),
    accountId,
    returnUrl,
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
      transfersEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }

  const retrievedAccount = await stripe.accounts.retrieve(user.stripeConnect.accountId);
  const account = await ensureManualPayoutSchedule(
    user.stripeConnect.accountId,
    retrievedAccount
  );

  user.stripeConnect.chargesEnabled = Boolean(account.charges_enabled);
  user.stripeConnect.transfersEnabled =
    account.capabilities && account.capabilities.transfers === 'active';
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
    transfersEnabled:
      account.capabilities && account.capabilities.transfers === 'active',
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

async function authorizeBookingPayment(bookingId, guestUser, paymentMethodId) {
  if (!paymentMethodId || typeof paymentMethodId !== 'string') {
    throw new ApiError(400, 'A saved card (paymentMethodId) is required to pay.');
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  if (booking.bookedBy.toString() !== guestUser._id.toString()) {
    throw new ApiError(403, 'You are not allowed to pay for this booking.');
  }

  if (
    booking.paymentStatus !== PAYMENT_STATUS.REQUIRES_PAYMENT &&
    booking.paymentStatus !== PAYMENT_STATUS.FAILED
  ) {
    throw new ApiError(400, 'Booking is already paid or authorized.');
  }
  if (booking.status === BOOKING_STATUS.CANCELLED) {
    throw new ApiError(400, 'Booking is cancelled.');
  }

  const cardsService = require('../cards/cards.service');
  const [host, freshGuest] = await Promise.all([
    User.findById(booking.host).select('+stripeConnect email'),
    User.findById(guestUser._id).select(
      '+stripeCustomerId +defaultPaymentMethodId email providerProfile agencyName'
    ),
  ]);

  if (!host || !host.stripeConnect || !host.stripeConnect.accountId) {
    throw new ApiError(400, 'Host has not connected a payment account.');
  }
  if (!host.stripeConnect.transfersEnabled) {
    throw new ApiError(400, 'Host payout account is not yet ready to receive transfers.');
  }
  if (!freshGuest) {
    throw new ApiError(404, 'Guest account not found.');
  }

  const customerId = await cardsService.getOrCreatePlatformCustomer(freshGuest);

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (paymentMethod.customer && paymentMethod.customer !== customerId) {
    throw new ApiError(403, 'This card does not belong to you.');
  }
  if (!paymentMethod.customer) {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  }

  const currency = (booking.currency || 'USD').toLowerCase();
  const split = calculatePaymentSplit(booking.totalAmount, currency);

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: split.total,
      currency,
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      off_session: false,
      // We confirm server-side with a saved card and have no return_url, so
      // redirect-based payment methods enabled in the Dashboard must be
      // excluded or Stripe rejects the confirmation.
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      setup_future_usage: 'off_session',
      transfer_group: `booking_${booking._id}`,
      description: `Funsival Booking #${booking._id}`,
      metadata: {
        bookingId: String(booking._id),
        guestId: String(freshGuest._id),
        hostId: String(host._id),
        paymentFlow: PAYMENT_FLOW.PLATFORM_HOLD,
        applicationFeeAmount: String(split.applicationFee),
        merchantAmount: String(split.merchant),
      },
    },
    {
      idempotencyKey: `booking_${booking._id}_authorize`,
    }
  );

  booking.stripeAccountId = host.stripeConnect.accountId;
  booking.stripePaymentIntentId = paymentIntent.id;
  booking.paymentFlow = PAYMENT_FLOW.PLATFORM_HOLD;
  booking.applicationFeeAmount = fromStripeAmount(split.applicationFee, currency);
  booking.merchantAmount = fromStripeAmount(split.merchant, currency);

  // Stripe usually returns requires_capture synchronously for non-3DS cards.
  // Promote inline so the booking isn't stuck in PROCESSING waiting on the webhook.
  if (paymentIntent.status === 'requires_capture') {
    await markBookingAuthorized(booking, paymentIntent);
  } else {
    booking.paymentStatus = PAYMENT_STATUS.PROCESSING;
    await booking.save();
  }

  const { successUrl } = resolveCheckoutUrls(booking._id);

  if (!freshGuest.defaultPaymentMethodId) {
    freshGuest.defaultPaymentMethodId = paymentMethodId;
    await freshGuest.save();
    await stripe.customers
      .update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      })
      .catch((error) =>
        console.error('Failed to set default payment method on Stripe customer.', error)
      );
  }

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    status: paymentIntent.status,
    requiresAction: paymentIntent.status === 'requires_action',
    nextAction: paymentIntent.next_action || null,
    successUrl,
  };
}

function applyPaymentFlowMetadata(booking, paymentIntent) {
  const metadata = (paymentIntent && paymentIntent.metadata) || {};
  if (metadata.paymentFlow !== PAYMENT_FLOW.PLATFORM_HOLD) return;

  booking.paymentFlow = PAYMENT_FLOW.PLATFORM_HOLD;
  const currency = booking.currency || paymentIntent.currency || 'USD';
  const applicationFee = Number(metadata.applicationFeeAmount);
  const merchantAmount = Number(metadata.merchantAmount);

  if (Number.isInteger(applicationFee) && applicationFee >= 0) {
    booking.applicationFeeAmount = fromStripeAmount(applicationFee, currency);
  }
  if (Number.isInteger(merchantAmount) && merchantAmount >= 0) {
    booking.merchantAmount = fromStripeAmount(merchantAmount, currency);
  }
}

async function markBookingPaid(booking, paymentIntent) {
  if (
    booking.paymentStatus === PAYMENT_STATUS.HELD ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDING ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASING ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASED ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDED ||
    booking.paymentStatus === PAYMENT_STATUS.DISPUTED
  ) {
    return booking;
  }

  const paidAt = new Date();
  const payoutEligibleAt = calculatePayoutEligibleAt(paidAt);

  booking.paymentStatus = PAYMENT_STATUS.HELD;
  applyPaymentFlowMetadata(booking, paymentIntent);
  booking.status = BOOKING_STATUS.CONFIRMED;
  booking.stripePaymentIntentId = paymentIntent.id;
  if (paymentIntent.latest_charge) {
    booking.stripeChargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge.id;
  }
  booking.paidAt = paidAt;
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
    booking.paymentStatus === PAYMENT_STATUS.AUTH_RELEASED ||
    booking.paymentStatus === PAYMENT_STATUS.HELD ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDING ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASING ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASED ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDED ||
    booking.paymentStatus === PAYMENT_STATUS.DISPUTED
  ) {
    return booking;
  }

  const authExpiresAt = new Date();
  authExpiresAt.setUTCDate(authExpiresAt.getUTCDate() + HOST_APPROVAL_WINDOW_DAYS);

  booking.paymentStatus = PAYMENT_STATUS.AUTHORIZED;
  applyPaymentFlowMetadata(booking, paymentIntent);
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

// Wait a few seconds after authorize before hitting Stripe again — gives the
// inline `requires_capture` write a chance to land without an extra API call.
const PROCESSING_RECONCILE_GRACE_MS = 10 * 1000;

async function reconcileProcessingBooking(booking) {
  if (!booking || booking.paymentStatus !== PAYMENT_STATUS.PROCESSING) {
    return booking;
  }
  if (!booking.stripePaymentIntentId) {
    return booking;
  }
  const updatedAt = booking.updatedAt ? new Date(booking.updatedAt).getTime() : 0;
  if (updatedAt && Date.now() - updatedAt < PROCESSING_RECONCILE_GRACE_MS) {
    return booking;
  }

  try {
    const latest = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    if (latest.status === 'requires_capture') {
      await markBookingAuthorized(booking, latest);
    } else if (latest.status === 'succeeded') {
      await markBookingPaid(booking, latest);
    } else if (latest.status === 'canceled') {
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
  } catch (error) {
    console.error(
      `Failed to reconcile processing booking ${booking._id}:`,
      error.message || error
    );
  }
  return booking;
}

async function reconcileProcessingBookings(bookings) {
  if (!Array.isArray(bookings) || bookings.length === 0) return bookings;
  await Promise.all(
    bookings
      .filter((b) => b && b.paymentStatus === PAYMENT_STATUS.PROCESSING)
      .map((b) => reconcileProcessingBooking(b))
  );
  return bookings;
}

async function capturePaymentForBooking(bookingId, hostUserId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }
  if (booking.host.toString() !== hostUserId.toString()) {
    throw new ApiError(403, 'You are not allowed to accept this booking.');
  }
  if (!booking.stripePaymentIntentId || !booking.stripeAccountId) {
    throw new ApiError(400, 'Booking is missing Stripe payment information.');
  }

  // Reconcile a stuck PROCESSING booking against Stripe before failing.
  // The amount_capturable_updated webhook may not have arrived yet even though
  // the card is already authorized at Stripe.
  if (booking.paymentStatus === PAYMENT_STATUS.PROCESSING) {
    const latest = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    if (latest.status === 'requires_capture') {
      await markBookingAuthorized(booking, latest);
    } else if (latest.status === 'requires_action') {
      throw new ApiError(
        400,
        'The guest still needs to complete card verification (3D Secure) before this booking can be accepted.'
      );
    } else if (latest.status === 'processing') {
      throw new ApiError(
        400,
        'The card is still being authorized by the bank. Please try again in a moment.'
      );
    } else if (latest.status === 'canceled') {
      booking.paymentStatus = PAYMENT_STATUS.AUTH_RELEASED;
      await booking.save();
      throw new ApiError(400, 'The card authorization was canceled. The guest needs to book again.');
    } else {
      throw new ApiError(
        400,
        `Card authorization is not complete (Stripe status: ${latest.status}).`
      );
    }
  }

  if (booking.paymentStatus !== PAYMENT_STATUS.AUTHORIZED) {
    throw new ApiError(
      400,
      `Only authorized bookings can be captured. Current state: ${booking.paymentStatus}.`
    );
  }
  if (booking.authExpiresAt && booking.authExpiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      400,
      'The authorization window has expired. The guest needs to book again.'
    );
  }

  const paymentIntent = await stripe.paymentIntents.capture(booking.stripePaymentIntentId);

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

  await stripe.paymentIntents.cancel(booking.stripePaymentIntentId, {
    cancellation_reason: 'requested_by_customer',
  });

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
  if (
    booking.paymentStatus === PAYMENT_STATUS.REFUNDING &&
    booking.updatedAt &&
    new Date(booking.updatedAt).getTime() <= Date.now() - 10 * 60 * 1000
  ) {
    const reset = await Booking.updateOne(
      { _id: booking._id, paymentStatus: PAYMENT_STATUS.REFUNDING },
      { $set: { paymentStatus: PAYMENT_STATUS.HELD } }
    );
    if (reset.modifiedCount === 1) {
      booking.paymentStatus = PAYMENT_STATUS.HELD;
    }
  }

  if (booking.paymentStatus !== PAYMENT_STATUS.HELD) {
    throw new ApiError(
      400,
      'Only bookings in the held state can be refunded. Current state: ' + booking.paymentStatus
    );
  }

  if (!booking.stripePaymentIntentId || !booking.stripeAccountId) {
    throw new ApiError(400, 'Booking is missing Stripe payment information.');
  }

  const isPlatformHold = booking.paymentFlow === PAYMENT_FLOW.PLATFORM_HOLD;
  if (isPlatformHold && booking.stripeTransferId) {
    throw new ApiError(
      400,
      'Funds have already been transferred to the provider and cannot be refunded through the hold flow.'
    );
  }

  if (
    !isPlatformHold &&
    booking.payoutEligibleAt &&
    booking.payoutEligibleAt.getTime() <= Date.now()
  ) {
    throw new ApiError(
      400,
      'The legacy payout hold window has passed. Funds have already been released to the provider.'
    );
  }

  const claimedBooking = await Booking.findOneAndUpdate(
    { _id: booking._id, paymentStatus: PAYMENT_STATUS.HELD },
    { $set: { paymentStatus: PAYMENT_STATUS.REFUNDING } },
    { new: true }
  );
  if (!claimedBooking) {
    throw new ApiError(
      409,
      'This booking is already being refunded or released. Refresh and try again.'
    );
  }

  const refundParams = {
    payment_intent: claimedBooking.stripePaymentIntentId,
    reason: reason && ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)
      ? reason
      : 'requested_by_customer',
    metadata: {
      bookingId: String(claimedBooking._id),
      adminId: String(adminUserId),
    },
  };

  // Destination-charge bookings already moved the merchant amount at capture,
  // so those legacy refunds must reverse the transfer and application fee.
  if (!isPlatformHold) {
    refundParams.refund_application_fee = true;
    refundParams.reverse_transfer = true;
  }

  try {
    const refund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `booking_${claimedBooking._id}_full_refund_v1`,
    });

    claimedBooking.paymentStatus = PAYMENT_STATUS.REFUNDED;
    claimedBooking.status = BOOKING_STATUS.CANCELLED;
    claimedBooking.stripeRefundId = refund.id;
    claimedBooking.refundedAt = new Date();
    claimedBooking.refundedBy = adminUserId;
    claimedBooking.refundReason = reason || null;
    claimedBooking.activeRefundRequest = null;
    claimedBooking.cancelledAt = new Date();
    claimedBooking.cancelledBy = adminUserId;
    await claimedBooking.save();

    return { booking: claimedBooking, refund };
  } catch (error) {
    await Booking.updateOne(
      { _id: claimedBooking._id, paymentStatus: PAYMENT_STATUS.REFUNDING },
      { $set: { paymentStatus: PAYMENT_STATUS.HELD } }
    );
    throw error;
  }
}

async function refundBooking(bookingId, adminUserId, reason) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  const { booking: refundedBooking } = await executeStripeRefund(
    booking,
    adminUserId,
    reason
  );

  await RefundRequest.updateMany(
    {
      booking: refundedBooking._id,
      status: {
        $in: [REFUND_REQUEST_STATUS.PENDING, REFUND_REQUEST_STATUS.PROCESSING],
      },
    },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.APPROVED,
        decidedBy: adminUserId,
        decidedAt: new Date(),
        decisionNote: reason || null,
        stripeRefundId: refundedBooking.stripeRefundId,
        processingAction: null,
        processingAt: null,
      },
    }
  );

  sendNotification(refundedBooking.bookedBy, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: 'Your booking has been refunded',
    body: 'A refund has been issued for your booking. It may take 5-10 days to appear on your card.',
    data: { bookingId: refundedBooking._id.toString() },
  }).catch((error) => console.error('Failed to notify guest of refund.', error));

  sendNotification(refundedBooking.host, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: 'Booking refunded by admin',
    body: 'A booking on your listing has been refunded by Funsival support.',
    data: { bookingId: refundedBooking._id.toString() },
  }).catch((error) => console.error('Failed to notify host of refund.', error));

  return refundedBooking.toJSON();
}

async function getEarningsGraph(userId, { range = '7d', currency = null } = {}) {
  const generatedAt = new Date();
  const { startDate, endDate, interval } = getEarningsWindow(range, generatedAt);
  const hostId =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));
  const match = {
    host: hostId,
    paidAt: { $gte: startDate, $lt: endDate },
    paymentStatus: { $in: EARNING_TRANSACTION_STATUSES },
  };
  if (currency) match.currency = currency;

  const includedEarning = { $in: ['$paymentStatus', EARNING_PAYMENT_STATUSES] };
  const pendingEarning = {
    $in: [
      '$paymentStatus',
      [PAYMENT_STATUS.HELD, PAYMENT_STATUS.REFUNDING, PAYMENT_STATUS.RELEASING],
    ],
  };
  const availableEarning = { $eq: ['$paymentStatus', PAYMENT_STATUS.RELEASED] };
  const refundedEarning = { $eq: ['$paymentStatus', PAYMENT_STATUS.REFUNDED] };
  const disputedEarning = { $eq: ['$paymentStatus', PAYMENT_STATUS.DISPUTED] };
  const periodFormat =
    interval === 'month'
      ? '%Y-%m-01'
      : interval === 'hour'
        ? '%Y-%m-%dT%H:00:00.000Z'
        : '%Y-%m-%d';

  const rows = await Booking.aggregate([
    { $match: match },
    {
      $project: {
        currency: { $toUpper: { $ifNull: ['$currency', 'USD'] } },
        periodStart: {
          $dateToString: {
            date: '$paidAt',
            format: periodFormat,
            timezone: 'UTC',
          },
        },
        paymentStatus: 1,
        totalAmount: { $ifNull: ['$totalAmount', 0] },
        applicationFeeAmount: { $ifNull: ['$applicationFeeAmount', 0] },
        merchantAmount: { $ifNull: ['$merchantAmount', 0] },
      },
    },
    {
      $group: {
        _id: { currency: '$currency', periodStart: '$periodStart' },
        grossEarnings: { $sum: { $cond: [includedEarning, '$totalAmount', 0] } },
        platformFees: {
          $sum: { $cond: [includedEarning, '$applicationFeeAmount', 0] },
        },
        netEarnings: { $sum: { $cond: [includedEarning, '$merchantAmount', 0] } },
        pendingEarnings: { $sum: { $cond: [pendingEarning, '$merchantAmount', 0] } },
        availableEarnings: {
          $sum: { $cond: [availableEarning, '$merchantAmount', 0] },
        },
        refundedEarnings: {
          $sum: { $cond: [refundedEarning, '$merchantAmount', 0] },
        },
        disputedEarnings: {
          $sum: { $cond: [disputedEarning, '$merchantAmount', 0] },
        },
        bookingCount: { $sum: { $cond: [includedEarning, 1, 0] } },
        refundCount: { $sum: { $cond: [refundedEarning, 1, 0] } },
        disputeCount: { $sum: { $cond: [disputedEarning, 1, 0] } },
      },
    },
    { $sort: { '_id.currency': 1, '_id.periodStart': 1 } },
  ]);

  const bucketKeys = buildBucketKeys(startDate, endDate, interval);
  const rowsByCurrency = new Map();
  for (const row of rows) {
    if (!rowsByCurrency.has(row._id.currency)) {
      rowsByCurrency.set(row._id.currency, new Map());
    }
    rowsByCurrency.get(row._id.currency).set(
      row._id.periodStart,
      normalizeEarningsPoint({
        periodStart: row._id.periodStart,
        grossEarnings: row.grossEarnings,
        platformFees: row.platformFees,
        netEarnings: row.netEarnings,
        pendingEarnings: row.pendingEarnings,
        availableEarnings: row.availableEarnings,
        refundedEarnings: row.refundedEarnings,
        disputedEarnings: row.disputedEarnings,
        bookingCount: row.bookingCount,
        refundCount: row.refundCount,
        disputeCount: row.disputeCount,
      })
    );
  }

  const currencies = currency
    ? [currency]
    : Array.from(rowsByCurrency.keys()).sort((a, b) => a.localeCompare(b));
  const series = currencies.map((currencyCode) => {
    const currencyRows = rowsByCurrency.get(currencyCode) || new Map();
    const points = bucketKeys.map(
      (periodStart) => currencyRows.get(periodStart) || emptyEarningsPoint(periodStart)
    );
    return {
      currency: currencyCode,
      summary: summarizeEarnings(points),
      points,
    };
  });

  return {
    range,
    interval,
    startDate: startDate.toISOString(),
    endDate: new Date(endDate.getTime() - 1).toISOString(),
    generatedAt: generatedAt.toISOString(),
    series,
  };
}

function bookingTransactionProject() {
  return {
    _id: 1,
    transactionType: { $literal: 'earning' },
    transactionDate: '$paidAt',
    currency: { $toUpper: { $ifNull: ['$currency', 'USD'] } },
    amount: { $ifNull: ['$merchantAmount', 0] },
    grossAmount: { $ifNull: ['$totalAmount', 0] },
    platformFee: { $ifNull: ['$applicationFeeAmount', 0] },
    paymentStatus: 1,
    releasedAt: 1,
    refundedAt: 1,
    listing: 1,
    customer: '$bookedBy',
  };
}

function withdrawalTransactionProject() {
  return {
    _id: 1,
    transactionType: { $literal: 'withdrawal' },
    transactionDate: '$createdAt',
    currency: { $toUpper: '$currency' },
    amount: { $ifNull: ['$amount', 0] },
    status: 1,
    arrivalDate: 1,
    paidAt: 1,
    failedAt: 1,
    failureReason: 1,
  };
}

function buildTransactionPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

async function listTransactions(
  userId,
  { page = 1, limit = 20, type = 'all', currency = null } = {}
) {
  const hostId =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));
  const bookingMatch = {
    host: hostId,
    paidAt: { $ne: null },
    paymentStatus: { $in: EARNING_TRANSACTION_STATUSES },
  };
  const withdrawalMatch = { host: hostId };
  if (currency) {
    bookingMatch.currency = currency;
    withdrawalMatch.currency = currency;
  }

  let model;
  let pipeline;
  if (type === 'withdrawal') {
    model = Withdrawal;
    pipeline = [
      { $match: withdrawalMatch },
      { $project: withdrawalTransactionProject() },
    ];
  } else {
    model = Booking;
    pipeline = [
      { $match: bookingMatch },
      { $project: bookingTransactionProject() },
    ];
    if (type === 'all') {
      pipeline.push({
        $unionWith: {
          coll: Withdrawal.collection.name,
          pipeline: [
            { $match: withdrawalMatch },
            { $project: withdrawalTransactionProject() },
          ],
        },
      });
    }
  }

  const skip = (page - 1) * limit;
  pipeline.push(
    { $sort: { transactionDate: -1, _id: -1 } },
    {
      $facet: {
        transactions: [{ $skip: skip }, { $limit: limit }],
        metadata: [{ $count: 'total' }],
      },
    }
  );

  const [result = { transactions: [], metadata: [] }] = await model.aggregate(pipeline);
  const rows = result.transactions || [];
  const listingIds = rows
    .filter((row) => row.transactionType === 'earning' && row.listing)
    .map((row) => row.listing);
  const customerIds = rows
    .filter((row) => row.transactionType === 'earning' && row.customer)
    .map((row) => row.customer);
  const [listings, customers] = await Promise.all([
    listingIds.length
      ? Listing.find({ _id: { $in: listingIds } })
          .select('basicInformation.activityTitle')
          .lean()
      : [],
    customerIds.length
      ? User.find({ _id: { $in: customerIds } })
          .select('email providerProfile.firstName providerProfile.lastName')
          .lean()
      : [],
  ]);
  const listingsById = new Map(listings.map((listing) => [String(listing._id), listing]));
  const customersById = new Map(customers.map((customer) => [String(customer._id), customer]));

  const transactions = rows.map((row) => {
    const id = String(row._id);
    if (row.transactionType === 'withdrawal') {
      return {
        id,
        type: 'withdrawal',
        direction: 'debit',
        status: row.status,
        amount: normalizeMoney(row.amount),
        currency: row.currency,
        description: 'Bank withdrawal',
        transactionDate: row.transactionDate,
        withdrawal: {
          id,
          arrivalDate: row.arrivalDate || null,
          paidAt: row.paidAt || null,
          failedAt: row.failedAt || null,
          failureReason: row.failureReason || null,
        },
      };
    }

    const listing = row.listing ? listingsById.get(String(row.listing)) : null;
    const customer = row.customer ? customersById.get(String(row.customer)) : null;
    const profile = customer && customer.providerProfile;
    const customerName = profile
      ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null
      : null;
    const listingTitle =
      listing && listing.basicInformation
        ? listing.basicInformation.activityTitle || null
        : null;

    return {
      id,
      type: 'earning',
      direction: 'credit',
      status: mapEarningStatus(row.paymentStatus),
      amount: normalizeMoney(row.amount),
      currency: row.currency,
      description: listingTitle || 'Booking earning',
      transactionDate: row.transactionDate,
      booking: {
        id,
        grossAmount: normalizeMoney(row.grossAmount),
        platformFee: normalizeMoney(row.platformFee),
        paymentStatus: row.paymentStatus,
        releasedAt: row.releasedAt || null,
        refundedAt: row.refundedAt || null,
        listing: listing
          ? { id: String(listing._id), title: listingTitle }
          : null,
        customer: customer
          ? { id: String(customer._id), name: customerName, email: customer.email }
          : null,
      },
    };
  });

  const total = result.metadata && result.metadata[0] ? result.metadata[0].total : 0;
  return {
    transactions,
    pagination: buildTransactionPagination(total, page, limit),
  };
}

async function getHostConnectAccount(userId, { requirePayouts = false } = {}) {
  const user = await User.findById(userId).select('+stripeConnect');
  if (!user || !user.stripeConnect || !user.stripeConnect.accountId) {
    throw new ApiError(400, 'Provider has not connected a Stripe account.');
  }
  if (requirePayouts && !user.stripeConnect.payoutsEnabled) {
    throw new ApiError(400, 'Provider bank payouts are not enabled yet.');
  }

  await ensureManualPayoutSchedule(user.stripeConnect.accountId);
  return { user, accountId: user.stripeConnect.accountId };
}

function addMinorAmount(target, currency, field, amount) {
  const normalizedCurrency = (currency || 'USD').toUpperCase();
  if (!target.has(normalizedCurrency)) {
    target.set(normalizedCurrency, {
      currency: normalizedCurrency,
      held: 0,
      stripePending: 0,
      pending: 0,
      current: 0,
    });
  }
  target.get(normalizedCurrency)[field] += Number(amount) || 0;
}

async function getMerchantBalance(userId) {
  const { accountId } = await getHostConnectAccount(userId);
  // Make a balance read self-healing: if the minute job has not run yet,
  // release this merchant's already-eligible bookings before returning totals.
  await releaseEligibleBookingFunds({ limit: 100, hostId: userId });
  const [stripeBalance, heldBookings] = await Promise.all([
    stripe.balance.retrieve({}, { stripeAccount: accountId }),
    Booking.find({
      host: userId,
      paymentFlow: PAYMENT_FLOW.PLATFORM_HOLD,
      paymentStatus: {
        $in: [
          PAYMENT_STATUS.HELD,
          PAYMENT_STATUS.REFUNDING,
          PAYMENT_STATUS.RELEASING,
        ],
      },
    }).select('currency totalAmount applicationFeeAmount merchantAmount'),
  ]);

  const byCurrency = new Map();
  for (const booking of heldBookings) {
    const currency = booking.currency || 'USD';
    const merchantMinor = toStripeAmount(booking.merchantAmount, currency);
    addMinorAmount(byCurrency, currency, 'held', merchantMinor);
  }
  for (const entry of stripeBalance.pending || []) {
    addMinorAmount(byCurrency, entry.currency, 'stripePending', entry.amount);
  }
  for (const entry of stripeBalance.available || []) {
    addMinorAmount(byCurrency, entry.currency, 'current', entry.amount);
  }

  const balances = Array.from(byCurrency.values())
    .map((entry) => {
      entry.pending = entry.held + entry.stripePending;
      return {
        currency: entry.currency,
        pending: fromStripeAmount(entry.pending, entry.currency),
        current: fromStripeAmount(entry.current, entry.currency),
        breakdown: {
          sevenDayHold: fromStripeAmount(entry.held, entry.currency),
          stripeProcessing: fromStripeAmount(entry.stripePending, entry.currency),
        },
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return { accountId, balances };
}

function mapStripePayoutStatus(status) {
  if (status === 'paid') return WITHDRAWAL_STATUS.PAID;
  if (status === 'failed') return WITHDRAWAL_STATUS.FAILED;
  if (status === 'canceled') return WITHDRAWAL_STATUS.CANCELED;
  return WITHDRAWAL_STATUS.PENDING;
}

async function createWithdrawal(
  userId,
  { amount, currency, idempotencyKey }
) {
  const { accountId } = await getHostConnectAccount(userId, { requirePayouts: true });
  const normalizedCurrency = currency.toUpperCase();
  const amountMinor = toStripeAmount(amount, normalizedCurrency);
  const normalizedAmount = fromStripeAmount(amountMinor, normalizedCurrency);
  if (amountMinor <= 0 || Math.abs(normalizedAmount - amount) > 1e-9) {
    throw new ApiError(
      400,
      `Withdrawal amount has invalid precision for ${normalizedCurrency}.`
    );
  }

  let withdrawal = await Withdrawal.findOne({ host: userId, idempotencyKey });
  if (withdrawal) {
    const sameRequest =
      withdrawal.currency === normalizedCurrency &&
      toStripeAmount(withdrawal.amount, normalizedCurrency) === amountMinor;
    if (!sameRequest) {
      throw new ApiError(409, 'This idempotency key was already used for another withdrawal.');
    }
    if (withdrawal.stripePayoutId || withdrawal.status !== WITHDRAWAL_STATUS.PENDING) {
      return withdrawal.toJSON();
    }
  }

  const stripeBalance = await stripe.balance.retrieve({}, { stripeAccount: accountId });
  const available = (stripeBalance.available || []).find(
    (entry) => entry.currency.toUpperCase() === normalizedCurrency
  );
  if (!available || available.amount < amountMinor) {
    const currentAmount = available ? fromStripeAmount(available.amount, normalizedCurrency) : 0;
    throw new ApiError(
      400,
      `Withdrawal exceeds the current ${normalizedCurrency} balance of ${currentAmount}.`
    );
  }

  if (!withdrawal) {
    try {
      withdrawal = await Withdrawal.create({
        host: userId,
        amount: fromStripeAmount(amountMinor, normalizedCurrency),
        currency: normalizedCurrency,
        status: WITHDRAWAL_STATUS.PENDING,
        stripeAccountId: accountId,
        idempotencyKey,
      });
    } catch (error) {
      if (error && error.code === 11000) {
        withdrawal = await Withdrawal.findOne({ host: userId, idempotencyKey });
      } else {
        throw error;
      }
    }
  }

  const matchesExistingRequest =
    withdrawal &&
    withdrawal.currency === normalizedCurrency &&
    toStripeAmount(withdrawal.amount, normalizedCurrency) === amountMinor;
  if (!matchesExistingRequest) {
    throw new ApiError(409, 'This idempotency key was already used for another withdrawal.');
  }
  if (withdrawal.stripePayoutId || withdrawal.status !== WITHDRAWAL_STATUS.PENDING) {
    return withdrawal.toJSON();
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount: amountMinor,
        currency: normalizedCurrency.toLowerCase(),
        metadata: {
          withdrawalId: String(withdrawal._id),
          hostId: String(userId),
        },
      },
      {
        stripeAccount: accountId,
        idempotencyKey: `withdrawal_${withdrawal._id}_v1`,
      }
    );

    withdrawal.stripePayoutId = payout.id;
    withdrawal.status = mapStripePayoutStatus(payout.status);
    withdrawal.arrivalDate = payout.arrival_date
      ? new Date(payout.arrival_date * 1000)
      : null;
    if (withdrawal.status === WITHDRAWAL_STATUS.PAID) {
      withdrawal.paidAt = new Date();
    }
    await withdrawal.save();
    return withdrawal.toJSON();
  } catch (error) {
    // Network failures are ambiguous and safe to retry with the same key.
    // Definite Stripe request failures can be recorded as failed immediately.
    if (error && (error.type === 'StripeInvalidRequestError' || error.type === 'StripeCardError')) {
      withdrawal.status = WITHDRAWAL_STATUS.FAILED;
      withdrawal.failedAt = new Date();
      withdrawal.failureReason = error.message || 'Stripe rejected the payout request.';
      await withdrawal.save();
      throw new ApiError(400, withdrawal.failureReason);
    }
    throw error;
  }
}

async function listWithdrawals(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [withdrawals, total] = await Promise.all([
    Withdrawal.find({ host: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Withdrawal.countDocuments({ host: userId }),
  ]);

  const totalPages = Math.ceil(total / limit);
  return {
    withdrawals: withdrawals.map((withdrawal) => withdrawal.toJSON()),
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

async function releaseBookingFunds(bookingId) {
  const initialBooking = await Booking.findById(bookingId);
  if (!initialBooking) {
    throw new ApiError(404, 'Booking not found.');
  }
  if (initialBooking.paymentFlow !== PAYMENT_FLOW.PLATFORM_HOLD) {
    return { released: false, reason: 'legacy_destination_charge' };
  }
  if (initialBooking.paymentStatus === PAYMENT_STATUS.RELEASED) {
    return { released: true, booking: initialBooking.toJSON() };
  }
  if (
    !initialBooking.payoutEligibleAt ||
    initialBooking.payoutEligibleAt.getTime() > Date.now()
  ) {
    return { released: false, reason: 'hold_window_open' };
  }

  const pendingRefund = await RefundRequest.findOne({
    booking: initialBooking._id,
    status: {
      $in: [REFUND_REQUEST_STATUS.PENDING, REFUND_REQUEST_STATUS.PROCESSING],
    },
  }).select('_id');
  if (pendingRefund) {
    if (
      !initialBooking.activeRefundRequest ||
      initialBooking.activeRefundRequest.toString() !== pendingRefund._id.toString()
    ) {
      await Booking.updateOne(
        { _id: initialBooking._id, paymentStatus: PAYMENT_STATUS.HELD },
        { $set: { activeRefundRequest: pendingRefund._id } }
      );
    }
    return { released: false, reason: 'refund_pending' };
  }

  if (initialBooking.activeRefundRequest) {
    await Booking.updateOne(
      { _id: initialBooking._id, activeRefundRequest: initialBooking.activeRefundRequest },
      { $set: { activeRefundRequest: null } }
    );
    initialBooking.activeRefundRequest = null;
  }

  const booking = await Booking.findOneAndUpdate(
    {
      _id: initialBooking._id,
      paymentFlow: PAYMENT_FLOW.PLATFORM_HOLD,
      paymentStatus: PAYMENT_STATUS.HELD,
      payoutEligibleAt: { $lte: new Date() },
      $or: [
        { activeRefundRequest: null },
        { activeRefundRequest: { $exists: false } },
      ],
    },
    { $set: { paymentStatus: PAYMENT_STATUS.RELEASING } },
    { new: true }
  );

  if (!booking) {
    const latest = await Booking.findById(bookingId);
    return {
      released: latest && latest.paymentStatus === PAYMENT_STATUS.RELEASED,
      reason: latest ? latest.paymentStatus : 'not_found',
      booking: latest ? latest.toJSON() : null,
    };
  }

  const currency = booking.currency || 'USD';
  const merchantAmount = toStripeAmount(booking.merchantAmount, currency);

  try {
    let transfer = null;
    if (merchantAmount > 0) {
      transfer = await stripe.transfers.create(
        {
          amount: merchantAmount,
          currency: currency.toLowerCase(),
          destination: booking.stripeAccountId,
          transfer_group: `booking_${booking._id}`,
          description: `Funsival Booking #${booking._id} merchant release`,
          metadata: {
            bookingId: String(booking._id),
            hostId: String(booking.host),
          },
        },
        { idempotencyKey: `booking_${booking._id}_merchant_release_v1` }
      );
    }

    booking.paymentStatus = PAYMENT_STATUS.RELEASED;
    booking.stripeTransferId = transfer ? transfer.id : null;
    booking.releasedAt = new Date();
    await booking.save();

    sendNotification(booking.host, {
      type: NOTIFICATION_TYPES.BOOKING_PAYOUT_RELEASED,
      title: 'Funds available',
      body: `${currency} ${booking.merchantAmount} moved from pending to your current balance.`,
      data: {
        bookingId: booking._id.toString(),
        listingId: booking.listing ? booking.listing.toString() : '',
        stripeTransferId: booking.stripeTransferId || '',
      },
    }).catch((error) => console.error('Failed to notify host of fund release.', error));

    return { released: true, booking: booking.toJSON() };
  } catch (error) {
    await Booking.updateOne(
      { _id: booking._id, paymentStatus: PAYMENT_STATUS.RELEASING },
      { $set: { paymentStatus: PAYMENT_STATUS.HELD } }
    );
    throw error;
  }
}

async function releaseEligibleBookingFunds({ limit = 50, hostId = null } = {}) {
  const now = new Date();

  // Old destination-charge bookings were transferred at capture time. Mark
  // them released after their legacy hold date, but never create another
  // transfer for them.
  const legacyReleaseFilter = {
    paymentStatus: PAYMENT_STATUS.HELD,
    payoutEligibleAt: { $lte: now },
    $or: [
      { paymentFlow: PAYMENT_FLOW.DESTINATION_CHARGE },
      { paymentFlow: { $exists: false } },
    ],
  };
  if (hostId) legacyReleaseFilter.host = hostId;
  await Booking.updateMany(
    legacyReleaseFilter,
    {
      $set: {
        paymentFlow: PAYMENT_FLOW.DESTINATION_CHARGE,
        paymentStatus: PAYMENT_STATUS.RELEASED,
        releasedAt: now,
      },
    }
  );

  // Recover releases interrupted after the database claim. Stripe idempotency
  // ensures retrying cannot create a duplicate transfer.
  const staleReleaseCutoff = new Date(Date.now() - 10 * 60 * 1000);
  const staleReleaseFilter = {
    paymentFlow: PAYMENT_FLOW.PLATFORM_HOLD,
    paymentStatus: PAYMENT_STATUS.RELEASING,
    updatedAt: { $lte: staleReleaseCutoff },
  };
  if (hostId) staleReleaseFilter.host = hostId;
  await Booking.updateMany(
    staleReleaseFilter,
    { $set: { paymentStatus: PAYMENT_STATUS.HELD } }
  );

  const eligibleFilter = {
    paymentFlow: PAYMENT_FLOW.PLATFORM_HOLD,
    paymentStatus: PAYMENT_STATUS.HELD,
    payoutEligibleAt: { $lte: now },
  };
  if (hostId) eligibleFilter.host = hostId;

  const eligible = await Booking.find(eligibleFilter)
    .sort({ payoutEligibleAt: 1 })
    .limit(limit)
    .select('_id');

  const results = [];
  for (const booking of eligible) {
    try {
      results.push(await releaseBookingFunds(booking._id));
    } catch (error) {
      console.error(`Failed to release booking ${booking._id}:`, error.message || error);
      results.push({ released: false, bookingId: booking._id.toString(), reason: 'error' });
    }
  }
  return results;
}

async function syncWithdrawalFromPayout(payout, connectedAccountId) {
  if (!payout || !payout.id) return;
  const filter = { stripePayoutId: payout.id };
  if (connectedAccountId) filter.stripeAccountId = connectedAccountId;

  let withdrawal = await Withdrawal.findOne(filter);
  const metadataWithdrawalId =
    payout.metadata && typeof payout.metadata.withdrawalId === 'string'
      ? payout.metadata.withdrawalId
      : '';
  if (!withdrawal && /^[a-f\d]{24}$/i.test(metadataWithdrawalId)) {
    const metadataFilter = { _id: metadataWithdrawalId };
    if (connectedAccountId) metadataFilter.stripeAccountId = connectedAccountId;
    withdrawal = await Withdrawal.findOne(metadataFilter);
  }
  if (!withdrawal) return;

  const previousStatus = withdrawal.status;
  withdrawal.stripePayoutId = payout.id;
  withdrawal.status = mapStripePayoutStatus(payout.status);
  withdrawal.arrivalDate = payout.arrival_date
    ? new Date(payout.arrival_date * 1000)
    : withdrawal.arrivalDate;
  withdrawal.failureReason = payout.failure_message || null;
  if (withdrawal.status === WITHDRAWAL_STATUS.PAID) {
    withdrawal.paidAt = withdrawal.paidAt || new Date();
  } else if (withdrawal.status === WITHDRAWAL_STATUS.FAILED) {
    withdrawal.failedAt = withdrawal.failedAt || new Date();
  }
  await withdrawal.save();

  if (previousStatus === withdrawal.status) return;
  if (withdrawal.status === WITHDRAWAL_STATUS.PAID) {
    sendNotification(withdrawal.host, {
      type: NOTIFICATION_TYPES.WITHDRAWAL_PAID,
      title: 'Withdrawal paid',
      body: `${withdrawal.currency} ${withdrawal.amount} was sent to your bank account.`,
      data: { withdrawalId: withdrawal._id.toString() },
    }).catch((error) => console.error('Failed to notify host of paid withdrawal.', error));
  } else if (withdrawal.status === WITHDRAWAL_STATUS.FAILED) {
    sendNotification(withdrawal.host, {
      type: NOTIFICATION_TYPES.WITHDRAWAL_FAILED,
      title: 'Withdrawal failed',
      body: withdrawal.failureReason || 'Stripe could not complete your withdrawal.',
      data: { withdrawalId: withdrawal._id.toString() },
    }).catch((error) => console.error('Failed to notify host of failed withdrawal.', error));
  }
}

async function syncConnectedAccountFromEvent(account) {
  if (!account || !account.id) return;
  const user = await User.findOne({ 'stripeConnect.accountId': account.id }).select(
    '+stripeConnect'
  );
  if (!user) return;

  user.stripeConnect.chargesEnabled = Boolean(account.charges_enabled);
  user.stripeConnect.transfersEnabled =
    account.capabilities && account.capabilities.transfers === 'active';
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
    booking.paymentStatus === PAYMENT_STATUS.HELD ||
    booking.paymentStatus === PAYMENT_STATUS.REFUNDING ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASING ||
    booking.paymentStatus === PAYMENT_STATUS.RELEASED ||
    booking.paymentStatus === PAYMENT_STATUS.DISPUTED
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
  booking.activeRefundRequest = null;
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

module.exports = {
  createOnboardingLink,
  getConnectAccountStatus,
  createLoginLink,
  authorizeBookingPayment,
  capturePaymentForBooking,
  reconcileProcessingBooking,
  reconcileProcessingBookings,
  cancelAuthorizationForBooking,
  refundBooking,
  executeStripeRefund,
  getMerchantBalance,
  getEarningsGraph,
  listTransactions,
  createWithdrawal,
  listWithdrawals,
  releaseBookingFunds,
  releaseEligibleBookingFunds,
  syncWithdrawalFromPayout,
  syncConnectedAccountFromEvent,
  handlePaymentIntentSucceeded,
  handlePaymentIntentAuthorized,
  handlePaymentIntentCanceled,
  handleChargeRefunded,
  handleChargeDispute,
  _private: {
    toStripeAmount,
    fromStripeAmount,
    calculatePaymentSplit,
    calculatePayoutEligibleAt,
    isPayoutEligible,
    getEarningsWindow,
    buildBucketKeys,
    mapEarningStatus,
  },
};
