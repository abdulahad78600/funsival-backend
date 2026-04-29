const crypto = require('crypto');

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generatePasswordResetToken,
  hashPasswordResetToken,
};
