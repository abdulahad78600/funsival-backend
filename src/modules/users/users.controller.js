const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const { uploadFileToSpaces } = require('../../services/do-spaces.upload');
const {
  saveUserPreferences,
  updateProviderProfile,
  updateUserProfileImage,
} = require('./users.service');

const savePreferencesHandler = asyncHandler(async (req, res) => {
  const { amenities = [], equipments = [], services = [] } = req.body;

  const user = await saveUserPreferences(req.user.id, { amenities, equipments, services });

  res.status(200).json({
    success: true,
    message: 'Preferences saved successfully.',
    data: { preferences: user.preferences },
  });
});

const updateProviderProfileHandler = asyncHandler(async (req, res) => {
  const user = await updateProviderProfile(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: 'Provider profile updated successfully.',
    data: { user },
  });
});

const uploadProfilePictureHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'Profile picture file is required.');
  }

  const uploaded = await uploadFileToSpaces(req.file, 'profile-pictures');
  const user = await updateUserProfileImage(req.user.id, uploaded.url);

  res.status(200).json({
    success: true,
    message: 'Profile picture uploaded successfully.',
    data: {
      profileImage: uploaded.url,
      image: uploaded,
      user,
    },
  });
});

module.exports = {
  savePreferencesHandler,
  updateProviderProfileHandler,
  uploadProfilePictureHandler,
};
