// src/functions/src/firebaseAdmin.ts
import * as admin from 'firebase-admin';

let app: admin.app.App;
let db: admin.firestore.Firestore;
let auth: admin.auth.Auth;

if (!admin.apps.length) {
  try {
    console.log('[firebaseAdmin Cloud Function] Initializing new Firebase Admin SDK instance...');
    app = admin.initializeApp();
    db = admin.firestore();
    auth = admin.auth();
    
    // Set the database ID for all Firestore operations if not already set.
    // Wrap in try-catch to handle environments where Firestore might be initialized already.
    try {
      db.settings({ databaseId: 'bmdatabase' });
    } catch (settingsError: any) {
      if (!settingsError.message?.includes('settings() has already been called')) {
        console.warn('[firebaseAdmin Cloud Function] Non-critical error applying Firestore settings:', settingsError.message);
      }
    }
    
    console.log(`[firebaseAdmin Cloud Function] ✅ Firebase Admin SDK initialized successfully.`);
  } catch (error: any) {
    console.error('[firebaseAdmin Cloud Function] CRITICAL: Firebase Admin SDK initializeApp call FAILED.', error);
    // In a function environment, we might want to let it fail hard.
    throw new Error(`Admin SDK initialization failed: ${error.message}`);
  }
} else {
  console.log('[firebaseAdmin Cloud Function] Using existing Firebase Admin SDK instance.');
  app = admin.apps[0]!;
  db = admin.firestore();
  auth = admin.auth();
}

// Export singleton instances
export { db, auth };
