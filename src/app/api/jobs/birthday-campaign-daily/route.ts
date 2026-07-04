import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { runBirthdayCampaignTodayAction, runUpcomingBirthdayCampaignAction, syncUserDobToKVAction } from '@/lib/actions/birthdayCampaignActions';

export const dynamic = 'force-dynamic';

const SYNC_LOCK_COLLECTION = 'sync_locks';
const SYNC_LOCK_DOC = 'birthday_campaign_daily';
const SYNC_LOCK_TTL_MS = 30 * 60 * 1000;
const DEFAULT_BEST_HOUR_IST = 10;

type SyncLockDoc = {
  status: 'running' | 'idle';
  owner: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
};

function getIstHourMinute() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return { hour, minute };
}

function isBestSendWindowIst(bestHour = DEFAULT_BEST_HOUR_IST) {
  const { hour, minute } = getIstHourMinute();
  return hour === bestHour && minute <= 30;
}

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
// POST /api/jobs/birthday-campaign-daily
// Intended for Cloud Scheduler / cron. Auth: Authorization: Bearer <SECRET>
export async function POST(request: NextRequest) {
  const auth = request.headers.get('Authorization') || '';
  const secret = process.env.SYNC_SECRET;
  const legacySecret = process.env.SECRET_KEY;
  const validSecrets = [secret, legacySecret].filter(Boolean) as string[];
  const isAuthorized = validSecrets.some((s) => auth === `Bearer ${s}`);

  if (validSecrets.length === 0 || !isAuthorized) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const forceRun = request.nextUrl.searchParams.get('force') === '1';
  const inBestWindow = isBestSendWindowIst();

  const owner = `job:birthday:${Date.now()}`;
  const lock = await acquireSyncLock(owner);
  if (!lock.acquired) {
    return NextResponse.json(
      {
        success: false,
        message: 'Birthday campaign already in progress. Daily job skipped.',
        lock: lock.lock,
      },
      { status: 409 }
    );
  }

  try {
    // Keep KV DOB cache fresh daily before campaign run.
    const dobSync = await syncUserDobToKVAction();
    const campaignToday = await runBirthdayCampaignTodayAction();
    const campaignUpcoming1Day = await runUpcomingBirthdayCampaignAction();

    const success = campaignToday.success && campaignUpcoming1Day.success;

    return NextResponse.json(
      {
        success,
        message: success
          ? 'Daily birthday campaigns completed (today + upcoming 1 day).'
          : 'Daily birthday campaigns completed with partial failures.',
        mode: 'daily',
        timezone: 'Asia/Kolkata',
        bestSendWindow: '10:00–10:30 IST',
        execution: inBestWindow ? 'inside-best-window' : forceRun ? 'forced-outside-window' : 'outside-window',
        timestamp: new Date().toISOString(),
        dobSync,
        campaignToday,
        campaignUpcoming1Day,
      },
      { status: success ? 200 : 207 }
    );
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err?.message || 'Job failed' }, { status: 500 });
  } finally {
    await releaseSyncLock(owner).catch((e) => {
      console.error('[API /jobs/birthday-campaign-daily] Failed to release sync lock:', e?.message || e);
    });
  }
}
