const LISTING_CATEGORIES = Object.freeze({
  ACTIVITY: 'activity',
  PLACE: 'place',
  EQUIPMENT: 'equipment',
});

const AVAILABLE_LISTING_CATEGORIES = Object.values(LISTING_CATEGORIES);

function normalizeCategory(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case 'activities':
      return LISTING_CATEGORIES.ACTIVITY;
    case 'places':
      return LISTING_CATEGORIES.PLACE;
    case 'equipments':
      return LISTING_CATEGORIES.EQUIPMENT;
    default:
      return normalized;
  }
}

module.exports = {
  LISTING_CATEGORIES,
  AVAILABLE_LISTING_CATEGORIES,
  normalizeCategory,
};
