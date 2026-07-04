import { onSchedule } from 'firebase-functions/v2/scheduler';
import axios from 'axios';

const APP_BASE_URL = process.env.BIRTHDAY_JOB_BASE_URL || process.env.APP_BASE_URL || 'https://api.bergmantri.com';
const DAILY_BIRTHDAY_JOB_URL = `${APP_BASE_URL.replace(/\/$/, '')}/api/jobs/birthday-campaign-daily`;

/**
 * Auto Birthday Automation
 * - Runs daily at 10:00 AM IST (best send window)
 * - Triggers app job that sends both Email + WhatsApp for:
 *   1) Today's birthdays
 *   2) Upcoming birthdays (1 day)
 */
export const autoRunBirthdayCampaignDaily = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    secrets: ['SYNC_SECRET'],
  },
  async () => {
    const secret = process.env.SYNC_SECRET;

    if (!secret) {
      console.error('[autoRunBirthdayCampaignDaily] SYNC_SECRET missing.');
      return;
    }

    try {
      const response = await axios.post(
        DAILY_BIRTHDAY_JOB_URL,
        {},
        {
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
        }
      );

      console.log('[autoRunBirthdayCampaignDaily] Triggered successfully:', {
        status: response.status,
        data: response.data,
      });
    } catch (error: any) {
      const message = error?.response?.data || error?.message || 'Unknown error';
      console.error('[autoRunBirthdayCampaignDaily] Failed:', message);
    }
  }
);
