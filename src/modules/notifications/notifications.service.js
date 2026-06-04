const { admin, getFirestore, getMessaging } = require('../../config/firebase');
const env = require('../../config/env');
const User = require('../../models/user.model');
const ApiError = require('../../utils/api-error');
const {
  AVAILABLE_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
} = require('./notifications.validation');

const NOTIFICATIONS_COLLECTION = 'notifications';
const INVALID_FCM_TOKEN_ERRORS = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

function serializeFirestoreTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function resolveLinkBaseUrl() {
  const explicit = (env.notificationLinkBaseUrl || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const firstOrigin = (env.frontendUrl || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean);
  return (firstOrigin || '').replace(/\/$/, '');
}

function buildWebpushLink(type, data = {}) {
  const base = resolveLinkBaseUrl();
  switch (type) {
    case NOTIFICATION_TYPES.CHAT_MESSAGE:
      return data.conversationId ? `${base}/chats/${data.conversationId}` : `${base}/chats`;
    case NOTIFICATION_TYPES.BOOKING_NEW:
    case NOTIFICATION_TYPES.BOOKING_CANCELLED:
    case NOTIFICATION_TYPES.BOOKING_STATUS_CHANGED:
      return data.bookingId ? `${base}/bookings/${data.bookingId}` : `${base}/bookings`;
    case NOTIFICATION_TYPES.REFUND_REQUESTED:
      return data.refundRequestId
        ? `${base}/admin/refund-requests/${data.refundRequestId}`
        : `${base}/admin/refund-requests`;
    case NOTIFICATION_TYPES.REFUND_APPROVED:
    case NOTIFICATION_TYPES.REFUND_REJECTED:
      return data.bookingId ? `${base}/bookings/${data.bookingId}` : `${base}/bookings`;
    default:
      return base || undefined;
  }
}

function serializeNotification(docId, data) {
  return {
    id: docId,
    userId: data.userId,
    type: data.type,
    title: data.title,
    body: data.body,
    data: data.data || {},
    read: !!data.read,
    readAt: serializeFirestoreTimestamp(data.readAt),
    createdAt: serializeFirestoreTimestamp(data.createdAt),
  };
}

async function registerDeviceToken(userId, { token, platform }) {
  const user = await User.findById(userId).select('+deviceTokens');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const existing = (user.deviceTokens || []).find((entry) => entry.token === token);
  if (existing) {
    existing.platform = platform;
    existing.lastUsedAt = new Date();
  } else {
    user.deviceTokens.push({ token, platform, lastUsedAt: new Date() });
  }

  await user.save();
  return { token, platform };
}

async function unregisterDeviceToken(userId, token) {
  const user = await User.findById(userId).select('+deviceTokens');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  user.deviceTokens = (user.deviceTokens || []).filter((entry) => entry.token !== token);
  await user.save();
  return { success: true };
}

async function pruneInvalidTokens(userId, tokensToRemove) {
  if (!tokensToRemove || tokensToRemove.length === 0) return;
  await User.updateOne(
    { _id: userId },
    { $pull: { deviceTokens: { token: { $in: tokensToRemove } } } }
  );
}

async function sendPushToTokens(userId, tokens, { title, body, data, type }) {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0 };

  const messaging = getMessaging();
  const stringData = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    stringData[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });

  const link = buildWebpushLink(type, data);

  const message = {
    tokens,
    data: stringData,
    webpush: {
      notification: {
        title,
        body,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        requireInteraction: false,
      },
      fcmOptions: link ? { link } : undefined,
      headers: { Urgency: 'high' },
    },
  };

  let response;
  try {
    response = await messaging.sendEachForMulticast(message);
  } catch (error) {
    console.error('FCM send failed.', error);
    return { successCount: 0, failureCount: tokens.length };
  }

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (!result.success && result.error) {
      const code = result.error.code;
      if (INVALID_FCM_TOKEN_ERRORS.has(code)) {
        invalidTokens.push(tokens[index]);
      }
    }
  });

  if (invalidTokens.length > 0) {
    await pruneInvalidTokens(userId, invalidTokens).catch((err) =>
      console.error('Failed to prune invalid device tokens.', err)
    );
  }

  return { successCount: response.successCount, failureCount: response.failureCount };
}

async function sendNotification(userId, { type, title, body, data = {} }) {
  if (!userId) return null;
  if (!AVAILABLE_NOTIFICATION_TYPES.includes(type)) {
    throw new ApiError(400, `Unsupported notification type: ${type}`);
  }

  const recipientId = userId.toString();
  const firestore = getFirestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const docRef = await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    userId: recipientId,
    type,
    title,
    body,
    data,
    read: false,
    readAt: null,
    createdAt: now,
  });

  try {
    const user = await User.findById(recipientId).select('+deviceTokens');
    const tokens = (user && user.deviceTokens ? user.deviceTokens : [])
      .map((entry) => entry.token)
      .filter(Boolean);

    if (tokens.length > 0) {
      await sendPushToTokens(recipientId, tokens, {
        title,
        body,
        type,
        data: { ...data, type, notificationId: docRef.id },
      });
    }
  } catch (error) {
    console.error('Failed to send push notification.', error);
  }

  const snapshot = await docRef.get();
  return serializeNotification(snapshot.id, snapshot.data());
}

async function listNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const firestore = getFirestore();
  const recipientId = userId.toString();

  let query = firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .where('userId', '==', recipientId);

  if (unreadOnly) {
    query = query.where('read', '==', false);
  }

  const snapshot = await query.get();
  const all = snapshot.docs
    .map((doc) => serializeNotification(doc.id, doc.data()))
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

  const offset = (page - 1) * limit;
  const notifications = all.slice(offset, offset + limit);

  return {
    notifications,
    pagination: {
      page,
      limit,
      total: all.length,
      hasNextPage: offset + notifications.length < all.length,
    },
  };
}

async function getUnreadCount(userId) {
  const firestore = getFirestore();
  const recipientId = userId.toString();

  const snapshot = await firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .where('userId', '==', recipientId)
    .where('read', '==', false)
    .get();

  return { count: snapshot.size };
}

async function markNotificationRead(userId, notificationId) {
  const firestore = getFirestore();
  const recipientId = userId.toString();
  const docRef = firestore.collection(NOTIFICATIONS_COLLECTION).doc(notificationId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    throw new ApiError(404, 'Notification not found.');
  }

  const data = snapshot.data();
  if (data.userId !== recipientId) {
    throw new ApiError(403, 'You are not allowed to modify this notification.');
  }

  if (!data.read) {
    await docRef.update({
      read: true,
      readAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  const updated = await docRef.get();
  return serializeNotification(updated.id, updated.data());
}

async function markAllNotificationsRead(userId) {
  const firestore = getFirestore();
  const recipientId = userId.toString();

  const snapshot = await firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .where('userId', '==', recipientId)
    .where('read', '==', false)
    .get();

  if (snapshot.empty) {
    return { updated: 0 };
  }

  const batch = firestore.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, { read: true, readAt: now });
  });
  await batch.commit();

  return { updated: snapshot.size };
}

async function deleteNotification(userId, notificationId) {
  const firestore = getFirestore();
  const recipientId = userId.toString();
  const docRef = firestore.collection(NOTIFICATIONS_COLLECTION).doc(notificationId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    throw new ApiError(404, 'Notification not found.');
  }

  const data = snapshot.data();
  if (data.userId !== recipientId) {
    throw new ApiError(403, 'You are not allowed to delete this notification.');
  }

  await docRef.delete();
  return { success: true };
}

module.exports = {
  registerDeviceToken,
  unregisterDeviceToken,
  sendNotification,
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
};
