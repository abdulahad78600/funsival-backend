const NewsletterSubscriber = require('../../models/newsletter-subscriber.model');
const ApiError = require('../../utils/api-error');

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'Validation failed.', {
      email: 'A valid email address is required.',
    });
  }
  return email;
}

// Idempotent: re-subscribing an existing or previously unsubscribed email is fine.
async function subscribe({ email, source } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await NewsletterSubscriber.findOne({ email: normalizedEmail });

  if (existing) {
    if (existing.isActive) {
      return { subscriber: existing.toJSON(), alreadySubscribed: true };
    }
    existing.isActive = true;
    existing.unsubscribedAt = null;
    await existing.save();
    return { subscriber: existing.toJSON(), alreadySubscribed: false };
  }

  const subscriber = await NewsletterSubscriber.create({
    email: normalizedEmail,
    ...(typeof source === 'string' && source.trim() ? { source: source.trim() } : {}),
  });
  return { subscriber: subscriber.toJSON(), alreadySubscribed: false };
}

async function unsubscribe({ email } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const subscriber = await NewsletterSubscriber.findOne({ email: normalizedEmail });

  if (!subscriber) {
    throw new ApiError(404, 'This email is not subscribed.');
  }
  if (subscriber.isActive) {
    subscriber.isActive = false;
    subscriber.unsubscribedAt = new Date();
    await subscriber.save();
  }
  return subscriber.toJSON();
}

async function listSubscribersForAdmin({ page = 1, limit = 20, status = 'active', search } = {}) {
  const skip = (page - 1) * limit;
  const filter = {};

  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : 'active';
  if (!['all', 'active', 'inactive'].includes(normalizedStatus)) {
    throw new ApiError(400, 'Invalid status. Allowed values: all, active, inactive.');
  }
  if (normalizedStatus !== 'all') filter.isActive = normalizedStatus === 'active';

  const term = typeof search === 'string' ? search.trim() : '';
  if (term) {
    filter.email = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const [subscribers, total] = await Promise.all([
    NewsletterSubscriber.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    NewsletterSubscriber.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);
  return {
    subscribers: subscribers.map((subscriber) => subscriber.toJSON()),
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

module.exports = {
  subscribe,
  unsubscribe,
  listSubscribersForAdmin,
};
