const asyncHandler = require('../../utils/async-handler');
const { validateDashboardQuery } = require('./dashboard.validation');
const { getHostDashboardOverview } = require('./dashboard.service');

const getHostDashboardOverviewHandler = asyncHandler(async (req, res) => {
  const query = validateDashboardQuery(req.query);
  const overview = await getHostDashboardOverview(req.user._id, query);

  res.status(200).json({
    success: true,
    message: 'Host dashboard overview fetched.',
    data: overview,
  });
});

module.exports = { getHostDashboardOverviewHandler };
