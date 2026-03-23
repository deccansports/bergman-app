// src/functions/src/auth/brevoService.ts
import { authOtpConfig as config } from './authConfig';

async function getBrevoApiInstance() {
  const brevo = await import('@getbrevo/brevo');
  const apiInstance = new brevo.TransactionalEmailsApi();
  
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('Brevo API key is not configured (BREVO_API_KEY).');
  }
  
  apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
  return apiInstance;
}

export async function sendDynamicTemplateEmail(
  templateId: number,
  recipientEmail: string,
  params: Record<string, any>,
  actionLogName: string
): Promise<boolean> {
  if (templateId === 0) {
    console.warn(`[${actionLogName}] Brevo Template ID is 0. Email for ${recipientEmail} not sent.`);
    return false;
  }
  
  const actionNameForLog = `BrevoService ${actionLogName}`;
  try {
    const apiInstance = await getBrevoApiInstance();
    const { SendSmtpEmail } = await import('@getbrevo/brevo');
    const sendSmtpEmail = new SendSmtpEmail();
    
    sendSmtpEmail.templateId = templateId;
    sendSmtpEmail.to = [{ email: recipientEmail.toLowerCase() }];
    sendSmtpEmail.params = params;
    sendSmtpEmail.sender = { email: 'info@bergmantri.com', name: 'Bergman Triathlon' };

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.info(`[${actionNameForLog}] Successfully sent email to ${recipientEmail}.`);
    return true;
  } catch (error: any) {
    console.error(`[${actionNameForLog}] FAILED email to ${recipientEmail}. Error: ${error.message}`, error.body || error);
    return false;
  }
}

export async function sendFeedbackCouponEmail(
  recipientEmail: string,
  name: string,
  couponCode: string
): Promise<boolean> {
    const templateId = config.brevo.feedbackCouponTemplateId;
    const params = {
        name: name,
        couponCode: couponCode,
        eventname: 'Bergman Ozar', // This seems hardcoded in the main app's version too
    };
    return sendDynamicTemplateEmail(templateId, recipientEmail, params, 'sendFeedbackCouponEmail');
}
