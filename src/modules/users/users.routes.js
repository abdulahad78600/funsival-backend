const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const { upload } = require('../../services/do-spaces.upload');
const {
  savePreferencesHandler,
  dismissUserOnboardingHandler,
  updateProviderProfileHandler,
  becomeProviderHandler,
  becomeUserHandler,
  updateUserProfileHandler,
  uploadProfilePictureHandler,
  listAdminUsersHandler,
  getAdminUserHandler,
  updateAdminUserHandler,
  deleteAdminUserHandler,
} = require('./users.controller');

const router = express.Router();

router.post('/preferences', authenticate, savePreferencesHandler);
router.post('/preferences/dismiss', authenticate, dismissUserOnboardingHandler);
router.patch(
  '/profile',
  authenticate,
  authorizeRoles(USER_ROLES.USER, USER_ROLES.HOST),
  updateUserProfileHandler
);
router.patch(
  '/provider-profile',
  authenticate,
  updateProviderProfileHandler
);
router.post(
  '/become-provider',
  authenticate,
  becomeProviderHandler
);
router.post(
  '/become-user',
  authenticate,
  becomeUserHandler
);
router.post(
  '/profile-picture',
  authenticate,
  upload.single('image'),
  uploadProfilePictureHandler
);

// Admin: list / view / edit / delete platform users
const adminRouter = express.Router();
adminRouter.use(authenticate);
adminRouter.use(authorizeRoles(USER_ROLES.ADMIN));
adminRouter.get('/', listAdminUsersHandler);
adminRouter.get('/:userId', getAdminUserHandler);
adminRouter.patch('/:userId', updateAdminUserHandler);
adminRouter.delete('/:userId', deleteAdminUserHandler);

module.exports = router;
module.exports.adminRouter = adminRouter;
