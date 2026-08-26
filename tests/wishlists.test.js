const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const wishlistsService = require('../src/modules/wishlists/wishlists.service');
const listingsService = require('../src/modules/listings/listings.service');
const Wishlist = require('../src/models/wishlist.model');
const Listing = require('../src/models/listing.model');
const Review = require('../src/models/review.model');

function chainableQuery(result) {
  const query = {
    populate: () => query,
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

test('adding to the wishlist is idempotent and requires an existing listing', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const listingId = new mongoose.Types.ObjectId().toString();
  const originalExists = Listing.exists;
  const originalUpdateOne = Wishlist.updateOne;

  let upsertCalls = 0;
  Listing.exists = async () => true;
  Wishlist.updateOne = async (filter, update, options) => {
    upsertCalls += 1;
    assert.equal(String(filter.user), userId);
    assert.equal(String(filter.listing), listingId);
    assert.equal(options.upsert, true);
    return { upsertedCount: upsertCalls === 1 ? 1 : 0 };
  };

  try {
    const first = await wishlistsService.addToWishlist(userId, listingId);
    assert.deepEqual(first, { listingId, isWishlisted: true, added: true });
    const second = await wishlistsService.addToWishlist(userId, listingId);
    assert.deepEqual(second, { listingId, isWishlisted: true, added: false });

    Listing.exists = async () => null;
    await assert.rejects(
      () => wishlistsService.addToWishlist(userId, new mongoose.Types.ObjectId().toString()),
      /Listing not found/
    );
    await assert.rejects(() => wishlistsService.addToWishlist(userId, 'bad-id'), /Invalid listing ID/);
  } finally {
    Listing.exists = originalExists;
    Wishlist.updateOne = originalUpdateOne;
  }
});

test('removing and toggling flip the wishlisted state', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const listingId = new mongoose.Types.ObjectId().toString();
  const originalDeleteOne = Wishlist.deleteOne;
  const originalFindOne = Wishlist.findOne;
  const originalUpdateOne = Wishlist.updateOne;
  const originalExists = Listing.exists;

  Wishlist.deleteOne = async () => ({ deletedCount: 1 });
  Listing.exists = async () => true;
  Wishlist.updateOne = async () => ({ upsertedCount: 1 });

  try {
    const removed = await wishlistsService.removeFromWishlist(userId, listingId);
    assert.deepEqual(removed, { listingId, isWishlisted: false, removed: true });

    Wishlist.findOne = () => ({ select: async () => ({ _id: 'x' }) });
    const toggledOff = await wishlistsService.toggleWishlist(userId, listingId);
    assert.equal(toggledOff.isWishlisted, false);

    Wishlist.findOne = () => ({ select: async () => null });
    const toggledOn = await wishlistsService.toggleWishlist(userId, listingId);
    assert.equal(toggledOn.isWishlisted, true);
  } finally {
    Wishlist.deleteOne = originalDeleteOne;
    Wishlist.findOne = originalFindOne;
    Wishlist.updateOne = originalUpdateOne;
    Listing.exists = originalExists;
  }
});

test('wishlist page returns listing cards with host, rating, and pagination, skipping deleted listings', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const hostId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId().toString();
  const wishlistedAt = new Date('2026-08-01T00:00:00Z');

  const listingDoc = {
    isActive: true,
    toJSON: () => ({
      id: listingId,
      category: 'Swimming',
      basicInformation: { activityTitle: 'Swimming pool', location: 'Tokyo, Japan' },
      placeLocation: { city: 'Tokyo', country: 'Japan' },
      price: { hourly: 26, currency: 'USD' },
      photos: [],
      createdBy: { _id: hostId, email: 'host@example.com', role: 'host' },
    }),
  };

  const originalFind = Wishlist.find;
  const originalCount = Wishlist.countDocuments;
  const originalReviewAggregate = Review.aggregate;

  Wishlist.find = () =>
    chainableQuery([
      { listing: listingDoc, createdAt: wishlistedAt },
      { listing: null, createdAt: wishlistedAt }, // listing deleted after wishlisting
    ]);
  Wishlist.countDocuments = async () => 25;
  Review.aggregate = async (pipeline) => {
    const match = pipeline[0].$match;
    if (match.listing) {
      return [{ _id: new mongoose.Types.ObjectId(listingId), count: 21000, overallRating: 4.4, accuracy: 4.4, quality: 4.4, communication: 4.4, value: 4.4 }];
    }
    return [];
  };

  try {
    const result = await wishlistsService.getWishlist(userId, { page: 1, limit: 8 });

    assert.equal(result.listings.length, 1);
    const [card] = result.listings;
    assert.equal(card.id, listingId);
    assert.equal(card.isWishlisted, true);
    assert.equal(card.wishlistedAt, wishlistedAt);
    assert.equal(card.status, 'active');
    assert.equal(card.host.id, hostId.toString());
    assert.equal(card.reviewSummary.count, 21000);
    assert.equal(card.reviewSummary.overallRating, 4.4);
    assert.equal(card.price.hourly, 26);
    assert.deepEqual(result.pagination, {
      total: 25, page: 1, limit: 8, totalPages: 4, hasNextPage: true, hasPrevPage: false,
    });
  } finally {
    Wishlist.find = originalFind;
    Wishlist.countDocuments = originalCount;
    Review.aggregate = originalReviewAggregate;
  }
});

test('browse results carry isWishlisted for the signed-in viewer and false for guests', async () => {
  const viewerId = new mongoose.Types.ObjectId().toString();
  const savedId = new mongoose.Types.ObjectId().toString();
  const otherId = new mongoose.Types.ObjectId().toString();
  const originalFind = Wishlist.find;

  Wishlist.find = (filter) => {
    assert.equal(String(filter.user), viewerId);
    return chainableQuery([{ listing: new mongoose.Types.ObjectId(savedId) }]);
  };

  try {
    const flagged = await listingsService.attachWishlistFlags(
      [{ id: savedId }, { id: otherId }],
      viewerId
    );
    assert.deepEqual(flagged.map((l) => l.isWishlisted), [true, false]);

    const anonymous = await listingsService.attachWishlistFlags([{ id: savedId }], null);
    assert.deepEqual(anonymous.map((l) => l.isWishlisted), [false]);
  } finally {
    Wishlist.find = originalFind;
  }
});
