const mongoose = require('mongoose');
const ApiError = require('../../utils/api-error');
const {
  AVAILABLE_REFUND_REQUEST_STATUSES,
} = require('../../constants/booking');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateObjectId(id, label) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return id;
}

function validateCreateRefundRequestPayload(payload = {}) {
  const reason = normalizeString(payload.reason);
  if (!reason) {
    throw new ApiError(400, 'A reason is required to submit a refund request.');
  }
  if (reason.length > 2000) {
    throw new ApiError(400, 'Reason must be 2000 characters or fewer.');
  }
  return { reason };
}

function validateDecisionPayload(payload = {}, { requireNote = false } = {}) {
  const note = normalizeString(payload.note);
  if (requireNote && !note) {
    throw new ApiError(400, 'A note is required when rejecting a refund request.');
  }
  if (note && note.length > 2000) {
    throw new ApiError(400, 'Note must be 2000 characters or fewer.');
  }
  return { note: note || null };
}

function validateListQuery(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const status = normalizeString(query.status).toLowerCase();
  if (status && !AVAILABLE_REFUND_REQUEST_STATUSES.includes(status)) {
    throw new ApiError(
      400,
      `Status must be one of: ${AVAILABLE_REFUND_REQUEST_STATUSES.join(', ')}.`
    );
  }
  return { page, limit, status: status || null };
}

module.exports = {
  validateObjectId,
  validateCreateRefundRequestPayload,
  validateDecisionPayload,
  validateListQuery,
};
