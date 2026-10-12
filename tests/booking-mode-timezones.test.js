const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreateBookingPayload } = require('../src/modules/bookings/bookings.validation');
const { localSchedule } = require('../src/utils/viewer-schedule');

test('all configured modes across activity, place and equipment use the same local schedule contract', async t => {
  const Listing = require('../src/models/listing.model');
  const Booking = require('../src/models/booking.model');
  const { getBookingQuote } = require('../src/modules/bookings/bookings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
  let category;
  const listingId = '507f1f77bcf86cd799439011';
  t.mock.method(Listing, 'findById', async () => ({
    _id: listingId, category, createdBy: 'host', isActive: true, timeZone: 'Asia/Karachi',
    price: { perPerson: 50, hourly: 20, daily: 30, currency: 'USD' },
    availability: [{ date: '2026-10-13', startTime: '00:00', endTime: '01:00' }],
  }));
  t.mock.method(Booking, 'find', () => ({ select: async () => [] }));
  for (category of ['activity', 'place', 'equipment']) {
    for (const mode of ['per_person', 'hourly', 'daily']) {
      const payload = validateCreateBookingPayload({
        listingId, pricingMode: mode, startDate: '2026-10-13',
        endDate: mode === 'daily' ? '2026-10-14' : '2026-10-13',
        startTime: '00:00', endTime: mode === 'daily' ? '00:00' : '01:00',
        ...(mode === 'per_person' ? { numberOfGuests: 5 } : {}),
        ...(mode === 'hourly' ? { slots: [{ sourceDate: '2026-10-13', startTime: '00:00', endTime: '01:00' }] } : {}),
      }, { requirePaymentMethod: false });
      const quote = await getBookingQuote(payload, 'guest');
      assert.equal(quote.bookingType, mode, `${category}/${mode}`);
      assert.equal(quote.pricing.subtotal, mode === 'per_person' ? 250 : mode === 'hourly' ? 20 : 30);
      for (const [zone, day, time] of [
        ['Asia/Karachi', '2026-10-13', '00:00'],
        ['America/New_York', '2026-10-12', '15:00'],
        ['America/Vancouver', '2026-10-12', '12:00'],
        ['Europe/Berlin', '2026-10-12', '21:00'],
      ]) {
        const schedule = localSchedule(quote, zone);
        assert.equal(schedule.timeZone, zone);
        assert.equal(schedule.ranges[0].startDate, day, `${category}/${mode}/${zone}`);
        assert.equal(schedule.ranges[0].startTime, time);
      }
    }
  }
});
