const Listing = require('../models/listing.model');
const { resolveListingTimeZone } = require('../utils/booking-clock');

// Run before accepting requests: old listings need the same persisted zone
// that MongoDB uses for public availability queries and expiry.
async function backfillListingTimeZones() {
  const cursor = Listing.find({ $or: [{ timeZone: { $exists: false } }, { timeZone: null }, { timeZone: '' }] })
    .select('_id placeLocation').lean().cursor();
  let operations = [];
  let unresolved = 0;
  for await (const listing of cursor) {
    const timeZone = resolveListingTimeZone(listing);
    if (timeZone === 'UTC') unresolved += 1;
    operations.push({ updateOne: {
      filter: { _id: listing._id, $or: [{ timeZone: { $exists: false } }, { timeZone: null }, { timeZone: '' }] },
      update: { $set: { timeZone } },
    } });
    if (operations.length >= 200) {
      await Listing.bulkWrite(operations);
      operations = [];
    }
  }
  if (operations.length) await Listing.bulkWrite(operations);
  if (unresolved) console.warn(`${unresolved} listings lack a resolvable location time zone and retain UTC; set their timeZone explicitly.`);
}

module.exports = { backfillListingTimeZones };
