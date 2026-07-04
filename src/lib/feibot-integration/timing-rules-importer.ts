/**
 * Feibot Comprehensive Timing Rules Importer
 * 
 * PURPOSE:
 * Import ALL timing rules data from Feibot and transform it into a data-driven format.
 * The Bergman application must NEVER hardcode race structure.
 * Feibot Timing Rules are the single source of truth.
 * 
 * IMPORTS:
 * - contests (races)
 * - splits (checkpoints)
 * - timing_points (timing devices)
 * - legs (race segments like SWIM, BIKE, RUN, T1, T2)
 * - devices (timing devices)
 * - age_groups (age group definitions)
 * - rankings (ranking rules)
 * 
 * SUPPORTS:
 * - Triathlon
 * - Duathlon
 * - Aquathlon
 * - Swimathon
 * - Relay
 * - Future race formats (WITHOUT CODE CHANGES)
 */

export interface FeibotLeg {
  legUuid: string;
  legName: string;
  contestUuid: string;
  startSplitUuid: string;
  startSplitOrder: number;
  endSplitUuid: string;
  endSplitOrder: number;
  [key: string]: any;
}

export interface FeibotTimingRulesSplit {
  splitUuid: string;
  contestUuid: string;
  contestName: string;
  splitName: string;
  order: number;
  distanceFromStart: number | null; // Total distance from race start
  splitLength: number | null; // Distance from previous split
  timingPointUuid: string | null;
  timingPointName: string | null;
  isStart: boolean;
  isFinish: boolean;
  isTransition: boolean;
  language?: string;
  displayName?: string;
  status?: string;
  enabled?: boolean;
  legUuid?: string; // Assigned during mapping
  legName?: string; // Assigned during mapping
  [key: string]: any;
}

export interface TimingRulesImportResult {
  eventId: string;
  success: boolean;
  timestamp: string;
  
  // Raw imported data
  contests: any[];
  splits: any[];
  timingPoints: any[];
  legs: FeibotLeg[];
  devices: any[];
  ageGroups: any[];
  rankings: any[];
  
  // Processed splits with leg mapping
  processedSplits: FeibotTimingRulesSplit[];
  
  // Validation report
  validation: {
    contestCount: number;
    legCount: number;
    splitCount: number;
    timingPointCount: number;
    deviceCount: number;
    ageGroupCount: number;
    
    perContest: Record<string, {
      expectedLegs?: number;
      importedLegs: number;
      expectedSplits?: number;
      importedSplits: number;
      expectedTimingPoints?: number;
      importedTimingPoints: number;
      missingLegs: string[];
      missingSplits: string[];
      duplicateSplits: string[];
      duplicateOrders: string[];
      duplicateUuids: string[];
      outOfOrderSplits: string[];
    }>;
  };
  
  // Errors and warnings
  errors: string[];
  warnings: string[];
}

/**
 * Extract and process legs from timing rules
 */
export function extractLegs(timingRules: any): FeibotLeg[] {
  const legs = timingRules?.legs || timingRules?.timing_rules?.legs || [];
  
  if (!Array.isArray(legs)) {
    console.warn('[TIMING RULES] No legs array found in timing rules');
    return [];
  }
  
  return legs.map((leg: any) => ({
    legUuid: leg.leg_uuid || leg.legUuid || leg.uuid || '',
    legName: leg.leg_name || leg.legName || leg.name || '',
    contestUuid: leg.contest_uuid || leg.contestUuid || '',
    startSplitUuid: leg.start_split_uuid || leg.startSplitUuid || '',
    startSplitOrder: leg.start_split_order ?? leg.startSplitOrder ?? 0,
    endSplitUuid: leg.end_split_uuid || leg.endSplitUuid || '',
    endSplitOrder: leg.end_split_order ?? leg.endSplitOrder ?? 0,
    ...leg, // Preserve all original fields
  }));
}

/**
 * Extract and process splits from timing rules
 */
export function extractSplits(timingRules: any): FeibotTimingRulesSplit[] {
  const splits = timingRules?.splits || timingRules?.timing_rules?.splits || [];
  
  if (!Array.isArray(splits)) {
    console.warn('[TIMING RULES] No splits array found in timing rules');
    return [];
  }
  
  return splits.map((split: any) => ({
    splitUuid: split.split_uuid || split.splitUuid || split.uuid || '',
    contestUuid: split.contest_uuid || split.contestUuid || '',
    contestName: split.contest_name || split.contestName || '',
    splitName: split.split_name || split.splitName || split.name || '',
    order: split.split_order || split.order || split.sequence || 0,
    distanceFromStart: split.distance_from_start ?? split.distanceFromStart ?? null,
    splitLength: split.split_length ?? split.splitLength ?? null,
    timingPointUuid: split.timing_point_uuid || split.timingPointUuid || null,
    timingPointName: split.timing_point_name || split.timingPointName || null,
    isStart: split.is_start ?? split.isStart ?? false,
    isFinish: split.is_finish ?? split.isFinish ?? false,
    isTransition: split.is_transition ?? split.isTransition ?? false,
    language: split.language || split.lang || undefined,
    displayName: split.display_name || split.displayName || split.splitName || '',
    status: split.status || 'active',
    enabled: split.enabled !== false,
    ...split, // Preserve all original fields
  }));
}

/**
 * Map splits to legs using split order ranges
 * This is the CRITICAL function that maps splits to legs based on:
 * - Split order >= leg.startSplitOrder AND split order <= leg.endSplitOrder
 * NEVER uses string matching or regex
 */
export function mapSplitsToLegs(
  splits: FeibotTimingRulesSplit[],
  legs: FeibotLeg[],
  contestUuid: string
): FeibotTimingRulesSplit[] {
  const legsForContest = legs.filter(l => l.contestUuid === contestUuid);
  
  return splits.map(split => {
    if (split.contestUuid !== contestUuid) {
      return split; // Not for this contest
    }
    
    // Find which leg this split belongs to
    const matchingLeg = legsForContest.find(leg => {
      return (
        split.order >= leg.startSplitOrder &&
        split.order <= leg.endSplitOrder
      );
    });
    
    if (matchingLeg) {
      return {
        ...split,
        legUuid: matchingLeg.legUuid,
        legName: matchingLeg.legName,
      };
    }
    
    return split;
  });
}

/**
 * Validate timing rules completeness and consistency
 */
export function validateTimingRules(
  contests: any[],
  splits: FeibotTimingRulesSplit[],
  timingPoints: any[],
  legs: FeibotLeg[],
  devices: any[],
  ageGroups: any[]
): TimingRulesImportResult['validation'] {
  const validation: TimingRulesImportResult['validation'] = {
    contestCount: contests.length,
    legCount: legs.length,
    splitCount: splits.length,
    timingPointCount: timingPoints.length,
    deviceCount: devices.length,
    ageGroupCount: ageGroups.length,
    perContest: {},
  };
  
  // Per-contest validation
  const contestsByUuid = new Map<string, any>();
  contests.forEach(c => {
    const uuid = c.contest_uuid || c.contestUuid || c.uuid;
    if (uuid) contestsByUuid.set(uuid, c);
  });
  
  for (const [contestUuid, contest] of contestsByUuid) {
    const contestSplits = splits.filter(s => s.contestUuid === contestUuid);
    const contestTimingPoints = timingPoints.filter(
      tp => tp.contest_uuid === contestUuid || tp.contestUuid === contestUuid
    );
    const contestLegs = legs.filter(l => l.contestUuid === contestUuid);
    
    // Check for issues
    const duplicateSplits: string[] = [];
    const duplicateOrders: string[] = [];
    const duplicateUuids: string[] = [];
    const outOfOrderSplits: string[] = [];
    
    const splitsByOrder = new Map<number, string[]>();
    const splitUuids = new Set<string>();
    
    let prevOrder = -1;
    for (const split of contestSplits.sort((a, b) => a.order - b.order)) {
      // Check for duplicate orders
      if (splitsByOrder.has(split.order)) {
        const existing = splitsByOrder.get(split.order)!;
        existing.push(split.splitName);
        duplicateOrders.push(`Order ${split.order}: ${existing.join(', ')}`);
      } else {
        splitsByOrder.set(split.order, [split.splitName]);
      }
      
      // Check for duplicate UUIDs
      if (splitUuids.has(split.splitUuid)) {
        duplicateUuids.push(split.splitUuid);
      }
      splitUuids.add(split.splitUuid);
      
      // Check for out-of-order splits
      if (split.order < prevOrder) {
        outOfOrderSplits.push(`${split.splitName} (order ${split.order} after ${prevOrder})`);
      }
      prevOrder = split.order;
    }
    
    validation.perContest[contestUuid] = {
      importedLegs: contestLegs.length,
      importedSplits: contestSplits.length,
      importedTimingPoints: contestTimingPoints.length,
      missingLegs: contestLegs.length === 0 ? ['No legs imported'] : [],
      missingSplits: contestSplits.length === 0 ? ['No splits imported'] : [],
      duplicateSplits: duplicateSplits,
      duplicateOrders: duplicateOrders,
      duplicateUuids: duplicateUuids,
      outOfOrderSplits: outOfOrderSplits,
    };
  }
  
  return validation;
}

/**
 * Format validation report for logging
 */
export function formatValidationReport(validation: TimingRulesImportResult['validation']): string {
  let report = `\n${'='.repeat(80)}\n`;
  report += `TIMING RULES VALIDATION REPORT\n`;
  report += `${'='.repeat(80)}\n\n`;
  
  report += `SUMMARY:\n`;
  report += `  Contests: ${validation.contestCount}\n`;
  report += `  Legs: ${validation.legCount}\n`;
  report += `  Splits: ${validation.splitCount}\n`;
  report += `  Timing Points: ${validation.timingPointCount}\n`;
  report += `  Devices: ${validation.deviceCount}\n`;
  report += `  Age Groups: ${validation.ageGroupCount}\n\n`;
  
  report += `PER-CONTEST DETAILS:\n`;
  for (const [contestUuid, details] of Object.entries(validation.perContest)) {
    report += `\n  Contest: ${contestUuid}\n`;
    report += `    Imported Legs: ${details.importedLegs}\n`;
    report += `    Imported Splits: ${details.importedSplits}\n`;
    report += `    Imported Timing Points: ${details.importedTimingPoints}\n`;
    
    if (details.missingLegs.length > 0) {
      report += `    ⚠️  Missing Legs: ${details.missingLegs.join(', ')}\n`;
    }
    
    if (details.missingSplits.length > 0) {
      report += `    ⚠️  Missing Splits: ${details.missingSplits.join(', ')}\n`;
    }
    
    if (details.duplicateOrders.length > 0) {
      report += `    ⚠️  Duplicate Orders: ${details.duplicateOrders.join(', ')}\n`;
    }
    
    if (details.duplicateUuids.length > 0) {
      report += `    ⚠️  Duplicate UUIDs: ${details.duplicateUuids.join(', ')}\n`;
    }
    
    if (details.outOfOrderSplits.length > 0) {
      report += `    ⚠️  Out of Order: ${details.outOfOrderSplits.join(', ')}\n`;
    }
  }
  
  report += `\n${'='.repeat(80)}\n`;
  return report;
}

/**
 * Main import function
 */
export async function importFeibotTimingRules(
  timingRules: any,
  eventId: string
): Promise<TimingRulesImportResult> {
  const timestamp = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Extract all data
    console.log('[TIMING RULES IMPORT] Starting comprehensive import...');
    
    const contests = timingRules?.contests || [];
    const timingPoints = timingRules?.timing_points || timingRules?.timingPoints || [];
    const devices = timingRules?.devices || [];
    const ageGroups = timingRules?.age_groups || timingRules?.ageGroups || [];
    const rankings = timingRules?.rankings || [];
    
    const legs = extractLegs(timingRules);
    let splits = extractSplits(timingRules);
    
    console.log('[TIMING RULES IMPORT] Extracted data:', {
      contests: contests.length,
      legs: legs.length,
      splits: splits.length,
      timingPoints: timingPoints.length,
      devices: devices.length,
      ageGroups: ageGroups.length,
      rankings: rankings.length,
    });
    
    // Map splits to legs for each contest
    const uniqueContests = [...new Set(contests.map((c: any) => (c.contest_uuid || c.contestUuid) as string))].filter((x): x is string => Boolean(x));
    const processedSplits: FeibotTimingRulesSplit[] = [];
    
    for (const contestUuid of uniqueContests) {
      const contestSplits = splits.filter(s => s.contestUuid === contestUuid);
      const mapped = mapSplitsToLegs(contestSplits, legs, contestUuid);
      processedSplits.push(...mapped);
    }
    
    // Sort all splits by order
    processedSplits.sort((a, b) => a.order - b.order);
    
    console.log('[TIMING RULES IMPORT] Mapped splits to legs:', {
      processedCount: processedSplits.length,
      withLegMapping: processedSplits.filter(s => s.legUuid).length,
    });
    
    // Validate
    const validation = validateTimingRules(
      contests,
      processedSplits,
      timingPoints,
      legs,
      devices,
      ageGroups
    );
    
    console.log(formatValidationReport(validation));
    
    // Check for critical issues
    if (processedSplits.length === 0) {
      errors.push('No splits imported. Timing rules may be malformed.');
    }
    
    if (legs.length === 0) {
      warnings.push('No legs imported. Race structure may not be defined in Feibot.');
    }
    
    const hasOutOfOrderSplits = Object.values(validation.perContest).some(
      c => c.outOfOrderSplits.length > 0
    );
    if (hasOutOfOrderSplits) {
      warnings.push('Some splits are out of order. This may cause display issues.');
    }
    
    return {
      eventId,
      success: errors.length === 0,
      timestamp,
      contests,
      splits: processedSplits,
      timingPoints,
      legs,
      devices,
      ageGroups,
      rankings,
      processedSplits,
      validation,
      errors,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TIMING RULES IMPORT] Error:', message);
    errors.push(`Import error: ${message}`);
    
    return {
      eventId,
      success: false,
      timestamp,
      contests: [],
      splits: [],
      timingPoints: [],
      legs: [],
      devices: [],
      ageGroups: [],
      rankings: [],
      processedSplits: [],
      validation: {
        contestCount: 0,
        legCount: 0,
        splitCount: 0,
        timingPointCount: 0,
        deviceCount: 0,
        ageGroupCount: 0,
        perContest: {},
      },
      errors,
      warnings,
    };
  }
}

/**
 * Build KV storage keys
 */
export function getTimingRulesKVKey(eventId: string, type: 'legs' | 'splits'): string {
  return `live:event:${eventId}:${type}:index`;
}

/**
 * Format legs for KV storage
 */
export function formatLegsForKV(
  eventId: string,
  legs: FeibotLeg[]
): Record<string, any> {
  const byContest = new Map<string, FeibotLeg[]>();
  
  for (const leg of legs) {
    const contestUuid = leg.contestUuid;
    if (!byContest.has(contestUuid)) {
      byContest.set(contestUuid, []);
    }
    byContest.get(contestUuid)!.push(leg);
  }
  
  const result: Record<string, any> = {};
  for (const [contestUuid, legsForContest] of byContest) {
    result[contestUuid] = { legs: legsForContest };
  }
  
  return result;
}

/**
 * Format splits for KV storage (sorted by order)
 */
export function formatSplitsForKV(
  eventId: string,
  splits: FeibotTimingRulesSplit[]
): Record<string, any> {
  const byContest = new Map<string, FeibotTimingRulesSplit[]>();
  
  for (const split of splits) {
    const contestUuid = split.contestUuid;
    if (!byContest.has(contestUuid)) {
      byContest.set(contestUuid, []);
    }
    byContest.get(contestUuid)!.push(split);
  }
  
  const result: Record<string, any> = {};
  for (const [contestUuid, splitsForContest] of byContest) {
    // Sort by order (ascending)
    const sorted = [...splitsForContest].sort((a, b) => a.order - b.order);
    result[contestUuid] = { splits: sorted };
  }
  
  return result;
}
