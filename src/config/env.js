const dotenv = require('dotenv');

dotenv.config({ quiet: true });

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSecret(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

const requiredEnvironmentVariables = ['MONGODB_URI', 'JWT_SECRET', 'BREVO_API_KEY'];
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
  notificationLinkBaseUrl: normalizeString(process.env.NOTIFICATION_LINK_BASE_URL),
  passwordResetBaseUrl:
    normalizeString(process.env.PASSWORD_RESET_BASE_URL) || 'https://testing.funsival.com',
  googleClientId: normalizeString(process.env.GOOGLE_CLIENT_ID),
  emailVerificationCodeTtlMinutes: process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES
    ? Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES)
    : 10,
  passwordResetTokenTtlMinutes: process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES
    ? Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES)
    : 15,
  brevoApiKey: normalizeSecret(process.env.BREVO_API_KEY),
  mailFrom: normalizeString(process.env.MAIL_FROM) || 'no-reply@funsival.com',
  mailFromName: normalizeString(process.env.MAIL_FROM_NAME) || 'Funsival',
  firebase: {
    projectId: normalizeString(process.env.FIREBASE_PROJECT_ID),
    clientEmail: normalizeString(process.env.FIREBASE_CLIENT_EMAIL),
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim(),
  },
  stripe: {
    secretKey: normalizeSecret(process.env.STRIPE_SECRET_KEY),
    publishableKey: normalizeString(process.env.STRIPE_PUBLISHABLE_KEY),
    webhookSecret: normalizeSecret(process.env.STRIPE_WEBHOOK_SECRET),
    connectWebhookSecret: normalizeSecret(process.env.STRIPE_CONNECT_WEBHOOK_SECRET),
    applicationFeePercent: Number(process.env.STRIPE_APPLICATION_FEE_PERCENT) || 10,
    payoutDelayDays: Number(process.env.STRIPE_PAYOUT_DELAY_DAYS) || 7,
    connectCountry: normalizeString(process.env.STRIPE_CONNECT_COUNTRY) || 'US',
    checkoutSuccessUrl:
      normalizeString(process.env.STRIPE_CHECKOUT_SUCCESS_URL) ||
      'https://testing.funsival.com/bookings/{BOOKING_ID}?status=success',
    checkoutCancelUrl:
      normalizeString(process.env.STRIPE_CHECKOUT_CANCEL_URL) ||
      'https://testing.funsival.com/bookings/{BOOKING_ID}?status=cancelled',
    onboardingReturnUrl:
      normalizeString(process.env.STRIPE_ONBOARDING_RETURN_URL) ||
      'https://testing.funsival.com/payments/onboarding/complete',
    onboardingRefreshUrl:
      normalizeString(process.env.STRIPE_ONBOARDING_REFRESH_URL) ||
      'https://testing.funsival.com/payments/onboarding/refresh',
  },
};
