const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Booking = require('../src/models/booking.model');
const Withdrawal = require('../src/models/withdrawal.model');
const paymentsService = require('../src/modules/payments/payments.service');
const { validateTransactionsQuery } = require('../src/modules/payments/payments.validation');

test('transaction references use payment identifiers independently of booking IDs', async () => {
  const originalAggregate = Booking.aggregate;
  const bookingId = new mongoose.Types.ObjectId();
  Booking.aggregate = async (pipeline) => {
    if (pipeline.some((stage) => stage.$group)) return [{ _id: 'USD' }];
    const project = pipeline.find((stage) => stage.$project).$project;
    assert.equal(project.stripePaymentIntentId, 1);
    assert.equal(project.stripeChargeId, 1);
    const withdrawalProject = pipeline.find((stage) => stage.$unionWith)
      .$unionWith.pipeline.find((stage) => stage.$project).$project;
    assert.equal(withdrawalProject.stripePayoutId, 1);
    return [{ transactions: [
      { _id: bookingId, transactionType: 'earning', stripePaymentIntentId: 'pi_payment', stripeChargeId: 'ch_charge' },
      { _id: new mongoose.Types.ObjectId(), transactionType: 'earning', stripeChargeId: 'ch_legacy' },
      { _id: new mongoose.Types.ObjectId(), transactionType: 'earning' },
      { _id: new mongoose.Types.ObjectId(), transactionType: 'withdrawal', stripePayoutId: 'po_payout',
        bookingAllocations: [{ bookingId, amount: 90 }], unallocatedAmount: 0 },
    ], metadata: [{ total: 4 }] }];
  };
  try {
    const { transactions } = await paymentsService.listTransactions(new mongoose.Types.ObjectId());
    assert.equal(transactions[0].booking.id, String(bookingId));
    assert.deepEqual(transactions.map((row) => row.transactionId), ['pi_payment', 'ch_legacy', null, 'po_payout']);
    assert.deepEqual(transactions[3].withdrawal.bookingIds, [String(bookingId)]);
    assert.deepEqual(transactions[3].withdrawal.bookingAllocations, [{ bookingId: String(bookingId), amount: 90 }]);
  } finally {
    Booking.aggregate = originalAggregate;
  }
});

test('transaction currency choices cover the host history independently of currency, type, and page', async () => {
  const hostId = new mongoose.Types.ObjectId();
  const originalBookingAggregate = Booking.aggregate;
  const originalWithdrawalAggregate = Withdrawal.aggregate;
  let selectedCurrency;
  const aggregate = async (pipeline) => {
    assert.equal(String(pipeline[0].$match.host), String(hostId));
    const union = pipeline.find((stage) => stage.$unionWith)?.$unionWith;
    if (pipeline.some((stage) => stage.$group)) {
      assert.equal(pipeline[0].$match.currency, undefined);
      assert.equal(union.pipeline[0].$match.currency, undefined);
      assert.equal(String(union.pipeline[0].$match.host), String(hostId));
      return ['EUR', 'GBP', 'PKR', 'USD'].map((currency) => ({ _id: currency }));
    }
    assert.equal(pipeline[0].$match.currency, selectedCurrency);
    if (union) assert.equal(union.pipeline[0].$match.currency, selectedCurrency);
    return [{ transactions: [], metadata: [] }];
  };
  Booking.aggregate = aggregate;
  Withdrawal.aggregate = aggregate;
  try {
    for (const type of ['all', 'earning', 'withdrawal']) {
      for (const currency of ['usd', 'pkr', 'eur', 'gbp']) {
        const query = validateTransactionsQuery({ currency, type, page: '2' });
        selectedCurrency = currency.toUpperCase();
        const result = await paymentsService.listTransactions(hostId, query);
        assert.deepEqual(result.availableCurrencies, ['EUR', 'GBP', 'PKR', 'USD']);
        assert.deepEqual(result.transactions, []);
        assert.equal(result.pagination.total, 0);
        assert.equal(result.pagination.page, 2);
      }
    }
  } finally {
    Booking.aggregate = originalBookingAggregate;
    Withdrawal.aggregate = originalWithdrawalAggregate;
  }
});

test('a USD-only history offers only USD even when an empty EUR filter is requested', async () => {
  const originalAggregate = Booking.aggregate;
  Booking.aggregate = async (pipeline) => pipeline.some((stage) => stage.$group)
    ? [{ _id: 'USD' }]
    : [{ transactions: [], metadata: [] }];
  try {
    const result = await paymentsService.listTransactions(new mongoose.Types.ObjectId(), { currency: 'EUR' });
    assert.deepEqual(result.availableCurrencies, ['USD']);
    assert.deepEqual(result.transactions, []);
  } finally {
    Booking.aggregate = originalAggregate;
  }
});
