/**
 * DEPRECATED: This file exists only for legacy support during transition
 * New code should use src/lib/feibot-integration/ modules directly
 * 
 * This will be completely removed after all phases are completed.
 */

export interface FeibotDatabaseSummary {
  totalParticipants: number;
  totalChipReads: number;
}

export interface ParsedFeibotDatabase {
  summary: FeibotDatabaseSummary;
  [key: string]: any;
}

export class FeibotDatabaseParser {
  async parse(file: Blob): Promise<ParsedFeibotDatabase> {
    throw new Error('FeibotDatabaseParser is deprecated. Use feibot-integration modules instead.');
  }
}

export async function parseFeibotDatabase(file: Blob): Promise<ParsedFeibotDatabase> {
  throw new Error('parseFeibotDatabase is deprecated. Use feibot-integration modules instead.');
}
