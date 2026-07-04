// src/app/api/admin/razorpay-settlement-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncRazorpayToZoho, getSyncHistory } from '@/lib/services/razorpayZohoSync';

export const dynamic = 'force-dynamic';

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

// ─── POST /api/admin/razorpay-settlement-sync ─────────────────────────────
// Body: { count?: number, fromDate?: "YYYY-MM-DD", toDate?: "YYYY-MM-DD" }
export async function POST(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const count    = typeof body.count === 'number' ? body.count : 50;
    const syncAll  = body.syncAll === true;
    const fromDate = body.fromDate as string | undefined;
    const toDate   = body.toDate   as string | undefined;

    const from = fromDate
      ? Math.floor(new Date(fromDate).getTime() / 1000)
      : undefined;
    const to = toDate
      ? Math.floor(new Date(toDate + 'T23:59:59').getTime() / 1000)
      : undefined;

    const result = await syncRazorpayToZoho({ count, from, to, syncAll });

    return NextResponse.json(result, { status: result.success ? 200 : 207 });
  } catch (err: any) {
    console.error('[API /razorpay-settlement-sync] Error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── GET /api/admin/razorpay-settlement-sync ──────────────────────────────
// Returns sync history. Query param: ?limit=50
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
