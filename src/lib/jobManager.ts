
// src/lib/jobManager.ts
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { serializeValue } from './utils';

const JOBS_COLLECTION = 'backgroundJobs';

export interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  stage?: string; // Track specific sync phases
  results: any[];
  message?: string;
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

export async function updateJobProgress(jobId: string, updates: Partial<Omit<Job, 'id' | 'createdAt'>>) {
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
