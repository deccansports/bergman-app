import { NextRequest, NextResponse } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getZohoDashboardMetrics } from '@/lib/services/razorpayZohoSync';

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

// GET /api/admin/zoho-dashboard
export async function GET(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const logsLimit = parseInt(searchParams.get('logsLimit') ?? '25', 10);
    const metrics = await getZohoDashboardMetrics(logsLimit);

    return NextResponse.json({
      success: true,
      ...metrics,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
