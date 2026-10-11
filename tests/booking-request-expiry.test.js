const test = require('node:test');
const assert = require('node:assert/strict');
const Booking = require('../src/models/booking.model');
const Listing = require('../src/models/listing.model');
const stripe = require('../src/services/stripe.client');
const notifications = require('../src/modules/notifications/notifications.service');
const notify = test.mock.method(notifications, 'sendNotification', async () => {});
const payments = require('../src/modules/payments/payments.service');
const { expirePendingAuthorizations } = require('../src/jobs/booking-auth-expiry');
const { hasBookingDatePassed } = require('../src/utils/booking-clock');

function booking(overrides = {}) {
  return {
    _id: 'booking-id', host: 'host-id', bookedBy: 'guest-id',
    listing: { timeZone: 'Asia/Karachi', toString: () => 'listing-id' },
    startDate: new Date('2026-10-09'), status: 'awaiting_host_approval',
    paymentStatus: 'authorized', authExpiresAt: new Date('2026-10-15'),
    stripePaymentIntentId: 'pi_test', stripeAccountId: 'acct_test',
    save: async () => {}, ...overrides,
  };
}

function candidates(t, items) {
  t.mock.method(Booking, 'find', (filter) => {
    assert.equal(filter.status, 'awaiting_host_approval');
    assert.equal(filter.paymentStatus, 'authorized');
    const query = { populate: () => query, sort: () => query, limit: async () => items };
    return query;
  });
}

test('October 9 request expires at local midnight, independently of server time', () => {
  const b = booking();
  assert.equal(hasBookingDatePassed(b, b.listing, new Date('2026-10-09T18:59:59Z')), false);
  assert.equal(hasBookingDatePassed(b, b.listing, new Date('2026-10-09T19:00:00Z')), true);
  assert.equal(hasBookingDatePassed(b, { timeZone: 'America/New_York' }, new Date('2026-10-09T19:00:00Z')), false);
});

test('past-date request releases its hold, persists rejection, and notifies both parties', async (t) => {
  const b = booking();
  candidates(t, [b]);
  t.mock.method(Booking, 'findById', async () => b);
  const cancel = t.mock.method(stripe.paymentIntents, 'cancel', async () => ({ status: 'canceled' }));
  const calls = notify.mock.callCount();
  await expirePendingAuthorizations(new Date('2026-10-09T19:00:00Z'));
  assert.equal(b.status, 'declined');
  assert.equal(b.paymentStatus, 'auth_released');
  assert.match(b.declineReason, /booking date passed/i);
  assert.equal(cancel.mock.callCount(), 1);
  assert.equal(notify.mock.callCount(), calls + 2);
  assert.deepEqual(notify.mock.calls.slice(calls).map(call => call.arguments[0]), ['guest-id', 'host-id']);
});

test('today and future requests remain pending when authorization is valid', async (t) => {
  candidates(t, [booking(), booking({ startDate: new Date('2026-10-10') })]);
  const cancel = t.mock.method(payments, 'cancelAuthorizationForBooking', async () => {});
  await expirePendingAuthorizations(new Date('2026-10-09T18:59:59Z'));
  assert.equal(cancel.mock.callCount(), 0);
});

test('authorization expiry still rejects a future booking request', async (t) => {
  candidates(t, [booking({ startDate: new Date('2026-10-20'), authExpiresAt: new Date('2026-10-10T01:00:00Z') })]);
  const cancel = t.mock.method(payments, 'cancelAuthorizationForBooking', async () => {});
  await expirePendingAuthorizations(new Date('2026-10-09T19:00:00Z'));
  assert.equal(cancel.mock.callCount(), 1);
});

test('already canceled Stripe authorization still persists rejection', async (t) => {
  const b = booking();
  t.mock.method(Booking, 'findById', async () => b);
  t.mock.method(stripe.paymentIntents, 'cancel', async () => { throw Error('Already canceled'); });
  t.mock.method(stripe.paymentIntents, 'retrieve', async () => ({ status: 'canceled' }));
  await payments.cancelAuthorizationForBooking(b._id, b.host, 'Date passed');
  assert.equal(b.status, 'declined');
  assert.equal(b.paymentStatus, 'auth_released');
});

test('failed release never marks captured funds as released', async (t) => {
  const b = booking();
  t.mock.method(Booking, 'findById', async () => b);
  t.mock.method(stripe.paymentIntents, 'cancel', async () => { throw Error('Cannot cancel'); });
  t.mock.method(stripe.paymentIntents, 'retrieve', async () => ({ status: 'succeeded' }));
  await assert.rejects(payments.cancelAuthorizationForBooking(b._id, b.host), /Cannot cancel/);
  assert.equal(b.paymentStatus, 'authorized');
  assert.equal(b.status, 'awaiting_host_approval');
});

test('provider cannot capture an unaccepted booking after its local date', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T19:00:00Z') });
  const b = booking();
  t.mock.method(Booking, 'findById', async () => b);
  t.mock.method(Listing, 'findById', async () => b.listing);
  const capture = t.mock.method(stripe.paymentIntents, 'capture', async () => {});
  await assert.rejects(payments.capturePaymentForBooking(b._id, b.host), /booking date has passed/);
  assert.equal(capture.mock.callCount(), 0);
});

test('completion uses 8 PM in the listing zone, not 8 PM UTC', async (t) => {
  const { getBookingCompletionAt, completeEndedBookings } = require('../src/jobs/booking-completion');
  const b = booking({ status: 'confirmed', startDate: new Date('2026-10-11'), endDate: new Date('2026-10-11'), startTime: '17:00', endTime: '20:00' });
  assert.equal(getBookingCompletionAt(b).toISOString(), '2026-10-11T15:00:00.000Z');
  const query = { populate: () => query, limit: async () => [b] };
  t.mock.method(Booking, 'find', () => query);
  const update = t.mock.method(Booking, 'updateOne', async () => ({ modifiedCount: 1 }));
  assert.equal(await completeEndedBookings(new Date('2026-10-11T14:59:59Z')), 0);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(await completeEndedBookings(new Date('2026-10-11T15:00:00Z')), 1);
});
