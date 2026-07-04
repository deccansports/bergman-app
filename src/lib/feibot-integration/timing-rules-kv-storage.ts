/**
 * Feibot Timing Rules KV Storage
 * 
 * Handles storing and retrieving timing rules from Cloudflare KV
 * with immediate validation after writes
 */

import { getKV, putKV } from '@/lib/cloudflare/kv';
import {
  FeibotLeg,
  FeibotTimingRulesSplit,
  getTimingRulesKVKey,
  formatLegsForKV,
  formatSplitsForKV,
} from './timing-rules-importer';

export interface TimingRulesKVValidation {
  success: boolean;
  errors: string[];
  warnings: string[];
  legCount: number;
  splitCount: number;
  byContest: Record<
    string,
    {
      legCount: number;
      splitCount: number;
      order: number[];
      missingOrders?: number[];
      duplicateOrders?: number[];
    }
  >;
}

/**
 * Save legs to KV and validate immediately
 */
export async function saveLegsToKV(
  eventId: string,
  legs: FeibotLeg[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const kvKey = getTimingRulesKVKey(eventId, 'legs');
    const kvValue = formatLegsForKV(eventId, legs);
    
    console.log('[TIMING RULES KV] Saving legs to KV:', {
      eventId,
      kvKey,
      legsCount: legs.length,
      contests: Object.keys(kvValue).length,
    });
    
    await putKV(kvKey, JSON.stringify(kvValue), '[TIMING_RULES_KV] saveLegsToKV');
    
    // Verify immediately
    const verification = await verifyLegsInKV(eventId);
    if (!verification.success) {
      const errorMsg = `Legs verification failed: ${verification.errors.join(', ')}`;
      console.error('[TIMING RULES KV]', errorMsg);
      // Abort further operations
      throw new Error(errorMsg);
    }
    
    console.log('[TIMING RULES KV] Legs saved and verified');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TIMING RULES KV] Error saving legs:', message);
    return { success: false, error: message };
  }
}

/**
 * Save splits to KV and validate immediately
 */
export async function saveSplitsToKV(
  eventId: string,
  splits: FeibotTimingRulesSplit[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const kvKey = getTimingRulesKVKey(eventId, 'splits');
    const kvValue = formatSplitsForKV(eventId, splits);
    
    console.log('[TIMING RULES KV] Saving splits to KV:', {
      eventId,
      kvKey,
      splitsCount: splits.length,
      contests: Object.keys(kvValue).length,
    });
    
    await putKV(kvKey, JSON.stringify(kvValue), '[TIMING_RULES_KV] saveSplitsToKV');
    
    // Verify immediately
    const verification = await verifySplitsInKV(eventId);
    if (!verification.success) {
      const errorMsg = `Splits verification failed: ${verification.errors.join(', ')}`;
      console.error('[TIMING RULES KV]', errorMsg);
      // Abort further operations
      throw new Error(errorMsg);
    }
    
    console.log('[TIMING RULES KV] Splits saved and verified');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TIMING RULES KV] Error saving splits:', message);
    return { success: false, error: message };
  }
}

/**
 * Verify legs in KV
 */
export async function verifyLegsInKV(eventId: string): Promise<TimingRulesKVValidation> {
  const validation: TimingRulesKVValidation = {
    success: true,
    errors: [],
    warnings: [],
    legCount: 0,
    splitCount: 0,
    byContest: {},
  };
  
  try {
    const kvKey = getTimingRulesKVKey(eventId, 'legs');
    const kvData = await getKV<string>(kvKey, '[TIMING_RULES_KV] verifyLegsInKV');
    
    if (!kvData) {
      validation.success = false;
      validation.errors.push(`Legs key not found in KV: ${kvKey}`);
      return validation;
    }
    
    const parsed = JSON.parse(kvData);
    
    if (!parsed || typeof parsed !== 'object') {
      validation.success = false;
      validation.errors.push('Legs data is not a valid object');
      return validation;
    }
    
    // Count legs
    for (const [contestUuid, data] of Object.entries(parsed)) {
      const legsArray = (data as any)?.legs;
      if (!Array.isArray(legsArray)) {
        validation.errors.push(`Contest ${contestUuid}: legs is not an array`);
        continue;
      }
      
      validation.legCount += legsArray.length;
      validation.byContest[contestUuid] = {
        legCount: legsArray.length,
        splitCount: 0,
        order: [],
      };
    }
    
    if (validation.legCount === 0) {
      validation.warnings.push('No legs found in KV');
    }
    
    console.log('[TIMING RULES KV] Legs verification result:', validation);
    return validation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    validation.success = false;
    validation.errors.push(`Verification error: ${message}`);
    return validation;
  }
}

/**
 * Verify splits in KV
 */
export async function verifySplitsInKV(eventId: string): Promise<TimingRulesKVValidation> {
  const validation: TimingRulesKVValidation = {
    success: true,
    errors: [],
    warnings: [],
    legCount: 0,
    splitCount: 0,
    byContest: {},
  };
  
  try {
    const kvKey = getTimingRulesKVKey(eventId, 'splits');
    const kvData = await getKV<string>(kvKey, '[TIMING_RULES_KV] verifySplitsInKV');
    
    if (!kvData) {
      validation.success = false;
      validation.errors.push(`Splits key not found in KV: ${kvKey}`);
      return validation;
    }
    
    const parsed = JSON.parse(kvData);
    
    if (!parsed || typeof parsed !== 'object') {
      validation.success = false;
      validation.errors.push('Splits data is not a valid object');
      return validation;
    }
    
    // Count and validate splits
    for (const [contestUuid, data] of Object.entries(parsed)) {
      const splitsArray = (data as any)?.splits;
      if (!Array.isArray(splitsArray)) {
        validation.errors.push(`Contest ${contestUuid}: splits is not an array`);
        continue;
      }
      
      validation.splitCount += splitsArray.length;
      
      // Check ordering
      const orders: number[] = [];
      const orderSet = new Set<number>();
      let isOrdered = true;
      let prevOrder = -1;
      
      for (const split of splitsArray) {
        const order = split.order;
        orders.push(order);
        
        if (orderSet.has(order)) {
          validation.errors.push(`Contest ${contestUuid}: Duplicate order ${order}`);
        }
        orderSet.add(order);
        
        if (order < prevOrder) {
          isOrdered = false;
        }
        prevOrder = order;
      }
      
      if (!isOrdered) {
        validation.warnings.push(`Contest ${contestUuid}: Splits are not sorted by order`);
      }
      
      validation.byContest[contestUuid] = {
        legCount: 0,
        splitCount: splitsArray.length,
        order: orders,
      };
    }
    
    if (validation.splitCount === 0) {
      validation.warnings.push('No splits found in KV');
    }
    
    console.log('[TIMING RULES KV] Splits verification result:', validation);
    return validation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    validation.success = false;
    validation.errors.push(`Verification error: ${message}`);
    return validation;
  }
}

/**
 * Load legs from KV
 */
export async function loadLegsFromKV(eventId: string): Promise<FeibotLeg[] | null> {
  try {
    const kvKey = getTimingRulesKVKey(eventId, 'legs');
    const kvData = await getKV<string>(kvKey, '[TIMING_RULES_KV] loadLegsFromKV');
    
    if (!kvData) {
      console.warn('[TIMING RULES KV] Legs not found in KV:', kvKey);
      return null;
    }
    
    const parsed = JSON.parse(kvData);
    const legs: FeibotLeg[] = [];
    
    for (const data of Object.values(parsed)) {
      const legsArray = (data as any)?.legs;
      if (Array.isArray(legsArray)) {
        legs.push(...legsArray);
      }
    }
    
    console.log('[TIMING RULES KV] Loaded legs from KV:', { eventId, count: legs.length });
    return legs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TIMING RULES KV] Error loading legs:', message);
    return null;
  }
}

/**
 * Load splits from KV
 */
export async function loadSplitsFromKV(eventId: string): Promise<FeibotTimingRulesSplit[] | null> {
  try {
    const kvKey = getTimingRulesKVKey(eventId, 'splits');
    const kvData = await getKV<string>(kvKey, '[TIMING_RULES_KV] loadSplitsFromKV');
    
    if (!kvData) {
      console.warn('[TIMING RULES KV] Splits not found in KV:', kvKey);
      return null;
    }
    
    const parsed = JSON.parse(kvData);
    const splits: FeibotTimingRulesSplit[] = [];
    
    for (const data of Object.values(parsed)) {
      const splitsArray = (data as any)?.splits;
      if (Array.isArray(splitsArray)) {
        splits.push(...splitsArray);
      }
    }
    
    console.log('[TIMING RULES KV] Loaded splits from KV:', { eventId, count: splits.length });
    return splits;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TIMING RULES KV] Error loading splits:', message);
    return null;
  }
}

/**
 * Format and log validation report
 */
export function formatKVValidationReport(validation: TimingRulesKVValidation): string {
  let report = `\n${'='.repeat(80)}\n`;
  report += `TIMING RULES KV VALIDATION\n`;
  report += `${'='.repeat(80)}\n\n`;
  
  if (!validation.success) {
    report += `❌ VALIDATION FAILED\n\n`;
    report += `Errors:\n`;
    for (const error of validation.errors) {
      report += `  - ${error}\n`;
    }
  } else {
    report += `✅ VALIDATION PASSED\n\n`;
  }
  
  report += `Summary:\n`;
  report += `  Total Legs: ${validation.legCount}\n`;
  report += `  Total Splits: ${validation.splitCount}\n`;
  report += `  Contests: ${Object.keys(validation.byContest).length}\n\n`;
  
  if (validation.warnings.length > 0) {
    report += `Warnings:\n`;
    for (const warning of validation.warnings) {
      report += `  ⚠️  ${warning}\n`;
    }
    report += '\n';
  }
  
  report += `Details by Contest:\n`;
  for (const [contestUuid, details] of Object.entries(validation.byContest)) {
    report += `  ${contestUuid}:\n`;
    report += `    Legs: ${details.legCount}\n`;
    report += `    Splits: ${details.splitCount}\n`;
    if (details.order.length > 0) {
      report += `    Order Range: ${Math.min(...details.order)} - ${Math.max(...details.order)}\n`;
    }
  }
  
  report += `\n${'='.repeat(80)}\n`;
  return report;
}
