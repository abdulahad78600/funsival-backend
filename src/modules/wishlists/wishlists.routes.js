const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const wishlistsController = require('./wishlists.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', wishlistsController.getWishlistHandler);
router.get('/summary', wishlistsController.getWishlistSummaryHandler);
router.post('/:listingId', wishlistsController.addToWishlistHandler);
router.post('/:listingId/toggle', wishlistsController.toggleWishlistHandler);
router.delete('/:listingId', wishlistsController.removeFromWishlistHandler);

module.exports = router;
