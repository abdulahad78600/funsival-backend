const mongoose = require('mongoose');

const ApiError = require('../../utils/api-error');
const { AVAILABLE_BOOKING_TYPES } = require('../../constants/booking');

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

const AVAILABLE_PRICING_MODES = ['hourly', 'daily'];

function validateCreateBookingPayload(payload = {}) {
  const errors = {};

  const listingId = normalizeString(payload.listingId);
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
    includeDelivery,
    paymentMethodId,
  };
}

module.exports = {
  validateListingId,
  validateBookingId,
  validateCreateBookingPayload,
};
