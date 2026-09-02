const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/funsival-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.BREVO_API_KEY = process.env.BREVO_API_KEY || 'test-brevo-key';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

const bookingsService = require('../src/modules/bookings/bookings.service');
const {
  validateHostBookingsQuery,
} = require('../src/modules/bookings/bookings.validation');

test('host reservation filters accept every UI tab', () => {
  for (const tab of ['all', 'upcoming', 'completed', 'cancelled']) {
    assert.equal(validateHostBookingsQuery({ tab }).tab, tab);
  }

  assert.throws(
    () => validateHostBookingsQuery({ tab: 'refunded' }),
    /Invalid tab/
  );
});

test('host reservation date accepts API and calendar display formats', () => {
  const iso = validateHostBookingsQuery({ date: '2026-08-12' });
  const shortDisplay = validateHostBookingsQuery({ date: '08/12/26' });
  const display = validateHostBookingsQuery({ date: '08/12/2026' });

  assert.equal(iso.date.toISOString(), '2026-08-12T00:00:00.000Z');
  assert.equal(shortDisplay.date.toISOString(), '2026-08-12T00:00:00.000Z');
  assert.equal(display.date.toISOString(), '2026-08-12T00:00:00.000Z');
  assert.throws(
    () => validateHostBookingsQuery({ date: '02/30/2026' }),
    /Date is invalid/
  );
});

test('reservation date filtering includes bookings that overlap the selected day', () => {
  const { buildReservationDateFilter } = bookingsService._private;
  const filter = buildReservationDateFilter(
    new Date('2026-08-12T00:00:00.000Z')
  );

  assert.equal(filter.startDate.$lt.toISOString(), '2026-08-13T00:00:00.000Z');
  assert.equal(filter.endDate.$gte.toISOString(), '2026-08-12T00:00:00.000Z');
});

test('reservation status tabs map to the expected booking states', () => {
  const { buildReservationStatusFilter } = bookingsService._private;
  const now = new Date('2026-08-12T12:00:00.000Z');

  assert.equal(buildReservationStatusFilter('all', now), null);
  assert.deepEqual(buildReservationStatusFilter('upcoming', now), {
    status: 'confirmed',
    startDate: { $gt: now },
  });
  assert.deepEqual(buildReservationStatusFilter('completed', now), {
    status: 'completed',
  });
  assert.deepEqual(buildReservationStatusFilter('cancelled', now), {
    status: { $in: ['cancelled', 'declined', 'listing_deleted'] },
  });
});

test('guest reservation tabs accept UI labels and aliases', () => {
  const { validateGuestBookingsQuery } = require('../src/modules/bookings/bookings.validation');

  assert.equal(validateGuestBookingsQuery({}).tab, 'all');
  for (const tab of ['all', 'in_progress', 'completed', 'cancelled']) {
    assert.equal(validateGuestBookingsQuery({ tab }).tab, tab);
  }
  assert.equal(validateGuestBookingsQuery({ tab: 'In-Progress' }).tab, 'in_progress');
  assert.equal(validateGuestBookingsQuery({ tab: 'inprogress' }).tab, 'in_progress');
  assert.equal(validateGuestBookingsQuery({ tab: 'in progress' }).tab, 'in_progress');
  assert.throws(() => validateGuestBookingsQuery({ tab: 'upcoming' }), /Invalid tab/);
});

test('guest reservation tabs map to booking states', () => {
  const { buildGuestReservationStatusFilter } = bookingsService._private;

  assert.equal(buildGuestReservationStatusFilter('all'), null);
  assert.deepEqual(buildGuestReservationStatusFilter('in_progress'), {
    status: { $in: ['pending', 'awaiting_host_approval', 'confirmed'] },
  });
  assert.deepEqual(buildGuestReservationStatusFilter('completed'), { status: 'completed' });
  assert.deepEqual(buildGuestReservationStatusFilter('cancelled'), {
    status: { $in: ['cancelled', 'declined', 'listing_deleted'] },
  });
});

test('guest reservation list applies the tab filter and returns tab counts', async () => {
  const mongoose = require('mongoose');
  const Booking = require('../src/models/booking.model');
  const paymentsService = require('../src/modules/payments/payments.service');
  const originalFind = Booking.find;
  const originalAggregate = Booking.aggregate;
  const originalReconcile = paymentsService.reconcileProcessingBookings;
  const guestId = new mongoose.Types.ObjectId();
  let bookingFilter;
  let countPipeline;

  Booking.find = (filter) => {
    bookingFilter = filter;
    return {
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      then(resolve) { resolve([]); },
    };
  };
  Booking.aggregate = async (pipeline) => {
    countPipeline = pipeline;
    return [{
      all: [{ count: 5 }],
      in_progress: [{ count: 2 }],
      completed: [{ count: 2 }],
      cancelled: [{ count: 1 }],
    }];
  };
  paymentsService.reconcileProcessingBookings = async () => {};

  try {
    const result = await bookingsService.getBookingsForGuest(guestId.toString(), {
      tab: 'in_progress',
      page: 1,
      limit: 10,
    });

    assert.deepEqual(bookingFilter, {
      $and: [
        { bookedBy: guestId },
        { status: { $in: ['pending', 'awaiting_host_approval', 'confirmed'] } },
      ],
    });
    assert.deepEqual(countPipeline[0].$match, { bookedBy: guestId });
    assert.deepEqual(Object.keys(countPipeline[1].$facet), ['all', 'in_progress', 'completed', 'cancelled']);
    assert.deepEqual(result.filters, {
      tab: 'in_progress',
      counts: { all: 5, in_progress: 2, completed: 2, cancelled: 1 },
    });
    assert.equal(result.pagination.total, 2);

    await bookingsService.getBookingsForGuest(guestId.toString(), { tab: 'all' });
    assert.deepEqual(bookingFilter, { bookedBy: guestId });

    await assert.rejects(
      () => bookingsService.getBookingsForGuest(guestId.toString(), { tab: 'upcoming' }),
      /Invalid tab/
    );
  } finally {
    Booking.find = originalFind;
    Booking.aggregate = originalAggregate;
    paymentsService.reconcileProcessingBookings = originalReconcile;
  }
});

test('host reservation list combines tab, search, and date filters with tab counts', async () => {
  const Booking = require('../src/models/booking.model');
  const Listing = require('../src/models/listing.model');
  const User = require('../src/models/user.model');
  const paymentsService = require('../src/modules/payments/payments.service');
  const originalListingFind = Listing.find;
  const originalUserFind = User.find;
  const originalBookingFind = Booking.find;
  const originalBookingAggregate = Booking.aggregate;
  const originalReconcile = paymentsService.reconcileProcessingBookings;
  let bookingFilter;
  let countPipeline;

  function resolvedLeanQuery(rows) {
    return {
      select() { return this; },
      async lean() { return rows; },
    };
  }

  Listing.find = () => resolvedLeanQuery([
    { _id: '64b000000000000000000010' },
  ]);
  User.find = () => resolvedLeanQuery([
    { _id: '64b000000000000000000011' },
  ]);
  Booking.find = (filter) => {
    bookingFilter = filter;
    return {
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      then(resolve) { resolve([]); },
    };
  };
  Booking.aggregate = async (pipeline) => {
    countPipeline = pipeline;
    return [{
      all: [{ count: 7 }],
      active: [{ count: 1 }],
      upcoming: [{ count: 2 }],
      completed: [{ count: 3 }],
      cancelled: [{ count: 2 }],
    }];
  };
  paymentsService.reconcileProcessingBookings = async () => {};

  try {
    const result = await bookingsService.getBookingsForHost(
      '64b000000000000000000000',
      {
        tab: 'upcoming',
        search: 'quad bike',
        date: new Date('2026-09-24T00:00:00.000Z'),
        page: 1,
        limit: 10,
      }
    );

    assert.equal(bookingFilter.$and[1].status, 'confirmed');
    assert.equal(countPipeline[0].$match.$and[0].host.constructor.name, 'ObjectId');
    assert.deepEqual(result.filters.counts, {
      all: 7,
      upcoming: 2,
      completed: 3,
      cancelled: 2,
    });
    assert.equal(result.pagination.total, 2);
    assert.equal(result.filters.date, '2026-09-24');
  } finally {
    Listing.find = originalListingFind;
    User.find = originalUserFind;
    Booking.find = originalBookingFind;
    Booking.aggregate = originalBookingAggregate;
    paymentsService.reconcileProcessingBookings = originalReconcile;
  }
});

test('reservation card helpers calculate week boundaries and safe comparison values', () => {
  const { startOfUtcWeek, rate, changePercentage } = bookingsService._private;

  assert.equal(
    startOfUtcWeek(new Date('2026-08-12T14:30:00.000Z')).toISOString(),
    '2026-08-10T00:00:00.000Z'
  );
  assert.equal(rate(49, 50), 98);
  assert.equal(rate(0, 0), 0);
  assert.equal(changePercentage(108, 100), 8);
  assert.equal(changePercentage(10, 0), null);
});

test('reservation stats supply all four KPI cards and tab totals', async () => {
  const Booking = require('../src/models/booking.model');
  const originalAggregate = Booking.aggregate;
  const originalCountDocuments = Booking.countDocuments;

  Booking.countDocuments = async () => 2;
  Booking.aggregate = async (pipeline) => {
    const match = pipeline[0].$match;
    if (pipeline[1] && pipeline[1].$group && pipeline[1].$group._id === '$status') {
      return [
        { _id: 'completed', count: 49 },
        { _id: 'confirmed', count: 10 },
        { _id: 'cancelled', count: 1 },
        { _id: 'pending', count: 6 },
      ];
    }
    if (match.createdAt) {
      return [{ currentWeek: 5, previousWeek: 3 }];
    }
    if (match.paymentStatus) {
      return [{
        _id: 'USD',
        total: 1801,
        currentMonth: 108,
        previousMonth: 100,
      }];
    }
    if (match.status && match.status.$nin) {
      return [{ total: 8, newThisWeek: 3 }];
    }
    return [{
      currentCompleted: 49,
      currentDecided: 50,
      previousCompleted: 48,
      previousDecided: 50,
    }];
  };

  try {
    const stats = await bookingsService.getHostReservationStats(
      '64b000000000000000000000'
    );

    assert.equal(stats.cards.totalReservations.total, 66);
    assert.equal(stats.cards.totalReservations.changeFromLastWeek, 2);
    assert.equal(stats.cards.revenue[0].monthChangePercentage, 8);
    assert.deepEqual(stats.cards.activeCustomers, { total: 8, newThisWeek: 3 });
    assert.equal(stats.cards.completionRate.rate, 98);
    assert.equal(stats.cards.completionRate.changePercentage, 2);
    assert.deepEqual(stats.tabs, {
      all: 66,
      upcoming: 2,
      completed: 49,
      cancelled: 1,
      pending: 6,
    });
  } finally {
    Booking.aggregate = originalAggregate;
    Booking.countDocuments = originalCountDocuments;
  }
});
