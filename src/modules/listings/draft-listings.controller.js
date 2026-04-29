const asyncHandler = require('../../utils/async-handler');
const { saveDraft, getDraft, discardDraft } = require('./draft-listings.service');

const saveDraftHandler = asyncHandler(async (req, res) => {
  const draft = await saveDraft(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: 'Draft saved successfully.',
    data: { draft },
  });
});

const getDraftHandler = asyncHandler(async (req, res) => {
  const draft = await getDraft(req.user.id);

  res.status(200).json({
    success: true,
    message: draft ? 'Draft fetched successfully.' : 'No draft found.',
    data: { draft },
  });
});

const discardDraftHandler = asyncHandler(async (req, res) => {
  await discardDraft(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Draft discarded successfully.',
  });
});

module.exports = { saveDraftHandler, getDraftHandler, discardDraftHandler };
