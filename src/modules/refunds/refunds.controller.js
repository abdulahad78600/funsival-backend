const asyncHandler = require('../../utils/async-handler');
const refundsService = require('./refunds.service');
const {
  validateObjectId,
  validateCreateRefundRequestPayload,
  validateDecisionPayload,
  validateListQuery,
} = require('./refunds.validation');

const createRefundRequestHandler = asyncHandler(async (req, res) => {
  const bookingId = validateObjectId(req.params.bookingId, 'booking ID');
  const payload = validateCreateRefundRequestPayload(req.body);
  const refundRequest = await refundsService.createRefundRequest(
    bookingId,
    req.user._id,
    payload
  );

  res.status(201).json({
    success: true,
    message: 'Refund request submitted. An admin will review it shortly.',
    data: { refundRequest },
  });
});

const getMyRefundRequestHandler = asyncHandler(async (req, res) => {
  const bookingId = validateObjectId(req.params.bookingId, 'booking ID');
  const refundRequest = await refundsService.getRefundRequestForGuest(
    bookingId,
    req.user._id
  );

  res.status(200).json({
    success: true,
    message: 'Refund request fetched successfully.',
    data: { refundRequest },
  });
});

const withdrawRefundRequestHandler = asyncHandler(async (req, res) => {
  const bookingId = validateObjectId(req.params.bookingId, 'booking ID');
  const refundRequest = await refundsService.withdrawRefundRequest(
    bookingId,
    req.user._id
  );

  res.status(200).json({
    success: true,
    message: 'Refund request withdrawn.',
    data: { refundRequest },
  });
});

const listRefundRequestsHandler = asyncHandler(async (req, res) => {
  const query = validateListQuery(req.query);
  const result = await refundsService.listRefundRequestsForAdmin(query);

  res.status(200).json({
    success: true,
    message: 'Refund requests fetched successfully.',
    data: result,
  });
});

const getRefundRequestHandler = asyncHandler(async (req, res) => {
  const refundRequestId = validateObjectId(req.params.requestId, 'refund request ID');
  const refundRequest = await refundsService.getRefundRequestForAdmin(refundRequestId);

  res.status(200).json({
    success: true,
    message: 'Refund request fetched successfully.',
    data: { refundRequest },
  });
});

const approveRefundRequestHandler = asyncHandler(async (req, res) => {
  const refundRequestId = validateObjectId(req.params.requestId, 'refund request ID');
  const payload = validateDecisionPayload(req.body);
  const refundRequest = await refundsService.approveRefundRequest(
    refundRequestId,
    req.user._id,
    payload
  );

  res.status(200).json({
    success: true,
    message: 'Refund approved and processed.',
    data: { refundRequest },
  });
});

const rejectRefundRequestHandler = asyncHandler(async (req, res) => {
  const refundRequestId = validateObjectId(req.params.requestId, 'refund request ID');
  const payload = validateDecisionPayload(req.body, { requireNote: true });
  const refundRequest = await refundsService.rejectRefundRequest(
    refundRequestId,
    req.user._id,
    payload
  );

  res.status(200).json({
    success: true,
    message: 'Refund request rejected.',
    data: { refundRequest },
  });
});

module.exports = {
  createRefundRequestHandler,
  getMyRefundRequestHandler,
  withdrawRefundRequestHandler,
  listRefundRequestsHandler,
  getRefundRequestHandler,
  approveRefundRequestHandler,
  rejectRefundRequestHandler,
};
