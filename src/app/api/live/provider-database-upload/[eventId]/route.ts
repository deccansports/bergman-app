import { NextResponse } from 'next/server';
import { parseFeibotDatabase } from '@/lib/live-tracking/feibotDatabaseParser';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { serializeValue } from '@/lib/utils';
import { buildResolvedTimingConfiguration } from '@/lib/timingConfiguration';

const DEFAULT_EDGE_BASE_URL = process.env.NEXT_PUBLIC_LIVE_TRACKING_EDGE_API_BASE || process.env.LIVE_TRACKING_EDGE_API_BASE || 'https://api.bergmantri.com';

function normalizeBaseUrl(input?: string | null) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function getEdgeBaseCandidates() {
  const values = [
    process.env.LIVE_TRACKING_EDGE_API_BASE,
    process.env.NEXT_PUBLIC_LIVE_TRACKING_EDGE_API_BASE,
    DEFAULT_EDGE_BASE_URL,
    'https://api.bergmantri.com',
  ];
  const deduped = Array.from(new Set(values.map((item) => normalizeBaseUrl(item)).filter(Boolean)));
  return deduped.length > 0 ? deduped : ['https://api.bergmantri.com'];
}

export async function POST(request: Request, { params }: { params: { eventId: string } }) {
  const eventId = decodeURIComponent(params.eventId || '').trim();
  return NextResponse.json({ success: false, eventId, message: 'Legacy database uploads are disabled. Cloud API is the only source of truth.' }, { status: 410 });
}
