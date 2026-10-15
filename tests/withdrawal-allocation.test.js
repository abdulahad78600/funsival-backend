const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateWithdrawal } = require('../src/utils/withdrawal-allocation');

const credits = [
  { id: 'first', amountMinor: 8000, availableAt: 10 },
  { id: 'second', amountMinor: 5000, availableAt: 20 },
];

test('legacy bookings with missing or invalid earnings cannot poison a withdrawal', () => {
  const result = allocateWithdrawal([
    { id: 'missing', amountMinor: NaN, availableAt: 1 },
    { id: 'infinite', amountMinor: Infinity, availableAt: 2 },
    { id: 'negative', amountMinor: -1000, availableAt: 3 },
    { id: 'undated', amountMinor: 1000, availableAt: NaN },
    ...credits,
  ], [], 9000);
  assert.deepEqual(result, { allocations: [
    { bookingId: 'first', amountMinor: 8000 },
    { bookingId: 'second', amountMinor: 1000 },
  ], unallocatedAmountMinor: 0 });
});

test('withdrawals with no attributable legacy earnings remain valid and untracked', () => {
  assert.deepEqual(allocateWithdrawal([
    { id: 'missing', amountMinor: NaN, availableAt: 1 },
  ], [], 14531), { allocations: [], unallocatedAmountMinor: 14531 });
});

test('invalid requested or previously debited amounts are rejected rather than freeing earnings', () => {
  assert.throws(() => allocateWithdrawal(credits, [], NaN), /Invalid withdrawal amount/);
  assert.throws(() => allocateWithdrawal(credits, [{
    tracked: true, allocations: [{ bookingId: 'first', amountMinor: NaN }],
  }], 100), /Invalid recorded booking allocation/);
  assert.throws(() => allocateWithdrawal(credits, [{ amountMinor: NaN, createdAt: 1 }], 100), /Invalid recorded withdrawal/);
});

test('partial withdrawals and subsequent withdrawals consume each booking only once', () => {
  const first = allocateWithdrawal(credits, [], 6000);
  assert.deepEqual(first, { allocations: [{ bookingId: 'first', amountMinor: 6000 }], unallocatedAmountMinor: 0 });
  const next = allocateWithdrawal(credits, [{ tracked: true, allocations: first.allocations }], 5000);
  assert.deepEqual(next, { allocations: [
    { bookingId: 'first', amountMinor: 2000 },
    { bookingId: 'second', amountMinor: 3000 },
  ], unallocatedAmountMinor: 0 });
});

test('unknown balance is reported without inventing booking IDs', () => {
  assert.deepEqual(allocateWithdrawal(credits, [], 15000), {
    allocations: [{ bookingId: 'first', amountMinor: 8000 }, { bookingId: 'second', amountMinor: 5000 }],
    unallocatedAmountMinor: 2000,
  });
});

test('legacy withdrawals consume only earnings available when they were requested', () => {
  const result = allocateWithdrawal(credits, [{ amountMinor: 9000, createdAt: 15 }], 6000);
  assert.deepEqual(result, { allocations: [{ bookingId: 'second', amountMinor: 5000 }], unallocatedAmountMinor: 1000 });
});

test('recorded allocations are reserved before accounting for old untracked withdrawals', () => {
  const result = allocateWithdrawal(credits, [
    { tracked: false, amountMinor: 7000, createdAt: 30 },
    { tracked: true, allocations: [{ bookingId: 'second', amountMinor: 5000 }] },
  ], 2000);
  assert.deepEqual(result, { allocations: [{ bookingId: 'first', amountMinor: 1000 }], unallocatedAmountMinor: 1000 });
});

test('allocations use integer minor units without rounding away small remainders', () => {
  const result = allocateWithdrawal([{ id: 'first', amountMinor: 101, availableAt: 0 }], [
    { tracked: true, allocations: [{ bookingId: 'first', amountMinor: 100 }] },
  ], 1);
  assert.deepEqual(result, { allocations: [{ bookingId: 'first', amountMinor: 1 }], unallocatedAmountMinor: 0 });
});
