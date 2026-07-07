// src/lib/registrationEngine/finalizeRegistration.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Coupon, EventParticipant, EventCalendarEntry, TicketDefinition, RegistrationAttempt, SwimDistanceCategory } from '@/lib/types';
import { assignNextAvailableBib } from '@/lib/actions/bibActions';
import { calculateAgeGroup } from '@/lib/utils';
import { syncRegistrationToZoho } from './zohoSync';
import { sendWhatsAppInvoiceAction, syncPaymentToZohoAction } from '@/lib/actions/invoiceActions';
import { sendRegistrationNotifications } from './registrationNotifications';
import { NO_CLUB_SELECTED_VALUE } from '../constants';
import { getEventParticipants } from '@/lib/dataLayerOptimized';
import { _mirrorParticipantToKV, _syncParticipantsToKV, _syncClubUpcomingAthletes } from '@/lib/actions/dataSyncActions';
import { serializeParticipantData } from '@/lib/utils';
import { _syncCalendarToKV } from '@/lib/actions/eventActions';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { consumeWaitlistCodeForRegistrationAction } from '@/lib/actions/waitlistActions';
import { getRegistrationsCollectionRef } from '@/lib/eventDataPaths';
import { resolveCanonicalParticipantRef } from '@/lib/actions/participantActions';

/**
 * FINAL REGISTRATION ENGINE
 */
export async function finalizeRegistration(
  orderId: string,
  source: string = 'unknown'
): Promise<{ success: boolean; message: string; participantId?: string; bookingId?: string | null; bibNumber?: string | null }> {
  const db = getFirestoreInstance();
  const actionName = 'finalizeRegistration';

  try {
    console.log(`[${actionName}] Starting for order: ${orderId} (source=${source})`);
    const attemptRef = db.collection("registrationAttempts").doc(orderId);
    const attemptSnap = await attemptRef.get();

    await attemptRef.set({
      lastFinalizeSource: source,
      lastFinalizeInvokedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (!attemptSnap.exists) {
      console.error(`[${actionName}] Registration attempt ${orderId} not found.`);
      return { success: false, message: `Registration attempt ${orderId} not found.` };
    }
    const attempt = attemptSnap.data() as RegistrationAttempt;
    console.log(`[${actionName}] Found attempt with status: ${attempt.status}`);

    // Hard guard before any transaction work: if admin deleted this registration,
    // block all retry paths (webhook/client polling/manual callback).
    const normalizedEmail = String(attempt.email || '').toLowerCase().trim();
    const txGuardId = String((attempt as any)?.transactionId || '').trim() ? `tx_${String((attempt as any).transactionId).trim()}` : null;
    const orderGuardId = String((attempt as any)?.razorpayOrderId || '').trim() ? `order_${String((attempt as any).razorpayOrderId).trim()}` : null;
    const athleteEventGuardId = normalizedEmail && attempt.eventId ? `athlete_${normalizedEmail}_event_${attempt.eventId}` : null;

    if ((attempt as any)?.participantDeletedByAdmin === true) {
      console.warn(`[${actionName}] Blocked finalization for ${orderId}: participantDeletedByAdmin flag is set.`);
      return { success: false, message: 'Registration blocked: participant was deleted by admin.' };
    }

    const guardChecks = await Promise.all([
      txGuardId ? db.collection('registrationDeletionGuards').doc(txGuardId).get() : Promise.resolve(null as any),
      orderGuardId ? db.collection('registrationDeletionGuards').doc(orderGuardId).get() : Promise.resolve(null as any),
      athleteEventGuardId ? db.collection('registrationDeletionGuards').doc(athleteEventGuardId).get() : Promise.resolve(null as any),
    ]);

    const txGuard = guardChecks[0];
    const orderGuard = guardChecks[1];
    const athleteEventGuard = guardChecks[2];

    const hasReplayGuard = !!(txGuard?.exists || orderGuard?.exists);
    const athleteGuardData = athleteEventGuard?.data?.() as Record<string, any> | undefined;
    const athleteDeletedBy = String(athleteGuardData?.deletedBy || '').trim().toLowerCase();
    const hasManualAthleteBlock = !!(
      athleteEventGuard?.exists &&
      (athleteGuardData?.manualBlock === true || athleteDeletedBy === 'admin-manual')
    );

    if (hasReplayGuard || hasManualAthleteBlock) {
      const matchedGuards = [
        txGuard?.exists ? txGuardId : null,
        orderGuard?.exists ? orderGuardId : null,
        hasManualAthleteBlock ? athleteEventGuardId : null,
      ].filter(Boolean).join(', ');

      console.warn(`[${actionName}] Blocked finalization for ${orderId}: deletion guard matched (${matchedGuards})`);
      await attemptRef.set({
        status: 'RegistrationFailed',
        participantDeletedByAdmin: true,
        participantDeletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: 'Blocked by admin deletion guard',
      }, { merge: true });
      return { success: false, message: 'Registration blocked: participant was deleted by admin.' };
    }

    // ------------------------------------------------------------------
    // PAYMENT-CAPTURED GUARD
    // Refuse to create a participant unless we have hard evidence that
    // payment was captured (or the registration is genuinely free /
    // manual-offline). This prevents any caller (free path, stale
    // webhook, debug retry, double client callback) from finalizing an
    // attempt that is still PaymentInitiated / PaymentFailed.
    // ------------------------------------------------------------------
    {
      const amountPaisa = Number((attempt as any)?.amountPaidPaisa ?? 0) || 0;
      const paymentMethod = String((attempt as any)?.specificPaymentMethod || (attempt as any)?.paymentMethod || '').toLowerCase();
      const hasTransactionId = !!String((attempt as any)?.transactionId || '').trim();
      const isCapturedStatus = attempt.status === 'PaymentCaptured' || attempt.status === 'Completed';
      const isFree = amountPaisa <= 0;
      const isManualOffline =
        paymentMethod === 'cash' ||
        paymentMethod === 'bank' ||
        paymentMethod === 'banktransfer' ||
        paymentMethod === 'bank_transfer' ||
        paymentMethod === 'offline' ||
        paymentMethod === 'manual' ||
        (attempt as any)?.isManualEntry === true;

      const allowFinalization = isCapturedStatus || (isFree && !hasTransactionId) || (isManualOffline && hasTransactionId);

      if (!allowFinalization) {
        console.warn(
          `[${actionName}] BLOCKED ${orderId}: no payment captured. status=${attempt.status} amountPaisa=${amountPaisa} txId=${hasTransactionId} method=${paymentMethod || 'none'} source=${source}`
        );
        await attemptRef.set({
          lastError: `Finalization blocked: payment not captured (status=${attempt.status}, source=${source}).`,
          lastBlockedFinalizeSource: source,
          lastBlockedFinalizeAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return {
          success: false,
          message: `Cannot finalize registration: payment has not been captured (status: ${attempt.status}).`,
        };
      }
    }

    const finalResult = await db.runTransaction(async (transaction) => {
      const freshAttemptSnap = await transaction.get(attemptRef);
      if (!freshAttemptSnap.exists) throw new Error("Attempt missing.");
      const freshAttempt = freshAttemptSnap.data() as RegistrationAttempt;

      // Hard guard: if admin deleted the participant for this attempt,
      // never recreate it on webhook/client retries.
      if ((freshAttempt as any)?.participantDeletedByAdmin === true) {
        return {
          success: false,
          message: 'Registration blocked: participant was deleted by admin.',
          participantId: freshAttempt.participantId ?? undefined,
          bookingId: freshAttempt.bookingId,
          bibNumber: freshAttempt.bibNumber,
        };
      }

      // Re-check payment-captured guard inside the transaction to defeat
      // any race where a parallel writer downgrades the attempt.
      {
        const amountPaisaTx = Number((freshAttempt as any)?.amountPaidPaisa ?? 0) || 0;
        const paymentMethodTx = String((freshAttempt as any)?.specificPaymentMethod || (freshAttempt as any)?.paymentMethod || '').toLowerCase();
        const hasTxIdTx = !!String((freshAttempt as any)?.transactionId || '').trim();
        const isCapturedStatusTx = freshAttempt.status === 'PaymentCaptured' || freshAttempt.status === 'Completed';
        const isFreeTx = amountPaisaTx <= 0;
        const isManualOfflineTx =
          paymentMethodTx === 'cash' ||
          paymentMethodTx === 'bank' ||
          paymentMethodTx === 'banktransfer' ||
          paymentMethodTx === 'bank_transfer' ||
          paymentMethodTx === 'offline' ||
          paymentMethodTx === 'manual' ||
          (freshAttempt as any)?.isManualEntry === true;
        const allowTx = isCapturedStatusTx || (isFreeTx && !hasTxIdTx) || (isManualOfflineTx && hasTxIdTx);
        if (!allowTx) {
          return {
            success: false,
            message: `Cannot finalize registration: payment has not been captured (status: ${freshAttempt.status}).`,
          };
        }
      }

      if (freshAttempt.status === 'Completed') return { success: true, message: 'Already finalized', participantId: freshAttempt.participantId ?? undefined, bookingId: freshAttempt.bookingId, bibNumber: freshAttempt.bibNumber };

      const eventRef = db.collection('events').doc(freshAttempt.eventId);
      const eventSnap = await transaction.get(eventRef);
      if (!eventSnap.exists) throw new Error('Event missing.');

      const ticketRef = eventRef.collection('ticketDefinitions').doc(freshAttempt.ticketId);
      const ticketSnap = await transaction.get(ticketRef);
      if (!ticketSnap.exists) throw new Error('Ticket missing.');
      
      const eventData = eventSnap.data() as EventCalendarEntry;
      const ticketData = ticketSnap.data() as TicketDefinition;

      let subCategoryData: SwimDistanceCategory | null = null;
      if (freshAttempt.selectedSubCategory) {
          subCategoryData = ticketData.subCategories?.find(s => s.id === freshAttempt.selectedSubCategory) || null;
      }

      const ageGroupsRaw = subCategoryData?.applicableAgeGroups || ticketData.applicableAgeGroups || eventData.ageCategories;
      const ageGroups = Array.isArray(ageGroupsRaw) ? ageGroupsRaw : (typeof ageGroupsRaw === 'string' ? ageGroupsRaw.split(',').map(s => s.trim()) : []);
      const { age, ageCategory } = calculateAgeGroup(freshAttempt.dob, eventData.eventName, ageGroups);
      
      const finalEventDate = ticketData.eventDate || eventData.eventDate || null;

      const participantsCol = getRegistrationsCollectionRef(db, freshAttempt.eventId);
      const isTerminalStatus = (participant: any) => {
        const combined = [
          participant?.ticketStatus,
          participant?.registrationStatus,
          participant?.status,
          participant?.paymentStatus,
        ].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).join(' ');
        return combined.includes('cancel') || combined.includes('defer') || combined.includes('refund') || combined.includes('inactive');
      };
      const allAssignedBibs = new Set<string>(
        (await getEventParticipants(freshAttempt.eventId))
          .filter((participant) => !isTerminalStatus(participant))
          .map((participant) => participant?.bibNumber)
          .filter(Boolean)
          .map(String)
      );

      const bibNumber = await assignNextAvailableBib(
        freshAttempt.eventId, 
        freshAttempt.ticketId, 
        ageCategory, 
        freshAttempt.gender || null, 
        allAssignedBibs,
        freshAttempt.selectedSubCategory
      );
      
      const bookingId = `BMIN${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const registrationTimestamp = new Date();
      
      const finalClubId = freshAttempt.clubId === NO_CLUB_SELECTED_VALUE ? null : (freshAttempt.clubId || null);

      // If no clubId in the attempt, look it up from the user profile
      let resolvedClubId = finalClubId;
      let resolvedClubName: string | null = null;
      if (!resolvedClubId) {
        try {
          const athleteUid = freshAttempt.userId || (freshAttempt as any).athleteUid;
          if (athleteUid) {
            const userSnap = await db.collection('users').doc(athleteUid).get();
            if (userSnap.exists) {
              const u = userSnap.data() as any;
              const cid = u?.clubId || u?.ownedClubId || null;
              if (cid && cid !== NO_CLUB_SELECTED_VALUE) {
                resolvedClubId = String(cid);
                resolvedClubName = u?.clubName || u?.ownedClubName || null;
              }
            }
          }
          // Fallback: look up by email
          if (!resolvedClubId && freshAttempt.email) {
            const emailSnap = await db.collection('users').where('email', '==', freshAttempt.email.toLowerCase()).limit(1).get();
            if (!emailSnap.empty) {
              const u = emailSnap.docs[0].data() as any;
              const cid = u?.clubId || u?.ownedClubId || null;
              if (cid && cid !== NO_CLUB_SELECTED_VALUE) {
                resolvedClubId = String(cid);
                resolvedClubName = u?.clubName || u?.ownedClubName || null;
              }
            }
          }
        } catch (e) {
          console.warn(`[${actionName}] Club lookup fallback failed:`, e);
        }
      }

      const finalTicketName = subCategoryData 
        ? `${ticketData.ticketName} - ${subCategoryData.name}`
        : (ticketData.ticketName || 'N/A');

      let couponRef: FirebaseFirestore.DocumentReference | null = null;
      let couponExists = false;
      if (freshAttempt.couponCode) {
        couponRef = db.collection('coupons').doc(freshAttempt.couponCode.toUpperCase());
        const couponSnap = await transaction.get(couponRef);
        couponExists = couponSnap.exists;
      }

      if ((freshAttempt as any).deferralId) {
        const defRef = db.collection("deferrals").doc((freshAttempt as any).deferralId);
        const defSnap = await transaction.get(defRef);
        if (!defSnap.exists) {
          return { success: false, message: 'Deferral not found or no longer valid.' };
        }

        const defData = defSnap.data() as Record<string, any>;
        const defStatus = String(defData?.status || '').trim();
        const usableStatuses = new Set(['Pending', 'Pending Ticket Selection']);
        if (!usableStatuses.has(defStatus)) {
          return { success: false, message: `Deferral already ${defStatus || 'used'} and cannot be used again.` };
        }
      }

      // Duplicate guard: if an active participant already exists for this athlete/email and ticket,
      // do not auto-create another registration row.
      const normalizedEmail = (freshAttempt.email || '').toLowerCase().trim();
      if (normalizedEmail) {
        const possibleDupesSnap = await transaction.get(
          participantsCol.where('email', '==', normalizedEmail).limit(20)
        );

        const existingActive = possibleDupesSnap.docs.find((doc) => {
          const p = doc.data() as EventParticipant;
          const sameTicket = String((p as any)?.ticketId || '') === String(freshAttempt.ticketId || '');
          const sameSubCategory = String((p as any)?.selectedSubCategory || '') === String(freshAttempt.selectedSubCategory || '');
          const isActive = String((p as any)?.ticketStatus || '') === 'Active';
          return sameTicket && sameSubCategory && isActive;
        });

        if (existingActive) {
          const existing = existingActive.data() as EventParticipant;
          transaction.update(attemptRef, {
            status: 'Completed',
            participantId: existingActive.id,
            bookingId: (existing as any)?.bookingId || null,
            bibNumber: (existing as any)?.bibNumber || null,
            duplicateSuppressed: true,
            updatedAt: FieldValue.serverTimestamp(),
          });

          return {
            success: true,
            message: 'Duplicate registration suppressed',
            participantId: existingActive.id,
            bookingId: (existing as any)?.bookingId || null,
            bibNumber: (existing as any)?.bibNumber || null,
          };
        }
      }

      const participantRef = await resolveCanonicalParticipantRef(db, freshAttempt.eventId, {
        ...freshAttempt,
        registrationAttemptId: orderId,
        bookingId,
        athleteUid: freshAttempt.userId ?? (freshAttempt as any).athleteUid ?? null,
        email: (freshAttempt.email || '').toLowerCase(),
      }, orderId);
      const participantPayload: Omit<EventParticipant, 'id'> = {
        ...freshAttempt,
        name: (freshAttempt.name || '').trim(),
        clubId: resolvedClubId,
        clubName: resolvedClubName,
        athleteUid: freshAttempt.userId ?? (freshAttempt as any).athleteUid ?? null,
        registrationAttemptId: orderId,
        paymentId: freshAttempt.transactionId ?? undefined,
        paymentMethod: (freshAttempt as any).specificPaymentMethod || (freshAttempt.transactionId?.startsWith('pi_') ? 'Stripe' : 'Razorpay'),
        buyerName: freshAttempt.name!,
        buyerEmail: (freshAttempt.email || '').toLowerCase(),
        email: (freshAttempt.email || '').toLowerCase(),
        bookingId,
        bibNumber,
        age: age ?? undefined,
        ageCategory: ageCategory ?? undefined,
        eventDate: finalEventDate,
        ticketStatus: 'Active',
        ticketName: finalTicketName,
        eventName: eventData.eventName,
        registeredAt: registrationTimestamp.toISOString(),
        createdAt: registrationTimestamp.toISOString(),
        updatedAt: registrationTimestamp.toISOString(),
        zohoSynced: false,
      };

      transaction.set(participantRef, participantPayload, { merge: true });
      transaction.update(attemptRef, { status: 'Completed', participantId: participantRef.id, bookingId, bibNumber, updatedAt: FieldValue.serverTimestamp() });

      if ((freshAttempt as any).deferralId) {
          const defRef = db.collection("deferrals").doc((freshAttempt as any).deferralId);
          transaction.update(defRef, {
              status: 'Used',
              deferredToEventId: freshAttempt.eventId,
              deferredToEventName: eventData.eventName,
              deferredToTicketId: freshAttempt.ticketId,
              deferredToTicketName: ticketData.ticketName,
              updatedAt: FieldValue.serverTimestamp()
          });
          const uId = freshAttempt.userId || (freshAttempt as any).athleteUid;
          if (uId) {
              transaction.update(db.collection("users").doc(uId), {
                  activeDeferral: FieldValue.delete()
              });
          }
      }

      if (couponRef && couponExists) {
        transaction.update(couponRef, {
          usageCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      return { success: true, message: 'Finalized', participantId: participantRef.id, bookingId, bibNumber };
    });

    // Side effects must run for both "Finalized" and "Already finalized"
    // so retried Stripe finalization calls can still recover missing KV or invoice sync.
    if (finalResult.success && finalResult.participantId) {
        const isDuplicateSuppressed = finalResult.message === 'Duplicate registration suppressed';

        // If this registration was unlocked via waitlist, consume the code now.
        // This keeps sold-out/closed access scoped and one-time where configured.
        const normalizedWaitlistCode = String((attempt as any)?.waitlistCode || '').trim();
        const normalizedWaitlistEmail = String((attempt as any)?.waitlistCodeEmail || attempt.email || '').trim().toLowerCase();
        if (normalizedWaitlistCode) {
          try {
            await consumeWaitlistCodeForRegistrationAction({
              code: normalizedWaitlistCode,
              email: normalizedWaitlistEmail,
              eventId: attempt.eventId,
              ticketId: attempt.ticketId,
              registrationAttemptId: orderId,
              participantId: finalResult.participantId,
            });
          } catch (waitlistConsumeError) {
            console.warn(`[${actionName}] Waitlist code consume failed for ${orderId}:`, waitlistConsumeError);
          }
        }

        // Always ensure participant is mirrored to KV.
        let participantClubId: string | null = null;
        let finalizedParticipantData: EventParticipant | null = null;
        try {
          const participantSnap = await getRegistrationsCollectionRef(db, attempt.eventId)
            .doc(finalResult.participantId)
            .get();
          if (participantSnap.exists) {
            const participantData = serializeParticipantData(participantSnap) as EventParticipant;
            finalizedParticipantData = participantData;
            participantClubId = String((participantData as any)?.clubId || '').trim() || null;
            await _mirrorParticipantToKV(participantData);
          }
        } catch (e) {
          console.warn(`[${actionName}] KV mirror failed for participant ${finalResult.participantId}:`, e);
        }

        try {
          const couponCode = String(attempt.couponCode || '').trim().toUpperCase();
          if (couponCode && finalizedParticipantData) {
            const activeCoupons = await getKV<(Coupon & Record<string, any>)[]>('coupons:active', actionName) || [];
            const couponIndex = activeCoupons.findIndex((item) => String(item?.code || '').trim().toUpperCase() === couponCode);
            const couponData = couponIndex >= 0 ? activeCoupons[couponIndex] : null;
            if (couponData && String((couponData as any).couponOrigin || '') === 'influencer-public') {
              activeCoupons[couponIndex] = {
                ...couponData,
                usageCount: Number(couponData.usageCount || 0) + 1,
                updatedAt: new Date().toISOString(),
              };
              await putKV('coupons:active', activeCoupons, actionName);

              const promoCouponsKey = `event:${attempt.eventId}:influencer-public-coupons`;
              const existingPromoCoupons = await getKV<Record<string, any>[]>(promoCouponsKey, actionName) || [];
              const promoCouponIndex = existingPromoCoupons.findIndex((item) => String(item?.code || '').trim().toUpperCase() === couponCode);
              if (promoCouponIndex >= 0) {
                existingPromoCoupons[promoCouponIndex] = {
                  ...existingPromoCoupons[promoCouponIndex],
                  usageCount: Number(existingPromoCoupons[promoCouponIndex]?.usageCount || 0) + 1,
                  updatedAt: new Date().toISOString(),
                };
                await putKV(promoCouponsKey, existingPromoCoupons, actionName);
              }

              const usageLogsKey = `event:${attempt.eventId}:influencer-public-coupon-usage-logs`;
              const existingUsageLogs = await getKV<Record<string, any>[]>(usageLogsKey, actionName) || [];
              const usageLogId = `${attempt.eventId}_${couponCode}_${orderId}`.replace(/[^A-Z0-9_-]/gi, '_');
              const usageEntry = {
                id: usageLogId,
                eventId: attempt.eventId,
                couponCode,
                couponOrigin: 'influencer-public',
                influencerId: (couponData as any)?.influencerId ? String((couponData as any).influencerId) : null,
                influencerName: (couponData as any)?.influencerName ? String((couponData as any).influencerName) : null,
                participantId: finalResult.participantId,
                participantName: String(finalizedParticipantData.name || ''),
                participantEmail: String(finalizedParticipantData.email || '').toLowerCase(),
                ticketId: finalizedParticipantData.ticketId ? String(finalizedParticipantData.ticketId) : null,
                ticketName: String(finalizedParticipantData.ticketName || ''),
                bookingId: finalResult.bookingId || null,
                usedAt: String(finalizedParticipantData.registeredAt || new Date().toISOString()),
              };
              const dedupedLogs = [usageEntry, ...existingUsageLogs.filter((item) => String(item?.id || '') !== usageLogId)];
              await putKV(usageLogsKey, dedupedLogs, actionName);
            }
          }
        } catch (e) {
          console.warn(`[${actionName}] Coupon usage log write failed for order ${orderId}:`, e);
        }

        // Keep the essential participant mirror and waitlist state updates.
        // Everything else is deferred to a background task so the user gets
        // a response as soon as the payment/registration is committed.

        const participantAfterCommitSnap = await getRegistrationsCollectionRef(db, attempt.eventId)
          .doc(finalResult.participantId)
          .get();

        if (participantAfterCommitSnap.exists) {
          const participantAfterCommit = participantAfterCommitSnap.data() as any;
          const participantClubIdFinal = participantClubId || String((attempt as any)?.clubId || '').trim() || null;

          try {
            await db
              .collection('events')
              .doc(attempt.eventId)
              .collection('participants')
              .doc(finalResult.participantId)
              .set(
                {
                  ...participantAfterCommit,
                  mirroredFromRegistrations: true,
                  mirroredAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
          } catch (e) {
            console.warn(`[${actionName}] Legacy participant mirror failed for ${attempt.eventId}/${finalResult.participantId}:`, e);
          }

          try {
            await _mirrorParticipantToKV(serializeParticipantData(participantAfterCommitSnap) as EventParticipant);
          } catch (e) {
            console.warn(`[${actionName}] KV mirror failed for participant ${finalResult.participantId}:`, e);
          }

          const participantZohoSynced = !!participantAfterCommit?.zohoSynced;
          const participantHasInvoice = !!participantAfterCommit?.invoiceId;
          const shouldRunInvoiceSync = !isDuplicateSuppressed || !participantZohoSynced || !participantHasInvoice;

          void (async () => {
            try {
              if (shouldRunInvoiceSync) {
                console.log(`[${actionName}] 🚀 Background invoice sync for participant ${finalResult.participantId}`);
                await syncRegistrationToZoho(orderId);
              }

              // Keep event-level participant indexes fresh, but do it in background.
              await _syncParticipantsToKV(attempt.eventId);

              if (participantClubIdFinal) {
                await _syncClubUpcomingAthletes(participantClubIdFinal);
              }

              if (finalResult.message === 'Finalized') {
                await sendRegistrationNotifications(orderId);

                try {
                  const participantAfterNotificationsSnap = await getRegistrationsCollectionRef(db, attempt.eventId!)
                    .doc(finalResult.participantId!)
                    .get();

                  if (participantAfterNotificationsSnap.exists) {
                    const participantAfterNotifications = participantAfterNotificationsSnap.data() as any;
                    const hasInvoice = !!participantAfterNotifications?.invoiceId;
                    const invoiceWhatsappAlreadySent = !!participantAfterNotifications?.invoiceWhatsAppSentAt;

                    if (hasInvoice && !invoiceWhatsappAlreadySent) {
                      const waRes = await sendWhatsAppInvoiceAction(attempt.eventId!, finalResult.participantId!);
                      if (waRes?.success) {
                        await participantAfterNotificationsSnap.ref.update({
                          invoiceWhatsAppSentAt: FieldValue.serverTimestamp(),
                          updatedAt: FieldValue.serverTimestamp(),
                        });
                      } else {
                        console.warn(
                          `[${actionName}] Invoice WhatsApp send failed for ${attempt.eventId!}/${finalResult.participantId!}: ${waRes?.message || 'Unknown error'}`
                        );
                      }
                    }
                  }
                } catch (e) {
                  console.warn(`[${actionName}] Post-registration invoice WhatsApp step failed for ${attempt.eventId}/${finalResult.participantId}:`, e);
                }

                _syncCalendarToKV().catch(console.error);
              }
            } catch (e) {
              console.warn(`[${actionName}] Background post-finalization work failed for ${orderId}:`, e);
            }
          })().catch((e) => {
            console.warn(`[${actionName}] Unhandled background post-finalization failure for ${orderId}:`, e);
          });
        }
    }

    return {
        success: finalResult.success,
        message: finalResult.message,
        participantId: finalResult.participantId ?? undefined,
        bookingId: finalResult.bookingId,
        bibNumber: finalResult.bibNumber
    };
  } catch (error: any) {
    console.error(`[${actionName}] Fatal error: ${error.message}`, error.stack);
    await db.collection('registrationAttempts').doc(orderId).set({ status: 'RegistrationFailed', lastError: error.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { success: false, message: error.message };
  }
}
