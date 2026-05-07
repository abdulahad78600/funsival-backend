const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const chatsController = require('./chats.controller');

const router = express.Router();

router.use(authenticate);

router.post('/token', chatsController.issueFirebaseTokenHandler);

router.post('/conversations', chatsController.startConversationHandler);
router.get('/conversations', chatsController.listConversationsHandler);
router.get('/conversations/:conversationId', chatsController.getConversationHandler);

router.post('/conversations/:conversationId/messages', chatsController.sendMessageHandler);
router.get('/conversations/:conversationId/messages', chatsController.listMessagesHandler);
router.patch(
  '/conversations/:conversationId/messages/:messageId',
  chatsController.editMessageHandler
);
router.delete(
  '/conversations/:conversationId/messages/:messageId',
  chatsController.deleteMessageHandler
);
router.patch('/conversations/:conversationId/read', chatsController.markReadHandler);

module.exports = router;
