const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const listingsController = require('./listings.controller');
const draftListingsController = require('./draft-listings.controller');
const { uploadListingImages } = require('./listing-images');

const router = express.Router();

router.use(authenticate);

// Draft routes (host only) — must be before /:listingId to avoid conflict
router.post('/draft', draftListingsController.saveDraftHandler);
router.get('/draft', draftListingsController.getDraftHandler);
router.delete('/draft', draftListingsController.discardDraftHandler);
router.post('/images', uploadListingImages, listingsController.uploadListingImagesHandler);

// Both host and user can read listings
router.get('/', listingsController.getMyListingsHandler);
router.get('/:listingId', listingsController.getListingByIdHandler);

router.post('/', listingsController.createListingHandler);
router.patch('/:listingId', listingsController.updateListingHandler);
router.delete('/:listingId', listingsController.deleteListingHandler);

module.exports = router;
