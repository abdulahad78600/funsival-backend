const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/funsival-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.BREVO_API_KEY = process.env.BREVO_API_KEY || 'test-brevo-key';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
process.env.STRIPE_APPLICATION_FEE_PERCENT = '10';

const paymentsService = require('../src/modules/payments/payments.service');
const {
  validateWithdrawalPayload,
  validateEarningsQuery,
  validateTransactionsQuery,
} = require('../src/modules/payments/payments.validation');

const {
  toStripeAmount,
  fromStripeAmount,
  calculatePaymentSplit,
  calculatePayoutEligibleAt,
  isPayoutEligible,
} = paymentsService._private;

test('payment split keeps the platform fee and merchant amount in minor units', () => {
  const split = calculatePaymentSplit(108, 'USD');

  assert.deepEqual(split, {
    total: 10800,
    applicationFee: 1080,
    merchant: 9720,
  });
  assert.equal(split.applicationFee + split.merchant, split.total);
});

test('money conversion handles two-decimal and zero-decimal currencies', () => {
  assert.equal(toStripeAmount(12.34, 'USD'), 1234);
  assert.equal(fromStripeAmount(1234, 'USD'), 12.34);
  assert.equal(toStripeAmount(1234, 'JPY'), 1234);
  assert.equal(fromStripeAmount(1234, 'JPY'), 1234);
});

test('merchant funds remain pending until exactly seven days after capture', () => {
  const paidAt = new Date('2026-08-10T12:00:00.000Z');
  const eligibleAt = calculatePayoutEligibleAt(paidAt, 7);

  assert.equal(eligibleAt.toISOString(), '2026-08-17T12:00:00.000Z');
  assert.equal(isPayoutEligible(eligibleAt, '2026-08-17T11:59:59.999Z'), false);
  assert.equal(isPayoutEligible(eligibleAt, '2026-08-17T12:00:00.000Z'), true);
});

test('withdrawals require positive funds, a currency, and an idempotency key', () => {
  assert.deepEqual(
    validateWithdrawalPayload({ amount: 25.5, currency: 'usd' }, 'withdrawal-request-1'),
    {
      amount: 25.5,
      currency: 'USD',
      idempotencyKey: 'withdrawal-request-1',
    }
  );

  assert.throws(
    () => validateWithdrawalPayload({ amount: 0, currency: 'USD' }, 'request-2'),
    /positive number/
  );
  assert.throws(
    () => validateWithdrawalPayload({ amount: 10, currency: 'USD' }, ''),
    /Idempotency-Key/
  );
});

test('earnings graph ranges use complete UTC days and months', () => {
  const { getEarningsWindow, buildBucketKeys } = paymentsService._private;
  const now = new Date('2026-08-12T14:30:00.000Z');
  const twentyFourHours = getEarningsWindow('24h', now);
  const sevenDays = getEarningsWindow('7d', now);
  const twelveMonths = getEarningsWindow('12m', now);

  assert.equal(twentyFourHours.startDate.toISOString(), '2026-08-11T15:00:00.000Z');
  assert.equal(twentyFourHours.endDate.toISOString(), '2026-08-12T15:00:00.000Z');
  assert.equal(
    buildBucketKeys(twentyFourHours.startDate, twentyFourHours.endDate, 'hour').length,
    24
  );
  assert.equal(sevenDays.startDate.toISOString(), '2026-08-06T00:00:00.000Z');
  assert.equal(sevenDays.endDate.toISOString(), '2026-08-13T00:00:00.000Z');
  assert.equal(buildBucketKeys(sevenDays.startDate, sevenDays.endDate, 'day').length, 7);
  assert.equal(twelveMonths.startDate.toISOString(), '2025-09-01T00:00:00.000Z');
  assert.equal(twelveMonths.endDate.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(
    buildBucketKeys(twelveMonths.startDate, twelveMonths.endDate, 'month').length,
    12
  );
});

test('earnings and transaction query filters are normalized', () => {
  assert.deepEqual(validateEarningsQuery({ range: '30D', currency: 'usd' }), {
    range: '30d',
    currency: 'USD',
  });
  assert.deepEqual(
    validateTransactionsQuery({ page: '2', limit: '500', type: 'withdrawals' }),
    { page: 2, limit: 100, type: 'withdrawal', currency: null }
  );
  assert.throws(() => validateEarningsQuery({ range: 'year' }), /Invalid earnings range/);
  assert.throws(
    () => validateTransactionsQuery({ type: 'refund' }),
    /Invalid transaction type/
  );
});

test('booking payment states map to dashboard earning states', () => {
  const { mapEarningStatus } = paymentsService._private;

  assert.equal(mapEarningStatus('held'), 'pending');
  assert.equal(mapEarningStatus('releasing'), 'processing');
  assert.equal(mapEarningStatus('released'), 'available');
  assert.equal(mapEarningStatus('refunded'), 'refunded');
});
