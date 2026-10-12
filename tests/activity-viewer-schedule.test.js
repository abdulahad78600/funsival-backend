const test = require('node:test');
const assert = require('node:assert/strict');
const { activityAvailabilityOptions, localSchedule } = require('../src/utils/viewer-schedule');

test('per-person activities show the device zone while retaining original booking times', () => {
  const listing = { timeZone: 'Asia/Karachi', availability: [{ date: '2026-10-12', startTime: '19:00', endTime: '21:00' }] };
  for (const [zone, label, localDate] of [
    ['Asia/Karachi', '7:00 PM', '2026-10-12'],
    ['America/New_York', '10:00 AM', '2026-10-12'],
    ['America/Vancouver', '7:00 AM', '2026-10-12'],
    ['Europe/Berlin', '4:00 PM', '2026-10-12'],
    ['Pacific/Auckland', '3:00 AM', '2026-10-13'],
  ]) {
    const options = activityAvailabilityOptions(listing, zone, Date.parse('2026-10-01'));
    assert.equal(options.length, 2);
    assert.equal(options[0].label, label);
    assert.equal(options[0].localDate, localDate);
    assert.equal(options[0].sourceDate, '2026-10-12');
    assert.equal(options[0].startTime, '19:00');
    assert.equal(options[0].endTime, '20:00');
  }
});

test('local activity calendar handles midnight, short sessions, elapsed and closed windows', () => {
  const listing = { timeZone: 'Asia/Karachi', availability: [
    { date: '2026-10-13', startTime: '01:00', endTime: '01:30' },
    { date: '2026-10-13', startTime: '02:00', endTime: '03:00', isAvailable: false },
    { date: '2026-10-12', startTime: '01:00', endTime: '02:00' },
  ] };
  const options = activityAvailabilityOptions(listing, 'America/New_York', Date.parse('2026-10-12T12:00:00Z'));
  assert.equal(options.length, 1);
  assert.equal(options[0].localDate, '2026-10-12');
  assert.equal(options[0].label, '4:00 PM');
  assert.equal(options[0].endTime, '01:30');
  assert.equal(options[0].localSchedule.ranges[0].label, 'Oct 12, 2026 · 4:00 PM – 4:30 PM');
});

test('per-person quote uses the original date/time and prices the selected guest count', async t => {
  const Listing = require('../src/models/listing.model');
  const { getBookingQuote } = require('../src/modules/bookings/bookings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
  const listing = { _id: 'listing', category: 'activity', bookingType: 'per_person', isActive: true, createdBy: 'host', timeZone: 'Asia/Karachi', price: { perPerson: 50, currency: 'USD' }, availability: [{ date: '2026-10-13', startTime: '01:00', endTime: '02:00' }] };
  t.mock.method(Listing, 'findById', async () => listing);
  const selected = activityAvailabilityOptions(listing, 'America/New_York')[0];
  const quote = await getBookingQuote({ listingId: 'listing', bookingType: 'per_person', startDate: new Date(selected.sourceDate), endDate: new Date(selected.sourceDate), startTime: selected.startTime, endTime: selected.endTime, numberOfGuests: 5 }, 'guest');
  assert.equal(quote.startDate.toISOString().slice(0, 10), '2026-10-13');
  assert.equal(quote.startTime, '01:00');
  assert.equal(quote.pricing.subtotal, 250);
  assert.equal(localSchedule(quote, 'America/New_York').ranges[0].label, 'Oct 12, 2026 · 4:00 PM – 5:00 PM');
});
