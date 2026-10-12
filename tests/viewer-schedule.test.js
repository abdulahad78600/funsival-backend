const test = require('node:test');
const assert = require('node:assert/strict');
const { localSchedule, presentBookingResult, localAvailabilityDates } = require('../src/utils/viewer-schedule');
const viewerTimeZone = require('../src/middlewares/viewer-timezone.middleware');

const booking = { startDate: '2026-10-12', slots: [{ startTime: '00:00', endTime: '01:00' }], listing: { timeZone: 'Asia/Karachi' } };

test('backend converts Pakistan bookings for different countries and US/Canadian regions', () => {
  for (const [zone, date, time] of [
    ['America/New_York', '2026-10-11', '15:00'],
    ['America/Los_Angeles', '2026-10-11', '12:00'],
    ['America/Toronto', '2026-10-11', '15:00'],
    ['America/Vancouver', '2026-10-11', '12:00'],
    ['Europe/Berlin', '2026-10-11', '21:00'],
    ['Asia/Kolkata', '2026-10-12', '00:30'],
    ['Pacific/Auckland', '2026-10-12', '08:00'],
  ]) {
    const schedule = localSchedule(booking, zone);
    assert.equal(schedule.timeZone, zone);
    assert.equal(schedule.ranges[0].startDate, date);
    assert.equal(schedule.ranges[0].startTime, time);
    assert.equal(schedule.ranges[0].startAt, '2026-10-11T19:00:00.000Z');
  }
  assert.equal(booking.slots[0].startTime, '00:00');
});

test('backend uses booking-date DST offsets and shows both dates across midnight', () => {
  const input = { startDate: '2026-10-12', startTime: '08:00', endTime: '10:00', timeZone: 'Asia/Karachi' };
  assert.equal(localSchedule(input, 'America/New_York').ranges[0].label, 'Oct 11, 2026 · 11:00 PM – Oct 12, 2026 · 1:00 AM');
  assert.equal(localSchedule({ ...input, startDate: '2026-12-12' }, 'America/New_York').ranges[0].startTime, '22:00');
  assert.equal(localSchedule({ ...input, startDate: '2026-12-12' }, 'Europe/Berlin').ranges[0].startTime, '04:00');
});

test('backend does not shift nonexistent DST times and uses the first repeated occurrence', () => {
  const input = { startDate: '2026-03-08', startTime: '02:30', endTime: '03:30', timeZone: 'America/New_York' };
  assert.deepEqual(localSchedule(input, 'Europe/Berlin').ranges, []);
  assert.equal(localSchedule({ ...input, startDate: '2026-11-01', startTime: '01:30', endTime: '02:30' }, 'Europe/Berlin').ranges[0].startAt, '2026-11-01T05:30:00.000Z');
});

test('booking collections, mutation responses and deleted-listing snapshots retain canonical schedules', () => {
  const list = presentBookingResult({ bookings: [booking], pagination: { total: 1 } }, 'Europe/Berlin');
  assert.equal(list.bookings[0].localSchedule.ranges[0].startTime, '21:00');
  assert.equal(list.bookings[0].slots[0].startTime, '00:00');
  assert.equal(list.pagination.total, 1);
  const deleted = { ...booking, listing: null, listingSnapshot: { timeZone: 'Asia/Karachi' } };
  assert.equal(presentBookingResult({ booking: deleted }, 'America/Vancouver').booking.localSchedule.ranges[0].startTime, '12:00');
  assert.equal(localSchedule({ ...deleted, listingSnapshot: null }, 'America/Vancouver'), null);
});

test('date-only bookings keep calendar labels and invalid viewer zones are not guessed', () => {
  assert.equal(localSchedule({ startDate: '2026-10-12', endDate: '2026-10-14', timeZone: 'Asia/Karachi' }, 'America/Toronto').ranges[0].label, '2026-10-12 – 2026-10-14');
  assert.equal(localSchedule(booking, 'Canada'), null);
});

test('backend local calendar maps adjacent listing days into one viewer date without end-boundary leakage', () => {
  const listing = { timeZone: 'Asia/Karachi', availability: [
    { date: '2026-10-12', startTime: '08:00', endTime: '10:00' },
    { date: '2026-10-13', startTime: '00:00', endTime: '01:00' },
  ] };
  assert.deepEqual(localAvailabilityDates(listing, 'America/New_York', Date.parse('2026-10-01')), {
    '2026-10-11': ['2026-10-12'], '2026-10-12': ['2026-10-12', '2026-10-13'],
  });
  assert.deepEqual(localAvailabilityDates({ ...listing, availability: [{ date: '2026-10-12', startTime: '08:00', endTime: '09:00' }] }, 'America/New_York', Date.parse('2026-10-01')), { '2026-10-11': ['2026-10-12'] });
});

test('timezone header middleware rejects country labels and isolates cached schedules', () => {
  for (const zone of ['America/Vancouver', undefined, 'Canada']) {
    const req = { get: () => zone };
    let error;
    let vary;
    viewerTimeZone(req, { vary: value => { vary = value; } }, value => { error = value; });
    if (zone === 'Canada') assert.equal(error.statusCode, 400);
    else {
      assert.equal(error, undefined);
      assert.equal(req.viewerTimeZone, zone || null);
      assert.equal(vary, 'X-Time-Zone');
    }
  }
});

test('slots API uses viewer dates, retains source times and checks bookings on each source day', async t => {
  const Listing = require('../src/models/listing.model');
  const Booking = require('../src/models/booking.model');
  const { getAvailableSlotsForListing } = require('../src/modules/listings/listings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
  t.mock.method(Listing, 'findOne', async () => ({ _id: 'listing', timeZone: 'Asia/Karachi', bookingType: 'per_hour', price: { hourly: 10 }, availability: [
    { date: new Date('2026-10-12'), startTime: '09:00', endTime: '10:00' },
    { date: new Date('2026-10-13'), startTime: '00:00', endTime: '01:00' },
  ] }));
  const queried = [];
  t.mock.method(Booking, 'find', query => ({ select: async () => {
    const sourceDate = query.endDate.$gte.toISOString().slice(0, 10);
    queried.push(sourceDate);
    return sourceDate === '2026-10-13' ? [{ startTime: '00:00', endTime: '01:00' }] : [];
  } }));
  const result = await getAvailableSlotsForListing('listing', '2026-10-12', { viewerTimeZone: 'America/New_York', dateInViewerZone: true });
  assert.equal(result.viewerTimeZone, 'America/New_York');
  assert.deepEqual(queried.sort(), ['2026-10-12', '2026-10-13']);
  assert.equal(result.slots.length, 2);
  assert.equal(result.slots[0].localSchedule.ranges[0].startTime, '00:00');
  assert.equal(result.slots[0].startTime, '09:00');
  assert.equal(result.slots[0].sourceDate, '2026-10-12');
  assert.equal(result.slots[0].available, true);
  assert.equal(result.slots[1].localSchedule.ranges[0].startTime, '15:00');
  assert.equal(result.slots[1].available, false);
  await assert.rejects(getAvailableSlotsForListing('listing', '2026-10-12', { dateInViewerZone: true }), error => error.statusCode === 400);
});

test('booking API handlers return server-converted schedules for list, detail, quote and mutations', async t => {
  const service = require('../src/modules/bookings/bookings.service');
  for (const method of ['getBookingsForGuest', 'getBookingsForHost']) {
    t.mock.method(service, method, async () => ({ bookings: [booking], pagination: { total: 1 } }));
  }
  for (const method of ['getBookingByIdForUser', 'cancelBooking', 'acceptBookingRequest', 'declineBookingRequest']) {
    t.mock.method(service, method, async () => booking);
  }
  t.mock.method(service, 'getBookingQuote', async () => ({ ...booking, listing: undefined, timeZone: 'Asia/Karachi' }));
  t.mock.method(service, 'createBooking', async () => ({ booking: { ...booking, listing: 'listing-id', listingSnapshot: { timeZone: 'Asia/Karachi' } }, payment: { clientSecret: 'test' } }));
  const controllerPath = require.resolve('../src/modules/bookings/bookings.controller');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  t.after(() => { delete require.cache[controllerPath]; });
  for (const handler of ['getMyBookingsHandler', 'getHostBookingsHandler', 'getBookingByIdHandler', 'getBookingQuoteHandler', 'createBookingHandler', 'cancelBookingHandler', 'acceptBookingHandler', 'declineBookingHandler']) {
    const req = { viewerTimeZone: 'Europe/Berlin', user: { id: 'user' }, query: {},
      params: { bookingId: '507f1f77bcf86cd799439011' },
      body: { listingId: '507f1f77bcf86cd799439011', pricingMode: 'hourly', startDate: '2026-10-12', slots: booking.slots,
        ...(handler === 'createBookingHandler' ? { paymentMethodId: 'pm_test' } : {}),
      },
    };
    const result = await new Promise((resolve, reject) => {
      const res = { status: () => res, json: resolve };
      controller[handler](req, res, reject);
    });
    const data = result.data.booking || result.data.bookings?.[0] || result.data;
    assert.equal(data.localSchedule.timeZone, 'Europe/Berlin', handler);
    assert.equal(data.localSchedule.ranges[0].startTime, '21:00', handler);
    assert.equal(data.slots[0].startTime, '00:00', handler);
  }
});

test('schedule quotes need no card but actual booking creation still requires one', () => {
  const { validateCreateBookingPayload } = require('../src/modules/bookings/bookings.validation');
  const payload = { listingId: '507f1f77bcf86cd799439011', pricingMode: 'hourly', startDate: '2026-10-12', slots: booking.slots };
  assert.doesNotThrow(() => validateCreateBookingPayload(payload, { requirePaymentMethod: false }));
  assert.throws(() => validateCreateBookingPayload(payload), error => Boolean(error.details?.paymentMethodId));
  assert.throws(() => validateCreateBookingPayload({ ...payload, paymentMethodId: 'invalid' }, { requirePaymentMethod: false }), error => Boolean(error.details?.paymentMethodId));
});
