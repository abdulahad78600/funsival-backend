const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Booking = require('../src/models/booking.model');
const Withdrawal = require('../src/models/withdrawal.model');
const paymentsService = require('../src/modules/payments/payments.service');
const { validateTransactionsQuery } = require('../src/modules/payments/payments.validation');

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
