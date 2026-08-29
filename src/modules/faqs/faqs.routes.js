const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const faqsController = require('./faqs.controller');

// Public: landing page FAQ section
const router = express.Router();
router.get('/', faqsController.listPublicFaqsHandler);

// Admin: manage FAQs
const adminRouter = express.Router();
adminRouter.use(authenticate);
adminRouter.use(authorizeRoles(USER_ROLES.ADMIN));
adminRouter.get('/', faqsController.listAdminFaqsHandler);
adminRouter.post('/', faqsController.createFaqHandler);
adminRouter.patch('/:faqId', faqsController.updateFaqHandler);
adminRouter.delete('/:faqId', faqsController.deleteFaqHandler);

module.exports = router;
module.exports.adminRouter = adminRouter;
