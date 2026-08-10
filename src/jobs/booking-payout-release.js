const paymentsService = require('../modules/payments/payments.service');

const RUN_INTERVAL_MS = 60 * 1000;

async function runOnce() {
  return paymentsService.releaseEligibleBookingFunds({ limit: 50 });
}

function startBookingPayoutReleaseJob() {
  runOnce().catch((error) =>
    console.error('booking-payout-release initial run failed:', error)
  );

  const handle = setInterval(() => {
    runOnce().catch((error) =>
      console.error('booking-payout-release interval run failed:', error)
    );
  }, RUN_INTERVAL_MS);

  if (typeof handle.unref === 'function') {
    handle.unref();
  }

  return handle;
}

module.exports = {
  startBookingPayoutReleaseJob,
  releaseEligibleBookingFunds: runOnce,
};
