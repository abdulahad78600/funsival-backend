const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const cardsService = require('./cards.service');

function requirePaymentMethodId(paymentMethodId) {
  if (typeof paymentMethodId !== 'string' || !paymentMethodId.startsWith('pm_')) {
    throw new ApiError(400, 'Invalid payment method ID.');
  }
  return paymentMethodId;
}

const createSetupIntentHandler = asyncHandler(async (req, res) => {
  const result = await cardsService.createSetupIntent(req.user._id);
  res.status(201).json({
    success: true,
    message: 'Setup intent created. Confirm it on the client to attach the card.',
    data: result,
  });
});

const listCardsHandler = asyncHandler(async (req, res) => {
  const result = await cardsService.listCards(req.user._id);
  res.status(200).json({
    success: true,
    message: 'Cards fetched successfully.',
    data: result,
  });
});

const setDefaultCardHandler = asyncHandler(async (req, res) => {
  const paymentMethodId = requirePaymentMethodId(req.params.paymentMethodId);
  const result = await cardsService.setDefaultCard(req.user._id, paymentMethodId);
  res.status(200).json({
    success: true,
    message: 'Default card updated.',
    data: result,
  });
});

const deleteCardHandler = asyncHandler(async (req, res) => {
  const paymentMethodId = requirePaymentMethodId(req.params.paymentMethodId);
  const result = await cardsService.deleteCard(req.user._id, paymentMethodId);
  res.status(200).json({
    success: true,
    message: 'Card removed.',
    data: result,
  });
});

module.exports = {
  createSetupIntentHandler,
  listCardsHandler,
  setDefaultCardHandler,
  deleteCardHandler,
};
