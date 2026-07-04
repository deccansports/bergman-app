
// src/app/api/admin/upload-status/[jobId]/route.ts
import { NextResponse } from 'next/server';
import { getJobStatus, requestJobCancel } from '@/lib/jobManager';
import { toIsoStringSafe } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  const jobId = params.jobId;
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
  }

  const job = await getJobStatus(jobId);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  
  // Ensure dates are serialized correctly before sending
  const serializableJob = {
      ...job,
      createdAt: toIsoStringSafe(job.createdAt),
      updatedAt: toIsoStringSafe(job.updatedAt),
  };

  return NextResponse.json(serializableJob);
}

export async function POST(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  const jobId = params.jobId;
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || '').trim().toLowerCase();
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }

  const job = await getJobStatus(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  await requestJobCancel(jobId, 'Cancellation requested from admin UI.');
  return NextResponse.json({ success: true, status: 'cancelled' });
}
