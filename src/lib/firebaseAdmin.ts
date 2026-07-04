import { getApp, getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore as AdminFirestoreType } from 'firebase-admin/firestore';
import { getAuth, type Auth as AdminAuthType } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

declare global {
  // eslint-disable-next-line no-var
  var __bergmanFirebaseAdminApp: App | undefined;
  // eslint-disable-next-line no-var
  var __bergmanFirestore: AdminFirestoreType | undefined;
  // eslint-disable-next-line no-var
  var __bergmanAuth: AdminAuthType | undefined;
  // eslint-disable-next-line no-var
  var __bergmanStorage: ReturnType<typeof getStorage> | undefined;
}

function getAdminApp(): App {
  if (globalThis.__bergmanFirebaseAdminApp) return globalThis.__bergmanFirebaseAdminApp;

  if (getApps().length) {
    globalThis.__bergmanFirebaseAdminApp = getApp();
    return globalThis.__bergmanFirebaseAdminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    throw new Error('[firebaseAdmin] Missing required environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
  }

  console.log('[firebaseAdmin] Initializing Firebase Admin SDK singleton');

  globalThis.__bergmanFirebaseAdminApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });

  return globalThis.__bergmanFirebaseAdminApp;
}

export function getFirestoreInstance(): AdminFirestoreType {
  if (globalThis.__bergmanFirestore) return globalThis.__bergmanFirestore;
  const app = getAdminApp();
  const db = getFirestore(app, 'bmdatabase');
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (!msg.includes('settings() has already been called') && !msg.includes('Firestore has already been initialized')) {
      console.warn('[firebaseAdmin] Warning applying Firestore settings:', error?.message || error);
    }
  }
  globalThis.__bergmanFirestore = db;
  return db;
}

export function getAuthInstance(): AdminAuthType {
  if (globalThis.__bergmanAuth) return globalThis.__bergmanAuth;
  globalThis.__bergmanAuth = getAuth(getAdminApp());
  return globalThis.__bergmanAuth;
}

export function getStorageInstance() {
  if (globalThis.__bergmanStorage) return globalThis.__bergmanStorage;
  globalThis.__bergmanStorage = getStorage(getAdminApp());
  return globalThis.__bergmanStorage;
}
