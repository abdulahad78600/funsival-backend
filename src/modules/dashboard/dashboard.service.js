const mongoose = require('mongoose');

const Booking = require('../../models/booking.model');
const Listing = require('../../models/listing.model');
const {
  BOOKING_STATUS,
  PAYMENT_STATUS,
} = require('../../constants/booking');

const EARNING_STATUSES = [
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.REFUNDING,
  PAYMENT_STATUS.RELEASING,
  PAYMENT_STATUS.RELEASED,
];

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(((Number(value) || 0) + Number.EPSILON) * factor) / factor;
}

function percentage(count, total) {
  return total > 0 ? round((count / total) * 100) : 0;
}

function percentageChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return round(((current - previous) / previous) * 100);
}

function getQuarterBoundaries(now = new Date()) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (Number.isNaN(current.getTime())) {
    throw new TypeError('A valid date is required to calculate quarter boundaries.');
  }

  const quarterMonth = Math.floor(current.getUTCMonth() / 3) * 3;
  const currentQuarterStart = new Date(
    Date.UTC(current.getUTCFullYear(), quarterMonth, 1)
  );
  return {
    previousQuarterStart: new Date(
      Date.UTC(current.getUTCFullYear(), quarterMonth - 3, 1)
    ),
    currentQuarterStart,
    nextQuarterStart: new Date(
      Date.UTC(current.getUTCFullYear(), quarterMonth + 3, 1)
    ),
  };
}

function mapRecentReservation(booking) {
  const listing = booking.listing;
  const customer = booking.bookedBy;
  const profile = customer && customer.providerProfile;
  const customerName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null
    : null;

  return {
    id: String(booking._id),
    status: booking.status,
    bookedAt: booking.createdAt,
    startDate: booking.startDate,
    endDate: booking.endDate,
    listing: listing
      ? {
          id: String(listing._id),
          title:
            listing.basicInformation && listing.basicInformation.activityTitle
              ? listing.basicInformation.activityTitle
              : null,
          category: listing.category || null,
          type: listing.type || null,
          image: Array.isArray(listing.photos) && listing.photos.length > 0
            ? listing.photos[0]
            : null,
        }
      : null,
    customer: customer
      ? {
          id: String(customer._id),
          name: customerName,
          email: customer.email,
        }
      : null,
  };
}

async function getHostDashboardOverview(
  hostUserId,
  { recentLimit = 5, currency = null } = {}
) {
  const hostId =
    hostUserId instanceof mongoose.Types.ObjectId
      ? hostUserId
      : new mongoose.Types.ObjectId(String(hostUserId));
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const {
    previousQuarterStart,
    currentQuarterStart,
    nextQuarterStart,
  } = getQuarterBoundaries(now);

  const earningsMatch = {
    host: hostId,
    paidAt: { $ne: null },
    paymentStatus: { $in: EARNING_STATUSES },
  };
  if (currency) earningsMatch.currency = currency;

  const [
    activeListings,
    activeListingsAddedThisMonth,
    reservationStatusRows,
    earningRows,
    recentBookings,
  ] = await Promise.all([
    Listing.countDocuments({ createdBy: hostId, isActive: true }),
    Listing.countDocuments({
      createdBy: hostId,
      isActive: true,
      createdAt: { $gte: monthStart, $lte: now },
    }),
    Booking.aggregate([
      { $match: { host: hostId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: earningsMatch },
      {
        $project: {
          currency: { $toUpper: { $ifNull: ['$currency', 'USD'] } },
          merchantAmount: { $ifNull: ['$merchantAmount', 0] },
          paidAt: 1,
        },
      },
      {
        $group: {
          _id: '$currency',
          total: { $sum: '$merchantAmount' },
          currentQuarter: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$paidAt', currentQuarterStart] },
                    { $lt: ['$paidAt', nextQuarterStart] },
                  ],
                },
                '$merchantAmount',
                0,
              ],
            },
          },
          previousQuarter: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$paidAt', previousQuarterStart] },
                    { $lt: ['$paidAt', currentQuarterStart] },
                  ],
                },
                '$merchantAmount',
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Booking.find({ host: hostId })
      .select('listing bookedBy status startDate endDate createdAt')
      .populate('listing', 'basicInformation.activityTitle category type photos')
      .populate('bookedBy', 'email providerProfile.firstName providerProfile.lastName')
      .sort({ createdAt: -1 })
      .limit(recentLimit)
      .lean(),
  ]);

  const statusCounts = new Map(
    reservationStatusRows.map((row) => [row._id, row.count])
  );
  const count = (status) => statusCounts.get(status) || 0;
  const pendingReservations =
    count(BOOKING_STATUS.PENDING) + count(BOOKING_STATUS.AWAITING_HOST_APPROVAL);
  const confirmedReservations = count(BOOKING_STATUS.CONFIRMED);
  const completedReservations = count(BOOKING_STATUS.COMPLETED);
  const cancelledReservations =
    count(BOOKING_STATUS.CANCELLED) + count(BOOKING_STATUS.DECLINED);
  const totalReservations = Array.from(statusCounts.values()).reduce(
    (total, statusCount) => total + statusCount,
    0
  );
  const openReservations = pendingReservations + confirmedReservations;
  const decidedReservations = completedReservations + cancelledReservations;
  const bookedReservations = confirmedReservations + completedReservations;

  const currencies = currency
    ? [currency]
    : earningRows.map((row) => row._id);
  const earningsByCurrency = new Map(earningRows.map((row) => [row._id, row]));
  const totalEarnings = currencies.map((currencyCode) => {
    const row = earningsByCurrency.get(currencyCode) || {
      total: 0,
      currentQuarter: 0,
      previousQuarter: 0,
    };
    return {
      currency: currencyCode,
      amount: round(row.total),
      currentQuarter: round(row.currentQuarter),
      previousQuarter: round(row.previousQuarter),
      quarterChangePercentage: percentageChange(
        row.currentQuarter,
        row.previousQuarter
      ),
    };
  });

  return {
    generatedAt: now.toISOString(),
    cards: {
      totalEarnings,
      activeListings: {
        total: activeListings,
        addedThisMonth: activeListingsAddedThisMonth,
      },
      reservations: {
        total: totalReservations,
        pending: pendingReservations,
      },
      completed: {
        total: completedReservations,
        successRate: percentage(completedReservations, decidedReservations),
      },
    },
    recentReservations: recentBookings.map(mapRecentReservation),
    listingPerformance: {
      total: totalReservations,
      completed: {
        count: completedReservations,
        percentage: percentage(completedReservations, totalReservations),
      },
      pending: {
        count: openReservations,
        percentage: percentage(openReservations, totalReservations),
      },
      cancelled: {
        count: cancelledReservations,
        percentage: percentage(cancelledReservations, totalReservations),
      },
    },
    utilization: {
      basis: 'all_reservations',
      booked: {
        count: bookedReservations,
        percentage: percentage(bookedReservations, totalReservations),
      },
      pending: {
        count: pendingReservations,
        percentage: percentage(pendingReservations, totalReservations),
      },
    },
  };
}

module.exports = {
  getHostDashboardOverview,
  _private: {
    percentage,
    percentageChange,
    getQuarterBoundaries,
  },
};
