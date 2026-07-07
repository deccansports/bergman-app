// src/lib/types/user.ts
import type { ActiveDeferralInfo } from './deferral';
import type { ActiveCancellationInfo } from './analytics';

export interface ClubHistoryEntry {
  clubId: string;
  clubName: string;
  joinedAt: string; // ISO date string
  leftAt?: string | null; // ISO date string, null if currently active
  isActive: boolean;
}

export interface User {
  id: string; 
  uid: string; 
  email: string | null;
  emailVerified?: boolean;
  name?: string | null;
  nameLower?: string;
  mobile?: string | null; 
  photoURL?: string | null;
  country?: string | null;
  state?: string | null;
  personalRaceEmail?: string | null;
  dob?: string | null; 
  gender?: string | null;
  tshirtSize?: string | null;
  bloodGroup?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  emergencyContactNumber?: string | null;
  idProofUrl?: string | null;
  liveTrackingPrivacy?: 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE' | null;
  trackingVisibility?: 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE' | null;
  upcomingEvents?: { eventId: string; eventName: string; eventDate?: string; bookingId?: string; registeredDate?: string; bibNumber?: string; ticketCategory?: string; raceCategory?: string }[];
  isBlacklisted?: boolean;
  blacklistReason?: string | null;
  blacklistedAt?: string | null;
  gstin?: string | null;
  businessName?: string | null;
  businessAddress?: string | null;
  businessCity?: string | null;
  businessState?: string | null;
  businessPincode?: string | null; 

  ownedClubId?: string | null;
  ownedClubName?: string | null;
  ownedClubLogoUrl?: string | null;
  ownedClubInstagramUrl?: string | null;
  ownedClubFacebookUrl?: string | null;

  clubId?: string | null;
  clubName?: string | null;
  clubAffiliationDate?: string | null;
  clubHistory?: ClubHistoryEntry[];

  activeDeferral?: ActiveDeferralInfo | null;
  activeCancellation?: ActiveCancellationInfo | null;

  createdAt?: any; 
  updatedAt?: any; 
  isAdmin?: boolean;
  adminAccessMode?: "view" | "edit" | null;
  isVolunteer?: boolean;
  volunteerActive?: boolean;
  assignedEventId?: string | null;
  assignedEventName?: string | null;
  assignedEventDate?: string | null;
  assignedCounter?: string[] | null;
  zohoCustomerId?: string | null;
  role?: "athlete" | "club" | "volunteer" | "admin";
}

export type UserProfileUpdateData = Partial<User>;

export interface PublicUserProfileData extends Partial<User> {
  uid: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  keyHash: string;
  createdAt: string;
  lastUsed?: string | null;
}
