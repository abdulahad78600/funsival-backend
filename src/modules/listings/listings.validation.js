const mongoose = require('mongoose');

const ApiError = require('../../utils/api-error');
const { normalizeListingPhotoReference } = require('./listing-images');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value, fieldName, normalizeItem = normalizeString) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} must be a non-empty array.`,
    });
  }

  const normalizedValues = value.map((item) => normalizeItem(item)).filter(Boolean);

  if (normalizedValues.length === 0) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} must contain valid text values.`,
    });
  }

  return normalizedValues;
}

function validateTime(value, fieldName) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} must be in HH:MM format.`,
    });
  }

  return value;
}

function validateDuration(duration = {}) {
  const errors = {};
  const value = Number(duration.value);
  const unit = normalizeString(duration.unit).toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    errors.durationValue = 'Duration value must be a number greater than 0.';
  }

  if (!['minutes', 'hours', 'days'].includes(unit)) {
    errors.durationUnit = 'Duration unit must be minutes, hours, or days.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    value,
    unit,
  };
}

function validateAvailability(availability = []) {
  if (!Array.isArray(availability) || availability.length === 0) {
    throw new ApiError(400, 'Validation failed.', {
      availability: 'Availability must be a non-empty array.',
    });
  }

  return availability.map((slot, index) => {
    const errors = {};

    const date = new Date(slot.date);
    if (!slot.date || isNaN(date.getTime())) {
      errors[`availability.${index}.date`] = 'Availability date must be a valid date (e.g. 2026-04-26).';
    }

    const startTime = normalizeString(slot.startTime);
    const endTime = normalizeString(slot.endTime);

    if (!startTime) {
      errors[`availability.${index}.startTime`] = 'Start time is required.';
    }

    if (!endTime) {
      errors[`availability.${index}.endTime`] = 'End time is required.';
    }

    if (Object.keys(errors).length > 0) {
      throw new ApiError(400, 'Validation failed.', errors);
    }

    return {
      date,
      startTime: validateTime(startTime, `availability.${index}.startTime`),
      endTime: validateTime(endTime, `availability.${index}.endTime`),
      isAvailable: typeof slot.isAvailable === 'boolean' ? slot.isAvailable : true,
    };
  });
}

function validateListingPayload(payload = {}) {
  const category = normalizeString(payload.category);
  const type = normalizeString(payload.type);
  const basicInformation = payload.basicInformation || {};
  const serviceDetails = payload.serviceDetails || {};
  const placeLocation = payload.placeLocation || {};
  const price = payload.price || {};
  const errors = {};

  if (!category) {
    errors.category = 'Category is required.';
  }

  if (!type) {
    errors.type = 'Type is required.';
  }

  const activityTitle = normalizeString(basicInformation.activityTitle);
  const location = normalizeString(basicInformation.location);
  const description = normalizeString(basicInformation.description);

  if (!activityTitle) {
    errors.activityTitle = 'Activity title is required.';
  }

  if (!location) {
    errors.location = 'Location is required.';
  }

  if (!description) {
    errors.description = 'Description is required.';
  }

  const difficultyLevel = normalizeString(serviceDetails.difficultyLevel).toLowerCase();
  const maxParticipants = Number(serviceDetails.maxParticipants);
  const instructorName = normalizeString(serviceDetails.instructorName);
  const cancellationPolicy = normalizeString(serviceDetails.cancellationPolicy);

  if (!['beginner', 'intermediate', 'advanced', 'all_levels'].includes(difficultyLevel)) {
    errors.difficultyLevel =
      'Difficulty level must be beginner, intermediate, advanced, or all_levels.';
  }

  if (!Number.isFinite(maxParticipants) || maxParticipants <= 0) {
    errors.maxParticipants = 'Max participants must be a number greater than 0.';
  }

  if (!instructorName) {
    errors.instructorName = 'Instructor name is required.';
  }

  if (!cancellationPolicy) {
    errors.cancellationPolicy = 'Cancellation policy is required.';
  }

  const addressLine1 = normalizeString(placeLocation.addressLine1);
  const placeCity = normalizeString(placeLocation.city);
  const country = normalizeString(placeLocation.country);
  const latitude =
    placeLocation.latitude === undefined || placeLocation.latitude === null
      ? undefined
      : Number(placeLocation.latitude);
  const longitude =
    placeLocation.longitude === undefined || placeLocation.longitude === null
      ? undefined
      : Number(placeLocation.longitude);
  const amount = Number(price.amount);
  const currency = normalizeString(price.currency).toUpperCase();

  if (!addressLine1) {
    errors.addressLine1 = 'Address line 1 is required.';
  }

  if (!placeCity) {
    errors.placeCity = 'Place city is required.';
  }

  if (!country) {
    errors.country = 'Country is required.';
  }

  if (latitude !== undefined && !Number.isFinite(latitude)) {
    errors.latitude = 'Latitude must be a valid number.';
  }

  if (longitude !== undefined && !Number.isFinite(longitude)) {
    errors.longitude = 'Longitude must be a valid number.';
  }

  if (!Number.isFinite(amount) || amount < 0) {
    errors.amount = 'Price amount must be a number greater than or equal to 0.';
  }

  if (!currency) {
    errors.currency = 'Currency is required.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    category,
    type,
    basicInformation: {
      activityTitle,
      location,
      description,
    },
    serviceDetails: {
      difficultyLevel,
      duration: validateDuration(serviceDetails.duration),
      maxParticipants,
      instructorName,
      cancellationPolicy,
      whatsIncluded: normalizeStringArray(serviceDetails.whatsIncluded, 'whatsIncluded'),
      requirements: normalizeStringArray(serviceDetails.requirements, 'requirements'),
    },
    placeLocation: {
      addressLine1,
      addressLine2: normalizeString(placeLocation.addressLine2),
      city: placeCity,
      state: normalizeString(placeLocation.state),
      country,
      postalCode: normalizeString(placeLocation.postalCode),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      googleMapsUrl: normalizeString(placeLocation.googleMapsUrl),
    },
    photos: normalizeStringArray(payload.photos, 'photos', normalizeListingPhotoReference),
    availability: validateAvailability(payload.availability),
    price: {
      amount,
      currency,
    },
  };
}

function validateListingId(listingId) {
  const normalizedListingId = normalizeString(listingId);

  if (!normalizedListingId) {
    throw new ApiError(400, 'Listing ID is required.');
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedListingId)) {
    throw new ApiError(400, 'Invalid listing ID.');
  }

  return normalizedListingId;
}

module.exports = {
  validateListingPayload,
  validateListingId,
};
