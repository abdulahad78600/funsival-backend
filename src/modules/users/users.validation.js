const ApiError = require('../../utils/api-error');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateOptionalString(value, fieldName, { maxLength = 255, allowEmpty = false } = {}) {
  if (value === undefined) return undefined;

  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    if (allowEmpty) return '';

    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} cannot be empty.`,
    });
  }

  if (normalizedValue.length > maxLength) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} must be ${maxLength} characters or fewer.`,
    });
  }

  return normalizedValue;
}

function validateOptionalEmail(value, fieldName) {
  if (value === undefined) return undefined;

  const normalizedValue = normalizeString(value).toLowerCase();

  if (!normalizedValue) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} cannot be empty.`,
    });
  }

  if (!isValidEmail(normalizedValue)) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} must be a valid email address.`,
    });
  }

  return normalizedValue;
}

function validateOptionalDate(value, fieldName) {
  if (value === undefined) return undefined;

  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} cannot be empty.`,
    });
  }

  const dateValue = new Date(normalizedValue);

  if (Number.isNaN(dateValue.getTime())) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} must be a valid date.`,
    });
  }

  if (dateValue > new Date()) {
    throw new ApiError(400, 'Validation failed.', {
      [fieldName]: `${fieldName} cannot be in the future.`,
    });
  }

  return dateValue;
}

function validateProviderProfilePayload(payload = {}) {
  const validatedPayload = {};

  const email = validateOptionalEmail(payload.email, 'email');
  const firstName = validateOptionalString(payload.firstName, 'firstName', { maxLength: 100 });
  const lastName = validateOptionalString(payload.lastName, 'lastName', { maxLength: 100 });
  const phoneNumber = validateOptionalString(payload.phoneNumber, 'phoneNumber', { maxLength: 30 });
  const bio = validateOptionalString(payload.bio, 'bio', { maxLength: 1000 });
  const profileImage = validateOptionalString(payload.profileImage, 'profileImage', {
    maxLength: 1000,
  });
  const addressLine1 = validateOptionalString(payload.addressLine1, 'addressLine1', {
    maxLength: 255,
  });
  const addressLine2 = validateOptionalString(payload.addressLine2, 'addressLine2', {
    maxLength: 255,
    allowEmpty: true,
  });
  const city = validateOptionalString(payload.city, 'city', { maxLength: 100 });
  const state = validateOptionalString(payload.state, 'state', { maxLength: 100 });
  const postalCode = validateOptionalString(payload.postalCode, 'postalCode', { maxLength: 30 });
  const country = validateOptionalString(payload.country, 'country', { maxLength: 100 });
  const businessName = validateOptionalString(payload.businessName, 'businessName', {
    maxLength: 150,
  });
  const businessType = validateOptionalString(payload.businessType, 'businessType', {
    maxLength: 150,
  });
  const dateOfBirth = validateOptionalDate(payload.dateOfBirth, 'dateOfBirth');

  if (email !== undefined) validatedPayload.email = email;
  if (firstName !== undefined) validatedPayload.firstName = firstName;
  if (lastName !== undefined) validatedPayload.lastName = lastName;
  if (phoneNumber !== undefined) validatedPayload.phoneNumber = phoneNumber;
  if (dateOfBirth !== undefined) validatedPayload.dateOfBirth = dateOfBirth;
  if (bio !== undefined) validatedPayload.bio = bio;
  if (profileImage !== undefined) validatedPayload.profileImage = profileImage;
  if (addressLine1 !== undefined) validatedPayload.addressLine1 = addressLine1;
  if (addressLine2 !== undefined) validatedPayload.addressLine2 = addressLine2;
  if (city !== undefined) validatedPayload.city = city;
  if (state !== undefined) validatedPayload.state = state;
  if (postalCode !== undefined) validatedPayload.postalCode = postalCode;
  if (country !== undefined) validatedPayload.country = country;
  if (businessName !== undefined) validatedPayload.businessName = businessName;
  if (businessType !== undefined) validatedPayload.businessType = businessType;

  return validatedPayload;
}

function validateUserProfilePayload(payload = {}) {
  const validatedPayload = {};

  const email = validateOptionalEmail(payload.email, 'email');
  const firstName = validateOptionalString(payload.firstName, 'firstName', { maxLength: 100 });
  const lastName = validateOptionalString(payload.lastName, 'lastName', { maxLength: 100 });
  const phoneNumber = validateOptionalString(payload.phoneNumber, 'phoneNumber', { maxLength: 30 });
  const bio = validateOptionalString(payload.bio, 'bio', { maxLength: 1000 });
  const profileImage = validateOptionalString(payload.profileImage, 'profileImage', {
    maxLength: 1000,
  });
  const addressLine1 = validateOptionalString(payload.addressLine1, 'addressLine1', {
    maxLength: 255,
  });
  const addressLine2 = validateOptionalString(payload.addressLine2, 'addressLine2', {
    maxLength: 255,
    allowEmpty: true,
  });
  const city = validateOptionalString(payload.city, 'city', { maxLength: 100 });
  const state = validateOptionalString(payload.state, 'state', { maxLength: 100 });
  const postalCode = validateOptionalString(payload.postalCode, 'postalCode', { maxLength: 30 });
  const country = validateOptionalString(payload.country, 'country', { maxLength: 100 });
  const dateOfBirth = validateOptionalDate(payload.dateOfBirth, 'dateOfBirth');

  if (email !== undefined) validatedPayload.email = email;
  if (firstName !== undefined) validatedPayload.firstName = firstName;
  if (lastName !== undefined) validatedPayload.lastName = lastName;
  if (phoneNumber !== undefined) validatedPayload.phoneNumber = phoneNumber;
  if (dateOfBirth !== undefined) validatedPayload.dateOfBirth = dateOfBirth;
  if (bio !== undefined) validatedPayload.bio = bio;
  if (profileImage !== undefined) validatedPayload.profileImage = profileImage;
  if (addressLine1 !== undefined) validatedPayload.addressLine1 = addressLine1;
  if (addressLine2 !== undefined) validatedPayload.addressLine2 = addressLine2;
  if (city !== undefined) validatedPayload.city = city;
  if (state !== undefined) validatedPayload.state = state;
  if (postalCode !== undefined) validatedPayload.postalCode = postalCode;
  if (country !== undefined) validatedPayload.country = country;

  return validatedPayload;
}

module.exports = {
  validateProviderProfilePayload,
  validateUserProfilePayload,
};
