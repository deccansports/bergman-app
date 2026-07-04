// src/lib/types/registration.ts
import type { ReminderInfo, PricingBreakdown } from './common';

// ============= RELAY TEAM TYPES =============

export type RelayRole = 'swim' | 'bike' | 'run';
export type RelaySharedLegs = 'SB' | 'SR' | 'BR';
export type RelayCompositionType = 'three_athletes' | 'two_athletes_one_double_leg';

export interface RelayConfiguration {
  type: RelayCompositionType;
  sharedLegs?: RelaySharedLegs;
}

export interface RelayTeamParticipant {
  role: RelayRole;
  name: string;
  email: string;
  mobile?: string;
  dob?: string;
  gender?: "Male" | "Female" | "Other";
  bloodGroup?: string;
  tshirtSize?: string;
  emergencyContactNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  idProofUrl?: string | null;
  bib?: string; // Individual bib: e.g., "R101-S" for swim
  bibNumber?: string;
  athleteUid?: string | null;
  // Timing fields
  finishTime?: number; // in seconds
  finishTimestamp?: string;
  status?: 'Pending' | 'In Progress' | 'Finished' | 'DNF' | 'DNS';
}

export interface RelayTeamRegistration {
  id: string; // Document ID in relayTeamRegistrations collection
  bookingId?: string;
  eventId: string;
  eventName: string;
  ticketId: string;
  ticketName: string;
  teamName: string;
  teamBib: string; // e.g., "R101"
  participants: [RelayTeamParticipant, RelayTeamParticipant, RelayTeamParticipant]; // Exactly 3 (swim, bike, run)
  relayConfiguration?: RelayConfiguration;
  createdByUid: string;
  createdByName: string;
  createdByEmail: string;
  clubId?: string | null;
  couponCode?: string | null;
  agreedRules?: boolean;
  agreedWaiver?: boolean;
  agreedCutoff?: boolean;
  consentPromotions?: boolean;
  amountPaidPaisa: number;
  pricingBreakdown?: PricingBreakdown;
  transactionId?: string | null;
  razorpayOrderId?: string | null;
  status: 'pending' | 'PaymentInitiated' | 'PaymentCaptured' | 'Payment Failed' | 'Completed' | 'RegistrationFailed' | 'In Progress' | 'DNF' | 'DNS';
  registrationAttemptId?: string | null;
  lastError?: string;
  remindersSent?: {
    email: ReminderInfo;
    whatsapp: ReminderInfo;
  };
  // Timing fields
  totalTime?: number; // in seconds, sum of all legs
  completedAt?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface RelayTeamRegistrationFormInput {
  eventId: string;
  ticketId: string;
  teamName: string;
  participants: [
    RelayTeamParticipant,
    RelayTeamParticipant,
    RelayTeamParticipant
  ];
  relayConfiguration?: RelayConfiguration;
  clubId?: string | null;
  couponCode?: string | null;
  agreedRules: boolean;
  agreedWaiver: boolean;
  agreedCutoff: boolean;
  consentPromotions: boolean;
}

// ============= STANDARD INDIVIDUAL TYPES =============

export interface RegistrationAttempt {
  id: string;
  eventId: string;
  eventName: string;
  ticketId: string;
  ticketName: string;
  userId?: string | null;
  athleteUid?: string | null; 
  name: string;
  email: string;
  mobile?: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  tshirtSize?: string;
  emergencyContactNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  clubId?: string | null;
  couponCode?: string | null;
  deferralId?: string | null;
  isDeferral?: boolean;
  amountPaidPaisa: number;
  pricingBreakdown?: PricingBreakdown;
  transactionId?: string | null;
  specificPaymentMethod?: string | null;
  razorpayOrderId?: string | null;
  participantId?: string | null;
  bookingId?: string | null;
  bibNumber?: string | null;
  status: 'pending' | 'Potential' | 'PaymentInitiated' | 'PaymentCaptured' | 'Payment Failed' | 'Completed' | 'RegistrationFailed';
  lastError?: string;
  manualRegistrationExists?: boolean;
  remindersSent?: {
    email: ReminderInfo;
    whatsapp: ReminderInfo;
  };
  updatedAt?: any;
  createdAt?: any;
  billingType?: 'personal' | 'business';
  businessName?: string;
  gstin?: string;
  businessAddress?: string;
  businessEmail?: string;
  businessMobile?: string;
  confirmGstDetails?: boolean;
  selectedSubCategory?: string | null;
  agreedRules?: boolean;
  agreedWaiver?: boolean;
  agreedCutoff?: boolean;
  agreedPolicyChangeFlow?: boolean;
  consentPromotions?: boolean;
  waitlistCode?: string | null;
  waitlistCodeId?: string | null;
  waitlistCodeEmail?: string | null;
  waitlistCodeEntryId?: string | null;
}

export interface PublicEventRegistrationFormInputClient {
  name: string;
  email: string;
  mobile: string;
  dob: string;
  gender: "Male" | "Female" | "Other";
  bloodGroup: string;
  tshirtSize: string;
  emergencyContactNumber: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  ticketId: string;
  selectedSubCategory?: string | null;
  consentPromotions: boolean;
  agreedRules: boolean;
  agreedWaiver: boolean;
  agreedCutoff: boolean;
  agreedPolicyChangeFlow?: boolean;
  billingType: 'personal' | 'business';
  businessName?: string | null;
  gstin?: string | null;
  businessAddress?: string | null;
  businessEmail?: string | null;
  businessMobile?: string | null;
  businessPrimaryContactName?: string | null;
  businessPrimaryContactEmail?: string | null;
  businessPrimaryContactMobile?: string | null;
  confirmGstDetails?: boolean | null;
  digitalSignatureName: string;
  clubId?: string | null;
  previousTimingCertificateUrl?: string | null;
  registrationType?: 'individual' | 'relay'; // NEW: specify individual or relay
  waitlistCode?: string | null;
  waitlistCodeId?: string | null;
  waitlistCodeEmail?: string | null;
  waitlistCodeEntryId?: string | null;
}

