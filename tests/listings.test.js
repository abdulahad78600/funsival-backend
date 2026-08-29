const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const listingsService = require('../src/modules/listings/listings.service');
const Listing = require('../src/models/listing.model');
const DraftListing = require('../src/models/draft-listing.model');
const ListingView = require('../src/models/listing-view.model');
const Booking = require('../src/models/booking.model');
const Review = require('../src/models/review.model');

function chainableQuery(result) {
  const query = {
    populate: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

test('public browse, detail, and slots only expose active listings', async () => {
  const originalFind = Listing.find;
  const originalCount = Listing.countDocuments;
  const originalFindOne = Listing.findOne;
  const filters = {};

  Listing.find = (filter) => {
    filters.browse = filter;
    return chainableQuery([]);
  };
  Listing.countDocuments = async () => 0;
  Listing.findOne = (filter) => {
    filters.findOne = filter;
    return chainableQuery(null);
  };

  try {
    const result = await listingsService.browseListings({ hostId: 'h1', search: 'cave' });
    assert.equal(filters.browse.isActive, true);
    assert.equal(filters.browse.createdBy, 'h1');
    assert.deepEqual(result.listings, []);

    const id = new mongoose.Types.ObjectId().toString();
    await assert.rejects(() => listingsService.getListingById(id), /Listing not found/);
    assert.deepEqual(filters.findOne, { _id: id, isActive: true });

    filters.findOne = undefined;
    await assert.rejects(
      () => listingsService.getAvailableSlotsForListing(id, '2026-09-01'),
      /Listing not found/
    );
    assert.deepEqual(filters.findOne, { _id: id, isActive: true });
  } finally {
    Listing.find = originalFind;
    Listing.countDocuments = originalCount;
    Listing.findOne = originalFindOne;
  }
});

test('host listing stats supply all four KPI cards and tab totals', async () => {
  const originalListingAggregate = Listing.aggregate;
  const originalDraftCount = DraftListing.countDocuments;
  const originalViewAggregate = ListingView.aggregate;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  Listing.aggregate = async () => [
    { _id: null, total: 12, active: 5, currentQuarter: 3, previousQuarter: 2 },
  ];
  DraftListing.countDocuments = async () => 2;
  ListingView.aggregate = async () => [
    { _id: null, total: 1331, currentMonth: 40, previousMonth: 20 },
  ];
  Booking.aggregate = async () => [
    { _id: null, total: 1601, currentMonth: 108, previousMonth: 100 },
  ];
  Review.aggregate = async () => [
    {
      _id: null,
      totalCount: 156,
      totalSum: 748.8,
      currentMonthCount: 10,
      currentMonthSum: 48,
      previousMonthCount: 8,
      previousMonthSum: 36.8,
    },
  ];

  try {
    const stats = await listingsService.getHostListingStats(
      new mongoose.Types.ObjectId().toString()
    );

    assert.deepEqual(stats.cards.totalListings, {
      total: 12,
      currentQuarter: 3,
      previousQuarter: 2,
      quarterChangePercentage: 50,
    });
    assert.deepEqual(stats.cards.listingViews, {
      total: 1331,
      currentMonth: 40,
      previousMonth: 20,
      monthChangePercentage: 100,
    });
    assert.deepEqual(stats.cards.totalBookings, {
      total: 1601,
      currentMonth: 108,
      previousMonth: 100,
      monthChangePercentage: 8,
    });
    assert.deepEqual(stats.cards.averageRating, {
      rating: 4.8,
      reviewCount: 156,
      currentMonthRating: 4.8,
      previousMonthRating: 4.6,
      changeFromLastMonth: 0.2,
    });
    assert.deepEqual(stats.tabs, { all: 14, active: 5, inactive: 7, draft: 2 });
  } finally {
    Listing.aggregate = originalListingAggregate;
    DraftListing.countDocuments = originalDraftCount;
    ListingView.aggregate = originalViewAggregate;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('host listing stats handle a host with no data', async () => {
  const originalListingAggregate = Listing.aggregate;
  const originalDraftCount = DraftListing.countDocuments;
  const originalViewAggregate = ListingView.aggregate;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  Listing.aggregate = async () => [];
  DraftListing.countDocuments = async () => 0;
  ListingView.aggregate = async () => [];
  Booking.aggregate = async () => [];
  Review.aggregate = async () => [];

  try {
    const stats = await listingsService.getHostListingStats(
      new mongoose.Types.ObjectId().toString()
    );

    assert.equal(stats.cards.totalListings.total, 0);
    assert.equal(stats.cards.totalListings.quarterChangePercentage, 0);
    assert.equal(stats.cards.listingViews.total, 0);
    assert.equal(stats.cards.totalBookings.total, 0);
    assert.equal(stats.cards.averageRating.rating, null);
    assert.equal(stats.cards.averageRating.changeFromLastMonth, null);
    assert.deepEqual(stats.tabs, { all: 0, active: 0, inactive: 0, draft: 0 });
  } finally {
    Listing.aggregate = originalListingAggregate;
    DraftListing.countDocuments = originalDraftCount;
    ListingView.aggregate = originalViewAggregate;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('host listing list merges drafts, statuses, tab counts, and booking counts', async () => {
  const hostId = new mongoose.Types.ObjectId().toString();
  const draftId = new mongoose.Types.ObjectId().toString();
  const activeId = new mongoose.Types.ObjectId().toString();
  const inactiveId = new mongoose.Types.ObjectId().toString();

  const draftDoc = {
    toJSON: () => ({
      id: draftId,
      createdBy: hostId,
      category: 'Equipment',
      basicInformation: { activityTitle: 'Jet Ski' },
    }),
  };
  const activeDoc = {
    isActive: true,
    toJSON: () => ({
      id: activeId,
      createdBy: hostId,
      category: 'Place',
      basicInformation: { activityTitle: 'Laser tag arenas' },
      photos: [],
    }),
  };
  const inactiveDoc = {
    isActive: false,
    toJSON: () => ({
      id: inactiveId,
      createdBy: hostId,
      category: 'Service',
      basicInformation: { activityTitle: 'Rock Adventure' },
      photos: [],
    }),
  };

  const originalListingCount = Listing.countDocuments;
  const originalListingFind = Listing.find;
  const originalDraftCount = DraftListing.countDocuments;
  const originalDraftFind = DraftListing.find;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  Listing.countDocuments = async (filter) => (filter.isActive ? 1 : 1);
  Listing.find = () => chainableQuery([activeDoc, inactiveDoc]);
  DraftListing.countDocuments = async () => 1;
  DraftListing.find = () => chainableQuery([draftDoc]);
  Booking.aggregate = async () => [{ _id: activeId, count: 77 }];
  Review.aggregate = async (pipeline) => {
    const match = pipeline[0].$match;
    if (match.listing) {
      return [
        {
          _id: new mongoose.Types.ObjectId(activeId),
          count: 156,
          overallRating: 4.8,
          accuracy: 4.8,
          quality: 4.8,
          communication: 4.8,
          value: 4.8,
        },
      ];
    }
    return [];
  };

  try {
    const result = await listingsService.getListingsForUser(hostId, {
      page: 1,
      limit: 10,
      status: 'all',
      category: 'equipment',
    });

    assert.deepEqual(result.tabs, { all: 3, active: 1, inactive: 1, draft: 1 });
    assert.equal(result.pagination.total, 3);

    const [draft, active, inactive] = result.listings;
    assert.equal(draft.status, 'draft');
    assert.equal(draft.isDraft, true);
    assert.equal(draft.bookingCount, 0);
    assert.equal(active.status, 'active');
    assert.equal(active.bookingCount, 77);
    assert.equal(active.reviewSummary.count, 156);
    assert.equal(active.reviewSummary.overallRating, 4.8);
    assert.equal(inactive.status, 'inactive');
    assert.equal(inactive.bookingCount, 0);
  } finally {
    Listing.countDocuments = originalListingCount;
    Listing.find = originalListingFind;
    DraftListing.countDocuments = originalDraftCount;
    DraftListing.find = originalDraftFind;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('host listing list rejects unknown status filters', async () => {
  await assert.rejects(
    () =>
      listingsService.getListingsForUser(new mongoose.Types.ObjectId().toString(), {
        status: 'archived',
      }),
    /Invalid status/
  );
});

test('admin listing list returns every host listing with host info, tabs, and booking counts', async () => {
  const hostId = new mongoose.Types.ObjectId();
  const activeId = new mongoose.Types.ObjectId().toString();
  const inactiveId = new mongoose.Types.ObjectId().toString();
  const hostDoc = {
    _id: hostId,
    email: 'host@example.com',
    role: 'host',
    agencyName: 'Fun Agency',
    city: 'Dubai',
    providerProfile: { firstName: 'Jane', lastName: 'Doe', profileImage: '' },
  };

  const activeDoc = {
    isActive: true,
    toJSON: () => ({
      id: activeId,
      createdBy: hostDoc,
      category: 'Place',
      basicInformation: { activityTitle: 'Laser tag arenas' },
      photos: [],
    }),
  };
  const inactiveDoc = {
    isActive: false,
    toJSON: () => ({
      id: inactiveId,
      createdBy: hostDoc,
      category: 'Service',
      basicInformation: { activityTitle: 'Rock Adventure' },
      photos: [],
    }),
  };

  const originalListingCount = Listing.countDocuments;
  const originalListingFind = Listing.find;
  const originalDraftCount = DraftListing.countDocuments;
  const originalDraftFind = DraftListing.find;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  DraftListing.countDocuments = async () => 0;
  DraftListing.find = () => chainableQuery([]);
  const receivedFilters = [];
  Listing.countDocuments = async (filter) => {
    receivedFilters.push(filter);
    return filter.isActive ? 1 : 1;
  };
  Listing.find = (filter) => {
    receivedFilters.push(filter);
    return chainableQuery([activeDoc, inactiveDoc]);
  };
  Booking.aggregate = async () => [{ _id: activeId, count: 5 }];
  Review.aggregate = async () => [];

  try {
    const result = await listingsService.getListingsForAdmin({
      page: 1,
      limit: 10,
      hostId: hostId.toString(),
      status: 'all',
      search: 'laser',
    });

    assert.deepEqual(result.tabs, { all: 2, active: 1, inactive: 1, draft: 0 });
    assert.equal(result.pagination.total, 2);
    assert.equal(result.listings.length, 2);

    const [active, inactive] = result.listings;
    assert.equal(active.status, 'active');
    assert.equal(active.isDraft, false);
    assert.equal(active.bookingCount, 5);
    assert.equal(active.host.id, hostId.toString());
    assert.equal(active.host.name, 'Jane Doe');
    assert.equal(active.host.email, 'host@example.com');
    assert.equal(active.createdBy, hostId.toString());
    assert.ok(active.reviewSummary);
    assert.equal(inactive.status, 'inactive');
    assert.equal(inactive.bookingCount, 0);

    receivedFilters.forEach((filter) => {
      assert.equal(String(filter.createdBy), hostId.toString());
      assert.ok(Array.isArray(filter.$or));
    });
  } finally {
    Listing.countDocuments = originalListingCount;
    Listing.find = originalListingFind;
    DraftListing.countDocuments = originalDraftCount;
    DraftListing.find = originalDraftFind;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('admin listing list rejects invalid host IDs and unsupported statuses', async () => {
  await assert.rejects(
    () => listingsService.getListingsForAdmin({ hostId: 'not-an-id' }),
    /Invalid host ID/
  );
  await assert.rejects(
    () => listingsService.getListingsForAdmin({ status: 'archived' }),
    /Invalid status/
  );
});

test('admin listing detail includes host, review summary, views, and booking breakdown', async () => {
  const hostId = new mongoose.Types.ObjectId();
  const listingObjectId = new mongoose.Types.ObjectId();
  const listingId = listingObjectId.toString();

  const listingDoc = {
    _id: listingObjectId,
    isActive: true,
    toJSON: () => ({
      id: listingId,
      createdBy: { _id: hostId, email: 'host@example.com', role: 'host' },
      category: 'Place',
      basicInformation: { activityTitle: 'Laser tag arenas' },
      photos: [],
    }),
  };

  const originalFindById = Listing.findById;
  const originalViewCount = ListingView.countDocuments;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  Listing.findById = () => ({ populate: async () => listingDoc });
  ListingView.countDocuments = async () => 42;
  Booking.aggregate = async () => [
    { _id: 'confirmed', count: 3 },
    { _id: 'completed', count: 4 },
    { _id: 'cancelled', count: 1 },
  ];
  Review.aggregate = async (pipeline) => {
    const match = pipeline[0].$match;
    if (match.listing) {
      return [
        {
          _id: listingObjectId,
          count: 10,
          overallRating: 4.5,
          accuracy: 4.5,
          quality: 4.5,
          communication: 4.5,
          value: 4.5,
        },
      ];
    }
    return [];
  };

  try {
    const listing = await listingsService.getListingForAdmin(listingId);

    assert.equal(listing.id, listingId);
    assert.equal(listing.status, 'active');
    assert.equal(listing.host.id, hostId.toString());
    assert.equal(listing.host.email, 'host@example.com');
    assert.equal(listing.reviewSummary.count, 10);
    assert.equal(listing.bookingCount, 7);
    assert.equal(listing.stats.viewCount, 42);
    assert.equal(listing.stats.totalBookings, 8);
    assert.equal(listing.stats.bookingsByStatus.confirmed, 3);
    assert.equal(listing.stats.bookingsByStatus.completed, 4);
    assert.equal(listing.stats.bookingsByStatus.cancelled, 1);
    assert.equal(listing.stats.bookingsByStatus.pending, 0);
  } finally {
    Listing.findById = originalFindById;
    ListingView.countDocuments = originalViewCount;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('admin listing detail returns 404 for unknown listings', async () => {
  const originalFindById = Listing.findById;
  Listing.findById = () => ({ populate: async () => null });
  try {
    await assert.rejects(
      () => listingsService.getListingForAdmin(new mongoose.Types.ObjectId().toString()),
      /Listing not found/
    );
  } finally {
    Listing.findById = originalFindById;
  }
});

test('admin listing stats cover every host when no hostId is given', async () => {
  const originalListingAggregate = Listing.aggregate;
  const originalDraftCount = DraftListing.countDocuments;
  const originalViewAggregate = ListingView.aggregate;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  const matches = {};
  Listing.aggregate = async (pipeline) => {
    matches.listing = pipeline[0].$match;
    return [{ _id: null, total: 40, active: 30, currentQuarter: 8, previousQuarter: 4 }];
  };
  DraftListing.countDocuments = async (filter) => {
    matches.draft = filter;
    return 3;
  };
  ListingView.aggregate = async (pipeline) => {
    matches.view = pipeline[0].$match;
    return [{ _id: null, total: 5000, currentMonth: 120, previousMonth: 100 }];
  };
  Booking.aggregate = async (pipeline) => {
    matches.booking = pipeline[0].$match;
    return [{ _id: null, total: 900, currentMonth: 50, previousMonth: 40 }];
  };
  Review.aggregate = async (pipeline) => {
    matches.review = pipeline[0].$match;
    return [
      {
        _id: null,
        totalCount: 200,
        totalSum: 940,
        currentMonthCount: 10,
        currentMonthSum: 48,
        previousMonthCount: 10,
        previousMonthSum: 45,
      },
    ];
  };

  try {
    const stats = await listingsService.getAdminListingStats({});

    assert.deepEqual(matches.listing, {});
    assert.deepEqual(matches.draft, {});
    assert.deepEqual(matches.view, {});
    assert.deepEqual(matches.review, {});
    assert.equal(matches.booking.host, undefined);

    assert.equal(stats.cards.totalListings.total, 40);
    assert.equal(stats.cards.totalListings.quarterChangePercentage, 100);
    assert.equal(stats.cards.listingViews.total, 5000);
    assert.equal(stats.cards.listingViews.monthChangePercentage, 20);
    assert.equal(stats.cards.totalBookings.total, 900);
    assert.equal(stats.cards.totalBookings.monthChangePercentage, 25);
    assert.equal(stats.cards.averageRating.rating, 4.7);
    assert.equal(stats.cards.averageRating.changeFromLastMonth, 0.3);
    assert.deepEqual(stats.tabs, { all: 43, active: 30, inactive: 10, draft: 3 });
  } finally {
    Listing.aggregate = originalListingAggregate;
    DraftListing.countDocuments = originalDraftCount;
    ListingView.aggregate = originalViewAggregate;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('admin listing stats scope to a host and reject malformed host IDs', async () => {
  const hostId = new mongoose.Types.ObjectId();
  const originalListingAggregate = Listing.aggregate;
  const originalDraftCount = DraftListing.countDocuments;
  const originalViewAggregate = ListingView.aggregate;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  let listingMatch;
  Listing.aggregate = async (pipeline) => {
    listingMatch = pipeline[0].$match;
    return [];
  };
  DraftListing.countDocuments = async () => 0;
  ListingView.aggregate = async () => [];
  Booking.aggregate = async () => [];
  Review.aggregate = async () => [];

  try {
    await listingsService.getAdminListingStats({ hostId: hostId.toString() });
    assert.equal(String(listingMatch.createdBy), hostId.toString());
    await assert.rejects(
      () => listingsService.getAdminListingStats({ hostId: 'nope' }),
      /Invalid host ID/
    );
  } finally {
    Listing.aggregate = originalListingAggregate;
    DraftListing.countDocuments = originalDraftCount;
    ListingView.aggregate = originalViewAggregate;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});

test('listing rows expose the next upcoming availability slot', async () => {
  const hostId = new mongoose.Types.ObjectId().toString();
  const listingId = new mongoose.Types.ObjectId().toString();
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 10);
  const later = new Date(future);
  later.setUTCDate(later.getUTCDate() + 5);
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - 10);

  const doc = {
    isActive: true,
    toJSON: () => ({
      id: listingId,
      createdBy: hostId,
      photos: [],
      availability: [
        { date: past, startTime: '08:00', endTime: '09:00', isAvailable: true },
        { date: later, startTime: '11:00', endTime: '12:00', isAvailable: true },
        { date: future, startTime: '09:30', endTime: '10:30', isAvailable: true },
        { date: future, startTime: '07:00', endTime: '08:00', isAvailable: false },
      ],
    }),
  };

  const originalListingCount = Listing.countDocuments;
  const originalListingFind = Listing.find;
  const originalDraftCount = DraftListing.countDocuments;
  const originalBookingAggregate = Booking.aggregate;
  const originalReviewAggregate = Review.aggregate;

  Listing.countDocuments = async () => 1;
  Listing.find = () => chainableQuery([doc]);
  DraftListing.countDocuments = async () => 0;
  Booking.aggregate = async () => [];
  Review.aggregate = async () => [];

  try {
    const result = await listingsService.getListingsForUser(hostId, { status: 'active' });
    assert.deepEqual(result.listings[0].nextAvailability, {
      date: future.toISOString().slice(0, 10),
      startTime: '09:30',
      endTime: '10:30',
    });
  } finally {
    Listing.countDocuments = originalListingCount;
    Listing.find = originalListingFind;
    DraftListing.countDocuments = originalDraftCount;
    Booking.aggregate = originalBookingAggregate;
    Review.aggregate = originalReviewAggregate;
  }
});
