const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const listingsController = require('./listings.controller');
const draftListingsController = require('./draft-listings.controller');
const { upload, uploadImagesToSpacesHandler } = require('../../services/do-spaces.upload');

const router = express.Router();

router.use(authenticate);

// Draft routes (host only) — must be before /:listingId to avoid conflict
router.post('/draft', draftListingsController.saveDraftHandler);
router.get('/draft', draftListingsController.getDraftHandler);
router.delete('/draft', draftListingsController.discardDraftHandler);
router.post('/images', upload.array('images', 10), uploadImagesToSpacesHandler);
router.post('/images/spaces', upload.array('images', 10), uploadImagesToSpacesHandler);

// Browse all hosts' listings (any authenticated user)
router.get('/browse', listingsController.browseListingsHandler);
router.get('/browse/:listingId', listingsController.getPublicListingByIdHandler);

// Both host and user can read listings
router.get('/', listingsController.getMyListingsHandler);
router.get('/:listingId', listingsController.getListingByIdHandler);

router.post('/', listingsController.createListingHandler);
router.patch('/:listingId', listingsController.updateListingHandler);
router.delete('/:listingId', listingsController.deleteListingHandler);

module.exports = router;
