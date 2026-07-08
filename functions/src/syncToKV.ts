// functions/src/syncToKV.ts
/**
 * 🔥 FIRESTORE → KV REALTIME SYNC
 * 
 * Triggers on any Firestore write and sends directly to Cloudflare Worker
 * Zero reads, zero scans - just push updates
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import axios from 'axios';

// Initialize admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const WORKER_URL = process.env.SYNC_WEBHOOK_URL || 
  'https://api.bergmantri.com/sync/webhook';

const SYNC_SECRET = process.env.SYNC_SECRET;

interface SyncPayload {
  type: 'participant' | 'event' | 'user' | 'registration';
  id?: string;
  data: Record<string, any>;
  timestamp: string;
  eventType: 'CREATE' | 'UPDATE' | 'DELETE';
}

/**
 * 🔥 PARTICIPANT SYNC - Real-time on any participant change
 */
export const syncParticipantToKV = onDocumentWritten(
  'events/{eventId}/participants/{participantId}',
  async (event) => {
    try {
      const data = event.data?.after.data();
      const isDelete = !event.data?.after.exists;

      if (isDelete) {
        console.log('[Sync] Participant deleted, skipping');
        return null;
      }

      if (!data) return null;

      const payload: SyncPayload = {
        type: 'participant',
        id: event.params.participantId,
        data: {
          ...data,
          eventId: event.params.eventId,
          participantId: event.params.participantId,
        },
        timestamp: new Date().toISOString(),
        eventType: event.data?.before.exists ? 'UPDATE' : 'CREATE',
      };

      if (!SYNC_SECRET) {
        console.error('❌ SYNC_SECRET missing. Skipping participant sync.');
        return { success: false, error: 'SYNC_SECRET missing' };
      }

      // Send to Worker
      const response = await axios.post(WORKER_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SYNC_SECRET,
        },
        timeout: 15000,
      });

      console.log(`✅ Synced participant: ${data.bookingId || event.params.participantId}`);
      return { success: true, status: response.status };

    } catch (err) {
      console.error('❌ Participant sync failed:', err instanceof Error ? err.message : err);
      // Don't throw - let Cloud Function complete
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
);

/**
 * 🔥 EVENT SYNC - Real-time on any event change
 */
export const syncEventToKV = onDocumentWritten(
  'events/{eventId}',
  async (event) => {
    try {
      const data = event.data?.after.data();
      
      if (!data) return null;

      const payload: SyncPayload = {
        type: 'event',
        id: event.params.eventId,
        data: {
          ...data,
          eventId: event.params.eventId,
        },
        timestamp: new Date().toISOString(),
        eventType: event.data?.before.exists ? 'UPDATE' : 'CREATE',
      };

      if (!SYNC_SECRET) {
        console.error('❌ SYNC_SECRET missing. Skipping event sync.');
        return { success: false, error: 'SYNC_SECRET missing' };
      }

      // Send to Worker
      const response = await axios.post(WORKER_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SYNC_SECRET,
        },
        timeout: 15000,
      });

      console.log(`✅ Synced event: ${data.eventName || event.params.eventId}`);
      return { success: true, status: response.status };

    } catch (err) {
      console.error('❌ Event sync failed:', err instanceof Error ? err.message : err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
);

/**
 * 🔥 USER SYNC - Real-time on any user profile change
 */
export const syncUserToKV = onDocumentWritten(
  'users/{userId}',
  async (event) => {
    try {
      const data = event.data?.after.data();
      
      if (!data) return null;

      const payload: SyncPayload = {
        type: 'user',
        id: event.params.userId,
        data: {
          id: event.params.userId,
          name: data.name,
          email: data.email,
          mobile: data.mobile,
          idProofUrl: data.idProofUrl ? '✓' : null,
          gstin: data.gstin,
          businessName: data.businessName,
          address: data.address,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          updatedAt: data.updatedAt,
        },
        timestamp: new Date().toISOString(),
        eventType: event.data?.before.exists ? 'UPDATE' : 'CREATE',
      };

      if (!SYNC_SECRET) {
        console.error('❌ SYNC_SECRET missing. Skipping user sync.');
        return { success: false, error: 'SYNC_SECRET missing' };
      }

      // Send to Worker
      const response = await axios.post(WORKER_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SYNC_SECRET,
        },
        timeout: 15000,
      });

      console.log(`✅ Synced user: ${data.email || event.params.userId}`);
      return { success: true, status: response.status };

    } catch (err) {
      console.error('❌ User sync failed:', err instanceof Error ? err.message : err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
);
