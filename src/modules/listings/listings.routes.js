const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
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
router.get('/browse', listingsController.browseListingsHandler);
router.get('/browse/:listingId', listingsController.getPublicListingByIdHandler);

// Host-owned listing management
router.get('/', authenticate, listingsController.getMyListingsHandler);
router.get('/:listingId', authenticate, listingsController.getListingByIdHandler);

router.post('/', authenticate, listingsController.createListingHandler);
router.patch('/:listingId', authenticate, listingsController.updateListingHandler);
router.patch(
  '/:listingId/status',
  authenticate,
  listingsController.setListingStatusHandler
);
router.delete('/:listingId', authenticate, listingsController.deleteListingHandler);

module.exports = router;
