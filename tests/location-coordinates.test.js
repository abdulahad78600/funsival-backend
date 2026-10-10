const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocationCoordinates } = require('../src/utils/location-coordinates');
const { serializeListingRecord } = require('../src/modules/listings/listing-images');

test('exact stored coordinates are preserved, including zero and negative values', () => {
  assert.deepEqual(resolveLocationCoordinates({ latitude: -33.8688, longitude: 151.2093 }), { latitude: -33.8688, longitude: 151.2093 });
  assert.deepEqual(resolveLocationCoordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
});

test('legacy listings receive locally resolved city coordinates in API responses', () => {
  const record = { placeLocation: { country: 'Pakistan', state: 'Punjab', city: 'Lahore', addressLine1: 'Example address' } };
  const result = serializeListingRecord(record);
  assert.ok(result.placeLocation.latitude > 31 && result.placeLocation.latitude < 32);
  assert.ok(result.placeLocation.longitude > 74 && result.placeLocation.longitude < 75);
  assert.equal(result.placeLocation.addressLine1, record.placeLocation.addressLine1);
  assert.equal(record.placeLocation.latitude, undefined);
});

test('unknown locations are not assigned invented coordinates', () => {
  assert.equal(resolveLocationCoordinates({ country: 'Pakistan', city: 'Unknown city' }), null);
  assert.equal(resolveLocationCoordinates({ latitude: 100, longitude: 200 }), null);
  assert.equal(resolveLocationCoordinates({}), null);
  assert.equal(resolveLocationCoordinates(null), null);
  assert.equal(resolveLocationCoordinates({ latitude: ' ', longitude: ' ' }), null);
});
