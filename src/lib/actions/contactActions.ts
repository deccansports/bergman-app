
// src/lib/actions/contactActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore, Timestamp } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { ContactUsSchema } from '@/lib/schemas';
import type { ContactUsFormInput } from '@/lib/schemas';
import { sendContactEnquiryAckEmail, sendContactEnquiryAdminEmail } from '@/lib/auth/brevoService';
import { serializeValue } from '@/lib/utils';
import { headers } from 'next/headers';
import { calculateSpamScore } from '../spamFilter';
import type { Enquiry } from '@/lib/types';

async function getNextTicketId(db: Firestore): Promise<string> {
  const counterRef = db.collection('counters').doc('enquiryCounter');
  const nextNumber = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let nextNum = 1;
    if (counterDoc.exists) {
      nextNum = (counterDoc.data()?.currentNumber || 0) + 1;
    }
    transaction.set(counterRef, { currentNumber: nextNum }, { merge: true });
    return nextNum;
  });
  return `BGM-ENQ-${String(nextNumber).padStart(6, '0')}`;
}

async function verifyTurnstile(token: string): Promise<boolean> {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
        console.error("[Turnstile] Secret key is missing in environment variables.");
        return true; 
    }

    try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: secretKey,
                response: token,
            }),
        });

        const outcome = await res.json();
        return !!outcome.success;
    } catch (err) {
        console.error("[Turnstile] Verification exception:", err);
        return false;
    }
}

export type ContactUsActionInput = ContactUsFormInput & { 
    website?: string; 
    formStartTime?: number; 
    turnstileToken?: string 
};

export async function contactUsAction(
  data: ContactUsActionInput
): Promise<{ success: boolean; message: string; ticketId?: string }> {
  const actionName = 'contactUsAction';
  const headerList = headers();
  const ip = headerList.get('x-forwarded-for') || '127.0.0.1';
  
  try {
    const adminDb = getFirestoreInstance();

    // 1. TURNSTILE CHECK
    if (!data.turnstileToken) {
        return { success: false, message: "Security challenge incomplete." };
    }
    const isHuman = await verifyTurnstile(data.turnstileToken);
    if (!isHuman) {
        console.warn(`[Spam Guard] Turnstile rejected token from IP: ${ip}`);
        return { success: false, message: "Security verification failed." };
    }

    // 2. HONEYPOT CHECK
    if (data.website) {
        console.warn(`[Spam Guard] Honeypot triggered by IP: ${ip}`);
        return { success: false, message: "Spam detected." };
    }

    // 3. TIME DELAY CHECK
    if (data.formStartTime) {
        const timeTaken = Date.now() - data.formStartTime;
        if (timeTaken < 3000) {
            console.warn(`[Spam Guard] Submission too fast (${timeTaken}ms) from IP: ${ip}`);
            return { success: false, message: "Please take a moment to fill the form." };
        }
    }

    // 4. RATE LIMITING
    const rateKey = `rate_${ip.replace(/\./g, '_')}`;
    const rateRef = adminDb.collection('system_logs').doc('rate_limits').collection('enquiries').doc(rateKey);
    const rateSnap = await rateRef.get();
    
    if (rateSnap.exists) {
        const rateData = rateSnap.data();
        const lastSent = rateData?.timestamp as Timestamp;
        if (lastSent && (Date.now() - lastSent.toMillis() < 60000)) { 
            return { success: false, message: "Too many requests. Please wait a minute." };
        }
    }
    await rateRef.set({ timestamp: FieldValue.serverTimestamp() });

    const validation = ContactUsSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, message: validation.error.errors[0].message };
    }
    
    const { isSpam, score } = calculateSpamScore(validation.data);
    
    const ticketId = await getNextTicketId(adminDb);
    const enquiryData: any = {
      ...validation.data,
      ticketId,
      status: isSpam ? 'Spam' : 'Open',
      isSpam,
      spamScore: score,
      ipAddress: ip,
      userAgent: headerList.get('user-agent'),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      replies: [],
      tag: 'enquiries',
    };
    
    await adminDb.collection('enquiries').add(enquiryData);

    if (!isSpam) {
        await sendContactEnquiryAckEmail(
          validation.data.email,
          validation.data.name,
          validation.data.mobile,
          validation.data.message,
          ticketId,
          ['enquiries']
        ).catch(err => console.error("Email Ack Failed:", err));
        
        await sendContactEnquiryAdminEmail(
            validation.data.name,
            validation.data.email,
            validation.data.mobile,
            validation.data.message,
            ticketId
        ).catch(err => console.error("Admin Email Notify Failed:", err));
    }

    return { 
        success: true, 
        message: isSpam ? 'Message received.' : 'Your enquiry has been submitted.', 
        ticketId 
    };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Failed to submit enquiry: ${e.message}` };
  }
}

export async function getEnquiriesAction(): Promise<{ success: boolean; message: string; enquiries?: Enquiry[] }> {
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection('enquiries').orderBy('createdAt', 'desc').limit(100).get();
    if (snapshot.empty) return { success: true, message: 'No enquiries found.', enquiries: [] };
    const enquiries = snapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Enquiry);
    return { success: true, message: 'Enquiries fetched.', enquiries };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateEnquiryStatusAction(id: string, status: Enquiry['status']) {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('enquiries').doc(id).update({ status, updatedAt: FieldValue.serverTimestamp() });
    return { success: true, message: 'Status updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function replyToEnquiryAction(enquiryId: string, replyMessage: string) {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('enquiries').doc(enquiryId).update({
      status: 'Replied',
      updatedAt: FieldValue.serverTimestamp(),
      replies: FieldValue.arrayUnion({
        message: replyMessage,
        sentAt: new Date().toISOString(),
        sentBy: 'Admin',
      }),
    });
    return { success: true, message: 'Reply logged.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function logUserReplyAction(enquiryId: string, replyMessage: string) {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('enquiries').doc(enquiryId).update({
      updatedAt: FieldValue.serverTimestamp(),
      replies: FieldValue.arrayUnion({
        message: replyMessage,
        sentAt: new Date().toISOString(),
        sentBy: 'User',
      }),
    });
    return { success: true, message: 'Interaction logged.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
