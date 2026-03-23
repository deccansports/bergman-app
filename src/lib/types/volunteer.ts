// src/lib/types/volunteer.ts

export interface VolunteerStats {
  totalVolunteers: number;
  volunteersAssignedToAnyEvent: number;
  volunteersCurrentlyUnassigned: number;
}

export interface BankDetails {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  registeredMobileNumber?: string | null;
}

export interface CustomSplitPoint {
  id: string;
  name: string;
  distance: number; // in km
}

export interface BikeRackAssignment {
  id: string;
  rackName: string;
  bibFrom: number;
  bibTo: number;
  createdAt?: string;
  updatedAt?: string;
}
