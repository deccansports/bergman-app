// src/lib/auth/brevoService.ts
import { authOtpConfig as config } from '@/lib/auth/authConfig';
import { format as formatDateFns, isValid as isDateValidFns } from 'date-fns';
import { findInvoiceByReference, getInvoicePdf } from '@/lib/zoho/invoice';
import juice from 'juice';
import { sendRawEmailViaProvider, sendTemplateEmailViaProvider } from '@/lib/auth/emailProvider';

export async function sendDynamicTemplateEmail(
  templateId: number,
  recipientEmail: string,
  params: Record<string, any>,
  actionLogName: string,
  attachment?: { content: string; name: string } | Array<{ content: string; name: string }> | null
): Promise<boolean> {
  if (templateId === 0) {
    console.warn(`[${actionLogName}] Email template ID is 0. Email for ${recipientEmail} not sent.`);
    return false;
  }
  
  const actionNameForLog = `EmailService ${actionLogName}`;
  try {
    const sent = await sendTemplateEmailViaProvider({
      templateId,
      recipientEmail,
      params: {
        ...params,
        params,
        variables: params,
        data: params,
        templateData: params,
      },
      senderEmail: config.brevo.senderEmail,
      senderName: config.brevo.senderName,
      attachment: attachment ? (Array.isArray(attachment) ? attachment : [attachment]) : undefined,
      tags: params.addTags && Array.isArray(params.addTags) ? params.addTags : undefined,
    });
    if (sent) {
      console.info(`[${actionNameForLog}] Successfully sent email to ${recipientEmail}.`);
      return true;
    }
    console.error(`[${actionNameForLog}] Failed email to ${recipientEmail}.`);
    return false;
  } catch (error: any) {
    console.error(`[${actionNameForLog}] FAILED email to ${recipientEmail}. Error: ${error.message}`);
    return false;
  }
}

export async function sendRawHtmlEmail(
    recipientEmail: string, 
    subject: string, 
    htmlContent: string,
  attachment?: { content: string; name: string } | Array<{ content: string; name: string }> | null
): Promise<boolean> {
  const actionLogName = 'EmailService sendRawHtmlEmail';
    
    try {
        // Ensure HTML is properly wrapped so email clients render it as HTML, not plain text
        const normalizedHtml = htmlContent.trimStart();
        const wrappedHtml = /^<!doctype|^<html/i.test(normalizedHtml)
          ? htmlContent
          : `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${htmlContent}</body></html>`;
        // Inline all CSS classes so Gmail and Outlook render them correctly
        // (email clients strip <style> blocks from <head>)
        const inlinedHtml = juice(wrappedHtml, {
          removeStyleTags: false,
          preserveMediaQueries: true,
          preserveFontFaces: true,
          preserveImportant: true,
          applyWidthAttributes: true,
          applyHeightAttributes: true,
        });
        const sent = await sendRawEmailViaProvider({
          recipientEmail,
          subject,
          htmlContent: inlinedHtml,
          senderEmail: config.brevo.senderEmail,
          senderName: config.brevo.senderName,
          attachment: attachment ? (Array.isArray(attachment) ? attachment : [attachment]) : undefined,
        });
        if (sent) {
          console.info(`[${actionLogName}] Successfully sent email to ${recipientEmail}.`);
          return true;
        }
        return false;
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
  const inboxHelp = 'OTP did not receive in Inbox? Please check Spam/Junk folder.';
  const params = {
    otp,
    name: name || 'Athlete',
    inbox_help: inboxHelp,
    inbox_note: inboxHelp,
    spam_note: inboxHelp,
  };
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
  organizerCompanyDescription?: string | null, country?: string | null, currency: 'INR' | 'USD' = 'INR',
  invoiceId?: string | null
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
    emergency_number: emergencyContact || 'N/A',
    emergency_contact: emergencyContact || 'N/A',
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

  // Best-effort invoice attachment: send confirmation even when invoice isn't synced yet.
  let attachment: { content: string; name: string } | null = null;
  try {
    let resolvedInvoiceId = String(invoiceId || '').trim() || null;

    if (!resolvedInvoiceId && invoiceNumber) {
      const found = await findInvoiceByReference(String(invoiceNumber));
      resolvedInvoiceId = found?.invoice_id ? String(found.invoice_id) : null;
    }

    if (resolvedInvoiceId) {
      const pdfBuffer = await getInvoicePdf(resolvedInvoiceId);
      if (pdfBuffer && pdfBuffer.length > 0) {
        const printableInvoiceNumber = String(invoiceNumber || '').trim() || resolvedInvoiceId;
        attachment = {
          content: pdfBuffer.toString('base64'),
          name: `Bergman_Invoice_${printableInvoiceNumber}.pdf`,
        };
      }
    }
  } catch (e: any) {
    console.warn(`[sendRegistrationConfirmationEmail] Invoice attachment unavailable: ${e?.message || e}`);
  }

  return sendDynamicTemplateEmail(templateId, recipientEmail, params, 'sendRegistrationConfirmationEmail', attachment);
}

export async function sendWaiverCheckedInEmail(
  recipientEmail: string, athleteName: string | null, eventName: string, ticketName: string, eventDate: string | null,
  address?: string | null, mobileNumber?: string | null, emergencyContact?: string | null,
  organizerName?: string | null, organizerAddress?: string | null,
  organizerCompanyDescription?: string | null, country?: string | null
): Promise<boolean> {
  const checkinDateTime = new Date();
  let formattedEventDate: string;
  try {
    if (eventDate && eventDate !== 'TBD') {
      formattedEventDate = formatDateFns(new Date(`${eventDate}T00:00:00Z`), 'MMM dd, yyyy');
    } else {
      formattedEventDate = 'TBD';
    }
  } catch (e) {
    formattedEventDate = eventDate ?? 'TBD';
  }

  // Detect USA event
  const isUSA = (value?: string | null) => {
    const v = String(value || '').trim().toLowerCase();
    return v === 'usa' || v === 'us' || v === 'united states' || v === 'united states of america';
  };

  const isUsaEvent = isUSA(country);
  const templateId = isUsaEvent ? config.brevo.waiverCheckedInUsaTemplateId : config.brevo.waiverCheckedInTemplateId;

  const params = {
    name: athleteName || 'Athlete',
    eventname: eventName,
    ticket: ticketName,
    eventdate: formattedEventDate,
    address: address || 'N/A',
    phone: mobileNumber || 'N/A',
    email: recipientEmail,
    emergencynumber: emergencyContact || 'N/A',
    emergency_number: emergencyContact || 'N/A',
    emergency_contact: emergencyContact || 'N/A',
    day: formatDateFns(checkinDateTime, 'do'),
    date: formatDateFns(checkinDateTime, 'MMMM, yyyy'),
    time: formatDateFns(checkinDateTime, 'p'),
    organizer_name: organizerName || 'Deccan Sports Club',
    company_description: organizerCompanyDescription || '',
    organizer_address: organizerAddress || '',
    country: country || 'India',
    EVENT_NAME: eventName,
  };

  console.log(`[sendWaiverCheckedInEmail] Sending waiver check-in email to ${recipientEmail}. IsUSA: ${isUsaEvent}, TemplateId: ${templateId}`);
  return sendDynamicTemplateEmail(templateId, recipientEmail, params, 'sendWaiverCheckedInEmail');
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

export async function sendContactEnquiryAckEmail(
  recipientEmail: string,
  name: string,
  mobile: string,
  message: string,
  ticketId: string,
  about?: string,
  selectedEventName?: string,
  selectedEventId?: string,
  tags?: string[]
): Promise<boolean> {
  const params: { [key: string]: any } = {
    // Primary keys
    fullName: name,
    ticketId,
    email: recipientEmail,
    mobile,
    message,
    about: about || 'General',
    selectedEventName: selectedEventName || '',
    selectedEventId: selectedEventId || '',
    selected_event_name: selectedEventName || '',
    selected_event_id: selectedEventId || '',
    eventname: selectedEventName || '',
    event_name: selectedEventName || '',
    eventId: selectedEventId || '',
    // Backward-compatible aliases used by existing templates
    name,
    ticket_id: ticketId,
  };
  if (tags) params.addTags = tags;
  return sendDynamicTemplateEmail(config.brevo.contactEnquiryAckTemplateId, recipientEmail, params, 'sendContactEnquiryAckEmail');
}

export async function sendContactEnquiryAdminEmail(
  name: string,
  email: string,
  mobile: string,
  message: string,
  ticketId: string,
  about?: string,
  selectedEventName?: string,
  selectedEventId?: string,
): Promise<boolean> {
  const params = {
    // Primary keys
    ticketId,
    fullName: name,
    email,
    mobile,
    message,
    about: about || 'General',
    selectedEventName: selectedEventName || '',
    selectedEventId: selectedEventId || '',
    selected_event_name: selectedEventName || '',
    selected_event_id: selectedEventId || '',
    eventname: selectedEventName || '',
    event_name: selectedEventName || '',
    eventId: selectedEventId || '',
    // Backward-compatible aliases used by existing templates
    name,
    ticket_id: ticketId,
  };
  return sendDynamicTemplateEmail(config.brevo.contactEnquiryAdminTemplateId, "info@bergmantri.com", params, 'sendContactEnquiryAdminEmail');
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendContactEnquiryReplyEmail(params: {
  recipientEmail: string;
  name: string;
  ticketId: string;
  replyMessage: string;
}): Promise<boolean> {
  const subject = `Reply to your enquiry (${params.ticketId})`;
  const safeName = escapeHtml(params.name || 'Athlete');
  const safeTicketId = escapeHtml(params.ticketId || 'N/A');
  const safeReply = escapeHtml(params.replyMessage || '').replace(/\n/g, '<br/>');

  const htmlContent = `
    <p>Hello ${safeName},</p>
    <p>Thank you for contacting Bergman Triathlon. Our team has replied to your enquiry.</p>
    <p><strong>Ticket ID:</strong> ${safeTicketId}</p>
    <p><strong>Reply:</strong></p>
    <p>${safeReply}</p>
    <p>If you need any further help, just reply to this email.</p>
    <p>Regards,<br/>Bergman Support Team</p>
  `;

  return sendRawHtmlEmail(params.recipientEmail, subject, htmlContent);
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
    shipping_address?: string;
    attachment?: { content: string; name: string };
}): Promise<boolean> {
  const payload = {
    ...params,
    // Alias keys to support different template variable naming conventions.
    name: params.customer_name,
    customerName: params.customer_name,
    orderId: params.order_id,
    orderid: params.order_id,
    orderDate: params.order_date,
    items: params.product_summary,
    productSummary: params.product_summary,
    total: params.total_amount,
    total_paid: params.total_amount,
    totalAmount: params.total_amount,
    paymentMode: params.payment_method,
    payment_mode: params.payment_method,
    order_url: params.order_details_url,
    supportEmail: params.support_email,
    shippingAddress: params.shipping_address || 'N/A',
    shipping_address: params.shipping_address || 'N/A',
  };

  return sendDynamicTemplateEmail(
    config.brevo.storeOrderConfirmedTemplateId,
    params.email,
    payload,
    'sendStoreOrderConfirmedEmail',
    params.attachment || null
  );
}

export async function sendStoreAdminOrderAlertEmail(params: {
  customer_name: string;
  order_id: string;
  order_date: string;
  product_summary: string;
  total_amount: number;
  shipping_address?: string;
  email?: string;
  mobile?: string;
  admin_email?: string;
  customer_email?: string;
  customer_phone?: string;
  payment_method?: string;
  admin_order_url?: string;
}): Promise<boolean> {
  const recipient = (params.admin_email || 'info@bergmantri.com').toLowerCase();
  const normalizedEmail = params.customer_email || params.email || 'N/A';
  const normalizedMobile = params.customer_phone || params.mobile || 'N/A';

  const payload = {
    ...params,
    email: normalizedEmail,
    mobile: normalizedMobile,
    customer_email: normalizedEmail,
    customer_phone: normalizedMobile,
    shipping_address: params.shipping_address || 'N/A',
    payment_method: params.payment_method || 'Online',
    admin_order_url: params.admin_order_url || 'https://bergmantri.com/admin/store-orders',
    orderId: params.order_id,
    orderDate: params.order_date,
    items: params.product_summary,
    total: params.total_amount,
  };

  return sendDynamicTemplateEmail(config.brevo.storeAdminOrderAlertTemplateId, recipient, payload, 'sendStoreAdminOrderAlertEmail');
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
