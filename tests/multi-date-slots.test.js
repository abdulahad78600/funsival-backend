const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreateBookingPayload } = require('../src/modules/bookings/bookings.validation');
const { localSchedule } = require('../src/utils/viewer-schedule');
const { bookingCompletionAt, hasBookingRequestExpired, assertBookingNotPast } = require('../src/utils/booking-clock');

const slots = [
  { sourceDate: '2026-10-13', startTime: '00:00', endTime: '01:00' },
  { sourceDate: '2026-10-12', startTime: '21:00', endTime: '22:00' },
];
const payload = { listingId: '507f1f77bcf86cd799439011', pricingMode: 'hourly', startDate: '2026-10-12', endDate: '2026-10-13', slots };
const listing = { _id: payload.listingId, category: 'equipment', bookingType: 'per_hour', isActive: true, createdBy: 'host', timeZone: 'Asia/Karachi', price: { hourly: 20, currency: 'USD' }, availability: slots.map(slot => ({ date: slot.sourceDate, ...slot })) };

test('date-aware validation allows repeated clock times on separate days but rejects same-day overlaps and bad dates', () => {
  const valid = validateCreateBookingPayload(payload, { requirePaymentMethod: false });
  assert.equal(valid.slots[0].sourceDate, '2026-10-12');
  assert.doesNotThrow(() => validateCreateBookingPayload({ ...payload, slots: [slots[0], { ...slots[0], sourceDate: '2026-10-12' }] }, { requirePaymentMethod: false }));
  assert.throws(() => validateCreateBookingPayload({ ...payload, slots: [slots[0], slots[0]] }, { requirePaymentMethod: false }), error => /overlap/.test(error.details.slots));
  assert.throws(() => validateCreateBookingPayload({ ...payload, slots: [{ ...slots[0], sourceDate: '2026-02-30' }] }, { requirePaymentMethod: false }), error => /sourceDate/.test(error.details.slots));
});

test('one quote totals slots across listing midnight and checks conflicts on the right dates', async t => {
  const Listing = require('../src/models/listing.model');
  const Booking = require('../src/models/booking.model');
  const service = require('../src/modules/bookings/bookings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
  t.mock.method(Listing, 'findById', async () => listing);
  let occupied = [];
  t.mock.method(Booking, 'find', () => ({ select: async () => occupied }));
  const valid = validateCreateBookingPayload(payload, { requirePaymentMethod: false });
  const quote = await service.getBookingQuote(valid, 'guest');
  assert.equal(quote.startDate.toISOString().slice(0, 10), '2026-10-12');
  assert.equal(quote.endDate.toISOString().slice(0, 10), '2026-10-13');
  assert.equal(quote.startTime, '21:00');
  assert.equal(quote.endTime, '01:00');
  assert.equal(quote.pricing.unitsBooked, 2);
  assert.equal(quote.pricing.subtotal, 40);
  assert.equal(quote.pricing.totalAmount, 44);
  assert.deepEqual(localSchedule(quote, 'America/New_York').ranges.map(range => [range.startDate, range.startTime]), [['2026-10-12', '12:00'], ['2026-10-12', '15:00']]);
  assert.deepEqual(new Booking({ slots: quote.slots }).toObject().slots.map(slot => slot.sourceDate), ['2026-10-12', '2026-10-13']);
  // Same clock time on an unrelated day does not consume the selected slot.
  occupied = [{ startDate: new Date('2026-10-12'), slots: [{ sourceDate: '2026-10-12', startTime: '00:00', endTime: '01:00' }] }];
  await assert.doesNotReject(service.getBookingQuote(valid, 'guest'));
  occupied = [{ startDate: new Date('2026-10-12'), slots: [slots[0]] }];
  await assert.rejects(service.getBookingQuote(valid, 'guest'), error => error.statusCode === 409);
  occupied = [];
  await assert.rejects(service.getBookingQuote({ ...valid, slots: [{ ...slots[0], sourceDate: '2026-10-14' }] }, 'guest'), error => error.statusCode === 400);
});

test('slot grid blocks only slots booked on the requested source date', async t => {
  const Listing = require('../src/models/listing.model');
  const Booking = require('../src/models/booking.model');
  const { getAvailableSlotsForListing } = require('../src/modules/listings/listings.service');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
  t.mock.method(Listing, 'findOne', async () => ({ ...listing, availability: ['2026-10-12', '2026-10-13'].map(date => ({ date, startTime: '00:00', endTime: '01:00' })) }));
  t.mock.method(Booking, 'find', () => ({ select: async () => [{ startDate: new Date('2026-10-12'), slots: [{ sourceDate: '2026-10-12', startTime: '00:00', endTime: '01:00' }, { sourceDate: '2026-10-13', startTime: '21:00', endTime: '22:00' }] }] }));
  const result = await getAvailableSlotsForListing(listing._id, '2026-10-13');
  assert.equal(result.slots[0].available, true);
});

test('completion and expiry follow the final dated slot, including listing midnight', () => {
  const booking = { ...payload, listing, slots };
  assert.equal(bookingCompletionAt(booking).toISOString(), '2026-10-12T20:00:00.000Z');
  assert.equal(hasBookingRequestExpired(booking, listing, new Date('2026-10-12T19:30:00Z')), false);
  assert.equal(hasBookingRequestExpired(booking, listing, new Date('2026-10-12T20:00:00Z')), true);
  assert.throws(() => assertBookingNotPast(listing, booking, new Date('2026-10-12T19:30:00Z')), /in the past/);
});
