import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import axios from 'axios';

if (!admin.apps.length) {
  admin.initializeApp();
}

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CREATE_SECRET = process.env.SYNC_SECRET || '';

function getDb() {
  return admin.firestore();
}

async function createCloudflareLiveInput(eventId: string, name: string, cameraType: string) {
  const res = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/live_inputs`,
    {
      meta: { eventId, cameraType, name },
      recording: { mode: 'off' },
    },
    {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );

  if (!res.data?.success) {
    throw new Error(res.data?.errors?.[0]?.message || 'Cloudflare live input creation failed');
  }

  return res.data.result;
}

export const createCamera = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method not allowed' });
      return;
    }

    if (!ACCOUNT_ID || !API_TOKEN || !CREATE_SECRET) {
      res.status(500).json({ success: false, error: 'Cloudflare function not configured' });
      return;
    }

    if (String(req.header('x-api-key') || '').trim() !== CREATE_SECRET) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { eventId, name, cameraType = 'custom' } = req.body || {};
    const resolvedEventId = String(eventId || '').trim();
    const resolvedName = String(name || '').trim();
    if (!resolvedEventId || !resolvedName) {
      res.status(400).json({ success: false, error: 'eventId and name are required' });
      return;
    }

    const liveInput = await createCloudflareLiveInput(resolvedEventId, resolvedName, String(cameraType || 'custom'));
    const db = getDb();
    const cameraId = db.collection('events').doc(resolvedEventId).collection('liveCameras').doc().id;

    const data = {
      cameraId,
      eventId: resolvedEventId,
      name: resolvedName,
      cameraType: String(cameraType || 'custom'),
      provider: 'cloudflare',
      status: 'waiting_for_stream',
      cloudflare: {
        liveInputUid: liveInput.uid,
        rtmpsUrl: liveInput.rtmps?.url || '',
        streamKeyEncrypted: '',
        playbackUid: null,
        playbackUrl: null,
        recordingUid: null,
        videoUid: null,
        thumbnailUrl: null,
        durationSeconds: null,
        recordingMode: liveInput.recording?.mode || 'off',
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.collection('events').doc(resolvedEventId).collection('liveCameras').doc(cameraId).set(data, { merge: true }),
      db.collection('broadcastCameras').doc(cameraId).set(data, { merge: true }),
    ]);

    res.json({ success: true, data: { cameraId, liveInput } });
  } catch (error: any) {
    console.error('[createCamera] failed', error);
    res.status(500).json({ success: false, error: error?.message || 'Internal error' });
  }
});
