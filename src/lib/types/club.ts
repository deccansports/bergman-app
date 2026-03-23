
// src/lib/types/club.ts

export interface Club {
  id: string;
  name: string;
  coach_name: string;
  email: string;
  mobile?: string | null;
  ownerUid: string;
  ownerEmail?: string;
  ownerMobile?: string;
  logoUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  createdAt?: string | null; 
  updatedAt?: string | null; 
  encouragementEmailsSent?: { month: string; count: number };
}

export interface ClubRankingEntry {
  clubId: string;
  clubName: string;
  coachName?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  logoUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  ownerEmail?: string | null;
  email?: string | null;
  mobile?: string | null;
  ownerUid?: string | null;
  ownerMobile?: string | null;
  totalPoints: number;
  athleteCount: number;
  eventCount: number;
  overallRank?: number;
  contributingAthleteDetails?: ClubAthleteContribution[];
}

export interface ClubAthleteContribution {
  athleteUid: string;
  athleteName: string;
  pointsContributed: number;
  racesFinished: number;
  email?: string;
  photoURL?: string | null;
  clubRank?: number;
  status?: 'active' | 'inactive';
  upcomingRacesCount?: number;
}

export interface ClubMemberPerformanceForAdmin {
  uid: string;
  name: string | null;
  email: string | null;
  pointsEarnedForSelectedYear: number;
  racesFinishedInSelectedYear: number;
  clubRankForSelectedYear?: number;
  clubAffiliationDate?: string | null;
}

export interface ClubDashboardData {
    club: Club;
    totalPoints: number;
    globalRank?: number;
    countryRank?: number;
    athleteCount: number;
    eventCount: number;
    podiums: { gold: number; silver: number; bronze: number };
    upcomingRacesCount: number;
    monthlyPerformance: { month: string; points: number }[];
    eventPerformance: { eventName: string; points: number; podiums: number; athletes: number }[];
    topContributors: ClubAthleteContribution[];
    bestPerformer: ClubAthleteContribution | null;
    upcomingRegistrations: ClubDashboardUpcomingRegistration[];
    members: ClubAthleteContribution[]; 
    emailStats: { sentThisMonth: number; remaining: number; totalLimit: number };
}

export interface ClubDashboardUpcomingRegistration {
    athleteName: string;
    eventName: string;
    eventDate: string | null;
    ticketName: string;
    athleteBibNumber?: string | null; 
    bookingId?: string | null;
    athleteUid?: string | null;
}

export interface RegisterClubExistingUserInput {
  clubName: string;
  clubContactEmail: string;
  clubContactMobile: string;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  country: string;
  city: string;
  state: string;
}
