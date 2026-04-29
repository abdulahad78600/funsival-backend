const mongoose = require('mongoose');

const ApiError = require('../../utils/api-error');
const {
  AVAILABLE_BOOKING_TYPES,
  BOOKING_TYPES,
} = require('../../constants/booking');

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

function validateCreateBookingPayload(payload = {}) {
  const errors = {};

  const listingId = normalizeString(payload.listingId);
  const bookingType = normalizeString(payload.bookingType).toLowerCase();
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const startTime = normalizeString(payload.startTime);
  const endTime = normalizeString(payload.endTime);
  const numberOfGuests = payload.numberOfGuests;

  if (!listingId) {
    errors.listingId = 'Listing ID is required.';
  } else if (!isValidObjectId(listingId)) {
    errors.listingId = 'Listing ID is invalid.';
  }

  if (!bookingType) {
    errors.bookingType = 'Booking type is required.';
  } else if (!AVAILABLE_BOOKING_TYPES.includes(bookingType)) {
    errors.bookingType = `Booking type must be one of: ${AVAILABLE_BOOKING_TYPES.join(', ')}.`;
  }

  if (!startDate) {
    errors.startDate = 'Start date is required.';
  } else if (!isValidDate(startDate)) {
    errors.startDate = 'Start date is invalid.';
  }

  if (!endDate) {
    errors.endDate = 'End date is required.';
  } else if (!isValidDate(endDate)) {
    errors.endDate = 'End date is invalid.';
  }

  if (
    bookingType === BOOKING_TYPES.PER_PERSON ||
    bookingType === BOOKING_TYPES.PER_HOUR ||
    bookingType === BOOKING_TYPES.HOURLY
  ) {
    if (!startTime) {
      errors.startTime = 'Start time is required.';
    } else if (!isValidTime(startTime)) {
      errors.startTime = 'Start time must be in HH:mm format.';
    }

    if (!endTime) {
      errors.endTime = 'End time is required.';
    } else if (!isValidTime(endTime)) {
      errors.endTime = 'End time must be in HH:mm format.';
    }
  }

  if (bookingType === BOOKING_TYPES.PER_PERSON) {
    if (numberOfGuests === undefined || numberOfGuests === null) {
      errors.numberOfGuests = 'Number of guests is required.';
    } else if (!Number.isInteger(numberOfGuests) || numberOfGuests < 1) {
      errors.numberOfGuests = 'Number of guests must be a positive integer.';
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end < start) {
    throw new ApiError(400, 'End date cannot be before start date.');
  }

  return {
    listingId,
    bookingType,
    startDate: start,
    endDate: end,
    startTime: startTime || null,
    endTime: endTime || null,
    numberOfGuests:
      bookingType === BOOKING_TYPES.PER_PERSON ? numberOfGuests : null,
  };
}

module.exports = {
  validateListingId,
  validateBookingId,
  validateCreateBookingPayload,
};
