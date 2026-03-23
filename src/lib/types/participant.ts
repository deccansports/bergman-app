// src/lib/types/participant.ts
import type { ReminderInfo, PricingBreakdown } from './common';
import type { User } from './user';

export interface ParticipantCSVRow {
  [key: string]: any;
}

export interface EventParticipant {
  id: string;
  bookingId?: string | null;
  eventId?: string;
  eventName?: string;
  organizerName?: string | null; 
  organizerAddress?: string | null; 
  organizerCompanyDescription?: string | null; 
  eventDate?: string | null;
  athleteUid?: string | null; 
  name: string;
  nameLower?: string;
  email: string | null;
  buyerEmail?: string | null;
  buyerName?: string | null;
  mobile?: string | null; 
  gender?: string | null;
  bibNumber?: string | null;
  raceCategory?: string | null;
  registeredAt?: string | null;
  updatedAt?: string | null; 
  createdAt?: string | null;
  startTime?: string | null;
  checkInStatus?: 'Pending' | 'CheckedIn';
  checkedInAt?: string | null;
  checkedInByVolunteerId?: string | null;
  checkedInByVolunteerName?: string | null;
  checkInCounter?: string | null;
  checkInDetails?: {
    remarks?: string | null;
    handedOverTo?: {
      name: string;
      mobile: string;
    } | null;
  } | null;
  bikeCheckInStatus?: 'Pending' | 'CheckedIn';
  bikeCheckedInAt?: string | null;
  bikeCheckOutStatus?: 'Pending' | 'CheckedOut';
  bikeCheckedOutAt?: string | null;
  bikeCheckInDetails?: {
    remarks?: string | null;
    helmetChecked?: boolean;
    pumpChecked?: boolean;
  } | null;
  bikeCheckedOutManuallyBy?: { 
    uid: string;
    name: string;
  } | null;
  bikeCheckedOutManuallyTo?: {
    name: string;
    mobile: string;
  } | null;
  lockerNumber?: string | null; 
  lockerReturnedAt?: string | null; 
  transactionId?: string | null;
  amountPaidPaisa?: number | null;
  originalAmountPaidAtFirstRegistrationPaisa?: number | null;
  basePricePaisa?: number | null;
  taxAmountPaidPaisa?: number | null;
  processingFeePaidPaisa?: number | null;
  platformFeePaidPaisa?: number | null;
  ticketPrice?: number | null;
  ticketStatus?: 'Active' | 'Inactive' | 'Refunded' | 'Deferred' | 'Cancelled' | 'Confirmed' | 'Pending' | null;
  ticketName?: string | null;
  ticketId?: string | null;
  dob?: string | null;
  bloodGroup?: string | null;
  tshirtSize?: string | null;
  emergencyContactNumber?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  state?: string | null;
  country?: string | null;
  idProofUrl?: string | null;
  consentPromotions?: boolean;
  agreedRules?: boolean;
  agreedWaiver?: boolean;
  agreedCutoff?: boolean;
  previousTimingCertificateUrl?: string | null;
  digitalSignatureName?: string | null;
  personalRaceEmail?: string | null;
  clubAffiliationDate?: string | null;
  registrationAttemptId?: string | null;
  previousDeferralDetails?: { 
    originalEventName: string; 
    originalParticipantId?: string; 
    originalTicketName?: string; 
    originalEventDate?: string;
    estimatedOriginalBasePricePaisa?: number;
  } | null;
  cancellationDetails?: {
    cancelledBy: 'Admin' | 'User';
    cancellationDate: string; 
    reason?: string | null;
  } | null;
  gstPaid?: 'Yes' | 'No' | null;
  isDeferredFromPune?: 'Yes' | 'No' | null;
  clubId?: string | null;
  clubName?: string | null;
  age?: number | null;
  ageCategory?: string | null;
  paymentId?: string;
  paymentMethod?: string | null;
  balanceAmount?: number | null;
  couponCode?: string | null;
  couponDiscountPaisa?: number | null;
  deferralCreditPaisa?: number | null;
  invoiceId?: string | null; 
  invoiceNumber?: string | null; 
  zohoSynced?: boolean; 
  zohoSyncError?: string | null;
  notificationsSent?: { email: ReminderInfo; whatsapp: ReminderInfo; bikeRackAssignment?: ReminderInfo; bikeCheckoutReminder?: ReminderInfo; } | null;
  medalIssued?: boolean;
  finisherJerseyIssued?: boolean;
  isEligibleForFinisherJersey?: boolean;
  foodIssued?: boolean; 
  breakfastIssued?: boolean;
  lunchIssued?: boolean;
  status?: string | null;
  registrationStatus?: string | null;
  swimLoopsCompleted?: number;
  bikeLoopsCompleted?: number;
  runLoopsCompleted?: number;
  isDeferral?: boolean;
  deferralId?: string | null;
  pricingBreakdown?: PricingBreakdown;
  selectedSubCategory?: string | null; 
  billingType?: 'personal' | 'business' | null;
  businessName?: string | null;
  gstin?: string | null;
  businessAddress?: string | null;
  businessEmail?: string | null;
  businessMobile?: string | null;
  confirmGstDetails?: boolean | null;
  userProfile?: User | null;
  originalTicketName?: string | null;
  upgradeAmountPaid?: number;
  upgradePaymentId?: string | null;
}

export interface ParticipantWithProfile extends EventParticipant {
    userProfile?: User | null;
}

export interface AthleteRegisteredEventDetail {
  id: string;
  participantId: string;
  eventId: string;
  bookingId?: string | null;
  invoiceNumber?: string | null;
  athleteName?: string | null;
  athleteBibNumber?: string | null;
  athleteRaceCategory?: string | null;
  gender?: string | null;
  dob?: string | null;
  ticketName?: string | null;
  ticketId?: string | null;
  selectedSubCategory?: string | null;
  basePricePaisa?: number | null;
  couponDiscountPaisa?: number | null; 
  ticketStatus?: 'Active' | 'Inactive' | 'Refunded' | 'Deferred' | 'Cancelled' | 'Confirmed' | 'Pending' | null;
  amountPaidPaisa?: number | null;
  originalAmountPaidAtFirstRegistrationPaisa?: number | null;
  taxAmountPaidPaisa?: number | null;
  processingFeePaidPaisa?: number | null;
  platformFeePaidPaisa?: number | null;
  gstPaid?: 'Yes' | 'No' | null;
  registeredAt?: string | null;
  pricingBreakdown?: PricingBreakdown;
  eventName: string;
  eventDate: string | null;
  startTime?: string | null;
  currency?: string;
  canBeDeferred?: boolean;
  canBeCancelled?: boolean;
  canBeTransferred?: boolean;
  canChangeCategory?: boolean;
  ticketDefinitions?: any[];
  previousDeferralDetails?: any;
  customSlug?: string | null;
}