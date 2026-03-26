// src/lib/actions/stripeActions.ts
'use server';
import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import type { Stripe } from 'stripe';
import { createZohoCustomer, findZohoCustomerByEmail } from '../zoho/customer';
import { createInvoice, emailZohoInvoice, markInvoiceAsSent, getInvoicePdf } from '../zoho/invoice';
import { applyPaymentToInvoice } from '../zoho/payments';
import { sendRegistrationInvoiceWhatsApp } from '../auth/aisensyService';
import { uploadInvoiceAndGetUrl } from './invoiceActions';

export async function createZohoInvoiceFromStripe(
  intent: Stripe.PaymentIntent,
  participantId: string,
  eventId: string,
  bookingId?: string | null,
): Promise<{ success: boolean; message: string; invoiceId?: string; }> {
  const actionName = 'createZohoInvoiceFromStripe';
  try {
    const adminDb = getFirestoreInstance();
    const email = intent.receipt_email || intent.metadata.email;
    const name = intent.metadata.name || email;
    if (!email) throw new Error("Email not found in Stripe Payment Intent.");

    // 1. Get or Create Zoho Customer
    let customer = await findZohoCustomerByEmail(email);
    if (!customer) {
      customer = await createZohoCustomer({ name, email, currency_code: 'USD' });
    }
    if (!customer || !customer.contact_id) throw new Error("Failed to create or find Zoho customer.");
    const customerId = customer.contact_id;

    // 2. Create Zoho Invoice
    const amountUSD = intent.amount_received / 100;
    const invoicePayload = {
      customerId: customerId,
      reference_number: bookingId || intent.id,
      date: new Date(intent.created * 1000).toISOString().split('T')[0],
      currency_code: "USD",
      place_of_supply: "US", // Set based on the user's request for USA events
      is_inclusive_tax: false,
      tax_treatment: "overseas",
      line_items: [{
        name: "BERGMAN Triathlon Registration",
        description: `Registration for ${intent.metadata.eventName}`,
        rate: amountUSD,
        quantity: 1,
        tax_id: "", // No GST for USD transactions
      }],
      custom_fields: [{
        label: "Stripe Payment ID",
        value: intent.id,
      }],
      notes: "Payment received via Stripe (US). Export of services. Tax exempt.",
    };
    
    const invoice = await createInvoice(invoicePayload);
    if (!invoice || !invoice.invoice_id) throw new Error("Zoho invoice creation failed.");

    await markInvoiceAsSent(invoice.invoice_id);
    await emailZohoInvoice(invoice.invoice_id);

    // 3. Mark Invoice as Paid
    await applyPaymentToInvoice({
      invoice_id: invoice.invoice_id,
      customer_id: customerId,
      amount: amountUSD,
      payment_date: new Date(intent.created * 1000).toISOString().split('T')[0],
      reference_number: intent.id,
      payment_mode: 'Stripe',
      currency: 'USD',
    });
    
    // 4. Update Participant document with Zoho details
    const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
    await participantRef.update({
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_number,
      zohoSynced: true,
    });
    
    // 5. Send WhatsApp notification with invoice
    const invoicePdfBuffer = await getInvoicePdf(invoice.invoice_id);
    const participantSnap = await participantRef.get();
    if (participantSnap.exists) {
        const pData = participantSnap.data();
        if (invoicePdfBuffer && pData && pData.mobile) {
            const invoiceFileName = `Bergman_Invoice_${invoice.invoice_number}.pdf`;
            const invoiceUrl = await uploadInvoiceAndGetUrl(invoicePdfBuffer, invoiceFileName);

            await sendRegistrationInvoiceWhatsApp({
                mobile: pData.mobile,
                firstName: pData.name,
                eventName: pData.eventName,
                invoiceNumber: invoice.invoice_number,
                invoiceUrl,
                invoiceFileName,
            });
        }
    }


    return { success: true, message: "Zoho invoice created and marked as paid.", invoiceId: invoice.invoice_id };

  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
    // Optionally update the participant with the error
    const participantRef = getFirestoreInstance().collection('events').doc(eventId).collection('participants').doc(participantId);
    await participantRef.set({ zohoSyncError: `Stripe-Zoho Sync Failed: ${error.message}` }, { merge: true });
    return { success: false, message: `Stripe-to-Zoho sync failed: ${error.message}` };
  }
}
