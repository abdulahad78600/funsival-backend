const asyncHandler = require('../../utils/async-handler');
const ApiError = require('../../utils/api-error');
const {
  uploadFileToSpaces,
  resolveChatMediaType,
} = require('../../services/do-spaces.upload');
const {
  validateConversationId,
  validateMessageId,
  validateStartConversationPayload,
  validateSendMessagePayload,
  validateEditMessagePayload,
} = require('./chats.validation');
const {
  createFirebaseCustomToken,
  startOrGetConversation,
  sendMessage,
  listConversations,
  getConversationById,
  listMessages,
  markConversationAsRead,
  markMessageAsRead,
  editMessage,
  deleteMessage,
} = require('./chats.service');

function parsePaginationQuery(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit };
}

const issueFirebaseTokenHandler = asyncHandler(async (req, res) => {
  const token = await createFirebaseCustomToken(req.user);
  res.status(200).json({
    success: true,
    message: 'Firebase token issued.',
    data: { token, uid: req.user.id.toString() },
  });
});

const startConversationHandler = asyncHandler(async (req, res) => {
  const payload = validateStartConversationPayload(req.body);
  const conversation = await startOrGetConversation(req.user.id, payload);

  res.status(200).json({
    success: true,
    message: 'Conversation ready.',
    data: { conversation },
  });
});

const listConversationsHandler = asyncHandler(async (req, res) => {
  const pagination = parsePaginationQuery(req.query);
  const result = await listConversations(req.user.id, pagination);

  res.status(200).json({
    success: true,
    message: 'Conversations fetched successfully.',
    data: result,
  });
});

const getConversationHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  const conversation = await getConversationById(req.user.id, conversationId);

  res.status(200).json({
    success: true,
    message: 'Conversation fetched successfully.',
    data: { conversation },
  });
});

const sendMessageHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  const payload = validateSendMessagePayload(req.body);
  const message = await sendMessage(req.user.id, conversationId, payload);

  res.status(201).json({
    success: true,
    message: 'Message sent successfully.',
    data: { message },
  });
});

const listMessagesHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const before = req.query.before || null;
  const result = await listMessages(req.user.id, conversationId, { limit, before });

  res.status(200).json({
    success: true,
    message: 'Messages fetched successfully.',
    data: result,
  });
});

const markReadHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  await markConversationAsRead(req.user.id, conversationId);

  res.status(200).json({
    success: true,
    message: 'Conversation marked as read.',
  });
});

const markMessageReadHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  const messageId = validateMessageId(req.params.messageId);
  const message = await markMessageAsRead(req.user.id, conversationId, messageId);

  res.status(200).json({
    success: true,
    message: 'Message marked as read.',
    data: { message },
  });
});

const editMessageHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  const messageId = validateMessageId(req.params.messageId);
  const payload = validateEditMessagePayload(req.body);
  const message = await editMessage(req.user.id, conversationId, messageId, payload);

  res.status(200).json({
    success: true,
    message: 'Message updated successfully.',
    data: { message },
  });
});

const uploadChatMediaHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'A media file is required (form field: "file").');
  }

  const mediaType = resolveChatMediaType(req.file.mimetype);
  if (!mediaType) {
    throw new ApiError(400, 'Unsupported media type.');
  }

  const uploaded = await uploadFileToSpaces(req.file, `chats/${mediaType}s`);

  res.status(201).json({
    success: true,
    message: 'Chat media uploaded successfully.',
    data: {
      mediaType,
      mediaUrl: uploaded.url,
      mimeType: uploaded.contentType,
      fileName: req.file.originalname,
      fileSize: uploaded.size,
    },
  });
});

const deleteMessageHandler = asyncHandler(async (req, res) => {
  const conversationId = validateConversationId(req.params.conversationId);
  const messageId = validateMessageId(req.params.messageId);
  const message = await deleteMessage(req.user.id, conversationId, messageId);

  res.status(200).json({
    success: true,
    message: 'Message deleted successfully.',
    data: { message },
  });
});

module.exports = {
  issueFirebaseTokenHandler,
  startConversationHandler,
  listConversationsHandler,
  getConversationHandler,
  sendMessageHandler,
  listMessagesHandler,
  markReadHandler,
  markMessageReadHandler,
  editMessageHandler,
  deleteMessageHandler,
  uploadChatMediaHandler,
};
