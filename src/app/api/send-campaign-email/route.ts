// src/app/api/send-campaign-email/route.ts
import { NextResponse } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { sendRawHtmlEmail } from '@/lib/auth/brevoService';
import type { User } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(request: Request) {
  const actionName = '[API /send-campaign-email]';

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

    const { subject, htmlContent, targetEmails } = await request.json();
    if (!subject || !htmlContent) {
      return NextResponse.json({ success: false, message: 'Subject and HTML content are required.' }, { status: 400 });
    }

    let emailsToSend: { email: string; name: string; }[] = [];
    if (Array.isArray(targetEmails) && targetEmails.length > 0) {
      // If a specific list is provided, map it to the required format
      const usersSnapshot = await adminDb.collection('users').where('email', 'in', targetEmails).get();
      const usersData = new Map<string, string>(); // email -> name
      usersSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.email) {
              usersData.set(data.email.toLowerCase(), data.name || data.email.split('@')[0]);
          }
      });
      emailsToSend = targetEmails.map(email => ({
          email: email,
          name: usersData.get(email.toLowerCase()) || email.split('@')[0]
      }));
    } else {
      // If no list, get all club owners
      const clubsSnapshot = await adminDb.collection('clubs').get();
      const ownerUids = new Set<string>();
      clubsSnapshot.forEach(doc => {
          const clubData = doc.data();
          if (clubData.ownerUid) {
              ownerUids.add(clubData.ownerUid);
          }
      });
      
      const ownerUidsArray = Array.from(ownerUids);
      if (ownerUidsArray.length > 0) {
        // **FIX START**: Fetch users in batches of 30, which is Firestore's limit for 'in' queries.
        for (let i = 0; i < ownerUidsArray.length; i += 30) {
            const batch = ownerUidsArray.slice(i, i + 30);
            const ownersSnapshot = await adminDb.collection('users').where('__name__', 'in', batch).get();
            ownersSnapshot.forEach(doc => {
                const user = doc.data() as User;
                if (user.email) {
                  emailsToSend.push({ email: user.email, name: user.name || user.email.split('@')[0] });
                }
            });
        }
        // **FIX END**
      }
    }
    
    if (emailsToSend.length === 0) {
        return NextResponse.json({ success: true, message: 'No recipients found for the campaign.', emailsSent: 0, emailsFailed: 0 });
    }
    
    const campaignLogRef = adminDb.collection('campaignLogs');
    const batch = adminDb.batch();

    let emailsSent = 0;
    let emailsFailed = 0;
    
    const emailFooter = `
      <br><br>
      <hr style="border: none; border-top: 1px solid #eeeeee;">
      <div style="text-align: center; padding: 20px; font-family: sans-serif; font-size: 12px; color: #666666;">
        <p><b>Bergman Triathlon India</b></p>
        <p>Apurva Towers Rajarampuri 13th Lane Opp swami Pani Puravtha, 416008, Kolhapur</p>
        <p style="font-size: 10px; color: #999999; margin-top: 10px;">This email was sent to {{contact.EMAIL}}.</p>
      </div>
    `;
    const contentWithFooter = htmlContent + emailFooter;

    for (const recipient of emailsToSend) {
        let personalizedHtml = contentWithFooter
            .replace(/{{owner_name}}/gi, recipient.name)
            .replace(/{{owner_email}}/gi, recipient.email);

        // Manually replace the contact email placeholder for raw HTML sends.
        personalizedHtml = personalizedHtml.replace(/{{contact.EMAIL}}/gi, recipient.email);

        const success = await sendRawHtmlEmail(recipient.email, subject, personalizedHtml);
        if (success) {
            emailsSent++;
             // Create a log entry in the batch
            const logEntry = {
                recipientEmail: recipient.email,
                recipientName: recipient.name,
                subject: subject,
                eventId: 'CLUB_OWNER_CAMPAIGN',
                eventName: 'Club Owner Campaign',
                ticketIds: [],
                ticketNames: 'N/A',
                sentAt: FieldValue.serverTimestamp(),
                status: 'Success',
                sentBy: adminUid,
            };
            batch.set(campaignLogRef.doc(), logEntry);
        } else {
            emailsFailed++;
        }
    }
    
    if (emailsSent > 0) {
        await batch.commit();
    }

    return NextResponse.json({ success: true, message: `Campaign processing finished. Sent: ${emailsSent}, Failed: ${emailsFailed}.`, emailsSent, emailsFailed });

  } catch (error: any) {
    console.error(`${actionName} Error: ${error.message}`, error);
    let message = 'An unexpected server error occurred.';
    if(error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        message = 'Authentication error. Please log in again.';
        return NextResponse.json({ success: false, message }, { status: 401 });
    }
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
