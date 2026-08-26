const express = require('express');

const {
  authenticate,
  authenticateOptional,
  authorizeRoles,
} = require('../../middlewares/auth.middleware');
const { USER_ROLES } = require('../../constants/roles');
const listingsController = require('./listings.controller');
const draftListingsController = require('./draft-listings.controller');
const { upload, uploadImagesToSpacesHandler } = require('../../services/do-spaces.upload');

const router = express.Router();

// Draft routes (host only) — must be before /:listingId to avoid conflict
router.post('/draft', authenticate, draftListingsController.saveDraftHandler);
router.get('/draft', authenticate, draftListingsController.getDraftHandler);
router.delete('/draft', authenticate, draftListingsController.discardDraftHandler);
router.post(
  '/images',
  authenticate,
  upload.array('images', 10),
  uploadImagesToSpacesHandler
);
router.post(
  '/images/spaces',
  authenticate,
  upload.array('images', 10),
  uploadImagesToSpacesHandler
);

// Browse all hosts' listings (public)
router.get('/browse', authenticateOptional, listingsController.browseListingsHandler);
router.get(
  '/browse/:listingId/slots',
  listingsController.getListingSlotsHandler
);
router.get(
  '/browse/:listingId',
  authenticateOptional,
  listingsController.getPublicListingByIdHandler
);

// Host-owned listing management
router.get('/', authenticate, listingsController.getMyListingsHandler);
router.get(
  '/host/stats',
  authenticate,
  listingsController.getHostListingStatsHandler
);
router.get('/:listingId', authenticate, listingsController.getListingByIdHandler);

router.post('/', authenticate, listingsController.createListingHandler);
router.patch('/:listingId', authenticate, listingsController.updateListingHandler);
router.patch(
  '/:listingId/status',
  authenticate,
  listingsController.setListingStatusHandler
);
router.delete('/:listingId', authenticate, listingsController.deleteListingHandler);

// Admin: view every host's listings and listing details
const adminRouter = express.Router();
adminRouter.use(authenticate);
adminRouter.use(authorizeRoles(USER_ROLES.ADMIN));
adminRouter.get('/', listingsController.getAdminListingsHandler);
adminRouter.get('/stats', listingsController.getAdminListingStatsHandler);
adminRouter.get('/:listingId', listingsController.getAdminListingByIdHandler);

module.exports = router;
module.exports.adminRouter = adminRouter;
