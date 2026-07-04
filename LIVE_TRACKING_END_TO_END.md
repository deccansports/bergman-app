# Feibot → Bergman Live Tracking (End-to-End)

This document describes the complete production flow for live tracking, including participant import, live timing processing, KV writes, and Athlete Modal reads.

---

## 1) Core Principles

- UI must **never** call Feibot directly.
- Athlete Modal/Public Tracking must read from **Cloudflare KV only**.
- Bergman user/registration data is **read-only** enrichment source.
- Live race state is written only to `live:event:{eventId}:*` keys.

---

## 2) End-to-End Pipeline

### A. Configuration + Participants Import

1. Feibot timing rules and participants are fetched.
2. If participants response returns `download_url`, JSON is downloaded and parsed.
3. Participants are normalized.
4. Optional enrichment is attempted from user KV (`users:{uid}` first, legacy fallback supported).
5. Static timing participants + indexes are written to live KV.

### B. Race-Day Live Timing Worker

1. Reads live results payload from Feibot (or cached provider payload).
2. Resolves participant via live indexes (`providerUuid`, `bib`, `email`, `athleteUid`, `bookingId`).
3. Resolves timing point → split → leg via live indexes.
4. Computes progress + timing metrics.
5. Evaluates cutoffs from `course:index`.
6. Computes rankings.
7. Writes `participantLive` projection and leaderboard snapshots to KV.

### C. Athlete Modal

Athlete Modal server API merges KV-only sources:

- `timingParticipant`
- `participantLive`
- `course:index` (+ contest context)

No Feibot API calls in modal rendering path.

---

## 3) KV Write Map

## Timing configuration / course

- `live:event:{eventId}:timingConfiguration`
- `live:event:{eventId}:contest:index`
- `live:event:{eventId}:timingPoint:index`
- `live:event:{eventId}:split:index`
- `live:event:{eventId}:leg:index`
- `live:event:{eventId}:ageGroup:index`
- `live:event:{eventId}:course:index`

## Static participants (immutable during race)

- `live:event:{eventId}:timingParticipant:{bookingId}`

## Participant lookup indexes

- `live:event:{eventId}:participant:index`
- `live:event:{eventId}:participant:bib`
- `live:event:{eventId}:participant:uuid`
- `live:event:{eventId}:participant:providerUuid`
- `live:event:{eventId}:participant:email`
- `live:event:{eventId}:participant:athleteUid`
- `live:event:{eventId}:participant:name`
- `live:event:{eventId}:participant:chip`
- `live:event:{eventId}:participant:contest`
- `live:event:{eventId}:participant:ageGroup`

## Live projections

- `live:event:{eventId}:participantLive:{bookingId}`
- `live:event:{eventId}:participantLive:index`
- `live:event:{eventId}:leaderboard`
- `live:event:{eventId}:athletes` (compat snapshot for tracking list)
- `live:event:{eventId}:timingReads`
- `live:event:{eventId}:monitoring`

---

## 4) Athlete Modal KV Read Path

Primary API route:

- `GET /api/live/athlete-modal/{eventId}`

Lookup sequence:

1. Resolve athlete identity from participant index.
2. Load static participant from `live:event:{eventId}:timingParticipant:{bookingId}`.
3. Load live state from `live:event:{eventId}:participantLive:{bookingId}`.
4. Load `live:event:{eventId}:course:index`.
5. Build response view model server-side.

---

## 5) Cutoff Engine Behavior

- Cutoffs are read from `course:index` contest data.
- Worker outputs one of:
  - `Within Cutoff`
  - `Approaching Cutoff`
  - `Missed Cutoff`
- If missed, participant `status` is set to `DNF`.
- Sync continues even after DNF.

---

## 6) Matching Rules

Priority used for athlete matching:

1. `uid`
2. `email` (case-insensitive)

Not used for identity matching:

- bib
- name
- phone
- club

---

## 7) Import Resilience

Participant import must not fail if enrichment fails.

Guaranteed behavior:

- Feibot participant payload parsed first.
- Normalization always runs on raw participants.
- User enrichment is best-effort.
- Participants are still written even when user profile reads fail.

---

## 8) Operational Logs (Recommended)

Expected logs in import flow:

1. Download complete
2. Participant count
3. Normalized count
4. Matched users count
5. Writing `timingParticipant`
6. Writing `participant:index`
7. Import complete

---

## 9) Important Guardrails

- Do not write Feibot data into Bergman registration/user truth tables.
- Keep all live writes in `live:event:{eventId}:*` namespace.
- UI should depend on KV projections, not provider APIs.
