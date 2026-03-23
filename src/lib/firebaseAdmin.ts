// src/lib/firebaseAdmin.ts
import * as admin from 'firebase-admin';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestoreType } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth, type Auth as AdminAuthType } from 'firebase-admin/auth';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

if (!admin.apps.length) {
  console.log('[firebaseAdmin] Initializing Firebase Admin SDK singleton...');

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    throw new Error(
      '[firebaseAdmin] Missing required environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });

  console.log('[firebaseAdmin] ✅ Admin SDK initialized successfully.');
}

const app = admin.app();
const firestoreInstance = getAdminFirestore(app, 'bmdatabase');

try {
  firestoreInstance.settings({ ignoreUndefinedProperties: true });
} catch (e: any) {
  if (!e.message?.includes('settings() has already been called')) {
    console.warn('[firebaseAdmin] Warning applying Firestore settings:', e.message);
  }
}

const authInstance = getAdminAuth(app);
const storageInstance = getAdminStorage(app);

export function getFirestoreInstance(): AdminFirestoreType {
  return firestoreInstance;
}

export function getAuthInstance(): AdminAuthType {
  return authInstance;
}

export function getStorageInstance() {
  return storageInstance;
}
