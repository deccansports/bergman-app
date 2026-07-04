import * as z from 'zod';

export const internationalMobileRegex = /^(?:\+91)?[6-9]\d{9}$|^\+\d{1,3}\d{6,14}$/;

export const UserProfileUpdateSchema = z.object({
  name: z.string().min(2, 'Name is required').optional(),
  email: z.string().email('Invalid email').optional(),
  mobile: z.string().min(10, 'Mobile is required').optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  pincode: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  bloodGroup: z.string().optional(),
  tshirtSize: z.string().optional(),
  emergencyContactNumber: z.string().optional(),
  ageGroup: z.string().optional(),
  idProofFile: z.any().optional(),
  consentPromotions: z.boolean().optional(),
});

export type UserProfileUpdateData = z.infer<typeof UserProfileUpdateSchema>;

export const ClubUpdateSchema = z.object({
  name: z.string().min(2, 'Club name is required'),
  coach_name: z.string().min(2, 'Coach name is required'),
  email: z.string().email('Invalid email'),
  mobile: z.string().min(10, 'Mobile is required'),
  country: z.string().min(2, 'Country is required'),
  city: z.string().optional(),
  state: z.string().optional(),
});

export const ClubSocialLinksUpdateSchema = z.object({
  clubId: z.string(),
  ownerUid: z.string(),
  instagramUrl: z.string().url('Invalid URL').or(z.literal('')).optional().nullable(),
  facebookUrl: z.string().url('Invalid URL').or(z.literal('')).optional().nullable(),
  country: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export const ContactUsSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
  mobile: z.string().min(10, 'Mobile is required'),
  about: z.enum(['Registration', 'General Enquiry', 'About Event'], { message: 'Please select a query type' }),
  selectedEventId: z.string().optional().nullable(),
  selectedEventName: z.string().optional().nullable(),
  message: z.string().min(10, 'Message is too short'),
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
  const billingType = data.billingType;
  const gstin = String(data.gstin || '').trim().toUpperCase();
  const businessName = String(data.businessName || '').trim();
  const businessAddress = String(data.businessAddress || '').trim();
  const businessPrimaryContactName = String(data.businessPrimaryContactName || '').trim();
  const businessPrimaryContactEmail = String(data.businessPrimaryContactEmail || '').trim();
  const businessPrimaryContactMobile = String(data.businessPrimaryContactMobile || '').trim();

  if (normalizedCountry === 'india' && normalizedState.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['state'],
      message: 'State is required for India',
    });
  }

  if (normalizedCountry === 'united states' && normalizedState.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['state'],
      message: 'State is required for the United States',
    });
  }

  if (billingType === 'business') {
    if (!gstin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gstin'],
        message: 'GSTIN is required for business invoices',
      });
    } else if (!/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9]$/i.test(gstin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gstin'],
        message: 'Enter a valid 15-character GSTIN',
      });
    }

    if (!businessName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessName'],
        message: 'Registered company name is required',
      });
    }

    if (!businessAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessAddress'],
        message: 'Business registered address is required',
      });
    }

    if (!businessPrimaryContactName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessPrimaryContactName'],
        message: 'Business primary contact name is required',
      });
    }

    if (!businessPrimaryContactEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessPrimaryContactEmail'],
        message: 'Business primary contact email is required',
      });
    } else if (!z.string().email().safeParse(businessPrimaryContactEmail).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessPrimaryContactEmail'],
        message: 'Enter a valid business primary contact email',
      });
    }

    if (!businessPrimaryContactMobile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessPrimaryContactMobile'],
        message: 'Business primary contact mobile is required',
      });
    } else if (!internationalMobileRegex.test(businessPrimaryContactMobile)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessPrimaryContactMobile'],
        message: 'Enter a valid business primary contact mobile number',
      });
    }

    if (data.confirmGstDetails !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmGstDetails'],
        message: 'Please confirm your GST details before submitting',
      });
    }
  }
});

export type PublicEventRegistrationFormInputClient = z.infer<typeof PublicEventRegistrationSchema>;

export const AdminInitiateRefundSchema = z.object({
  refundInitiatedDate: z.date(),
  refundTransactionId: z.string().min(5, "Transaction ID required"),
  adminNotes: z.string().optional().nullable(),
});

export type AdminInitiateRefundFormInput = z.infer<typeof AdminInitiateRefundSchema>;

export const CreateVolunteerUserActionSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
  mobile: z.string().min(10, 'Mobile is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  assignedEventId: z.string().optional().nullable(),
  assignedCounter: z.array(z.string()).optional().nullable(),
});

export type CreateVolunteerUserActionInput = z.infer<typeof CreateVolunteerUserActionSchema>;
