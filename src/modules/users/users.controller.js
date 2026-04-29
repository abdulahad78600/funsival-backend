const asyncHandler = require('../../utils/async-handler');
const { saveUserPreferences, updateProviderProfile } = require('./users.service');

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

module.exports = {
  savePreferencesHandler,
  updateProviderProfileHandler,
};
