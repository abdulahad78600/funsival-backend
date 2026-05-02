const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const { USER_ROLES } = require('../../constants/roles');
const { validateProviderProfilePayload } = require('./users.validation');

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

module.exports = {
  saveUserPreferences,
  updateProviderProfile,
};
