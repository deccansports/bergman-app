// src/lib/types/index.ts

// 1. Domain Entities
export * from "./common";
export * from "./user";
export * from "./club";
export * from "./event";
export * from "./ticket";
export * from "./participant";
export * from "./coupon";
export * from "./deferral";
export * from "./announcement";
export * from "./analytics";
export * from "./food";
export * from "./faq";
export * from "./pages";
export * from "./volunteer";
export * from "./registration";
export * from "./results";
export * from "./whatsapp";
export * from "./store";
export * from "./payments";
export * from "./category"; 
export * from "./athleteTier";

// 2. Schema and Form Types
import type { 
    AdminParticipantEditFormInput, 
    AdminRaceResultEditFormInput,
    CreateUserFormInput,
    WhatsAppCampaignFormInput,
    CouponCreateFormInput,
    CouponUpdateFormInput,
    AdminDeferralEditFormInput,
    AdminManualDeferralCreateFormInput,
    CreateVolunteerUserActionInput,
    VolunteerAssignmentFormInput,
    TicketDefinitionFormInput,
    AnnouncementFormInput,
    ClubUpdateFormInput,
    ClubSocialLinksUpdateActionInput,
    ContactUsFormInput,
    AthleteSignupFormInput,
    PublicEventRegistrationFormInputClient,
    AdminInitiateRefundFormInput
} from '../schemas';

export type { 
    AdminParticipantEditFormInput, 
    AdminRaceResultEditFormInput,
    CreateUserFormInput,
    WhatsAppCampaignFormInput,
    CouponCreateFormInput,
    CouponUpdateFormInput,
    AdminDeferralEditFormInput,
    AdminManualDeferralCreateFormInput,
    CreateVolunteerUserActionInput,
    VolunteerAssignmentFormInput,
    TicketDefinitionFormInput,
    AnnouncementFormInput,
    ClubUpdateFormInput,
    ClubSocialLinksUpdateActionInput,
    ContactUsFormInput,
    AthleteSignupFormInput,
    PublicEventRegistrationFormInputClient,
    AdminInitiateRefundFormInput
};
