const test = require('node:test');
const assert = require('node:assert/strict');
const { listingClock, isFutureStart, assertBookingNotPast, resolveListingTimeZone, localBookingInstant, isCalendarDate } = require('../src/utils/booking-clock');

test('Pakistan midnight immediately expires October 8 while UTC is still October 8', () => {
  const listing = { timeZone: 'Asia/Karachi' };
  const before = new Date('2026-10-08T18:59:59Z');
  const midnight = new Date('2026-10-08T19:00:00Z');
  assert.equal(listingClock(listing, before).date, '2026-10-08');
  assert.equal(listingClock(listing, midnight).date, '2026-10-09');
  assert.throws(() => assertBookingNotPast(listing, { startDate: '2026-10-08', startTime: '23:59' }, midnight), /in the past/);
  assert.doesNotThrow(() => assertBookingNotPast(listing, { startDate: '2026-10-09', startTime: '00:01' }, midnight));
});

test('cutoffs follow listing location regardless of process/user time zone', () => {
  const originalTZ = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Karachi', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      const now = new Date('2026-10-09T02:00:00Z');
      const clock = listingClock({ timeZone: 'America/New_York' }, now);
      assert.equal(clock.date, '2026-10-08');
      assert.equal(isFutureStart('2026-10-08', '23:00', clock), true);
      assert.equal(isFutureStart('2026-10-08', '21:00', clock), false);
      assert.equal(isFutureStart('2026-10-07', '23:59', clock), false);
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test('same-day starts and every requested slot are validated at submission', () => {
  const now = new Date('2026-10-09T05:30:00Z');
  const listing = { timeZone: 'Asia/Karachi' };
  const booking = { startDate: '2026-10-09', slots: [{ startTime: '10:30' }, { startTime: '11:30' }] };
  assert.throws(() => assertBookingNotPast(listing, booking, now), /in the past/);
  booking.slots[0].startTime = '10:31';
  assert.doesNotThrow(() => assertBookingNotPast(listing, booking, now));
  assert.throws(() => assertBookingNotPast(listing, { startDate: '2026-10-08' }, now), /in the past/);
});

test('time zone is inferred from coordinates, city or a country with one zone', () => {
  assert.equal(resolveListingTimeZone({ placeLocation: { latitude: 31.52, longitude: 74.35 } }), 'Asia/Karachi');
  assert.equal(resolveListingTimeZone({ placeLocation: { country: 'Pakistan', city: 'Lahore' } }), 'Asia/Karachi');
  assert.equal(resolveListingTimeZone({ placeLocation: { country: 'Pakistan' } }), 'Asia/Karachi');
  assert.equal(resolveListingTimeZone({ placeLocation: { country: 'United States', state: 'Florida', city: 'Orlando' } }), 'America/New_York');
  assert.equal(resolveListingTimeZone({ timeZone: 'Pacific/Auckland', placeLocation: { country: 'Pakistan' } }), 'Pacific/Auckland');
});

test('daylight-saving gaps are unavailable and repeated times use the first occurrence', () => {
  assert.equal(localBookingInstant('2026-03-08', '02:30', 'America/New_York'), null);
  assert.equal(localBookingInstant('2026-11-01', '01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  const clock = listingClock({ timeZone: 'America/New_York' }, new Date('2026-11-01T06:00:00Z'));
  assert.equal(isFutureStart('2026-11-01', '01:30', clock), false);
});

test('date labels reject offset timestamps and impossible dates', () => {
  for (const value of ['2026-10-09', '2026-10-09T00:00:00.000Z', new Date('2026-10-09')]) assert.equal(isCalendarDate(value), true);
  for (const value of ['2026-02-30', '2026-10-09T00:00:00+05:00', '2026-10-09T12:00:00Z', null]) assert.equal(isCalendarDate(value), false);
});

test('slots API rejects yesterday and marks elapsed starts unavailable in the listing zone', async t => {
  const Listing = require('../src/models/listing.model');
  const Booking = require('../src/models/booking.model');
  const service = require('../src/modules/listings/listings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T05:30:00Z') });
  const listing = {
    _id: 'listing', timeZone: 'Asia/Karachi', price: { hourly: 10 },
    availability: [{ date: new Date('2026-10-09'), startTime: '09:00', endTime: '12:00' }],
  };
  t.mock.method(Listing, 'findOne', async () => listing);
  t.mock.method(Booking, 'find', () => ({ select: async () => [] }));
  await assert.rejects(() => service.getAvailableSlotsForListing('listing', '2026-10-08'), /in the past/);
  const result = await service.getAvailableSlotsForListing('listing', '2026-10-09');
  assert.equal(result.timeZone, 'Asia/Karachi');
  assert.deepEqual(result.slots.map(s => [s.startTime, s.available]), [['09:00', false], ['10:00', false], ['11:00', true]]);
});

test('quote and booking creation reject past dates before any payment for every category', async t => {
  const Listing = require('../src/models/listing.model');
  const service = require('../src/modules/bookings/bookings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-08T19:00:00Z') });
  let listing;
  t.mock.method(Listing, 'findById', async () => listing);
  for (const [category, bookingType, fields] of [
    ['activity', 'per_person', { numberOfGuests: 1 }],
    ['place', 'hourly', {}],
    ['equipment', 'daily', { durationDays: 1 }],
  ]) {
    listing = { _id: 'listing', category, isActive: true, createdBy: 'host', timeZone: 'Asia/Karachi', price: { hourly: 10, daily: 10, perPerson: 10 } };
    const payload = { listingId: 'listing', bookingType, startDate: new Date('2026-10-08'), startTime: '23:00', endTime: '23:59', ...fields };
    await assert.rejects(() => service.getBookingQuote(payload, 'guest'), /in the past/);
    await assert.rejects(() => service.createBooking(payload, 'guest'), /in the past/);
  }
});
