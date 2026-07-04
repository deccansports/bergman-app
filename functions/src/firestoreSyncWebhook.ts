// functions/src/firestoreSyncWebhook.ts
/**
 * Cloud Function: Firestore → Webhook Trigger
 * 
 * Triggered on ANY document update
 * Sends data to webhook for real-time KV sync
 * 
 * Deploy with:
 * firebase deploy --only functions:onFirestoreWrite
 */

// functions/src/firestoreSyncWebhook.ts
/**
 * Cloud Function: Firestore → Webhook Trigger (v2)
 * 
 * Triggered on ANY document update
 * Sends data to webhook for real-time KV sync
 * 
 * Deploy with:
 * firebase deploy --only functions:onFirestoreWrite
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import axios from 'axios';

// Initialize admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const WEBHOOK_URL = process.env.FIRESTORE_SYNC_WEBHOOK_URL || 
  'https://your-domain.com/api/webhooks/firestore-sync';

const WEBHOOK_SECRET = process.env.FIRESTORE_SYNC_WEBHOOK_SECRET || '';

interface SyncPayload {
  document: {
    name: string;
    fields: Record<string, any>;
    updateTime: string;
  };
  eventType: string;
  timestamp: string;
}

/**
 * Cloud Function: Trigger on Firestore document writes (v2)
 * Monitors: participants, users, events, registrations collections
 */
export const onFirestoreWrite = onDocumentWritten(
  '{collectionName}/{docId}',
  async (event) => {
    const collectionName = event.params.collectionName;
    const docId = event.params.docId;

    // Only sync specific collections
    const syncCollections = ['participants', 'users', 'events', 'registrations'];
    if (!syncCollections.includes(collectionName)) {
      return null;
    }

    try {
      const afterData = event.data?.after.data();
      
      // Skip if no data or if this is a delete (we don't sync deletes)
      if (!afterData) {
        console.log(`[CF] Skipping delete for ${collectionName}/${docId}`);
        return null;
      }

      // Only sync if updatedAt is recent (within last 5 seconds)
      const updatedAt = afterData.updatedAt;
      if (updatedAt) {
        const updateTime = updatedAt instanceof admin.firestore.Timestamp 
          ? updatedAt.toDate() 
          : new Date(updatedAt);
        const now = new Date();
        const diffMs = now.getTime() - updateTime.getTime();
        
        if (diffMs > 5000) {
          console.log(`[CF] Skipping stale update for ${collectionName}/${docId}`);
          return null;
        }
      }

      // Convert to Firestore format for webhook
      const isUpdate = event.data?.before.exists;
      const payload: SyncPayload = {
        document: {
          name: `projects/_/databases/(default)/documents/${collectionName}/${docId}`,
          fields: objectToFirestoreFields(afterData),
          updateTime: new Date().toISOString(),
        },
        eventType: isUpdate ? 'UPDATE' : 'CREATE',
        timestamp: new Date().toISOString(),
      };

      // Send to webhook
      await sendWebhookWithRetry(payload, 3);
      console.log(`[CF] Synced ${collectionName}/${docId} to webhook`);
      return null;

    } catch (error) {
      console.error(`[CF] Error syncing ${collectionName}/${docId}:`, error);
      return null;
    }
  }
);

/**
 * Send webhook with exponential backoff retry
 */
async function sendWebhookWithRetry(
  payload: SyncPayload,
  retries: number,
  delayMs: number = 1000
): Promise<void> {
  try {
    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(WEBHOOK_SECRET && { 'X-Webhook-Secret': WEBHOOK_SECRET }),
      },
      timeout: 10000,
    });

    if (response.status >= 200 && response.status < 300) {
      return; // Success
    }

    throw new Error(`Webhook returned ${response.status}`);

  } catch (error) {
    if (retries <= 0) {
      throw new Error(`Failed to send webhook after retries: ${error}`);
    }

    console.warn(`[CF] Webhook failed, retrying in ${delayMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Exponential backoff
    return sendWebhookWithRetry(payload, retries - 1, delayMs * 2);
  }
}

/**
 * Convert JavaScript object to Firestore field values
 * Required format for webhook payload
 */
function objectToFirestoreFields(obj: any): Record<string, any> {
  const fields: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    fields[key] = valueToFirestoreField(value);
  }

  return fields;
}

function valueToFirestoreField(value: any): any {
  // Null
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  // Boolean
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  // Number
  if (typeof value === 'number') {
    return Number.isInteger(value) 
      ? { integerValue: value.toString() }
      : { doubleValue: value };
  }

  // String
  if (typeof value === 'string') {
    return { stringValue: value };
  }

  // Timestamp
  if (value instanceof Date || value instanceof admin.firestore.Timestamp) {
    const date = value instanceof admin.firestore.Timestamp 
      ? value.toDate() 
      : value;
    return { timestampValue: date.toISOString() };
  }

  // Array
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(v => valueToFirestoreField(v)),
      },
    };
  }

  // Object/Map
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: objectToFirestoreFields(value),
      },
    };
  }

  // Fallback
  return { stringValue: String(value) };
}

/**
 * Manual trigger function (for admin panel)
 * 
 * Usage: firebase functions:call onManualSync --data "{\"collectionName\": \"users\", \"docId\": \"abc123\"}"
 */
export const onManualSync = onCall(async (request) => {
  const { auth, data } = request;
  
  // Require authentication
  if (!auth) {
    throw new HttpsError(
      'unauthenticated',
      'User must be authenticated'
    );
  }

  // Require admin claim
  const claims = auth.token;
  if (!claims.admin) {
    throw new HttpsError(
      'permission-denied',
      'User must be admin'
    );
  }

  const { collectionName, docId } = data as any;

  if (!collectionName || !docId) {
    throw new HttpsError(
      'invalid-argument',
      'collectionName and docId required'
    );
  }

  try {
    const db = admin.firestore();
    const doc = await db.collection(collectionName).doc(docId).get();

    if (!doc.exists) {
      throw new HttpsError(
        'not-found',
        `Document ${collectionName}/${docId} not found`
      );
    }

    const payload: SyncPayload = {
      document: {
        name: `projects/_/databases/(default)/documents/${collectionName}/${docId}`,
        fields: objectToFirestoreFields(doc.data() || {}),
        updateTime: new Date().toISOString(),
      },
      eventType: 'CREATE',
      timestamp: new Date().toISOString(),
    };

    await sendWebhookWithRetry(payload, 3);

    return {
      success: true,
      synced: true,
      collection: collectionName,
      docId,
    };

  } catch (error) {
    throw new HttpsError(
      'internal',
      error instanceof Error ? error.message : 'Manual sync failed'
    );
  }
});
