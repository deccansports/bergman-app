import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalAthleteSnapshot } from "./contracts";
import {
  buildMobileLiveParticipant,
  buildMobileLiveParticipantFromMutableState,
  buildMobileLiveParticipantFromSnapshotAndMutableState,
  mobileLiveParticipantEtag,
} from "./mobile-live-participant";
import { canonicalMobileLiveParticipantKey } from "./storage-keys";

const snapshot = {
  eventId: "event-1",
  providerEventUuid: "ProviderABC",
  contestUuid: "contest-1",
  providerContestUuid: "contest-source",
  buildVersion: "build-1",
  updatedAt: "2026-09-03T10:00:00.000Z",
  timingVersion: 7,
  leaderboardVersion: 11,
  versions: { timing: 7, leaderboard: 11 },
  identity: {
    participantUuid: "race:providerabc:contest-source:4121",
    providerParticipantUuid: "provider-athlete-4121",
    bib: "4121",
    displayName: "Test Athlete",
    ageGroupKey: "31-40",
    trackingVisibility: "PUBLIC",
  },
  raceState: {
    status: "active",
    currentSectionKey: "swim",
    currentLegType: "swim",
    progressRatio: 0.5,
    distanceCompletedKm: 2,
    resolved: {
      status: "ON_COURSE",
      hasStarted: true,
      officialTimingMode: "CHIP",
      gunStartAt: "2026-09-03T08:00:00.000Z",
      chipStartAt: "2026-09-03T08:00:03.000Z",
      waveStartAt: "2026-09-03T08:00:00.000Z",
      acceptedStartAt: "2026-09-03T08:00:03.000Z",
      officialStartAt: "2026-09-03T08:00:03.000Z",
      currentLeg: "swim",
      currentSectionKey: "swim",
      officialDistanceKm: 2,
      estimatedDistanceKm: 2.2,
      totalDistanceKm: 4,
      distanceRemainingKm: 2,
      officialProgressRatio: 0.5,
      estimatedProgressRatio: 0.55,
      nextSplitDistanceKm: 4,
      etaNextSplit: "2026-09-03T09:00:00.000Z",
      predictedPaceSecondsPerKm: 900,
      predictedSpeedKmh: 4,
      estimatedFinishTime: "2026-09-03T09:30:00.000Z",
      predictionSource: "accepted_splits",
      predictionConfidence: "MEDIUM",
      liveOverallElapsedMs: 1_800_000,
      officialRaceElapsedMs: 1_700_000,
      finalElapsedMs: null,
      finalSplitAccepted: false,
      gunElapsedMs: 1_803_000,
      chipElapsedMs: 1_800_000,
      waveElapsedMs: 1_803_000,
      currentLegElapsedMs: 1_800_000,
      currentSectionElapsedMs: 1_800_000,
      cutoff: {
        activeCutoffKey: "swim",
        displayName: "Swim Cutoff",
        boundarySplitKey: "finish",
        basis: "CHIP",
        cutoffSeconds: 3_600,
        deadlineUtc: "2026-09-03T09:00:03.000Z",
        deadlineLocal: "2:30:03 pm",
        remainingSeconds: 1_800,
        officialStatus: "ON_COURSE",
        projectionStatus: "SAFE",
        projectedArrivalUtc: null,
      },
      overallRank: 12,
      genderRank: 9,
      categoryRank: 3,
      splits: [
        {
          splitKey: "start",
          name: "Start",
          legType: "swim",
          order: 1,
          status: "COMPLETED",
          readAt: "2026-09-03T08:00:03.000Z",
        },
        {
          splitKey: "lap_1",
          name: "Lap 1",
          legType: "swim",
          order: 2,
          status: "COMPLETED",
          readAt: "2026-09-03T08:30:03.000Z",
        },
        {
          splitKey: "finish",
          name: "Finish",
          legType: "swim",
          order: 3,
          status: "PENDING",
          readAt: null,
        },
      ],
      currentSplit: { splitKey: "lap_1" },
      nextExpectedSplit: {
        splitKey: "finish",
        name: "Finish",
        legType: "swim",
        order: 3,
        status: "PENDING",
        readAt: null,
      },
    },
  },
  splits: [],
  overallRanking: {
    overallRank: 12,
    genderRank: 9,
    ageGroupRank: 3,
    clubRank: null,
  },
  location: null,
} as unknown as CanonicalAthleteSnapshot;

test("mobile projection is UUID/provider scoped, bounded, and contains accepted history plus one next split", () => {
  const result = buildMobileLiveParticipant(snapshot);
  assert.equal(
    canonicalMobileLiveParticipantKey(
      snapshot.eventId,
      "ProviderABC",
      snapshot.identity.participantUuid,
    ),
    "live:event:event-1:feibot:providerabc:mobile-live:race%3Aproviderabc%3Acontest-source%3A4121",
  );
  assert.deepEqual(
    result.splits.map((split) => split.splitKey),
    ["start", "lap_1", "finish"],
  );
  assert.equal(result.splits[2].readAt, null);
  assert.equal(result.gunStartAt, "2026-09-03T08:00:00.000Z");
  assert.equal(result.chipStartAt, "2026-09-03T08:00:03.000Z");
  assert.equal(result.ageGroup, "31-40");
  assert.equal(result.timing.gunElapsedMs, 1_803_000);
  assert.equal(result.timing.chipElapsedMs, 1_800_000);
  assert.equal(result.progress.predictedPaceSecondsPerKm, 900);
  assert.equal(result.progress.predictedSpeedKmh, 4);
  assert.equal(result.progress.estimatedFinishTime, "2026-09-03T09:30:00.000Z");
  assert.equal(result.progress.predictionSource, "accepted_splits");
  assert.equal(result.progress.predictionConfidence, "MEDIUM");
  assert.equal(result.splits[0].overallRank, null);
  assert.equal(result.splits[0].distanceKm, null);
  assert.deepEqual(result.cutoff, {
    applicable: true,
    checkpointKey: "finish",
    checkpointLabel: "Swim Cutoff",
    basis: "CHIP",
    cutoffSeconds: 3_600,
    deadlineAt: "2026-09-03T09:00:03.000Z",
    remainingSeconds: 1_800,
    state: "SAFE",
    resolvedAt: null,
    failureReason: null,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 5_000);
  assert.equal(result.leaderboardVersion, 11);
  assert.equal(mobileLiveParticipantEtag(result), '"mlp-build-1-7-11-7-i3"');
  assert.equal("bergmanIdentity" in result, false);
  assert.equal("course" in result, false);
  assert.equal("reads" in result, false);
});

test("mobile projection exposes DNQ, retains timing, and suppresses public ranks", () => {
  const dnq = buildMobileLiveParticipant({
    ...snapshot,
    raceState: {
      ...snapshot.raceState,
      status: "dnq",
      statusSource: "MANUAL_OVERRIDE",
      resolved: {
        ...snapshot.raceState.resolved!,
        status: "DNQ",
        statusSource: "MANUAL_OVERRIDE",
      },
    },
    overallRanking: {
      overallRank: null,
      genderRank: null,
      ageGroupRank: null,
      clubRank: null,
    },
  });
  assert.equal(dnq.status, "DNQ");
  assert.equal(dnq.splits.length, 3);
  assert.deepEqual(dnq.rank, {
    overall: null,
    gender: null,
    ageGroup: null,
    club: null,
  });
  assert.equal(dnq.splits.every((split) => split.overallRank === null), true);
});

test("anonymous projection redacts identity and private projection contains no public identity", () => {
  const anonymous = buildMobileLiveParticipant({
    ...snapshot,
    identity: { ...snapshot.identity, trackingVisibility: "ANONYMOUS" },
  });
  assert.equal(anonymous.displayName, "Anonymous Athlete");
  const privateResult = buildMobileLiveParticipantFromMutableState({
    eventId: "event-1",
    providerEventUuid: "ProviderABC",
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    contestUuid: snapshot.contestUuid,
    bib: "4121",
    displayName: "Secret Name",
    trackingVisibility: "PRIVATE",
    updatedAt: snapshot.updatedAt,
    participantLive: {
      timingVersion: 8,
      leaderboardVersion: 12,
      resolvedRaceState: { status: "ON_COURSE" },
      splits: [],
    },
  });
  assert.equal(privateResult.bib, "");
  assert.equal(privateResult.displayName, "");
});

test("mutable publication increments only the changed participant revision", () => {
  const current = buildMobileLiveParticipantFromMutableState({
    eventId: "event-1",
    providerEventUuid: "ProviderABC",
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    contestUuid: snapshot.contestUuid,
    bib: "4121",
    updatedAt: snapshot.updatedAt,
    participantLive: {
      timingVersion: 8,
      leaderboardVersion: 12,
      liveRevision: 8,
      resolvedRaceState: { status: "ON_COURSE" },
      splits: [],
    },
  });
  assert.equal(current.liveRevision, 8);
  assert.equal(current.leaderboardVersion, 12);
  assert.equal(current.participantUuid, snapshot.identity.participantUuid);
});

test("finished mutable publication exposes participant ranks on the summary and finish split", () => {
  const current = buildMobileLiveParticipantFromMutableState({
    eventId: "event-1",
    providerEventUuid: "ProviderABC",
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    contestUuid: snapshot.contestUuid,
    bib: "4121",
    updatedAt: snapshot.updatedAt,
    participantLive: {
      timingVersion: 8,
      leaderboardVersion: 12,
      liveRevision: 12,
      overallRank: 2,
      genderRank: 1,
      ageGroupRank: 1,
      resolvedRaceState: { status: "FINISHED" },
      splits: [
        {
          splitKey: "swim_finish",
          splitName: "Finish",
          accepted: true,
          status: "OFFICIAL",
          elapsedSeconds: 1_694,
        },
      ],
    },
  });
  assert.deepEqual(current.rank, {
    overall: 2,
    gender: 1,
    ageGroup: 1,
    club: null,
  });
  assert.deepEqual(
    current.splits.map((split) => ({
      overall: split.overallRank,
      gender: split.genderRank,
      category: split.categoryRank,
    })),
    [{ overall: 2, gender: 1, category: 1 }],
  );
});

test("newer timing overlay cannot erase immutable ranking revision", () => {
  const merged = buildMobileLiveParticipantFromSnapshotAndMutableState(
    snapshot,
    {
      timingVersion: 8,
      liveRevision: 8,
      resolvedRaceState: { status: "ON_COURSE" },
      splits: [],
    },
  );
  assert.equal(merged.timingVersion, 8);
  assert.equal(merged.leaderboardVersion, 11);
  assert.equal(merged.gunStartAt, "2026-09-03T08:00:00.000Z");
  assert.equal(merged.ageGroup, "31-40");
  assert.deepEqual(merged.rank, {
    overall: 12,
    gender: 9,
    ageGroup: 3,
    club: null,
  });
});
