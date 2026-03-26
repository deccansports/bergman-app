// src/app/api/admin/send-campaign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { sendRawHtmlEmail } from '@/lib/auth/brevoService';
import type { EventParticipant, User, ClubRankingEntry, Club } from '@/lib/types';
import { getClubRankingData } from '@/lib/actions/clubActions';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = "force-dynamic";

const PLACEHOLDER_MAP: { [key: string]: string } = {
  '{{name}}': 'name',
  '{{bib_number}}': 'bibNumber',
  '{{gender}}': 'gender',
  '{{ticket_name}}': 'ticketName',
  '{{club_name}}': 'clubName',
  '{{booking_id}}': 'bookingId',
  '{{email}}': 'email',
  '{{mobile}}': 'mobile',
  '{{event_name}}': 'eventName',
  // Club owner specific
  '{{owner_name}}': 'owner_name',
  '{{club_rank}}': 'club_rank',
  '{{club_points}}': 'club_points',
};

function personalizeContent(content: string, recipient: any): string {
  let personalized = content;
  for (const placeholder in PLACEHOLDER_MAP) {
    const key = PLACEHOLDER_MAP[placeholder];
    const value = recipient[key] as string | number | undefined | null;
    personalized = personalized.replace(new RegExp(placeholder, 'gi'), String(value || 'N/A'));
  }
  
  if (recipient.year) {
    personalized = personalized.replace(/{{year}}/gi, String(recipient.year));
  }
  
  // Standard contact email fallback for Brevo/Postmark style
  personalized = personalized.replace(/{{contact.EMAIL}}/gi, recipient.email || 'no-reply@bergmantri.com');
  
  return personalized;
}

export async function POST(request: NextRequest) {
  const actionName = '[API /admin/send-campaign]';

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
    
    let recipients: any[] = [];
    let campaignEventName = eventName || 'Global Campaign';
    let campaignTicketNames = ticketNames || 'N/A';
    
    // --- Determine Recipients ---
    if (targetType === 'club_owners') {
        const clubsSnapshot = await adminDb.collection('clubs').get();
        if (clubsSnapshot.empty) return NextResponse.json({ success: true, message: 'No clubs found.' });

        const ownerUids = Array.from(new Set(clubsSnapshot.docs.map(doc => doc.data().ownerUid).filter(Boolean)));
        const ownerProfiles = new Map<string, any>();
        
        if (ownerUids.length > 0) {
          for (let i = 0; i < ownerUids.length; i += 30) {
            const batch = ownerUids.slice(i, i + 30);
            const ownersSnapshot = await adminDb.collection('users').where('__name__', 'in', batch).get();
            ownersSnapshot.forEach(doc => ownerProfiles.set(doc.id, doc.data()));
          }
        }

        const rankingData = await getClubRankingData({ year: parseInt(year) });
        const clubRankingsMap = new Map<string, ClubRankingEntry>();
        if(rankingData.success && rankingData.rankings) {
            rankingData.rankings.forEach((r, index) => clubRankingsMap.set(r.clubId, {...r, overallRank: index + 1}));
        }
        
        clubsSnapshot.docs.forEach(doc => {
            const club = doc.data();
            const owner = ownerProfiles.get(club.ownerUid);
            const rank = clubRankingsMap.get(doc.id);
            if (owner?.email) {
                recipients.push({
                    name: owner.name || club.coach_name || 'Club Owner',
                    owner_name: owner.name || club.coach_name || 'Club Owner',
                    email: owner.email,
                    club_name: club.name,
                    club_rank: rank ? String(rank.overallRank) : 'N/A',
                    club_points: rank ? rank.totalPoints : 0,
                    year
                });
            }
        });

    } else if (targetType === 'all_athletes') {
        const usersSnapshot = await adminDb.collection('users').get();
        recipients = usersSnapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
        campaignEventName = 'All Athletes Campaign';
    } else if (targetType === 'event') {
      if (excludeRegistered) {
        const registeredSnapshot = await adminDb.collection('events').doc(eventId!).collection('participants').select('email').get();
        const registeredEmails = new Set(registeredSnapshot.docs.map(doc => doc.data().email.toLowerCase()));
        const allUsersSnapshot = await adminDb.collection('users').get();
        allUsersSnapshot.forEach(doc => {
            const user = doc.data() as User;
            if (user.email && !registeredEmails.has(user.email.toLowerCase())) {
                recipients.push({ ...user, event_name: campaignEventName, eventName: campaignEventName });
            }
        });
      } else {
        if (!ticketIds || ticketIds.length === 0) {
          return NextResponse.json({ success: false, message: 'Please select ticket categories.' }, { status: 400 });
        }
        const participantsSnapshot = await adminDb.collection('events').doc(eventId!).collection('participants')
            .where('ticketId', 'in', ticketIds)
            .where('ticketStatus', '==', 'Active')
            .get();
        recipients = participantsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      }
    }
    
    if (recipients.length === 0) return NextResponse.json({ success: true, message: 'No recipients found.' });
    
    const campaignLogRef = adminDb.collection('campaignLogs');
    const batchSize = 100;
    let emailsSent = 0;
    let emailsFailed = 0;

    // Process in smaller batches to avoid timeouts and API rate limits
    for (let i = 0; i < recipients.length; i += batchSize) {
        const currentBatch = recipients.slice(i, i + batchSize);
        const logBatch = adminDb.batch();

        await Promise.all(currentBatch.map(async (recipient) => {
            if (!recipient.email) {
                emailsFailed++;
                return;
            }
            
            const personalizedSubject = personalizeContent(subject, recipient);
            const personalizedHtml = personalizeContent(htmlContent, recipient);
            
            const success = await sendRawHtmlEmail(recipient.email, personalizedSubject, personalizedHtml, attachment);
            if (success) {
                emailsSent++;
                logBatch.set(campaignLogRef.doc(), {
                    recipientEmail: recipient.email,
                    recipientName: recipient.name || 'Athlete',
                    subject: personalizedSubject,
                    eventId: eventId || 'N/A',
                    eventName: campaignEventName,
                    ticketNames: campaignTicketNames,
                    sentAt: FieldValue.serverTimestamp(),
                    status: 'Success',
                    sentBy: adminUid,
                });
            } else {
                emailsFailed++;
            }
        }));

        if (emailsSent > 0) await logBatch.commit();
    }

    return NextResponse.json({
      success: true,
      message: `Broadcast finished. Sent: ${emailsSent}, Failed: ${emailsFailed}.`,
      emailsSent,
      emailsFailed,
    });

  } catch (error: any) {
    console.error(`${actionName} Error:`, error.message);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
