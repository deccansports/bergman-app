// src/lib/schemas.ts
import { z } from 'zod';
import { internationalMobileRegex } from './utils';

// --- Shared Components ---
export const BankDetailsSchema = z.object({
  accountHolderName: z.string().min(2, "Account holder name is required."),
  accountNumber: z.string().min(5, "Valid account number is required."),
  ifscCode: z.string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code format (e.g., SBIN0001234).")
    .length(11, "IFSC code must be 11 characters."),
  bankName: z.string().min(2, "Bank name is required."),
  registeredMobileNumber: z.string().regex(internationalMobileRegex, "Invalid mobile format.").optional().or(z.literal('')).nullable(),
});

// --- User & Athlete ---
export const CreateUserSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email"),
  mobile: z.string().regex(internationalMobileRegex, "Invalid mobile format").optional().nullable(),
});
export type CreateUserFormInput = z.infer<typeof CreateUserSchema>;

export const AthleteSignupSchemaBase = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  email: z.string().email({ message: 'Invalid email address.' }),
  mobile: z.string().min(7, { message: "Mobile must be at least 7 digits."}).regex(/^\d+$/, "Mobile number must contain only digits."),
  country: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
});
export type AthleteSignupFormInput = z.infer<typeof AthleteSignupSchemaBase>;

// --- Club Management ---
export const ClubUpdateSchema = z.object({
  name: z.string().min(2, "Club name is required"),
  coach_name: z.string().min(2, "Coach name is required"),
  email: z.string().email("Invalid email"),
  mobile: z.string().min(10, "Mobile is required"),
  country: z.string().min(2, "Country is required"),
  city: z.string().optional(),
  state: z.string().optional(),
});
export type ClubUpdateFormInput = z.infer<typeof ClubUpdateSchema>;

export const ClubSocialLinksUpdateSchema = z.object({
  clubId: z.string(),
  ownerUid: z.string(),
  instagramUrl: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
  facebookUrl: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
  country: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});
export type ClubSocialLinksUpdateActionInput = z.infer<typeof ClubSocialLinksUpdateSchema>;

export const RegisterClubExistingUserSchema = z.object({
  clubName: z.string().min(3, "Club name is too short"),
  coachName: z.string().min(2, "Coach / Owner name is required"),
  clubContactEmail: z.string().email("Invalid email"),
  clubContactMobile: z.string().min(10, "Invalid mobile number"),
  instagramUrl: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
  facebookUrl: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
  country: z.string().min(2, "Country required"),
  city: z.string().min(2, "City required"),
  state: z.string().optional().nullable(),
});

// --- Registration & Events ---
const PublicEventRegistrationSchemaBase = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
  mobile: z.string().min(10, 'Mobile is required'),
  dob: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['Male', 'Female', 'Other']),
  bloodGroup: z.string().min(1, 'Blood group is required'),
  tshirtSize: z.string().min(1, 'T-shirt size is required'),
  emergencyContactNumber: z.string().min(10, 'Emergency contact is required'),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().optional().nullable(),
  pincode: z.string().min(6, 'Pincode is required'),
  country: z.string().min(2, 'Country is required'),
  ticketId: z.string().min(1, 'Please select a ticket'),
  selectedSubCategory: z.string().optional().nullable(),
  consentPromotions: z.boolean().default(false),
  agreedRules: z.boolean().refine(v => v === true, 'You must agree to the rules'),
  agreedWaiver: z.boolean().refine(v => v === true, 'You must agree to the waiver'),
  agreedCutoff: z.boolean().refine(v => v === true, 'You must accept cut-offs'),
  billingType: z.enum(['personal', 'business']).default('personal'),
  businessName: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  businessAddress: z.string().optional().nullable(),
  businessEmail: z.string().optional().nullable(),
  businessMobile: z.string().optional().nullable(),
  businessPrimaryContactName: z.string().optional().nullable(),
  businessPrimaryContactEmail: z.string().optional().nullable(),
  businessPrimaryContactMobile: z.string().optional().nullable(),
  confirmGstDetails: z.boolean().optional().nullable(),
  digitalSignatureName: z.string().min(2, 'Signature required'),
  clubId: z.string().optional().nullable(),
  previousTimingCertificateUrl: z.string().optional().nullable(),
});

export const PublicEventRegistrationSchema = PublicEventRegistrationSchemaBase.superRefine((data, ctx) => {
  const normalizedCountry = (data.country || '').trim().toLowerCase();
  const normalizedState = (data.state || '').trim();

  if (normalizedCountry === 'india' && normalizedState.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['state'],
      message: 'State is required for India',
    });
  }
});

export type PublicEventRegistrationFormInputClient = z.infer<typeof PublicEventRegistrationSchema>;

// --- Admin & Support ---
export const ContactUsSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email"),
  mobile: z.string().regex(internationalMobileRegex, "Invalid mobile format"),
  about: z.enum(['Registration', 'General Enquiry', 'About Event'], { message: 'Please select a query type' }),
  selectedEventId: z.string().optional().nullable(),
  selectedEventName: z.string().optional().nullable(),
  message: z.string().min(10, "Message must be at least 10 characters"),
}).superRefine((data, ctx) => {
  if ((data.about === 'Registration' || data.about === 'About Event') && !String(data.selectedEventId || '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['selectedEventId'],
      message: 'Please select an upcoming event',
    });
  }
});
export type ContactUsFormInput = z.infer<typeof ContactUsSchema>;

const OptionalNullableOrEmptyString = z.string().optional().nullable().or(z.literal(''));

export const AdminParticipantEditSchema = PublicEventRegistrationSchemaBase.partial().extend({
    name: OptionalNullableOrEmptyString,
    email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
    mobile: OptionalNullableOrEmptyString,
    dob: OptionalNullableOrEmptyString,
    gender: z.enum(['Male', 'Female', 'Other']).optional().nullable(),
    bloodGroup: OptionalNullableOrEmptyString,
    tshirtSize: OptionalNullableOrEmptyString,
    emergencyContactNumber: OptionalNullableOrEmptyString,
    address: OptionalNullableOrEmptyString,
    city: OptionalNullableOrEmptyString,
    state: OptionalNullableOrEmptyString,
    pincode: OptionalNullableOrEmptyString,
    country: OptionalNullableOrEmptyString,
    ticketId: OptionalNullableOrEmptyString,
    selectedSubCategory: OptionalNullableOrEmptyString,
    billingType: z.enum(['personal', 'business']).optional().nullable(),
    businessName: OptionalNullableOrEmptyString,
    gstin: OptionalNullableOrEmptyString,
    businessAddress: OptionalNullableOrEmptyString,
    businessEmail: OptionalNullableOrEmptyString,
    businessMobile: OptionalNullableOrEmptyString,
    confirmGstDetails: z.boolean().optional().nullable(),
    clubId: OptionalNullableOrEmptyString,
    bibNumber: z.string().optional().nullable(),
    ticketStatus: z.string().optional().nullable(),
    amountPaidPaisa: z.number().optional().nullable(),
    taxAmountPaidPaisa: z.number().optional().nullable(),
    processingFeePaidPaisa: z.number().optional().nullable(),
    platformFeePaidPaisa: z.number().optional().nullable(),
    gstPaid: z.enum(['Yes', 'No']).optional().nullable(),
    isDeferredFromPune: z.enum(['Yes', 'No']).optional().nullable(),
    sendConfirmation: z.boolean().optional().nullable(),
    clubAffiliationDate: z.string().optional().nullable(),
    personalRaceEmail: z.string().optional().nullable(),
    ageCategory: z.string().optional().nullable(),
});
export type AdminParticipantEditFormInput = z.infer<typeof AdminParticipantEditSchema>;

export const AdminRaceResultEditSchema = z.object({
    name: z.string().optional().nullable(),
    bibNumber: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    raceCategory: z.string().optional().nullable(),
    eventCategory: z.enum(['TRIATHLON', 'DUATHLON', 'OTHER', 'SWIMMING']).optional().nullable(),
    oRank: z.string().optional().nullable(),
    gRank: z.string().optional().nullable(),
    cRank: z.string().optional().nullable(),
    chipTime: z.string().optional().nullable(),
    swim: z.string().optional().nullable(),
    bike: z.string().optional().nullable(),
    run: z.string().optional().nullable(),
    run1: z.string().optional().nullable(),
    run2: z.string().optional().nullable(),
    t1: z.string().optional().nullable(),
    t2: z.string().optional().nullable(),
});
export type AdminRaceResultEditFormInput = z.infer<typeof AdminRaceResultEditSchema>;

export const AdminInitiateRefundSchema = z.object({
  refundInitiatedDate: z.date(),
  refundTransactionId: z.string().min(5, "Transaction ID required"),
  adminNotes: z.string().optional().nullable(),
});
export type AdminInitiateRefundFormInput = z.infer<typeof AdminInitiateRefundSchema>;

export const AdminManualDeferralCreateSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  originalEventId: z.string(),
  originalAmountPaidPaisa: z.number().int(),
  estimatedOriginalBasePricePaisa: z.number().int(),
  deferralDate: z.date(),
  expiryDate: z.date(),
  adminNotes: z.string().optional().nullable(),
});
export type AdminManualDeferralCreateFormInput = z.infer<typeof AdminManualDeferralCreateSchema>;

export const AdminDeferralEditSchema = z.object({
  participantName: z.string().optional(),
  participantEmail: z.string().email().optional(),
  status: z.string().optional(),
  expiryDate: z.date().optional(),
  estimatedOriginalBasePricePaisa: z.number().int().optional(),
  originalAmountPaidPaisa: z.number().int().optional(),
  adminNotes: z.string().optional().nullable(),
  deferredToEventId: z.string().optional(),
  deferredToTicketId: z.string().optional(),
});
export type AdminDeferralEditFormInput = z.infer<typeof AdminDeferralEditSchema>;

// --- Marketing & Communication ---
export const AnnouncementSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.enum(['global', 'athlete', 'club']),
  priority: z.enum(['low', 'medium', 'high']),
  isTicker: z.boolean(),
  tickerSpeedSeconds: z.coerce.number().min(5).max(40).optional().nullable(),
  isModal: z.boolean(),
  linkUrl: z.string().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  isActive: z.boolean(),
  targetEventId: z.string().optional().nullable(),
});
export type AnnouncementFormInput = z.infer<typeof AnnouncementSchema>;

export const WhatsAppCampaignSchema = z.object({
  targetType: z.enum(['all_athletes', 'club_owners', 'event']),
  campaignName: z.string().min(1),
  templateName: z.string().min(1),
  templateParams: z.array(z.object({ value: z.string() })),
  mediaUrl: z.string().optional().nullable(),
  mediaFilename: z.string().optional().nullable(),
  eventId: z.string().optional().nullable(),
  ticketIds: z.array(z.string()).optional().nullable(),
  statusFilter: z.array(z.string()).optional(),
  excludeRegistered: z.boolean().default(false),
  scheduledAt: z.string().optional().nullable(),
  throttling: z.object({
    rate: z.number(),
    intervalSeconds: z.number(),
  }),
});
export type WhatsAppCampaignFormInput = z.infer<typeof WhatsAppCampaignSchema>;

export const CreateVolunteerUserActionSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email"),
  mobile: z.string().min(10, "Mobile is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  assignedEventId: z.string().optional().nullable(),
  assignedCounter: z.array(z.string()).optional().nullable(),
});
export type CreateVolunteerUserActionInput = z.infer<typeof CreateVolunteerUserActionSchema>;

export const VolunteerAssignmentSchema = z.object({
    userId: z.string(),
    isVolunteer: z.boolean(),
    assignedEventId: z.string().optional().nullable(),
    assignedCounter: z.array(z.string()).optional(),
});
export type VolunteerAssignmentFormInput = z.infer<typeof VolunteerAssignmentSchema>;

export const CouponCreateSchema = z.object({
  code: z.string().min(1),
  couponType: z.enum(['Discount Code', 'Group Discount', 'Access Code', 'Early Bird / Sale', 'Club Coupon', 'Previous Participant', 'Feedback Coupon', 'Birthday Coupon']),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.number().min(0),
  usageLimit: z.number().min(1),
  startDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  isActive: z.boolean(),
  applicableEventIds: z.array(z.string()),
  sourceEventIds: z.array(z.string()),
  applicableTicketIds: z.array(z.string()),
  applicableClubIds: z.array(z.string()).optional().default([]),
  minCartValue: z.number().optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable(),
});
export type CouponCreateFormInput = z.infer<typeof CouponCreateSchema>;
export const CouponUpdateSchema = CouponCreateSchema.partial();
export type CouponUpdateFormInput = z.infer<typeof CouponUpdateSchema>;

export const TicketDefinitionSchema = z.object({
  ticketName: z.string().min(1, "Name required"),
  description: z.string().optional().nullable(),
  registrationType: z.enum(["individual", "relay", "both"]).default("individual"),
  eventDate: z.string().optional().nullable(),
  openDate: z.string().min(1, "Open date required"),
  startTime: z.string().optional().nullable(),
  closeDate: z.string().min(1, "Close date required"),
  endTime: z.string().optional().nullable(),
  price: z.number().optional().nullable(),
  ticketType: z.enum(["Paid", "Free"]),
  maxQuantity: z.number().optional().nullable(),
  isSoldOut: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  hasFinisherJersey: z.boolean().default(false),
  ticketCategory: z.enum(["Triathlon", "Duathlon", "Marathon", "Cycling", "Swimming", "Other"]),
  applicableAgeGroups: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  hsnCode: z.string().optional().nullable(),
  gstPercent: z.number().optional().nullable(),
  order: z.number().default(0),
  cutoffs: z.object({
    mode: z.enum(['overall', 'segment']).default('overall'),
    overall: z.string().optional().nullable(),
    swim: z.string().optional().nullable(),
    bike: z.string().optional().nullable(),
    run: z.string().optional().nullable(),
    run1: z.string().optional().nullable(),
    run2: z.string().optional().nullable(),
  }).optional().nullable(),
  subCategories: z.array(z.any()).optional().nullable(),
  tiers: z.array(z.any()).optional().nullable(),
});
export type TicketDefinitionFormInput = z.infer<typeof TicketDefinitionSchema>;
