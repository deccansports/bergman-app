// Workers Database Types
export interface Worker {
  id: string;
  timestamp: Date;
  fullName: string;
  email: string;
  dob?: string;
  age?: number;
  whatsappNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  gender?: 'Male' | 'Female' | 'Other' | 'Prefer not to say';
  tshirtSize?: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
  occupation?: string;
  languages?: string[]; // e.g., ['English', 'Hindi', 'Marathi']
  isTriathlete?: boolean;
  sportsParticipated?: string[];
  yearsExperience?: number;
  eventExperience?: string; // Description of event experience
  leadershipExperience?: string;
  previousOrganizers?: string[];
  travelAvailability?: 'Local' | 'Regional' | 'National' | 'International';
  vehicleTypes?: string[]; // e.g., ['Car', 'Bike', '4x4']
  availabilityPerYear?: number; // e.g., 10 events per year
  weekendAvailability?: boolean;
  certifications?: string[];
  skills?: string[];
  declaration?: boolean; // I agree to terms
  
  // Internal Fields (auto-generated)
  workerId: string; // Unique identifier
  status: 'Active' | 'Inactive' | 'Blacklisted';
  rating?: number; // 1-5 star rating
  eventsWorked?: number;
  totalPaid?: number;
  paymentPending?: number;
  
  // Financial Details
  bankAccountName?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  upiId?: string;
  panNumber?: string;
  
  notes?: string;
  idCardUrl?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date;
  syncedFromGoogleSheet?: boolean;
  isRecruitmentApproved?: boolean;
  recruitmentApprovedAt?: Date;
}

// Open Roles Types
export interface OpenRole {
  id: string;
  eventId: string;
  eventName: string;
  roleName: string;
  roleDescription: string;
  category: string;
  numberRequired: number;
  paymentAmount: number;
  reportingDate?: Date;
  reportingInstructions?: string;
  reportingManager?: string;
  reportingManagerId?: string;
  startDate: Date;
  endDate: Date;
  requiredSkills?: string[];
  travelRequired?: boolean;
  accommodationIncluded?: boolean;
  mealsIncluded?: boolean;
  isActive: boolean;
  
  // Vacancy tracking
  numberAssigned?: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// Applications Types
export interface Application {
  id: string;
  workerId?: string;
  email: string;
  fullName: string;

  selectedEvent?: {
    eventId: string;
    eventName: string;
    eventDate?: string;
  };
  
  // Application Details
  personalDetails: {
    dob?: string;
    phone?: string;
    alternatePhone?: string;
    address?: string;
    pincode?: string;
    city?: string;
    state?: string;
  };
  
  experience: {
    yearsInSports?: number;
    eventExperience?: string;
    leadershipExperience?: string;
  };
  
  skills?: string[];
  travelAvailability?: string;
  certifications?: string[];
  documents?: DocumentReference[];
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    ifscCode?: string;
    upiId?: string;
  };
  
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  };
  
  rolePreferences?: string[]; // roleIds
  rolePreferenceDetails?: Array<{
    roleId: string;
    roleName?: string;
    preferenceOrder: 1 | 2 | 3;
    paymentAmount?: number;
  }>;
  eventPreferences?: string[]; // eventIds
  eventAvailabilityOptions?: string[];
  logistics?: {
    canTravel?: boolean;
    needAccommodation?: boolean;
    needLocalTransport?: boolean;
  };
  agreements?: {
    freelance?: boolean;
    duties?: boolean;
    reporting?: boolean;
    travelReimbursementPolicyAccepted?: boolean;
    accommodationPolicyAccepted?: boolean;
  };
  
  status: 'Submitted' | 'Under Review' | 'Approved' | 'Assigned' | 'Completed' | 'Rejected';
  assignmentDeletedAt?: Date;
  assignmentDeletedReason?: string;
  
  // Metadata
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Worker Assignment Types
export interface WorkerAssignment {
  id: string;
  sourceApplicationId?: string;
  workerId: string;
  workerName: string;
  workerEmail: string;
  roleId: string;
  roleName: string;
  eventId: string;
  eventName: string;
  
  assignmentDate: Date;
  startDate: Date;
  endDate: Date;
  
  status: 'Pending' | 'Confirmed' | 'Declined' | 'Completed' | 'Cancelled';
  assignedBy?: string;
  confirmedAt?: Date;
  declinedAt?: Date;
  
  paymentAmount?: number;
  paymentStatus?: 'Pending' | 'Approved' | 'Paid' | 'Cancelled';
  
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Payment Types
export interface Payment {
  id: string;
  workerId: string;
  workerName: string;
  workerEmail: string;
  
  assignmentId?: string;
  roleId: string;
  roleName: string;
  eventId: string;
  eventName: string;
  
  amount: number;
  honorarium?: number;
  travelReimbursement?: number;
  totalAmount?: number;
  paymentMethod: 'Bank Transfer' | 'UPI' | 'Cash';
  status: 'Pending' | 'Approved' | 'Paid' | 'Cancelled';
  
  // Transaction Details
  transactionId?: string;
  paidDate?: Date;
  approvedDate?: Date;
  paymentDate?: Date;
  
  bankDetails?: {
    accountName: string;
    bankName?: string;
    accountNumber: string;
    ifscCode: string;
  };
    panNumber?: string;
    saveForFuture?: boolean;
  upiId?: string;
  
  notes?: string;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Communication Types
export interface Communication {
  id: string;
  type: 'Email' | 'WhatsApp';
  
  // Recipients
  recipientIds?: string[]; // workerIds for bulk
  recipientEmail?: string; // individual
  recipientPhone?: string; // WhatsApp
  
  // Message
  templateId?: string;
  templateName?: string;
  subject?: string; // Email only
  body: string;
  
  // Targeting
  target: 'All Workers' | 'Event Workers' | 'Specific City' | 'Specific Role' | 'Selected Workers' | 'Accepted Workers' | 'Individual';
  eventId?: string;
  roleId?: string;
  city?: string;
  
  // Status
  status: 'Draft' | 'Scheduled' | 'Sent' | 'Failed' | 'Partial';
  sentCount?: number;
  failedCount?: number;
  
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Certification Types
export interface Certification {
  id: string;
  workerId: string;
  name: string; // e.g., 'CPR', 'First Aid', 'Lifeguard'
  issuingBody?: string;
  issueDate?: Date;
  expiryDate?: Date;
  certificateNumber?: string;
  documentId?: string;
  
  isExpired: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

// Document Types
export interface DocumentReference {
  id: string;
  workerId: string;
  type: 'Aadhaar' | 'PAN' | 'Passport' | 'Driver License' | 'Other';
  documentName: string;
  documentUrl: string; // Firebase Storage URL
  uploadedAt: Date;
  expiryDate?: Date;
  notes?: string;
}

// Communication Template Types
export interface CommunicationTemplate {
  id: string;
  name: string;
  type: 'Email' | 'WhatsApp';
  subject?: string; // Email only
  body: string;
  variables?: string[]; // e.g., ['workerName', 'roleName', 'eventName']
  category: 'Role Assignment' | 'Event Invitation' | 'Payment Confirmation' | 'Welcome' | 'Event Briefing' | 'Thank You' | 'Other';
  
  createdAt: Date;
  updatedAt: Date;
}

// Settings Types
export interface WorkBergmanSettings {
  id: string;
  
  // Google Sheet Integration
  googleSheetUrl?: string;
  googleSheetSyncEnabled?: boolean;
  autoSyncInterval?: number; // in minutes, default 60
  
  // API Keys
  bergTechnoApiKey?: string;
  aiSensyApiKey?: string;
  
  // Public Recruitment
  publicCareersUrl?: string;
  autoApprovalEnabled?: boolean;
  requiredDocuments?: string[];
  
  // Role-based Permissions
  permissions: Record<string, string[]>; // roleId -> [permission1, permission2]
  
  updatedAt: Date;
}

// Analytics/Reports Types
export interface StaffingReport {
  eventId: string;
  eventName: string;
  totalRoles: number;
  totalPositions: number;
  filledPositions: number;
  vacantPositions: number;
  percentageFilled: number;
  roleBreakdown: {
    roleId: string;
    roleName: string;
    required: number;
    assigned: number;
  }[];
}

export interface PaymentReport {
  totalAmountPaid: number;
  totalAmountPending: number;
  totalAmountApproved: number;
  transactionCount: number;
  averagePayment: number;
  
  byWorker?: {
    workerId: string;
    workerName: string;
    totalEarned: number;
    totalPending: number;
  }[];
  
  byEvent?: {
    eventId: string;
    eventName: string;
    totalPaid: number;
    totalPending: number;
  }[];
  
  byRole?: {
    roleId: string;
    roleName: string;
    totalPaid: number;
    totalPending: number;
  }[];
}

// Dashboard Card Types
export interface WorkBergmanDashboard {
  totalWorkers: number;
  activeWorkers: number;
  pendingApplications: number;
  openRoles: number;
  filledRoles: number;
  upcomingEvents: number;
  totalPaymentsDue: number;
  totalPaymentsPaid: number;
  
  recentActivity: ActivityLog[];
}

export interface ActivityLog {
  id: string;
  type: 'Application' | 'Assignment' | 'Payment' | 'Email' | 'WhatsApp';
  title: string;
  description: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}
