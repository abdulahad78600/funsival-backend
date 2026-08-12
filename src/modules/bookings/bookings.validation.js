const mongoose = require('mongoose');

const ApiError = require('../../utils/api-error');
const { AVAILABLE_BOOKING_TYPES } = require('../../constants/booking');

const HOST_RESERVATION_TABS = [
  'all',
  'active',
  'upcoming',
  'completed',
  'cancelled',
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

function isValidDate(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateListingId(listingId) {
  if (!isValidObjectId(listingId)) {
    throw new ApiError(400, 'Invalid listing ID.');
  }
  return listingId;
}

function validateBookingId(bookingId) {
  if (!isValidObjectId(bookingId)) {
    throw new ApiError(400, 'Invalid booking ID.');
  }
  return bookingId;
}

function parseCalendarDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  let year;
  let month;
  let day;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(normalized);
  if (isoMatch) {
    [, year, month, day] = isoMatch;
  } else if (displayMatch) {
    [, month, day, year] = displayMatch;
    if (year.length === 2) year = `20${year}`;
  } else {
    throw new ApiError(
      400,
      'Date must use YYYY-MM-DD, MM/DD/YY, or MM/DD/YYYY format.'
    );
  }

  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new ApiError(400, 'Date is invalid.');
  }

  return parsed;
}

function validateHostBookingsQuery(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const tab = normalizeString(query.tab).toLowerCase() || 'all';
  if (!HOST_RESERVATION_TABS.includes(tab)) {
    throw new ApiError(
      400,
      `Invalid tab. Allowed values: ${HOST_RESERVATION_TABS.join(', ')}.`
    );
  }

  const search = normalizeString(query.search);
  if (search.length > 100) {
    throw new ApiError(400, 'Search must be 100 characters or fewer.');
  }

  return {
    page,
    limit,
    tab,
    search,
    date: parseCalendarDate(query.date),
  };
}

const AVAILABLE_PRICING_MODES = ['hourly', 'daily'];

const MAX_SLOTS_PER_BOOKING = 48;

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function validateSlots(rawSlots, errors) {
  if (rawSlots === undefined || rawSlots === null) {
    return null;
  }

  if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
    errors.slots = 'Slots must be a non-empty array of { startTime, endTime }.';
    return null;
  }

  if (rawSlots.length > MAX_SLOTS_PER_BOOKING) {
    errors.slots = `A booking can include at most ${MAX_SLOTS_PER_BOOKING} slots.`;
    return null;
  }

  const parsed = [];
  for (let index = 0; index < rawSlots.length; index += 1) {
    const slot = rawSlots[index] || {};
    const startTime = normalizeString(slot.startTime);
    const endTime = normalizeString(slot.endTime);

    if (!isValidTime(startTime) || !isValidTime(endTime)) {
      errors.slots = `Slot ${index + 1} must have startTime and endTime in HH:mm format.`;
      return null;
    }
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      errors.slots = `Slot ${index + 1} must end after it starts.`;
      return null;
    }

    parsed.push({ startTime, endTime });
  }

  parsed.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  for (let index = 1; index < parsed.length; index += 1) {
    if (
      timeToMinutes(parsed[index].startTime) <
      timeToMinutes(parsed[index - 1].endTime)
    ) {
      errors.slots = 'Selected slots overlap each other.';
      return null;
    }
  }

  return parsed;
}

function validateCreateBookingPayload(payload = {}) {
  const errors = {};

  const listingId = normalizeString(payload.listingId);
  const listingType = normalizeString(payload.listingType).toLowerCase();
  const bookingType = normalizeString(payload.bookingType).toLowerCase();
  const pricingMode = normalizeString(payload.pricingMode).toLowerCase();
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const startTime = normalizeString(payload.startTime);
  const endTime = normalizeString(payload.endTime);
  const numberOfGuests = payload.numberOfGuests;
  const durationHours = payload.durationHours;
  const durationDays = payload.durationDays;
  const includeDelivery = Boolean(payload.includeDelivery);
  const paymentMethodId = normalizeString(payload.paymentMethodId);
  const slots = validateSlots(payload.slots, errors);

  if (!listingId) {
    errors.listingId = 'Listing ID is required.';
  } else if (!isValidObjectId(listingId)) {
    errors.listingId = 'Listing ID is invalid.';
  }

  if (bookingType && !AVAILABLE_BOOKING_TYPES.includes(bookingType)) {
    errors.bookingType = `Booking type must be one of: ${AVAILABLE_BOOKING_TYPES.join(', ')}.`;
  }

  if (pricingMode && !AVAILABLE_PRICING_MODES.includes(pricingMode)) {
    errors.pricingMode = `Pricing mode must be one of: ${AVAILABLE_PRICING_MODES.join(', ')}.`;
  }

  if (!startDate) {
    errors.startDate = 'Start date is required.';
  } else if (!isValidDate(startDate)) {
    errors.startDate = 'Start date is invalid.';
  }

  if (endDate && !isValidDate(endDate)) {
    errors.endDate = 'End date is invalid.';
  }

  if (startTime && !isValidTime(startTime)) {
    errors.startTime = 'Start time must be in HH:mm format.';
  }

  if (endTime && !isValidTime(endTime)) {
    errors.endTime = 'End time must be in HH:mm format.';
  }

  if (numberOfGuests !== undefined && numberOfGuests !== null) {
    if (!Number.isInteger(numberOfGuests) || numberOfGuests < 1) {
      errors.numberOfGuests = 'Number of guests must be a positive integer.';
    }
  }

  if (durationHours !== undefined && durationHours !== null) {
    if (typeof durationHours !== 'number' || !Number.isFinite(durationHours) || durationHours < 0.5) {
      errors.durationHours = 'Duration in hours must be a number at least 0.5.';
    }
  }

  if (durationDays !== undefined && durationDays !== null) {
    if (!Number.isInteger(durationDays) || durationDays < 1) {
      errors.durationDays = 'Duration in days must be a positive integer.';
    }
  }

  if (!paymentMethodId) {
    errors.paymentMethodId = 'Please select a saved card to pay with.';
  } else if (!paymentMethodId.startsWith('pm_')) {
    errors.paymentMethodId = 'Payment method ID is invalid.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (end && end < start) {
    throw new ApiError(400, 'End date cannot be before start date.');
  }

  return {
    listingId,
    listingType: listingType || null,
    bookingType: bookingType || null,
    pricingMode: pricingMode || null,
    startDate: start,
    endDate: end,
    startTime: startTime || null,
    endTime: endTime || null,
    numberOfGuests:
      numberOfGuests !== undefined && numberOfGuests !== null ? numberOfGuests : null,
    durationHours:
      durationHours !== undefined && durationHours !== null ? durationHours : null,
    durationDays:
      durationDays !== undefined && durationDays !== null ? durationDays : null,
    slots,
    includeDelivery,
    paymentMethodId,
  };
}

module.exports = {
  validateListingId,
  validateBookingId,
  validateCreateBookingPayload,
  validateHostBookingsQuery,
};
