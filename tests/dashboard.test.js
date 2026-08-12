const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardService = require('../src/modules/dashboard/dashboard.service');
const { validateDashboardQuery } = require('../src/modules/dashboard/dashboard.validation');
const Booking = require('../src/models/booking.model');
const Listing = require('../src/models/listing.model');

test('dashboard query limits recent reservations and normalizes currency', () => {
  assert.deepEqual(validateDashboardQuery({ recentLimit: '100', currency: 'usd' }), {
    recentLimit: 20,
    currency: 'USD',
  });
  assert.deepEqual(validateDashboardQuery({}), {
    recentLimit: 5,
    currency: null,
  });
  assert.throws(() => validateDashboardQuery({ currency: 'dollars' }), /three-letter/);
});

test('dashboard percentages handle normal and zero baselines', () => {
  const { percentage, percentageChange } = dashboardService._private;

  assert.equal(percentage(3, 4), 75);
  assert.equal(percentage(3, 0), 0);
  assert.equal(percentageChange(115, 100), 15);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(50, 0), null);
});

test('dashboard quarter comparisons use UTC calendar quarters', () => {
  const { getQuarterBoundaries } = dashboardService._private;
  const boundaries = getQuarterBoundaries('2026-08-12T14:30:00.000Z');

  assert.equal(
    boundaries.previousQuarterStart.toISOString(),
    '2026-04-01T00:00:00.000Z'
  );
  assert.equal(
    boundaries.currentQuarterStart.toISOString(),
    '2026-07-01T00:00:00.000Z'
  );
  assert.equal(
    boundaries.nextQuarterStart.toISOString(),
    '2026-10-01T00:00:00.000Z'
  );
});

test('dashboard overview returns every card and panel required by the host dashboard', async () => {
  const originalCountDocuments = Listing.countDocuments;
  const originalAggregate = Booking.aggregate;
  const originalFind = Booking.find;

  Listing.countDocuments = async (filter) => (filter.createdAt ? 2 : 12);
  Booking.aggregate = async (pipeline) => {
    if (pipeline[1] && pipeline[1].$group) {
      return [
        { _id: 'completed', count: 6 },
        { _id: 'confirmed', count: 2 },
        { _id: 'pending', count: 1 },
        { _id: 'awaiting_host_approval', count: 1 },
        { _id: 'cancelled', count: 2 },
      ];
    }
    return [
      {
        _id: 'USD',
        total: 1000,
        currentQuarter: 115,
        previousQuarter: 100,
      },
    ];
  };
  Booking.find = () => ({
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() {
      return [
        {
          _id: '64b000000000000000000001',
          status: 'completed',
          createdAt: new Date('2026-08-12T12:00:00.000Z'),
          startDate: new Date('2026-08-15T12:00:00.000Z'),
          endDate: new Date('2026-08-15T14:00:00.000Z'),
          listing: {
            _id: '64b000000000000000000002',
            basicInformation: { activityTitle: 'ATV Quad Bike' },
            category: 'Equipment',
            type: 'ATV',
            photos: ['https://example.com/atv.jpg'],
          },
          bookedBy: {
            _id: '64b000000000000000000003',
            email: 'guest@example.com',
            providerProfile: { firstName: 'Guest', lastName: 'User' },
          },
        },
      ];
    },
  });

  try {
    const overview = await dashboardService.getHostDashboardOverview(
      '64b000000000000000000000',
      { recentLimit: 5, currency: 'USD' }
    );

    assert.deepEqual(overview.cards.totalEarnings, [
      {
        currency: 'USD',
        amount: 1000,
        currentQuarter: 115,
        previousQuarter: 100,
        quarterChangePercentage: 15,
      },
    ]);
    assert.deepEqual(overview.cards.activeListings, {
      total: 12,
      addedThisMonth: 2,
    });
    assert.deepEqual(overview.cards.reservations, { total: 12, pending: 2 });
    assert.deepEqual(overview.cards.completed, { total: 6, successRate: 75 });
    assert.equal(overview.recentReservations[0].listing.title, 'ATV Quad Bike');
    assert.equal(overview.listingPerformance.completed.percentage, 50);
    assert.equal(overview.listingPerformance.pending.percentage, 33.33);
    assert.equal(overview.listingPerformance.cancelled.percentage, 16.67);
    assert.equal(overview.utilization.booked.percentage, 66.67);
    assert.equal(overview.utilization.pending.percentage, 16.67);
  } finally {
    Listing.countDocuments = originalCountDocuments;
    Booking.aggregate = originalAggregate;
    Booking.find = originalFind;
  }
});
