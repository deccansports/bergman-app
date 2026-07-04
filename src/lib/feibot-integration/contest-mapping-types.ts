/**
 * Contest Mapping System (Phase 3)
 * 
 * Schema:
 * events/{eventId}/feibotContestMappings/{mappingId}
 * 
 * Represents 1:1 relationship between Feibot contests and Bergman events/tickets
 */

export interface FeibotContestMapping {
  // Identifiers
  mappingId: string; // UUID
  eventId: string; // Bergman event ID
  connectionId: string; // Phase 1 connection ID
  
  // Feibot side
  feibotContestUuid: string; // Contest UUID from Phase 2 import
  feibotContestName: string; // e.g., "BERGMAN OT"
  feibotProvider: 'feibot' | 'racemap' | 'chronotrack' | 'raceresult';
  
  // Bergman side (can map to event OR ticket)
  mappingType: 'event' | 'ticket' | 'ticket-subcategory';
  
  // Event-level mapping
  bergmanEventName?: string; // e.g., "Triathlon"
  bergmanEventId?: string;
  
  // Ticket-level mapping
  bergmanTicketId?: string;
  bergmanTicketName?: string;
  bergmanSubCategoryId?: string;
  bergmanSubCategoryName?: string;
  
  // Metadata
  status: 'active' | 'inactive' | 'pending-review';
  matchConfidence: number; // 0-100, based on name similarity
  matchMethod: 'manual' | 'auto-exact' | 'auto-fuzzy';
  
  // Audit
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  createdBy: string; // User ID
  notes?: string;
  
  // Validation
  validated: boolean;
  validationErrors: string[];
}

export interface FeibotContestMappingBatch {
  eventId: string;
  mappings: FeibotContestMapping[];
  totalContests: number;
  mappedContests: number;
  unmappedContests: number;
  syncedAt: string;
}

export interface ContestMappingRequest {
  feibotContestUuid: string;
  feibotContestName: string;
  mappingType: 'event' | 'ticket' | 'ticket-subcategory';
  bergmanEventId?: string;
  bergmanTicketId?: string;
  bergmanSubCategoryId?: string;
  matchConfidence?: number;
  notes?: string;
}

export interface ContestMappingResponse {
  success: boolean;
  mapping?: FeibotContestMapping;
  error?: string;
  validation?: string[];
}

export interface ContestMappingSummary {
  total: number;
  active: number;
  inactive: number;
  pendingReview: number;
  mappedPercentage: number;
}
