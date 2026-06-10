const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const cardsController = require('./cards.controller');

const router = express.Router();

router.use(authenticate);

router.post('/setup-intent', cardsController.createSetupIntentHandler);
router.get('/', cardsController.listCardsHandler);
router.patch('/:paymentMethodId/default', cardsController.setDefaultCardHandler);
router.delete('/:paymentMethodId', cardsController.deleteCardHandler);

module.exports = router;
