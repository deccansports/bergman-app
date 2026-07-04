// src/lib/registrationEngine/stripeSync.ts
'use server';

import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import type { RegistrationAttempt } from '@/lib/types';
import { _mirrorParticipantToKV } from '@/lib/actions/dataSyncActions';
import { serializeParticipantData } from '@/lib/utils';
import { sendDynamicTemplateEmail } from '@/lib/auth/brevoService';
import { sendRegistrationInvoiceWhatsApp } from '@/lib/auth/aisensyService';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

const isUSA = (value?: string | null) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'usa' || v === 'us' || v === 'united states' || v === 'united states of america';
};

const isIndia = (value?: string | null) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'india' || v === 'in' || v === 'bharat';
};

const isInternational = (value?: string | null) => {
  const v = String(value || '').trim();
  if (!v) return false;
  return !isIndia(v);
};

async function sendStripeInvoiceNotifications(reg: any, invoice: Stripe.Invoice): Promise<void> {
  const actionName = 'sendStripeInvoiceNotifications';

  const recipientEmail = String(reg?.email || reg?.buyerEmail || '').trim().toLowerCase();
  const recipientMobile = String(reg?.mobile || '').trim();
  const invoiceNumber = String(invoice.number || invoice.id || '').trim();
  let invoicePdfUrl = String(invoice.invoice_pdf || '').trim();
  const hostedInvoiceUrl = String(invoice.hosted_invoice_url || '').trim();
  
  // If PDF URL not available, wait a moment and refresh the invoice
  if (!invoicePdfUrl && invoice.id) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s for PDF generation
      const refreshed = await stripe!.invoices.retrieve(invoice.id);
      invoicePdfUrl = String(refreshed.invoice_pdf || '').trim();
    } catch (e: any) {
      console.warn(`[${actionName}] Failed to refresh invoice for PDF URL:`, e?.message || e);
    }
  }

  const invoiceLink = invoicePdfUrl || hostedInvoiceUrl;
  const eventName = String(reg?.eventName || 'Bergman Event').trim();
  const category = String(reg?.ticketName || 'Race Entry').trim();
  const name = String(reg?.name || 'Athlete').trim();
  const amountInSmallestUnit = Number(reg?.pricingBreakdown?.totalPayable || reg?.amountPaidPaisa || 0);
  const currency = String(reg?.pricingBreakdown?.currency || 'INR').toUpperCase();

  // Email (Brevo template 256). Attach Stripe PDF when available; otherwise send with hosted link.
  if (recipientEmail && invoiceNumber && invoiceLink) {
    try {
      const payload = {
        name,
        event_name: eventName,
        invoice_number: invoiceNumber,
        category,
        event_date: reg?.eventDate || 'TBD',
        amount: (amountInSmallestUnit / 100).toFixed(2),
        currency: currency,
        event_link: hostedInvoiceUrl || 'https://www.bergmantri.com',
      };

      if (invoicePdfUrl) {
        try {
          const pdfRes = await fetch(invoicePdfUrl);
          if (pdfRes.ok) {
            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            
            // Save PDF to Firebase Storage
            try {
              const storage = getStorageInstance();
              const bucket = storage.bucket();
              const filePath = `invoices/stripe/${invoiceNumber}.pdf`;
              const file = bucket.file(filePath);
              await file.save(pdfBuffer, {
                metadata: {
                  contentType: 'application/pdf',
                },
              });
              console.log(`[${actionName}] Invoice PDF saved to storage: ${filePath}`);
            } catch (storageErr: any) {
              console.warn(`[${actionName}] Failed to save PDF to storage:`, storageErr?.message || storageErr);
            }
            
            await sendDynamicTemplateEmail(
              256,
              recipientEmail,
              payload,
              actionName,
              {
                content: pdfBuffer.toString('base64'),
                name: `Bergman_Invoice_${invoiceNumber}.pdf`,
              }
            );
          } else {
            console.warn(`[${actionName}] Failed to fetch Stripe invoice PDF for email: ${invoicePdfUrl}. Sending email without attachment.`);
            await sendDynamicTemplateEmail(256, recipientEmail, payload, actionName);
          }
        } catch (fetchErr: any) {
          console.warn(`[${actionName}] Error fetching/sending PDF:`, fetchErr?.message || fetchErr);
          await sendDynamicTemplateEmail(256, recipientEmail, payload, actionName);
        }
      } else {
        await sendDynamicTemplateEmail(256, recipientEmail, payload, actionName);
      }
    } catch (e: any) {
      console.warn(`[${actionName}] Email send failed for ${recipientEmail}:`, e?.message || e);
    }
  }

  // WhatsApp invoice with Stripe invoice link (PDF preferred; hosted URL fallback)
  if (recipientMobile && invoiceNumber && invoiceLink) {
    try {
      await sendRegistrationInvoiceWhatsApp({
        mobile: recipientMobile,
        firstName: name,
        eventName,
        invoiceNumber,
        invoiceUrl: invoiceLink,
        invoiceFileName: `Bergman_Invoice_${invoiceNumber}.pdf`,
      });
    } catch (e: any) {
      console.warn(`[${actionName}] WhatsApp send failed for ${recipientMobile}:`, e?.message || e);
    }
  }
}

export async function createStripeInvoiceForRegistration(eventId: string, participantId: string): Promise<void> {
  const actionName = 'createStripeInvoiceForRegistration';
  if (!stripe) throw new Error('Stripe is not configured.');

  const db = getFirestoreInstance();
  const participantRef = db.collection('events').doc(eventId).collection('participants').doc(participantId);
  const participantSnap = await participantRef.get();
  if (!participantSnap.exists) throw new Error('Participant record missing for Stripe invoice creation.');

  const reg = participantSnap.data() as any;
  const email = String(reg?.email || reg?.buyerEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Participant email is required for Stripe invoicing.');

  const bookingId = String(reg?.bookingId || participantId).trim();
  const pricing = reg?.pricingBreakdown || {};
  const totalPayable = Math.max(0, Number(pricing?.totalPayable || reg?.amountPaidPaisa || 0));
  const currency = String(pricing?.currency || 'USD').toLowerCase();
  if (!currency || currency.length !== 3) throw new Error(`Invalid currency for Stripe invoice: ${currency}`);

  console.log(`[${actionName}] Pricing breakdown for ${bookingId}:`, JSON.stringify(pricing, null, 2));
  console.log(`[${actionName}] Total payable: ${totalPayable}, Currency: ${currency}`);

  // Idempotency: if already stored as Stripe invoice, skip.
  if (String(reg?.invoiceProvider || '').toLowerCase() === 'stripe' && reg?.invoiceId) {
    console.log(`[${actionName}] Stripe invoice already exists for participant ${participantId}: ${reg.invoiceId}`);
    return;
  }

  let customerId: string | null = null;
  const existingCustomers = await stripe.customers.list({ email, limit: 1 });
  if (existingCustomers.data.length > 0) {
    customerId = existingCustomers.data[0].id;
  } else {
    const createdCustomer = await stripe.customers.create({
      email,
      name: reg?.name || 'Athlete',
      address: {
        country: isUSA(reg?.country) ? 'US' : (isIndia(reg?.country) ? 'IN' : undefined),
      },
      metadata: {
        participantId,
        eventId,
      },
    });
    customerId = createdCustomer.id;
  }

  // Create invoice first, then attach invoice items directly to this draft invoice.
  const draftInvoice = await stripe.invoices.create({
    customer: customerId,
    currency,
    auto_advance: false,
    metadata: {
      eventId,
      participantId,
      bookingId,
      source: 'bergman_registration',
    },
    description: `Bergman registration invoice for ${bookingId}`,
  });

  const lineItemsToCreate: Array<{ amount: number; description: string; lineType: string }> = [];

  const baseAmount = Math.max(0, Math.round(pricing?.base || 0));
  lineItemsToCreate.push({
    amount: baseAmount,
    description: `${reg?.eventName || 'Bergman Event'} - ${reg?.ticketName || 'Race Entry'}`,
    lineType: 'base',
  });

  const discountAmount = Math.round(Number(pricing?.discount || 0));
  if (discountAmount > 0) {
    lineItemsToCreate.push({
      amount: -discountAmount,
      description: 'Discount Applied',
      lineType: 'discount',
    });
  }

  const platformFeeAmount = Math.round(Number(pricing?.platformFeeBase || 0));
  if (platformFeeAmount > 0) {
    lineItemsToCreate.push({
      amount: platformFeeAmount,
      description: 'Convenience Fee',
      lineType: 'platformFee',
    });
  }

  const processingFeeAmount = Math.round(Number(pricing?.processingFeeBase || 0));
  if (processingFeeAmount > 0) {
    lineItemsToCreate.push({
      amount: processingFeeAmount,
      description: 'Processing Charges',
      lineType: 'processingFee',
    });
  }

  const taxAmount = Math.round(Number(pricing?.tax || 0));
  if (taxAmount > 0) {
    lineItemsToCreate.push({
      amount: taxAmount,
      description: 'Tax',
      lineType: 'tax',
    });
  }

  for (const item of lineItemsToCreate) {
    try {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: draftInvoice.id,
        currency,
        amount: item.amount,
        description: item.description,
        metadata: {
          eventId,
          participantId,
          bookingId,
          lineType: item.lineType,
        },
      });
      console.log(`[${actionName}] ${item.lineType} invoice item created: ${item.amount}`);
    } catch (e: any) {
      if (item.lineType === 'base') {
        console.error(`[${actionName}] Failed to create required base invoice item:`, e?.message || e);
        throw e;
      }
      console.error(`[${actionName}] Failed to create ${item.lineType} item:`, e?.message || e);
    }
  }

  // Verify invoice has line items
  const draftWithItems = await stripe.invoices.retrieve(draftInvoice.id);
  console.log(`[${actionName}] Draft invoice created with ${draftWithItems.lines.data.length} line items, amount due: ${draftWithItems.amount_due}`);
  
  if (draftWithItems.lines.data.length === 0) {
    console.warn(`[${actionName}] Warning: Draft invoice has no line items. Total amount due: ${draftWithItems.amount_due}. Expected: ${totalPayable}`);
  }

  const finalized = await stripe.invoices.finalizeInvoice(draftInvoice.id, { auto_advance: false });
  let paid: Stripe.Invoice;
  
  // Check if invoice is already marked as paid (happens automatically for $0 invoices)
  if (finalized.status === 'paid' || finalized.paid === true) {
    paid = finalized;
  } else if (totalPayable === 0) {
    // For zero-amount invoices, skip the pay call; Stripe marks them as paid automatically
    paid = finalized;
  } else {
    try {
      paid = await stripe.invoices.pay(finalized.id, { paid_out_of_band: true });
    } catch (e: any) {
      const msg = String(e?.raw?.message || e?.message || '').toLowerCase();
      if (msg.includes('already paid')) {
        paid = await stripe.invoices.retrieve(finalized.id);
      } else {
        throw e;
      }
    }
  }

  await participantRef.update({
    invoiceId: paid.id,
    invoiceNumber: paid.number || paid.id,
    invoiceProvider: 'stripe',
    stripeInvoiceUrl: paid.hosted_invoice_url || null,
    stripeInvoicePdf: paid.invoice_pdf || null,
    zohoSynced: true,
    zohoSyncError: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updatedParticipant = serializeParticipantData(await participantRef.get());
  await _mirrorParticipantToKV(updatedParticipant);

  // Send notifications (awaited to ensure they complete)
  try {
    await sendStripeInvoiceNotifications(reg, paid);
  } catch (e: any) {
    console.warn(`[${actionName}] Failed to send Stripe invoice notifications:`, e?.message || e);
  }

  console.log(`[${actionName}] Stripe invoice created for ${bookingId}: ${paid.id}`);
}
