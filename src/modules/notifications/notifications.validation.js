const ApiError = require('../../utils/api-error');

const NOTIFICATION_TYPES = Object.freeze({
  CHAT_MESSAGE: 'chat_message',
  BOOKING_NEW: 'booking_new',
  BOOKING_REQUEST: 'booking_request',
  BOOKING_REQUEST_SENT: 'booking_request_sent',
  BOOKING_REQUEST_REMINDER: 'booking_request_reminder',
  BOOKING_ACCEPTED: 'booking_accepted',
  BOOKING_DECLINED: 'booking_declined',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_PAYOUT_RELEASED: 'booking_payout_released',
  BOOKING_STATUS_CHANGED: 'booking_status_changed',
  REFUND_REQUESTED: 'refund_requested',
  REFUND_APPROVED: 'refund_approved',
  REFUND_REJECTED: 'refund_rejected',
});

const AVAILABLE_NOTIFICATION_TYPES = Object.values(NOTIFICATION_TYPES);
const AVAILABLE_PLATFORMS = ['ios', 'android', 'web'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateRegisterDeviceTokenPayload(payload = {}) {
  const errors = {};

  const token = normalizeString(payload.token);
  const platform = normalizeString(payload.platform).toLowerCase() || 'web';

  if (!token) {
    errors.token = 'Device token is required.';
  } else if (token.length > 4096) {
    errors.token = 'Device token is too long.';
  }

  if (!AVAILABLE_PLATFORMS.includes(platform)) {
    errors.platform = `Platform must be one of: ${AVAILABLE_PLATFORMS.join(', ')}.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return { token, platform };
}

function validateDeviceToken(token) {
  const value = normalizeString(token);
  if (!value) {
    throw new ApiError(400, 'Device token is required.');
  }
  return value;
}

function validateNotificationId(notificationId) {
  const value = normalizeString(notificationId);
  if (!value) {
    throw new ApiError(400, 'Notification ID is required.');
  }
  return value;
}

module.exports = {
  NOTIFICATION_TYPES,
  AVAILABLE_NOTIFICATION_TYPES,
  AVAILABLE_PLATFORMS,
  validateRegisterDeviceTokenPayload,
  validateDeviceToken,
  validateNotificationId,
};
