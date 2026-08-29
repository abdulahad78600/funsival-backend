const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const usersService = require('../src/modules/users/users.service');
const User = require('../src/models/user.model');
const Listing = require('../src/models/listing.model');
const DraftListing = require('../src/models/draft-listing.model');
const Booking = require('../src/models/booking.model');
const Review = require('../src/models/review.model');

function chainableQuery(result) {
  const query = {
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function fakeUser(overrides = {}) {
  const _id = overrides._id || new mongoose.Types.ObjectId();
  const doc = {
    _id,
    role: 'host',
    email: 'jane@funagency.com',
    agencyName: 'Fun Agency',
    city: 'Dubai',
    isEmailVerified: true,
    twoFactorEnabled: false,
    authProviders: ['local'],
    providerProfile: { firstName: 'Jane', lastName: 'Doe', profileImage: 'img.jpg', phoneNumber: '+971' },
    preferences: { amenities: [], equipments: [], services: [] },
    stripeConnect: { accountId: 'acct_1', chargesEnabled: true, payoutsEnabled: false },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  doc.toJSON = () => {
    const { _id: id, toJSON, isEmailVerified, authProviders, ...rest } = doc;
    return { id: id.toString(), ...rest };
  };
  return doc;
}

function stubStats(overrides = {}) {
  const originals = {
    listing: Listing.aggregate,
    draft: DraftListing.aggregate,
    booking: Booking.aggregate,
    review: Review.aggregate,
  };
  Listing.aggregate = overrides.listing || (async () => []);
  DraftListing.aggregate = overrides.draft || (async () => []);
  Booking.aggregate = overrides.booking || (async () => []);
  Review.aggregate = overrides.review || (async () => []);
  return () => {
    Listing.aggregate = originals.listing;
    DraftListing.aggregate = originals.draft;
    Booking.aggregate = originals.booking;
    Review.aggregate = originals.review;
  };
}

test('admin users list returns every user with details, role tabs, and activity stats', async () => {
  const host = fakeUser();
  const guest = fakeUser({ role: 'user', email: 'sam@example.com', providerProfile: undefined, agencyName: undefined, stripeConnect: {} });

  const originalFind = User.find;
  const originalAggregate = User.aggregate;
  let receivedFilter;
  User.find = (filter) => {
    receivedFilter = filter;
    return chainableQuery([host, guest]);
  };
  User.aggregate = async () => [
    { _id: 'host', count: 4 },
    { _id: 'user', count: 9 },
    { _id: 'admin', count: 1 },
  ];
  const restoreStats = stubStats({
    listing: async () => [{ _id: host._id, total: 5, active: 3 }],
    draft: async () => [{ _id: host._id, total: 1 }],
    booking: async (pipeline) => {
      const match = pipeline[0].$match;
      if (match.bookedBy) return [{ _id: guest._id, total: 7 }];
      return [{ _id: host._id, total: 40 }];
    },
    review: async () => [{ _id: host._id, count: 12, average: 4.66 }],
  });

  try {
    const result = await usersService.listUsersForAdmin({ page: 1, limit: 10, role: 'all', search: 'fun' });

    assert.ok(Array.isArray(receivedFilter.$or));
    assert.equal(receivedFilter.role, undefined);
    assert.deepEqual(result.tabs, { all: 14, user: 9, host: 4, admin: 1 });
    assert.equal(result.pagination.total, 14);

    const [hostRow, guestRow] = result.users;
    assert.equal(hostRow.id, host._id.toString());
    assert.equal(hostRow.name, 'Jane Doe');
    assert.equal(hostRow.email, 'jane@funagency.com');
    assert.equal(hostRow.isEmailVerified, true);
    assert.deepEqual(hostRow.authProviders, ['local']);
    assert.equal(hostRow.stripeConnect.connected, true);
    assert.equal(hostRow.stripeConnect.chargesEnabled, true);
    assert.equal(hostRow.stripeConnect.payoutsEnabled, false);
    assert.deepEqual(hostRow.stats, {
      listings: { total: 5, active: 3, inactive: 2, draft: 1 },
      bookings: { asGuest: 0, asHost: 40 },
      rating: { average: 4.7, count: 12 },
    });
    assert.equal(hostRow.password, undefined);

    assert.equal(guestRow.name, 'sam@example.com');
    assert.equal(guestRow.stripeConnect.connected, false);
    assert.equal(guestRow.stats.bookings.asGuest, 7);
    assert.equal(guestRow.stats.listings.total, 0);
  } finally {
    User.find = originalFind;
    User.aggregate = originalAggregate;
    restoreStats();
  }
});

test('admin users list filters by role and rejects unknown roles', async () => {
  const originalFind = User.find;
  const originalAggregate = User.aggregate;
  let receivedFilter;
  User.find = (filter) => {
    receivedFilter = filter;
    return chainableQuery([]);
  };
  User.aggregate = async () => [{ _id: 'host', count: 2 }];
  const restoreStats = stubStats();

  try {
    const result = await usersService.listUsersForAdmin({ role: 'host' });
    assert.equal(receivedFilter.role, 'host');
    assert.equal(result.pagination.total, 2);
    await assert.rejects(() => usersService.listUsersForAdmin({ role: 'superuser' }), /Invalid role/);
  } finally {
    User.find = originalFind;
    User.aggregate = originalAggregate;
    restoreStats();
  }
});

test('admin user detail adds booking breakdowns and reviews written', async () => {
  const user = fakeUser();
  const originalFindById = User.findById;
  const originalReviewCount = Review.countDocuments;
  User.findById = () => ({ select: async () => user });
  Review.countDocuments = async () => 3;
  const restoreStats = stubStats({
    booking: async (pipeline) => {
      const match = pipeline[0].$match;
      if (pipeline[1].$group._id === '$status') {
        return match.bookedBy
          ? [{ _id: 'completed', count: 2 }]
          : [{ _id: 'confirmed', count: 5 }, { _id: 'cancelled', count: 1 }];
      }
      return [];
    },
  });

  try {
    const detail = await usersService.getUserForAdmin(user._id.toString());
    assert.equal(detail.id, user._id.toString());
    assert.equal(detail.stats.reviewsWritten, 3);
    assert.equal(detail.stats.bookings.asGuestByStatus.completed, 2);
    assert.equal(detail.stats.bookings.asGuestByStatus.pending, 0);
    assert.equal(detail.stats.bookings.asHostByStatus.confirmed, 5);
    assert.equal(detail.stats.bookings.asHostByStatus.cancelled, 1);
  } finally {
    User.findById = originalFindById;
    Review.countDocuments = originalReviewCount;
    restoreStats();
  }
});

test('admin user update applies profile + account fields and blocks self-demotion', async () => {
  const user = fakeUser({ providerProfile: { firstName: 'Jane', lastName: 'Doe', location: {} } });
  let saved = false;
  user.save = async () => {
    saved = true;
  };

  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  User.findById = () => {
    const query = Promise.resolve(user);
    query.select = async () => user;
    return query;
  };
  User.findOne = () => ({ select: async () => null });
  const originalReviewCount = Review.countDocuments;
  Review.countDocuments = async () => 0;
  const restoreStats = stubStats();

  try {
    const admin = new mongoose.Types.ObjectId();
    const result = await usersService.updateUserForAdmin(
      user._id.toString(),
      { firstName: 'Janet', role: 'user', isEmailVerified: false, email: 'NEW@Example.com', city: 'Abu Dhabi' },
      admin.toString()
    );

    assert.equal(saved, true);
    assert.equal(user.providerProfile.firstName, 'Janet');
    assert.equal(user.providerProfile.lastName, 'Doe');
    assert.equal(user.role, 'user');
    assert.equal(user.isEmailVerified, false);
    assert.equal(user.email, 'new@example.com');
    assert.equal(user.city, 'Abu Dhabi');
    assert.equal(result.id, user._id.toString());

    await assert.rejects(
      () => usersService.updateUserForAdmin(user._id.toString(), { role: 'superuser' }, admin.toString()),
      (error) => error.statusCode === 400 && /role must be one of/.test(error.details.role)
    );
    await assert.rejects(
      () => usersService.updateUserForAdmin(user._id.toString(), {}, admin.toString()),
      (error) => error.statusCode === 400 && /At least one field/.test(error.details.payload)
    );
    await assert.rejects(
      () => usersService.updateUserForAdmin(user._id.toString(), { role: 'host' }, user._id.toString()),
      /cannot change your own admin role/
    );
  } finally {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
    Review.countDocuments = originalReviewCount;
    restoreStats();
  }
});

test('admin user delete cascades listings and refuses self-delete or users with active bookings', async () => {
  const user = fakeUser();
  const listingId = new mongoose.Types.ObjectId();
  const Wishlist = require('../src/models/wishlist.model');
  const ListingView = require('../src/models/listing-view.model');

  const originals = {
    findById: User.findById,
    deleteOne: User.deleteOne,
    bookingCount: Booking.countDocuments,
    listingFind: Listing.find,
    listingDelete: Listing.deleteMany,
    draftDelete: DraftListing.deleteMany,
    wishlistDelete: Wishlist.deleteMany,
    viewDelete: ListingView.deleteMany,
  };

  let activeBookings = 2;
  let userDeleted = false;
  const deleteFilters = {};
  User.findById = () => ({ select: async () => user });
  User.deleteOne = async () => {
    userDeleted = true;
    return { deletedCount: 1 };
  };
  Booking.countDocuments = async () => activeBookings;
  Listing.find = () => ({ select: async () => [{ _id: listingId, photos: [] }] });
  Listing.deleteMany = async (filter) => {
    deleteFilters.listing = filter;
    return { deletedCount: 1 };
  };
  DraftListing.deleteMany = async () => ({ deletedCount: 2 });
  Wishlist.deleteMany = async (filter) => {
    deleteFilters.wishlist = filter;
    return { deletedCount: 3 };
  };
  ListingView.deleteMany = async (filter) => {
    deleteFilters.view = filter;
    return { deletedCount: 4 };
  };

  try {
    const admin = new mongoose.Types.ObjectId().toString();

    await assert.rejects(
      () => usersService.deleteUserForAdmin(user._id.toString(), user._id.toString()),
      /cannot delete your own account/
    );
    await assert.rejects(
      () => usersService.deleteUserForAdmin(user._id.toString(), admin),
      /2 active booking/
    );
    assert.equal(userDeleted, false);

    activeBookings = 0;
    const result = await usersService.deleteUserForAdmin(user._id.toString(), admin);

    assert.equal(userDeleted, true);
    assert.deepEqual(result.deleted, { listings: 1, draftListings: 2, wishlists: 3 });
    assert.deepEqual(deleteFilters.listing, { _id: { $in: [listingId] } });
    assert.equal(String(deleteFilters.wishlist.$or[0].user), user._id.toString());
    assert.equal(String(deleteFilters.view.$or[0].host), user._id.toString());
  } finally {
    User.findById = originals.findById;
    User.deleteOne = originals.deleteOne;
    Booking.countDocuments = originals.bookingCount;
    Listing.find = originals.listingFind;
    Listing.deleteMany = originals.listingDelete;
    DraftListing.deleteMany = originals.draftDelete;
    Wishlist.deleteMany = originals.wishlistDelete;
    ListingView.deleteMany = originals.viewDelete;
  }
});

test('admin user detail rejects malformed IDs and returns 404 for unknown users', async () => {
  await assert.rejects(() => usersService.getUserForAdmin('nope'), /Invalid user ID/);

  const originalFindById = User.findById;
  User.findById = () => ({ select: async () => null });
  try {
    await assert.rejects(
      () => usersService.getUserForAdmin(new mongoose.Types.ObjectId().toString()),
      /User not found/
    );
  } finally {
    User.findById = originalFindById;
  }
});
