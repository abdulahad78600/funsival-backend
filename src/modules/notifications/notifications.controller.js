const asyncHandler = require('../../utils/async-handler');
const {
  validateRegisterDeviceTokenPayload,
  validateDeviceToken,
  validateNotificationId,
} = require('./notifications.validation');
const {
  registerDeviceToken,
  unregisterDeviceToken,
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = require('./notifications.service');

function parsePaginationQuery(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === true;
  return { page, limit, unreadOnly };
}

const registerDeviceTokenHandler = asyncHandler(async (req, res) => {
  const payload = validateRegisterDeviceTokenPayload(req.body);
  const result = await registerDeviceToken(req.user.id, payload);

  res.status(200).json({
    success: true,
    message: 'Device token registered.',
    data: result,
  });
});

const unregisterDeviceTokenHandler = asyncHandler(async (req, res) => {
  const token = validateDeviceToken(req.params.token);
  await unregisterDeviceToken(req.user.id, token);

  res.status(200).json({
    success: true,
    message: 'Device token unregistered.',
  });
});

const listNotificationsHandler = asyncHandler(async (req, res) => {
  const params = parsePaginationQuery(req.query);
  const result = await listNotifications(req.user.id, params);

  res.status(200).json({
    success: true,
    message: 'Notifications fetched successfully.',
    data: result,
  });
});

const getUnreadCountHandler = asyncHandler(async (req, res) => {
  const result = await getUnreadCount(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Unread count fetched.',
    data: result,
  });
});

const markNotificationReadHandler = asyncHandler(async (req, res) => {
  const notificationId = validateNotificationId(req.params.notificationId);
  const notification = await markNotificationRead(req.user.id, notificationId);

  res.status(200).json({
    success: true,
    message: 'Notification marked as read.',
    data: { notification },
  });
});

const markAllReadHandler = asyncHandler(async (req, res) => {
  const result = await markAllNotificationsRead(req.user.id);

  res.status(200).json({
    success: true,
    message: 'All notifications marked as read.',
    data: result,
  });
});

const deleteNotificationHandler = asyncHandler(async (req, res) => {
  const notificationId = validateNotificationId(req.params.notificationId);
  await deleteNotification(req.user.id, notificationId);

  res.status(200).json({
    success: true,
    message: 'Notification deleted.',
  });
});

module.exports = {
  registerDeviceTokenHandler,
  unregisterDeviceTokenHandler,
  listNotificationsHandler,
  getUnreadCountHandler,
  markNotificationReadHandler,
  markAllReadHandler,
  deleteNotificationHandler,
};
