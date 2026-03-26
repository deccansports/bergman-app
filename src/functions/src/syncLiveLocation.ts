// functions/src/syncLiveLocation.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./firebaseAdmin";
import { racemapFetch } from "./lib/racemapFetch";

interface RacemapCurrent {
  lat: number;
  lng: number;
  latSt: number;
  lngSt: number;
  speed: number;
  eta: number; // seconds to finish
  time: string; // ISO 8601
}

interface RacemapAthleteCurrent {
  startNumber: string;
  current?: RacemapCurrent;
}

export const syncLiveLocation = onSchedule(
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
            console.warn(`[syncLiveLocation] Skipping event ${eventId}: Missing Racemap config.`);
            continue;
        }

        const url = `https://racemap.com/api/data/v1/${cfg.eventId}/current?interpolation=true&currentSpeedDuration=60`;
        
        try {
            const data = await racemapFetch(url, cfg.apiToken);
            if (!data || !Array.isArray(data.starters)) continue;

            const batch = db.batch();
            let writeCount = 0;

            for (const p of data.starters as RacemapAthleteCurrent[]) {
                if (!p.startNumber || !p.current) continue;

                const ref = db
                  .collection("events")
                  .doc(eventId)
                  .collection("liveAthletes")
                  .doc(String(p.startNumber));

                batch.set(ref, {
                  predictedLocation: {
                    lat: p.current.lat,
                    lng: p.current.lng,
                  },
                  speed: p.current.speed,
                  etaFinishUTC: Date.now() + p.current.eta * 1000,
                  lastLocationTime: Date.parse(p.current.time),
                  lastUpdateTime: Date.now(),
                }, { merge: true });
                writeCount++;
            }

            if (writeCount > 0) {
                await batch.commit();
                console.log(`[syncLiveLocation] Updated location for ${writeCount} athletes in event ${eventId}.`);
            }

        } catch (error: any) {
            console.error(`[syncLiveLocation] Failed to sync live location for event ${eventId}:`, error.message);
        }
    }
  }
);
