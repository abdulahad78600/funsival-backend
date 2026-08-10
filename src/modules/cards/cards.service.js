const stripe = require('../../services/stripe.client');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');

async function getOrCreatePlatformCustomer(user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name:
      (user.providerProfile &&
        [user.providerProfile.firstName, user.providerProfile.lastName]
          .filter(Boolean)
          .join(' ')
          .trim()) ||
      user.agencyName ||
      undefined,
    metadata: { userId: String(user._id) },
  });

  user.stripeCustomerId = customer.id;
  await user.save();

  return customer.id;
}

async function loadUserWithStripe(userId) {
  const user = await User.findById(userId).select(
    '+stripeCustomerId +defaultPaymentMethodId email providerProfile agencyName'
  );
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  return user;
}

function serializeCard(paymentMethod, defaultPaymentMethodId) {
  const card = paymentMethod.card || {};
  return {
    id: paymentMethod.id,
    brand: card.brand || null,
    last4: card.last4 || null,
    expMonth: card.exp_month || null,
    expYear: card.exp_year || null,
    funding: card.funding || null,
    country: card.country || null,
    isDefault: paymentMethod.id === defaultPaymentMethodId,
    createdAt: paymentMethod.created
      ? new Date(paymentMethod.created * 1000).toISOString()
      : null,
  };
}

async function createSetupIntent(userId) {
  const user = await loadUserWithStripe(userId);
  const customerId = await getOrCreatePlatformCustomer(user);

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    // Saved cards are later confirmed server-side without a return_url, so
    // keep redirect-based payment methods out of the save-card flow too.
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never',
    },
    metadata: { userId: String(user._id) },
  });

  return {
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
    customerId,
  };
}

async function listCards(userId) {
  const user = await loadUserWithStripe(userId);
  if (!user.stripeCustomerId) {
    return { cards: [], defaultPaymentMethodId: null };
  }

  const paymentMethods = await stripe.paymentMethods.list({
    customer: user.stripeCustomerId,
    type: 'card',
    limit: 100,
  });

  return {
    cards: paymentMethods.data.map((pm) => serializeCard(pm, user.defaultPaymentMethodId)),
    defaultPaymentMethodId: user.defaultPaymentMethodId || null,
  };
}

async function assertOwnedCard(user, paymentMethodId) {
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (!user.stripeCustomerId || paymentMethod.customer !== user.stripeCustomerId) {
    throw new ApiError(403, 'This card does not belong to you.');
  }
  return paymentMethod;
}

async function setDefaultCard(userId, paymentMethodId) {
  const user = await loadUserWithStripe(userId);
  await assertOwnedCard(user, paymentMethodId);

  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  user.defaultPaymentMethodId = paymentMethodId;
  await user.save();

  return { defaultPaymentMethodId: paymentMethodId };
}

async function deleteCard(userId, paymentMethodId) {
  const user = await loadUserWithStripe(userId);
  await assertOwnedCard(user, paymentMethodId);

  await stripe.paymentMethods.detach(paymentMethodId);

  if (user.defaultPaymentMethodId === paymentMethodId) {
    user.defaultPaymentMethodId = null;
    await user.save();
  }

  return { success: true };
}

module.exports = {
  createSetupIntent,
  listCards,
  setDefaultCard,
  deleteCard,
  getOrCreatePlatformCustomer,
};
