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

router.get(
  '/connect/balance',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.getMerchantBalanceHandler
);

router.get(
  '/connect/earnings',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.getEarningsGraphHandler
);

router.get(
  '/connect/earnings/overview',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.getEarningsOverviewHandler
);

router.get(
  '/connect/transactions',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.listTransactionsHandler
);

router.get(
  '/connect/withdrawals',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.listWithdrawalsHandler
);

router.post(
  '/connect/withdrawals',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  paymentsController.createWithdrawalHandler
);

router.post(
  '/bookings/:bookingId/pay',
  authenticate,
  authorizeRoles(USER_ROLES.USER, USER_ROLES.HOST),
  paymentsController.authorizeBookingPaymentHandler
);

router.post(
  '/bookings/:bookingId/refund',
  authenticate,
  authorizeRoles(USER_ROLES.ADMIN),
  paymentsController.refundBookingHandler
);

module.exports = router;
