const User = require('../models/user.model');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');
const { verifyAuthToken } = require('../utils/token');

const authenticate = asyncHandler(async (req, res, next) => {
  const authorizationHeader = req.headers.authorization || '';

  if (!authorizationHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Authorization token is required.');
  }

  const token = authorizationHeader.slice(7).trim();

  if (!token) {
    throw new ApiError(401, 'Authorization token is required.');
  }

  let decodedToken;

  try {
    decodedToken = verifyAuthToken(token);
  } catch (error) {
    throw new ApiError(401, 'Invalid or expired token.');
  }

  const user = await User.findById(decodedToken.sub);

  if (!user) {
    throw new ApiError(401, 'User for this token was not found.');
  }

  req.user = user;
  next();
});

function authorizeRoles(...allowedRoles) {
  return function authorizeRoleAccess(req, res, next) {
    if (!req.user) {
      next(new ApiError(401, 'Authentication is required.'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ApiError(403, 'You are not allowed to perform this action.'));
      return;
    }

    next();
  };
}

module.exports = {
  authenticate,
  authorizeRoles,
};
