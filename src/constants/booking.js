const BOOKING_TYPES = {
  PER_PERSON: 'per_person',
  PER_HOUR: 'per_hour',
  HOURLY: 'hourly',
  DAILY: 'daily',
};

const BOOKING_STATUS = {
  PENDING: 'pending',
  AWAITING_HOST_APPROVAL: 'awaiting_host_approval',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

const PAYMENT_STATUS = {
  REQUIRES_PAYMENT: 'requires_payment',
  PROCESSING: 'processing',
  AUTHORIZED: 'authorized',
  AUTH_RELEASED: 'auth_released',
  HELD: 'held',
  RELEASED: 'released',
  REFUNDED: 'refunded',
  FAILED: 'failed',
  DISPUTED: 'disputed',
};

const SERVICE_FEE_AMOUNT = 8;

const HOST_APPROVAL_WINDOW_DAYS = 6;

const REFUND_REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  WITHDRAWN: 'withdrawn',
};

module.exports = {
  BOOKING_TYPES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  AVAILABLE_BOOKING_TYPES: Object.values(BOOKING_TYPES),
  AVAILABLE_BOOKING_STATUSES: Object.values(BOOKING_STATUS),
  AVAILABLE_PAYMENT_STATUSES: Object.values(PAYMENT_STATUS),
  REFUND_REQUEST_STATUS,
  AVAILABLE_REFUND_REQUEST_STATUSES: Object.values(REFUND_REQUEST_STATUS),
  SERVICE_FEE_AMOUNT,
  HOST_APPROVAL_WINDOW_DAYS,
};
