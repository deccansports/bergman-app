// src/lib/types/event.ts
import type { TicketDefinition } from './ticket';

export interface Sponsor {
  id: string;
  name: string;
  logoUrl: string;
  website?: string | null;
  type?: string; 
  order: number;
  createdAt: string;
  updatedAt?: string;
  eventId: string;
}

export interface ContentBlock {
  id: string;
  html: string;
}

export interface EventStats {
    totalParticipants: number;
    activeParticipants: number;
    cancelledParticipants: number;
    ticketBreakdown: { [ticketName: string]: number };
    totalRevenuePaisa: number;
    totalGSTPaisa: number;
    deferralCount: number;
    foodRevenuePaisa: number;
}

export interface EventCalendarEntry {
  id: string;
  eventName: string;
  eventDate: string | null;
  displayDateRange?: string; 
  disciplineSchedule?: { 
    date: string;
    disciplines: string[];
  }[];
  isRaceWeekend?: boolean; 
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  isHidden?: boolean;
  isSoldOut?: boolean;
  showLiveTrackingOnHomepage?: boolean; 
  liveDataSource?: 'none' | 'participants' | 'timing_partner' | 'race_results' | 'racemap'; 
  liveTimingConfig?: LiveTimingConfig | null;
  timingPartner?: {
    provider: 'wiclax' | 'racemap' | 'other';
    eventId: string;
    apiToken?: string;
    apiVersion: string;
    timezone: string;
    lastSyncAt?: number; 
  } | null;
  venueName?: string | null;
  address?: string | null;
  country?: string | null;
  state?: string | null;
  venueDetails?: string | null;
  googleMapsUrl?: string | null;
  nearestAirport?: {
    name?: string;
    url?: string;
  } | null;
  description?: string | null;
  photoUrl?: string | null;
  registrationUrl?: string | null;
  customSlug?: string | null;
  currency?: 'INR' | 'USD' | string;
  organizerName?: string | null;
  organizerAddress?: string | null;
  organizerCompanyDescription?: string | null;
  courseDetails?: {
    swim?: string;
    bike?: string;
    run?: string;
  } | null;
  ageCategories?: string[];
  participants?: Array<{
    ticketId?: string;
    ticketName?: string;
    selectedSubCategory?: string | null;
  }>;
  ticketDefinitions?: TicketDefinition[];
  createdAt?: string;
  mode?: 'Offline' | 'Virtual' | 'Hybrid' | null;
  cutoffs?: any; 
  blocks?: ContentBlock[];
  athleteGuideBookUrl?: string | null; 
  sponsors?: Sponsor[];
  customRules?: string | null;
  stats?: EventStats | null;
  isRaceWeekendHeader?: boolean;
  foodPurchaseSlug?: string | null;
}

export interface BackupRecord {
  id: string;
  eventId: string;
  eventName: string;
  createdAt: string;
  participantCount: number;
  participantsData?: string | null;
  eventDocument?: string | null;
  ticketDefinitionsData?: string | null;
  bibAssignmentsData?: string | null;
  sponsorsData?: string | null;
  inventoryData?: string | null;
}

export interface EventInventory {
  id: string;
  tshirts?: Record<string, { initial: number; issued: number }>;
  medals?: Record<string, { initial: number; issued: number }>;
  trophies?: Record<string, { initial: number; issued: number }>;
  finisherJerseys?: Record<string, { initial: number; issued: number }>;
  swimCaps?: Record<string, { initial: number; issued: number }>;
  bags?: { initial: number; issued: number };
  waterStationConfig?: any;
  updatedAt?: string;
}

export type InventoryItemType = 'T-Shirt' | 'Finisher Jersey' | 'Medal' | 'Trophy' | 'Swim Cap' | 'Bag' | 'Food' | 'Breakfast' | 'Lunch';

export interface LiveTimingConfig {
  apiUrl?: string;
  apiKey?: string;
  jsonMapping?: string;
}

export interface CategoryChangeLogEntry {
  id: string;
  eventId: string;
  eventName: string;
  participantId: string;
  participantName: string;
  participantEmail: string;
  fromTicketName: string;
  toTicketName: string;
  fromBibNumber: string | null;
  toBibNumber: string | null;
  paymentId: string | null;
  changedAt: string;
  invoiceNumber: string | null;
}

export interface AidStationConfig {
  bikeStations: number;
  runStations: number;
  venueStations: number;
}

export interface CustomItem {
  id: string;
  name: string;
  unit: string;
  type: 'consumable' | 'fixed';
  consumptionType?: 'perHour' | 'perAthlete';
  consumptionRate?: number;
  quantityPerStation?: number;
  perStation?: number;
  total?: number;
}
