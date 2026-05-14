const admin = require('firebase-admin');

const { firebase: firebaseConfig } = require('./env');

let firebaseApp = null;

function initializeFirebase() {
  if (firebaseApp) return firebaseApp;

  const { projectId, clientEmail, privateKey } = firebaseConfig;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your environment.'
    );
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });

  return firebaseApp;
}

function getFirestore() {
  initializeFirebase();
  return admin.firestore();
}

function getAuth() {
  initializeFirebase();
  return admin.auth();
}

function getMessaging() {
  initializeFirebase();
  return admin.messaging();
}

module.exports = {
  admin,
  initializeFirebase,
  getFirestore,
  getAuth,
  getMessaging,
};
