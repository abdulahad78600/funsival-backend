const express = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const listingsRoutes = require('../modules/listings/listings.routes');
const usersRoutes = require('../modules/users/users.routes');
const bookingsRoutes = require('../modules/bookings/bookings.routes');
const chatsRoutes = require('../modules/chats/chats.routes');
const notificationsRoutes = require('../modules/notifications/notifications.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/listings', listingsRoutes);
router.use('/users', usersRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/chats', chatsRoutes);
router.use('/notifications', notificationsRoutes);

module.exports = router;
