/**
 * Real-time chat listener (test tool).
 *
 * Run from project root:
 *   node scripts/chat-listener.js <conversationId>
 *
 * Example:
 *   node scripts/chat-listener.js 69dde94691b486304e69b9d1_69eb00125329c138b6c36bc3__69fc99627823006d217f29b9
 *
 * Uses the Firebase Admin SDK (service account in .env) so it bypasses
 * Firestore security rules — perfect for verifying real-time delivery
 * end-to-end. Send messages from Postman and watch them stream here.
 */

const { getFirestore } = require('../src/config/firebase');

const conversationId = process.argv[2];

if (!conversationId) {
  console.error('Usage: node scripts/chat-listener.js <conversationId>');
  process.exit(1);
}

const db = getFirestore();
const messagesRef = db
  .collection('conversations')
  .doc(conversationId)
  .collection('messages')
  .orderBy('createdAt', 'asc');

console.log(`\nListening for messages on conversation: ${conversationId}`);
console.log('Send a message from Postman and watch it appear here in real time.');
console.log('Press Ctrl+C to stop.\n');

messagesRef.onSnapshot(
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type !== 'added') return;
      const data = change.doc.data();
      const ts = data.createdAt && data.createdAt.toDate
        ? data.createdAt.toDate().toISOString()
        : new Date().toISOString();
      const preview =
        data.type === 'text' ? data.text : `[${data.type}] ${data.mediaUrl || ''}`;
      console.log(`[${ts}] ${data.senderId} → ${preview}`);
    });
  },
  (error) => {
    console.error('Listener error:', error.message);
    process.exit(1);
  }
);
