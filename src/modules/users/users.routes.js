const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const { upload } = require('../../services/do-spaces.upload');
const {
  savePreferencesHandler,
  updateProviderProfileHandler,
  uploadProfilePictureHandler,
} = require('./users.controller');

const router = express.Router();

router.post('/preferences', authenticate, savePreferencesHandler);
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

module.exports = router;
