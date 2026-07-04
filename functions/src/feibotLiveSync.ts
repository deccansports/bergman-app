import { onSchedule } from 'firebase-functions/v2/scheduler';
import axios from 'axios';

const APP_BASE_URL = process.env.FEIBOT_SYNC_BASE_URL || process.env.BIRTHDAY_JOB_BASE_URL || process.env.APP_BASE_URL || 'https://api.bergmantri.com';
const FEIBOT_LIVE_SYNC_URL = `${APP_BASE_URL.replace(/\/$/, '')}/api/jobs/feibot-live-sync`;

/**
 * Feibot live tracking sync
 * - Runs every 5 minutes
 * - Refreshes Feibot timing configuration
 * - Refreshes normalized participant snapshots used by live tracking
 */
export const autoRunFeibotLiveSync = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    secrets: ['SYNC_SECRET'],
  },
  async () => {
    const secret = process.env.SYNC_SECRET;

    if (!secret) {
      console.error('[autoRunFeibotLiveSync] SYNC_SECRET missing.');
      return;
    }

    try {
      const response = await axios.get(FEIBOT_LIVE_SYNC_URL, {
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      });

      console.log('[autoRunFeibotLiveSync] Triggered successfully:', {
        status: response.status,
        data: response.data,
      });
    } catch (error: any) {
      const message = error?.response?.data || error?.message || 'Unknown error';
      console.error('[autoRunFeibotLiveSync] Failed:', message);
    }
  }
);
