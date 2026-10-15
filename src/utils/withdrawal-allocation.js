// Amounts are integer currency minor units. This is an accounting allocation
// of pooled funds, not a claim that Stripe earmarks bank payouts per booking.
function allocateWithdrawal(bookings, withdrawals, amountMinor) {
  const validAmount = (amount) => Number.isSafeInteger(amount) && amount >= 0;
  if (!validAmount(amountMinor)) throw new RangeError('Invalid withdrawal amount in minor units.');
  // Lean legacy records can lack merchantAmount. Their funds remain
  // unattributed; never let NaN propagate into every allocation and the total.
  const balances = bookings
    .filter((booking) => validAmount(booking.amountMinor) && booking.amountMinor > 0 && Number.isFinite(booking.availableAt))
    .map((booking) => ({ ...booking, remaining: booking.amountMinor }));
  const consume = (amount, availableAt = Infinity, allocations = null) => {
    let remaining = amount;
    for (const booking of balances) {
      if (booking.availableAt > availableAt || booking.remaining <= 0) continue;
      const used = Math.min(remaining, booking.remaining);
      if (used <= 0) break;
      booking.remaining -= used;
      remaining -= used;
      if (allocations) allocations.push({ bookingId: booking.id, amountMinor: used });
    }
    return remaining;
  };

  // Reserve explicit allocations first, including pending payouts. Failed and
  // canceled payouts release their allocation and are omitted by the caller.
  for (const withdrawal of withdrawals) {
    for (const allocation of withdrawal.allocations || []) {
      if (!validAmount(allocation.amountMinor)) throw new RangeError('Invalid recorded booking allocation.');
      const booking = balances.find((entry) => entry.id === allocation.bookingId);
      if (booking) booking.remaining -= allocation.amountMinor;
    }
  }
  // Older payouts have no recorded provenance. Conservatively account for
  // their spent balance without adding guessed booking IDs to their history.
  for (const withdrawal of withdrawals) {
    if (!withdrawal.tracked) {
      // Invalid debit history must not silently free already-withdrawn funds.
      if (!validAmount(withdrawal.amountMinor) || !Number.isFinite(withdrawal.createdAt)) {
        throw new RangeError('Invalid recorded withdrawal amount or date.');
      }
      consume(withdrawal.amountMinor, withdrawal.createdAt);
    }
  }

  const allocations = [];
  const unallocatedAmountMinor = consume(amountMinor, Infinity, allocations);
  return { allocations, unallocatedAmountMinor };
}

module.exports = { allocateWithdrawal };
