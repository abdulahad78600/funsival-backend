const LISTING_CATEGORIES = Object.freeze({
  ACTIVITY: 'activity',
  PLACE: 'place',
  EQUIPMENT: 'equipment',
});

const AVAILABLE_LISTING_CATEGORIES = Object.values(LISTING_CATEGORIES);

function normalizeCategory(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

module.exports = {
  LISTING_CATEGORIES,
  AVAILABLE_LISTING_CATEGORIES,
  normalizeCategory,
};
