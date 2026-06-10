const mongoose = require('mongoose');

const ApiError = require('../../utils/api-error');

const MESSAGE_TYPES = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  FILE: 'file',
});

const AVAILABLE_MESSAGE_TYPES = Object.values(MESSAGE_TYPES);
const MEDIA_MESSAGE_TYPES = new Set([
  MESSAGE_TYPES.IMAGE,
  MESSAGE_TYPES.VIDEO,
  MESSAGE_TYPES.FILE,
]);
const MAX_TEXT_LENGTH = 4000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

function validateUserId(userId) {
  if (!isValidObjectId(userId)) {
    throw new ApiError(400, 'Invalid user ID.');
  }
  return userId;
}

function validateConversationId(conversationId) {
  const id = normalizeString(conversationId);
  if (!id) {
    throw new ApiError(400, 'Conversation ID is required.');
  }
  return id;
}

function validateStartConversationPayload(payload = {}) {
  const errors = {};

  const recipientId = normalizeString(payload.recipientId);
  const listingId = payload.listingId ? normalizeString(payload.listingId) : null;
  const initialMessage = normalizeString(payload.initialMessage);

  if (!recipientId) {
    errors.recipientId = 'Recipient ID is required.';
  } else if (!isValidObjectId(recipientId)) {
    errors.recipientId = 'Recipient ID is invalid.';
  }

  if (listingId && !isValidObjectId(listingId)) {
    errors.listingId = 'Listing ID is invalid.';
  }

  if (initialMessage && initialMessage.length > MAX_TEXT_LENGTH) {
    errors.initialMessage = `Message cannot exceed ${MAX_TEXT_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    recipientId,
    listingId: listingId || null,
    initialMessage: initialMessage || null,
  };
}

function validateMessageId(messageId) {
  const id = normalizeString(messageId);
  if (!id) {
    throw new ApiError(400, 'Message ID is required.');
  }
  return id;
}

function validateEditMessagePayload(payload = {}) {
  const text = normalizeString(payload.text);

  if (!text) {
    throw new ApiError(400, 'Validation failed.', { text: 'Message text is required.' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new ApiError(400, 'Validation failed.', {
      text: `Message cannot exceed ${MAX_TEXT_LENGTH} characters.`,
    });
  }

  return { text };
}

function validateSendMessagePayload(payload = {}) {
  const errors = {};

  const type = normalizeString(payload.type).toLowerCase() || MESSAGE_TYPES.TEXT;
  const text = normalizeString(payload.text);
  const mediaUrl = normalizeString(payload.mediaUrl);
  const thumbnailUrl = normalizeString(payload.thumbnailUrl);
  const mimeType = normalizeString(payload.mimeType);
  const fileName = normalizeString(payload.fileName);
  const fileSize =
    payload.fileSize === undefined || payload.fileSize === null
      ? null
      : Number(payload.fileSize);

  if (!AVAILABLE_MESSAGE_TYPES.includes(type)) {
    errors.type = `Message type must be one of: ${AVAILABLE_MESSAGE_TYPES.join(', ')}.`;
  }

  if (type === MESSAGE_TYPES.TEXT) {
    if (!text) {
      errors.text = 'Message text is required.';
    } else if (text.length > MAX_TEXT_LENGTH) {
      errors.text = `Message cannot exceed ${MAX_TEXT_LENGTH} characters.`;
    }
  }

  if (MEDIA_MESSAGE_TYPES.has(type)) {
    if (!mediaUrl) {
      errors.mediaUrl = 'Media URL is required for image, video, or file messages.';
    } else if (!/^https?:\/\//i.test(mediaUrl)) {
      errors.mediaUrl = 'Media URL must be a valid http(s) URL.';
    }
  }

  if (fileSize !== null && (!Number.isFinite(fileSize) || fileSize < 0)) {
    errors.fileSize = 'File size must be a non-negative number.';
  }

  if (text && text.length > MAX_TEXT_LENGTH) {
    errors.text = `Message caption cannot exceed ${MAX_TEXT_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'Validation failed.', errors);
  }

  return {
    type,
    text: text || null,
    mediaUrl: mediaUrl || null,
    thumbnailUrl: thumbnailUrl || null,
    mimeType: mimeType || null,
    fileName: fileName || null,
    fileSize: fileSize !== null && Number.isFinite(fileSize) ? fileSize : null,
  };
}

module.exports = {
  MESSAGE_TYPES,
  AVAILABLE_MESSAGE_TYPES,
  validateUserId,
  validateConversationId,
  validateMessageId,
  validateEditMessagePayload,
  validateStartConversationPayload,
  validateSendMessagePayload,
};
