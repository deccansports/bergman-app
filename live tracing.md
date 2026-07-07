# Live Tracing Corrections and Working

## Scope
This document records the live-tracking fixes implemented for Admin Race Flow Mapping, Athlete Modal rendering, split ordering, placeholder behavior, and related stability/typecheck fixes.

## End-to-End Live Tracing Flow (Timing Leaderboard API → KV → UI)

### A) Fetch timing leaderboard data from provider API
- System calls provider timing/leaderboard APIs (event + contest scoped).
- Pulls athlete-level timing points, ranks, status, and split progression payloads.
- Normalizes provider payloads to internal live-tracking format.

### B) Persist and refresh in KV cache
- Normalized live payloads are written to KV with event/contest cache keys.
- Mapping/config objects (including leg-split mapping) are also read from KV.
- Refresh cycle updates KV periodically so reads stay low-latency for UI.

### C) Build athlete modal API response
- Athlete modal API reads latest leaderboard/timing payload from KV.
- It then attaches leg/split mapping data (event + contest) into the response context.
- If multiple contest mappings exist, all relevant mappings are loaded so target contest is not missed.

### D) Resolve split model with mapping-first logic
- Split model utility resolves saved mapping first.
- Sections are built strictly from saved leg order and split order.
- Imported timing points are matched to mapped splits; if missing, synthetic rows are generated.
- Distances prefer saved mapped values (with fallback extraction when needed).

### E) Render live tracing in UI
- Dynamic split table and timing cards render mapped sections (SWIM/T1/BIKE/T2/RUN).
- Not-started rules apply (`-`, `00:00:00`, `0 km/h` where defined).
- Future labels are suppressed for cleaner live readability.

### F) Result
- Data path is now stable and deterministic:
  1. Provider leaderboard/timing API
  2. KV cache/update
  3. Athlete modal API assembly
  4. Mapping-first split model build
  5. Live tracing UI render

This ensures the athlete-facing live tracing always follows saved admin race flow while still showing fresh timing data from the leaderboard feed.

## Upload (.fdb) to Event Results Flow (KV + Storage + Indexes)

### Important current state
- `.fdb` import is handled from Admin endpoint flow (`/api/admin/live-tracking/feibot/fdb-import`).
- Legacy endpoint `/api/live/provider-database-upload/{eventId}` is disabled (returns 410).
- Legacy parser file is deprecated/stubbed; active import logic is in admin `fdb-import` implementation.

### 1) Upload and parse stage
- Admin uploads `.fdb` (SQLite DB).
- Import job reads SQLite tables (`contests`, `legs`, `splits`, `timing points`, `age groups`, `participants`, etc.).
- System normalizes rows into a canonical timing snapshot and participant rows.
- Import runtime status is tracked in Firestore `liveTracking/{eventId}` (progress + stage updates).

### 2) Core timing snapshot persisted to KV
Primary timing/config writes:
- `live:event:{eventId}:timingConfiguration`
- `live:event:{eventId}:config`
- `live:event:{eventId}:data`
- `live:event:{eventId}:import-summary:latest`

This becomes the base source used by downstream index rebuilds and live rendering.

### 3) Index creation (how indexes are built)
After timing snapshot is prepared, rebuild jobs run and write index projections:
- Contest index: `live:event:{eventId}:contest:index`
- Split index: `live:event:{eventId}:split:index`
- Timing point index: `live:event:{eventId}:timingPoint:index`
- Leg index: `live:event:{eventId}:leg:index`
- Age-group index: `live:event:{eventId}:ageGroup:index`
- Course index (via rebuild): `live:event:{eventId}:course:index`

These indexes are generated from normalized timing configuration and contest-scoped entities, then validated before completion.

### 4) Participant static records + lookup indexes
For each participant, static participant snapshots are written and indexed:

Per-participant static keys:
- `live:event:{eventId}:timingParticipant:{bookingId}`
- `live:event:{eventId}:participant:{participantUuid}`

Fast lookup keys:
- `live:event:{eventId}:lookup:bib:{bib}`
- `live:event:{eventId}:lookup:provider:{providerUuid}`
- `live:event:{eventId}:lookup:user:{athleteUid}`
- `live:event:{eventId}:lookup:chip:{chip}`
- `live:event:{eventId}:lookup:email:{email}`

Materialized participant index maps:
- `live:event:{eventId}:participant:bib`
- `live:event:{eventId}:participant:uuid`
- `live:event:{eventId}:participant:providerUuid`
- `live:event:{eventId}:participant:email`
- `live:event:{eventId}:participant:athleteUid`
- `live:event:{eventId}:participant:name`
- `live:event:{eventId}:participant:chip`
- `live:event:{eventId}:participant:contest`
- `live:event:{eventId}:participant:ageGroup`
- `live:event:{eventId}:participant:index`

### 5) Where else import state is saved
- Firestore:
  - `liveTracking/{eventId}` for active progress, summary, and import state.
  - `liveTracking/{eventId}/importHistory` for historical import runs.

### 6) Event results stage (end of pipeline)
Event results/live timing is then consumed and projected into live KV:
- Provider result APIs (e.g. latest/live results endpoints) are fetched.
- Raw provider result payloads can be archived (KV raw archive entries).
- Live timing worker maps result rows to participant booking IDs using `participant:index` and lookup maps.
- Worker writes live projections:
  - `live:event:{eventId}:participantLive:{bookingId}`
  - `live:event:{eventId}:participantLive:index`
  - `live:event:{eventId}:leaderboard`
  - `live:event:{eventId}:athletes`
  - `live:event:{eventId}:timingReads`
  - `live:event:{eventId}:monitoring`

### 7) Athlete modal / live tracing read end
- Live tracing UI reads from KV projections (not direct provider call in render path):
  - static participant + participant index
  - participantLive projection
  - course/timing indexes
  - saved leg-split mapping
- Final output in Athlete Modal follows saved race flow while showing latest event results state.

### 8) Short flow summary (upload → event results end)
1. Upload `.fdb` (admin import)
2. Parse + normalize SQLite tables
3. Write timing snapshot to KV
4. Rebuild contest/split/timing-point/leg/age-group/course indexes
5. Write participant static docs + participant lookup indexes
6. Save import state/history in Firestore
7. Fetch live/event results and project to `participantLive` + `leaderboard`
8. Render live tracing from KV projections in Athlete Modal

## 1) Race Flow Source of Truth

### Fixed
- Athlete split flow now uses saved **Leg & Split Mapping** as the source of truth.
- Athlete rendering no longer depends on inferred grouping from raw Feibot naming.
- Contest mapping lookup was hardened to avoid contest-specific misses.

### Working behavior
- Reads saved mapping by **Event + Contest**.
- Uses saved leg sequence (`display_order`) exactly.
- Uses saved split sequence within leg (saved order fields) exactly.
- Renders only splits marked `visible`.
- Renders transition legs (T1/T2) as independent sections, including single-split sections.
- Keeps Race Flow Timeline Preview and Athlete Modal aligned to the same mapping model.

## 2) Missing / Misplaced Splits

### Fixed
- Added mapping-first section assembly in split model.
- Corrected ordering to prevent misplaced bike/run transition rows.
- Ensured mapped rows are not re-bucketed by inferred sport labels when mapping exists.

### Working behavior
For mapped contests, rows follow the admin flow exactly (example):
- SWIM: `SWIM START`, `SWIM FINISH 1.5 KM`
- T1: `BIKE START`
- BIKE: `BIKE 9.9`, `BIKE 19 KM`, `BIKE 28.9 KM`, `BIKE FINISH`
- T2: `T2 FINISH / RUN START`
- RUN: `RUN 2.5 KM`, `RUN 5 KM`, `RUN 7.5 KM`, `RUN 9.9 KM`, `RUN FINISH`

## 3) Distance Handling

### Fixed
- Saved mapped split distance can override imported timing-point distance.
- Added fallback distance extraction from labels when needed.
- Synthetic mapped points are generated when an imported point is missing.

### Working behavior
- Athlete Modal distance column reflects saved mapping distances.
- Full mapped flow remains visible even when provider timing points are incomplete.

## 4) Athlete Modal UI Corrections

### Fixed
- Added **Estimated Live Data** block.
- Removed `Current GPS` field from that block.
- Removed `Future` text/status noise from split rows.
- Simplified split rows to emphasize split names and core metrics.

### Working behavior
- Split rows no longer show explicit `Future` labels.
- Estimated Live Data shows:
  - Distance Covered
  - Distance Remaining
  - Current Leg
  - Current Split
  - Last Timing Point
  - Current Speed

## 5) Not Started Placeholder Rules

### Fixed
- Replaced `Waiting for Start` placeholders in target areas with `-`.
- Set `Overall Time` default to `00:00:00` when not started.
- Kept Current Speed behavior as `0 km/h` in Estimated Live Data for not-started state.

### Working behavior (Not Started)
- Most not-started values display `-`.
- `Overall Time` displays `00:00:00`.
- `Current Speed` in Estimated Live Data displays `0 km/h`.

## 6) API and Data Loading Enhancements

### Fixed
- Athlete-modal API now loads all event leg/split mapping keys and injects into timing configuration cache object.
- Prevents one-contest mismatch where only a subset mapping was available at render time.

### Working behavior
- Contest-specific mapping is consistently available for athlete render model resolution.

## 7) Stability and Type/Parse Fixes

### Fixed
- Corrected TypeScript issues in split model helper (`utils.ts`) from unsafe object typing and invalid property access.
- Corrected parse corruption in admin mapping route around `cutoff_value` assignment.

### Working behavior
- Local `npm run typecheck` passes after fixes.
- Route parser/type errors for leg-split mapping section are resolved.

## 8) Files Updated (Primary)
- `src/components/live-tracking/split-modal/utils.ts`
- `src/components/live-tracking/DynamicSplitSummaryTable.tsx`
- `src/components/live-tracking/split-modal/TimingPointCard.tsx`
- `src/components/live-tracking/AthleteLiveModalPro.tsx`
- `src/app/api/live/athlete-modal/[eventId]/route.ts`
- `src/app/api/admin/live-tracking/leg-split-mapping/route.ts`

## 9) Validation Checklist
- [x] Saved race flow order matches Athlete Modal for mapped contests.
- [x] T1/T2 render as explicit sections.
- [x] Visible-only split filtering respected.
- [x] Missing mapped provider points are synthesized for display continuity.
- [x] Future status labels removed from split rows.
- [x] Estimated Live Data block text and fields aligned to latest requirement.
- [x] Not-started placeholder behavior updated (`-`, `00:00:00`, `0 km/h`).
- [x] Typecheck/parsing blockers fixed.

## 10) Current Status
Live Tracking mapping and Athlete Modal behavior are aligned to the saved admin Race Flow configuration, with contest-specific robustness improvements and cleaned not-started UI outputs.

## 11) RTRT-Style Live Prediction Between Official Checkpoints

### Official timing remains authoritative
- Official split/leg changes happen only when timing checkpoints are received.
- Between checkpoints, marker movement and ETA fields are estimated.

### Real-time between-checkpoint prediction (implemented)
- After an official checkpoint (example: Swim Start), prediction starts immediately.
- Every second, athlete distance is updated from:
  - observed split pace (preferred), else
  - live feed pace/speed, else
  - leg-specific fallback model:
    - Swim default: ~2:20/100m
    - Bike default: ~29 km/h
    - Run default: ~5:40/km
- Marker continuously moves on GPX using estimated distance.
- Prediction is clamped to just before next official split to avoid unofficial crossing.

### When next official checkpoint arrives
- Prediction is replaced by official timing.
- Marker snaps to official checkpoint position.
- Official `currentLeg` and `currentSplit` move forward.
- Prediction restarts for the next segment.

This same rule applies to Swim, Bike, Run, and transition-only sparse timing layouts.

## 12) Live Tracking Privacy Model (Public / Anonymous / Private)

### Stored value
- Field: `liveTrackingPrivacy` (synced as `privacy` in live payloads)
- Supported values:
  - `PUBLIC`
  - `ANONYMOUS`
  - `PRIVATE` (Officials Only)

### Public audience behavior
- `PUBLIC`
  - Full profile visibility (name/bib/photo/club/search/map/leaderboard).
- `ANONYMOUS`
  - Shows `Anonymous Athlete` on map/leaderboard.
  - Masks identity fields (name/bib/photo/club/city/state/contact).
  - Hidden from public search suggestions/results.
  - Timing/progress/rank visibility remains.
- `PRIVATE`
  - Not listed on public leaderboard.
  - No public map marker.
  - Not returned in public search/tracking list.

### Official/admin override
- Full visibility is allowed for admins and authorized official roles.
- Supported override roles include:
  - Super Admin
  - Timing Director
  - Race Director
  - Live Tracking Volunteer
  - Timing Volunteer
  - Medical
  - Marshal

### Dashboard UX
- Athlete dashboard privacy card now supports:
  - Public
  - Anonymous
  - Officials Only