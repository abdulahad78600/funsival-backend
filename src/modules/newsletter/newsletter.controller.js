const asyncHandler = require('../../utils/async-handler');
const { subscribe, unsubscribe, listSubscribersForAdmin } = require('./newsletter.service');

const subscribeHandler = asyncHandler(async (req, res) => {
  const { subscriber, alreadySubscribed } = await subscribe(req.body);

  res.status(alreadySubscribed ? 200 : 201).json({
    success: true,
    message: alreadySubscribed
      ? 'You are already subscribed to our newsletter.'
      : 'Subscribed to the newsletter successfully.',
    data: { subscriber: { id: subscriber.id, email: subscriber.email } },
  });
});

const unsubscribeHandler = asyncHandler(async (req, res) => {
  const subscriber = await unsubscribe(req.body);

  res.status(200).json({
    success: true,
    message: 'Unsubscribed from the newsletter successfully.',
    data: { subscriber: { id: subscriber.id, email: subscriber.email } },
  });
});

const listAdminSubscribersHandler = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const { status, search } = req.query;

  const result = await listSubscribersForAdmin({ page, limit, status, search });

  res.status(200).json({
    success: true,
    message: 'Subscribers fetched successfully.',
    data: result,
  });
});

module.exports = {
  subscribeHandler,
  unsubscribeHandler,
  listAdminSubscribersHandler,
};
