const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const newsletterController = require('./newsletter.controller');

// Public: landing page "Keep in Touch" form
const router = express.Router();
router.post('/subscribe', newsletterController.subscribeHandler);
router.post('/unsubscribe', newsletterController.unsubscribeHandler);

// Admin: subscriber list
const adminRouter = express.Router();
adminRouter.use(authenticate);
adminRouter.use(authorizeRoles(USER_ROLES.ADMIN));
adminRouter.get('/subscribers', newsletterController.listAdminSubscribersHandler);

module.exports = router;
module.exports.adminRouter = adminRouter;
