const asyncHandler = require('../../utils/async-handler');
const wishlistsService = require('./wishlists.service');

const getWishlistHandler = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 12));

  const result = await wishlistsService.getWishlist(req.user.id, { page, limit });

  res.status(200).json({
    success: true,
    message: 'Wishlist fetched successfully.',
    data: result,
  });
});

const getWishlistSummaryHandler = asyncHandler(async (req, res) => {
  const result = await wishlistsService.getWishlistSummary(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Wishlist summary fetched successfully.',
    data: result,
  });
});

const addToWishlistHandler = asyncHandler(async (req, res) => {
  const result = await wishlistsService.addToWishlist(req.user.id, req.params.listingId);

  res.status(result.added ? 201 : 200).json({
    success: true,
    message: result.added ? 'Added to wishlist.' : 'Listing is already in your wishlist.',
    data: result,
  });
});

const removeFromWishlistHandler = asyncHandler(async (req, res) => {
  const result = await wishlistsService.removeFromWishlist(req.user.id, req.params.listingId);

  res.status(200).json({
    success: true,
    message: result.removed ? 'Removed from wishlist.' : 'Listing was not in your wishlist.',
    data: result,
  });
});

const toggleWishlistHandler = asyncHandler(async (req, res) => {
  const result = await wishlistsService.toggleWishlist(req.user.id, req.params.listingId);

  res.status(200).json({
    success: true,
    message: result.isWishlisted ? 'Added to wishlist.' : 'Removed from wishlist.',
    data: result,
  });
});

module.exports = {
  getWishlistHandler,
  getWishlistSummaryHandler,
  addToWishlistHandler,
  removeFromWishlistHandler,
  toggleWishlistHandler,
};
