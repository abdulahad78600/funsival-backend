const ApiError = require('../../utils/api-error');

const EARNINGS_RANGES = ['24h', '7d', '30d', '12m'];
const TRANSACTION_TYPES = ['all', 'earning', 'withdrawal'];

function normalizeCurrency(value) {
  if (value === undefined || value === null || value === '') return null;

  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError(400, 'Currency must be a three-letter ISO currency code.');
  }

  return currency;
}

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

function validateEarningsQuery(query = {}) {
  const range =
    typeof query.range === 'string' ? query.range.trim().toLowerCase() : '7d';
  if (!EARNINGS_RANGES.includes(range)) {
    throw new ApiError(
      400,
      `Invalid earnings range. Allowed values: ${EARNINGS_RANGES.join(', ')}.`
    );
  }

  return {
    range,
    currency: normalizeCurrency(query.currency),
  };
}

function validateTransactionsQuery(query = {}) {
  const pagination = validatePaginationQuery(query);
  const requestedType =
    typeof query.type === 'string' ? query.type.trim().toLowerCase() : 'all';
  const aliases = {
    earnings: 'earning',
    withdrawals: 'withdrawal',
  };
  const type = aliases[requestedType] || requestedType;

  if (!TRANSACTION_TYPES.includes(type)) {
    throw new ApiError(
      400,
      `Invalid transaction type. Allowed values: ${TRANSACTION_TYPES.join(', ')}.`
    );
  }

  return {
    ...pagination,
    type,
    currency: normalizeCurrency(query.currency),
  };
}

module.exports = {
  validateWithdrawalPayload,
  validatePaginationQuery,
  validateEarningsQuery,
  validateTransactionsQuery,
};
