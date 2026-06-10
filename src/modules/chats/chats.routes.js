const express = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const { chatMediaUpload } = require('../../services/do-spaces.upload');
const chatsController = require('./chats.controller');

const router = express.Router();

router.use(authenticate);

router.post('/token', chatsController.issueFirebaseTokenHandler);

router.post(
  '/media',
  chatMediaUpload.single('file'),
  chatsController.uploadChatMediaHandler
);

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
router.patch(
  '/conversations/:conversationId/messages/:messageId/read',
  chatsController.markMessageReadHandler
);

module.exports = router;
