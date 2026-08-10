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
  REFUNDING: 'refunding',
  RELEASING: 'releasing',
  RELEASED: 'released',
  REFUNDED: 'refunded',
  FAILED: 'failed',
  DISPUTED: 'disputed',
};

// Legacy bookings used destination charges, which moved funds to the connected
// account at capture time. New bookings use separate charges and transfers so
// the platform can hold the merchant amount until the refund window closes.
const PAYMENT_FLOW = {
  DESTINATION_CHARGE: 'destination_charge',
  PLATFORM_HOLD: 'platform_hold',
};

const SERVICE_FEE_AMOUNT = 8;

const HOST_APPROVAL_WINDOW_DAYS = 6;

const WITHDRAWAL_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

const REFUND_REQUEST_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
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
  PAYMENT_FLOW,
  AVAILABLE_PAYMENT_FLOWS: Object.values(PAYMENT_FLOW),
  REFUND_REQUEST_STATUS,
  AVAILABLE_REFUND_REQUEST_STATUSES: Object.values(REFUND_REQUEST_STATUS),
  WITHDRAWAL_STATUS,
  AVAILABLE_WITHDRAWAL_STATUSES: Object.values(WITHDRAWAL_STATUS),
  SERVICE_FEE_AMOUNT,
  HOST_APPROVAL_WINDOW_DAYS,
};
