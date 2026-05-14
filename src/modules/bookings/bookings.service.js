const Booking = require('../../models/booking.model');
const Listing = require('../../models/listing.model');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const { sendMail } = require('../../services/mail.service');
const {
  BOOKING_TYPES,
  BOOKING_STATUS,
  SERVICE_FEE_AMOUNT,
} = require('../../constants/booking');
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

function calculateBookingPricing(payload, listing) {
  let pricePerUnit;
  let unitsBooked;

  switch (payload.bookingType) {
    case BOOKING_TYPES.PER_PERSON:
      pricePerUnit = listing.price.perPerson;
      unitsBooked = payload.numberOfGuests;
      break;
    case BOOKING_TYPES.PER_HOUR:
    case BOOKING_TYPES.HOURLY:
      pricePerUnit = listing.price.hourly;
      unitsBooked = calculateHoursBetween(payload.startTime, payload.endTime);
      break;
    case BOOKING_TYPES.DAILY:
      pricePerUnit = listing.price.daily;
      unitsBooked = calculateDaysBetween(payload.startDate, payload.endDate);
      break;
    default:
      throw new ApiError(400, 'Unsupported booking type.');
  }

  if (pricePerUnit === undefined || pricePerUnit === null) {
    throw new ApiError(400, `This listing does not offer ${payload.bookingType} pricing.`);
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

async function ensureSlotIsAvailable(payload) {
  const conflictingBooking = await Booking.findOne({
    listing: payload.listingId,
    status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
    startDate: { $lte: payload.endDate },
    endDate: { $gte: payload.startDate },
  });

  if (!conflictingBooking) {
    return;
  }

  if (
    payload.bookingType === BOOKING_TYPES.PER_HOUR ||
    payload.bookingType === BOOKING_TYPES.HOURLY ||
    payload.bookingType === BOOKING_TYPES.PER_PERSON
  ) {
    const requestedStart = timeStringToMinutes(payload.startTime);
    const requestedEnd = timeStringToMinutes(payload.endTime);
    const existingStart = conflictingBooking.startTime
      ? timeStringToMinutes(conflictingBooking.startTime)
      : 0;
    const existingEnd = conflictingBooking.endTime
      ? timeStringToMinutes(conflictingBooking.endTime)
      : 24 * 60;

    const overlaps = requestedStart < existingEnd && requestedEnd > existingStart;
    if (!overlaps) {
      return;
    }
  }

  throw new ApiError(409, 'This listing is already booked for the selected period.');
}

function describeGuest(guest) {
  if (!guest) return 'A guest';
  const profile = guest.providerProfile || {};
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  return fullName || guest.agencyName || guest.email || 'A guest';
}

async function notifyHostOfNewBooking(booking, listing, host, guest) {
  if (!host) {
    return;
  }

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
    type: NOTIFICATION_TYPES.BOOKING_NEW,
    title: 'New booking received',
    body: `${guestName} booked ${listingTitle}.`,
    data: {
      bookingId: booking._id ? booking._id.toString() : '',
      listingId: listing && listing._id ? listing._id.toString() : '',
      guestId: guest && guest._id ? guest._id.toString() : '',
    },
  }).catch((error) => console.error('Failed to send booking push notification.', error));
}

async function createBooking(payload, userId) {
  const listing = await Listing.findById(payload.listingId);

  if (!listing) {
    throw new ApiError(404, 'Listing not found.');
  }

  if (listing.createdBy.toString() === userId.toString()) {
    throw new ApiError(400, 'You cannot book your own listing.');
  }

  await ensureSlotIsAvailable(payload);

  const pricing = calculateBookingPricing(payload, listing);

  const booking = await Booking.create({
    listing: listing._id,
    bookedBy: userId,
    host: listing.createdBy,
    bookingType: payload.bookingType,
    startDate: payload.startDate,
    endDate: payload.endDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    numberOfGuests: payload.numberOfGuests,
    pricePerUnit: pricing.pricePerUnit,
    unitsBooked: pricing.unitsBooked,
    subtotal: pricing.subtotal,
    serviceFee: pricing.serviceFee,
    totalAmount: pricing.totalAmount,
    currency: pricing.currency,
    status: BOOKING_STATUS.CONFIRMED,
  });

  const [host, guest] = await Promise.all([
    User.findById(listing.createdBy),
    User.findById(userId),
  ]);

  await notifyHostOfNewBooking(booking, listing, host, guest);

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

  return {
    bookings: bookings.map((booking) => booking.toJSON()),
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

  return booking.toJSON();
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
  getBookingsForGuest,
  getBookingsForHost,
  getBookingByIdForUser,
  cancelBooking,
};
