
// src/lib/actions/faqActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { FaqEntry } from '@/lib/types';
import { toIsoStringSafe } from '@/lib/utils';

const FAQ_COLLECTION = 'faqs';
const AI_LOGS_COLLECTION = 'aiLogs';

export async function addFaqAction(
  data: { question: string; answer: string }
): Promise<{ success: boolean; message: string; faqId?: string }> {
  const actionName = 'addFaqAction';
  if (!data.question || !data.answer) {
    return { success: false, message: 'Question and answer are required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const newFaqRef = await adminDb.collection(FAQ_COLLECTION).add({
      question: data.question,
      answer: data.answer,
      createdAt: FieldValue.serverTimestamp(),
    });
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'FAQ added successfully.', faqId: newFaqRef.id };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updateFaqAction(
  id: string,
  data: { question: string; answer: string }
): Promise<{ success: boolean; message: string }> {
  const actionName = 'updateFaqAction';
  if (!id) return { success: false, message: 'FAQ ID is required for update.' };
  if (!data.question || !data.answer) {
    return { success: false, message: 'Question and answer cannot be empty.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const faqRef = adminDb.collection(FAQ_COLLECTION).doc(id);
    await faqRef.update({
      question: data.question,
      answer: data.answer,
      updatedAt: FieldValue.serverTimestamp(),
    });
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'FAQ updated successfully.' };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getFaqsAction(): Promise<{
  success: boolean;
  message: string;
  faqs?: FaqEntry[];
}> {
  const actionName = 'getFaqsAction';
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection(FAQ_COLLECTION).get();
    
    if (snapshot.empty) {
      return { success: true, message: 'No FAQs found.', faqs: [] };
    }

    const faqs: FaqEntry[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            question: data.question,
            answer: data.answer,
            createdAt: toIsoStringSafe(data.createdAt) || new Date().toISOString(),
        }
    });

    faqs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { success: true, message: 'FAQs fetched.', faqs };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Failed to get FAQs: ${e.message}` };
  }
}

export async function deleteFaqAction(
    id: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'deleteFaqAction';
    if (!id) {
        return { success: false, message: 'FAQ ID is required.' };
    }
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection(FAQ_COLLECTION).doc(id).delete();
        revalidatePath('/admin/dashboard');
        return { success: true, message: 'FAQ deleted successfully.' };
    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}

export async function logAiInteractionAction(data: {
  userUid: string | null;
  userName: string | null;
  question: string;
  answer: string;
}) {
  try {
    const db = getFirestoreInstance();
    await db.collection(AI_LOGS_COLLECTION).add({
      ...data,
      timestamp: FieldValue.serverTimestamp(),
    });
    return { success: true };
  } catch (e) {
    console.error("AI Logging Failed:", e);
    return { success: false };
  }
}
