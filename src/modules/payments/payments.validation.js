const ApiError = require('../../utils/api-error');

function validateWithdrawalPayload(payload = {}, idempotencyKeyHeader) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Withdrawal amount must be a positive number.');
  }

  const currency =
    typeof payload.currency === 'string' ? payload.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError(400, 'Currency must be a three-letter ISO currency code.');
  }

  const idempotencyKey =
    typeof idempotencyKeyHeader === 'string' ? idempotencyKeyHeader.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw new ApiError(
      400,
      'A unique Idempotency-Key header (maximum 255 characters) is required.'
    );
  }

  return { amount, currency, idempotencyKey };
}

function validatePaginationQuery(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit };
}

module.exports = {
  validateWithdrawalPayload,
  validatePaginationQuery,
};
