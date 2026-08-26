const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const { upload } = require('../../services/do-spaces.upload');
const {
  savePreferencesHandler,
  updateProviderProfileHandler,
  updateUserProfileHandler,
  uploadProfilePictureHandler,
  listAdminUsersHandler,
  getAdminUserHandler,
} = require('./users.controller');

const router = express.Router();

router.post('/preferences', authenticate, savePreferencesHandler);
router.patch(
  '/profile',
  authenticate,
  authorizeRoles(USER_ROLES.USER),
  updateUserProfileHandler
);
router.patch(
  '/provider-profile',
  authenticate,
  updateProviderProfileHandler
);
router.post(
  '/profile-picture',
  authenticate,
  upload.single('image'),
  uploadProfilePictureHandler
);

// Admin: every user on the platform with their details
const adminRouter = express.Router();
adminRouter.use(authenticate);
adminRouter.use(authorizeRoles(USER_ROLES.ADMIN));
adminRouter.get('/', listAdminUsersHandler);
adminRouter.get('/:userId', getAdminUserHandler);

module.exports = router;
module.exports.adminRouter = adminRouter;
