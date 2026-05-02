const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const { savePreferencesHandler, updateProviderProfileHandler } = require('./users.controller');

const router = express.Router();

router.post('/preferences', authenticate, savePreferencesHandler);
router.patch(
  '/provider-profile',
  authenticate,
  updateProviderProfileHandler
);

module.exports = router;
