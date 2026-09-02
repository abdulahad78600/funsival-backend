const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const refundsController = require('./refunds.controller');

const guestRouter = express.Router();

guestRouter.post(
  '/:bookingId/refund-request',
  authenticate,
  authorizeRoles(USER_ROLES.USER, USER_ROLES.HOST),
  refundsController.createRefundRequestHandler
);
guestRouter.get(
  '/:bookingId/refund-request',
  authenticate,
  authorizeRoles(USER_ROLES.USER, USER_ROLES.HOST),
  refundsController.getMyRefundRequestHandler
);
guestRouter.delete(
  '/:bookingId/refund-request',
  authenticate,
  authorizeRoles(USER_ROLES.USER, USER_ROLES.HOST),
  refundsController.withdrawRefundRequestHandler
);

const adminRouter = express.Router();
adminRouter.use(authenticate);
adminRouter.use(authorizeRoles(USER_ROLES.ADMIN));

adminRouter.get('/', refundsController.listRefundRequestsHandler);
adminRouter.get('/:requestId', refundsController.getRefundRequestHandler);
adminRouter.post('/:requestId/approve', refundsController.approveRefundRequestHandler);
adminRouter.post('/:requestId/reject', refundsController.rejectRefundRequestHandler);

module.exports = {
  guestRouter,
  adminRouter,
};
