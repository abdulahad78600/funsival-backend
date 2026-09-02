const mongoose = require('mongoose');

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

const HOST_REVENUE_PAYMENT_STATUSES = [
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.REFUNDING,
  PAYMENT_STATUS.RELEASING,
  PAYMENT_STATUS.RELEASED,
];

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

function bookingHasSlots(payload) {
  return Array.isArray(payload.slots) && payload.slots.length > 0;
}

function isHourlyBookingType(bookingType) {
  return (
    bookingType === BOOKING_TYPES.HOURLY || bookingType === BOOKING_TYPES.PER_HOUR
  );
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
    if (bookingHasSlots(expanded)) {
      // Slots are already sorted and non-overlapping (payload validation).
      // The overall window spans from the first slot to the last one.
      expanded.startTime = expanded.slots[0].startTime;
      expanded.endTime = expanded.slots[expanded.slots.length - 1].endTime;
    } else if (expanded.startTime && expanded.durationHours && !expanded.endTime) {
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
    if (!bookingHasSlots(payload)) {
      if (!payload.startTime) {
        errors.startTime =
          'Start time is required for hourly bookings (or provide slots).';
      }
      const hasDuration =
        payload.durationHours !== undefined && payload.durationHours !== null;
      if (!hasDuration && !payload.endTime) {
        errors.durationHours =
          'durationHours is required (or provide endTime or slots).';
      }
    }
  } else if (bookingType === BOOKING_TYPES.DAILY) {
    const hasDurationDays =
      payload.durationDays !== undefined && payload.durationDays !== null;
    if (!hasDurationDays && !payload.endDate) {
      errors.durationDays =
        'durationDays is required (or provide endDate explicitly).';
    }
  }

  if (bookingHasSlots(payload) && !isHourlyBookingType(bookingType)) {
    errors.slots = 'Multiple time slots are only supported for hourly bookings.';
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
      unitsBooked = bookingHasSlots(payload)
        ? payload.slots.reduce(
            (total, slot) =>
              total + calculateHoursBetween(slot.startTime, slot.endTime),
            0
          )
        : calculateHoursBetween(payload.startTime, payload.endTime);
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

function startOfUtcDay(date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function getRequestedIntervals(resolved) {
  const slots = bookingHasSlots(resolved)
    ? resolved.slots
    : [{ startTime: resolved.startTime, endTime: resolved.endTime }];

  return slots
    .filter((slot) => slot.startTime && slot.endTime)
    .map((slot) => ({
      startTime: slot.startTime,
      endTime: slot.endTime,
      start: timeStringToMinutes(slot.startTime),
      end: timeStringToMinutes(slot.endTime),
    }));
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function ensureSlotsWithinListingAvailability(listing, resolved, requested) {
  const dayStart = startOfUtcDay(resolved.startDate).getTime();

  const windows = (listing.availability || []).filter(
    (entry) =>
      entry.isAvailable !== false &&
      entry.date &&
      startOfUtcDay(entry.date).getTime() === dayStart
  );

  if (windows.length === 0) {
    throw new ApiError(400, 'This listing is not available on the selected date.');
  }

  const outside = requested.filter(
    (slot) =>
      !windows.some(
        (window) =>
          slot.start >= timeStringToMinutes(window.startTime) &&
          slot.end <= timeStringToMinutes(window.endTime)
      )
  );

  if (outside.length > 0) {
    throw new ApiError(400, 'Some selected slots are outside the listing availability.', {
      slots: outside.map(({ startTime, endTime }) => ({ startTime, endTime })),
    });
  }
}

async function ensureHourlySlotsNotBooked(listing, resolved, requested) {
  const dayStart = startOfUtcDay(resolved.startDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const activeBookings = await Booking.find({
    listing: listing._id,
    status: {
      $in: [
        BOOKING_STATUS.PENDING,
        BOOKING_STATUS.AWAITING_HOST_APPROVAL,
        BOOKING_STATUS.CONFIRMED,
      ],
    },
    bookingType: { $in: [BOOKING_TYPES.HOURLY, BOOKING_TYPES.PER_HOUR] },
    startDate: { $lt: dayEnd },
    endDate: { $gte: dayStart },
  }).select('startTime endTime slots');

  const bookedIntervals = activeBookings.flatMap((booking) => {
    const slots =
      Array.isArray(booking.slots) && booking.slots.length > 0
        ? booking.slots
        : [{ startTime: booking.startTime, endTime: booking.endTime }];
    return slots
      .filter((slot) => slot.startTime && slot.endTime)
      .map((slot) => ({
        start: timeStringToMinutes(slot.startTime),
        end: timeStringToMinutes(slot.endTime),
      }));
  });

  const conflicting = requested.filter((slot) =>
    bookedIntervals.some((booked) =>
      intervalsOverlap(slot.start, slot.end, booked.start, booked.end)
    )
  );

  if (conflicting.length > 0) {
    throw new ApiError(409, 'One or more selected time slots are no longer available.', {
      slots: conflicting.map(({ startTime, endTime }) => ({ startTime, endTime })),
    });
  }
}

async function ensureHourlyBookingIsAvailable(listing, resolved, bookingType) {
  if (!isHourlyBookingType(bookingType)) return;

  const requested = getRequestedIntervals(resolved);
  if (requested.length === 0) return;

  // Only slot-based bookings are validated against the published availability
  // windows — legacy single-span clients never sent slots and may book times
  // the host has not listed, which we keep working as before.
  if (bookingHasSlots(resolved)) {
    ensureSlotsWithinListingAvailability(listing, resolved, requested);
  }

  await ensureHourlySlotsNotBooked(listing, resolved, requested);
}

async function buildBookingQuote(payload, userId) {
  const listing = await Listing.findById(payload.listingId);
  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }
  if (!listing.isActive) {
    throw new ApiError(400, 'This listing is currently inactive and cannot be booked.');
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
  await ensureHourlyBookingIsAvailable(listing, resolved, bookingType);
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
    slots: bookingHasSlots(resolved) ? resolved.slots : null,
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
  if (!host.stripeConnect.transfersEnabled) {
    throw new ApiError(
      400,
      'This provider has not finished payout onboarding. Booking is unavailable.'
    );
  }

  const numberOfGuests =
    bookingType === BOOKING_TYPES.PER_PERSON ? resolved.numberOfGuests : null;

  const booking = await Booking.create({
    listing: listing._id,
    listingSnapshot: {
      title: listing.basicInformation?.activityTitle || null,
      location: listing.basicInformation?.location || null,
      category: listing.category || null,
      photo: Array.isArray(listing.photos) && listing.photos.length > 0 ? listing.photos[0] : null,
    },
    bookedBy: userId,
    host: listing.createdBy,
    bookingType,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
    startTime: resolved.startTime,
    endTime: resolved.endTime,
    slots: bookingHasSlots(resolved) ? resolved.slots : [],
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
  let payment;
  try {
    payment = await paymentsService.authorizeBookingPayment(
      booking._id,
      guest,
      payload.paymentMethodId
    );
  } catch (error) {
    // The booking was inserted before payment authorization; if the payment
    // never got off the ground, remove it so its slots free up immediately
    // instead of blocking the calendar as a phantom PENDING booking.
    const current = await Booking.findById(booking._id).select('paymentStatus');
    if (
      current &&
      (current.paymentStatus === PAYMENT_STATUS.REQUIRES_PAYMENT ||
        current.paymentStatus === PAYMENT_STATUS.FAILED)
    ) {
      await Booking.deleteOne({ _id: current._id });
    }
    throw error;
  }

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

// Guest "My Reservations" tabs. "In progress" is anything the guest is still
// waiting on or attending: not yet finished, not cancelled/declined.
const GUEST_RESERVATION_TABS = ['all', 'in_progress', 'completed', 'cancelled'];
const IN_PROGRESS_STATUSES = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.AWAITING_HOST_APPROVAL,
  BOOKING_STATUS.CONFIRMED,
];

function buildGuestReservationStatusFilter(tab) {
  switch (tab) {
    case 'in_progress':
      return { status: { $in: IN_PROGRESS_STATUSES } };
    case 'completed':
      return { status: BOOKING_STATUS.COMPLETED };
    case 'cancelled':
      return { status: { $in: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.DECLINED, BOOKING_STATUS.LISTING_DELETED] } };
    default:
      return null;
  }
}

function guestReservationCountFacet() {
  const facet = { all: [{ $count: 'count' }] };
  GUEST_RESERVATION_TABS.filter((tab) => tab !== 'all').forEach((tab) => {
    facet[tab] = [{ $match: buildGuestReservationStatusFilter(tab) }, { $count: 'count' }];
  });
  return facet;
}

async function getBookingsForGuest(userId, { page = 1, limit = 10, tab = 'all' } = {}) {
  const skip = (page - 1) * limit;
  const normalizedTab = typeof tab === 'string' ? tab.trim().toLowerCase() : 'all';
  if (!GUEST_RESERVATION_TABS.includes(normalizedTab)) {
    throw new ApiError(
      400,
      `Invalid tab. Allowed values: ${GUEST_RESERVATION_TABS.join(', ')}.`
    );
  }

  const guestId =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));
  const commonFilter = { bookedBy: guestId };
  const filter = combineReservationFilters(
    commonFilter,
    buildGuestReservationStatusFilter(normalizedTab)
  );

  const [bookings, [countResult = {}]] = await Promise.all([
    Booking.find(filter)
      .populate('listing')
      .populate('host', 'email role agencyName city')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Booking.aggregate([{ $match: commonFilter }, { $facet: guestReservationCountFacet() }]),
  ]);

  await paymentsService.reconcileProcessingBookings(bookings);

  const count = (key) => {
    const rows = countResult && countResult[key];
    return rows && rows[0] ? rows[0].count : 0;
  };
  const counts = {
    all: count('all'),
    in_progress: count('in_progress'),
    completed: count('completed'),
    cancelled: count('cancelled'),
  };

  const serializedBookings = bookings.map((booking) => booking.toJSON());

  return {
    bookings: await attachReviewDataToBookings(serializedBookings, userId),
    pagination: buildPagination(counts[normalizedTab], page, limit),
    filters: {
      tab: normalizedTab,
      counts,
    },
  };
}

const RESERVATION_TABS = ['all', 'active', 'upcoming', 'completed', 'cancelled'];

function buildReservationStatusFilter(tab, now) {
  switch (tab) {
    case 'active':
      return {
        status: BOOKING_STATUS.CONFIRMED,
        startDate: { $lte: now },
        endDate: { $gte: now },
      };
    case 'upcoming':
      return {
        status: BOOKING_STATUS.CONFIRMED,
        startDate: { $gt: now },
      };
    case 'completed':
      return { status: BOOKING_STATUS.COMPLETED };
    case 'cancelled':
      return { status: { $in: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.DECLINED, BOOKING_STATUS.LISTING_DELETED] } };
    default:
      return null;
  }
}

function buildReservationDateFilter(date) {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const start = new Date(parsed);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    startDate: { $lt: end },
    endDate: { $gte: start },
  };
}

function combineReservationFilters(...filters) {
  const activeFilters = filters.filter(Boolean);
  if (activeFilters.length === 1) return activeFilters[0];
  return { $and: activeFilters };
}

function escapeSearchPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buildReservationSearchFilter(search, hostId) {
  if (!search) return null;

  const regex = new RegExp(escapeSearchPattern(search), 'i');
  const customerTokenFilters = search
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const tokenRegex = new RegExp(escapeSearchPattern(token), 'i');
      return {
        $or: [
          { email: tokenRegex },
          { city: tokenRegex },
          { 'providerProfile.firstName': tokenRegex },
          { 'providerProfile.lastName': tokenRegex },
          { 'providerProfile.businessName': tokenRegex },
        ],
      };
    });
  const [matchingListings, matchingCustomers] = await Promise.all([
    Listing.find({
      createdBy: hostId,
      $or: [
        { 'basicInformation.activityTitle': regex },
        { 'basicInformation.location': regex },
        { 'placeLocation.city': regex },
        { category: regex },
        { type: regex },
      ],
    })
      .select('_id')
      .lean(),
    User.find({ $and: customerTokenFilters })
      .select('_id')
      .lean(),
  ]);

  const matches = [
    { listing: { $in: matchingListings.map((listing) => listing._id) } },
    { bookedBy: { $in: matchingCustomers.map((customer) => customer._id) } },
  ];
  if (mongoose.Types.ObjectId.isValid(search)) {
    matches.unshift({ _id: new mongoose.Types.ObjectId(search) });
  }

  return { $or: matches };
}

function reservationCountFacet(now) {
  const countPipeline = (filter) => [{ $match: filter }, { $count: 'count' }];
  return {
    all: [{ $count: 'count' }],
    active: countPipeline(buildReservationStatusFilter('active', now)),
    upcoming: countPipeline(buildReservationStatusFilter('upcoming', now)),
    completed: countPipeline(buildReservationStatusFilter('completed', now)),
    cancelled: countPipeline(buildReservationStatusFilter('cancelled', now)),
  };
}

function readReservationCounts(facetResult) {
  const count = (key) => {
    const rows = facetResult && facetResult[key];
    return rows && rows[0] ? rows[0].count : 0;
  };
  return {
    all: count('all'),
    active: count('active'),
    upcoming: count('upcoming'),
    completed: count('completed'),
    cancelled: count('cancelled'),
  };
}

async function buildHostReservationQuery(
  hostId,
  { tab = 'all', date = null, search = '' } = {},
  now = new Date()
) {
  const normalizedHostId =
    hostId instanceof mongoose.Types.ObjectId
      ? hostId
      : new mongoose.Types.ObjectId(String(hostId));
  const normalizedTab = typeof tab === 'string' ? tab.trim().toLowerCase() : 'all';
  if (!RESERVATION_TABS.includes(normalizedTab)) {
    throw new ApiError(
      400,
      `Invalid tab. Allowed values: ${RESERVATION_TABS.join(', ')}.`
    );
  }

  const trimmedSearch = typeof search === 'string' ? search.trim() : '';
  const searchFilter = await buildReservationSearchFilter(
    trimmedSearch,
    normalizedHostId
  );
  const dateFilter = buildReservationDateFilter(date);
  const commonFilter = combineReservationFilters(
    { host: normalizedHostId },
    dateFilter,
    searchFilter
  );

  return {
    commonFilter,
    filter: combineReservationFilters(
      commonFilter,
      buildReservationStatusFilter(normalizedTab, now)
    ),
    normalizedTab,
    trimmedSearch,
  };
}

async function getBookingsForHost(
  hostId,
  { page = 1, limit = 10, tab = 'all', date = null, search = '' } = {}
) {
  const skip = (page - 1) * limit;
  const now = new Date();
  const { commonFilter, filter, normalizedTab, trimmedSearch } =
    await buildHostReservationQuery(hostId, { tab, date, search }, now);

  const [bookings, [countResult = {}]] = await Promise.all([
    Booking.find(filter)
      .populate('listing')
      .populate(
        'bookedBy',
        'email role city providerProfile.firstName providerProfile.lastName'
      )
      .populate('cancelledBy', 'email')
      .populate('declinedBy', 'email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Booking.aggregate([
      { $match: commonFilter },
      { $facet: reservationCountFacet(now) },
    ]),
  ]);

  await paymentsService.reconcileProcessingBookings(bookings);

  const counts = readReservationCounts(countResult);
  const total = counts[normalizedTab];

  return {
    bookings: bookings.map((booking) => booking.toJSON()),
    pagination: buildPagination(total, page, limit),
    filters: {
      tab: normalizedTab,
      search: trimmedSearch || null,
      date: date ? new Date(date).toISOString().slice(0, 10) : null,
      counts: {
        all: counts.all,
        upcoming: counts.upcoming,
        completed: counts.completed,
        cancelled: counts.cancelled,
      },
    },
  };
}

function csvCell(value) {
  if (value === undefined || value === null) return '';
  let stringValue = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(stringValue)) stringValue = `'${stringValue}`;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function getCustomerName(customer) {
  if (!customer) return '';
  const profile = customer.providerProfile;
  const fullName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ')
    : '';
  return fullName || customer.email || '';
}

async function exportHostBookingsCsv(
  hostId,
  { tab = 'all', date = null, search = '' } = {}
) {
  const { filter } = await buildHostReservationQuery(hostId, { tab, date, search });
  const bookings = await Booking.find(filter)
    .populate('listing', 'basicInformation.activityTitle category type')
    .populate(
      'bookedBy',
      'email city providerProfile.firstName providerProfile.lastName'
    )
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean();
  const headers = [
    'Reservation ID',
    'Listing',
    'Category',
    'Type',
    'Reserved By',
    'Customer Email',
    'Start Date',
    'Start Time',
    'End Date',
    'End Time',
    'Reservation Status',
    'Payment Status',
    'Gross Amount',
    'Host Earnings',
    'Currency',
    'Booked At',
  ];
  const rows = bookings.map((booking) => {
    const listing = booking.listing;
    const customer = booking.bookedBy;
    return [
      booking._id,
      listing && listing.basicInformation
        ? listing.basicInformation.activityTitle
        : '',
      listing ? listing.category : '',
      listing ? listing.type : '',
      getCustomerName(customer),
      customer ? customer.email : '',
      booking.startDate,
      booking.startTime,
      booking.endDate,
      booking.endTime,
      booking.status,
      booking.paymentStatus,
      booking.totalAmount,
      booking.merchantAmount,
      booking.currency,
      booking.createdAt,
    ].map(csvCell).join(',');
  });

  return `\uFEFF${[headers.map(csvCell).join(','), ...rows].join('\n')}`;
}

function startOfUtcWeek(date) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function rate(numerator, denominator) {
  return denominator > 0
    ? Math.round(((numerator / denominator) * 100 + Number.EPSILON) * 100) / 100
    : 0;
}

function changePercentage(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round((((current - previous) / previous) * 100 + Number.EPSILON) * 100) / 100;
}

async function getHostReservationStats(hostId) {
  const now = new Date();
  const normalizedHostId =
    hostId instanceof mongoose.Types.ObjectId
      ? hostId
      : new mongoose.Types.ObjectId(String(hostId));
  const weekStart = startOfUtcWeek(now);
  const previousWeekStart = new Date(weekStart);
  previousWeekStart.setUTCDate(previousWeekStart.getUTCDate() - 7);
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  const [
    statusRows,
    upcomingCount,
    weekRows,
    revenueRows,
    customerRows,
    completionRows,
  ] =
    await Promise.all([
      Booking.aggregate([
        { $match: { host: normalizedHostId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Booking.countDocuments({
        host: normalizedHostId,
        ...buildReservationStatusFilter('upcoming', now),
      }),
      Booking.aggregate([
        {
          $match: {
            host: normalizedHostId,
            createdAt: { $gte: previousWeekStart, $lt: nextWeekStart },
          },
        },
        {
          $group: {
            _id: null,
            currentWeek: {
              $sum: { $cond: [{ $gte: ['$createdAt', weekStart] }, 1, 0] },
            },
            previousWeek: {
              $sum: { $cond: [{ $lt: ['$createdAt', weekStart] }, 1, 0] },
            },
          },
        },
      ]),
      Booking.aggregate([
        {
          $match: {
            host: normalizedHostId,
            paidAt: { $ne: null },
            paymentStatus: { $in: HOST_REVENUE_PAYMENT_STATUSES },
          },
        },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ['$currency', 'USD'] } },
            amount: { $ifNull: ['$merchantAmount', 0] },
            paidAt: 1,
          },
        },
        {
          $group: {
            _id: '$currency',
            total: { $sum: '$amount' },
            currentMonth: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$paidAt', monthStart] },
                      { $lt: ['$paidAt', nextMonthStart] },
                    ],
                  },
                  '$amount',
                  0,
                ],
              },
            },
            previousMonth: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$paidAt', previousMonthStart] },
                      { $lt: ['$paidAt', monthStart] },
                    ],
                  },
                  '$amount',
                  0,
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        {
          $match: {
            host: normalizedHostId,
            status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.DECLINED] },
          },
        },
        { $group: { _id: '$bookedBy', firstReservationAt: { $min: '$createdAt' } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            newThisWeek: {
              $sum: {
                $cond: [{ $gte: ['$firstReservationAt', weekStart] }, 1, 0],
              },
            },
          },
        },
      ]),
      Booking.aggregate([
        {
          $match: {
            host: normalizedHostId,
            status: {
              $in: [
                BOOKING_STATUS.COMPLETED,
                BOOKING_STATUS.CANCELLED,
                BOOKING_STATUS.DECLINED,
              ],
            },
            startDate: { $gte: previousMonthStart, $lt: nextMonthStart },
          },
        },
        {
          $group: {
            _id: null,
            currentCompleted: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
                      { $gte: ['$startDate', monthStart] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            currentDecided: {
              $sum: { $cond: [{ $gte: ['$startDate', monthStart] }, 1, 0] },
            },
            previousCompleted: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
                      { $lt: ['$startDate', monthStart] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            previousDecided: {
              $sum: { $cond: [{ $lt: ['$startDate', monthStart] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

  const counts = new Map(statusRows.map((row) => [row._id, row.count]));
  const count = (status) => counts.get(status) || 0;
  const upcoming = upcomingCount;
  const completed = count(BOOKING_STATUS.COMPLETED);
  const cancelled =
    count(BOOKING_STATUS.CANCELLED) + count(BOOKING_STATUS.DECLINED);
  const pending =
    count(BOOKING_STATUS.PENDING) + count(BOOKING_STATUS.AWAITING_HOST_APPROVAL);
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  const week = weekRows[0] || { currentWeek: 0, previousWeek: 0 };
  const customers = customerRows[0] || { total: 0, newThisWeek: 0 };
  const completion = completionRows[0] || {
    currentCompleted: 0,
    currentDecided: 0,
    previousCompleted: 0,
    previousDecided: 0,
  };
  const allTimeCompletionRate = rate(completed, completed + cancelled);
  const currentMonthRate = rate(
    completion.currentCompleted,
    completion.currentDecided
  );
  const previousMonthRate = rate(
    completion.previousCompleted,
    completion.previousDecided
  );

  return {
    upcoming,
    completed,
    cancelled,
    pending,
    cards: {
      totalReservations: {
        total,
        currentWeek: week.currentWeek,
        previousWeek: week.previousWeek,
        changeFromLastWeek: week.currentWeek - week.previousWeek,
      },
      revenue: revenueRows.map((row) => ({
        currency: row._id,
        total: row.total,
        currentMonth: row.currentMonth,
        previousMonth: row.previousMonth,
        monthChangePercentage: changePercentage(
          row.currentMonth,
          row.previousMonth
        ),
      })),
      activeCustomers: {
        total: customers.total,
        newThisWeek: customers.newThisWeek,
      },
      completionRate: {
        rate: allTimeCompletionRate,
        currentMonthRate,
        previousMonthRate,
        changePercentage: Math.round(
          ((currentMonthRate - previousMonthRate) + Number.EPSILON) * 100
        ) / 100,
      },
    },
    tabs: { all: total, upcoming, completed, cancelled, pending },
  };
}

async function getBookingByIdForUser(bookingId, userId) {
  const booking = await Booking.findById(bookingId)
    .populate('listing')
    .populate('host', 'email role agencyName city')
    .populate('bookedBy', 'email role city')
    .populate('cancelledBy', 'email')
    .populate('declinedBy', 'email');

  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  const isParticipant =
    booking.bookedBy._id.toString() === userId.toString() ||
    booking.host._id.toString() === userId.toString();

  if (!isParticipant) {
    throw new ApiError(403, 'You are not allowed to view this booking.');
  }

  await paymentsService.reconcileProcessingBooking(booking);

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

// Cancels + refunds every in-progress booking on a listing the host is
// deleting, and notifies each affected guest. One booking's failure doesn't
// abort the rest — each is handled independently and logged on error.
async function cancelBookingsForDeletedListing(listingId, hostId) {
  const bookings = await Booking.find({
    listing: listingId,
    status: { $in: IN_PROGRESS_STATUSES },
  });

  let processedCount = 0;

  for (const booking of bookings) {
    try {
      let refunded = false;

      if (booking.paymentStatus === PAYMENT_STATUS.AUTHORIZED) {
        await paymentsService.cancelAuthorizationForBooking(
          booking._id,
          hostId,
          'Listing deleted by provider.'
        );
        refunded = true;
      } else if (booking.paymentStatus === PAYMENT_STATUS.HELD) {
        await paymentsService.executeStripeRefund(booking, hostId, 'requested_by_customer');
        refunded = true;
      } else if (
        booking.paymentStatus === PAYMENT_STATUS.RELEASED ||
        booking.paymentStatus === PAYMENT_STATUS.RELEASING
      ) {
        // Funds have already moved to the host — this can't be auto-refunded
        // via Stripe. Flag loudly for manual/admin follow-up rather than
        // silently proceeding as if the guest was made whole.
        console.error(
          `Listing deletion cancelled booking ${booking._id} whose payment is already ` +
            `${booking.paymentStatus} (funds released to host) — needs manual refund review.`
        );
      }

      // cancelAuthorizationForBooking (called above when acting as the host)
      // marks the booking DECLINED and sets declinedBy/declinedAt/declineReason.
      // Clear those alongside the LISTING_DELETED overwrite so a booking never
      // shows both "declined by" and "cancelled by" for the same event.
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            status: BOOKING_STATUS.LISTING_DELETED,
            cancelledAt: new Date(),
            cancelledBy: hostId,
          },
          $unset: {
            declinedAt: '',
            declinedBy: '',
            declineReason: '',
          },
        }
      );

      sendNotification(booking.bookedBy, {
        type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
        title: 'Listing removed',
        body: refunded
          ? 'The provider removed this listing. Your booking has been cancelled and any payment has been refunded.'
          : 'The provider removed this listing. Your booking has been cancelled. Our team will follow up about your payment shortly.',
        data: {
          bookingId: booking._id.toString(),
          listingId: booking.listing ? booking.listing.toString() : '',
        },
      }).catch((error) =>
        console.error('Failed to notify guest of listing-deletion cancellation.', error)
      );

      processedCount += 1;
    } catch (error) {
      console.error(
        `Failed to cancel booking ${booking._id} for deleted listing ${listingId}.`,
        error
      );
    }
  }

  return { processedCount, totalCount: bookings.length };
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
  exportHostBookingsCsv,
  getHostReservationStats,
  getBookingByIdForUser,
  cancelBooking,
  cancelBookingsForDeletedListing,
  acceptBookingRequest,
  declineBookingRequest,
  notifyHostOfBookingRequest,
  RESERVATION_TABS,
  IN_PROGRESS_STATUSES,
  _private: {
    buildReservationStatusFilter,
    buildGuestReservationStatusFilter,
    buildReservationDateFilter,
    readReservationCounts,
    startOfUtcWeek,
    rate,
    changePercentage,
  },
};
