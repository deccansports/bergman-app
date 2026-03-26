// src/lib/actions/invoiceActions.ts
'use server';

import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { format } from 'date-fns';

import {
  createZohoCustomer,
  findZohoCustomerByEmail,
  findZohoCustomerByName,
  updateZohoCustomer
} from '@/lib/zoho/customer';

import {
  createInvoice,
  markInvoiceAsSent,
  findInvoiceByReference,
  getInvoicePdf,
} from '@/lib/zoho/invoice';

import { applyPaymentToInvoice } from '@/lib/zoho/payments';
import { getStateCode, getStateName, serializeParticipantData } from '@/lib/utils';
import { _mirrorParticipantToKV } from './dataSyncActions';
import { findPaymentByReference } from '@/lib/zoho/fetch';
import { startJob, updateJobProgress } from '@/lib/jobManager';
import type { PricingBreakdown } from '@/lib/types';

/**
 * SANITIZE DATA FOR ZOHO (INDIA EDITION)
 */
function sanitizeForZoho(val: string | null | undefined, length = 100): string {
  if (!val) return "";
  return val
    .replace(/[^\x20-\x7E]/g, "") // Keep only printable ASCII
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, length);
}

/**
 * RESOLVE ZOHO CUSTOMER
 */
async function resolveZohoCustomer(reg: any, participantRef: any) {
  if (reg.zohoCustomerId) return reg.zohoCustomerId;

  const cleanEmail = (reg.email || reg.buyerEmail || '').toLowerCase().trim();
  if (!cleanEmail) throw new Error("Missing email for Zoho customer resolution");

  let customer = await findZohoCustomerByEmail(cleanEmail);
  if (!customer) customer = await findZohoCustomerByName(reg.name);

  if (customer?.contact_id) {
    await participantRef.update({ zohoCustomerId: customer.contact_id });
    return customer.contact_id;
  }

  try {
    const contactName = sanitizeForZoho(`${reg.name || 'Athlete'} (${cleanEmail})`, 95);

    const created = await createZohoCustomer({
      contact_name: contactName,
      email: cleanEmail,
      phone: (reg.mobile || '').replace(/\D/g, '').slice(-10) || undefined,
      gst_treatment: reg.gstin ? "business_gst" : "consumer",
      gst_no: reg.gstin?.trim() || undefined,
      company_name: reg.businessName ? sanitizeForZoho(reg.businessName) : undefined,
      billing_address: {
        address: sanitizeForZoho(reg.address, 200) || undefined,
        city: sanitizeForZoho(reg.city) || undefined,
        state: getStateName(reg.state) || "Maharashtra",
        country: "India",
        zip: (reg.pincode || '').trim() || undefined
      }
    });

    await participantRef.update({ zohoCustomerId: created.contact_id });
    return created.contact_id;
  } catch (e: any) {
    if (e.zohoCode === 1001 || e.message?.toLowerCase()?.includes('already exists')) {
        const rescueMatch = await findZohoCustomerByName(reg.name);
        if (rescueMatch?.contact_id) {
            await participantRef.update({ zohoCustomerId: rescueMatch.contact_id });
            return rescueMatch.contact_id;
        }
    }
    throw e; 
  }
}

/**
 * CORE SYNC ACTION: Context-Aware Invoicing Strategy
 */
export async function syncPaymentToZohoAction(eventId: string, participantId: string) {
  const db = getFirestoreInstance();
  const participantRef = db.collection('events').doc(eventId).collection('participants').doc(participantId);

  try {
    const snap = await participantRef.get();
    if (!snap.exists) throw new Error("Participant record missing.");
    const reg = snap.data() as any;

    const bookingId = reg.bookingId;
    if (!bookingId) throw new Error("Booking ID missing.");

    const customerId = await resolveZohoCustomer(reg, participantRef);
    const pricing: PricingBreakdown = reg.pricingBreakdown;
    if (!pricing) throw new Error("Pricing breakdown metadata missing.");

    const isB2B = !!reg.gstin && reg.confirmGstDetails !== false;
    let invoice = await findInvoiceByReference(bookingId);

    if (!invoice) {
        // Mode A: Detailed B2B Invoice
        if (isB2B) {
            const stateCode = (getStateCode(reg.state) || 'MH').toUpperCase();
            const isInterstate = stateCode !== "MH";
            const taxId = isInterstate ? process.env.ZOHO_GST_INTERSTATE_ID : process.env.ZOHO_GST_INTRASTATE_ID;

            const payload: any = {
                customer_id: customerId,
                reference_number: bookingId,
                date: format(new Date(), "yyyy-MM-dd"),
                gst_treatment: "business_gst",
                place_of_supply: stateCode,
                is_inclusive_tax: false, 
                adjustment: Number((pricing.roundingAdjustment / 100).toFixed(2)),
                adjustment_description: "Rounding Adjustment",
                line_items: []
            };

            payload.line_items.push({
              name: `Race Entry: ${reg.ticketName || 'Registration'}`,
              rate: Number((pricing.base / 100).toFixed(2)),
              quantity: 1,
              tax_id: taxId,
              hsn_or_sac: "999652"
            });

            if (pricing.discount > 0) {
              payload.line_items.push({
                name: "Discount Applied",
                rate: -Number((pricing.discount / 100).toFixed(2)),
                quantity: 1,
                tax_id: taxId
              });
            }

            if (pricing.platformFeeBase > 0) {
              payload.line_items.push({
                name: "Convenience Fee",
                rate: Number((pricing.platformFeeBase / 100).toFixed(2)),
                quantity: 1,
                tax_id: taxId,
                hsn_or_sac: "999799"
              });
            }

            if (pricing.processingFeeBase > 0) {
              payload.line_items.push({
                name: "Processing Charges",
                rate: Number((pricing.processingFeeBase / 100).toFixed(2)),
                quantity: 1,
                tax_id: taxId,
                hsn_or_sac: "998431"
              });
            }

            console.log(`[Zoho Sync B2B] Creating invoice for ${bookingId}:`, JSON.stringify(payload, null, 2));
            invoice = await createInvoice(payload);
        } 
        // Mode B: Simple B2C Invoice (Tax Inclusive to prevent mismatches)
        else {
            const totalInRupees = Number((pricing.totalPayable / 100).toFixed(2));
            const b2cPayload = {
                customer_id: customerId,
                reference_number: bookingId,
                date: format(new Date(), "yyyy-MM-dd"),
                gst_treatment: "consumer",
                is_inclusive_tax: true, 
                line_items: [{
                    name: `Registration - ${reg.eventName} (${reg.ticketName || 'Race Entry'})`,
                    rate: totalInRupees,
                    quantity: 1
                }]
            };
            console.log(`[Zoho Sync B2C] Creating invoice for ${bookingId}:`, JSON.stringify(b2cPayload, null, 2));
            invoice = await createInvoice(b2cPayload);
        }
        await markInvoiceAsSent(invoice.invoice_id);
    }

    // RECONCILE PAYMENT
    const paymentRef = reg.paymentId || reg.transactionId || bookingId;
    const existingPayment = await findPaymentByReference(paymentRef);

    if (!existingPayment) {
        await applyPaymentToInvoice({
            invoice_id: invoice.invoice_id,
            customer_id: customerId,
            amount: Number((pricing.totalPayable / 100).toFixed(2)),
            payment_date: format(new Date(), "yyyy-MM-dd"),
            reference_number: paymentRef,
            payment_mode: "Online"
        });
    }

    await participantRef.update({
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_number,
      zohoSynced: true,
      zohoSyncError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });

    const updatedParticipant = serializeParticipantData(await participantRef.get());
    await _mirrorParticipantToKV(updatedParticipant);

    // 🔥 Trigger WhatsApp Delivery
    sendWhatsAppInvoiceAction(eventId, participantId).catch(err => {
        console.warn(`[Zoho Sync] WhatsApp delivery failed for ${bookingId}:`, err.message);
    });

    return { success: true, message: `Synced: ${invoice.invoice_number}` };

  } catch (error: any) {
    const errorMsg = error.zohoMessage || error.message || "Unknown error";
    const errorCode = error.zohoCode || error.response?.status || "Unknown";
    console.error(`[Zoho Sync Fatal] Participant ID: ${participantId}`);
    console.error(`[Zoho Sync Fatal] Error Code: ${errorCode}, Message: ${errorMsg}`);
    console.error(`[Zoho Sync Fatal] Full Error:`, JSON.stringify(error, null, 2));
    await participantRef.update({ zohoSynced: false, zohoSyncError: `${errorCode}: ${errorMsg}`, updatedAt: FieldValue.serverTimestamp() });
    return { success: false, message: errorMsg };
  }
}

/**
 * RE-APPLY PAYMENT ONLY
 */
export async function syncOnlyPaymentToZohoAction(eventId: string, participantId: string) {
    const db = getFirestoreInstance();
    const participantRef = db.collection('events').doc(eventId).collection('participants').doc(participantId);

    try {
        const snap = await participantRef.get();
        const reg = snap.data() as any;
        if (!reg.invoiceId) throw new Error("Record missing Zoho invoice ID.");

        const customerId = await resolveZohoCustomer(reg, participantRef);
        const paymentRef = reg.paymentId || reg.transactionId || reg.bookingId;
        const amount = Number(((reg.amountPaidPaisa || reg.pricingBreakdown?.totalPayable || 0) / 100).toFixed(2));

        const existingPayment = await findPaymentByReference(paymentRef);
        if (!existingPayment) {
            await applyPaymentToInvoice({
                invoice_id: reg.invoiceId,
                customer_id: customerId,
                amount,
                payment_date: format(new Date(), "yyyy-MM-dd"),
                reference_number: paymentRef,
                payment_mode: "Online"
            });
        }

        await participantRef.update({ zohoSynced: true, zohoSyncError: FieldValue.delete() });
        await _mirrorParticipantToKV(serializeParticipantData(await participantRef.get()));

        // Trigger WhatsApp
        sendWhatsAppInvoiceAction(eventId, participantId).catch(() => {});

        return { success: true, message: "Payment reconciled and WhatsApp triggered." };
    } catch (e: any) {
        return { success: false, message: e.zohoMessage || e.message };
    }
}

/**
 * CREATE SERVICE FEE INVOICE
 */
export async function createServiceFeeInvoiceAction(params: any) {
  const { customerId, reference, date, pricing, serviceType, eventName, userState, currency = 'INR' } = params;
  
  const totalInRupees = Number((pricing.totalPayable / 100).toFixed(2));

  // ALWAYS use inclusive mode for service fees to prevent rounding rejections
  const invoice = await createInvoice({
    customer_id: customerId,
    reference_number: reference,
    date,
    is_inclusive_tax: true, 
    gst_treatment: "consumer",
    currency_code: currency,
    line_items: [{ 
        name: `${serviceType} Fee - ${eventName}`, 
        rate: totalInRupees, 
        quantity: 1
    }]
  });
  
  return { invoice_id: invoice.invoice_id, invoiceNumber: invoice.invoice_number };
}

export async function syncMissingZohoInvoicesAction(startDate: string, endDate: string, _newInvoiceDate: string) {
  const { jobId } = await startJob();
  const db = getFirestoreInstance();
  (async () => {
    try {
      const snap = await db.collectionGroup('participants').where('registeredAt', '>=', startDate).where('registeredAt', '<=', endDate + 'T23:59:59Z').get();
      const total = snap.size;
      let processed = 0;
      for (const doc of snap.docs) {
        const p = doc.data();
        if (!p.invoiceId && p.ticketStatus === 'Active') await syncPaymentToZohoAction(p.eventId, doc.id);
        processed++;
        await updateJobProgress(jobId, { progress: (processed / total) * 100 });
      }
      await updateJobProgress(jobId, { status: 'completed', message: `Processed ${total} records.` });
    } catch (e: any) { await updateJobProgress(jobId, { status: 'failed', message: e.message }); }
  })();
  return { success: true, message: "Job started.", jobId };
}

export async function uploadInvoiceAndGetUrl(invoicePdfBuffer: Buffer, fileName: string): Promise<string> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) throw new Error("Storage bucket not configured.");
  
  const bucket = getStorageInstance().bucket(bucketName);
  const filePath = `invoices_registration/${fileName}`;
  const file = bucket.file(filePath);
  
  await file.save(invoicePdfBuffer, { 
    metadata: { contentType: 'application/pdf' }, 
    public: true 
  });
  
  return `https://storage.googleapis.com/${bucketName}/${filePath}`;
}

export async function sendWhatsAppInvoiceAction(eventId: string, participantId: string) {
  const db = getFirestoreInstance();
  const snap = await db.collection('events').doc(eventId).collection('participants').doc(participantId).get();
  if (!snap.exists) return { success:false, message:"Not found" };
  const p = snap.data() as any;
  if (!p.invoiceId) return { success:false, message:"Invoice missing" };

  try {
    const pdf = await getInvoicePdf(p.invoiceId);
    if (!pdf) throw new Error("Failed to retrieve PDF.");
    const fileName = `Bergman_Invoice_${p.invoiceNumber}.pdf`;
    const url = await uploadInvoiceAndGetUrl(pdf, fileName);
    
    const { sendRegistrationInvoiceWhatsApp } = await import('@/lib/auth/aisensyService');
    await sendRegistrationInvoiceWhatsApp({ 
        mobile: p.mobile, 
        firstName: p.name || "Athlete", 
        eventName: p.eventName, 
        invoiceNumber: p.invoiceNumber, 
        invoiceUrl: url, 
        invoiceFileName: fileName 
    });
    return { success:true, message:"WhatsApp sent" };
  } catch(e:any) { 
    console.error("[sendWhatsAppInvoiceAction] Error:", e.message);
    return { success:false, message:e.message }; 
  }
}

export async function sendServiceFeeWhatsAppAction(params: {
    orderId: string,
    invoiceId: string,
    invoiceNumber: string,
    mobile: string,
    name: string,
    serviceType: string,
    eventName: string
}) {
    try {
        console.log(`[sendServiceFeeWhatsAppAction] Initiating delivery for ${params.invoiceNumber}...`);
        const pdf = await getInvoicePdf(params.invoiceId);
        if (!pdf) {
            console.error(`[sendServiceFeeWhatsAppAction] Failed to fetch PDF for ${params.invoiceId}`);
            return { success: false, message: "PDF fetch failed" };
        }
        
        const fileName = `Bergman_${params.serviceType.replace(/\s+/g, '_')}_${params.invoiceNumber}.pdf`;
        const url = await uploadInvoiceAndGetUrl(pdf, fileName);
        
        const { sendServiceFeeInvoiceWhatsApp } = await import('@/lib/auth/aisensyService');
        await sendServiceFeeInvoiceWhatsApp({
            mobile: params.mobile,
            firstName: params.name,
            serviceType: params.serviceType,
            eventName: params.eventName,
            invoiceNumber: params.invoiceNumber,
            invoiceUrl: url,
            invoiceFileName: fileName
        });
        console.log(`[sendServiceFeeWhatsAppAction] WhatsApp dispatched for ${params.invoiceNumber}`);
        return { success: true };
    } catch (e: any) {
        console.error(`[sendServiceFeeWhatsAppAction] Fatal Error:`, e.message);
        return { success: false, message: e.message };
    }
}
