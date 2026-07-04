# Feibot Timing Rules - Integration Reference

This document shows exactly where and how to integrate the new timing rules system.

---

## 1. Admin Import Endpoint

### Current Location
`src/app/api/admin/live-tracking/feibot/sync/route.ts` (or similar admin endpoint)

### What to Update
The timing rules import step in the admin sync flow

### Current Code Pattern
```typescript
// OLD: Current timing rules import (likely minimal)
const timingRules = await callFeibotAPI(config, '/eventConfigFile/timingRulesGet', {
  method: 'GET',
  query: { event_uuid: eventId },
});
// Minimal processing...
```

### New Code Pattern
```typescript
import {
  importFeibotTimingRules,
  saveLegsToKV,
  saveSplitsToKV,
  formatValidationReport,
  formatKVValidationReport,
} from '@/lib/feibot-integration';

// Fetch from Feibot
const apiResult = await callFeibotAPI(config, '/eventConfigFile/timingRulesGet', {
  method: 'GET',
  query: { event_uuid: eventId },
});

if (!apiResult.ok) {
  throw new Error('Failed to fetch timing rules from Feibot');
}

// Import and process
const importResult = await importFeibotTimingRules(apiResult.data, eventId);

if (!importResult.success) {
  console.error('[TIMING RULES] Import failed:', importResult.errors);
  throw new Error(`Timing rules import failed: ${importResult.errors.join(', ')}`);
}

console.log('[TIMING RULES] Import report:');
console.log(formatValidationReport(importResult.validation));

// Save to KV
const legsResult = await saveLegsToKV(eventId, importResult.legs);
if (!legsResult.success) {
  console.error('[TIMING RULES] Legs save failed:', legsResult.error);
  throw new Error(`Failed to save legs: ${legsResult.error}`);
}

const splitsResult = await saveSplitsToKV(eventId, importResult.processedSplits);
if (!splitsResult.success) {
  console.error('[TIMING RULES] Splits save failed:', splitsResult.error);
  throw new Error(`Failed to save splits: ${splitsResult.error}`);
}

console.log('[TIMING RULES] All timing rules imported and verified successfully');

// Return summary to admin UI
return {
  success: true,
  summary: {
    contests: importResult.validation.contestCount,
    legs: importResult.validation.legCount,
    splits: importResult.validation.splitCount,
    timingPoints: importResult.validation.timingPointCount,
    errors: importResult.errors,
    warnings: importResult.warnings,
  }
};
```

---

## 2. Athlete Modal - Display Legs and Splits

### Current Location
`src/components/live-tracking/AthleteLiveModalPro.tsx`

### What to Update
The section that displays race progress (legs and splits)

### Current Code Pattern
```typescript
// OLD: Likely hardcoded leg display
return (
  <div>
    <div>SWIM: {athlete.swimTime}</div>
    <div>BIKE: {athlete.bikeTime}</div>
    <div>RUN: {athlete.runTime}</div>
  </div>
);
```

### New Code Pattern
```typescript
import { loadSplitsFromKV } from '@/lib/feibot-integration';

// Component effect to load splits
useEffect(() => {
  if (!eventId) return;
  
  (async () => {
    const splits = await loadSplitsFromKV(eventId);
    if (splits) {
      setSplits(splits);
    }
  })();
}, [eventId]);

// Group splits by leg
const splitsByLeg = splits.reduce((acc, split) => {
  const legName = split.legName || 'Unknown';
  if (!acc[legName]) acc[legName] = [];
  acc[legName].push(split);
  return acc;
}, {} as Record<string, typeof splits>);

// Get unique legs in order (use timingConfiguration.legs if available)
const legOrder = ['SWIM', 'T1', 'BIKE', 'T2', 'RUN', 'RUN1', 'RUN2'];
const orderedLegs = legOrder.filter(leg => legName in splitsByLeg);

// Display all legs expanded
return (
  <div className="space-y-4">
    {orderedLegs.map(legName => (
      <div key={legName}>
        <h3 className="font-bold text-primary">{legName}</h3>
        <div className="space-y-1 pl-4">
          {splitsByLeg[legName].map(split => {
            const athleteSplit = athlete.splits?.find(
              s => s.uuid === split.splitUuid || s.segment === split.splitName
            );
            const time = athleteSplit?.time ? formatSecondsToHMS(athleteSplit.time) : '--:--:--';
            
            return (
              <div key={split.splitUuid} className="text-sm flex justify-between">
                <span>{split.displayName || split.splitName}</span>
                <span className="font-mono">{time}</span>
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);
```

---

## 3. Progress Calculation

### Current Location
`src/components/live-tracking/BergmanTrackerCard.tsx`
`src/components/live-tracking/AthleteLiveModalPro.tsx`

### What to Update
All places where progress percentage is calculated

### Current Code Pattern
```typescript
// OLD: Split count based
const progress = (athlete.splits?.length || 0) / totalSplitCount * 100;
```

### New Code Pattern
```typescript
/**
 * Calculate progress using distance from start
 * This works for any race format
 */
function calculateProgressFromDistance(
  athlete: LiveAthlete,
  allSplits: FeibotTimingRulesSplit[]
): { progress: number; distanceCovered: number; totalDistance: number } {
  if (!athlete.splits || athlete.splits.length === 0) {
    return { progress: 0, distanceCovered: 0, totalDistance: 0 };
  }
  
  // Get last reached split
  const lastSplit = athlete.splits[athlete.splits.length - 1];
  const distanceCovered = lastSplit.distanceFromStart || 0;
  
  // Get total race distance (last split in race)
  const lastRaceSplit = allSplits[allSplits.length - 1];
  const totalDistance = lastRaceSplit?.distanceFromStart || 0;
  
  // Calculate progress
  const progress = totalDistance > 0 ? (distanceCovered / totalDistance) * 100 : 0;
  
  return {
    progress: Math.min(100, Math.max(0, progress)),
    distanceCovered,
    totalDistance,
  };
}

// Usage
const { progress, distanceCovered, totalDistance } = calculateProgressFromDistance(
  athlete,
  timingConfiguration.splits || []
);

console.log(`${distanceCovered.toFixed(1)} km / ${totalDistance.toFixed(1)} km = ${progress.toFixed(1)}%`);
```

---

## 4. Live Tracking Hub - Status Display

### Current Location
`src/components/admin/LiveTrackingHub.tsx` or status endpoint

### What to Update
Where timing rules status is displayed to admin

### New Code Pattern
```typescript
import {
  loadLegsFromKV,
  loadSplitsFromKV,
} from '@/lib/feibot-integration';

// Load and display timing rules status
async function getTimingRulesStatus(eventId: string) {
  const legs = await loadLegsFromKV(eventId);
  const splits = await loadSplitsFromKV(eventId);
  
  return {
    status: legs && splits ? 'Loaded' : 'Not Available',
    legs: legs?.length || 0,
    splits: splits?.length || 0,
    contests: new Set(splits?.map(s => s.contestUuid) || []).size,
    lastUpdate: new Date().toISOString(),
  };
}
```

---

## 5. Timing Configuration Builder

### Current Location
`src/lib/timingConfiguration.ts`

### What to Update
Where timing configuration is built from data sources

### New Addition
```typescript
/**
 * Load timing configuration from imported Feibot data
 */
export async function loadTimingConfigurationFromFeibot(
  eventId: string
): Promise<ResolvedTimingConfiguration | null> {
  const {
    loadLegsFromKV,
    loadSplitsFromKV,
  } = require('@/lib/feibot-integration');
  
  const legs = await loadLegsFromKV(eventId);
  const splits = await loadSplitsFromKV(eventId);
  
  if (!legs || !splits) {
    return null;
  }
  
  // Build configuration from imported data
  const config: ResolvedTimingConfiguration = {
    eventId,
    source: 'cloud',
    course: {
      legs: [...new Set(legs.map(l => l.legName))],
      timingPoints: [],
      splits: splits.map(s => ({
        ...s,
        raw: s,
      })),
      contests: [...new Set(splits.map(s => ({ contestUuid: s.contestUuid, contestName: s.contestName })))],
    },
    contests: [],
    timingPoints: [],
    splits: splits,
    devices: [],
    legs: [...new Set(legs.map(l => l.legName))],
    ageGroups: [],
    contestIndex: {},
    contestByUuid: {},
    contestByName: {},
    splitsByContest: groupSplitsByContest(splits),
    timingPointsByContest: {},
    ageGroupsByContest: {},
    importedAt: new Date().toISOString(),
    provider: 'feibot',
    updatedAt: Date.now(),
  };
  
  return config;
}

function groupSplitsByContest(splits: FeibotTimingRulesSplit[]) {
  return splits.reduce((acc, split) => {
    const contestUuid = split.contestUuid;
    if (!acc[contestUuid]) acc[contestUuid] = [];
    acc[contestUuid].push(split);
    return acc;
  }, {} as Record<string, FeibotTimingRulesSplit[]>);
}
```

---

## 6. Remove Hardcoded References

### Search for and Replace

#### SWIM-only detection
```typescript
// OLD - Search for
const isSwimOnly = contestName.toLowerCase().includes('swim');

// NEW - Replace with
const legs = await loadLegsFromKV(eventId);
const isSwimOnly = legs?.length === 1 && legs[0].legName === 'SWIM';
```

#### Race type detection
```typescript
// OLD - Search for
const isDuathlon = name.includes('duathlon');
const isRelay = name.includes('relay');

// NEW - Replace with
async function detectRaceFormat(eventId: string): Promise<RaceFormat> {
  const legs = await loadLegsFromKV(eventId);
  if (!legs) return 'unknown';
  
  const legNames = legs.map(l => l.legName.toUpperCase());
  
  if (legNames.includes('RUN1') && legNames.includes('RUN2')) return 'duathlon';
  if (legNames.includes('SWIM') && legNames.includes('BIKE') && legNames.includes('RUN')) return 'triathlon';
  if (legNames.length === 1 && legNames[0] === 'SWIM') return 'swimathon';
  if (legs.some(l => l.legName.includes('_'))) return 'relay'; // Relay uses participant-specific names
  
  return 'custom';
}
```

#### Hardcoded leg lists
```typescript
// OLD - Search for
const RACE_LEGS = ['SWIM', 'T1', 'BIKE', 'T2', 'RUN'];

// NEW - Replace with
const raceLegOrder = ['SWIM', 'RUN1', 'T1', 'BIKE', 'T2', 'RUN', 'RUN2'];
const raceLegs = raceLegOrder.filter(leg => 
  importedLegs.some(l => l.legName === leg)
);
```

---

## 7. Types to Add/Update

### New Types Needed
```typescript
// May need to add to src/lib/types/results.ts

export interface TimingRulesData {
  eventId: string;
  legs: FeibotLeg[];
  splits: FeibotTimingRulesSplit[];
  contests: any[];
  timingPoints: any[];
  devices: any[];
  ageGroups: any[];
}

export interface RaceFormat {
  format: 'triathlon' | 'duathlon' | 'relay' | 'swimathon' | 'aquathlon' | 'custom';
  legCount: number;
  legs: string[];
  totalDistance: number;
}
```

---

## 8. Testing Integration Points

### Unit Tests
```typescript
// Test split-to-leg mapping
test('mapSplitsToLegs maps by numeric order', () => {
  const legs = [{ legUuid: '1', legName: 'SWIM', startSplitOrder: 1, endSplitOrder: 2 }];
  const splits = [
    { splitUuid: '1', order: 1, ... },
    { splitUuid: '2', order: 2, ... },
  ];
  const result = mapSplitsToLegs(splits, legs, 'contest1');
  expect(result[0].legName).toBe('SWIM');
  expect(result[1].legName).toBe('SWIM');
});

// Test progress calculation
test('progress calculated from distanceFromStart', () => {
  const athlete = {
    splits: [{ distanceFromStart: 5.5, ... }],
  };
  const allSplits = [{ distanceFromStart: 10, ... }];
  const progress = calculateProgressFromDistance(athlete, allSplits);
  expect(progress.progress).toBe(55);
});
```

### Integration Tests
```typescript
// Test full import and storage
test('importFeibotTimingRules saves to KV correctly', async () => {
  const timingRules = loadFixture('timing-rules-triathlon.json');
  const result = await importFeibotTimingRules(timingRules, 'test-event');
  
  expect(result.success).toBe(true);
  
  const legsResult = await saveLegsToKV('test-event', result.legs);
  expect(legsResult.success).toBe(true);
  
  const legs = await loadLegsFromKV('test-event');
  expect(legs?.length).toBe(5);
});
```

---

## 9. Error Handling

### Add to Existing Error Handler
```typescript
import {
  TimingRulesImportResult,
  TimingRulesKVValidation,
} from '@/lib/feibot-integration';

class TimingRulesError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
  }
}

// Usage
if (!importResult.success) {
  throw new TimingRulesError('IMPORT_FAILED', 'Failed to import timing rules', {
    errors: importResult.errors,
    warnings: importResult.warnings,
  });
}

if (!kvResult.success) {
  throw new TimingRulesError('KV_SAVE_FAILED', 'Failed to save to KV', {
    error: kvResult.error,
  });
}
```

---

## Implementation Checklist

For each integration point:

- [ ] Import required functions
- [ ] Add necessary types
- [ ] Replace old logic with new
- [ ] Handle errors appropriately
- [ ] Add logging
- [ ] Test with sample data
- [ ] Test with multiple formats
- [ ] Verify performance
- [ ] Check error messages
- [ ] Review with team

---

## Quick Search/Replace Commands

Use these to find all locations that need updates:

```bash
# Find all hardcoded leg references
grep -r "SWIM\|BIKE\|RUN" src/ --include="*.ts" --include="*.tsx" | grep -v "types\|constants"

# Find all race format detection
grep -r "isDuathlon\|isTriathlon\|isRelay" src/ --include="*.ts" --include="*.tsx"

# Find all progress calculations
grep -r "splits.length\|splitCount\|courseProgress" src/ --include="*.ts" --include="*.tsx"

# Find all leg displays
grep -r "SWIM\|T1\|BIKE" src/components --include="*.tsx"
```

---

## Questions/Support

For specific integration challenges, refer to:

1. **Import Logic**: See `importFeibotTimingRules()` in timing-rules-importer.ts
2. **Storage Logic**: See `saveLegsToKV()` and `saveSplitsToKV()` in timing-rules-kv-storage.ts
3. **Display Logic**: See athlete modal examples above
4. **Progress Calc**: See `calculateProgressFromDistance()` example above
5. **Type Defs**: See `FEIBOT_TIMING_RULES_COMPREHENSIVE.md`
