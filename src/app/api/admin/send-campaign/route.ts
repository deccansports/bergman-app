// src/app/api/admin/send-campaign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { sendRawHtmlEmail } from '@/lib/auth/brevoService';
import type { User, ClubRankingEntry } from '@/lib/types';
import { getClubRankingData } from '@/lib/actions/clubActions';
import { FieldValue } from 'firebase-admin/firestore';
import { getEventParticipants } from '@/lib/dataLayerOptimized';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';

export const dynamic = "force-dynamic";
export const runtime = 'nodejs';
export const maxDuration = 60; // seconds (Firebase App Hosting supports long requests)

const PLACEHOLDER_MAP: { [key: string]: string } = {
  name: 'name',
  bib_number: 'bibNumber',
  gender: 'gender',
  ticket_name: 'ticketName',
  ticket: 'ticketName',
  club_name: 'clubName',
  booking_id: 'bookingId',
  email: 'email',
  mobile: 'mobile',
  event_name: 'eventName',
  eventname: 'eventName',
  event_venue: 'eventVenue',
  eventdate: 'eventDate',
  event_date: 'eventDate',
  // Club owner specific
  owner_name: 'owner_name',
  club_rank: 'club_rank',
  club_points: 'club_points',
};

function personalizeContent(content: string, recipient: any): string {
  let personalized = content;
  for (const placeholderKey in PLACEHOLDER_MAP) {
    const key = PLACEHOLDER_MAP[placeholderKey];
    const value = recipient[key] as string | number | undefined | null;
    // Supports both {{key}} and {{params.key}}
    personalized = personalized.replace(new RegExp(`{{\\s*${placeholderKey}\\s*}}`, 'gi'), String(value || 'N/A'));
    personalized = personalized.replace(new RegExp(`{{\\s*params\\.${placeholderKey}\\s*}}`, 'gi'), String(value || 'N/A'));
  }
  
  if (recipient.year) {
    personalized = personalized.replace(/{{\s*year\s*}}/gi, String(recipient.year));
    personalized = personalized.replace(/{{\s*params\.year\s*}}/gi, String(recipient.year));
  }
  
  // Standard contact email fallback for Brevo/Postmark style
  personalized = personalized.replace(/{{\s*contact\.EMAIL\s*}}/gi, recipient.email || 'no-reply@bergmantri.com');
  
  return personalized;
}

/* -----------------------------------------------------------------------
   Background processor — runs after response is returned to the client
----------------------------------------------------------------------- */
async function processCampaignJob(jobId: string, jobData: any) {
  const adminDb = getFirestoreInstance();
  const jobRef = adminDb.collection('campaignJobs').doc(jobId);

  try {
    await jobRef.update({ status: 'processing', startedAt: FieldValue.serverTimestamp() });

    const {
      eventId, ticketIds, subject, htmlContent, attachment,
      eventName, ticketNames, targetType, year, excludeRegistered, adminUid,
    } = jobData;

    let recipients: any[] = [];
    let campaignEventName = eventName || 'Global Campaign';
    let campaignEventVenue = 'N/A';
    let campaignEventDate = 'N/A';
    let campaignTicketNames = ticketNames || 'N/A';

    if (targetType === 'club_owners') {
      const clubsSnapshot = await adminDb.collection('clubs').get();
      if (!clubsSnapshot.empty) {
        const ownerUids = Array.from(new Set(clubsSnapshot.docs.map((d: any) => d.data().ownerUid).filter(Boolean)));
        const ownerProfiles = new Map<string, any>();
        for (let i = 0; i < ownerUids.length; i += 30) {
          const batch = ownerUids.slice(i, i + 30);
          const ownersSnap = await adminDb.collection('users').where('__name__', 'in', batch).get();
          ownersSnap.forEach((doc: any) => ownerProfiles.set(doc.id, doc.data()));
        }
        const rankingData = await getClubRankingData({ year: parseInt(year) });
        const clubRankingsMap = new Map<string, ClubRankingEntry>();
        if (rankingData.success && rankingData.rankings) {
          rankingData.rankings.forEach((r: any, index: number) => clubRankingsMap.set(r.clubId, { ...r, overallRank: index + 1 }));
        }
        clubsSnapshot.docs.forEach((doc: any) => {
          const club = doc.data();
          const owner = ownerProfiles.get(club.ownerUid);
          const rank = clubRankingsMap.get(doc.id) as any;
          if (owner?.email) {
            recipients.push({
              name: owner.name || club.coach_name || 'Club Owner',
              owner_name: owner.name || club.coach_name || 'Club Owner',
              email: owner.email,
              club_name: club.name,
              club_rank: rank ? String(rank.overallRank) : 'N/A',
              club_points: rank ? rank.totalPoints : 0,
              year,
            });
          }
        });
      }
    } else if (targetType === 'all_athletes') {
      const usersSnapshot = await adminDb.collection('users').get();
      recipients = usersSnapshot.docs.map((doc: any) => ({ ...doc.data(), uid: doc.id }));
      campaignEventName = 'All Athletes Campaign';
    } else if (targetType === 'event') {
      const calendar = await getCalendarEventsAction();
      const selectedEvent: any = calendar.events?.find((e: any) => e.id === eventId) || null;
      campaignEventName = selectedEvent?.eventName || campaignEventName;
      campaignEventVenue = selectedEvent?.venueName || selectedEvent?.address || 'N/A';
      campaignEventDate = selectedEvent?.eventDate || 'N/A';

      if (excludeRegistered) {
        const registeredParticipants = await getEventParticipants(eventId!);
        const registeredEmails = new Set(registeredParticipants.map((p: any) => String(p?.email || '').toLowerCase()).filter(Boolean));
        const allUsersSnapshot = await adminDb.collection('users').get();
        allUsersSnapshot.forEach((doc: any) => {
          const user = doc.data() as User;
          if (user.email && !registeredEmails.has(user.email.toLowerCase())) {
            recipients.push({ ...user, eventName: campaignEventName, eventVenue: campaignEventVenue, eventDate: campaignEventDate });
          }
        });
      } else {
        if (!ticketIds || ticketIds.length === 0) {
          await jobRef.update({ status: 'failed', errorMessage: 'No ticket categories selected.', finishedAt: FieldValue.serverTimestamp() });
          return;
        }
        const participants = await getEventParticipants(eventId!);
        recipients = participants
          .filter((p: any) => ticketIds.includes(p?.ticketId) && p?.ticketStatus === 'Active')
          .map((p: any) => ({
            ...p,
            id: p.id || p.bookingId,
            eventName: p?.eventName || campaignEventName,
            eventVenue: p?.event_venue || p?.eventVenue || campaignEventVenue,
            eventDate: p?.eventdate || p?.eventDate || campaignEventDate,
          }));
      }
    }

    // De-duplicate
    const uniqueRecipients = new Map<string, any>();
    for (const r of recipients) {
      const k = String(r?.email || '').trim().toLowerCase();
      if (k && !uniqueRecipients.has(k)) uniqueRecipients.set(k, r);
    }
    recipients = Array.from(uniqueRecipients.values());

    const totalRecipients = recipients.length;
    await jobRef.update({ totalRecipients, status: 'processing' });

    const campaignLogRef = adminDb.collection('campaignLogs');
    const batchSize = 20;
    let emailsSent = 0;
    let emailsFailed = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const currentBatch = recipients.slice(i, i + batchSize);
      const logBatch = adminDb.batch();

      for (const recipient of currentBatch) {
        if (!recipient.email) { emailsFailed++; continue; }
        const personalizedSubject = personalizeContent(subject, recipient);
        const personalizedHtml = personalizeContent(htmlContent, recipient);
        const success = await sendRawHtmlEmail(recipient.email, personalizedSubject, personalizedHtml, attachment);
        if (success) {
          emailsSent++;
          logBatch.set(campaignLogRef.doc(), {
            recipientEmail: recipient.email,
            recipientName: recipient.name || 'Athlete',
            subject: personalizedSubject,
            hasAttachment: !!attachment,
            eventId: eventId || 'N/A',
            eventName: campaignEventName,
            ticketNames: campaignTicketNames,
            sentAt: FieldValue.serverTimestamp(),
            status: 'Success',
            sentBy: adminUid,
            jobId,
          });
        } else {
          emailsFailed++;
        }
      }

      if (emailsSent > 0) await logBatch.commit();

      // Update progress after each batch
      await jobRef.update({ emailsSent, emailsFailed, progress: Math.round(((i + currentBatch.length) / totalRecipients) * 100) });
    }

    await jobRef.update({
      status: 'completed',
      emailsSent,
      emailsFailed,
      progress: 100,
      finishedAt: FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    console.error('[CampaignJob] Error:', err.message);
    try {
      await jobRef.update({ status: 'failed', errorMessage: err.message, finishedAt: FieldValue.serverTimestamp() });
    } catch (_) {}
  }
}

export async function POST(request: NextRequest) {
  const actionName = '[API /admin/send-campaign]';

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json({ error: 'Firebase not configured', status: 'unavailable' }, { status: 503 });
  }

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Missing token.' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const adminAuth = getAuthInstance();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const adminUid = decodedToken.uid;

    const adminDb = getFirestoreInstance();
    const adminUserDoc = await adminDb.collection('users').doc(adminUid).get();
    if (!adminUserDoc.exists || !adminUserDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Not an admin.' }, { status: 403 });
    }

    const { eventId, ticketIds, subject, htmlContent, attachment, eventName, ticketNames, targetType, year, excludeRegistered } = await request.json();

    if (!subject || !htmlContent) {
      return NextResponse.json({ success: false, message: 'Subject and Content are required.' }, { status: 400 });
    }

    // Create a job document immediately
    const jobData = { eventId, ticketIds, subject, htmlContent, attachment, eventName, ticketNames, targetType, year, excludeRegistered, adminUid };
    const jobRef = await adminDb.collection('campaignJobs').add({
      ...jobData,
      status: 'queued',
      progress: 0,
      emailsSent: 0,
      emailsFailed: 0,
      totalRecipients: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUid,
    });

    const jobId = jobRef.id;

    // Fire-and-forget: process the job in the background without blocking the response
    // On Firebase App Hosting (Cloud Run), the container stays alive so this completes.
    processCampaignJob(jobId, jobData).catch((err) =>
      console.error(`[CampaignJob ${jobId}] Unhandled error:`, err.message)
    );

    return NextResponse.json({
      success: true,
      jobId,
      message: 'Campaign started in the background. You can track progress in the Campaign Logs tab.',
    });

  } catch (error: any) {
    console.error(`${actionName} Error:`, error.message);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
