const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../src/models/user.model');
const Booking = require('../src/models/booking.model');
const Withdrawal = require('../src/models/withdrawal.model');
const stripe = require('../src/services/stripe.client');
const payments = require('../src/modules/payments/payments.service');

test('withdrawals persist booking allocations before Stripe and reuse them on retry', async (t) => {
  const host = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const session = {};
  let saved;
  let locked = false;
  let payoutCalls = 0;
  t.mock.method(User, 'findById', () => ({ select: async () => ({
    stripeConnect: { accountId: 'acct_host', payoutsEnabled: true },
  }) }));
  t.mock.method(stripe.accounts, 'retrieve', async () => ({ settings: { payouts: { schedule: { interval: 'manual' } } } }));
  t.mock.method(stripe.balance, 'retrieve', async () => ({ available: [{ currency: 'usd', amount: 10000 }] }));
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(session));
  t.mock.method(User, 'updateOne', async (filter, update, options) => {
    assert.equal(String(filter._id), String(host));
    assert.equal(update.$inc.withdrawalAllocationVersion, 1);
    assert.equal(options.session, session);
    locked = true;
    return { matchedCount: 1 };
  });
  t.mock.method(Withdrawal, 'findOne', () => Object.assign(Promise.resolve(saved || null), {
    session: async (value) => { assert.equal(value, session); return saved || null; },
  }));
  t.mock.method(Booking, 'find', (filter) => {
    assert.equal(String(filter.host), String(host));
    assert.equal(filter.currency, 'USD');
    return { select: () => ({ session: (value) => {
      assert.equal(value, session);
      return { lean: async () => [
        { _id: new mongoose.Types.ObjectId(), releasedAt: new Date('2025-01-01') },
        { _id: bookingId, merchantAmount: 100, releasedAt: new Date('2026-01-01') },
      ] };
    } }) };
  });
  t.mock.method(Withdrawal, 'find', (filter) => {
    assert.deepEqual(filter.status.$in, ['pending', 'paid']);
    return { sort: () => ({ session: () => ({ lean: async () => [] }) }) };
  });
  t.mock.method(Withdrawal, 'create', async ([data], options) => {
    assert.equal(locked, true);
    assert.equal(options.session, session);
    assert.deepEqual(data.bookingAllocations, [{ bookingId: String(bookingId), amount: 90 }]);
    assert.equal(data.unallocatedAmount, 0);
    saved = new Withdrawal(data);
    assert.equal(saved.validateSync(), undefined, 'allocation amounts must pass real Mongoose validation');
    saved.save = async () => saved;
    return [saved];
  });
  t.mock.method(stripe.payouts, 'create', async (data, options) => {
    assert.ok(saved, 'allocation must be persisted before requesting a payout');
    assert.equal(data.amount, 9000);
    assert.equal(options.idempotencyKey, `withdrawal_${saved._id}_v1`);
    payoutCalls += 1;
    if (payoutCalls === 1) throw new Error('temporary network error');
    return { id: 'po_test', status: 'pending', arrival_date: 1800000000 };
  });
  const request = { amount: 90, currency: 'USD', idempotencyKey: 'request-1' };
  await assert.rejects(payments.createWithdrawal(host, request), /temporary network error/);
  assert.equal(saved.status, 'pending');
  const result = await payments.createWithdrawal(host, request);
  assert.deepEqual(result.bookingIds, [String(bookingId)]);
  assert.equal(result.stripePayoutId, 'po_test');
  assert.equal(payoutCalls, 2);
  await payments.createWithdrawal(host, request);
  assert.equal(payoutCalls, 2, 'completed idempotent retry must not request another payout');
});
