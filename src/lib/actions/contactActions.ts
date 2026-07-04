
// src/lib/actions/contactActions.ts
'use server';

import { createHash } from 'node:crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore, Timestamp } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { ContactUsSchema } from '@/lib/schemas';
import type { ContactUsFormInput } from '@/lib/schemas';
import { sendContactEnquiryAckEmail, sendContactEnquiryAdminEmail, sendContactEnquiryReplyEmail } from '@/lib/auth/brevoService';
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
  const isDev = process.env.NODE_ENV !== 'production';
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (token === 'BYPASS_LOCAL_DEV') {
    return isDev;
  }

    if (!secretKey) {
        console.error("[Turnstile] Secret key is missing in environment variables.");
    return isDev;
    }

    try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: secretKey,
                response: token,
        remoteip: (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim(),
            }),
        });

        const outcome = await res.json();
        if (!outcome?.success) {
          console.warn('[Turnstile] Verification failed', {
            errorCodes: outcome?.['error-codes'] || [],
            action: outcome?.action,
          });
        }
        return !!outcome.success;
    } catch (err) {
        console.error("[Turnstile] Verification exception:", err);
        return false;
    }
}

function normalizeIp(ip: string) {
  return ip.split(',')[0]?.trim() || '127.0.0.1';
}

function normalizeMessageForFingerprint(message: string) {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

async function enforceRateLimit(
  db: Firestore,
  bucket: string,
  key: string,
  windowMs: number,
  maxAttempts: number,
  blockMs: number,
): Promise<{ allowed: boolean; message?: string }> {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const docRef = db.collection('system_logs').doc('rate_limits').collection(bucket).doc(safeKey);

  return db.runTransaction(async (transaction) => {
    const now = Timestamp.now();
    const nowMs = now.toMillis();
    const snap = await transaction.get(docRef);

    if (!snap.exists) {
      transaction.set(docRef, {
        attempts: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
        blockedUntil: null,
      }, { merge: true });
      return { allowed: true };
    }

    const data = snap.data() || {};
    const blockedUntil = data.blockedUntil as Timestamp | null | undefined;
    if (blockedUntil && blockedUntil.toMillis() > nowMs) {
      return { allowed: false, message: 'Too many enquiries. Please try again later.' };
    }

    const firstAttemptAt = (data.firstAttemptAt as Timestamp | undefined)?.toMillis() || nowMs;
    const withinWindow = nowMs - firstAttemptAt <= windowMs;
    const attempts = withinWindow ? Number(data.attempts || 0) + 1 : 1;

    const nextPayload: Record<string, unknown> = {
      attempts,
      firstAttemptAt: withinWindow ? data.firstAttemptAt || now : now,
      lastAttemptAt: now,
      blockedUntil: null,
    };

    if (attempts > maxAttempts) {
      nextPayload.blockedUntil = Timestamp.fromMillis(nowMs + blockMs);
      transaction.set(docRef, nextPayload, { merge: true });
      return { allowed: false, message: 'Too many enquiries. Please wait before sending another message.' };
    }

    transaction.set(docRef, nextPayload, { merge: true });
    return { allowed: true };
  });
}

async function rejectDuplicateFingerprint(db: Firestore, fingerprint: string): Promise<boolean> {
  const docRef = db.collection('system_logs').doc('rate_limits').collection('enquiry_fingerprints').doc(fingerprint);
  const snap = await docRef.get();
  const now = Timestamp.now();

  if (snap.exists) {
    const lastAttemptAt = snap.data()?.lastAttemptAt as Timestamp | undefined;
    if (lastAttemptAt && now.toMillis() - lastAttemptAt.toMillis() < 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  await docRef.set({ lastAttemptAt: now }, { merge: true });
  return false;
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
  const headerList = await headers();
  const ip = normalizeIp(headerList.get('x-forwarded-for') || '127.0.0.1');
  
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
      if (timeTaken < 4000) {
            console.warn(`[Spam Guard] Submission too fast (${timeTaken}ms) from IP: ${ip}`);
            return { success: false, message: "Please take a moment to fill the form." };
        }
    }

    const validation = ContactUsSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, message: validation.error.errors[0].message };
    }

    const ipRate = await enforceRateLimit(adminDb, 'enquiries_by_ip', ip, 10 * 60 * 1000, 2, 60 * 60 * 1000);
    if (!ipRate.allowed) return { success: false, message: ipRate.message || 'Too many requests.' };

    const emailRate = await enforceRateLimit(adminDb, 'enquiries_by_email', hashValue(validation.data.email.toLowerCase()), 30 * 60 * 1000, 2, 2 * 60 * 60 * 1000);
    if (!emailRate.allowed) return { success: false, message: emailRate.message || 'Too many requests.' };

    const fingerprint = hashValue(`${validation.data.email.toLowerCase()}::${normalizeMessageForFingerprint(validation.data.message)}`);
    const isDuplicateMessage = await rejectDuplicateFingerprint(adminDb, fingerprint);
    if (isDuplicateMessage) {
      console.warn(`[Spam Guard] Duplicate enquiry blocked for email: ${validation.data.email}`);
      return { success: false, message: 'Duplicate enquiry detected. Please wait for the team to respond to your earlier message.' };
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
      selectedEventId: validation.data.selectedEventId || null,
      selectedEventName: validation.data.selectedEventName || null,
    };
    
    await adminDb.collection('enquiries').add(enquiryData);

    if (!isSpam) {
        await sendContactEnquiryAckEmail(
          validation.data.email,
          validation.data.name,
          validation.data.mobile,
          validation.data.message,
          ticketId,
          validation.data.about,
          validation.data.selectedEventName || undefined,
          validation.data.selectedEventId || undefined,
          ['enquiries']
        ).catch(err => console.error("Email Ack Failed:", err));
        
        await sendContactEnquiryAdminEmail(
            validation.data.name,
            validation.data.email,
            validation.data.mobile,
            validation.data.message,
            ticketId,
            validation.data.about,
            validation.data.selectedEventName || undefined,
            validation.data.selectedEventId || undefined
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
    const enquiryRef = adminDb.collection('enquiries').doc(enquiryId);
    const enquirySnap = await enquiryRef.get();
    if (!enquirySnap.exists) {
      return { success: false, message: 'Enquiry not found.' };
    }

    const enquiry = enquirySnap.data() as Enquiry;
    const recipientEmail = String(enquiry.email || '').trim().toLowerCase();
    if (!recipientEmail) {
      return { success: false, message: 'Enquiry email is missing.' };
    }

    const emailSent = await sendContactEnquiryReplyEmail({
      recipientEmail,
      name: String(enquiry.name || 'Athlete'),
      ticketId: String(enquiry.ticketId || enquiryId),
      replyMessage,
    });

    if (!emailSent) {
      return { success: false, message: 'Reply email could not be sent. Please check Brevo configuration/logs.' };
    }

    await enquiryRef.update({
      status: 'Replied',
      updatedAt: FieldValue.serverTimestamp(),
      replies: FieldValue.arrayUnion({
        message: replyMessage,
        sentAt: new Date().toISOString(),
        sentBy: 'Admin',
      }),
    });
    return { success: true, message: 'Reply sent and logged.' };
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
