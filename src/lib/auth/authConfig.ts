// src/lib/auth/authConfig.ts

// Email provider template configuration.
// NOTE: `brevo` key is retained for backward compatibility so existing template
// references and IDs remain unchanged.
const brevoSenderEmail = process.env.BERGTECHNO_SENDER_EMAIL || process.env.BREVO_SENDER_EMAIL || 'info@bergmantri.com';
const brevoSenderName = process.env.BERGTECHNO_SENDER_NAME || process.env.BREVO_SENDER_NAME || 'Bergman Triathlon';

export const authOtpConfig = {
  brevo: {
    senderEmail: brevoSenderEmail,
    senderName: brevoSenderName,
    otpTemplateId: 178,
    registrationConfirmationTemplateId: 199,
    registrationConfirmationUSDTemplateId: 243,
    waiverOtpTemplateId: 174,
    waiverCheckedInTemplateId: 188,
    athleteCancellationTemplateId: 201,
    athleteDeferralTemplateId: 191,
    categoryChangeTemplateId: 217, // ADMIN NOTIFICATION
    categoryChangeParticipantTemplateId: 255, // ATHLETE NOTIFICATION
    adminNotificationTemplateId: 215,
    adminTicketSaleTemplateId: 254, 
    adminTicketSaleUSDTemplateId: 243,
    bikeCheckoutOtpTemplateId: 224,
    bikeCheckoutReminderTemplateId: 227,
    athleteIncompleteRegistrationTemplateId: 203,
    clubAffiliationTemplateId: 205,
    monthlyDeferralReminderTemplateId: 207,
    clubRegistrationTemplateId: 208,
    welcomeEmailTemplateId: 214,
    clubAthleteRegistrationTemplateId: 221,
    lockerAssignmentTemplateId: 223,
    lockerReturnTemplateId: 224,
    yearlyRecapTemplateId: 226,
    clubYearlyRecapTemplateId: 242,
    foodOrderTemplateId: 25,
    bikeRackingTemplateId: 234,
    athleteRemovedFromClubTemplateId: 245,
    contactEnquiryAckTemplateId: 246,
    contactEnquiryAdminTemplateId: 247,
    feedbackCouponTemplateId: 250,
    birthdayCampaignTemplateId: 257,
    storeOrderShippedTemplateId: 251,
    storeOrderConfirmedTemplateId: 252,
    storeAdminOrderAlertTemplateId: 253,
    invoiceEmailTemplateId: 256, // Registration / Deferral / Category-change invoice email
    yearlyRecapTemplateId_new: 226, // Fallback
    waiverCheckedInUsaTemplateId: 259, // USA Event Waiver Check-in Email with Waiver & Refund Policy
  },
  aisensy: {
    otpCampaignName: 'otp1',
    volunteerCheckinOtpCampaignName: 'otp1',
    regConfirmationCampaignName: 'bmregconf',
    cancellationCampaignName: 'bergmanregcan',
    categoryChangeCampaignName: 'bmlogcatchan1',
    waiverCheckedInCampaignName: 'waiverchecked1',
    bikeCheckInCampaignName: 'bikecheckin4',
    bikeCheckOutCampaignName: 'bikecheckout1',
    refundInitiatedCampaignName: 'bmcanrefund',
    adminAlertCampaignName: 'adminmessage',
    bikeCheckoutOtpCampaignName: 'bmotp',
    bikeCheckoutReminderCampaignName: 'bikecheckoutreminder',
    incompleteRegistrationCampaignName: 'potentialregistration',
    clubAffiliationCampaignName: 'clubaffliation', 
    deferralConfirmationCampaignName: 'bmdeferral1',
    clubParticipantRegCampaignName: 'clubparticipantreg',
    lockerAssignmentCampaignName: 'locker3',
    lockerReturnCampaignName: 'lockerreturn',
    foodOrderCampaignName: 'food',
    foodDeliveredCampaignName: 'fooddel',
    bikeRackingCampaignName: "bikerack",
    registrationInvoiceCampaignName: 'invoice',
    serviceFeeInvoiceCampaignName: 'Invoice def',
    feedbackCouponCampaignName: 'feedback_coupon',
    birthdayCampaignName: 'birthday',
    storeOrderShippedCampaignName: 'ordershipped',
    storeOrderConfirmedCampaignName: 'bergman_store_invoice',
  },
};
