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

// Like `authenticate`, but a missing/invalid token just leaves req.user unset
// instead of failing — for public endpoints that personalise when signed in.
const authenticateOptional = asyncHandler(async (req, res, next) => {
  const authorizationHeader = req.headers.authorization || '';
  if (!authorizationHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authorizationHeader.slice(7).trim();
  if (!token) {
    next();
    return;
  }

  try {
    const decodedToken = verifyAuthToken(token);
    const user = await User.findById(decodedToken.sub);
    if (user) req.user = user;
  } catch (error) {
    // Invalid or expired token: treat as anonymous.
  }

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
  authenticateOptional,
  authorizeRoles,
};
