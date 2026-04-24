const DraftListing = require('../../models/draft-listing.model');
const {
  deleteLocalListingPhotos,
  findUnusedLocalListingPhotos,
  normalizeListingPhotoReference,
  serializeListingRecord,
} = require('./listing-images');

async function cleanupUnusedDraftPhotos(photos = []) {
  try {
    const unusedPhotos = await findUnusedLocalListingPhotos(photos);
    await deleteLocalListingPhotos(unusedPhotos);
  } catch (error) {
    console.error('Failed to clean up draft listing images.', error);
  }
}

async function saveDraft(userId, payload) {
  const existingDraft = await DraftListing.findOne({ createdBy: userId });
  const { currentStep, ...draftData } = payload;
  const normalizedDraftData = {
    ...draftData,
    ...(Array.isArray(draftData.photos)
      ? { photos: draftData.photos.map((photo) => normalizeListingPhotoReference(photo)).filter(Boolean) }
      : {}),
  };

  const draft = await DraftListing.findOneAndUpdate(
    { createdBy: userId },
    { $set: { ...normalizedDraftData, currentStep, createdBy: userId } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  const removedPhotos = (existingDraft?.photos || []).filter(
    (photo) => !(draft.photos || []).includes(photo)
  );

  await cleanupUnusedDraftPhotos(removedPhotos);

  return serializeListingRecord(draft.toJSON());
}

async function getDraft(userId) {
  const draft = await DraftListing.findOne({ createdBy: userId });
  return draft ? serializeListingRecord(draft.toJSON()) : null;
}

async function discardDraft(userId) {
  const draft = await DraftListing.findOneAndDelete({ createdBy: userId });

  if (draft) {
    await cleanupUnusedDraftPhotos(draft.photos || []);
  }
}

module.exports = { saveDraft, getDraft, discardDraft };
