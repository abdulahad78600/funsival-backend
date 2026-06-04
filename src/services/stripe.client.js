const Stripe = require('stripe');
const env = require('../config/env');

if (!env.stripe.secretKey) {
  console.warn('[stripe] STRIPE_SECRET_KEY is not set. Payment endpoints will fail.');
}

const stripe = new Stripe(env.stripe.secretKey, {
  apiVersion: '2024-12-18.acacia',
  appInfo: {
    name: 'Funsival',
    version: '1.0.0',
  },
});

module.exports = stripe;
