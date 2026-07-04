
// src/lib/jobManager.ts
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { serializeValue } from './utils';

const JOBS_COLLECTION = 'backgroundJobs';

export interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage?: string; // Track specific sync phases
  syncCount?: number; // How many items synced
  totalCount?: number; // Total items to sync
  results: any[];
  message?: string;
  cancelRequested?: boolean;
  cancelledAt?: any;
  createdAt: any; // Can be Date or FieldValue
  updatedAt: any; // Can be Date or FieldValue
}

export async function startJob(): Promise<{ jobId: string }> {
  const jobId = uuidv4();
  const adminDb = getFirestoreInstance();
  const jobRef = adminDb.collection(JOBS_COLLECTION).doc(jobId);
  
  await jobRef.set({
    id: jobId,
    status: 'pending',
    progress: 0,
    stage: 'Initializing',
    results: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  
  console.log(`[JobManager] Started job ${jobId} in Firestore.`);
  return { jobId };
}

export async function updateJobProgress(jobId: string, updates: Partial<Job> & { id?: never; createdAt?: never; }) {
  try {
    const adminDb = getFirestoreInstance();
    const jobRef = adminDb.collection(JOBS_COLLECTION).doc(jobId);
    
    // Ensure updates are serialized (handles BigInt, Timestamps, etc)
    const serializedUpdates = serializeValue(updates);

    await jobRef.update({
      ...serializedUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error(`[JobManager] Failed to update job ${jobId} in Firestore:`, error);
  }
}

export async function requestJobCancel(jobId: string, message = 'Cancellation requested.') {
  try {
    const adminDb = getFirestoreInstance();
    const jobRef = adminDb.collection(JOBS_COLLECTION).doc(jobId);

    await jobRef.set({
      status: 'cancelled',
      cancelRequested: true,
      cancelledAt: FieldValue.serverTimestamp(),
      message,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.error(`[JobManager] Failed to cancel job ${jobId}:`, error);
    throw error;
  }
}

export async function isJobCancelRequested(jobId: string): Promise<boolean> {
  const job = await getJobStatus(jobId);
  return Boolean(job?.cancelRequested || job?.status === 'cancelled');
}

export async function getJobStatus(jobId: string): Promise<Job | null> {
  try {
    const adminDb = getFirestoreInstance();
    const jobRef = adminDb.collection(JOBS_COLLECTION).doc(jobId);
    const jobSnap = await jobRef.get();
    
    if (!jobSnap.exists) {
      return null;
    }
    
    const jobData = jobSnap.data() as Job;
    return serializeValue(jobData);
  } catch (error) {
    console.error(`[JobManager] Failed to get job status for ${jobId} from Firestore:`, error);
    return null;
  }
}
