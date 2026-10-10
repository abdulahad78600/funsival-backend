const test = require('node:test');
const assert = require('node:assert/strict');
const { validateListingPayload } = require('../src/modules/listings/listings.validation');

function payload(date) {
  return {
    category: 'equipment', type: 'kayak', timeZone: 'Asia/Karachi',
    basicInformation: { activityTitle: 'Kayak', location: 'Lahore', description: 'Kayak rental' },
    serviceDetails: { cancellationPolicy: 'Flexible', brand: 'Test', model: 'Test' },
    placeLocation: { addressLine1: 'Test street', city: 'Lahore', country: 'Pakistan' },
    price: { hourly: 20 }, photos: ['https://example.com/kayak.jpg'],
    availability: [{ date, startTime: '10:00', endTime: '11:00' }],
  };
}

test('new listings reject yesterday during the Pakistan morning while UTC is still yesterday', () => {
  const options = { rejectPastAvailability: true, now: new Date('2026-10-09T23:49:00Z') };
  assert.throws(() => validateListingPayload(payload('2026-10-09'), options), error => {
    assert.equal(error.statusCode, 400);
    return JSON.stringify(error).includes('already passed');
  });
  assert.equal(validateListingPayload(payload('2026-10-10'), options).availability[0].date.toISOString().slice(0, 10), '2026-10-10');
  assert.doesNotThrow(() => validateListingPayload(payload('2026-10-11'), options));
});

test('past dates become invalid immediately at listing-local midnight', () => {
  assert.doesNotThrow(() => validateListingPayload(payload('2026-10-10'), {
    rejectPastAvailability: true, now: new Date('2026-10-10T18:59:59Z'),
  }));
  assert.throws(() => validateListingPayload(payload('2026-10-10'), {
    rejectPastAvailability: true, now: new Date('2026-10-10T19:00:00Z'),
  }));
});
