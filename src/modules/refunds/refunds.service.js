const Booking = require('../../models/booking.model');
const RefundRequest = require('../../models/refund-request.model');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const {
  PAYMENT_STATUS,
  REFUND_REQUEST_STATUS,
} = require('../../constants/booking');
const { USER_ROLES } = require('../../constants/roles');
const paymentsService = require('../payments/payments.service');
const { sendNotification } = require('../notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../notifications/notifications.validation');

function isHoldWindowOpen(booking) {
  return Boolean(
    booking.payoutEligibleAt && booking.payoutEligibleAt.getTime() > Date.now()
  );
}

async function notifyAdminsOfNewRequest(refundRequest, booking) {
  const admins = await User.find({ role: USER_ROLES.ADMIN }).select('_id');
  await Promise.allSettled(
    admins.map((admin) =>
      sendNotification(admin._id, {
        type: NOTIFICATION_TYPES.REFUND_REQUESTED,
        title: 'New refund request',
        body: `A guest has requested a refund for booking #${booking._id}.`,
        data: {
          refundRequestId: refundRequest._id.toString(),
          bookingId: booking._id.toString(),
        },
      })
    )
  );
}

async function createRefundRequest(bookingId, guestId, { reason }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }

  if (booking.bookedBy.toString() !== guestId.toString()) {
    throw new ApiError(403, 'You can only request a refund for your own bookings.');
  }

  if (booking.paymentStatus !== PAYMENT_STATUS.HELD) {
    throw new ApiError(
      400,
      'Refunds can only be requested for paid bookings inside the 7-day hold window.'
    );
  }

  if (!isHoldWindowOpen(booking)) {
    throw new ApiError(
      400,
      'The 7-day refund window has passed. Funds have already been released to the provider.'
    );
  }

  const existing = await RefundRequest.findOne({
    booking: booking._id,
    status: REFUND_REQUEST_STATUS.PENDING,
  });
  if (existing) {
    throw new ApiError(409, 'A refund request for this booking is already pending review.');
  }

  const refundRequest = await RefundRequest.create({
    booking: booking._id,
    requestedBy: guestId,
    host: booking.host,
    amount: booking.totalAmount,
    currency: booking.currency,
    reason,
    payoutEligibleAt: booking.payoutEligibleAt,
  });

  booking.activeRefundRequest = refundRequest._id;
  await booking.save();

  notifyAdminsOfNewRequest(refundRequest, booking).catch((error) =>
    console.error('Failed to notify admins of new refund request.', error)
  );

  return refundRequest.toJSON();
}

async function getRefundRequestForGuest(bookingId, guestId) {
  const booking = await Booking.findById(bookingId).select('bookedBy');
  if (!booking) {
    throw new ApiError(404, 'Booking not found.');
  }
  if (booking.bookedBy.toString() !== guestId.toString()) {
    throw new ApiError(403, 'You are not allowed to view this refund request.');
  }
  const refundRequest = await RefundRequest.findOne({ booking: bookingId }).sort({
    createdAt: -1,
  });
  return refundRequest ? refundRequest.toJSON() : null;
}

async function withdrawRefundRequest(bookingId, guestId) {
  const refundRequest = await RefundRequest.findOne({
    booking: bookingId,
    status: REFUND_REQUEST_STATUS.PENDING,
  });
  if (!refundRequest) {
    throw new ApiError(404, 'No pending refund request to withdraw.');
  }
  if (refundRequest.requestedBy.toString() !== guestId.toString()) {
    throw new ApiError(403, 'You can only withdraw your own refund request.');
  }

  refundRequest.status = REFUND_REQUEST_STATUS.WITHDRAWN;
  refundRequest.decidedAt = new Date();
  await refundRequest.save();

  await Booking.updateOne(
    { _id: bookingId, activeRefundRequest: refundRequest._id },
    { $set: { activeRefundRequest: null } }
  );

  return refundRequest.toJSON();
}

async function listRefundRequestsForAdmin({ page, limit, status }) {
  const filter = {};
  if (status) filter.status = status;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    RefundRequest.find(filter)
      .populate('booking')
      .populate('requestedBy', 'email role agencyName city providerProfile')
      .populate('host', 'email role agencyName city providerProfile')
      .populate('decidedBy', 'email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    RefundRequest.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);
  return {
    refundRequests: items.map((item) => item.toJSON()),
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

async function getRefundRequestForAdmin(refundRequestId) {
  const refundRequest = await RefundRequest.findById(refundRequestId)
    .populate('booking')
    .populate('requestedBy', 'email role agencyName city providerProfile')
    .populate('host', 'email role agencyName city providerProfile')
    .populate('decidedBy', 'email role');
  if (!refundRequest) {
    throw new ApiError(404, 'Refund request not found.');
  }
  return refundRequest.toJSON();
}

async function approveRefundRequest(refundRequestId, adminUserId, { note } = {}) {
  const refundRequest = await RefundRequest.findById(refundRequestId);
  if (!refundRequest) {
    throw new ApiError(404, 'Refund request not found.');
  }
  if (refundRequest.status !== REFUND_REQUEST_STATUS.PENDING) {
    throw new ApiError(
      400,
      `This refund request has already been ${refundRequest.status}.`
    );
  }

  const booking = await Booking.findById(refundRequest.booking);
  if (!booking) {
    throw new ApiError(404, 'Associated booking not found.');
  }

  if (!isHoldWindowOpen(booking)) {
    refundRequest.status = REFUND_REQUEST_STATUS.EXPIRED;
    refundRequest.decidedBy = adminUserId;
    refundRequest.decidedAt = new Date();
    refundRequest.decisionNote =
      'Hold window expired before approval — funds have been released.';
    await refundRequest.save();
    await Booking.updateOne(
      { _id: booking._id, activeRefundRequest: refundRequest._id },
      { $set: { activeRefundRequest: null } }
    );
    throw new ApiError(
      400,
      'The 7-day hold window has passed. Funds have already been released to the provider and can no longer be refunded automatically.'
    );
  }

  const { refund } = await paymentsService.executeStripeRefund(
    booking,
    adminUserId,
    'requested_by_customer'
  );

  refundRequest.status = REFUND_REQUEST_STATUS.APPROVED;
  refundRequest.decidedBy = adminUserId;
  refundRequest.decidedAt = new Date();
  refundRequest.decisionNote = note || null;
  refundRequest.stripeRefundId = refund.id;
  await refundRequest.save();

  await Booking.updateOne(
    { _id: booking._id, activeRefundRequest: refundRequest._id },
    { $set: { activeRefundRequest: null } }
  );

  sendNotification(refundRequest.requestedBy, {
    type: NOTIFICATION_TYPES.REFUND_APPROVED,
    title: 'Your refund has been approved',
    body: 'A refund has been issued. It may take 5-10 days to appear on your card.',
    data: {
      bookingId: booking._id.toString(),
      refundRequestId: refundRequest._id.toString(),
    },
  }).catch((error) => console.error('Failed to notify guest of approved refund.', error));

  sendNotification(refundRequest.host, {
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: 'Booking refunded',
    body: 'A refund request from a guest has been approved by Funsival support.',
    data: {
      bookingId: booking._id.toString(),
      refundRequestId: refundRequest._id.toString(),
    },
  }).catch((error) => console.error('Failed to notify host of approved refund.', error));

  return refundRequest.toJSON();
}

async function rejectRefundRequest(refundRequestId, adminUserId, { note } = {}) {
  const refundRequest = await RefundRequest.findById(refundRequestId);
  if (!refundRequest) {
    throw new ApiError(404, 'Refund request not found.');
  }
  if (refundRequest.status !== REFUND_REQUEST_STATUS.PENDING) {
    throw new ApiError(
      400,
      `This refund request has already been ${refundRequest.status}.`
    );
  }

  refundRequest.status = REFUND_REQUEST_STATUS.REJECTED;
  refundRequest.decidedBy = adminUserId;
  refundRequest.decidedAt = new Date();
  refundRequest.decisionNote = note || null;
  await refundRequest.save();

  await Booking.updateOne(
    { _id: refundRequest.booking, activeRefundRequest: refundRequest._id },
    { $set: { activeRefundRequest: null } }
  );

  sendNotification(refundRequest.requestedBy, {
    type: NOTIFICATION_TYPES.REFUND_REJECTED,
    title: 'Your refund request was declined',
    body: note
      ? `Reason: ${note}`
      : 'Your refund request was reviewed and could not be approved.',
    data: {
      bookingId: refundRequest.booking.toString(),
      refundRequestId: refundRequest._id.toString(),
    },
  }).catch((error) => console.error('Failed to notify guest of rejected refund.', error));

  return refundRequest.toJSON();
}

module.exports = {
  createRefundRequest,
  getRefundRequestForGuest,
  withdrawRefundRequest,
  listRefundRequestsForAdmin,
  getRefundRequestForAdmin,
  approveRefundRequest,
  rejectRefundRequest,
};
