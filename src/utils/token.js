const jwt = require('jsonwebtoken');

const config = require('../config/env');

function generateAuthToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
    }
  );
}

function verifyAuthToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  generateAuthToken,
  verifyAuthToken,
};
