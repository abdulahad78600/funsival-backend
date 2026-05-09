const { admin, getFirestore, getAuth } = require('../../config/firebase');
const User = require('../../models/user.model');
const Listing = require('../../models/listing.model');
const ApiError = require('../../utils/api-error');
const { MESSAGE_TYPES } = require('./chats.validation');

const CONVERSATIONS_COLLECTION = 'conversations';
const MESSAGES_SUBCOLLECTION = 'messages';

function buildConversationId(userIdA, userIdB, listingId = null) {
  const sorted = [userIdA.toString(), userIdB.toString()].sort();
  const base = sorted.join('_');
  return listingId ? `${base}__${listingId}` : base;
}

function pickParticipantInfo(user) {
  const profile = user.providerProfile || {};
  const name =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
    user.agencyName ||
    user.email;

  return {
    id: user._id.toString(),
    name,
    email: user.email,
    role: user.role,
    profileImage: profile.profileImage || '',
  };
}

function serializeFirestoreTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeConversation(docId, data) {
  return {
    id: docId,
    participants: data.participants || [],
    participantInfo: data.participantInfo || {},
    listingId: data.listingId || null,
    lastMessage: data.lastMessage
      ? {
          ...data.lastMessage,
          createdAt: serializeFirestoreTimestamp(data.lastMessage.createdAt),
        }
      : null,
    lastMessageAt: serializeFirestoreTimestamp(data.lastMessageAt),
    unreadCount: data.unreadCount || {},
    createdAt: serializeFirestoreTimestamp(data.createdAt),
    updatedAt: serializeFirestoreTimestamp(data.updatedAt),
  };
}

function serializeMessage(docId, data) {
  return {
    id: docId,
    senderId: data.senderId,
    type: data.type || MESSAGE_TYPES.TEXT,
    text: data.deleted ? null : data.text || null,
    mediaUrl: data.deleted ? null : data.mediaUrl || null,
    readBy: data.readBy || [],
    deleted: !!data.deleted,
    deletedAt: serializeFirestoreTimestamp(data.deletedAt),
    edited: !!data.edited,
    editedAt: serializeFirestoreTimestamp(data.editedAt),
    createdAt: serializeFirestoreTimestamp(data.createdAt),
  };
}

async function createFirebaseCustomToken(currentUser) {
  const auth = getAuth();
  const claims = {
    role: currentUser.role,
    email: currentUser.email,
  };
  const token = await auth.createCustomToken(currentUser.id.toString(), claims);
  return token;
}

async function loadParticipants(currentUserId, recipientId) {
  if (currentUserId.toString() === recipientId.toString()) {
    throw new ApiError(400, 'You cannot start a conversation with yourself.');
  }

  const [currentUser, recipient] = await Promise.all([
    User.findById(currentUserId),
    User.findById(recipientId),
  ]);

  if (!currentUser) {
    throw new ApiError(401, 'Current user not found.');
  }
  if (!recipient) {
    throw new ApiError(404, 'Recipient user not found.');
  }

  return { currentUser, recipient };
}

async function startOrGetConversation(currentUserId, payload) {
  const { recipientId, listingId, initialMessage } = payload;
  const { currentUser, recipient } = await loadParticipants(currentUserId, recipientId);

  if (listingId) {
    const listing = await Listing.findById(listingId);
    if (!listing) {
      throw new ApiError(404, 'Listing not found.');
    }
  }

  const firestore = getFirestore();
  const conversationId = buildConversationId(currentUserId, recipientId, listingId);
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snapshot = await conversationRef.get();

  if (!snapshot.exists) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    const participantInfo = {
      [currentUser._id.toString()]: pickParticipantInfo(currentUser),
      [recipient._id.toString()]: pickParticipantInfo(recipient),
    };

    await conversationRef.set({
      participants: [currentUser._id.toString(), recipient._id.toString()],
      participantInfo,
      listingId: listingId || null,
      lastMessage: null,
      lastMessageAt: null,
      unreadCount: {
        [currentUser._id.toString()]: 0,
        [recipient._id.toString()]: 0,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  if (initialMessage) {
    await sendMessage(currentUserId, conversationId, {
      type: MESSAGE_TYPES.TEXT,
      text: initialMessage,
      mediaUrl: null,
    });
  }

  const finalSnapshot = await conversationRef.get();
  return serializeConversation(finalSnapshot.id, finalSnapshot.data());
}

async function ensureUserInConversation(userId, conversationDoc) {
  if (!conversationDoc.exists) {
    throw new ApiError(404, 'Conversation not found.');
  }
  const data = conversationDoc.data();
  const participants = data.participants || [];
  if (!participants.includes(userId.toString())) {
    throw new ApiError(403, 'You are not a participant of this conversation.');
  }
  return data;
}

async function sendMessage(currentUserId, conversationId, payload) {
  const firestore = getFirestore();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  const conversation = await ensureUserInConversation(currentUserId, conversationSnap);

  const senderId = currentUserId.toString();
  const otherParticipantId = (conversation.participants || []).find(
    (participantId) => participantId !== senderId
  );

  const messageRef = conversationRef.collection(MESSAGES_SUBCOLLECTION).doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const messageData = {
    senderId,
    type: payload.type,
    text: payload.text,
    mediaUrl: payload.mediaUrl,
    readBy: [senderId],
    createdAt: now,
  };

  const lastMessagePreview = {
    text:
      payload.type === MESSAGE_TYPES.TEXT
        ? payload.text
        : payload.type === MESSAGE_TYPES.IMAGE
        ? '[Image]'
        : '[File]',
    senderId,
    type: payload.type,
    createdAt: now,
  };

  const conversationUpdates = {
    lastMessage: lastMessagePreview,
    lastMessageAt: now,
    updatedAt: now,
  };

  if (otherParticipantId) {
    conversationUpdates[`unreadCount.${otherParticipantId}`] =
      admin.firestore.FieldValue.increment(1);
  }

  await firestore.runTransaction(async (transaction) => {
    transaction.set(messageRef, messageData);
    transaction.update(conversationRef, conversationUpdates);
  });

  const messageSnap = await messageRef.get();
  return serializeMessage(messageSnap.id, messageSnap.data());
}

async function listConversations(currentUserId, { page = 1, limit = 20 } = {}) {
  const firestore = getFirestore();
  const userId = currentUserId.toString();

  const snapshot = await firestore
    .collection(CONVERSATIONS_COLLECTION)
    .where('participants', 'array-contains', userId)
    .get();

  const all = snapshot.docs
    .map((doc) => serializeConversation(doc.id, doc.data()))
    .sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });

  const offset = (page - 1) * limit;
  const conversations = all.slice(offset, offset + limit);

  return {
    conversations,
    pagination: {
      page,
      limit,
      total: all.length,
      hasNextPage: offset + conversations.length < all.length,
    },
  };
}

async function getConversationById(currentUserId, conversationId) {
  const firestore = getFirestore();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  await ensureUserInConversation(currentUserId, conversationSnap);
  return serializeConversation(conversationSnap.id, conversationSnap.data());
}

async function listMessages(currentUserId, conversationId, { limit = 30, before = null } = {}) {
  const firestore = getFirestore();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  const conversation = await ensureUserInConversation(currentUserId, conversationSnap);

  let query = conversationRef
    .collection(MESSAGES_SUBCOLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      query = query.where('createdAt', '<', admin.firestore.Timestamp.fromDate(beforeDate));
    }
  }

  const snapshot = await query.get();
  const participantInfo = conversation.participantInfo || {};
  const messages = snapshot.docs
    .map((doc) => {
      const message = serializeMessage(doc.id, doc.data());
      const sender = participantInfo[message.senderId] || null;
      return {
        ...message,
        sender: sender
          ? {
              id: sender.id,
              name: sender.name,
              email: sender.email,
              role: sender.role,
              profileImage: sender.profileImage || '',
            }
          : null,
      };
    })
    .reverse();

  const nextCursor =
    snapshot.size === limit && snapshot.docs.length > 0
      ? serializeFirestoreTimestamp(snapshot.docs[snapshot.docs.length - 1].data().createdAt)
      : null;

  return {
    messages,
    participants: participantInfo,
    pagination: {
      limit,
      nextCursor,
      hasMore: snapshot.size === limit,
    },
  };
}

async function markConversationAsRead(currentUserId, conversationId) {
  const firestore = getFirestore();
  const userId = currentUserId.toString();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  await ensureUserInConversation(currentUserId, conversationSnap);

  await conversationRef.update({
    [`unreadCount.${userId}`]: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const messagesQuery = await conversationRef
    .collection(MESSAGES_SUBCOLLECTION)
    .where('senderId', '!=', userId)
    .orderBy('senderId')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const batch = firestore.batch();
  messagesQuery.docs.forEach((doc) => {
    const readBy = doc.data().readBy || [];
    if (!readBy.includes(userId)) {
      batch.update(doc.ref, {
        readBy: admin.firestore.FieldValue.arrayUnion(userId),
      });
    }
  });
  await batch.commit();

  return { success: true };
}

async function markMessageAsRead(currentUserId, conversationId, messageId) {
  const firestore = getFirestore();
  const userId = currentUserId.toString();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  await ensureUserInConversation(currentUserId, conversationSnap);

  const messageRef = conversationRef.collection(MESSAGES_SUBCOLLECTION).doc(messageId);
  const messageSnap = await messageRef.get();

  if (!messageSnap.exists) {
    throw new ApiError(404, 'Message not found.');
  }

  const message = messageSnap.data();

  if (message.senderId === userId) {
    return serializeMessage(messageSnap.id, message);
  }

  const alreadyRead = (message.readBy || []).includes(userId);

  if (!alreadyRead) {
    await messageRef.update({
      readBy: admin.firestore.FieldValue.arrayUnion(userId),
    });

    const conversation = conversationSnap.data();
    const currentUnread = (conversation.unreadCount || {})[userId] || 0;
    if (currentUnread > 0) {
      await conversationRef.update({
        [`unreadCount.${userId}`]: Math.max(0, currentUnread - 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  const updatedSnap = await messageRef.get();
  return serializeMessage(updatedSnap.id, updatedSnap.data());
}

async function editMessage(currentUserId, conversationId, messageId, { text }) {
  const firestore = getFirestore();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  await ensureUserInConversation(currentUserId, conversationSnap);

  const messageRef = conversationRef.collection(MESSAGES_SUBCOLLECTION).doc(messageId);
  const messageSnap = await messageRef.get();

  if (!messageSnap.exists) {
    throw new ApiError(404, 'Message not found.');
  }

  const message = messageSnap.data();

  if (message.senderId !== currentUserId.toString()) {
    throw new ApiError(403, 'You can only edit your own messages.');
  }
  if (message.deleted) {
    throw new ApiError(400, 'Cannot edit a deleted message.');
  }
  if (message.type !== MESSAGE_TYPES.TEXT) {
    throw new ApiError(400, 'Only text messages can be edited.');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  await messageRef.update({
    text,
    edited: true,
    editedAt: now,
  });

  const conversation = conversationSnap.data();
  const isLastMessage =
    conversation.lastMessage && conversation.lastMessage.senderId === message.senderId;

  if (isLastMessage) {
    await conversationRef.update({
      'lastMessage.text': text,
      updatedAt: now,
    });
  }

  const updatedSnap = await messageRef.get();
  return serializeMessage(updatedSnap.id, updatedSnap.data());
}

async function deleteMessage(currentUserId, conversationId, messageId) {
  const firestore = getFirestore();
  const conversationRef = firestore.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const conversationSnap = await conversationRef.get();
  await ensureUserInConversation(currentUserId, conversationSnap);

  const messageRef = conversationRef.collection(MESSAGES_SUBCOLLECTION).doc(messageId);
  const messageSnap = await messageRef.get();

  if (!messageSnap.exists) {
    throw new ApiError(404, 'Message not found.');
  }

  const message = messageSnap.data();

  if (message.senderId !== currentUserId.toString()) {
    throw new ApiError(403, 'You can only delete your own messages.');
  }
  if (message.deleted) {
    throw new ApiError(400, 'Message is already deleted.');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  await messageRef.update({
    deleted: true,
    deletedAt: now,
    text: null,
    mediaUrl: null,
  });

  const conversation = conversationSnap.data();
  const isLastMessage =
    conversation.lastMessage && conversation.lastMessage.senderId === message.senderId;

  if (isLastMessage) {
    await conversationRef.update({
      lastMessage: {
        text: 'This message was deleted',
        senderId: message.senderId,
        type: message.type,
        createdAt: conversation.lastMessage.createdAt || now,
        deleted: true,
      },
      updatedAt: now,
    });
  }

  const updatedSnap = await messageRef.get();
  return serializeMessage(updatedSnap.id, updatedSnap.data());
}

module.exports = {
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
};
