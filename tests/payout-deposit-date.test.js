const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/modules/payments/payments.service');

test('24-hour eligibility follows the last slot in the listing timezone', () => {
  const booking = { startDate: '2026-10-12', endDate: '2026-10-13', listingSnapshot: { timeZone: 'Asia/Karachi' },
    slots: [
      { sourceDate: '2026-10-12', startTime: '21:00', endTime: '22:00' },
      { sourceDate: '2026-10-13', startTime: '00:00', endTime: '01:00' },
    ],
  };
  const completedAt = service._private.calculateBookingCompletionAt(booking);
  assert.equal(completedAt.toISOString(), '2026-10-12T20:00:00.000Z');
  assert.equal(service._private.calculatePayoutEligibleAt(completedAt, 1).toISOString(), '2026-10-13T20:00:00.000Z');
});

test('balances expose Stripe bank arrival estimates and never invent a date for held funds', async t => {
  const User = require('../src/models/user.model');
  const Booking = require('../src/models/booking.model');
  const stripe = require('../src/services/stripe.client');
  t.mock.method(User, 'findById', () => ({ select: async () => ({ stripeConnect: { accountId: 'acct_test' } }) }));
  t.mock.method(stripe.accounts, 'retrieve', async () => ({ settings: { payouts: { schedule: { interval: 'manual' } } } }));
  t.mock.method(Booking, 'updateMany', async () => ({ modifiedCount: 0 }));
  t.mock.method(Booking, 'find', () => ({ sort() { return this; }, limit() { return this; }, select: async fields => fields === '_id' ? [] : [{ currency: 'USD', merchantAmount: 180 }] }));
  t.mock.method(stripe.balance, 'retrieve', async () => ({ available: [{ currency: 'usd', amount: 1000 }], pending: [] }));
  let payouts = [
    { id: 'po_later', status: 'pending', type: 'bank_account', currency: 'usd', amount: 2000, arrival_date: Date.parse('2026-10-16') / 1000, livemode: false },
    { id: 'po_earlier', status: 'in_transit', type: 'bank_account', currency: 'usd', amount: 1000, arrival_date: Date.parse('2026-10-15') / 1000, livemode: false },
    { id: 'po_failed', status: 'failed', type: 'bank_account', arrival_date: Date.parse('2026-10-14') / 1000 },
    { id: 'po_paid', status: 'paid', type: 'bank_account', arrival_date: Date.parse('2026-10-14') / 1000 },
    { id: 'po_card', status: 'pending', type: 'card', arrival_date: Date.parse('2026-10-14') / 1000 },
  ];
  let fail = false;
  t.mock.method(stripe.payouts, 'list', async (params, options) => {
    assert.equal(options.stripeAccount, 'acct_test');
    if (fail) throw new Error('Stripe unavailable');
    return { data: payouts };
  });
  const result = await service.getMerchantBalance('host');
  assert.deepEqual(result.expectedBankDeposits.map(payout => payout.expectedDate), ['2026-10-15', '2026-10-16']);
  assert.equal(result.expectedBankDeposits[0].amount, 10);
  assert.equal(result.expectedBankDeposits[0].testMode, true);
  assert.equal(result.balances[0].pending, 180);
  assert.equal(result.balances[0].breakdown.platformHold, 180);
  payouts = [];
  assert.deepEqual((await service.getMerchantBalance('host')).expectedBankDeposits, []);
  fail = true;
  const unavailable = await service.getMerchantBalance('host');
  assert.equal(unavailable.depositDateUnavailable, true);
  assert.equal(unavailable.balances[0].current, 10);
});
