const stripe = require('../../services/stripe.client');
const env = require('../../config/env');
const paymentsService = require('./payments.service');

function constructEvent(rawBody, signature, secret) {
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

async function dispatchEvent(event) {
  switch (event.type) {
    case 'payment_intent.amount_capturable_updated': {
      await paymentsService.handlePaymentIntentAuthorized(event.data.object);
      return;
    }
    case 'payment_intent.canceled': {
      await paymentsService.handlePaymentIntentCanceled(event.data.object);
      return;
    }
    case 'payment_intent.succeeded': {
      await paymentsService.handlePaymentIntentSucceeded(event.data.object);
      return;
    }
    case 'checkout.session.completed': {
      const obj = event.data.object;
      const paymentIntentId =
        typeof obj.payment_intent === 'string'
          ? obj.payment_intent
          : obj.payment_intent && obj.payment_intent.id;
      if (!paymentIntentId) return;
      const stripeAccount = event.account;
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        stripeAccount ? { stripeAccount } : undefined
      );
      if (paymentIntent.status === 'requires_capture') {
        await paymentsService.handlePaymentIntentAuthorized(paymentIntent);
      } else if (paymentIntent.status === 'succeeded') {
        await paymentsService.handlePaymentIntentSucceeded(paymentIntent);
      }
      return;
    }
    case 'charge.refunded':
      await paymentsService.handleChargeRefunded(event.data.object);
      return;
    case 'charge.dispute.created':
    case 'charge.dispute.funds_withdrawn':
      await paymentsService.handleChargeDispute(event.data.object);
      return;
    case 'payout.paid':
      await paymentsService.handlePayoutPaid(event.data.object);
      return;
    case 'account.updated':
      await paymentsService.syncConnectedAccountFromEvent(event.data.object);
      return;
    default:
      return;
  }
}

async function platformWebhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = constructEvent(req.body, signature, env.stripe.webhookSecret);
  } catch (error) {
    console.error('[stripe webhook] platform signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    await dispatchEvent(event);
  } catch (error) {
    console.error('[stripe webhook] platform handler error:', error);
    return res.status(500).send('Webhook handler error');
  }

  return res.status(200).json({ received: true });
}

async function connectWebhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = constructEvent(req.body, signature, env.stripe.connectWebhookSecret);
  } catch (error) {
    console.error('[stripe webhook] connect signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    await dispatchEvent(event);
  } catch (error) {
    console.error('[stripe webhook] connect handler error:', error);
    return res.status(500).send('Webhook handler error');
  }

  return res.status(200).json({ received: true });
}

module.exports = {
  platformWebhookHandler,
  connectWebhookHandler,
};
