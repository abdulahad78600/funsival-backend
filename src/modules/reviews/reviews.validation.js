const mongoose = require('mongoose');

const ApiError = require('../../utils/api-error');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateObjectId(value, label) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue || !mongoose.Types.ObjectId.isValid(normalizedValue)) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return normalizedValue;
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function parseRating(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
}

function validateRatingField(value, field, label, errors) {
  const parsed = parseRating(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    errors[field] = `${label} must be an integer between 1 and 5.`;
    return null;
  }
  return parsed;
}

function validateSubmitReviewPayload(payload = {}) {
  const errors = {};

  const overallRating = validateRatingField(
    pickFirstDefined(payload.overallRating, payload.rating, payload.overall),
    'overallRating',
    'Overall rating',
    errors
  );
  const accuracy = validateRatingField(
    pickFirstDefined(payload.accuracy, payload.accuracyRating),
    'accuracy',
    'Accuracy rating',
    errors
  );
  const quality = validateRatingField(
    pickFirstDefined(payload.quality, payload.qualityRating),
    'quality',
    'Quality rating',
    errors
  );
  const communication = validateRatingField(
    pickFirstDefined(payload.communication, payload.communicationRating),
    'communication',
    'Communication rating',
    errors
  );
  const value = validateRatingField(
    pickFirstDefined(payload.value, payload.valueRating),
    'value',
    'Value rating',
    errors
  );

  const comment = normalizeString(
    pickFirstDefined(payload.comment, payload.comments, payload.additionalComments)
  );

  if (comment.length > 2000) {
    errors.comment = 'Comment must be 2000 characters or fewer.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    overallRating,
    accuracy,
    quality,
    communication,
    value,
    comment,
  };
}

function validatePaginationQuery(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit };
}

module.exports = {
  validateObjectId,
  validateSubmitReviewPayload,
  validatePaginationQuery,
};
