const Booking = require('../../models/booking.model');
const Listing = require('../../models/listing.model');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const { sendMail } = require('../../services/mail.service');
const {
  BOOKING_TYPES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  SERVICE_FEE_AMOUNT,
} = require('../../constants/booking');
const {
  LISTING_CATEGORIES,
  normalizeCategory,
} = require('../../constants/listing');
const paymentsService = require('../payments/payments.service');
const { attachReviewDataToBookings } = require('../reviews/reviews.service');
const { buildNewBookingHostEmail } = require('./bookings.templates');
const { sendNotification } = require('../notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../notifications/notifications.validation');

function timeStringToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function calculateHoursBetween(startTime, endTime) {
  const minutes = timeStringToMinutes(endTime) - timeStringToMinutes(startTime);
  if (minutes <= 0) {
    throw new ApiError(400, 'End time must be after start time.');
  }
  return minutes / 60;
}

function calculateDaysBetween(startDate, endDate) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const days = Math.ceil((endDate - startDate) / millisecondsPerDay);
  return Math.max(days, 1);
}

function hasConfiguredPrice(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPrimaryBookingCategory(value) {
  return (
    value === LISTING_CATEGORIES.ACTIVITY ||
    value === LISTING_CATEGORIES.PLACE ||
    value === LISTING_CATEGORIES.EQUIPMENT
  );
}

function resolveBookingType(payload, listing) {
  const storedCategory = normalizeCategory(listing && listing.category);
  const hintedCategory = normalizeCategory(payload && payload.listingType);
  const category = isPrimaryBookingCategory(storedCategory)
    ? storedCategory
    : hintedCategory;
  const mode = String(payload.pricingMode || '').trim().toLowerCase();
  const price = (listing && listing.price) || {};

  if (category === LISTING_CATEGORIES.ACTIVITY) {
    return BOOKING_TYPES.PER_PERSON;
  }
  if (
    category === LISTING_CATEGORIES.PLACE ||
    category === LISTING_CATEGORIES.EQUIPMENT
  ) {
    if (mode === 'daily') return BOOKING_TYPES.DAILY;
    if (mode === 'hourly') return BOOKING_TYPES.HOURLY;
    if (mode === '') {
      if (hasConfiguredPrice(price.hourly) && !hasConfiguredPrice(price.daily)) {
        return BOOKING_TYPES.HOURLY;
      }
      if (hasConfiguredPrice(price.daily) && !hasConfiguredPrice(price.hourly)) {
        return BOOKING_TYPES.DAILY;
      }
      return BOOKING_TYPES.HOURLY;
    }
  }

  // Some existing listings use broader category labels like "Adventure".
  // Fall back to the configured prices so booking still works for them.
  if (mode === 'daily' && hasConfiguredPrice(price.daily)) {
    return BOOKING_TYPES.DAILY;
  }
  if (mode === 'hourly' && hasConfiguredPrice(price.hourly)) {
    return BOOKING_TYPES.HOURLY;
  }
  if (
    hasConfiguredPrice(price.perPerson) &&
    !hasConfiguredPrice(price.hourly) &&
    !hasConfiguredPrice(price.daily)
  ) {
    return BOOKING_TYPES.PER_PERSON;
  }
  if (hasConfiguredPrice(price.hourly) && !hasConfiguredPrice(price.daily)) {
    return BOOKING_TYPES.HOURLY;
  }
  if (hasConfiguredPrice(price.daily) && !hasConfiguredPrice(price.hourly)) {
    return BOOKING_TYPES.DAILY;
  }
  if (mode === '' && hasConfiguredPrice(price.hourly)) {
    return BOOKING_TYPES.HOURLY;
  }

  return null;
}

function addHoursToTime(timeString, hoursToAdd) {
  const [h, m] = timeString.split(':').map(Number);
  const totalMinutes = h * 60 + m + Math.round(hoursToAdd * 60);
  if (totalMinutes >= 24 * 60) {
    throw new ApiError(
      400,
      'Booking would extend to or past midnight. Use the daily pricing mode for multi-day bookings.'
    );
  }
  const endH = Math.floor(totalMinutes / 60);
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

function addDaysToDate(date, daysToAdd) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + daysToAdd);
  return result;
}

function expandBookingTimes(payload, bookingType) {
  const expanded = { ...payload };

  if (
    bookingType === BOOKING_TYPES.HOURLY ||
    bookingType === BOOKING_TYPES.PER_HOUR
  ) {
    if (!expanded.endDate) {
      expanded.endDate = expanded.startDate;
    }
    if (expanded.startTime && expanded.durationHours && !expanded.endTime) {
      expanded.endTime = addHoursToTime(expanded.startTime, expanded.durationHours);
    }
  } else if (bookingType === BOOKING_TYPES.DAILY) {
    if (expanded.durationDays && !expanded.endDate) {
      expanded.endDate = addDaysToDate(expanded.startDate, expanded.durationDays - 1);
    }
    expanded.startTime = null;
    expanded.endTime = null;
  } else if (bookingType === BOOKING_TYPES.PER_PERSON) {
    if (!expanded.endDate) {
      expanded.endDate = expanded.startDate;
    }
  }

  return expanded;
}

function validateBookingInputsForType(payload, listing, bookingType) {
  const errors = {};

  if (bookingType === BOOKING_TYPES.PER_PERSON) {
    if (
      payload.numberOfGuests === undefined ||
      payload.numberOfGuests === null
    ) {
      errors.numberOfGuests = 'Number of guests is required for activities.';
    } else if (
      !Number.isInteger(payload.numberOfGuests) ||
      payload.numberOfGuests < 1
    ) {
      errors.numberOfGuests = 'Number of guests must be a positive integer.';
    }
    if (!payload.startTime) errors.startTime = 'Start time is required for activities.';
    if (!payload.endTime) errors.endTime = 'End time is required for activities.';
  } else if (
    bookingType === BOOKING_TYPES.HOURLY ||
    bookingType === BOOKING_TYPES.PER_HOUR
  ) {
    if (!payload.startTime) {
      errors.startTime = 'Start time is required for hourly bookings.';
    }
    const hasDuration =
      payload.durationHours !== undefined && payload.durationHours !== null;
    if (!hasDuration && !payload.endTime) {
      errors.durationHours =
        'durationHours is required (or provide endTime explicitly).';
    }
  } else if (bookingType === BOOKING_TYPES.DAILY) {
    const hasDurationDays =
      payload.durationDays !== undefined && payload.durationDays !== null;
    if (!hasDurationDays && !payload.endDate) {
      errors.durationDays =
        'durationDays is required (or provide endDate explicitly).';
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }
}

function calculateBookingPricing(payload, listing, bookingType) {
  let pricePerUnit;
  let unitsBooked;

  switch (bookingType) {
    case BOOKING_TYPES.PER_PERSON:
      pricePerUnit = listing.price.perPerson;
      unitsBooked = payload.numberOfGuests;
      break;
    case BOOKING_TYPES.PER_HOUR:
    case BOOKING_TYPES.HOURLY:
      pricePerUnit = listing.price.hourly;
      unitsBooked = calculateHoursBetween(payload.startTime, payload.endTime);
      if (unitsBooked < 0.5) {
        throw new ApiError(400, 'Minimum booking duration is 30 minutes.');
      }
      unitsBooked = Number(unitsBooked.toFixed(2));
      break;
    case BOOKING_TYPES.DAILY:
      pricePerUnit = listing.price.daily;
      unitsBooked =
        payload.durationDays && payload.durationDays > 0
          ? payload.durationDays
          : calculateDaysBetween(payload.startDate, payload.endDate);
      break;
    default:
      throw new ApiError(400, 'Unsupported booking type.');
  }

  if (pricePerUnit === undefined || pricePerUnit === null) {
    const friendlyMode =
      bookingType === BOOKING_TYPES.PER_PERSON ? 'per-person' : bookingType;
    throw new ApiError(
      400,
      `This listing does not have a ${friendlyMode} price configured.`
    );
  }

  const deliveryFee =
    payload.includeDelivery && listing.price.delivery && listing.price.delivery.enabled
      ? Number(listing.price.delivery.fee) || 0
      : 0;

  const subtotal = Number((pricePerUnit * unitsBooked).toFixed(2));
  const serviceFee = SERVICE_FEE_AMOUNT;
  const totalAmount = Number((subtotal + serviceFee + deliveryFee).toFixed(2));

  return {
    pricePerUnit,
    unitsBooked,
    subtotal,
    serviceFee,
    deliveryFee,
    totalAmount,
    currency: listing.price.currency,
  };
}

function describeGuest(guest) {
  if (!guest) return 'A guest';
  const profile = guest.providerProfile || {};
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  return fullName || guest.agencyName || guest.email || 'A guest';
}

async function notifyHostOfBookingRequest(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return;

  const [listing, host, guest] = await Promise.all([
    Listing.findById(booking.listing),
    User.findById(booking.host),
    User.findById(booking.bookedBy),
  ]);

  if (!host) return;

  if (host.email) {
    try {
      const emailTemplate = buildNewBookingHostEmail({ booking, listing, guest });
      await sendMail({
        to: host.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text,
      });
    } catch (error) {
      console.error('Failed to send new booking notification email.', error);
    }
  }

  const guestName = describeGuest(guest);
  const listingTitle = (listing && listing.title) || 'your listing';

  sendNotification(host._id, {
    type: NOTIFICATION_TYPES.BOOKING_REQUEST,
    title: 'New booking request',
    body: `${guestName} requested to book ${listingTitle}. Accept or decline within ${
      booking.authExpiresAt
        ? Math.max(1, Math.ceil((booking.authExpiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
        : 6
    } days.`,
    data: {
      bookingId: booking._id.toString(),
      listingId: listing && listing._id ? listing._id.toString() : '',
      guestId: guest && guest._id ? guest._id.toString() : '',
    },
  }).catch((error) => console.error('Failed to send booking-request push notification.', error));
}

async function buildBookingQuote(payload, userId) {
  const listing = await Listing.findById(payload.listingId);
  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }
  if (listing.createdBy.toString() === userId.toString()) {
    throw new ApiError(400, 'You cannot book your own listing.');
  }

  const bookingType = resolveBookingType(payload, listing) || payload.bookingType;
  if (!bookingType) {
    throw new ApiError(
      400,
      'Could not determine booking mode for this listing. Listing category must be one of: activity, place, equipment.'
    );
  }

  validateBookingInputsForType(payload, listing, bookingType);
  const resolved = expandBookingTimes(payload, bookingType);
  const pricing = calculateBookingPricing(resolved, listing, bookingType);

  return {
    listing,
    bookingType,
    resolved,
    pricing,
  };
}

async function getBookingQuote(payload, userId) {
  const { listing, bookingType, resolved, pricing } = await buildBookingQuote(payload, userId);

  return {
    listingId: listing._id.toString(),
    category: listing.category,
    bookingType,
    pricingMode: resolved.pricingMode || null,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
    startTime: resolved.startTime,
    endTime: resolved.endTime,
    numberOfGuests: resolved.numberOfGuests || null,
    durationHours: resolved.durationHours || null,
    durationDays: resolved.durationDays || null,
    pricing,
  };
}

async function createBooking(payload, userId) {
  const { listing, bookingType, resolved, pricing } = await buildBookingQuote(payload, userId);

  const host = await User.findById(listing.createdBy).select('+stripeConnect email role agencyName');
  if (!host || !host.stripeConnect || !host.stripeConnect.accountId) {
    throw new ApiError(
      400,
      'This provider has not connected a payment account yet. Booking is unavailable.'
    );
  }
  if (!host.stripeConnect.chargesEnabled) {
    throw new ApiError(
      400,
      'This provider has not finished payment onboarding. Booking is unavailable.'
    );
  }

  const numberOfGuests =
    bookingType === BOOKING_TYPES.PER_PERSON ? resolved.numberOfGuests : null;

  const booking = await Booking.create({
    listing: listing._id,
    bookedBy: userId,
    host: listing.createdBy,
    bookingType,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
    startTime: resolved.startTime,
    endTime: resolved.endTime,
    numberOfGuests,
    pricePerUnit: pricing.pricePerUnit,
    unitsBooked: pricing.unitsBooked,
    subtotal: pricing.subtotal,
    serviceFee: pricing.serviceFee,
    totalAmount: pricing.totalAmount,
    currency: pricing.currency,
    status: BOOKING_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.REQUIRES_PAYMENT,
    stripeAccountId: host.stripeConnect.accountId,
  });

  const guest = await User.findById(userId);
  const payment = await paymentsService.authorizeBookingPayment(
    booking._id,
    guest,
    payload.paymentMethodId
  );

  return {
    booking: booking.toJSON(),
    payment,
  };
}

async function acceptBookingRequest(bookingId, hostUserId) {
  const booking = await paymentsService.capturePaymentForBooking(bookingId, hostUserId);
  return booking.toJSON();
}

async function declineBookingRequest(bookingId, hostUserId, reason) {
  const { booking } = await paymentsService.cancelAuthorizationForBooking(
    bookingId,
    hostUserId,
    reason
  );

  sendNotification(booking.bookedBy, {
    type: NOTIFICATION_TYPES.BOOKING_DECLINED,
    title: 'Booking declined',
    body: reason
      ? `The host declined your booking: ${reason}. Your card was not charged.`
      : 'The host declined your booking. Your card was not charged.',
    data: {
      bookingId: booking._id.toString(),
      listingId: booking.listing ? booking.listing.toString() : '',
    },
  }).catch((error) => console.error('Failed to notify guest of decline.', error));

  sendNotification(booking.host, {
    type: NOTIFICATION_TYPES.BOOKING_DECLINED,
    title: 'Request declined',
    body: 'You declined the booking request. The guest was not charged.',
    data: {
      bookingId: booking._id.toString(),
      listingId: booking.listing ? booking.listing.toString() : '',
    },
  }).catch((error) => console.error('Failed to notify host of decline confirmation.', error));

  return booking.toJSON();
}

async function getBookingsForGuest(userId, { page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { bookedBy: userId };

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate('listing')
      .populate('host', 'email role agencyName city')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Booking.countDocuments(filter),
  ]);

  const serializedBookings = bookings.map((booking) => booking.toJSON());

  return {
    bookings: await attachReviewDataToBookings(serializedBookings, userId),
    pagination: buildPagination(total, page, limit),
  };
}

async function getBookingsForHost(hostId, { page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { host: hostId };

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate('listing')
      .populate('bookedBy', 'email role city')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Booking.countDocuments(filter),
  ]);

  return {
    bookings: bookings.map((booking) => booking.toJSON()),
    pagination: buildPagination(total, page, limit),
  };
}

async function getBookingByIdForUser(bookingId, userId) {
  const booking = await Booking.findById(bookingId)
    .populate('listing')
    .populate('host', 'email role agencyName city')
    .populate('bookedBy', 'email role city');

  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  const isParticipant =
    booking.bookedBy._id.toString() === userId.toString() ||
    booking.host._id.toString() === userId.toString();

  if (!isParticipant) {
    throw new ApiError(403, 'You are not allowed to view this booking.');
  }

  const [serializedBooking] = await attachReviewDataToBookings([booking.toJSON()], userId);
  return serializedBooking;
}

async function cancelBooking(bookingId, userId) {
  const booking = await Booking.findById(bookingId);

  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  const isGuest = booking.bookedBy.toString() === userId.toString();
  const isHost = booking.host.toString() === userId.toString();

  if (!isGuest && !isHost) {
    throw new ApiError(403, 'You are not allowed to cancel this booking.');
  }

  if (booking.status === BOOKING_STATUS.CANCELLED) {
    throw new ApiError(400, 'Booking is already cancelled.');
  }

  if (booking.status === BOOKING_STATUS.COMPLETED) {
    throw new ApiError(400, 'Completed bookings cannot be cancelled.');
  }

  if (booking.paymentStatus === PAYMENT_STATUS.AUTHORIZED) {
    const result = await paymentsService.cancelAuthorizationForBooking(
      bookingId,
      userId,
      isHost ? 'Declined by host.' : null
    );

    const otherParty = isGuest ? result.booking.host : result.booking.bookedBy;
    if (otherParty) {
      sendNotification(otherParty, {
        type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
        title: 'Booking cancelled',
        body: isGuest
          ? 'The guest cancelled the booking. No charge was made.'
          : 'The host cancelled the booking. Your card was not charged.',
        data: {
          bookingId: result.booking._id.toString(),
          listingId: result.booking.listing ? result.booking.listing.toString() : '',
          cancelledBy: userId.toString(),
        },
      }).catch((error) =>
        console.error('Failed to send booking cancellation notification.', error)
      );
    }

    sendNotification(userId, {
      type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
      title: 'Booking cancelled',
      body: 'The booking has been cancelled. No charge was made.',
      data: {
        bookingId: result.booking._id.toString(),
        listingId: result.booking.listing ? result.booking.listing.toString() : '',
      },
    }).catch((error) =>
      console.error('Failed to send booking cancellation confirmation.', error)
    );

    return result.booking.toJSON();
  }

  booking.status = BOOKING_STATUS.CANCELLED;
  booking.cancelledAt = new Date();
  booking.cancelledBy = userId;
  await booking.save();

  const otherPartyId = isGuest ? booking.host : booking.bookedBy;
  if (otherPartyId) {
    sendNotification(otherPartyId, {
      type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
      title: 'Booking cancelled',
      body: isGuest
        ? 'A guest cancelled their booking.'
        : 'The host cancelled your booking.',
      data: {
        bookingId: booking._id.toString(),
        listingId: booking.listing ? booking.listing.toString() : '',
        cancelledBy: userId.toString(),
      },
    }).catch((error) =>
      console.error('Failed to send booking cancellation notification.', error)
    );
  }

  sendNotification(userId, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: 'Booking cancelled',
    body: 'You cancelled the booking.',
    data: {
      bookingId: booking._id.toString(),
      listingId: booking.listing ? booking.listing.toString() : '',
    },
  }).catch((error) =>
    console.error('Failed to send booking cancellation confirmation.', error)
  );

  return booking.toJSON();
}

function buildPagination(total, page, limit) {
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

module.exports = {
  createBooking,
  getBookingQuote,
  getBookingsForGuest,
  getBookingsForHost,
  getBookingByIdForUser,
  cancelBooking,
  acceptBookingRequest,
  declineBookingRequest,
  notifyHostOfBookingRequest,
};
