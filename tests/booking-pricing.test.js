const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/funsival-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.BREVO_API_KEY = process.env.BREVO_API_KEY || 'test-brevo-key';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

const { calculateBookingPricing } = require('../src/modules/bookings/bookings.service')._private;
const { toStripeAmount } = require('../src/modules/payments/payments.service')._private;

for (const category of ['place', 'equipment', 'activity']) {
  test(`${category}: $76 booking has a $7.60 fee and $76 provider share`, () => {
    const quote = calculateBookingPricing(
      { startTime: '09:00', endTime: '10:00' },
      { category, price: { hourly: 76, currency: 'USD' } },
      'hourly'
    );
    assert.equal(quote.subtotal, 76);
    assert.equal(quote.serviceFee, 7.6);
    assert.equal(quote.totalAmount, 83.6);
    assert.equal(toStripeAmount(quote.totalAmount, 'USD') - toStripeAmount(quote.serviceFee, 'USD'), 7600);
  });
}

test('fee uses the full subtotal for per-person, daily, and multiple-slot bookings', () => {
  const listing = { price: { perPerson: 76, daily: 76, hourly: 76, currency: 'USD' } };
  for (const [type, payload] of [
    ['per_person', { numberOfGuests: 3 }],
    ['daily', { durationDays: 3 }],
    ['hourly', { slots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '12:00', endTime: '14:00' }] }],
  ]) {
    const quote = calculateBookingPricing(payload, listing, type);
    assert.equal(quote.subtotal, 228);
    assert.equal(quote.serviceFee, 22.8);
    assert.equal(quote.totalAmount, 250.8);
  }
});

test('fee rounds to cents and excludes delivery charges from its base', () => {
  const quote = calculateBookingPricing(
    { startTime: '09:00', endTime: '09:30', includeDelivery: true },
    { price: { hourly: 25.5, currency: 'USD', delivery: { enabled: true, fee: 20 } } },
    'hourly'
  );
  assert.equal(quote.subtotal, 12.75);
  assert.equal(quote.serviceFee, 1.28);
  assert.equal(quote.deliveryFee, 20);
  assert.equal(quote.totalAmount, 34.03);
});
