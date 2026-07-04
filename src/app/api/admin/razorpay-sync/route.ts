import { NextRequest, NextResponse } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncRazorpayToZoho, getSyncHistory } from '@/lib/services/razorpayZohoSync';

export const dynamic = 'force-dynamic';

const SYNC_LOCK_COLLECTION = 'sync_locks';
const SYNC_LOCK_DOC = 'razorpay_zoho';
const SYNC_LOCK_TTL_MS = 30 * 60 * 1000;

type SyncLockDoc = {
  status: 'running' | 'idle';
  owner: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
};

async function acquireSyncLock(owner: string): Promise<{ acquired: boolean; lock?: SyncLockDoc }> {
  const db = getFirestoreInstance();
  const lockRef = db.collection(SYNC_LOCK_COLLECTION).doc(SYNC_LOCK_DOC);

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const snap = await tx.get(lockRef);
    const existing = (snap.data() || {}) as Partial<SyncLockDoc>;
    const expiresAtMs = existing.expiresAt ? new Date(existing.expiresAt).getTime() : 0;
    const isLocked = existing.status === 'running' && expiresAtMs > nowMs;

    if (isLocked) {
      return { acquired: false, lock: existing as SyncLockDoc };
    }

    const nextLock: SyncLockDoc = {
      status: 'running',
      owner,
      startedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + SYNC_LOCK_TTL_MS).toISOString(),
    };

    tx.set(lockRef, nextLock, { merge: true });
    return { acquired: true, lock: nextLock };
  });
}

async function releaseSyncLock(owner: string): Promise<void> {
  const db = getFirestoreInstance();
  const lockRef = db.collection(SYNC_LOCK_COLLECTION).doc(SYNC_LOCK_DOC);
  await lockRef.set(
    {
      status: 'idle',
      owner,
      endedAt: new Date().toISOString(),
      expiresAt: new Date(0).toISOString(),
    },
    { merge: true }
  );
}

async function verifyAdmin(request: NextRequest): Promise<{ uid: string } | null> {
  try {
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const decoded = await getAuthInstance().verifyIdToken(auth.replace('Bearer ', ''));
    const userDoc = await getFirestoreInstance().collection('users').doc(decoded.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

// POST /api/admin/razorpay-sync
// Body: { count?: number, syncAll?: boolean, mergeOnly?: boolean, fromDate?: "YYYY-MM-DD", toDate?: "YYYY-MM-DD" }
export async function POST(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const owner = `admin:${admin.uid}:${Date.now()}`;
  const lock = await acquireSyncLock(owner);
  if (!lock.acquired) {
    return NextResponse.json(
      {
        success: false,
        message: 'Sync already in progress. Try again after current run finishes.',
        lock: lock.lock,
      },
      { status: 409 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const count = typeof body.count === 'number' ? body.count : 50;
    const syncAll = body.syncAll === true;
    const mergeOnly = body.mergeOnly === true;
    const fromDate = body.fromDate as string | undefined;
    const toDate = body.toDate as string | undefined;

    const from = fromDate
      ? Math.floor(new Date(fromDate).getTime() / 1000)
      : undefined;
    const to = toDate
      ? Math.floor(new Date(`${toDate}T23:59:59`).getTime() / 1000)
      : undefined;

    const result = await syncRazorpayToZoho({ count, from, to, syncAll, mergeOnly });
    return NextResponse.json(result, { status: result.success ? 200 : 207 });
  } catch (err: any) {
    console.error('[API /razorpay-sync] Error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  } finally {
    await releaseSyncLock(owner).catch((e) => {
      console.error('[API /razorpay-sync] Failed to release sync lock:', e?.message || e);
    });
  }
}

// GET /api/admin/razorpay-sync?limit=50
export async function GET(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const history = await getSyncHistory(limit);
    return NextResponse.json({ success: true, count: history.length, history });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
