const test = require('node:test');
const assert = require('node:assert/strict');

const listingsService = require('../src/modules/listings/listings.service');
const faqsService = require('../src/modules/faqs/faqs.service');
const newsletterService = require('../src/modules/newsletter/newsletter.service');
const Listing = require('../src/models/listing.model');
const Faq = require('../src/models/faq.model');
const NewsletterSubscriber = require('../src/models/newsletter-subscriber.model');

function chainableQuery(result) {
  const query = {
    populate: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    select: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

test('landing search: location + date range map to placeLocation and availability filters', async () => {
  const originalFind = Listing.find;
  const originalCount = Listing.countDocuments;
  let received;
  Listing.find = (filter) => {
    received = filter;
    return chainableQuery([]);
  };
  Listing.countDocuments = async () => 0;

  const toDateOnly = (date) => date.toISOString().slice(0, 10);
  const addDays = (days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };
  const fromInput = toDateOnly(addDays(1));
  const untilInput = toDateOnly(addDays(3));

  try {
    await listingsService.browseListings({
      location: 'Lahore',
      from: fromInput,
      until: untilInput,
      search: 'cave',
    });

    assert.equal(received.isActive, true);
    const locationClause = received.$and.find((c) =>
      c.$or.some((o) => o['placeLocation.city'])
    );
    assert.ok(locationClause, 'location clause present');
    assert.ok(locationClause.$or.some((o) => o['placeLocation.country']));
    const searchClause = received.$and.find((c) =>
      c.$or.some((o) => o['basicInformation.activityTitle'])
    );
    assert.ok(searchClause, 'search clause still present alongside location');

    const slot = received.availability.$elemMatch;
    assert.equal(slot.date.$gte.toISOString(), `${fromInput}T00:00:00.000Z`);
    assert.equal(slot.date.$lt.toISOString(), `${toDateOnly(addDays(4))}T00:00:00.000Z`);
    assert.deepEqual(slot.isAvailable, { $ne: false });

    // No explicit from/until still requires at least one upcoming slot, not any slot.
    await listingsService.browseListings({});
    const todayStr = toDateOnly(new Date());
    assert.equal(received.availability.$elemMatch.date.$gte.toISOString(), `${todayStr}T00:00:00.000Z`);
    assert.equal(received.availability.$elemMatch.date.$lt, undefined);

    await assert.rejects(
      () => listingsService.browseListings({ from: 'not-a-date' }),
      /`from` must be a valid date/
    );
    await assert.rejects(
      () => listingsService.browseListings({ from: toDateOnly(addDays(5)), until: toDateOnly(addDays(1)) }),
      /`until` must be on or after `from`/
    );
  } finally {
    Listing.find = originalFind;
    Listing.countDocuments = originalCount;
  }
});

test('landing: browse types and destinations aggregate active listings with cover images', async () => {
  const originalAggregate = Listing.aggregate;
  const pipelines = [];
  Listing.aggregate = async (pipeline) => {
    pipelines.push(pipeline);
    if (pipeline[1].$group._id.type) {
      return [
        { _id: { category: 'activity', type: 'scuba_diving' }, count: 4, coverPhotos: ['https://cdn/x.jpg'] },
        { _id: { category: 'place', type: 'mountain' }, count: 2, coverPhotos: [] },
      ];
    }
    return [
      { _id: { city: 'lahore', country: 'pakistan' }, city: 'Lahore', state: 'Punjab', country: 'Pakistan', count: 6, coverPhotos: ['https://cdn/l.jpg'] },
    ];
  };

  try {
    const types = await listingsService.getBrowseTypes({ category: 'activities', limit: 5 });
    assert.equal(pipelines[0][0].$match.isActive, true);
    assert.equal(pipelines[0][0].$match.category, 'activity');
    assert.deepEqual(types[0], {
      category: 'activity',
      type: 'scuba_diving',
      label: 'Scuba Diving',
      count: 4,
      coverImage: 'https://cdn/x.jpg',
    });
    assert.equal(types[1].coverImage, null);

    const destinations = await listingsService.getBrowseDestinations({ limit: 3 });
    assert.equal(pipelines[1][0].$match.isActive, true);
    assert.deepEqual(destinations, [
      { city: 'Lahore', state: 'Punjab', country: 'Pakistan', count: 6, coverImage: 'https://cdn/l.jpg' },
    ]);

    // Landing search: location + date range narrow both aggregations the
    // same way browseListings does.
    const addDays = (days) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    await listingsService.getBrowseTypes({ location: 'Lahore', from: addDays(1), until: addDays(3) });
    const typesMatch = pipelines[pipelines.length - 1][0].$match;
    assert.ok(typesMatch.$and[0].$or.some((o) => o['placeLocation.city']));
    assert.ok(typesMatch.availability.$elemMatch.date.$gte instanceof Date);
    assert.ok(typesMatch.availability.$elemMatch.date.$lt instanceof Date);
    assert.deepEqual(typesMatch.availability.$elemMatch.isAvailable, { $ne: false });

    await listingsService.getBrowseDestinations({ location: 'Lahore' });
    const destinationsMatch = pipelines[pipelines.length - 1][0].$match;
    assert.ok(destinationsMatch.$and[0].$or.some((o) => o['placeLocation.city']));
  } finally {
    Listing.aggregate = originalAggregate;
  }
});

test('faqs: public list is active-only and payload validation guards create/update', async () => {
  const originalFind = Faq.find;
  let received;
  Faq.find = (filter) => {
    received = filter;
    return chainableQuery([{ toJSON: () => ({ id: '1', question: 'Q', answer: 'A' }) }]);
  };

  try {
    const faqs = await faqsService.listPublicFaqs();
    assert.deepEqual(received, { isActive: true });
    assert.equal(faqs[0].question, 'Q');
  } finally {
    Faq.find = originalFind;
  }

  assert.throws(
    () => faqsService.validateFaqPayload({ question: 'Only a question' }),
    (error) => error.statusCode === 400 && /answer is required/.test(error.details.answer)
  );
  assert.throws(
    () => faqsService.validateFaqPayload({ order: -1 }, { partial: true }),
    (error) => /non-negative integer/.test(error.details.order)
  );
  assert.throws(
    () => faqsService.validateFaqPayload({}, { partial: true }),
    (error) => /At least one field/.test(error.details.payload)
  );
  assert.deepEqual(
    faqsService.validateFaqPayload({ question: ' Q? ', answer: ' A. ', order: '2', isActive: false }),
    { question: 'Q?', answer: 'A.', order: 2, isActive: false }
  );
});

test('newsletter: subscribe is idempotent, revives unsubscribed emails, and validates input', async () => {
  const originalFindOne = NewsletterSubscriber.findOne;
  const originalCreate = NewsletterSubscriber.create;
  let stored = null;
  let created = null;
  NewsletterSubscriber.findOne = async () => stored;
  NewsletterSubscriber.create = async (doc) => {
    created = doc;
    return { ...doc, id: 'n1', toJSON: () => ({ id: 'n1', ...doc }) };
  };

  try {
    await assert.rejects(
      () => newsletterService.subscribe({ email: 'nope' }),
      (error) => error.statusCode === 400 && /valid email/.test(error.details.email)
    );

    const first = await newsletterService.subscribe({ email: '  Fan@Example.COM ' });
    assert.equal(created.email, 'fan@example.com');
    assert.equal(first.alreadySubscribed, false);

    stored = { email: 'fan@example.com', isActive: true, toJSON: () => ({ id: 'n1', email: 'fan@example.com' }) };
    const again = await newsletterService.subscribe({ email: 'fan@example.com' });
    assert.equal(again.alreadySubscribed, true);

    let saved = false;
    stored = {
      email: 'fan@example.com',
      isActive: false,
      unsubscribedAt: new Date(),
      save: async () => { saved = true; },
      toJSON: () => ({ id: 'n1', email: 'fan@example.com' }),
    };
    const revived = await newsletterService.subscribe({ email: 'fan@example.com' });
    assert.equal(revived.alreadySubscribed, false);
    assert.equal(saved, true);
    assert.equal(stored.isActive, true);
    assert.equal(stored.unsubscribedAt, null);

    stored = null;
    await assert.rejects(
      () => newsletterService.unsubscribe({ email: 'ghost@example.com' }),
      /not subscribed/
    );
  } finally {
    NewsletterSubscriber.findOne = originalFindOne;
    NewsletterSubscriber.create = originalCreate;
  }
});
