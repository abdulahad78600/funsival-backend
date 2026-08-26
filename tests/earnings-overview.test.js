const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const paymentsService = require('../src/modules/payments/payments.service');
const { validateEarningsOverviewQuery } = require('../src/modules/payments/payments.validation');
const Booking = require('../src/models/booking.model');

test('earnings overview query defaults to the current year and rejects bad years', () => {
  const now = new Date('2026-08-26T00:00:00Z');
  assert.deepEqual(validateEarningsOverviewQuery({}, now), { year: 2026, currency: null });
  assert.deepEqual(validateEarningsOverviewQuery({ year: '2025', currency: 'usd' }, now), {
    year: 2025,
    currency: 'USD',
  });
  assert.throws(() => validateEarningsOverviewQuery({ year: '1999' }, now), /Invalid year/);
  assert.throws(() => validateEarningsOverviewQuery({ year: 'abc' }, now), /Invalid year/);
});

test('revenue categories collapse listing categories into the three legend buckets', () => {
  const { resolveRevenueCategoryBucket } = paymentsService._private;
  assert.equal(resolveRevenueCategoryBucket('Place'), 'places');
  assert.equal(resolveRevenueCategoryBucket('places'), 'places');
  assert.equal(resolveRevenueCategoryBucket('Equipment'), 'equipments');
  assert.equal(resolveRevenueCategoryBucket('service'), 'services');
  assert.equal(resolveRevenueCategoryBucket('activity'), 'services');
  assert.equal(resolveRevenueCategoryBucket('mystery'), 'other');
});

test('earnings overview returns a Jan-Dec trend and revenue-by-category shares', async () => {
  const hostId = new mongoose.Types.ObjectId();
  const originalAggregate = Booking.aggregate;
  const pipelines = [];

  Booking.aggregate = async (pipeline) => {
    pipelines.push(pipeline);
    const hasLookup = pipeline.some((stage) => stage.$lookup);
    if (hasLookup) {
      return [
        { _id: { currency: 'USD', category: 'place' }, grossEarnings: 600, platformFees: 18, netEarnings: 582, bookingCount: 6 },
        { _id: { currency: 'USD', category: 'equipment' }, grossEarnings: 300, platformFees: 9, netEarnings: 291, bookingCount: 3 },
        { _id: { currency: 'USD', category: 'activity' }, grossEarnings: 100, platformFees: 3, netEarnings: 97, bookingCount: 1 },
      ];
    }
    return [
      { _id: { currency: 'USD', month: 1 }, grossEarnings: 400, platformFees: 12, netEarnings: 388, bookingCount: 4 },
      { _id: { currency: 'USD', month: 8 }, grossEarnings: 600, platformFees: 18, netEarnings: 582, bookingCount: 6 },
    ];
  };

  try {
    const overview = await paymentsService.getEarningsOverview(hostId, { year: 2026 });

    assert.equal(overview.year, 2026);
    assert.equal(overview.startDate, '2026-01-01T00:00:00.000Z');
    assert.equal(overview.trend.interval, 'month');

    const match = pipelines[0][0].$match;
    assert.equal(String(match.host), hostId.toString());
    assert.equal(match.paidAt.$gte.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(match.paidAt.$lt.toISOString(), '2027-01-01T00:00:00.000Z');

    const [trend] = overview.trend.series;
    assert.equal(trend.currency, 'USD');
    assert.equal(trend.points.length, 12);
    assert.deepEqual(trend.points.map((point) => point.label), [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
    assert.equal(trend.points[0].netEarnings, 388);
    assert.equal(trend.points[0].periodStart, '2026-01-01');
    assert.equal(trend.points[1].netEarnings, 0);
    assert.equal(trend.points[7].netEarnings, 582);
    assert.deepEqual(trend.summary, { grossEarnings: 1000, platformFees: 30, netEarnings: 970, bookingCount: 10 });
    assert.deepEqual(trend.peakMonth, { month: 8, label: 'Aug', netEarnings: 582 });

    const [byCategory] = overview.revenueByCategory.series;
    assert.equal(byCategory.currency, 'USD');
    assert.equal(byCategory.total, 970);
    assert.deepEqual(byCategory.categories.map((c) => [c.key, c.label, c.netEarnings, c.percentage]), [
      ['places', 'Places', 582, 60],
      ['equipments', 'Equipments', 291, 30],
      ['services', 'Services', 97, 10],
    ]);
  } finally {
    Booking.aggregate = originalAggregate;
  }
});

test('earnings overview with no data still returns zero-filled months and buckets', async () => {
  const originalAggregate = Booking.aggregate;
  Booking.aggregate = async () => [];
  try {
    const overview = await paymentsService.getEarningsOverview(new mongoose.Types.ObjectId(), {
      year: 2026,
      currency: 'USD',
    });
    assert.equal(overview.trend.series.length, 1);
    assert.equal(overview.trend.series[0].points.length, 12);
    assert.equal(overview.trend.series[0].peakMonth, null);
    assert.equal(overview.revenueByCategory.series[0].total, 0);
    assert.deepEqual(
      overview.revenueByCategory.series[0].categories.map((c) => [c.key, c.percentage]),
      [['places', 0], ['equipments', 0], ['services', 0]]
    );
  } finally {
    Booking.aggregate = originalAggregate;
  }
});
