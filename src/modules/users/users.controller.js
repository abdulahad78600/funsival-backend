const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const { uploadFileToSpaces } = require('../../services/do-spaces.upload');
const {
  saveUserPreferences,
  updateProviderProfile,
  becomeProvider,
  updateUserProfile,
  updateUserProfileImage,
  listUsersForAdmin,
  getUserForAdmin,
  updateUserForAdmin,
  deleteUserForAdmin,
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

const becomeProviderHandler = asyncHandler(async (req, res) => {
  const result = await becomeProvider(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: 'You are now a provider on Funsival.',
    data: result,
  });
});

const updateUserProfileHandler = asyncHandler(async (req, res) => {
  const user = await updateUserProfile(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully.',
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

const listAdminUsersHandler = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const { role, search } = req.query;

  const result = await listUsersForAdmin({ page, limit, role, search });

  res.status(200).json({
    success: true,
    message: 'Users fetched successfully.',
    data: result,
  });
});

const getAdminUserHandler = asyncHandler(async (req, res) => {
  const user = await getUserForAdmin(req.params.userId);

  res.status(200).json({
    success: true,
    message: 'User fetched successfully.',
    data: { user },
  });
});

const updateAdminUserHandler = asyncHandler(async (req, res) => {
  const user = await updateUserForAdmin(req.params.userId, req.body, req.user.id);

  res.status(200).json({
    success: true,
    message: 'User updated successfully.',
    data: { user },
  });
});

const deleteAdminUserHandler = asyncHandler(async (req, res) => {
  const result = await deleteUserForAdmin(req.params.userId, req.user.id);

  res.status(200).json({
    success: true,
    message: 'User deleted successfully.',
    data: result,
  });
});

module.exports = {
  savePreferencesHandler,
  updateProviderProfileHandler,
  becomeProviderHandler,
  updateUserProfileHandler,
  uploadProfilePictureHandler,
  listAdminUsersHandler,
  getAdminUserHandler,
  updateAdminUserHandler,
  deleteAdminUserHandler,
};
