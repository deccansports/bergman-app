// functions/src/pushFinishLineEntry.ts
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db } from './firebaseAdmin';
import { formatSecondsToHMS } from './utils';
import { syncFinisherToKV } from './kv-service';

export const pushFinishLineEntry = onDocumentUpdated(
  "events/{eventId}/liveAthletes/{bib}", // Correct trigger path
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      console.log("Missing data in event object for pushFinishLineEntry.");
      return;
    }

    // Trigger only when status changes to 'Finished'
    if (beforeData.status === "Finished" || afterData.status !== "Finished") {
      return;
    }

    const eventId = event.params.eventId;
    
    let country = null;
    let clubName = (afterData as any).clubNameAtRace || (afterData as any).clubName || null;

    if (afterData.athleteUid) {
        try {
            const userDoc = await db.collection('users').doc(afterData.athleteUid).get();
            if(userDoc.exists) {
                const userData = userDoc.data();
                country = userData?.country || null;
                if (!clubName) clubName = userData?.clubName || null;
            }
        } catch(e: any) {
            console.error(`Could not fetch user profile for country/club: ${e.message}`);
        }
    }
    
    const feedRef = db.collection("finish_line_feed").doc(eventId).collection("entries");
    
    const finishTime = afterData.summary?.FINISHED ? formatSecondsToHMS(afterData.summary.FINISHED) : 'N/A';

    const newEntry = {
        bib: afterData.bib || 'N/A',
        name: afterData.name || 'Unknown Finisher',
        finishTime: finishTime,
        ticketName: (afterData as any).ticketName || (afterData as any).category || "",
        ageCategory: afterData.ageGroup || 'N/A',
        country: country,
        clubName: clubName,
        gender: afterData.gender || 'Unknown',
        timestamp: new Date().toISOString()
    };
    
    await feedRef.add(newEntry);
    console.log(`Added finisher ${newEntry.name} (BIB: ${newEntry.bib}) to LED feed for event ${eventId}.`);

    // AUTO-SYNC: Also add to KV for instant LED display updates (zero lag)
    try {
      await syncFinisherToKV(eventId, newEntry);
      console.log(`[KV SYNC] Synced finisher ${newEntry.name} to KV for instant LED display`);
    } catch (kvError: any) {
      console.error(`[KV SYNC ERROR] Failed to sync to KV: ${kvError.message}`);
      // Non-blocking error - LED still works from Firestore if KV fails
    }

    const MAX_FINISHERS_IN_FEED = 6;
    const snapshot = await feedRef.orderBy("timestamp", "asc").get();
    
    if (snapshot.size > MAX_FINISHERS_IN_FEED) {
        const toDeleteCount = snapshot.size - MAX_FINISHERS_IN_FEED;
        const batch = db.batch();
        snapshot.docs.slice(0, toDeleteCount).forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Removed ${toDeleteCount} oldest finisher(s) from LED feed.`);
    }
  }
);

