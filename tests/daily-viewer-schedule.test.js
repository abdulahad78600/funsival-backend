const test = require('node:test');
const assert = require('node:assert/strict');
const { dailyAvailabilityOptions, localSchedule } = require('../src/utils/viewer-schedule');
const { bookingCompletionAt } = require('../src/utils/booking-clock');

test('daily options convert pickup and return dates from Pakistan into the viewer calendar', () => {
  const listing = { timeZone: 'Asia/Karachi', availability: ['2026-10-13', '2026-10-14'].map(date => ({ date, startTime: '01:00', endTime: '08:00' })) };
  const options = dailyAvailabilityOptions(listing, 'America/New_York', Date.parse('2026-10-01'));
  assert.deepEqual(options.starts.map(option => [option.sourceDate, option.localDate, option.localTime, option.label]), [
    ['2026-10-13', '2026-10-12', '16:00', '4:00 PM'], ['2026-10-14', '2026-10-13', '16:00', '4:00 PM'],
  ]);
  assert.equal(options.ends[1].sourceDate, '2026-10-14');
  assert.equal(options.ends[1].localDate, '2026-10-13');
  assert.equal(dailyAvailabilityOptions(listing, 'America/Vancouver', Date.parse('2026-10-01')).starts[0].label, '1:00 PM');
  assert.equal(dailyAvailabilityOptions(listing, 'Europe/Berlin', Date.parse('2026-10-01')).starts[0].label, '10:00 PM');
});

test('daily return options use the return-date DST offset and omit elapsed or closed pickups', () => {
  const listing = { timeZone: 'Asia/Karachi', availability: [
    { date: '2026-10-31', startTime: '18:00', endTime: '19:00' },
    { date: '2026-11-02', startTime: '18:00', endTime: '19:00' },
    { date: '2026-11-03', startTime: '18:00', endTime: '19:00', isAvailable: false },
  ] };
  const options = dailyAvailabilityOptions(listing, 'America/New_York', Date.parse('2026-10-30'));
  assert.deepEqual(options.starts.map(option => option.label), ['9:00 AM', '8:00 AM']);
  assert.deepEqual(options.ends.map(option => option.label), ['9:00 AM', '8:00 AM']);
  assert.equal(dailyAvailabilityOptions(listing, 'America/New_York', Date.parse('2026-11-01')).starts.length, 1);
});

test('place and equipment daily quotes retain pickup times, local schedules and listing-calendar day rates', async t => {
  const Listing = require('../src/models/listing.model');
  const service = require('../src/modules/bookings/bookings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
  let category;
  t.mock.method(Listing, 'findById', async () => ({ _id: 'listing', category, isActive: true, createdBy: 'host', timeZone: 'Asia/Karachi', price: { daily: 10.84, currency: 'USD' } }));
  for (category of ['place', 'equipment']) {
    const quote = await service.getBookingQuote({ listingId: 'listing', pricingMode: 'daily', startDate: new Date('2026-10-13'), endDate: new Date('2026-10-14'), startTime: '01:00', endTime: '01:00' }, 'guest');
    assert.equal(quote.startTime, '01:00');
    assert.equal(quote.endTime, '01:00');
    assert.equal(quote.pricing.unitsBooked, 1);
    assert.equal(quote.pricing.subtotal, 10.84);
    assert.equal(quote.pricing.totalAmount, 11.92);
    assert.equal(localSchedule(quote, 'America/New_York').ranges[0].label, 'Oct 12, 2026 · 4:00 PM – Oct 13, 2026 · 4:00 PM');
    assert.equal(bookingCompletionAt(quote, { timeZone: quote.timeZone }).toISOString(), '2026-10-13T20:00:00.000Z');
    const dateOnly = await service.getBookingQuote({ listingId: 'listing', pricingMode: 'daily', startDate: new Date('2026-10-13'), endDate: new Date('2026-10-14') }, 'guest');
    assert.equal(dateOnly.startTime, null);
    assert.equal(dateOnly.endTime, null);
  }
});
