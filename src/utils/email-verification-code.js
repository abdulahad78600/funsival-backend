const crypto = require('crypto');

function generateEmailVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashEmailVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

module.exports = {
  generateEmailVerificationCode,
  hashEmailVerificationCode,
};
