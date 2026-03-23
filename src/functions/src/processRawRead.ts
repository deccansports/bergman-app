
// functions/src/processRawRead.ts
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "./firebaseAdmin";
import { recalculateETA } from "./live/recalculateETA";
import { interpolatePosition } from "./live/interpolatePosition";
import { evaluateAthleteState } from "./live/evaluateAthleteState";
import { Timestamp } from "firebase-admin/firestore";
import type { LiveAthlete, Split } from "./types";

export const processRawRead = onDocumentCreated(
  "rawReads/{eventId}/reads/{readId}",
  async (event) => {
    const read = event.data?.data();
    if (!read) return;

    const { eventId } = event.params;
    const { bibNumber, splitCode, timestamp } = read;

    if (!eventId || !bibNumber || !timestamp) return;

    const athleteRef = db
      .collection("events")
      .doc(eventId)
      .collection("liveAthletes")
      .doc(String(bibNumber));

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(athleteRef);
      // Do not create new athlete from raw read, only update existing ones from registration.
      if (!snap.exists) return;

      const athlete = snap.data()! as LiveAthlete;

      const lastSplit = athlete.splits?.[athlete.splits.length - 1];
      if (lastSplit?.segment === splitCode) return; // Idempotency check

      const readTimestamp = timestamp instanceof Timestamp ? timestamp.toMillis() : new Date(timestamp).getTime();

      const newSplit: Split = {
        segment: splitCode,
        absoluteTimestamp: readTimestamp / 1000,
        distance: athlete.distanceMap?.[splitCode] ?? 0,
        time: readTimestamp / 1000, // Added missing `time` property
        name: splitCode,
      };

      const splits = [...(athlete.splits || []), newSplit];
      const startTime = athlete.startTime || newSplit.absoluteTimestamp;

      // --- Use new helper functions ---
      const etaResult = recalculateETA(splits, athlete.totalDistanceKm || 0);

      const estimatedPositionKm = interpolatePosition(
          newSplit.distance, 
          readTimestamp, 
          etaResult?.paceSecPerKm || athlete.predictedPaceSecPerKm || 0
      );
      
      const courseProgress = athlete.totalDistanceKm && athlete.totalDistanceKm > 0 ? (estimatedPositionKm || newSplit.distance) / athlete.totalDistanceKm : 0;
      
      const cutoffBreached = false; // Simplified for now, can be expanded
      const newStatus = evaluateAthleteState(splitCode, splits.length, cutoffBreached);
      // --- End of helper function usage ---

      tx.update(athleteRef, {
        splits,
        startTime: startTime,
        leg: splitCode,
        lastSeenSplit: splitCode,
        lastUpdateTime: Date.now(),
        predictedPaceSecPerKm: etaResult?.paceSecPerKm,
        etaFinishUTC: etaResult?.etaFinishUTC,
        courseProgress,
        status: newStatus,
      });
    });
  }
);
