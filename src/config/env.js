const dotenv = require('dotenv');

dotenv.config({ quiet: true });

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSecret(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

const requiredEnvironmentVariables = ['MONGODB_URI', 'JWT_SECRET', 'RESEND_API_KEY'];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (variableName) => !process.env[variableName]
);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvironmentVariables.join(', ')}`
  );
}

const port = Number(process.env.PORT) || 3000;

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${port}`,
  frontendUrl: normalizeString(process.env.FRONTEND_URL) || 'http://localhost:3000',
  googleClientId: normalizeString(process.env.GOOGLE_CLIENT_ID),
  emailVerificationCodeTtlMinutes: process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES
    ? Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES)
    : 10,
  passwordResetTokenTtlMinutes: process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES
    ? Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES)
    : 15,
  resendApiKey: normalizeSecret(process.env.RESEND_API_KEY),
  mailFrom: normalizeString(process.env.MAIL_FROM),
};
