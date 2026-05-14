const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const notificationsController = require('./notifications.controller');

const router = express.Router();

router.use(authenticate);

router.post('/device-tokens', notificationsController.registerDeviceTokenHandler);
router.delete('/device-tokens/:token', notificationsController.unregisterDeviceTokenHandler);

router.get('/', notificationsController.listNotificationsHandler);
router.get('/unread-count', notificationsController.getUnreadCountHandler);
router.patch('/read-all', notificationsController.markAllReadHandler);
router.patch('/:notificationId/read', notificationsController.markNotificationReadHandler);
router.delete('/:notificationId', notificationsController.deleteNotificationHandler);

module.exports = router;
