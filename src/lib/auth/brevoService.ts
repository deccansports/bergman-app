// src/lib/auth/brevoService.ts
import { authOtpConfig as config } from '@/lib/auth/authConfig';
import { format as formatDateFns, isValid as isDateValidFns } from 'date-fns';

async function getBrevoApiInstance() {
  const brevo = await import('@getbrevo/brevo');
  const apiInstance = new brevo.TransactionalEmailsApi();
  
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('Brevo API key is not configured in environment variables (BREVO_API_KEY).');
  }
  
  const apiKeyAuth = apiInstance.authentications['apiKey'];
  apiKeyAuth.apiKey = apiKey;

  return apiInstance;
}

export async function sendDynamicTemplateEmail(
  templateId: number,
  recipientEmail: string,
  params: Record<string, any>,
  actionLogName: string,
  attachment?: { content: string; name: string } | null
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
    sendSmtpEmail.sender = { email: config.brevo.senderEmail, name: config.brevo.senderName };

    if (params.addTags && Array.isArray(params.addTags)) {
      sendSmtpEmail.tags = params.addTags;
    }

    if (attachment) {
      sendSmtpEmail.attachment = [attachment];
    }

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.info(`[${actionNameForLog}] Successfully sent email to ${recipientEmail}.`);
    return true;
  } catch (error: any) {
    const statusCode = error.statusCode || error.status;
    console.error(`[${actionNameForLog}] FAILED email to ${recipientEmail}. Status: ${statusCode}, Error: ${error.message}`);
    return false;
  }
}

export async function sendRawHtmlEmail(
    recipientEmail: string, 
    subject: string, 
    htmlContent: string,
    attachment?: { content: string; name: string } | null
): Promise<boolean> {
    const actionLogName = 'BrevoService sendRawHtmlEmail';
    
    try {
        const apiInstance = await getBrevoApiInstance();
        const { SendSmtpEmail } = await import('@getbrevo/brevo');
        const sendSmtpEmail = new SendSmtpEmail();

        sendSmtpEmail.to = [{ email: recipientEmail.toLowerCase() }];
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = htmlContent;
        sendSmtpEmail.sender = { email: config.brevo.senderEmail, name: config.brevo.senderName };

        if (attachment) {
            sendSmtpEmail.attachment = [attachment];
        }
    
        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.info(`[${actionLogName}] Successfully sent email to ${recipientEmail}.`);
        return true;
    } catch (error: any) {
        console.error(`[${actionLogName}] FAILED email to ${recipientEmail}. Error: ${error.message}`);
        return false;
    }
}

export async function sendAdminTicketSaleNotificationEmail(
  athleteName: string | null, eventName: string, bookingId: string,
  bookingDate: string | Date,
  ticketName: string, eventVenue: string | null | undefined, eventDate: string | null,
  address?: string | null, mobileNumber?: string | null, emergencyContact?: string | null, recipientEmail?: string | null, invoiceNumber?: string | null,
  bibNumber?: string | null, organizerName?: string | null, organizerAddress?: string | null,
  organizerCompanyDescription?: string | null, country?: string | null, _currency: 'INR' | 'USD' = 'INR'
): Promise<boolean> {
    const adminEmail = "info@bergmantri.com";
    const templateId = config.brevo.adminTicketSaleTemplateId;
    if (templateId === 0) return false;

    let formattedBookingDate = "N/A";
    try {
      const bDate = typeof bookingDate === 'string' ? new Date(bookingDate) : bookingDate;
      if (isDateValidFns(bDate)) {
          formattedBookingDate = formatDateFns(bDate, 'MMM dd, yyyy');
      }
    } catch (e) {}

    let formattedEventDate: string;
    try {
      if (eventDate && eventDate !== 'TBD') {
        formattedEventDate = formatDateFns(new Date(eventDate + 'T00:00:00Z'), 'MMM dd, yyyy');
      } else {
        formattedEventDate = "TBD";
      }
    } catch(e) {
      formattedEventDate = eventDate ?? 'TBD';
    }
    
    const now = new Date();
    
    // BUILD PARAMS OBJECT FOR TEMPLATE 254
    const params = {
        name: athleteName || 'Athlete',
        eventname: eventName,
        ticket: ticketName,
        booking_id: bookingId,
        booking_date: formattedBookingDate,
        eventdate: formattedEventDate,
        event_venue: eventVenue || 'Venue TBD',
        bib_number: bibNumber || 'TBD',
        address: address || 'N/A',
        phone: mobileNumber || 'N/A',
        email: recipientEmail || 'N/A',
        emergency_number: emergencyContact || 'N/A',
        day: formatDateFns(now, 'do'),
        date: formatDateFns(now, 'MMMM, yyyy'),
        organizer_name: organizerName || 'Deccan Sports Club',
        company_description: organizerCompanyDescription || '',
        organizer_address: organizerAddress || '',
        country: country || 'India',
        invoice_number: invoiceNumber || 'N/A',
        category: ticketName,
    };
    
    return sendDynamicTemplateEmail(templateId, adminEmail, params, 'sendAdminTicketSaleNotificationEmail');
}

export async function sendOtpEmailViaBrevo(email: string, otp: string, name?: string | null): Promise<boolean> {
  const params = { otp, name: name || 'Athlete' };
  return sendDynamicTemplateEmail(config.brevo.otpTemplateId, email, params, 'sendOtpEmailViaBrevo');
}

export async function sendWaiverOtpEmail(email: string, otp: string, name?: string | null): Promise<boolean> {
  const params = { otp, name: name || 'Athlete' };
  return sendDynamicTemplateEmail(config.brevo.waiverOtpTemplateId, email, params, 'sendWaiverOtpEmail');
}

export async function sendBikeCheckoutOtpEmail(email: string, otp: string, name?: string | null): Promise<boolean> {
  const params = { otp, name: name || 'Athlete' };
  return sendDynamicTemplateEmail(config.brevo.bikeCheckoutOtpTemplateId, email, params, 'sendBikeCheckoutOtpEmail');
}

export async function sendRegistrationConfirmationEmail(
  recipientEmail: string, athleteName: string | null, eventName: string, bookingId: string,
  bookingDate: string | Date, ticketName: string, eventVenue: string | null | undefined, eventDate: string | null,
  address?: string | null, mobileNumber?: string | null, emergencyContact?: string | null, invoiceNumber?: string | null,
  bibNumber?: string | null, organizerName?: string | null, organizerAddress?: string | null,
  organizerCompanyDescription?: string | null, country?: string | null, currency: 'INR' | 'USD' = 'INR'
): Promise<boolean> {
  let formattedBookingDate = "N/A", formattedBookingTime = "N/A";
  try {
    const bookingDateTime = typeof bookingDate === 'string' ? new Date(bookingDate) : bookingDate;
    if (isDateValidFns(bookingDateTime)) {
        formattedBookingDate = formatDateFns(bookingDateTime, 'MMM dd, yyyy');
        formattedBookingTime = formatDateFns(bookingDateTime, 'p');
    }
  } catch (e) {}

  let formattedEventDate: string;
  try {
    if (eventDate && eventDate !== 'TBD') {
      formattedEventDate = formatDateFns(new Date(eventDate + 'T00:00:00Z'), 'MMM dd, yyyy');
    } else {
      formattedEventDate = "TBD";
    }
  } catch(e) {
    formattedEventDate = eventDate ?? 'TBD';
  }
  
  const registrationDate = new Date();

  const params = {
    name: athleteName || 'Athlete',
    eventname: eventName,
    ticket: ticketName,
    eventdate: formattedEventDate,
    address: address || 'N/A',
    phone: mobileNumber || 'N/A',
    email: recipientEmail,
    emergencynumber: emergencyContact || 'N/A',
    time: formattedBookingTime,
    booking_id: bookingId,
    booking_date: formattedBookingDate,
    event_venue: eventVenue || 'Venue TBD',
    invoice_number: invoiceNumber || 'N/A',
    bib_number: bibNumber || 'TBD',
    category: ticketName,
    day: formatDateFns(registrationDate, 'do'),
    date: formatDateFns(registrationDate, 'MMMM, yyyy'),
    organizer_name: organizerName || 'Deccan Sports Club',
    company_description: organizerCompanyDescription || '',
    organizer_address: organizerAddress || '',
    country: country || 'India',
  };
  
  const templateId = currency === 'USD' ? config.brevo.registrationConfirmationUSDTemplateId : config.brevo.registrationConfirmationTemplateId;
  return sendDynamicTemplateEmail(templateId, recipientEmail, params, 'sendRegistrationConfirmationEmail');
}

export async function sendWaiverCheckedInEmail(
  recipientEmail: string, athleteName: string | null, eventName: string, ticketName: string, eventDate: string | null,
  _address?: string | null, _mobileNumber?: string | null, _emergencyContact?: string | null
): Promise<boolean> {
  const checkinDateTime = new Date();
  const params = {
    name: athleteName || 'Athlete',
    eventname: eventName,
    ticket: ticketName,
    eventdate: eventDate,
    date: formatDateFns(checkinDateTime, 'MMM dd, yyyy'),
    time: formatDateFns(checkinDateTime, 'p'),
    EVENT_NAME: eventName,
  };
  return sendDynamicTemplateEmail(config.brevo.waiverCheckedInTemplateId, recipientEmail, params, 'sendWaiverCheckedInEmail');
}

export async function sendCancellationRequestConfirmationEmail(recipientEmail: string, athleteName: string | null, eventName: string, refundAmountPaisa: number): Promise<boolean> {
  const params = { eventname: eventName, name: athleteName || 'Athlete', amount: (refundAmountPaisa / 100).toFixed(2) };
  return sendDynamicTemplateEmail(config.brevo.athleteCancellationTemplateId, recipientEmail, params, 'sendCancellationRequestConfirmationEmail');
}

export async function sendAdminCancellationNoticeEmail(recipientEmail: string, athleteName: string | null, eventName: string, reason?: string | null): Promise<boolean> {
  const subject = `Cancellation Notice for ${eventName}`;
  const htmlContent = `<p>Hello ${athleteName || 'Athlete'},</p><p>This is to inform you that your registration for <strong>${eventName}</strong> has been cancelled by the administrator.</p>${reason ? `<p><strong>Reason provided:</strong> ${reason}</p>` : ''}<p>If you have any questions, please contact our support team.</p><p>Regards,<br/>The Bergman Team</p>`;
  return sendRawHtmlEmail(recipientEmail, subject, htmlContent);
}

export async function sendDeferralConfirmationEmail(recipientEmail: string, athleteName: string | null, originalEventName: string, deferredToEventName: string | null): Promise<boolean> {
  const params = { name: athleteName || 'Athlete', eventname: originalEventName, deferred_event: deferredToEventName || 'a future event (TBD)' };
  return sendDynamicTemplateEmail(config.brevo.athleteDeferralTemplateId, recipientEmail, params, 'sendDeferralConfirmationEmail');
}

export async function sendIncompleteRegistrationEmail(recipientEmail: string, athleteName: string, eventName: string, redirectUrl?: string | null): Promise<boolean> {
  const params = { name: athleteName, eventname: eventName, redirectUrl: redirectUrl || 'https://www.bergmantri.com/dashboard' };
  return sendDynamicTemplateEmail(config.brevo.athleteIncompleteRegistrationTemplateId, recipientEmail, params, 'sendIncompleteRegistrationEmail');
}

export async function sendClubAffiliationNoticeToOwnerEmail(ownerEmail: string, athleteName: string, clubName: string): Promise<boolean> {
    const params = { clubName: clubName, name: athleteName };
    return sendDynamicTemplateEmail(config.brevo.clubAffiliationTemplateId, ownerEmail, params, 'sendClubAffiliationNoticeToOwnerEmail');
}

export async function sendMonthlyDeferralReminderEmail(recipientEmail: string, athleteName: string | null): Promise<boolean> {
  const params = { name: athleteName || 'Athlete' };
  return sendDynamicTemplateEmail(config.brevo.monthlyDeferralReminderTemplateId, recipientEmail, params, 'sendMonthlyDeferralReminderEmail');
}

export async function sendClubRegistrationConfirmationEmail(ownerEmail: string, clubEmail: string, ownerName: string, clubName: string): Promise<void> {
    const params = { name: ownerName, clubName: clubName };
    const recipients = [{ email: ownerEmail }];
    if (ownerEmail.toLowerCase() !== clubEmail.toLowerCase()) recipients.push({ email: clubEmail });
    for (const recipient of recipients) await sendDynamicTemplateEmail(config.brevo.clubRegistrationTemplateId, recipient.email, params, 'sendClubRegistrationConfirmationEmail');
}

export async function sendWelcomeEmail(recipientEmail: string, athleteName: string | null): Promise<boolean> {
    const params = { name: athleteName || 'Athlete' };
    return sendDynamicTemplateEmail(config.brevo.welcomeEmailTemplateId, recipientEmail, params, 'sendWelcomeEmail');
}

export async function sendAdminCategoryChangeNotificationEmail(athleteName: string, eventName: string, fromTicket: string, toTicket: string): Promise<boolean> {
  const params = { name: athleteName, eventname: eventName, ticket: fromTicket, changedticket: toTicket };
  return sendDynamicTemplateEmail(config.brevo.categoryChangeTemplateId, "info@bergmantri.com", params, 'sendAdminCategoryChangeNotificationEmail');
}

export async function sendAthleteCategoryChangeEmail(recipientEmail: string, athleteName: string, eventName: string, fromTicket: string, toTicket: string): Promise<boolean> {
  const params = { name: athleteName, eventname: eventName, ticket: fromTicket, changedticket: toTicket };
  return sendDynamicTemplateEmail(config.brevo.categoryChangeParticipantTemplateId, recipientEmail, params, 'sendAthleteCategoryChangeEmail');
}

export async function sendAdminNotificationEmail(recipientEmail: string, subject: string, message: string): Promise<boolean> {
  const params = { subject, message };
  return sendDynamicTemplateEmail(config.brevo.adminNotificationTemplateId, recipientEmail, params, 'sendAdminNotificationEmail');
}

export async function sendClubAthleteRegistrationNoticeEmail(ownerEmail: string, athleteName: string, clubName: string, eventName: string, ticketName: string, eventVenue: string | null, eventDate: string | null): Promise<boolean> {
  let formattedEventDate = "TBD";
  try {
    if (eventDate && eventDate !== 'TBD') formattedEventDate = formatDateFns(new Date(eventDate + 'T00:00:00Z'), 'MMM dd, yyyy');
  } catch(e) {}
  const params = { name: athleteName, eventname: eventName, ticket: ticketName, event_venue: eventVenue || 'Venue TBD', eventdate: formattedEventDate };
  return sendDynamicTemplateEmail(config.brevo.clubAthleteRegistrationTemplateId, ownerEmail, params, 'sendClubAthleteRegistrationNoticeEmail');
}

export async function sendLockerAssignmentEmail(recipientEmail: string, athleteName: string | null, bibNumber: string | null, lockerNumber: string): Promise<boolean> {
  const params = { name: athleteName || 'Athlete', bib_number: bibNumber || 'N/A', lockerno: lockerNumber };
  return sendDynamicTemplateEmail(config.brevo.lockerAssignmentTemplateId, recipientEmail, params, 'sendLockerAssignmentEmail');
}

export async function sendLockerReturnConfirmationEmail(recipientEmail: string, athleteName: string | null, lockerNumber: string): Promise<boolean> {
    const params = { name: athleteName || 'Athlete', lockerno: lockerNumber };
    return sendDynamicTemplateEmail(config.brevo.lockerReturnTemplateId, recipientEmail, params, 'sendLockerReturnConfirmationEmail');
}

export async function sendFoodOrderConfirmationEmail(recipientEmail: string, buyerName: string, orderId: string, itemName: string, amountPaisa: number, quantity: number, couponCode: string): Promise<boolean> {
  const params = { name: buyerName, orderid: orderId, items: itemName, amount: `Rs. ${(amountPaisa / 100).toFixed(2)}`, quantity: String(quantity), number: couponCode };
  return sendDynamicTemplateEmail(config.brevo.foodOrderTemplateId, recipientEmail, params, 'sendFoodOrderConfirmationEmail');
}

export async function sendBikeRackAssignmentEmail(recipientEmail: string, athleteName: string | null, eventName: string, bibNumber: string, rackName: string, eventDate: string | null, location: string | null): Promise<boolean> {
  const params = { name: athleteName || 'Athlete', event: eventName, bibno: bibNumber, rack: rackName, eventdate: eventDate ? formatDateFns(new Date(eventDate + 'T00:00:00Z'), 'MMM dd, yyyy') : 'TBD', location: location || 'Venue TBD' };
  return sendDynamicTemplateEmail(config.brevo.bikeRackingTemplateId, recipientEmail, params, 'sendBikeRackAssignmentEmail');
}

export async function sendContactEnquiryAckEmail(recipientEmail: string, name: string, mobile: string, message: string, ticketId: string, tags?: string[]): Promise<boolean> {
  const params: { [key: string]: any } = { fullName: name, ticketId: ticketId, email: recipientEmail, mobile: mobile, message: message };
  if (tags) params.addTags = tags;
  return sendDynamicTemplateEmail(config.brevo.contactEnquiryAckTemplateId, recipientEmail, params, 'sendContactEnquiryAckEmail');
}

export async function sendContactEnquiryAdminEmail(name: string, email: string, mobile: string, message: string, ticketId: string): Promise<boolean> {
  const params = { ticketId: ticketId, email: email, mobile: mobile, message: message };
  return sendDynamicTemplateEmail(config.brevo.contactEnquiryAdminTemplateId, "info@bergmantri.com", params, 'sendContactEnquiryAdminEmail');
}

export async function sendFeedbackCouponEmail(recipientEmail: string, name: string, couponCode: string): Promise<boolean> {
    const params = { name: name, couponCode: couponCode, eventname: 'Bergman Ozar' };
    return sendDynamicTemplateEmail(config.brevo.feedbackCouponTemplateId, recipientEmail, params, 'sendFeedbackCouponEmail');
}

export async function sendStoreOrderShippedEmail(params: {
    email: string;
    customer_name: string;
    order_id: string;
    courier_name: string;
    tracking_id: string;
    tracking_url: string;
}): Promise<boolean> {
    return sendDynamicTemplateEmail(config.brevo.storeOrderShippedTemplateId, params.email, params, 'sendStoreOrderShippedEmail');
}

export async function sendStoreOrderConfirmedEmail(params: {
    email: string;
    customer_name: string;
    order_id: string;
    order_date: string;
    product_summary: string;
    total_amount: number;
    payment_method: string;
    order_details_url: string;
    support_email: string;
}): Promise<boolean> {
    return sendDynamicTemplateEmail(config.brevo.storeOrderConfirmedTemplateId, params.email, params, 'sendStoreOrderConfirmedEmail');
}

export async function sendStoreAdminOrderAlertEmail(params: {
    customer_name: string;
    order_id: string;
    order_date: string;
    product_summary: string;
    total_amount: number;
    shipping_address: string;
    email: string;
    mobile: string;
}): Promise<boolean> {
    return sendDynamicTemplateEmail(config.brevo.storeAdminOrderAlertTemplateId, 'info@bergmantri.com', params, 'sendStoreAdminOrderAlertEmail');
}

export async function sendAthleteClubRemovalEmail(
  recipientEmail: string,
  athleteName: string | null,
  clubName: string | null,
  removedBy: string,
  removalDate: string,
  reason?: string | null
): Promise<boolean> {
  const subject = `Club Affiliation Removed: ${clubName}`;
  const htmlContent = `
    <p>Hello ${athleteName || 'Athlete'},</p>
    <p>This is to inform you that your affiliation with <strong>${clubName}</strong> has been removed by the ${removedBy}.</p>
    ${reason ? `<p><strong>Reason provided:</strong> ${reason}</p>` : ''}
    <p>If you have any questions, please contact the club owner.</p>
    <p>Regards,<br/>The Bergman Team</p>
  `;
  return sendRawHtmlEmail(recipientEmail, subject, htmlContent);
}
