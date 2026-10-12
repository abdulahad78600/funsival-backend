const ApiError = require('../utils/api-error');
const { validTimeZone } = require('../utils/booking-clock');

module.exports = function viewerTimeZone(req, res, next) {
  const zone = req.get('X-Time-Zone');
  if (zone !== undefined && !validTimeZone(zone)) {
    return next(new ApiError(400, 'X-Time-Zone must be a valid IANA timezone.'));
  }
  req.viewerTimeZone = zone || null;
  // Personalized schedules must not be served from another viewer's cache.
  res.vary('X-Time-Zone');
  next();
};
