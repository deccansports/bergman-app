// src/lib/types/ticket.ts
export interface PricingTier {
  name: string;
  pricePaisa: number;
  slotLimit?: number | null;
  endDate?: string | null;
}

export interface SwimDistanceCategory {
  id: string;
  name: string; 
  pricePaisa: number;
  applicableAgeGroups: string[] | string;
  maxQuantity?: number | null;
  cutoff?: string | null; 
  tiers?: PricingTier[]; 
}

export interface TicketDefinition {
  id: string;
  ticketName: string;
  description?: string | null;
  ticketType: 'Paid' | 'Free';
  price: number | null;
  maxQuantity?: number | null;
  isSoldOut: boolean;
  isHidden: boolean;
  hasFinisherJersey: boolean;
  ticketCategory: 'Triathlon' | 'Duathlon' | 'Marathon' | 'Cycling' | 'Swimming' | 'Other';
  registrationType?: 'individual' | 'relay' | 'both'; // NEW: Specify which registration types this ticket supports
  applicableAgeGroups?: string[] | string | null;
  eventDate?: string | null;
  openDate?: string | null;
  startTime?: string | null; // HH:mm format (24-hour)
  closeDate?: string | null;
  endTime?: string | null; // HH:mm format (24-hour)
  hsnCode?: string | null;
  gstPercent?: number;
  tiers?: PricingTier[];
  subCategories?: SwimDistanceCategory[];
  order: number;
  cutoffs?: {
    mode: 'overall' | 'segment';
    overall?: string | null;
    swim?: string | null;
    bike?: string | null;
    run?: string | null;
    run1?: string | null;
    run2?: string | null;
  } | null;
  courseMaps?: { 
    swimGpxUrl?: string | null;
    bikeGpxUrl?: string | null;
    runGpxUrl?: string | null;
    run1GpxUrl?: string | null;
    run2GpxUrl?: string | null;
    swimDistance?: number | null;
    bikeDistance?: number | null;
    runDistance?: number | null;
    run1Distance?: number | null;
    run2Distance?: number | null;
    swimSplits?: { id: string; name: string; distance: number }[];
    bikeSplits?: { id: string; name: string; distance: number }[];
    runSplits?: { id: string; name: string; distance: number }[];
    run1Splits?: { id: string; name: string; distance: number }[];
    run2Splits?: { id: string; name: string; distance: number }[];
    swimDescription?: string | null;
    bikeDescription?: string | null;
    runDescription?: string | null;
    run1Description?: string | null;
    run2Description?: string | null;
    generatedPdfUrl?: string | null;
    generatedPdfName?: string | null;
    generatedPdfUpdatedAt?: string | null;
    generatedSportType?: 'swim' | 'bike' | 'run' | null;
  } | null;
  swimLoops?: number | null;
  bikeLoops?: number | null;
  runLoops?: number | null;
  swimCapColor?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventTicketStats {
  eventId: string;
  eventName: string;
  totalTicketsSoldInEvent: number;
  totalRevenueFromEventPaisa: number;
  tickets: TicketStatDetail[];
}

export interface TicketStatDetail {
  ticketDefinitionId: string;
  ticketName: string;
  sold: number;
  remaining: number | 'Unlimited';
  pricePaisa?: number | null;
  ticketType: 'Paid' | 'Free';
}

export interface BibAssignmentRule {
  id: string;
  ticketId: string;
  ageGroup: string;
  gender: 'Male' | 'Female' | 'Any';
  startBib: number;
  endBib: number;
  /** When true, this rule defines the BIB number range for relay teams.
   *  Relay BIBs are not age/gender grouped — each team gets a sequential number
   *  from the range and participants receive suffixed BIBs: 101S / 101B / 101R */
  isRelay?: boolean;
  selectedSubCategory?: string | null;
  createdAt?: string;
}
