// Recalculate existing test bookings without initiating transfers or payouts.
// Dry run by default; --apply persists deadlines after Stripe confirms test mode.
const mongoose = require('mongoose');
const env = require('../src/config/env');
const stripe = require('../src/services/stripe.client');
const Booking = require('../src/models/booking.model');
const { _private } = require('../src/modules/payments/payments.service');

async function main() {
  if (!/^sk_test_/.test(env.stripe.secretKey || '')) throw new Error('TEST_KEY_REQUIRED');
  if (env.stripe.payoutDelayDays !== 1) throw new Error('ONE_DAY_CONFIGURATION_REQUIRED');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const bookings = await Booking.find({ paymentFlow: 'platform_hold', paymentStatus: 'held',
    status: { $in: ['confirmed', 'completed'] }, activeRefundRequest: null,
    stripePaymentIntentId: { $ne: null },
  }).populate('listing', 'timeZone placeLocation').limit(100);
  let updated = 0;
  let skipped = 0;
  for (const booking of bookings) {
    const intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    if (intent.livemode !== false || intent.status !== 'succeeded') { skipped++; continue; }
    const completedAt = _private.calculateBookingCompletionAt(booking);
    const eligibleAt = _private.calculatePayoutEligibleAt(completedAt, 1);
    if (booking.payoutEligibleAt?.getTime() === eligibleAt.getTime()) continue;
    if (apply) {
      const result = await Booking.updateOne({ _id: booking._id, paymentStatus: 'held', activeRefundRequest: null,
        payoutEligibleAt: booking.payoutEligibleAt,
      }, { $set: { payoutEligibleAt: eligibleAt } });
      updated += result.modifiedCount;
    } else updated++;
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry_run', inspected: bookings.length, updated, skipped }));
}

main().catch(error => {
  // Do not print connection strings, credentials, or payment details.
  console.error(`Test hold update failed: ${error.code || error.name}`);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
