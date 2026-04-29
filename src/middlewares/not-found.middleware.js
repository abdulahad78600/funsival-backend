const ApiError = require('../utils/api-error');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route ${req.method} ${req.originalUrl} not found.`));
}

module.exports = notFoundHandler;
