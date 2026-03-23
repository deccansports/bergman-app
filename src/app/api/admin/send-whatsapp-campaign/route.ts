
// src/app/api/admin/send-whatsapp-campaign/route.ts
import { NextResponse } from 'next/server';
import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { startJob, updateJobProgress } from '@/lib/jobManager';

export const dynamic = "force-dynamic";

const TOKEN_MAP: Record<string, string> = {
  '{{name}}': 'name',
  '{{bib_number}}': 'bibNumber',
  '{{event_name}}': 'eventName',
  '{{ticket_name}}': 'ticketName',
  '{{booking_id}}': 'bookingId',
  '{{mobile}}': 'mobile',
  '{{email}}': 'email',
};

function resolveValue(placeholder: string, recipient: any): string {
  const key = TOKEN_MAP[placeholder] || placeholder.replace(/{{|}}/g, '');
  const val = recipient[key];
  return val !== undefined && val !== null ? String(val) : (placeholder.startsWith('{{') ? 'N/A' : placeholder);
}

/**
 * 🚀 DIRECT BROADCAST ENGINE (SEQUENTIAL LOOP)
 */
async function runBroadcastJob(jobId: string, data: any, adminUid: string) {
  const db = getFirestoreInstance();
  const logCol = db.collection('whatsappLogs');

  const {
    targetType,
    eventId,
    ticketIds,
    statusFilter = ['Active', 'Confirmed'],
    excludeRegistered,
    templateName,
    templateParams,
    mediaUrl,
    mediaFilename
  } = data;

  const checkpoint = async (stage: string, progress: number, message?: string) => {
    await updateJobProgress(jobId, {
      stage,
      progress,
      message: message || stage,
      status: 'processing'
    });
  };

  try {
    await checkpoint('Fetching audience...', 5);

    let recipients: any[] = [];
    const seen = new Set<string>();
    let logEventName = data.campaignName || 'Broadcast';

    const media = mediaUrl
      ? { filename: mediaFilename || 'attachment', url: mediaUrl }
      : null;

    // ===============================
    // 🎯 AUDIENCE RESOLUTION
    // ===============================
    if (targetType === 'club_owners') {
      const clubsSnap = await db.collection('clubs').get();
      const ownerUids = Array.from(
        new Set(clubsSnap.docs.map(d => d.data().ownerUid).filter(Boolean))
      );

      for (let i = 0; i < ownerUids.length; i += 30) {
        const batch = ownerUids.slice(i, i + 30);
        const usersSnap = await db.collection('users').where(FieldPath.documentId(), 'in', batch).get();
        usersSnap.forEach(doc => {
          const u = doc.data();
          if (u.mobile && !seen.has(u.mobile)) {
            seen.add(u.mobile);
            recipients.push({ name: u.name, mobile: u.mobile, email: u.email, uid: doc.id });
          }
        });
      }

    } else if (targetType === 'all_athletes') {
      const usersSnap = await db.collection('users').get();
      usersSnap.forEach(doc => {
        const u = doc.data();
        if (u.mobile && !seen.has(u.mobile)) {
          seen.add(u.mobile);
          recipients.push({ name: u.name, mobile: u.mobile, email: u.email, uid: doc.id });
        }
      });

    } else if (targetType === 'event' && eventId) {
      const eventSnap = await db.collection('events').doc(eventId).get();
      logEventName = eventSnap.data()?.eventName || 'Event Broadcast';

      if (excludeRegistered) {
        const registeredSnap = await db.collection('events').doc(eventId).collection('participants').select('email').get();
        const registeredEmails = new Set(registeredSnap.docs.map(d => d.data().email?.toLowerCase()).filter(Boolean));
        const usersSnap = await db.collection('users').get();
        usersSnap.forEach(doc => {
          const u = doc.data();
          if (u.mobile && u.email && !registeredEmails.has(u.email.toLowerCase()) && !seen.has(u.mobile)) {
            seen.add(u.mobile);
            recipients.push({ name: u.name, mobile: u.mobile, email: u.email, uid: doc.id, eventName: logEventName });
          }
        });
      } else {
        let query: FirebaseFirestore.Query = db.collection('events').doc(eventId).collection('participants');
        if (ticketIds?.length) {
          query = query.where('ticketId', 'in', ticketIds);
        }
        const snap = await query.get();
        snap.forEach(doc => {
          const d = doc.data();
          if (d.mobile && (!statusFilter || statusFilter.includes(d.ticketStatus)) && !seen.has(d.mobile)) {
            seen.add(d.mobile);
            recipients.push({ name: d.name, mobile: d.mobile, email: d.email, bibNumber: d.bibNumber, ticketName: d.ticketName, bookingId: d.bookingId, eventName: logEventName, id: doc.id });
          }
        });
      }
    }

    if (recipients.length === 0) {
      await updateJobProgress(jobId, { status: 'completed', progress: 100, message: 'No eligible recipients found.' });
      return;
    }

    // ===============================
    // 📤 DELIVERY LOOP
    // ===============================
    let sent = 0;
    let failed = 0;
    const total = recipients.length;
    const delayMs = 500; 

    for (let i = 0; i < total; i++) {
      const r = recipients[i];
      try {
        const params = (templateParams || []).map((p: any) => resolveValue(p.value, r));
        const result = await sendAiSensyMessage(r.mobile, templateName, params, 'Campaign', `Direct-${jobId}`, r.name, media);

        await logCol.add({
          recipientMobile: r.mobile,
          recipientName: r.name || 'Athlete',
          templateName,
          eventName: logEventName,
          sentAt: FieldValue.serverTimestamp(),
          status: result.success ? 'Success' : 'Failed',
          error: result.error || null,
          sentBy: adminUid
        });

        if (result.success) sent++;
        else failed++;
      } catch (err: any) {
        failed++;
        await logCol.add({ recipientMobile: r.mobile, recipientName: r.name || 'Athlete', templateName, eventName: logEventName, sentAt: FieldValue.serverTimestamp(), status: 'Failed', error: err.message, sentBy: adminUid });
      }

      if (i % 2 === 0 || i === total - 1) {
        const prog = Math.round(((i + 1) / total) * 100);
        await checkpoint(`Delivering: ${i + 1}/${total}`, prog, `Sent: ${sent}, Failed: ${failed}`);
      }
      await new Promise(res => setTimeout(res, delayMs));
    }

    await updateJobProgress(jobId, { status: 'completed', progress: 100, message: `Finished. Sent: ${sent}, Failed: ${failed}` });

  } catch (err: any) {
    console.error('[Broadcast Fatal]', err.message);
    await updateJobProgress(jobId, { status: 'failed', message: err.message });
  }
}

/**
 * 📡 API HANDLER
 */
export async function POST(request: Request) {
  const actionName = '[API /admin/send-whatsapp-campaign]';

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = await getAuthInstance().verifyIdToken(token);

    const db = getFirestoreInstance();
    const admin = await db.collection('users').doc(decoded.uid).get();

    if (!admin.exists || !admin.data()?.isAdmin) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    const data = await request.json();

    // ===============================
    // ✅ TEST MESSAGE
    // ===============================
    if (data.isTest && data.testMobile) {
      const media = data.mediaUrl ? { filename: data.mediaFilename || 'attachment', url: data.mediaUrl } : null;
      const params = (data.templateParams || []).map((p: any) => {
          let val = p.value;
          val = val.replace(/{{name}}/gi, 'Test Athlete');
          val = val.replace(/{{event_name}}/gi, data.eventName || 'Bergman Test');
          val = val.replace(/{{bib_number}}/gi, '123');
          return val;
      });

      const result = await sendAiSensyMessage(data.testMobile, data.templateName, params, 'Test', 'API-Direct', 'Admin', media);
      return NextResponse.json(result);
    }

    // ===============================
    // 🚀 BROADCAST EXECUTION
    // ===============================
    const { jobId } = await startJob();

    // Initial state
    await updateJobProgress(jobId, {
      status: "processing",
      stage: "Initializing",
      progress: 1
    });

    // Start direct send loop (sequential)
    await runBroadcastJob(jobId, data, decoded.uid);

    return NextResponse.json({
      success: true,
      message: 'Broadcast started successfully',
      jobId
    });

  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
