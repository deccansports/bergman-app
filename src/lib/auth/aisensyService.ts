// src/lib/auth/aisensyService.ts
import { authOtpConfig as config } from '@/lib/auth/authConfig';
import { format as formatDateFns, isValid as isDateValidFns, parseISO } from 'date-fns';

interface AiSensySendOtpResponse {
  success?: string;
  status?: string;
  message?: string;
  messageId?: string;
  submitted_message_id?: string;
  [key: string]: any;
}

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

/**
 * Normalizes a mobile number to E.164 format (+91...)
 */
function formatMobile(mobile: string) {
  if (!mobile) return null;

  // Remove all non-digits
  const cleaned = mobile.replace(/\D/g, "");

  // India Specific: 10 digits
  if (cleaned.length === 10) {
    return "+91" + cleaned;
  }

  // India Specific: 12 digits starting with 91
  if (cleaned.startsWith("91") && cleaned.length === 12) {
    return "+" + cleaned;
  }

  // General fallback: ensure + is present
  if (!cleaned.startsWith("+")) {
    return "+" + cleaned;
  }

  return cleaned;
}

export async function sendAiSensyMessage(
  mobileNumber: string | null | undefined,
  campaignName: string,
  templateParams: (string | null | undefined)[],
  source: string,
  actionLogName: string,
  userName?: string | null,
  media?: { filename: string; url: string; } | { filename: string; base64: string; } | null,
  buttons?: any[] | null,
  paramsFallbackValue?: Record<string, string> | null
): Promise<{ success: boolean; message: string; aisensyResponse?: AiSensySendOtpResponse; error?: string }> {
  const aisensyApiKey = process.env.AISENSY_API_KEY;

  if (!aisensyApiKey) {
    const errorMsg = "WhatsApp service API Key is missing (AISENSY_API_KEY).";
    console.error(`[${actionLogName}] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  if (!mobileNumber) {
    return { success: false, message: "No valid mobile number provided." };
  }

  const destination = formatMobile(mobileNumber);
  if (!destination) {
    return { success: false, message: "Invalid mobile number format." };
  }
  
  // Strip the '+' for the final API call as per common AiSensy requirements, 
  // though E.164 usually includes it. AiSensy destination field expects digits only usually.
  const apiDestination = destination.replace(/\+/g, "");

  const safeTemplateParams = templateParams.map(p => (p === null || p === undefined) ? '' : String(p));

  const payload: any = {
    apiKey: aisensyApiKey,
    campaignName,
    destination: apiDestination,
    userName: userName || "BERGMAN 2",
    source,
    templateParams: safeTemplateParams,
    carouselCards: [],
    location: {},
    attributes: {},
  };

  if (media) {
    if ('url' in media) {
        payload.media = { filename: media.filename, url: (media as any).url };
    } else if ('base64' in media) {
        payload.media = { filename: media.filename, base64: (media as any).base64 };
    }
  }
  
  if (buttons) {
    payload.buttons = buttons;
  }
  if (paramsFallbackValue) {
    payload.paramsFallbackValue = paramsFallbackValue;
  }
    
  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data: AiSensySendOtpResponse = await response.json();
    
    if (response.ok && (data.success === 'true' || data.status === 'success')) {
      console.log(`[${actionLogName}] WhatsApp success for ${destination}. ID: ${data.messageId || data.submitted_message_id}`);
      return { success: true, message: 'WhatsApp request submitted.', aisensyResponse: data };
    } else {
      console.warn(`[${actionLogName}] AiSensy API rejected message to ${destination}. Status: ${response.status}`, data);
      return { 
        success: false, 
        message: data.message || `Failed. Status: ${response.status}.`, 
        aisensyResponse: data,
        error: data.message || `Status: ${response.status}`
      };
    }
  } catch (error: any) {
    console.error(`[${actionLogName}] Network error calling AiSensy for ${destination}: ${error.message}`);
    return { success: false, message: `Exception: ${error.message || 'Network error.'}`, error: error.message };
  }
}

export async function sendOtpViaWhatsApp(
  mobileNumber: string,
  otp: string,
  _name?: string | null
): Promise<{ success: boolean; message: string; aisensyResponse?: AiSensySendOtpResponse }> {
  const templateParams = [otp];
  const buttons = [
    {
      "type": "button",
      "sub_type": "url",
      "index": 0,
      "parameters": [
        {
          "type": "text",
          "text": otp
        }
      ]
    }
  ];
  
  return sendAiSensyMessage(
      mobileNumber, 
      config.aisensy.otpCampaignName, 
      templateParams, 
      'Bergman Athlete Login', 
      'sendOtpViaWhatsApp',
      "BERGMAN 2",
      null,
      buttons,
      null
  );
}

export async function sendRegistrationConfirmationViaWhatsApp(
    mobile: string,
    athleteName: string | null,
    eventName: string | null,
    bookingId: string | null,
    bookingDate: Date,
    ticketName: string,
    bibNumber: string | null,
    venueName: string | null,
    eventDate: string | null
): Promise<{ success: boolean; message: string; }> {
    const templateParams = [
        athleteName || 'Athlete',
        eventName || 'the event',
        bookingId || 'N/A',
        formatDateFns(bookingDate, 'MMM dd, yyyy, p'),
        ticketName,
        bibNumber || 'TBD',
        venueName || 'TBD',
        eventDate ? formatDateFns(parseISO(eventDate), 'MMM dd, yyyy') : 'TBD'
    ];
    return sendAiSensyMessage(
        mobile,
        config.aisensy.regConfirmationCampaignName,
        templateParams,
        'Bergman Registration Confirmation',
        'sendRegistrationConfirmationViaWhatsApp',
        athleteName
    );
}

export async function sendRegistrationInvoiceWhatsApp({
    mobile,
    firstName,
    eventName,
    invoiceNumber,
    invoiceUrl,
    invoiceFileName,
}: {
    mobile: string;
    firstName: string;
    eventName: string;
    invoiceNumber: string;
    invoiceUrl: string;
    invoiceFileName: string;
}): Promise<{ success: boolean; message: string; }> {
    const templateParams = [firstName, eventName, invoiceNumber];
    const campaignName = config.aisensy.registrationInvoiceCampaignName;
    const media = { filename: invoiceFileName, url: invoiceUrl };

    return sendAiSensyMessage(
        mobile,
        campaignName,
        templateParams,
        'Bergman Registration Invoice',
        'sendRegistrationInvoiceWhatsApp',
        "BERGMAN 2",
        media
    );
}

export async function sendServiceFeeInvoiceWhatsApp({
    mobile,
    firstName,
    serviceType,
    eventName,
    invoiceNumber,
    invoiceUrl,
    invoiceFileName,
}: {
    mobile: string;
    firstName: string;
    serviceType: string;
    eventName: string;
    invoiceNumber: string;
    invoiceUrl: string;
    invoiceFileName: string;
}): Promise<{ success: boolean; message: string; }> {
    const templateParams = [firstName, serviceType, eventName, invoiceNumber];
    const campaignName = config.aisensy.serviceFeeInvoiceCampaignName;
    const media = { filename: invoiceFileName, url: invoiceUrl };

    return sendAiSensyMessage(
        mobile,
        campaignName,
        templateParams,
        'Bergman Service Invoice',
        'sendServiceFeeInvoiceWhatsApp',
        "BERGMAN 2",
        media
    );
}

export async function sendWaiverCheckInConfirmationWhatsApp(
  mobileNumber: string,
  athleteName: string | null,
  eventName: string,
  ticketName: string | null,
): Promise<{ success: boolean; message: string }> {
    const templateParams = [athleteName || 'Athlete', eventName, ticketName || 'N/A'];
    return sendAiSensyMessage(
        mobileNumber,
        config.aisensy.waiverCheckedInCampaignName,
        templateParams,
        'Bergman Waiver Check-in',
        'sendWaiverCheckInConfirmationWhatsApp',
        "BERGMAN 2"
    );
}

export async function sendBikeCheckInConfirmationWhatsApp(
  mobileNumber: string,
  athleteName: string | null,
  checkInDate: string,
  checkInTime: string,
  eventName: string
): Promise<{ success: boolean; message: string }> {
    const templateParams = [athleteName || 'Athlete', checkInDate, checkInTime, eventName];
    return sendAiSensyMessage(
        mobileNumber,
        config.aisensy.bikeCheckInCampaignName,
        templateParams,
        'Bergman Bike Check-in',
        'sendBikeCheckInConfirmationWhatsApp',
        "BERGMAN 2"
    );
}

export async function sendBikeCheckOutConfirmationWhatsApp(
  mobileNumber: string,
  athleteName: string | null,
  checkOutDate: string,
  checkOutTime: string,
  eventName: string
): Promise<{ success: boolean; message: string }> {
    const templateParams = [athleteName || 'Athlete', checkOutDate, checkOutTime, eventName];
    return sendAiSensyMessage(
        mobileNumber,
        config.aisensy.bikeCheckOutCampaignName,
        templateParams,
        'Bergman Bike Check-out',
        'sendBikeCheckOutConfirmationWhatsApp',
        "BERGMAN 2"
    );
}

export async function sendVolunteerCheckinOtpWhatsApp(
    mobileNumber: string,
    otp: string,
    _name?: string | null
): Promise<{ success: boolean; message: string; aisensyResponse?: AiSensySendOtpResponse }> {
    const templateParams = [otp];
    const buttons = [
      {
        "type": "button",
        "sub_type": "url",
        "index": 0,
        "parameters": [
          {
            "type": "text",
            "text": otp
          }
        ]
      }
    ];
    return sendAiSensyMessage(
        mobileNumber, 
        config.aisensy.volunteerCheckinOtpCampaignName, 
        templateParams, 
        'Bergman Volunteer Check-in OTP', 
        'sendVolunteerCheckinOtpWhatsApp',
        "BERGMAN 2",
        null,
        buttons,
        null
    );
}

export async function sendRefundInitiatedWhatsApp(
  mobileNumber: string,
  athleteName: string,
  refundId: string,
  refundDate: Date,
  refundAmountPaisa: number,
): Promise<{ success: boolean; message: string }> {
    const formattedDate = isDateValidFns(refundDate) ? formatDateFns(refundDate, 'dd-MM-yyyy') : 'N/A';
    const params = [
        athleteName,
        `₹${(refundAmountPaisa / 100).toFixed(2)}`,
        refundId,
        formattedDate
    ];
    return sendAiSensyMessage(mobileNumber, config.aisensy.refundInitiatedCampaignName, params, 'Bergman Refund Initiation', 'sendRefundInitiatedWhatsApp', "BERGMAN 2");
}

export async function sendBikeCheckoutReminderWhatsApp(
    mobileNumber: string,
    athleteName: string,
    bibNumber: string
): Promise<{ success: boolean; message: string }> {
    const params = [athleteName, bibNumber];
    return sendAiSensyMessage(mobileNumber, config.aisensy.bikeCheckoutReminderCampaignName, params, 'Bergman Bike Checkout Reminder', 'sendBikeCheckoutReminderWhatsApp', "BERGMAN 2");
}

export async function sendIncompleteRegistrationWhatsApp(
    mobileNumber: string,
    athleteName: string,
    eventName: string
): Promise<{ success: boolean; message: string }> {
    const params = [athleteName, eventName];
    return sendAiSensyMessage(mobileNumber, config.aisensy.incompleteRegistrationCampaignName, params, 'Bergman Incomplete Registration', 'sendIncompleteRegistrationWhatsApp', "BERGMAN 2"
    );
}

export async function sendDeferralConfirmationWhatsApp(
    mobileNumber: string,
    athleteName: string | null,
    originalEventName: string,
    _newExpiryDate: string | null
): Promise<{ success: boolean; message: string }> {
    const params = [athleteName || 'Athlete', originalEventName];
    return sendAiSensyMessage(mobileNumber, config.aisensy.deferralConfirmationCampaignName, params, 'Bergman Deferral Confirmation', 'sendDeferralConfirmationWhatsApp', "BERGMAN 2");
}

export async function sendLockerAssignmentWhatsApp(
    mobileNumber: string,
    athleteName: string | null,
    bibNumber: string,
    lockerNumber: string,
): Promise<{ success: boolean; message: string }> {
    const params = [athleteName || 'Athlete', bibNumber, lockerNumber];
    return sendAiSensyMessage(mobileNumber, config.aisensy.lockerAssignmentCampaignName, params, 'Bergman Locker Assignment', 'sendLockerAssignmentWhatsApp', "BERGMAN 2");
}

export async function sendLockerReturnConfirmationWhatsApp(
    mobileNumber: string,
    athleteName: string | null,
    lockerNumber: string
): Promise<{ success: boolean; message: string }> {
    const params = [athleteName || 'Athlete', lockerNumber];
    return sendAiSensyMessage(mobileNumber, config.aisensy.lockerReturnCampaignName, params, 'Bergman Locker Return', 'sendLockerReturnConfirmationWhatsApp', "BERGMAN 2" );
}

export async function sendCategoryChangeNoticeWhatsApp(
    mobileNumber: string,
    athleteName: string,
    eventName: string,
    oldCategory: string,
    newCategory: string
): Promise<{ success: boolean; message: string }> {
    // Template: Dear Athlete, {{1}} ... event {{2}} ... Previous Category: {{3}} Updated Category: {{4}}
    const params = [athleteName, eventName, oldCategory, newCategory];
    return sendAiSensyMessage(mobileNumber, config.aisensy.categoryChangeCampaignName, params, 'Bergman Category Change', 'sendCategoryChangeNoticeWhatsApp', "BERGMAN 2");
}

export async function sendClubAffiliationNoticeToOwnerWhatsApp(
  ownerMobile: string | null,
  ownerName: string,
  athleteName: string,
  clubName: string
): Promise<{ success: boolean, message: string }> {
  // CORRECT PARAM ORDER: 1. Owner Name, 2. Athlete Name, 3. Club Name
  const templateParams = [ownerName, athleteName, clubName];
  return sendAiSensyMessage(
    ownerMobile,
    config.aisensy.clubAffiliationCampaignName,
    templateParams,
    'Bergman Club Affiliation Notice',
    'sendClubAffiliationNoticeToOwnerWhatsApp',
    "BERGMAN 2"
  );
}

export async function sendCancellationConfirmationWhatsApp(
  mobileNumber: string,
  athleteName: string,
  eventName: string,
): Promise<{ success: boolean; message: string }> {
  const templateParams = [athleteName, eventName];
  return sendAiSensyMessage(
    mobileNumber,
    config.aisensy.cancellationCampaignName,
    templateParams,
    'Bergman Cancellation Confirmation',
    'sendCancellationConfirmationWhatsApp',
    "BERGMAN 2"
  );
}

export async function sendClubAthleteRegistrationNoticeWhatsApp(
    ownerMobile: string | null,
    athleteName: string,
    eventName: string,
    ticketName: string,
    eventDate: string | null
): Promise<{ success: boolean, message: string }> {
    const formattedDate = eventDate ? formatDateFns(parseISO(eventDate), 'MMM dd, yyyy') : 'TBD';
    const templateParams = [athleteName, eventName, ticketName, formattedDate];
    return sendAiSensyMessage(
        ownerMobile,
        config.aisensy.clubParticipantRegCampaignName,
        templateParams,
        'Bergman Club Athlete Registration',
        'sendClubAthleteRegistrationNoticeWhatsApp',
        "BERGMAN 2"
    );
}

export async function sendStoreOrderConfirmedWhatsApp(params: {
    mobile: string;
    customer_name: string;
    order_id: string;
    total_amount: number;
    invoice_number: string;
    invoice_url: string;
    invoice_filename: string;
}): Promise<{ success: boolean; message: string; }> {
    const templateParams = [params.customer_name, "Bergman Store", params.invoice_number];
    const campaignName = config.aisensy.storeOrderConfirmedCampaignName; 
    const media = { filename: params.invoice_filename, url: params.invoice_url };
    return sendAiSensyMessage(
        params.mobile,
        campaignName,
        templateParams,
        'Bergman Store Order Confirmation',
        'sendStoreOrderConfirmedWhatsApp',
        "BERGMAN 2",
        media
    );
}

export async function sendStoreOrderShippedWhatsApp(params: {
    mobile: string;
    customer_name: string;
    order_id: string;
    courier_name: string;
    tracking_id: string;
    tracking_url: string;
}): Promise<{ success: boolean; message: string; }> {
    const templateParams = [params.customer_name, params.order_id, params.courier_name, params.tracking_id, params.tracking_url];
    return sendAiSensyMessage(
        params.mobile,
        config.aisensy.storeOrderShippedCampaignName,
        templateParams,
        'Bergman Store Order Shipped',
        'sendStoreOrderShippedWhatsApp',
        "BERGMAN 2"
    );
}

export async function sendBikeRackAssignmentWhatsApp(
    mobileNumber: string,
    athleteName: string | null,
    eventName: string,
    bibNumber: string,
    rackName: string
): Promise<{ success: boolean; message: string; }> {
    const params = [athleteName || 'Athlete', eventName, bibNumber, rackName];
    return sendAiSensyMessage(
        mobileNumber,
        config.aisensy.bikeRackingCampaignName,
        params,
        'Bergman Bike Rack Assignment',
        'sendBikeRackAssignmentWhatsApp',
        "BERGMAN 2"
    );
}
