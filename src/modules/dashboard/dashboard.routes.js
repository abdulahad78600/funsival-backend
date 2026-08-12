const express = require('express');

const { authenticate, authorizeRoles } = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const { getHostDashboardOverviewHandler } = require('./dashboard.controller');

const router = express.Router();

router.get(
  '/host/overview',
  authenticate,
  authorizeRoles(USER_ROLES.HOST),
  getHostDashboardOverviewHandler
);

module.exports = router;
