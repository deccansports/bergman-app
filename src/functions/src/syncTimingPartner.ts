// functions/src/syncTimingPartner.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { racemapFetch } from "./lib/racemapFetch";

interface RacemapTime {
  time: string; // ISO 8601 string
  distanceToSplit: number;
}

interface RacemapAthleteTimes {
  startNumber: string;
  times?: Record<string, RacemapTime[]>;
}

export const syncTimingPartner = onSchedule(
  { schedule: "every 1 minutes", region: "us-central1" },
  async () => {
    const eventsSnap = await db
      .collection("events")
      .where("liveDataSource", "==", "racemap")
      .get();

    for (const eventDoc of eventsSnap.docs) {
      const eventId = eventDoc.id;
      const cfg = eventDoc.data().timingPartner;
      if (!cfg?.eventId || !cfg?.apiToken) {
        console.warn(`[syncTimingPartner] Skipping event ${eventId}: Missing Racemap config.`);
        continue;
      }
      
      const stateRef = db.collection("events").doc(eventId).collection("timingState").doc("state");
      const stateSnap = await stateRef.get();
      const lastSync = stateSnap.exists ? stateSnap.data()?.lastSuccessfulSyncAt || 0 : 0;
      
      // Use lastSyncAt for the 'since' parameter
      const url = `https://racemap.com/api/data/v1/${cfg.eventId}/times?since=${lastSync / 1000}`; 

      try {
        const data = await racemapFetch(url, cfg.apiToken);
        if (!data || !Array.isArray(data.starters)) continue;

        let newestTs = lastSync;
        const batch = db.batch();
        let writeCount = 0;

        for (const athlete of data.starters as RacemapAthleteTimes[]) {
          const bib = athlete.startNumber;
          if (!bib || !athlete.times) continue;

          for (const [splitId, detections] of Object.entries(athlete.times)) {
            for (const d of detections) {
              const ts = Date.parse(d.time);
              if (ts <= lastSync) continue; // Skip old detections

              newestTs = Math.max(newestTs, ts);

              const ref = db
                .collection("rawReads")
                .doc(eventId)
                .collection("reads")
                .doc(); // Auto-ID

              batch.set(ref, {
                eventId,
                bibNumber: String(bib),
                splitCode: splitId,
                absoluteTimestamp: ts,
                distanceToSplit: d.distanceToSplit,
                source: "racemap",
                receivedAt: FieldValue.serverTimestamp(),
              });
              writeCount++;
            }
          }
        }
        
        if (writeCount > 0) {
            await batch.commit();
            console.log(`[syncTimingPartner] Synced ${writeCount} new reads for event ${eventId}.`);
        } else {
            console.log(`[syncTimingPartner] No new reads for event ${eventId}.`);
        }
        
        // Always update the sync timestamp to the newest one received, even if no new writes
        // This prevents re-fetching the same old data if there are no new splits.
        await stateRef.set({
          lastSuccessfulSyncAt: newestTs,
          lastSyncStatus: "success",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });


      } catch (error: any) {
        console.error(`[syncTimingPartner] Failed to sync event ${eventId}:`, error.message);
        await stateRef.set({ lastSyncStatus: "error", lastError: error.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  }
);
