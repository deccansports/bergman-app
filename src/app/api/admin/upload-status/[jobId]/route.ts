
// src/app/api/admin/upload-status/[jobId]/route.ts
import { NextResponse } from 'next/server';
import { getJobStatus } from '@/lib/jobManager';
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
