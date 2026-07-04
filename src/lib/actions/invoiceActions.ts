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
  getZohoInvoiceById,
} from '@/lib/zoho/invoice';

import { applyPaymentToInvoice } from '@/lib/zoho/payments';
import { getStateCode, getStateName, serializeParticipantData } from '@/lib/utils';
import { _mirrorParticipantToKV } from './dataSyncActions';
import { findPaymentByReference } from '@/lib/zoho/fetch';
import { startJob, updateJobProgress } from '@/lib/jobManager';
import { sendDynamicTemplateEmail } from '@/lib/auth/brevoService';
import type { PricingBreakdown } from '@/lib/types';

async function deliverRegistrationInvoiceNotifications(
  participantRef: FirebaseFirestore.DocumentReference,
  reg: any,
  invoiceId: string,
  invoiceNumber: string,
  options?: { sendWhatsApp?: boolean }
): Promise<void> {
  const sendWhatsApp = options?.sendWhatsApp !== false;
  const updates: Record<string, any> = {};

  if (reg.email && !reg.invoiceEmailSentAt) {
    const emailRes = await sendInvoiceEmailBrevoAction({
      invoiceId,
      invoiceNumber,
      recipientEmail: String(reg.email).toLowerCase(),
      name: reg.name || 'Athlete',
      eventName: reg.eventName || 'Event',
      category: reg.ticketName || 'Race Entry',
      eventDate: reg.eventDate || null,
      amountPaisa: Number(reg.amountPaidPaisa || reg.pricingBreakdown?.totalPayable || 0),
    });
    if (emailRes.success) updates.invoiceEmailSentAt = FieldValue.serverTimestamp();
  }

  if (sendWhatsApp && reg.mobile && !reg.invoiceWhatsAppSentAt) {
    const db = getFirestoreInstance();
    const participantSnap = await participantRef.get();
    if (participantSnap.exists) {
      const whatsappRes = await sendWhatsAppInvoiceAction(
        participantRef.parent.parent!.id,
        participantRef.id
      );
      if (whatsappRes.success) updates.invoiceWhatsAppSentAt = FieldValue.serverTimestamp();
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = FieldValue.serverTimestamp();
    await participantRef.update(updates);
  }
}

function getOutstandingZohoBalance(invoice: any): number {
  const candidates = [invoice?.balance_due, invoice?.balance, invoice?.due_amount];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num)) return Number(num.toFixed(2));
  }
  return 0;
}

/**
 * SANITIZE DATA FOR ZOHO (INDIA EDITION)
 * Zoho has strict character limits - remove problematic characters
 */
function sanitizeForZoho(val: string | null | undefined, length = 100): string {
  if (!val) return "";
  return val
    .replace(/[^\x20-\x7E]/g, "") // Keep only printable ASCII
    .replace(/[<>"'`]/g, "") // Remove HTML/special chars that cause API errors
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, length);
}

/**
 * RESOLVE ZOHO CUSTOMER
 */
async function resolveZohoCustomer(reg: any, participantRef: any) {
  const normalizedGstin = String(reg.gstin || '').trim().toUpperCase();
  const isB2B = !!normalizedGstin;

  if (reg.zohoCustomerId) {
    // Keep existing Zoho contact GST profile in sync for B2B so GSTIN shows on invoice.
    if (isB2B) {
      const isIndianAddress = (reg.country || '').trim().toLowerCase() === 'india';
      const zohoBillingState = isIndianAddress ? (getStateName(reg.state) || 'Maharashtra') : 'Maharashtra';
      const contactName = reg.businessName
        ? sanitizeForZoho(reg.businessName, 95)
        : sanitizeForZoho(`${reg.name || 'Athlete'} (${String(reg.email || reg.buyerEmail || '').toLowerCase().trim()})`, 95);
      try {
        await updateZohoCustomer(String(reg.zohoCustomerId), {
          contact_name: contactName,
          gst_treatment: 'business_gst',
          gst_no: normalizedGstin,
          company_name: reg.businessName ? sanitizeForZoho(reg.businessName) : undefined,
          billing_address: {
            address: sanitizeForZoho(reg.address, 128) || undefined,
            city: sanitizeForZoho(reg.city, 50) || undefined,
            state: zohoBillingState,
            country: 'India',
            zip: (reg.pincode || '').trim() || undefined,
          },
        });
      } catch (e: any) {
        console.warn('[resolveZohoCustomer] Could not refresh GST profile for existing Zoho customer:', e?.message || e);
      }
    }
    return reg.zohoCustomerId;
  }

  const cleanEmail = (reg.email || reg.buyerEmail || '').toLowerCase().trim();
  if (!cleanEmail) throw new Error("Missing email for Zoho customer resolution");

  let customer = await findZohoCustomerByEmail(cleanEmail);
  if (!customer) customer = await findZohoCustomerByName(reg.name);

  if (customer?.contact_id) {
    if (isB2B) {
      const isIndianAddress = (reg.country || '').trim().toLowerCase() === 'india';
      const zohoBillingState = isIndianAddress ? (getStateName(reg.state) || 'Maharashtra') : 'Maharashtra';
      const existingGstin = String(customer?.gst_no || '').trim().toUpperCase();
      const existingTreatment = String(customer?.gst_treatment || '').trim().toLowerCase();
      const needsGstUpdate = existingGstin !== normalizedGstin || existingTreatment !== 'business_gst';
      if (needsGstUpdate) {
        try {
          await updateZohoCustomer(customer.contact_id, {
            contact_name: reg.businessName
              ? sanitizeForZoho(reg.businessName, 95)
              : sanitizeForZoho(`${reg.name || 'Athlete'} (${cleanEmail})`, 95),
            gst_treatment: 'business_gst',
            gst_no: normalizedGstin,
            company_name: reg.businessName ? sanitizeForZoho(reg.businessName) : undefined,
            billing_address: {
              address: sanitizeForZoho(reg.address, 128) || undefined,
              city: sanitizeForZoho(reg.city, 50) || undefined,
              state: zohoBillingState,
              country: 'India',
              zip: (reg.pincode || '').trim() || undefined,
            },
          });
        } catch (e: any) {
          console.warn('[resolveZohoCustomer] Existing contact GST update failed:', e?.message || e);
        }
      }
    }
    await participantRef.update({ zohoCustomerId: customer.contact_id });
    return customer.contact_id;
  }

  try {
    const isIndianAddress = (reg.country || '').trim().toLowerCase() === 'india';
    const zohoBillingState = isIndianAddress ? (getStateName(reg.state) || 'Maharashtra') : 'Maharashtra';

    // For B2B invoices, use company name as contact name
    const contactName = isB2B && reg.businessName
      ? sanitizeForZoho(reg.businessName, 95)
      : sanitizeForZoho(`${reg.name || 'Athlete'} (${cleanEmail})`, 95);

    const created = await createZohoCustomer({
      contact_name: contactName,
      email: cleanEmail,
      phone: (reg.mobile || '').replace(/\D/g, '').slice(-10) || undefined,
      gst_treatment: isB2B ? "business_gst" : "consumer",
      gst_no: isB2B ? normalizedGstin : undefined,
      company_name: reg.businessName ? sanitizeForZoho(reg.businessName) : undefined,
      billing_address: {
        address: sanitizeForZoho(reg.address, 128) || undefined,
        city: sanitizeForZoho(reg.city, 50) || undefined,
        state: zohoBillingState,
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
 * Helper functions for Stripe detection
 */
const isUSA = (value?: string | null) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'usa' || v === 'us' || v === 'united states' || v === 'united states of america';
};

const isInternational = (value?: string | null) => {
  const v = String(value || '').trim();
  if (!v) return false;
  const isIndia = v.toLowerCase() === 'india' || v.toLowerCase() === 'in' || v.toLowerCase() === 'bharat';
  return !isIndia;
};

/**
 * CORE SYNC ACTION: Context-Aware Invoicing Strategy
 */
export async function syncPaymentToZohoAction(eventId: string, participantId: string) {
  const db = getFirestoreInstance();
  const actionName = 'syncPaymentToZohoAction';
  const participantRef = db.collection('events').doc(eventId).collection('participants').doc(participantId);
  let participantExists = false;
  let syncLockAcquired = false;

  const releaseSyncLock = async () => {
    if (!syncLockAcquired) return;
    syncLockAcquired = false;
    try {
      await participantRef.set(
        {
          zohoSyncPending: false,
          zohoSyncLock: FieldValue.delete(),
          zohoSyncStartedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (lockErr) {
      console.warn(`[${actionName}] Failed to release sync lock for ${participantId}:`, lockErr);
    }
  };

  try {
    console.log(`[${actionName}] 🚀 Starting Zoho sync for participant ${participantId} in event ${eventId}`);
    const lockResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(participantRef);
      if (!snap.exists) throw new Error('Participant record missing.');

      const reg = snap.data() as any;
      if (reg.zohoSynced && reg.invoiceId) {
        return { acquired: false, status: 'already_synced' as const, reg };
      }
      if (reg.zohoSyncPending) {
        return { acquired: false, status: 'in_progress' as const, reg };
      }

      tx.update(participantRef, {
        zohoSyncPending: true,
        zohoSyncLock: `zoho-sync-${participantId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        zohoSyncStartedAt: FieldValue.serverTimestamp(),
        zohoSyncError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { acquired: true, status: 'acquired' as const, reg };
    });

    if (!lockResult.acquired) {
      if (lockResult.status === 'already_synced' && lockResult.reg?.invoiceId) {
        await deliverRegistrationInvoiceNotifications(
          participantRef,
          lockResult.reg,
          lockResult.reg.invoiceId,
          lockResult.reg.invoiceNumber || lockResult.reg.invoiceId,
          { sendWhatsApp: false }
        );
        return { success: true, message: `Already synced: ${lockResult.reg.invoiceNumber || lockResult.reg.invoiceId}` };
      }

      return { success: false, message: 'Zoho sync is already running for this registration. Please wait and try again.' };
    }

    syncLockAcquired = true;
    participantExists = true;
    const reg = lockResult.reg;

    console.log(`[${actionName}] Participant loaded: ${reg.name}, bookingId: ${reg.bookingId}, zohoSynced: ${reg.zohoSynced}`);

    const bookingId = reg.bookingId;
    if (!bookingId) throw new Error("Booking ID missing.");

    // Check if this should use Stripe instead of Zoho (USA/USD/International events)
    console.log(`[${actionName}] Checking invoice routing strategy...`);
    const eventSnap = await db.collection('events').doc(eventId).get();
    const eventData = eventSnap.exists ? (eventSnap.data() as any) : null;
    const paymentCurrency = String(reg?.pricingBreakdown?.currency || eventData?.currency || '').toUpperCase();
    const isInrPayment = !paymentCurrency || paymentCurrency === 'INR';
    
    if (
      !isInrPayment && (
        paymentCurrency === 'USD' ||
        isUSA(eventData?.country) ||
        isUSA(reg?.country) ||
        isInternational(eventData?.country) ||
        isInternational(reg?.country)
      )
    ) {
      // Delegate to Stripe invoice creation
      const { createStripeInvoiceForRegistration } = await import('@/lib/registrationEngine/stripeSync');
      await createStripeInvoiceForRegistration(eventId, participantId);
      const updatedSnap = await participantRef.get();
      const updated = updatedSnap.data() as any;
      return { success: true, message: `Stripe invoice synced: ${updated?.invoiceNumber || updated?.invoiceId}` };
    }

    // If invoice already exists and is synced, just return success (idempotent).
    if (reg.zohoSynced && reg.invoiceId) {
      await deliverRegistrationInvoiceNotifications(participantRef, reg, reg.invoiceId, reg.invoiceNumber || reg.invoiceId, { sendWhatsApp: false });
      return { success: true, message: `Already synced: ${reg.invoiceNumber || reg.invoiceId}` };
    }

    // If invoice already exists in Zoho (by reference) but zohoSynced is false, recover it.
    const existingInvoice = await findInvoiceByReference(bookingId);
    if (existingInvoice) {
      await participantRef.update({
        invoiceId: existingInvoice.invoice_id,
        invoiceNumber: existingInvoice.invoice_number,
        zohoSynced: true,
        zohoSyncError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const updatedParticipant = serializeParticipantData(await participantRef.get());
      await _mirrorParticipantToKV(updatedParticipant, true);
      await deliverRegistrationInvoiceNotifications(
        participantRef,
        { ...reg, ...updatedParticipant },
        existingInvoice.invoice_id,
        existingInvoice.invoice_number,
        { sendWhatsApp: false }
      );
      console.log(`[Zoho Sync] Recovered existing invoice ${existingInvoice.invoice_number} for ${bookingId}`);
      return { success: true, message: `Recovered existing invoice: ${existingInvoice.invoice_number}` };
    }

    const customerId = await resolveZohoCustomer(reg, participantRef);

    // Build a fallback pricing breakdown for legacy registrations that lack pricingBreakdown.
    let pricing: PricingBreakdown = reg.pricingBreakdown;
    if (!pricing) {
      const totalPaisa = Number(reg.amountPaidPaisa || reg.originalAmountPaidAtFirstRegistrationPaisa || 0);
      if (totalPaisa <= 0) throw new Error("Cannot create invoice: no amount and no pricing breakdown.");
      console.warn(`[Zoho Sync] pricingBreakdown missing for ${bookingId}, building fallback from amountPaidPaisa=${totalPaisa}`);
      pricing = {
        base: totalPaisa,
        discount: 0,
        eventGST: 0,
        platformFeeBase: 0,
        platformGST: 0,
        processingFeeBase: 0,
        processingGST: 0,
        totalPayable: totalPaisa,
        roundingAdjustment: 0,
        gstRate: 0.18,
        currency: 'INR',
        version: 'v3.0.0',
      };
    }

    const isB2B = !!String(reg.gstin || '').trim();
    // We already checked for an existing invoice above and returned early if found.
    // Proceed directly to create.
    let invoice: any;

    {
        // Mode A: Detailed B2B Invoice
        if (isB2B) {
          const isIndianAddress = (reg.country || '').trim().toLowerCase() === 'india';
          const stateCode = (isIndianAddress ? (getStateCode(reg.state) || 'MH') : 'MH').toUpperCase();
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

            // place_of_supply and tax_id are mandatory in Zoho Books India even for B2C consumer invoices.
            const isIndianAddress = (reg.country || '').trim().toLowerCase() === 'india';
            const b2cStateCode = (isIndianAddress ? (getStateCode(reg.state) || 'MH') : 'MH').toUpperCase();
            const b2cIsInterstate = b2cStateCode !== 'MH';

            // Select tax rate bucket from pricing breakdown (default 18%)
            const gstRate = pricing.gstRate ?? 0.18;
            const b2cTaxId = gstRate <= 0.051
              ? (b2cIsInterstate ? process.env.ZOHO_GST5_INTERSTATE_ID : process.env.ZOHO_GST5_INTRASTATE_ID)
              : (b2cIsInterstate ? process.env.ZOHO_GST_INTERSTATE_ID : process.env.ZOHO_GST_INTRASTATE_ID);

            const b2cLineItem: any = {
                name: sanitizeForZoho(`Registration - ${reg.eventName} (${reg.ticketName || 'Race Entry'})`, 200),
                rate: totalInRupees,
                quantity: 1,
                hsn_or_sac: "999652",
            };
            if (b2cTaxId) b2cLineItem.tax_id = b2cTaxId;

            const b2cPayload: any = {
                customer_id: customerId,
                reference_number: bookingId,
                date: format(new Date(), "yyyy-MM-dd"),
                gst_treatment: "consumer",
                place_of_supply: b2cStateCode,
                is_inclusive_tax: true,
                line_items: [b2cLineItem],
            };
            console.log(`[Zoho Sync B2C] Creating invoice for ${bookingId}:`, JSON.stringify(b2cPayload, null, 2));
            invoice = await createInvoice(b2cPayload);
        }
        await markInvoiceAsSent(invoice.invoice_id);
    }

    // RECONCILE PAYMENT
    const paymentRef = reg.paymentId || reg.transactionId || bookingId;
    const existingPayment = await findPaymentByReference(paymentRef);

    // Always trust Zoho's current outstanding balance on the invoice.
    // If an earlier payment exists with the same reference but is not applied to this invoice,
    // the invoice will still show balance due and we must settle that balance now.
    let liveInvoiceAfterCreate = null;
    try {
      liveInvoiceAfterCreate = await getZohoInvoiceById(invoice.invoice_id);
    } catch {
      // Fallback below will use local totalPayable
    }

    const outstandingBalance = getOutstandingZohoBalance(liveInvoiceAfterCreate);
    const fallbackAmount = Number((pricing.totalPayable / 100).toFixed(2));
    const effectiveOutstanding = outstandingBalance > 0.009 ? outstandingBalance : fallbackAmount;
    if (!existingPayment || effectiveOutstanding > 0.009) {
      const paymentAmount = effectiveOutstanding;

        const paymentReference = existingPayment
          ? `${paymentRef}-${String(invoice.invoice_number || invoice.invoice_id).slice(-10)}`
          : paymentRef;

        await applyPaymentToInvoice({
            invoice_id: invoice.invoice_id,
            customer_id: customerId,
            amount: paymentAmount,
            payment_date: format(new Date(), "yyyy-MM-dd"),
            reference_number: paymentReference,
            payment_mode: "Online"
        });
    }

    await participantRef.update({
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_number,
      zohoSynced: true,
      zohoSyncPending: false,
      zohoSyncError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });

    const updatedParticipant = serializeParticipantData(await participantRef.get());
    await _mirrorParticipantToKV(updatedParticipant, true);

    await deliverRegistrationInvoiceNotifications(
      participantRef,
      { ...reg, ...updatedParticipant },
      invoice.invoice_id,
      invoice.invoice_number,
      { sendWhatsApp: false }
    );

    console.log(`[Zoho Sync] Invoice ${invoice.invoice_number} created and participant updated for ${bookingId}.`);
    return { success: true, message: `Synced: ${invoice.invoice_number}`, invoiceNumber: invoice.invoice_number, invoiceId: invoice.invoice_id };

  } catch (error: any) {
    const errorMsg = error.zohoMessage || error.message || "Unknown error";
    const errorCode = error.zohoCode || error.response?.status || "Unknown";
    const isMissingParticipant = String(errorMsg).toLowerCase().includes('participant record missing');

    if (isMissingParticipant) {
      console.warn(`[Zoho Sync] Skipped missing participant ${eventId}/${participantId}`);
      return {
        success: false,
        message: 'Participant record missing.',
        diagnostic: 'Participant may have been deleted or moved.'
      };
    }
    
    // Enhanced error logging with diagnostic context
    console.error(`[Zoho Sync Fatal] Participant ID: ${participantId}`);
    console.error(`[Zoho Sync Fatal] Error Code: ${errorCode}, Message: ${errorMsg}`);
    
    // Diagnostic suggestions based on error type
    let diagnostic = "";
    if (errorCode === 400 || errorMsg?.includes('invalid_grant')) {
      diagnostic = "\n💡 DIAGNOSTIC: Zoho refresh token likely expired. Run: /api/zoho-diagnose";
    } else if (errorCode === 401 || errorMsg?.includes('unauthorized')) {
      diagnostic = "\n💡 DIAGNOSTIC: Zoho access token invalid. Check ZOHO_CLIENT_ID/SECRET.";
    } else if (errorCode === 429) {
      diagnostic = "\n💡 DIAGNOSTIC: Zoho rate limited. Retry after a few seconds.";
    } else if (errorCode === 'AUTH_FAILED') {
      diagnostic = "\n💡 DIAGNOSTIC: Zoho authentication failed. Visit /api/zoho-diagnose for details.";
    }
    
    console.error(`[Zoho Sync Fatal] Full Error:`, JSON.stringify(error, null, 2), diagnostic);
    
    if (participantExists) {
      try {
        await participantRef.update({
          zohoSynced: false,
          zohoSyncError: `${errorCode}: ${errorMsg}`,
          updatedAt: FieldValue.serverTimestamp()
        });
      } catch (updateErr: any) {
        console.warn(`[Zoho Sync Fatal] Could not persist error on participant ${participantId}:`, updateErr?.message || updateErr);
      }
    } else {
      console.warn(`[Zoho Sync Fatal] Skipped participant update because document does not exist: ${eventId}/${participantId}`);
    }
    
    return { 
      success: false, 
      message: errorMsg,
      diagnostic: "Check /api/zoho-diagnose for more details on the Zoho authentication issue"
    };
  } finally {
    await releaseSyncLock();
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
        let liveInvoice = null;
        try {
          liveInvoice = await getZohoInvoiceById(reg.invoiceId);
        } catch {
          // Fall back below
        }
        const outstandingBalance = getOutstandingZohoBalance(liveInvoice);
        const effectiveOutstanding = outstandingBalance > 0.009 ? outstandingBalance : amount;
        if (!existingPayment || effectiveOutstanding > 0.009) {
          const paymentAmount = effectiveOutstanding;
          const paymentReference = existingPayment
            ? `${paymentRef}-${String(reg.invoiceNumber || reg.invoiceId).slice(-10)}`
            : paymentRef;
          await applyPaymentToInvoice({
            invoice_id: reg.invoiceId,
            customer_id: customerId,
            amount: paymentAmount,
            payment_date: format(new Date(), "yyyy-MM-dd"),
            reference_number: paymentReference,
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

  if (!customerId) throw new Error('Missing Zoho customer ID for service fee invoice');
  if (!reference) throw new Error('Missing reference number for service fee invoice');
  if (!pricing || !Number.isFinite(Number(pricing.totalPayable))) {
    throw new Error('Invalid pricing payload for service fee invoice');
  }

  const currencyCode = String(currency || 'INR').toUpperCase();
  const totalAmount = Number((Number(pricing.totalPayable) / 100).toFixed(2));
  const safeRate = Math.max(0.01, totalAmount);

  const isInr = currencyCode === 'INR';
  const stateCode = (getStateCode(userState) || 'MH').toUpperCase();
  const isInterstate = stateCode !== 'MH';
  const gstRate = Number(pricing.gstRate || 0);

  const taxId = gstRate <= 0.051
    ? (isInterstate ? process.env.ZOHO_GST5_INTERSTATE_ID : process.env.ZOHO_GST5_INTRASTATE_ID)
    : (isInterstate ? process.env.ZOHO_GST_INTERSTATE_ID : process.env.ZOHO_GST_INTRASTATE_ID);

  const lineItem: any = {
    name: sanitizeForZoho(`${serviceType} Fee - ${eventName}`, 200),
    rate: safeRate,
    quantity: 1,
    hsn_or_sac: '999799',
  };

  if (isInr && taxId) {
    lineItem.tax_id = taxId;
  }

  const payload: any = {
    customer_id: customerId,
    reference_number: reference,
    date,
    currency_code: currencyCode,
    is_inclusive_tax: true,
    line_items: [lineItem],
  };

  if (isInr) {
    payload.gst_treatment = 'consumer';
    payload.place_of_supply = stateCode;
  }

  const invoice = await createInvoice(payload);

  return {
    invoice_id: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number || invoice.invoiceNumber,
  };
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
        // Sync if: no invoice yet, OR sync was pending/failed (zohoSynced===false or zohoSyncPending===true)
        const needsSync = (!p.invoiceId || p.zohoSynced === false || p.zohoSyncPending === true) && p.ticketStatus === 'Active';
        if (needsSync) await syncPaymentToZohoAction(p.eventId, doc.id);
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

/**
 * SEND INVOICE EMAIL VIA BREVO (Template 256)
 * Fetches the Zoho PDF and dispatches it as an attachment via Brevo.
 */
export async function sendInvoiceEmailBrevoAction(params: {
  invoiceId: string;
  invoiceNumber: string;
  recipientEmail: string;
  name: string;
  eventName: string;
  category: string;
  eventDate: string | null;
  amountPaisa: number;
}): Promise<{ success: boolean; message?: string }> {
  try {
    let formattedDate = 'TBD';
    try {
      if (params.eventDate && params.eventDate !== 'TBD') {
        formattedDate = format(new Date(params.eventDate + 'T00:00:00Z'), 'MMMM dd, yyyy');
      }
    } catch {}

    const templateParams = {
      name: params.name,
      event_name: params.eventName,
      invoice_number: params.invoiceNumber,
      category: params.category,
      event_date: formattedDate,
      amount: (params.amountPaisa / 100).toFixed(2),
      event_link: 'https://www.bergmantri.com',
    };

    // Fetch PDF from Zoho — abort if not available, never send without attachment
    const pdf = await getInvoicePdf(params.invoiceId);
    if (!pdf) {
      console.warn(`[sendInvoiceEmailBrevoAction] PDF not available for invoice ${params.invoiceNumber} — email not sent.`);
      return { success: false, message: 'Invoice PDF not available yet.' };
    }

    const attachment = {
      content: pdf.toString('base64'),
      name: `Bergman_Invoice_${params.invoiceNumber}.pdf`,
    };

    await sendDynamicTemplateEmail(
      256,
      params.recipientEmail,
      templateParams,
      'sendInvoiceEmailBrevoAction',
      attachment
    );

    console.log(`[sendInvoiceEmailBrevoAction] Invoice email sent to ${params.recipientEmail} (${params.invoiceNumber}).`);
    return { success: true };
  } catch (e: any) {
    console.error('[sendInvoiceEmailBrevoAction] Error:', e.message);
    return { success: false, message: e.message };
  }
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
