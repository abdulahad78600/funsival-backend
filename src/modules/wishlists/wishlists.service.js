const mongoose = require('mongoose');

const Wishlist = require('../../models/wishlist.model');
const Listing = require('../../models/listing.model');
const ApiError = require('../../utils/api-error');
const { serializeListingRecord } = require('../listings/listing-images');
const { attachReviewSummariesToListings } = require('../listings/listings.service');

const LISTING_HOST_FIELDS = 'email role agencyName city providerProfile';

function toObjectId(value, label) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

async function ensureListingExists(listingId) {
  const exists = await Listing.exists({ _id: listingId });
  if (!exists) {
    throw new ApiError(404, 'Listing not found.');
  }
}

async function addToWishlist(userId, listingIdInput) {
  const user = toObjectId(userId, 'user ID');
  const listing = toObjectId(listingIdInput, 'listing ID');
  await ensureListingExists(listing);

  const result = await Wishlist.updateOne(
    { user, listing },
    { $setOnInsert: { user, listing, createdAt: new Date() } },
    { upsert: true }
  );

  return {
    listingId: listing.toString(),
    isWishlisted: true,
    added: Boolean(result.upsertedCount),
  };
}

async function removeFromWishlist(userId, listingIdInput) {
  const user = toObjectId(userId, 'user ID');
  const listing = toObjectId(listingIdInput, 'listing ID');

  const result = await Wishlist.deleteOne({ user, listing });

  return {
    listingId: listing.toString(),
    isWishlisted: false,
    removed: Boolean(result.deletedCount),
  };
}

async function toggleWishlist(userId, listingIdInput) {
  const user = toObjectId(userId, 'user ID');
  const listing = toObjectId(listingIdInput, 'listing ID');

  const existing = await Wishlist.findOne({ user, listing }).select('_id');
  if (existing) {
    return removeFromWishlist(user, listing);
  }
  return addToWishlist(user, listing);
}

async function getWishlistedListingIds(userId, listingIds = null) {
  if (!userId) return new Set();
  const user = toObjectId(userId, 'user ID');

  const filter = { user };
  if (Array.isArray(listingIds)) {
    if (listingIds.length === 0) return new Set();
    filter.listing = {
      $in: listingIds
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }

  const rows = await Wishlist.find(filter).select('listing');
  return new Set(rows.map((row) => String(row.listing)));
}

async function getWishlist(userId, { page = 1, limit = 12 } = {}) {
  const user = toObjectId(userId, 'user ID');
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    Wishlist.find({ user })
      .populate({
        path: 'listing',
        populate: { path: 'createdBy', select: LISTING_HOST_FIELDS },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Wishlist.countDocuments({ user }),
  ]);

  // Listings deleted since being wishlisted populate as null — skip them.
  const cards = entries
    .filter((entry) => entry.listing)
    .map((entry) => ({
      ...serializeListingRecord(entry.listing.toJSON()),
      status: entry.listing.isActive ? 'active' : 'inactive',
      isWishlisted: true,
      wishlistedAt: entry.createdAt,
    }));

  const listings = await attachReviewSummariesToListings(cards);
  const totalPages = Math.ceil(total / limit);

  return {
    listings,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

async function getWishlistSummary(userId) {
  const user = toObjectId(userId, 'user ID');
  const rows = await Wishlist.find({ user }).select('listing').sort({ createdAt: -1 });
  const listingIds = rows.map((row) => String(row.listing));
  return { count: listingIds.length, listingIds };
}

module.exports = {
  addToWishlist,
  removeFromWishlist,
  toggleWishlist,
  getWishlist,
  getWishlistSummary,
  getWishlistedListingIds,
};
