import { NextRequest, NextResponse } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { findDuplicateBankTransactions, cleanupDuplicateBankTransactions, type CleanupResult } from '@/lib/services/zohoCleanup';

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

// GET /api/admin/zoho-cleanup?action=detect
// Detect duplicates in Zoho bank transactions
export async function GET(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'detect';

    if (action === 'detect') {
      const duplicates = await findDuplicateBankTransactions();
      return NextResponse.json({
        success: true,
        duplicatesFound: duplicates.length,
        duplicates,
      });
    }

    return NextResponse.json(
      { success: false, message: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[API /zoho-cleanup] Error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/admin/zoho-cleanup
// Body: { dryRun?: boolean }
export async function POST(request: NextRequest) {
  const admin = await verifyAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    console.log(`[API /zoho-cleanup] Running cleanup${dryRun ? ' (DRY RUN)' : ''}...`);
    const result: CleanupResult = await cleanupDuplicateBankTransactions({ dryRun });

    return NextResponse.json(
      {
        success: result.failed === 0,
        message: `Duplicates: ${result.duplicatesFound}, Cleaned: ${result.cleaned}, Failed: ${result.failed}`,
        ...result,
      },
      { status: result.failed === 0 ? 200 : 207 }
    );
  } catch (err: any) {
    console.error('[API /zoho-cleanup] Error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
