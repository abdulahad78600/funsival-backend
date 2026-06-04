const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const paymentsController = require('./payments.controller');

const router = express.Router();

router.post(
  '/connect/onboard',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.startOnboardingHandler
);

router.get(
  '/connect/status',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.getConnectStatusHandler
);

router.post(
  '/connect/login-link',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.createLoginLinkHandler
);

router.post(
  '/bookings/:bookingId/checkout',
  authenticate,
  authorizeRoles(USER_ROLES.USER),
  paymentsController.createCheckoutSessionHandler
);

router.post(
  '/bookings/:bookingId/refund',
  authenticate,
  authorizeRoles(USER_ROLES.ADMIN),
  paymentsController.refundBookingHandler
);

module.exports = router;
