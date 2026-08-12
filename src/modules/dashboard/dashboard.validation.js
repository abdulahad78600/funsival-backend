const ApiError = require('../../utils/api-error');

function validateDashboardQuery(query = {}) {
  const recentLimit = Math.min(
    20,
    Math.max(1, parseInt(query.recentLimit, 10) || 5)
  );
  if (query.currency === undefined || query.currency === null || query.currency === '') {
    return { recentLimit, currency: null };
  }

  const currency =
    typeof query.currency === 'string' ? query.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError(400, 'Currency must be a three-letter ISO currency code.');
  }

  return { recentLimit, currency };
}

module.exports = { validateDashboardQuery };
