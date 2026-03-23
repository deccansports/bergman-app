// src/functions/src/auth/aisensyService.ts
import { authOtpConfig as config } from './authConfig';

interface AiSensyApiResponse {
  success?: string | boolean;
  status?: string;
  message?: string;
  [key: string]: any;
}

/**
 * Normalizes a mobile number to the format expected by AiSensy (digits only, country code included).
 */
function normalizeMobileForAiSensy(mobile: string): string | null {
  if (!mobile) return null;
  
  // Remove all non-digits
  let cleaned = mobile.trim().replace(/\D/g, '');
  
  // India Specific: If it's 10 digits and looks like a mobile number, add 91
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return '91' + cleaned;
  }
  
  // India Specific: If it's 12 digits starting with 91, keep it
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return cleaned;
  }

  // General fallback: return cleaned digits
  return cleaned;
}

export async function sendAiSensyMessage(
  mobileNumber: string,
  campaignName: string,
  templateParams: (string | null | undefined)[],
  source: string,
  actionLogName: string,
  userName?: string | null,
  media?: { filename: string; url: string; } | null
): Promise<{ success: boolean; message: string; error?: string }> {
  const aisensyApiKey = process.env.AISENSY_API_KEY;

  if (!aisensyApiKey) {
    const errorMsg = "WhatsApp service API key is missing (AISENSY_API_KEY).";
    console.error(`[${actionLogName}] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const destination = normalizeMobileForAiSensy(mobileNumber);
  if (!destination) {
    return { success: false, message: "Invalid mobile number format." };
  }

  const payload: any = {
    apiKey: aisensyApiKey,
    campaignName,
    destination,
    userName: userName || "Athlete",
    source,
    templateParams: templateParams.map(p => p !== null && p !== undefined ? String(p) : ""),
  };

  if (media) {
    payload.media = media;
  }

  try {
    const response = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const data: AiSensyApiResponse = await response.json();
    
    // AiSensy returns success as 'true' (string), true (boolean), or status as 'success'
    const isSuccess = data.success === 'true' || data.success === true || data.status === 'success';

    if (response.ok && isSuccess) {
      return { success: true, message: 'WhatsApp request submitted.' };
    } else {
      console.warn(`[${actionLogName}] AiSensy send failed for ${destination}. Response:`, data);
      return { 
        success: false, 
        message: data.message || `Failed with status ${response.status}`,
        error: data.message || `API Status: ${response.status}` 
      };
    }
  } catch (error: any) {
    console.error(`[${actionLogName}] AiSensy send exception for ${destination}. Error: ${error.message}`, error);
    return { success: false, message: `Network Error: ${error.message}`, error: error.message };
  }
}

export async function sendFeedbackCouponWhatsApp(
    mobileNumber: string,
    name: string,
    couponCode: string
): Promise<{ success: boolean; message: string; }> {
    const templateParams = [
        name,
        'Bergman Ozar',
        couponCode,
    ];
    return sendAiSensyMessage(
        mobileNumber,
        config.aisensy.feedbackCouponCampaignName,
        templateParams,
        'Bergman Feedback Coupon',
        'sendFeedbackCouponWhatsApp',
        name
    );
}
