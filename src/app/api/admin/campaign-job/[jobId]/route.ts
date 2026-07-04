// src/app/api/admin/campaign-job/[jobId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const adminAuth = getAuthInstance();
    const decoded = await adminAuth.verifyIdToken(token);

    const adminDb = getFirestoreInstance();
    const adminDoc = await adminDb.collection('users').doc(decoded.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    const { jobId } = params;
    const jobSnap = await adminDb.collection('campaignJobs').doc(jobId).get();
    if (!jobSnap.exists) {
      return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 });
    }

    const data = jobSnap.data()!;
    return NextResponse.json({
      success: true,
      job: {
        id: jobSnap.id,
        status: data.status,
        progress: data.progress ?? 0,
        emailsSent: data.emailsSent ?? 0,
        emailsFailed: data.emailsFailed ?? 0,
        totalRecipients: data.totalRecipients ?? 0,
        errorMessage: data.errorMessage ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        finishedAt: data.finishedAt?.toDate?.()?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
