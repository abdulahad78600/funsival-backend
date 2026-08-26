const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const reviewsController = require('./reviews.controller');

const router = express.Router();

router.get('/listings/:listingId', reviewsController.listListingReviewsHandler);
router.get('/hosts/:hostId', reviewsController.listHostReviewsHandler);

router.get(
  '/bookings/:bookingId/me',
  authenticate,
  authorizeRoles(USER_ROLES.USER),
  reviewsController.getMyBookingReviewHandler
);

router.post(
  '/bookings/:bookingId',
  authenticate,
  authorizeRoles(USER_ROLES.USER),
  reviewsController.submitBookingReviewHandler
);

router.delete(
  '/bookings/:bookingId',
  authenticate,
  authorizeRoles(USER_ROLES.USER),
  reviewsController.deleteBookingReviewHandler
);

module.exports = router;
