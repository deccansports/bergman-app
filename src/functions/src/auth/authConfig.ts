// src/functions/src/auth/authConfig.ts

const feedbackCouponTemplateId = 250;
const aisensyFeedbackCouponCampaignName = 'feedback_coupon';

export const authOtpConfig = {
  brevo: {
    feedbackCouponTemplateId,
  },
  aisensy: {
    feedbackCouponCampaignName: aisensyFeedbackCouponCampaignName,
  },
};
