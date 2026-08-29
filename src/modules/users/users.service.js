const mongoose = require('mongoose');
const Listing = require('../../models/listing.model');
const DraftListing = require('../../models/draft-listing.model');
const Booking = require('../../models/booking.model');
const Review = require('../../models/review.model');
const { BOOKING_STATUS } = require('../../constants/booking');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const { USER_ROLES, AVAILABLE_ROLES } = require('../../constants/roles');
const Wishlist = require('../../models/wishlist.model');
const ListingView = require('../../models/listing-view.model');
const { cleanupUnusedListingPhotos } = require('../listings/listings.service');
const {
  validateProviderProfilePayload,
  validateUserProfilePayload,
  validateAdminUserUpdatePayload,
} = require('./users.validation');

async function saveUserPreferences(userId, preferences) {
  const user = await User.findByIdAndUpdate(
    userId,
    { preferences },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  return user;
}

async function updateProviderProfile(userId, payload) {
  const validatedPayload = validateProviderProfilePayload(payload);
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  // Removed role check to allow all users to update their profile

  if (
    validatedPayload.email &&
    validatedPayload.email !== user.email
  ) {
    const existingUser = await User.findOne({
      email: validatedPayload.email,
      _id: { $ne: user._id },
    }).select('_id');

    if (existingUser) {
      throw new ApiError(409, 'An account with this email already exists.');
    }

    user.email = validatedPayload.email;
  }

  const providerProfile = {
    firstName: user.providerProfile?.firstName || '',
    lastName: user.providerProfile?.lastName || '',
    phoneNumber: user.providerProfile?.phoneNumber || '',
    dateOfBirth: user.providerProfile?.dateOfBirth,
    bio: user.providerProfile?.bio || '',
    profileImage: user.providerProfile?.profileImage || '',
    businessName: user.providerProfile?.businessName || user.agencyName || '',
    businessType: user.providerProfile?.businessType || '',
    location: {
      addressLine1: user.providerProfile?.location?.addressLine1 || '',
      addressLine2: user.providerProfile?.location?.addressLine2 || '',
      city: user.providerProfile?.location?.city || user.city || '',
      state: user.providerProfile?.location?.state || '',
      postalCode: user.providerProfile?.location?.postalCode || '',
      country: user.providerProfile?.location?.country || '',
    },
  };

  if (validatedPayload.firstName !== undefined) providerProfile.firstName = validatedPayload.firstName;
  if (validatedPayload.lastName !== undefined) providerProfile.lastName = validatedPayload.lastName;
  if (validatedPayload.phoneNumber !== undefined) providerProfile.phoneNumber = validatedPayload.phoneNumber;
  if (validatedPayload.dateOfBirth !== undefined) providerProfile.dateOfBirth = validatedPayload.dateOfBirth;
  if (validatedPayload.bio !== undefined) providerProfile.bio = validatedPayload.bio;
  if (validatedPayload.profileImage !== undefined) providerProfile.profileImage = validatedPayload.profileImage;
  if (validatedPayload.addressLine1 !== undefined) providerProfile.location.addressLine1 = validatedPayload.addressLine1;
  if (validatedPayload.addressLine2 !== undefined) providerProfile.location.addressLine2 = validatedPayload.addressLine2;
  if (validatedPayload.city !== undefined) providerProfile.location.city = validatedPayload.city;
  if (validatedPayload.state !== undefined) providerProfile.location.state = validatedPayload.state;
  if (validatedPayload.postalCode !== undefined) providerProfile.location.postalCode = validatedPayload.postalCode;
  if (validatedPayload.country !== undefined) providerProfile.location.country = validatedPayload.country;
  if (validatedPayload.businessName !== undefined) providerProfile.businessName = validatedPayload.businessName;
  if (validatedPayload.businessType !== undefined) providerProfile.businessType = validatedPayload.businessType;

  if (providerProfile.businessName) {
    user.agencyName = providerProfile.businessName;
  }

  if (providerProfile.location.city) {
    user.city = providerProfile.location.city;
  }

  user.providerProfile = providerProfile;
  await user.save();

  return user.toJSON();
}

async function updateUserProfile(userId, payload) {
  const validatedPayload = validateUserProfilePayload(payload);
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (user.role !== USER_ROLES.USER) {
    throw new ApiError(
      403,
      'This endpoint is for user accounts. Hosts must use /users/provider-profile.'
    );
  }

  if (validatedPayload.email && validatedPayload.email !== user.email) {
    const existingUser = await User.findOne({
      email: validatedPayload.email,
      _id: { $ne: user._id },
    }).select('_id');

    if (existingUser) {
      throw new ApiError(409, 'An account with this email already exists.');
    }

    user.email = validatedPayload.email;
  }

  const profile = {
    firstName: user.providerProfile?.firstName || '',
    lastName: user.providerProfile?.lastName || '',
    phoneNumber: user.providerProfile?.phoneNumber || '',
    dateOfBirth: user.providerProfile?.dateOfBirth,
    bio: user.providerProfile?.bio || '',
    profileImage: user.providerProfile?.profileImage || '',
    businessName: user.providerProfile?.businessName || '',
    businessType: user.providerProfile?.businessType || '',
    location: {
      addressLine1: user.providerProfile?.location?.addressLine1 || '',
      addressLine2: user.providerProfile?.location?.addressLine2 || '',
      city: user.providerProfile?.location?.city || user.city || '',
      state: user.providerProfile?.location?.state || '',
      postalCode: user.providerProfile?.location?.postalCode || '',
      country: user.providerProfile?.location?.country || '',
    },
  };

  if (validatedPayload.firstName !== undefined) profile.firstName = validatedPayload.firstName;
  if (validatedPayload.lastName !== undefined) profile.lastName = validatedPayload.lastName;
  if (validatedPayload.phoneNumber !== undefined) profile.phoneNumber = validatedPayload.phoneNumber;
  if (validatedPayload.dateOfBirth !== undefined) profile.dateOfBirth = validatedPayload.dateOfBirth;
  if (validatedPayload.bio !== undefined) profile.bio = validatedPayload.bio;
  if (validatedPayload.profileImage !== undefined) profile.profileImage = validatedPayload.profileImage;
  if (validatedPayload.addressLine1 !== undefined) profile.location.addressLine1 = validatedPayload.addressLine1;
  if (validatedPayload.addressLine2 !== undefined) profile.location.addressLine2 = validatedPayload.addressLine2;
  if (validatedPayload.city !== undefined) profile.location.city = validatedPayload.city;
  if (validatedPayload.state !== undefined) profile.location.state = validatedPayload.state;
  if (validatedPayload.postalCode !== undefined) profile.location.postalCode = validatedPayload.postalCode;
  if (validatedPayload.country !== undefined) profile.location.country = validatedPayload.country;

  if (profile.location.city) {
    user.city = profile.location.city;
  }

  user.providerProfile = profile;
  await user.save();

  return user.toJSON();
}

async function updateUserProfileImage(userId, profileImageUrl) {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const existingProfile = user.providerProfile || {};

  user.providerProfile = {
    firstName: existingProfile.firstName || '',
    lastName: existingProfile.lastName || '',
    phoneNumber: existingProfile.phoneNumber || '',
    dateOfBirth: existingProfile.dateOfBirth,
    bio: existingProfile.bio || '',
    profileImage: profileImageUrl,
    businessName: existingProfile.businessName || user.agencyName || '',
    businessType: existingProfile.businessType || '',
    location: {
      addressLine1: existingProfile.location?.addressLine1 || '',
      addressLine2: existingProfile.location?.addressLine2 || '',
      city: existingProfile.location?.city || user.city || '',
      state: existingProfile.location?.state || '',
      postalCode: existingProfile.location?.postalCode || '',
      country: existingProfile.location?.country || '',
    },
  };

  await user.save();
  return user.toJSON();
}

// ---------------------------------------------------------------------------
// Admin: platform users list + user detail
// ---------------------------------------------------------------------------

const ADMIN_USER_SELECT = '+stripeConnect';
const ADMIN_USER_SEARCH_FIELDS = [
  'email',
  'agencyName',
  'city',
  'providerProfile.firstName',
  'providerProfile.lastName',
  'providerProfile.businessName',
  'providerProfile.phoneNumber',
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectId(value, label) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

function roundRating(value) {
  return value === null || value === undefined
    ? null
    : Math.round((value + Number.EPSILON) * 10) / 10;
}

function emptyBookingsByStatus() {
  return Object.values(BOOKING_STATUS).reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {}
  );
}

function emptyUserStats() {
  return {
    listings: { total: 0, active: 0, inactive: 0, draft: 0 },
    bookings: { asGuest: 0, asHost: 0 },
    rating: { average: null, count: 0 },
  };
}

function resolveUserName(user) {
  const profile = user.providerProfile || {};
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.agencyName || user.email || '';
}

function serializeAdminUser(userDoc, stats = emptyUserStats()) {
  const json = userDoc.toJSON();
  const profile = json.providerProfile || {};
  const stripe = userDoc.stripeConnect || {};

  return {
    id: json.id,
    role: json.role,
    email: json.email,
    name: resolveUserName(json),
    agencyName: json.agencyName || '',
    city: json.city || profile.location?.city || '',
    phoneNumber: profile.phoneNumber || '',
    profileImage: profile.profileImage || '',
    isEmailVerified: Boolean(userDoc.isEmailVerified),
    twoFactorEnabled: Boolean(json.twoFactorEnabled),
    authProviders: Array.isArray(userDoc.authProviders) ? userDoc.authProviders : [],
    providerProfile: json.providerProfile || null,
    preferences: json.preferences || { amenities: [], equipments: [], services: [] },
    stripeConnect: {
      connected: Boolean(stripe.accountId),
      chargesEnabled: Boolean(stripe.chargesEnabled),
      payoutsEnabled: Boolean(stripe.payoutsEnabled),
      detailsSubmitted: Boolean(stripe.detailsSubmitted),
      onboardedAt: stripe.onboardedAt || null,
    },
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
    stats,
  };
}

async function buildUserStatsMap(userIds = []) {
  const map = new Map();
  if (!Array.isArray(userIds) || userIds.length === 0) return map;

  const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const [listingRows, draftRows, guestRows, hostRows, reviewRows] = await Promise.all([
    Listing.aggregate([
      { $match: { createdBy: { $in: ids } } },
      {
        $group: {
          _id: '$createdBy',
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
        },
      },
    ]),
    DraftListing.aggregate([
      { $match: { createdBy: { $in: ids } } },
      { $group: { _id: '$createdBy', total: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { bookedBy: { $in: ids } } },
      { $group: { _id: '$bookedBy', total: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { host: { $in: ids } } },
      { $group: { _id: '$host', total: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: { host: { $in: ids } } },
      {
        $group: {
          _id: '$host',
          count: { $sum: 1 },
          average: { $avg: '$overallRating' },
        },
      },
    ]),
  ]);

  const getOrInit = (id) => {
    const key = String(id);
    if (!map.has(key)) map.set(key, emptyUserStats());
    return map.get(key);
  };

  listingRows.forEach((row) => {
    const stats = getOrInit(row._id);
    stats.listings.total = row.total;
    stats.listings.active = row.active;
    stats.listings.inactive = row.total - row.active;
  });
  draftRows.forEach((row) => {
    getOrInit(row._id).listings.draft = row.total;
  });
  guestRows.forEach((row) => {
    getOrInit(row._id).bookings.asGuest = row.total;
  });
  hostRows.forEach((row) => {
    getOrInit(row._id).bookings.asHost = row.total;
  });
  reviewRows.forEach((row) => {
    const stats = getOrInit(row._id);
    stats.rating.count = row.count;
    stats.rating.average = roundRating(row.average);
  });

  return map;
}

async function listUsersForAdmin({ page = 1, limit = 10, role, search } = {}) {
  const skip = (page - 1) * limit;

  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalizedRole && normalizedRole !== 'all' && !AVAILABLE_ROLES.includes(normalizedRole)) {
    throw new ApiError(
      400,
      `Invalid role. Allowed values: all, ${AVAILABLE_ROLES.join(', ')}.`
    );
  }

  const filter = {};
  const trimmedSearch = typeof search === 'string' ? search.trim() : '';
  if (trimmedSearch) {
    const regex = new RegExp(escapeRegex(trimmedSearch), 'i');
    filter.$or = ADMIN_USER_SEARCH_FIELDS.map((field) => ({ [field]: regex }));
  }
  const listFilter =
    normalizedRole && normalizedRole !== 'all'
      ? { ...filter, role: normalizedRole }
      : filter;

  const [users, roleRows] = await Promise.all([
    User.find(listFilter)
      .select(ADMIN_USER_SELECT)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.aggregate([
      { $match: filter },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
  ]);

  const tabs = { all: 0 };
  AVAILABLE_ROLES.forEach((value) => {
    tabs[value] = 0;
  });
  roleRows.forEach((row) => {
    if (row._id in tabs) tabs[row._id] = row.count;
    tabs.all += row.count;
  });
  const total =
    normalizedRole && normalizedRole !== 'all' ? tabs[normalizedRole] : tabs.all;

  const statsMap = await buildUserStatsMap(users.map((user) => user._id));

  const totalPages = Math.ceil(total / limit);
  return {
    users: users.map((user) =>
      serializeAdminUser(user, statsMap.get(String(user._id)) || emptyUserStats())
    ),
    tabs,
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

async function getUserForAdmin(userId) {
  const objectId = toObjectId(userId, 'user ID');
  const user = await User.findById(objectId).select(ADMIN_USER_SELECT);
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const [statsMap, guestStatusRows, hostStatusRows, reviewsWritten] = await Promise.all([
    buildUserStatsMap([objectId]),
    Booking.aggregate([
      { $match: { bookedBy: objectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { host: objectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Review.countDocuments({ reviewer: objectId }),
  ]);

  const base = statsMap.get(String(objectId)) || emptyUserStats();
  const asGuestByStatus = emptyBookingsByStatus();
  guestStatusRows.forEach((row) => {
    asGuestByStatus[row._id] = row.count;
  });
  const asHostByStatus = emptyBookingsByStatus();
  hostStatusRows.forEach((row) => {
    asHostByStatus[row._id] = row.count;
  });

  return serializeAdminUser(user, {
    ...base,
    bookings: {
      ...base.bookings,
      asGuestByStatus,
      asHostByStatus,
    },
    reviewsWritten,
  });
}

// ---------------------------------------------------------------------------
// Admin: edit + delete a user
// ---------------------------------------------------------------------------

const ACTIVE_BOOKING_STATUSES = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.AWAITING_HOST_APPROVAL,
  BOOKING_STATUS.CONFIRMED,
];

function mergeProfile(user, validatedPayload) {
  const profile = {
    firstName: user.providerProfile?.firstName || '',
    lastName: user.providerProfile?.lastName || '',
    phoneNumber: user.providerProfile?.phoneNumber || '',
    dateOfBirth: user.providerProfile?.dateOfBirth,
    bio: user.providerProfile?.bio || '',
    profileImage: user.providerProfile?.profileImage || '',
    businessName: user.providerProfile?.businessName || user.agencyName || '',
    businessType: user.providerProfile?.businessType || '',
    location: {
      addressLine1: user.providerProfile?.location?.addressLine1 || '',
      addressLine2: user.providerProfile?.location?.addressLine2 || '',
      city: user.providerProfile?.location?.city || user.city || '',
      state: user.providerProfile?.location?.state || '',
      postalCode: user.providerProfile?.location?.postalCode || '',
      country: user.providerProfile?.location?.country || '',
    },
  };

  const direct = ['firstName', 'lastName', 'phoneNumber', 'dateOfBirth', 'bio', 'profileImage', 'businessName', 'businessType'];
  direct.forEach((key) => {
    if (validatedPayload[key] !== undefined) profile[key] = validatedPayload[key];
  });
  const location = ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'];
  location.forEach((key) => {
    if (validatedPayload[key] !== undefined) profile.location[key] = validatedPayload[key];
  });

  return profile;
}

async function updateUserForAdmin(userId, payload, actingAdminId) {
  const objectId = toObjectId(userId, 'user ID');
  const validatedPayload = validateAdminUserUpdatePayload(payload);

  const user = await User.findById(objectId);
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const isSelf = String(user._id) === String(actingAdminId);
  if (
    isSelf &&
    validatedPayload.role !== undefined &&
    validatedPayload.role !== USER_ROLES.ADMIN
  ) {
    throw new ApiError(400, 'You cannot change your own admin role.');
  }

  if (validatedPayload.email && validatedPayload.email !== user.email) {
    const existingUser = await User.findOne({
      email: validatedPayload.email,
      _id: { $ne: user._id },
    }).select('_id');

    if (existingUser) {
      throw new ApiError(409, 'An account with this email already exists.');
    }

    user.email = validatedPayload.email;
  }

  const profile = mergeProfile(user, validatedPayload);

  if (validatedPayload.agencyName !== undefined) {
    user.agencyName = validatedPayload.agencyName;
  } else if (profile.businessName) {
    user.agencyName = profile.businessName;
  }
  if (profile.location.city) {
    user.city = profile.location.city;
  }
  if (validatedPayload.role !== undefined) user.role = validatedPayload.role;
  if (validatedPayload.isEmailVerified !== undefined) {
    user.isEmailVerified = validatedPayload.isEmailVerified;
  }
  if (validatedPayload.twoFactorEnabled !== undefined) {
    user.twoFactorEnabled = validatedPayload.twoFactorEnabled;
  }

  user.providerProfile = profile;
  await user.save();

  return getUserForAdmin(objectId);
}

async function deleteUserForAdmin(userId, actingAdminId) {
  const objectId = toObjectId(userId, 'user ID');

  if (String(objectId) === String(actingAdminId)) {
    throw new ApiError(400, 'You cannot delete your own account.');
  }

  const user = await User.findById(objectId).select('_id role');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const activeBookings = await Booking.countDocuments({
    status: { $in: ACTIVE_BOOKING_STATUSES },
    $or: [{ bookedBy: objectId }, { host: objectId }],
  });
  if (activeBookings > 0) {
    throw new ApiError(
      409,
      `This user has ${activeBookings} active booking(s). Resolve them before deleting the account.`
    );
  }

  const listings = await Listing.find({ createdBy: objectId }).select('_id photos');
  const listingIds = listings.map((listing) => listing._id);

  const [listingResult, draftResult, wishlistResult] = await Promise.all([
    Listing.deleteMany({ _id: { $in: listingIds } }),
    DraftListing.deleteMany({ createdBy: objectId }),
    Wishlist.deleteMany({
      $or: [{ user: objectId }, { listing: { $in: listingIds } }],
    }),
    ListingView.deleteMany({
      $or: [{ host: objectId }, { listing: { $in: listingIds } }],
    }),
  ]);

  await User.deleteOne({ _id: objectId });

  // Best-effort: remove locally stored listing photos that nothing references anymore.
  await Promise.all(listings.map((listing) => cleanupUnusedListingPhotos(listing.photos)));

  return {
    id: String(objectId),
    deleted: {
      listings: listingResult.deletedCount || 0,
      draftListings: draftResult.deletedCount || 0,
      wishlists: wishlistResult.deletedCount || 0,
    },
  };
}

module.exports = {
  saveUserPreferences,
  updateProviderProfile,
  updateUserProfile,
  updateUserProfileImage,
  listUsersForAdmin,
  getUserForAdmin,
  updateUserForAdmin,
  deleteUserForAdmin,
};
