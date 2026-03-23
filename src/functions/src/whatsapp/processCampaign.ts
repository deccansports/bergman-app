// functions/src/whatsapp/processCampaign.ts
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../firebaseAdmin";
import { sendAiSensyMessage } from "../auth/aisensyService";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

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
 * CLOUD FUNCTION: Background Campaign Processor
 * Triggers when a new job is added to the 'whatsappCampaignQueue'.
 */
export const processWhatsAppCampaign = onDocumentCreated({
    document: "whatsappCampaignQueue/{jobId}",
    secrets: ["AISENSY_API_KEY"]
}, async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { 
        jobId, targetType, eventId, ticketIds, 
        statusFilter = ['Active', 'Confirmed'], 
        excludeRegistered, templateName, templateParams, 
        mediaUrl, mediaFilename, throttling, adminUid
    } = data;

    logger.info(`Starting WhatsApp Campaign Job: ${jobId}`, { targetType, eventId, templateName });

    const jobRef = db.collection('backgroundJobs').doc(jobId);
    const logCol = db.collection('whatsappLogs');
    
    const updateProgress = async (stage: string, progress: number, message?: string) => {
        await jobRef.set({ 
            stage, 
            progress, 
            message: message || stage, 
            status: 'processing',
            updatedAt: FieldValue.serverTimestamp() 
        }, { merge: true });
    };

    try {
        await updateProgress('Fetching target audience...', 5);
        let recipients: any[] = [];
        let logEventName = data.campaignName || 'Broadcast';
        const media = mediaUrl ? { filename: mediaFilename || 'attachment', url: mediaUrl } : null;

        // --- 1. AUDIENCE FETCHING ---
        if (targetType === 'club_owners') {
            const clubsSnap = await db.collection('clubs').get();
            const ownerUids = Array.from(new Set(clubsSnap.docs.map(doc => doc.data().ownerUid).filter(Boolean)));
            if (ownerUids.length > 0) {
                for (let i = 0; i < ownerUids.length; i += 30) {
                    const batch = ownerUids.slice(i, i + 30);
                    const usersSnapshot = await db.collection('users').where(FieldPath.documentId(), 'in', batch).get();
                    usersSnapshot.forEach(doc => {
                        const u = doc.data();
                        if (u.mobile) recipients.push({ name: u.name, mobile: u.mobile, email: u.email, uid: doc.id });
                    });
                }
            }
        } else if (targetType === 'all_athletes') {
            const usersSnapshot = await db.collection('users').get();
            usersSnapshot.forEach(doc => {
                const u = doc.data();
                if (u.mobile) recipients.push({ name: u.name, mobile: u.mobile, email: u.email, uid: doc.id });
            });
        } else if (targetType === 'event' && eventId) {
            const eventSnap = await db.collection('events').doc(eventId).get();
            logEventName = eventSnap.data()?.eventName || 'Event Broadcast';

            if (excludeRegistered) {
                const registeredSnapshot = await db.collection('events').doc(eventId).collection('participants').select('email').get();
                const registeredEmails = new Set(registeredSnapshot.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean));
                
                const allUsersSnapshot = await db.collection('users').get();
                allUsersSnapshot.forEach(doc => {
                    const user = doc.data();
                    if (user.email && !registeredEmails.has(user.email.toLowerCase()) && user.mobile) {
                        recipients.push({ name: user.name, mobile: user.mobile, email: user.email, uid: doc.id, eventName: logEventName });
                    }
                });
            } else {
                let query: FirebaseFirestore.Query = db.collection('events').doc(eventId).collection('participants');
                
                // CRITICAL FIX: Only apply 'in' filter if ticketIds is NOT empty
                if (Array.isArray(ticketIds) && ticketIds.length > 0) {
                    query = query.where('ticketId', 'in', ticketIds);
                }
                
                const snapshot = await query.get();
                snapshot.forEach(doc => {
                    const d = doc.data();
                    // Manual filter for status to keep query simple and handle potential empty statusFilter
                    if (d.mobile && (!statusFilter || statusFilter.length === 0 || statusFilter.includes(d.ticketStatus))) {
                        recipients.push({ 
                            name: d.name, 
                            mobile: d.mobile, 
                            email: d.email, 
                            bibNumber: d.bibNumber, 
                            ticketName: d.ticketName,
                            bookingId: d.bookingId,
                            eventName: logEventName,
                            id: doc.id 
                        });
                    }
                });
            }
        }

        logger.info(`Audience identified: ${recipients.length} recipients found.`);

        if (recipients.length === 0) {
            await jobRef.set({ 
                status: 'completed', 
                progress: 100, 
                message: 'No eligible recipients found for the selected segment.', 
                updatedAt: FieldValue.serverTimestamp() 
            }, { merge: true });
            return;
        }

        // --- 2. BATCH DELIVERY ---
        let sent = 0;
        let failed = 0;
        const total = recipients.length;
        const { rate = 20, intervalSeconds = 2 } = throttling || {};

        await updateProgress(`Delivering to ${total} recipients...`, 10);

        for (let i = 0; i < total; i += rate) {
            const batch = recipients.slice(i, i + rate);
            
            await Promise.all(batch.map(async (recipient) => {
                const mobile = recipient.mobile;
                if (!mobile) return;

                try {
                    const resolvedParams = (templateParams || []).map((p: any) => resolveValue(p.value, recipient));
                    
                    const result = await sendAiSensyMessage(
                        mobile, 
                        templateName, 
                        resolvedParams, 
                        'Campaign', 
                        `Job-${jobId}`, 
                        recipient.name, 
                        media
                    );

                    if (result.success) {
                        sent++;
                        await logCol.add({
                            recipientMobile: mobile,
                            recipientName: recipient.name || 'Athlete',
                            templateName,
                            eventName: logEventName,
                            sentAt: FieldValue.serverTimestamp(),
                            status: 'Success',
                            sentBy: adminUid,
                        });
                    } else {
                        failed++;
                        await logCol.add({
                            recipientMobile: mobile,
                            recipientName: recipient.name || 'Athlete',
                            templateName,
                            eventName: logEventName,
                            sentAt: FieldValue.serverTimestamp(),
                            status: 'Failed',
                            error: result.error || 'API Rejected',
                            sentBy: adminUid,
                        });
                    }
                } catch (innerError: any) {
                    failed++;
                    logger.error(`Failed to send message to ${mobile} in job ${jobId}:`, innerError.message);
                    await logCol.add({
                        recipientMobile: mobile,
                        recipientName: recipient.name || 'Athlete',
                        templateName,
                        eventName: logEventName,
                        sentAt: FieldValue.serverTimestamp(),
                        status: 'Failed',
                        error: innerError.message || 'Function Error',
                        sentBy: adminUid,
                    });
                }
            }));

            const currentProgress = 10 + Math.round(((i + batch.length) / total) * 90);
            await updateProgress(`Delivering: ${i + batch.length} of ${total}`, currentProgress, `Sent: ${sent}, Failed: ${failed}`);

            if (i + rate < total) {
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }
        }

        await jobRef.set({ 
            status: 'completed', 
            progress: 100, 
            message: `Finished. Sent: ${sent}, Failed: ${failed}`, 
            updatedAt: FieldValue.serverTimestamp() 
        }, { merge: true });

    } catch (err: any) {
        logger.error(`Campaign Job ${jobId} failed with critical error:`, err);
        await jobRef.set({ 
            status: 'failed', 
            message: `Critical Error: ${err.message}`, 
            updatedAt: FieldValue.serverTimestamp() 
        }, { merge: true });
    }
});
