import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncRazorpayToZoho } from '@/lib/services/razorpayZohoSync';

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

// POST /api/jobs/razorpay-sync-daily
// Intended for Cloud Scheduler / cron. Auth: Authorization: Bearer <SECRET_KEY>
export async function POST(request: NextRequest) {
  const auth = request.headers.get('Authorization') || '';
  const secret = process.env.SECRET_KEY;

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const owner = `job:daily:${Date.now()}`;
  const lock = await acquireSyncLock(owner);
  if (!lock.acquired) {
    return NextResponse.json(
      {
        success: false,
        message: 'Sync already in progress. Daily job skipped.',
        lock: lock.lock,
      },
      { status: 409 }
    );
  }

  try {
    // Sync trailing 3 days daily; Firestore dedup prevents duplicates.
    const nowSec = Math.floor(Date.now() / 1000);
    const from = nowSec - (3 * 24 * 60 * 60);

    const result = await syncRazorpayToZoho({
      count: 100,
      from,
      to: nowSec,
      syncAll: false,
    });

    return NextResponse.json({
      success: result.success,
      message: result.message,
      mode: 'daily',
      from,
      to: nowSec,
      synced: result.synced,
      skipped: result.skipped,
      failed: result.failed,
    }, { status: result.success ? 200 : 207 });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  } finally {
    await releaseSyncLock(owner).catch((e) => {
      console.error('[API /jobs/razorpay-sync-daily] Failed to release sync lock:', e?.message || e);
    });
  }
}
