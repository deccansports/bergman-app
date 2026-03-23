// src/lib/actions/categoryActions.ts
'use server';

import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { sanitizeMoney, serializeParticipantData, normalizeToE164 } from "@/lib/utils";
import { createServiceFeeInvoiceAction, sendServiceFeeWhatsAppAction } from "./invoiceActions";
import { applyPaymentToInvoice } from "../zoho/payments";
import { markInvoiceAsSent } from "../zoho/invoice";
import { updateCategoryForParticipantAction } from "./participantActions";
import { sendAthleteCategoryChangeEmail, sendAdminCategoryChangeNotificationEmail } from "../auth/brevoService";
import { sendCategoryChangeNoticeWhatsApp } from "../auth/aisensyService";
import { _mirrorParticipantToKV } from "./dataSyncActions";
import type { CategoryParticipant, CategoryTicket, CategoryChangeEntry, PricingInput, User } from "@/lib/types";
import { calculatePricing } from "@/lib/pricingEngine";
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE } from "@/lib/constants";

/**
 * 🔧 CALCULATE UPGRADE AMOUNT
 */
export async function calculateUpgradeAmount(
  participant: CategoryParticipant,
  newTicket: CategoryTicket
) {
  const newPrice = sanitizeMoney(newTicket.price ?? 0);

  // 🔥 ALWAYS use what user ACTUALLY PAID
  const actualPaid = sanitizeMoney(
    participant.amountPaidPaisa ?? (
      sanitizeMoney(participant.pricingBreakdown?.base) -
      sanitizeMoney(participant.pricingBreakdown?.discount)
    )
  );

  let upgradeAmount = newPrice - actualPaid;
  upgradeAmount = Math.max(0, sanitizeMoney(upgradeAmount));

  return { newPrice, actualPaid, upgradeAmount };
}

/**
 * 📝 CREATE LOG ENTRY
 */
export async function createCategoryChangeEntry(data: Partial<CategoryChangeEntry>) {
  const db = getFirestoreInstance();

  const ref = await db.collection("categoryChanges").add({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return ref.id;
}

/**
 * 🚀 MAIN PROCESS: CATEGORY CHANGE FINALIZATION
 */
export async function processCategoryChangeFinal(input: any) {
  const {
    originalEventId,
    participantId,
    newTicketId,
    newSubCategoryId,
    newTicketName,
    paymentId,
    athleteUid,
    athleteName,
    athleteEmail,
    totalAmountToChargePaisa
  } = input;

  const db = getFirestoreInstance();

  try {
    if (!paymentId) return { success: false, message: "Payment not completed" };

    const participantRef = db
      .collection("events")
      .doc(originalEventId)
      .collection("participants")
      .doc(participantId);

    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) throw new Error("Participant not found");

    const participant = participantSnap.data() as CategoryParticipant;

    const ticketSnap = await db
      .collection("events")
      .doc(originalEventId)
      .collection("ticketDefinitions")
      .doc(newTicketId)
      .get();

    const newTicket = ticketSnap.data() as CategoryTicket;
    if (!newTicket || !newTicket.price) throw new Error("Invalid target ticket");

    const { actualPaid, newPrice, upgradeAmount } = await calculateUpgradeAmount(participant, newTicket);

    const settingsSnap = await db.collection("settings").doc("serviceFees").get();
    const globalFees = settingsSnap.data() || {};
    const raceCategory = (participant.ticketName || '').toUpperCase();
    const typeKey = raceCategory.includes('SWIM') ? 'Swimming' : (raceCategory.includes('DUATHLON') ? 'Duathlon' : 'Triathlon');

    const serviceFee = sanitizeMoney((globalFees as any)?.[typeKey]?.categoryChangeFeePaisa ?? 200000);

    const eventSnap = await db.collection('events').doc(originalEventId).get();
    const isUsd = eventSnap.data()?.currency === 'USD';

    const pricingInput: PricingInput = {
        basePrice: upgradeAmount + serviceFee,
        gatewayRate: isUsd ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
        platformFeeBase: isUsd ? 0 : PLATFORM_FEE_PAISA,
        taxEnabled: !isUsd,
        gstRate: isUsd ? 0 : GST_PERCENTAGE / 100,
        currency: isUsd ? 'USD' : 'INR',
    };
    
    const pricingBreakdown = calculatePricing(pricingInput);
    let finalAmountPaisa = pricingBreakdown.totalPayable;

    const updateResult = await updateCategoryForParticipantAction(originalEventId, participantId, newTicketId, newSubCategoryId);
    if (!updateResult?.success) throw new Error("Roster update failed");

    await participantRef.update({
      upgradeAmountPaid: upgradeAmount,
      upgradePaymentId: paymentId,
      updatedAt: FieldValue.serverTimestamp()
    });

    const updatedParticipantSnapshot = await participantRef.get();
    const updatedParticipantData = serializeParticipantData(updatedParticipantSnapshot);
    await _mirrorParticipantToKV(updatedParticipantData);

    const changeId = await createCategoryChangeEntry({
      userId: athleteUid,
      participantId,
      eventId: originalEventId,
      participantName: athleteName,
      participantEmail: athleteEmail,
      fromTicketName: participant.ticketName,
      toTicketName: newTicketName,
      actualPaidPaisa: actualPaid,
      newTicketPricePaisa: newPrice,
      upgradeAmountPaisa: upgradeAmount,
      serviceFeePaisa: serviceFee,
      totalPaidPaisa: finalAmountPaisa,
      paymentId,
      status: "Completed",
      zohoSync: { status: "pending", retries: 0 }
    });

    const userDoc = await db.collection("users").doc(athleteUid).get();
    const userData = userDoc.data() as User;
    const customerId = userData?.zohoCustomerId;

    if (customerId) {
      (async () => {
        try {
          console.log(`[CategoryChange] Initiating Zoho sync for change ID ${changeId}...`);
          const invoice = await createServiceFeeInvoiceAction({
            customerId,
            reference: paymentId,
            date: new Date().toISOString().split('T')[0],
            pricing: pricingBreakdown, 
            serviceType: "Category Change",
            eventName: updatedParticipantData.eventName || "Event",
            ticketName: newTicketName,
            userState: userData?.state || null,
            description: `Category Change Fee: ₹${serviceFee / 100}\nUpgrade Difference: ₹${upgradeAmount / 100}`
          });

          await markInvoiceAsSent(invoice.invoice_id);

          await applyPaymentToInvoice({
            invoice_id: invoice.invoice_id,
            customer_id: customerId,
            amount: Math.max(1, Math.round(finalAmountPaisa / 100)),
            payment_date: new Date().toISOString().split('T')[0],
            reference_number: paymentId,
            payment_mode: "Online"
          });

          await db.collection("categoryChanges").doc(changeId).update({
            "zohoSync.status": "success",
            "zohoSync.invoiceId": invoice.invoice_id,
            "zohoSync.invoiceNumber": invoice.invoiceNumber
          });

          // 🔥 Trigger WhatsApp Delivery for Service Fee
          const mobileToSend = normalizeToE164(updatedParticipantData.mobile || userData?.mobile);
          if (mobileToSend) {
              console.log(`[CategoryChange] Dispatching WhatsApp invoice to ${mobileToSend}...`);
              await sendServiceFeeWhatsAppAction({
                  orderId: changeId,
                  invoiceId: invoice.invoice_id,
                  invoiceNumber: invoice.invoiceNumber,
                  mobile: mobileToSend,
                  name: athleteName,
                  serviceType: 'Category Change',
                  eventName: updatedParticipantData.eventName || 'Event'
              });
          }

        } catch (err: any) {
          console.warn(`[CategoryChange] Zoho sync failure:`, err.message);
          await db.collection("categoryChanges").doc(changeId).update({
            "zohoSync.status": "failed",
            "zohoSync.error": err.message
          });
        }
      })();
    }

    if (athleteEmail) {
      sendAthleteCategoryChangeEmail(athleteEmail, athleteName, updatedParticipantData.eventName || 'Event', participant.ticketName || 'N/A', newTicketName).catch(() => {});
      sendAdminCategoryChangeNotificationEmail(athleteName, updatedParticipantData.eventName || 'Event', participant.ticketName || 'N/A', newTicketName).catch(() => {});
    }

    const mobileToNotify = normalizeToE164(updatedParticipantData.mobile || userData?.mobile);
    if (mobileToNotify) {
      sendCategoryChangeNoticeWhatsApp(mobileToNotify, athleteName, updatedParticipantData.eventName || 'Event', participant.ticketName || 'N/A', newTicketName).catch(() => {});
    }

    return { success: true, message: "Category changed successfully and synced." };

  } catch (error: any) {
    console.error("[processCategoryChangeFinal] Error:", error.message);
    return { success: false, message: error.message };
  }
}
