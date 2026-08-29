const express = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const listingsRoutes = require('../modules/listings/listings.routes');
const usersRoutes = require('../modules/users/users.routes');
const bookingsRoutes = require('../modules/bookings/bookings.routes');
const chatsRoutes = require('../modules/chats/chats.routes');
const notificationsRoutes = require('../modules/notifications/notifications.routes');
const paymentsRoutes = require('../modules/payments/payments.routes');
const cardsRoutes = require('../modules/cards/cards.routes');
const reviewsRoutes = require('../modules/reviews/reviews.routes');
const dashboardRoutes = require('../modules/dashboard/dashboard.routes');
const wishlistsRoutes = require('../modules/wishlists/wishlists.routes');
const { guestRouter: refundsGuestRouter, adminRouter: refundsAdminRouter } = require('../modules/refunds/refunds.routes');
const faqsRoutes = require('../modules/faqs/faqs.routes');
const newsletterRoutes = require('../modules/newsletter/newsletter.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/listings', listingsRoutes);
router.use('/users', usersRoutes);
router.use('/bookings', refundsGuestRouter);
router.use('/bookings', bookingsRoutes);
router.use('/chats', chatsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/payments/cards', cardsRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/wishlist', wishlistsRoutes);
router.use('/faqs', faqsRoutes);
router.use('/newsletter', newsletterRoutes);
router.use('/admin/refund-requests', refundsAdminRouter);
router.use('/admin/listings', listingsRoutes.adminRouter);
router.use('/admin/users', usersRoutes.adminRouter);
router.use('/admin/faqs', faqsRoutes.adminRouter);
router.use('/admin/newsletter', newsletterRoutes.adminRouter);

module.exports = router;
