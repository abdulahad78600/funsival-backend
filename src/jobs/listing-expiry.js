const listingsService = require('../modules/listings/listings.service');

const RUN_INTERVAL_MS = 15 * 60 * 1000;

async function runOnce() {
  return listingsService.deactivateExpiredListings({ limit: 200 });
}

function startListingExpiryJob() {
  runOnce().catch((error) =>
    console.error('listing-expiry initial run failed:', error)
  );

  const handle = setInterval(() => {
    runOnce().catch((error) =>
      console.error('listing-expiry interval run failed:', error)
    );
  }, RUN_INTERVAL_MS);

  if (typeof handle.unref === 'function') {
    handle.unref();
  }

  return handle;
}

module.exports = {
  startListingExpiryJob,
  deactivateExpiredListings: runOnce,
};
