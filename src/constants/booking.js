const BOOKING_TYPES = {
  PER_PERSON: 'per_person',
  PER_HOUR: 'per_hour',
  HOURLY: 'hourly',
  DAILY: 'daily',
};

const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  REFUNDED: 'refunded',
};

const SERVICE_FEE_AMOUNT = 8;

module.exports = {
  BOOKING_TYPES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  AVAILABLE_BOOKING_TYPES: Object.values(BOOKING_TYPES),
  AVAILABLE_BOOKING_STATUSES: Object.values(BOOKING_STATUS),
  AVAILABLE_PAYMENT_STATUSES: Object.values(PAYMENT_STATUS),
  SERVICE_FEE_AMOUNT,
};
