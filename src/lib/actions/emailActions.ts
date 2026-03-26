
// src/lib/actions/emailActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { toIsoStringSafe } from '@/lib/utils';
import {
  sendRawHtmlEmail,
  sendRegistrationConfirmationEmail,
  sendMonthlyDeferralReminderEmail,
  sendIncompleteRegistrationEmail,
  sendAdminTicketSaleNotificationEmail,
} from '../auth/brevoService';
import { sendIncompleteRegistrationWhatsApp, sendRegistrationConfirmationViaWhatsApp } from '../auth/aisensyService';
import type {
  CampaignLogEntry,
  EventCalendarEntry,
  EventParticipant
} from '@/lib/types';
import { startOfDay, isAfter, parseISO } from 'date-fns';

/* ---------------------------------------------------------
   TEST PLACEHOLDER UTILS
---------------------------------------------------------- */

const samplePlaceholders: Record<string, string> = {
  '{{name}}': 'Test Athlete',
  '{{bib_number}}': '123',
  '{{gender}}': 'Unspecified',
  '{{ticket_name}}': 'Sample Ticket',
  '{{club_name}}': 'Test Club',
  '{{booking_id}}': 'BMIN-TEST',
  '{{email}}': 'test@example.com',
  '{{mobile}}': '+919876543210'
};

function replacePlaceholders(content: string, isTest = false): string {
  if (!isTest) return content;
  let out = content;
  for (const key in samplePlaceholders) {
    out = out.replace(new RegExp(key, 'gi'), samplePlaceholders[key]);
  }
  return out.replace(/{{contact.EMAIL}}/gi, samplePlaceholders['{{email}}']);
}

/* ---------------------------------------------------------
   TEST CAMPAIGN EMAIL
---------------------------------------------------------- */

export async function sendTestCampaignEmailAction(
  testEmail: string,
  subject: string,
  htmlContent: string,
  attachment: { content: string; name: string } | null
): Promise<{ success: boolean; message: string }> {
  if (!testEmail || !subject || !htmlContent) {
    return { success: false, message: 'Missing required fields.' };
  }

  const personalizedSubject = replacePlaceholders(subject, true);
  const personalizedBody = replacePlaceholders(htmlContent, true);

  const footer = `
    <hr>
    <p style="font-size:12px;color:#666;text-align:center">
      Bergman Triathlon India<br>
      This email was sent to {{contact.EMAIL}}
    </p>
  `;

  const finalHtml = (personalizedBody + footer).replace(
    /{{contact.EMAIL}}/gi,
    testEmail
  );

  const success = await sendRawHtmlEmail(
    testEmail,
    personalizedSubject,
    finalHtml,
    attachment
  );

  if (success) {
    const db = getFirestoreInstance();
    await db.collection('campaignLogs').add({
      recipientEmail: testEmail,
      recipientName: 'Test Recipient',
      subject: `[TEST] ${personalizedSubject}`,
      sentAt: FieldValue.serverTimestamp(),
      status: 'Success',
      sentBy: 'Admin'
    });
    revalidatePath('/admin/dashboard');
  }

  return {
    success,
    message: success ? 'Test email sent.' : 'Failed to send test email.'
  };
}

/* ---------------------------------------------------------
   CAMPAIGN LOGS
---------------------------------------------------------- */

export async function getCampaignLogsAction(): Promise<{
  success: boolean;
  message: string;
  logs?: CampaignLogEntry[];
  stats?: { totalSent: number; sentToday: number };
}> {
  try {
    const db = getFirestoreInstance();
    const snap = await db
      .collection('campaignLogs')
      .orderBy('sentAt', 'desc')
      .limit(500) // Fetch more to calculate stats accurately
      .get();

    const logs = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      sentAt: toIsoStringSafe(doc.data().sentAt)
    })) as CampaignLogEntry[];

    const totalSent = logs.length;
    const today = new Date();
    const startOfTodayForStats = startOfDay(today);

    const sentToday = logs.filter(log => {
        try {
            if (!log.sentAt) return false;
            return isAfter(parseISO(log.sentAt), startOfTodayForStats);
        } catch {
            return false;
        }
    }).length;

    const stats = { totalSent, sentToday };

    return { success: true, message: 'Logs and stats fetched.', logs: logs.slice(0, 200), stats };
  } catch (e: any) {
    console.error("[getCampaignLogsAction] Error:", e.message);
    return { success: false, message: `Failed to fetch logs: ${e.message}` };
  }
}

/* ---------------------------------------------------------
   INDIVIDUAL CONFIRMATION EMAIL
---------------------------------------------------------- */

export async function sendIndividualConfirmationEmailAction(
  eventId: string,
  participantId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();

    const eventSnap = await db.collection('events').doc(eventId).get();
    const participantSnap = await db
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .doc(participantId)
      .get();

    if (!eventSnap.exists || !participantSnap.exists) {
      return { success: false, message: 'Event or participant not found.' };
    }

    const event = eventSnap.data() as EventCalendarEntry;
    const participant = participantSnap.data() as EventParticipant;

    if (!participant.email) {
      return { success: false, message: 'Participant has no email.' };
    }

    const success = await sendRegistrationConfirmationEmail(
      participant.email,
      participant.name,
      event.eventName,
      participant.bookingId!,
      new Date(participant.registeredAt!),
      participant.ticketName!,
      event.venueName || event.address,
      event.eventDate || null,
      participant.address,
      participant.mobile,
      participant.emergencyContactNumber,
      participant.invoiceNumber,
      participant.bibNumber,
      event.organizerName,
      event.organizerAddress,
      event.organizerCompanyDescription,
      participant.country
    );

    return {
      success,
      message: success ? 'Confirmation email sent.' : 'Email failed.'
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/* ---------------------------------------------------------
   INDIVIDUAL CONFIRMATION WHATSAPP
---------------------------------------------------------- */

export async function sendIndividualConfirmationWhatsAppAction(
  eventId: string,
  participantId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();

    const eventSnap = await db.collection('events').doc(eventId).get();
    const participantSnap = await db
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .doc(participantId)
      .get();

    if (!eventSnap.exists || !participantSnap.exists) {
      return { success: false, message: 'Event or participant not found.' };
    }

    const event = eventSnap.data() as EventCalendarEntry;
    const participant = participantSnap.data() as EventParticipant;

    if (!participant.mobile) {
      return { success: false, message: 'Participant has no mobile number.' };
    }

    const result = await sendRegistrationConfirmationViaWhatsApp(
        participant.mobile, 
        participant.name!, 
        event.eventName, 
        participant.bookingId!, 
        new Date(participant.registeredAt!), 
        participant.ticketName!,
        participant.bibNumber ?? null,
        event.venueName ?? null,
        event.eventDate
    );

    return { success: result.success, message: result.message };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendIncompleteRegistrationNoticeAction(
  name: string,
  email: string | null,
  eventName: string,
  redirectUrl: string | null,
  mobile: string | null
): Promise<{ success: boolean; message: string }> {
  let emailSuccess = false;
  let whatsappSuccess = false;
  let message = '';

  if (email) {
    emailSuccess = await sendIncompleteRegistrationEmail(email, name, eventName, redirectUrl);
    message += `Email ${emailSuccess ? 'sent' : 'failed'}. `;
  }
  if (mobile) {
    const whatsappResult = await sendIncompleteRegistrationWhatsApp(mobile, name, eventName);
    whatsappSuccess = whatsappResult.success;
    message += `WhatsApp ${whatsappSuccess ? 'sent' : 'failed'}.`;
  }
  
  const overallSuccess = emailSuccess || whatsappSuccess;

  return {
    success: overallSuccess,
    message: overallSuccess ? "Reminder sent." : "Failed to send reminder."
  };
}
