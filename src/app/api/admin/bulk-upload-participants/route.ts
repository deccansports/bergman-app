// src/app/api/admin/bulk-upload-participants/route.ts
import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import * as XLSX from 'xlsx';
import type { ParticipantCSVRow, EventCalendarEntry, TicketDefinition, User, EventParticipant, SwimDistanceCategory, PricingBreakdown } from '@/lib/types';
import { sendRegistrationConfirmationViaWhatsApp } from '@/lib/auth/aisensyService';
import { sendRegistrationConfirmationEmail, sendAdminTicketSaleNotificationEmail } from '@/lib/auth/brevoService';
import { FieldValue, type CollectionReference } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { _updateUserFromParticipantData } from '@/lib/actions/userActions';
import { parse as parseDateFns, isValid as isDateValid } from 'date-fns';
import { startJob, updateJobProgress } from '@/lib/jobManager';
import { assignNextAvailableBib } from '@/lib/actions/bibActions';
import { calculateAgeGroup, serializeValue, normalizeToE164 } from '@/lib/utils';
import { runDataSyncAction, _mirrorParticipantToKV } from '@/lib/actions/dataSyncActions';
import { NO_CLUB_SELECTED_VALUE, GST_PERCENTAGE } from '@/lib/constants';
import { getEventParticipants } from '@/lib/dataLayerOptimized';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeBulkMobileToIndia(raw?: string | null, country?: string | null): string | undefined {
  if (!raw) return undefined;

  const cleaned = String(raw).trim().replace(/\D/g, '');
  if (!cleaned) return undefined;

  const normalizedCountry = String(country || '').trim().toLowerCase();
  const isIndia =
    !normalizedCountry ||
    normalizedCountry === 'india' ||
    normalizedCountry === 'in' ||
    normalizedCountry === 'bharat';

  // For bulk uploads (default India): force +91 for local mobile patterns.
  if (isIndia) {
    if (cleaned.length === 12 && cleaned.startsWith('91')) return `+${cleaned}`;
    if (cleaned.length === 11 && cleaned.startsWith('0') && /^[6-9]/.test(cleaned.slice(1))) return `+91${cleaned.slice(1)}`;
    if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) return `+91${cleaned}`;
    if (cleaned.length === 11 && /^[6-9]/.test(cleaned)) return `+91${cleaned.slice(0, 10)}`;

    // If extra digits are present, try last 10 first, then first 10.
    const last10 = cleaned.slice(-10);
    if (last10.length === 10 && /^[6-9]/.test(last10)) return `+91${last10}`;
    const first10 = cleaned.slice(0, 10);
    if (first10.length === 10 && /^[6-9]/.test(first10)) return `+91${first10}`;
  }

  // Non-India fallback to generic E.164 normalization.
  return normalizeToE164(raw);
}

async function generateUniqueBookingId(
  eventParticipantsRef: CollectionReference
): Promise<string> {
  let bookingId: string;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    const prefix = 'BMIN';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    bookingId = prefix + result;

    const existingBookingQuery = await eventParticipantsRef.where('bookingId', '==', bookingId).limit(1).get();
    if (existingBookingQuery.empty) {
      isUnique = true;
    }
    attempts++;
  } while (!isUnique && attempts < maxAttempts);

  if (!isUnique) {
    return `BMIN${Date.now().toString().slice(-6)}`;
  }

  return bookingId;
}


async function processUploadJob(jobId: string, eventId: string, assignedTicketId: string, assignedSubCategoryId: string | null, sendConfirmations: boolean, fileBuffer: Buffer) {
  const actionName = '[API /bulk-upload-participants BG Job]';
  let successCount = 0;
  let errorCount = 0;
  let results: Array<{ row: number; email: string; name: string; status: 'success' | 'error' | 'warning'; detail: string }> = [];
  
  const checkpoint = async (progress: number, message: string) => {
    await updateJobProgress(jobId, { status: 'processing', progress, message, results: serializeValue(results) });
  };

  try {
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) throw new Error("Event not found.");
    const eventData = eventSnap.data() as EventCalendarEntry;

    const ticketSnap = await eventRef.collection('ticketDefinitions').doc(assignedTicketId).get();
    if (!ticketSnap.exists) throw new Error("Assigned ticket type not found.");
    const ticketData = ticketSnap.data() as TicketDefinition;

    let subCategoryData: SwimDistanceCategory | null = null;
    if (assignedSubCategoryId && ticketData.subCategories) {
        subCategoryData = ticketData.subCategories.find(s => s.id === assignedSubCategoryId) || null;
    }

    await checkpoint(5, 'Sheet analysis starting...');

    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<ParticipantCSVRow>(worksheet, { raw: false });
    
    const totalRows = jsonData.length;
    if (totalRows === 0) throw new Error("Sheet is empty or has no data rows.");
    
    const hasBibColumn = jsonData.length > 0 && ('BIB NO' in jsonData[0] || 'BIB Number' in jsonData[0]);

    const allParticipantsSnapshot = await getEventParticipants(eventId);
    const existingBibs = new Map<string, string>(); 
    const isTerminalStatus = (participant: any) => {
      const combined = [
        participant?.ticketStatus,
        participant?.registrationStatus,
        participant?.status,
        participant?.paymentStatus,
      ].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).join(' ');
      return combined.includes('cancel') || combined.includes('defer') || combined.includes('refund') || combined.includes('inactive');
    };
    allParticipantsSnapshot.forEach((doc: any) => {
      if (isTerminalStatus(doc)) return;
      const bib = doc?.bibNumber;
      const email = doc?.email;
      if (bib) {
        existingBibs.set(String(bib), email);
      }
    });

    const getVal = (row: any, primaryHeader: string, altHeaders: string[] = []): string | null => {
        const lowerPrimary = primaryHeader.toLowerCase().replace(/\s+/g, '');
        const lowerAlts = altHeaders.map(h => h.toLowerCase().replace(/\s+/g, ''));
        for (const key in row) {
            const lowerKey = key.toLowerCase().replace(/\s+/g, '');
            if (lowerKey === lowerPrimary || lowerAlts.includes(lowerKey)) {
                const value = row[key];
                return value !== null && value !== undefined ? String(value).trim() : null;
            }
        }
        return null;
    };

    const normalizeOptionalUrl = (val?: string | null): string | null => {
      if (!val) return null;
      const trimmed = String(val).trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      if (['na', 'n/a', 'null', 'undefined', '-'].includes(lower)) return null;
      return trimmed;
    };


    for (let i = 0; i < totalRows; i++) {
        const row = jsonData[i];
        const rowIndex = i + 2;
        const name = getVal(row, 'Name', ['Athlete Name', 'Participant Name']);
        const email = getVal(row, 'Email Address', ['Email', 'E-mail', 'EmailId'])?.toLowerCase();

        if (!name || !email) {
            results.push({ row: rowIndex, email: email || 'N/A', name: name || 'N/A', status: 'error', detail: `Row ${rowIndex}: Name and Email are required.` });
            errorCount++;
            continue;
        }

        try {
            const participantsCol = eventRef.collection('participants');
            const existingParticipantQuery = await participantsCol.where('email', '==', email).limit(1).get();
            const registrationTime = new Date();
            const dob = parseSheetDate(getVal(row, 'Date Of Birth', ['DOB', 'Birth Date']));
            
            const ageGroupsRaw = subCategoryData?.applicableAgeGroups || ticketData.applicableAgeGroups || eventData.ageCategories;
            const ageGroups = Array.isArray(ageGroupsRaw) ? ageGroupsRaw : (typeof ageGroupsRaw === 'string' ? ageGroupsRaw.split(',').map(s => s.trim()) : []);
            const { age, ageCategory } = dob ? calculateAgeGroup(dob, eventData.eventName, ageGroups) : { age: null, ageCategory: null };

            const userQuery = await adminDb.collection('users').where('email', '==', email).limit(1).get();
            const existingUserProfile: User | null = userQuery.empty ? null : userQuery.docs[0].data() as User;
            const idProofFromSheet = normalizeOptionalUrl(getVal(row, 'Identity Proof', ['ID Proof']));
            const idProofFromUser = normalizeOptionalUrl((existingUserProfile as any)?.idProofUrl || null);
            const resolvedIdProofUrl = idProofFromSheet || idProofFromUser || undefined;
            
            let bibNumber: string | null = null;
            let bibWarningMessage = '';

            if (hasBibColumn) {
                const bibFromSheet = getVal(row, 'BIB NO', ['BIB Number', 'Bib']);
                if (bibFromSheet) {
                    if (existingBibs.has(bibFromSheet) && existingBibs.get(bibFromSheet) !== email) {
                        bibWarningMessage = `Duplicate BIB ${bibFromSheet} found. Assigning new BIB.`;
                    } else {
                        bibNumber = bibFromSheet;
                    }
                }
            }
            
            if (!bibNumber) {
                const existingParticipantBib = existingParticipantQuery.empty ? null : existingParticipantQuery.docs[0].data().bibNumber;
                
                if (existingParticipantBib && !hasBibColumn) {
                    bibNumber = existingParticipantBib; 
                } else {
                    const newBib = await assignNextAvailableBib(
                        eventId,
                        assignedTicketId,
                        ageCategory,
                        getVal(row, 'Gender') || null,
                        new Set(existingBibs.keys()),
                        assignedSubCategoryId
                    );
                    if (!newBib) {
                        bibWarningMessage = "No matching BIB rule found. Number assigned as TBD.";
                    }
                    bibNumber = newBib;
                }
            }
            
            const toBoolean = (val: string | undefined | null) => String(val).trim().toLowerCase() === 'yes' || String(val).trim().toLowerCase() === 'true';
            
            const isDeferredFromPuneValue = getVal(row, 'Deferred from pune');
            const isGeneralDeferralValue = getVal(row, 'Deferred');
            
            let previousDeferralDetailsPayload: any = null;

            if (isDeferredFromPuneValue && (isDeferredFromPuneValue.toLowerCase() === 'yes' || isDeferredFromPuneValue.toLowerCase() === 'pune')) {
                previousDeferralDetailsPayload = { originalEventName: 'Pune Triathlon' };
            } else if (toBoolean(isGeneralDeferralValue)) {
                previousDeferralDetailsPayload = { originalEventName: 'Previous Event (Details not specified)' };
            }

            const ticketStatus = 'Active';
            
            const basePricePaisa = subCategoryData?.pricePaisa || ticketData.price || 0;
            const amountPaidPaisa = parseAmountToPaisa(getVal(row, 'Amount Paid', ['Total Paid (INR)', 'Fee Paid'])) ?? basePricePaisa;

            const pricingBreakdown: PricingBreakdown = {
                base: basePricePaisa,
                discount: 0,
                eventGST: Math.round(basePricePaisa * (GST_PERCENTAGE / 100)),
                platformFeeBase: 0,
                platformGST: 0,
                processingFeeBase: 0,
                processingGST: 0,
                roundingAdjustment: 0,
                totalPayable: amountPaidPaisa,
                currency: (eventData.currency as any) || "INR",
                gstRate: GST_PERCENTAGE / 100,
                version: "v3.0.0",
            };

            const finalEventDate = ticketData.eventDate || eventData.eventDate || null;

            const countryFromSheet = getVal(row, 'Country') || undefined;
            const normalizedMobile = normalizeBulkMobileToIndia(
              getVal(row, 'Phone Number', ['Mobile', 'Contact', 'Phone']),
              countryFromSheet
            );
            const normalizedEmergencyMobile = normalizeBulkMobileToIndia(
              getVal(row, 'Emergency Contact Number', ['Emergency Contact']),
              countryFromSheet
            );

            const potentialPayload: Record<string, any> = {
                name, email,
                mobile: normalizedMobile,
                gender: getVal(row, 'Gender', ['Sex']) || undefined,
                transactionId: getVal(row, 'Payment ID', ['Transaction ID']) || `BULK_UPLOAD_${Date.now()}`,
                amountPaidPaisa,
                originalAmountPaidAtFirstRegistrationPaisa: amountPaidPaisa,
                basePricePaisa,
                ticketName: subCategoryData ? `${ticketData.ticketName} - ${subCategoryData.name}` : ticketData.ticketName,
                ticketId: assignedTicketId,
                selectedSubCategory: assignedSubCategoryId,
                ticketStatus: ticketStatus,
                dob: dob,
                eventDate: finalEventDate,
                bloodGroup: getVal(row, 'Blood Group') || undefined,
                emergencyContactNumber: normalizedEmergencyMobile,
                address: getVal(row, 'Address') || undefined,
                city: getVal(row, 'City') || undefined,
                pincode: getVal(row, 'Pincode', ['Zip Code']) || undefined,
                state: getVal(row, 'State') || undefined,
                country: countryFromSheet,
                tshirtSize: getVal(row, 'T-shirt Size', ['T Shirt Size', 'Size']) || undefined,
                gstPaid: (amountPaidPaisa > basePricePaisa) ? 'Yes' : 'No',
                previousDeferralDetails: previousDeferralDetailsPayload,
                idProofUrl: resolvedIdProofUrl,
                digitalSignatureName: getVal(row, 'Digital Signature (Name)', ['Signature']) || name,
                agreedRules: toBoolean(getVal(row, 'Rules & Regulations', ['Agreed to Rules'])),
                agreedWaiver: toBoolean(getVal(row, 'Waiver', ['Agreed to Waiver'])),
                consentPromotions: toBoolean(getVal(row, 'I would like to receive updates & notifications from this event organizer', ['Consent'])),
                clubId: existingUserProfile?.clubId === NO_CLUB_SELECTED_VALUE ? null : (existingUserProfile?.clubId || null),
                clubName: existingUserProfile?.clubName || null,
                athleteUid: existingUserProfile?.uid || null,
                paymentMethod: 'Offline/Bulk',
                buyerName: name,
                buyerEmail: email,
                pricingBreakdown,
            };
            
            if (bibNumber !== null) {
                potentialPayload.bibNumber = bibNumber;
            }
          
            let finalBookingId: string;

            if (!existingParticipantQuery.empty) {
                const existingDoc = existingParticipantQuery.docs[0];
                finalBookingId = existingDoc.data().bookingId || await generateUniqueBookingId(participantsCol);
                
                const updatePayload: Record<string, any> = { updatedAt: FieldValue.serverTimestamp(), bookingId: finalBookingId };
                for (const key in potentialPayload) {
                    const value = potentialPayload[key];
                    if (value !== undefined) {
                        updatePayload[key] = value;
                    }
                }
                
                await existingDoc.ref.update(updatePayload);

                // Immediate KV sync for this participant (do not wait for end-of-job sync)
                try {
                  const existingData = existingDoc.data() as Record<string, any>;
                  const participantForKv = serializeValue({
                    id: existingDoc.id,
                    ...existingData,
                    ...potentialPayload,
                    bookingId: finalBookingId,
                    eventId,
                    eventName: eventData.eventName,
                    updatedAt: new Date().toISOString(),
                  }) as EventParticipant;
                  await _mirrorParticipantToKV(participantForKv);
                } catch (kvSyncError: any) {
                  console.warn(`${actionName} Immediate KV sync warning (update row ${rowIndex}):`, kvSyncError?.message || kvSyncError);
                }

                results.push({ row: rowIndex, email, name, status: 'success', detail: `Updated ${name} (BIB: ${bibNumber || 'TBD'}). ${bibWarningMessage}`.trim() });
            } else {
                const createPayload: Record<string, any> = {
                    ...potentialPayload,
                    eventId,
                    eventName: eventData.eventName,
                    registeredAt: registrationTime.toISOString(),
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                };
                Object.keys(createPayload).forEach(key => createPayload[key] === undefined && delete createPayload[key]);
                
                finalBookingId = getVal(row, 'Booking Id') || await generateUniqueBookingId(participantsCol);
                createPayload.bookingId = finalBookingId;

                const createdRef = await participantsCol.add(createPayload);

                // Immediate KV sync for this participant (do not wait for end-of-job sync)
                try {
                  const participantForKv = serializeValue({
                    id: createdRef.id,
                    ...potentialPayload,
                    bookingId: finalBookingId,
                    eventId,
                    eventName: eventData.eventName,
                    registeredAt: registrationTime.toISOString(),
                    createdAt: registrationTime.toISOString(),
                    updatedAt: registrationTime.toISOString(),
                  }) as EventParticipant;
                  await _mirrorParticipantToKV(participantForKv);
                } catch (kvSyncError: any) {
                  console.warn(`${actionName} Immediate KV sync warning (create row ${rowIndex}):`, kvSyncError?.message || kvSyncError);
                }

                results.push({ row: rowIndex, email, name, status: 'success', detail: `Created ${name} (BIB: ${bibNumber || 'TBD'}). Booking ID: ${finalBookingId}. ${bibWarningMessage}`.trim() });
            }

            if (bibNumber) {
                existingBibs.set(bibNumber, email);
            }
            
            await _updateUserFromParticipantData(potentialPayload);
            
            if (sendConfirmations) {
              const fullMobile = potentialPayload.mobile || null;
              const actualAssignedBib = bibNumber || 'TBD';
              
              if (fullMobile) {
                  await sendRegistrationConfirmationViaWhatsApp(
                      fullMobile, 
                      name || 'Athlete', 
                      eventData.eventName, 
                      finalBookingId, 
                      registrationTime, 
                      potentialPayload.ticketName, 
                      actualAssignedBib,
                      (eventData.venueName ?? eventData.address ?? null), 
                      finalEventDate
                  );
              }
              
              await sendRegistrationConfirmationEmail(
                email!, 
                name!, 
                eventData.eventName, 
                finalBookingId, 
                registrationTime, 
                potentialPayload.ticketName, 
                eventData.venueName, 
                finalEventDate,
                potentialPayload.address, 
                fullMobile, 
                potentialPayload.emergencyContactNumber, 
                null, 
                actualAssignedBib,
                eventData.organizerName, 
                eventData.organizerAddress,
                eventData.organizerCompanyDescription, 
                potentialPayload.country
              );

              await sendAdminTicketSaleNotificationEmail(
                  name!, 
                  eventData.eventName, 
                  finalBookingId, 
                  registrationTime, 
                  potentialPayload.ticketName,
                  eventData.venueName, 
                  finalEventDate, 
                  potentialPayload.address, 
                  fullMobile,
                  potentialPayload.emergencyContactNumber, 
                  email!, 
                  null,
                  actualAssignedBib
              );
            }
            successCount++;
        } catch (innerError: any) {
            results.push({ row: rowIndex, email: email || 'N/A', name: name || 'N/A', status: 'error', detail: `Error: ${innerError.message}` });
            errorCount++;
        }
        
        if (i % 5 === 0) await checkpoint(((i + 1) / totalRows) * 100, `Processed ${i + 1} of ${totalRows} rows...`);
    }
    
    const completionMessage = `Processing complete. Success: ${successCount}, Failed: ${errorCount}.`;
    await updateJobProgress(jobId, {
      status: 'completed',
      progress: 100,
      results: serializeValue(results),
      message: completionMessage,
    });

    // Post-processing should not block user-facing completion state.
    try {
      revalidatePath('/admin/dashboard');
      await runDataSyncAction('registrations', eventId);
    } catch (postProcessError: any) {
      console.error(`[${actionName}] Post-processing warning for job ${jobId}:`, postProcessError);
    }

  } catch (error: any) {
    console.error(`[${actionName}] Critical error for job ${jobId}:`, error);
    await updateJobProgress(jobId, { status: 'failed', progress: 100, results: serializeValue(results), message: `Critical error: ${error.message}` });
  }
}


export async function POST(request: Request) {
  const actionName = '[API /bulk-upload-participants]';
  
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { success: false, message: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    const formData = await request.formData();
    const eventId = formData.get('eventId') as string;
    const assignedTicketId = formData.get('assignedTicketId') as string;
    const assignedSubCategoryId = formData.get('assignedSubCategoryId') as string | null;
    const sendConfirmations = formData.get('sendConfirmations') === 'true';
    const file = formData.get('participantSheet') as File | null;

    if (!file || !eventId || !assignedTicketId) {
      return NextResponse.json({ success: false, message: "Event, Ticket, and File are required." }, { status: 400 });
    }
    
    const bytes = await file.arrayBuffer();
    const fileBuffer = Buffer.from(bytes);
    
    const { jobId } = await startJob();
    setTimeout(() => {
        processUploadJob(jobId, eventId, assignedTicketId, assignedSubCategoryId, sendConfirmations, fileBuffer);
    }, 0);

    return NextResponse.json({ success: true, message: "Upload started.", jobId });

  } catch (error: any) {
    console.error(`[${actionName}] Critical error during initial upload handling:`, error);
    return NextResponse.json({ success: false, message: `Critical upload error: ${error.message}.` }, { status: 500 });
  }
}

const parseSheetDate = (dateVal?: any): string | null => {
  if (!dateVal) return null;
  let date: Date | null = null;
  if (typeof dateVal === 'number' && dateVal > 25569) {
    date = new Date((dateVal - 25569) * 86400 * 1000);
  } else if (typeof dateVal === 'string') {
    const trimmedDate = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      date = parseDateFns(trimmedDate, 'yyyy-MM-dd', new Date());
    } 
    else if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(trimmedDate)) {
      const formattedStr = trimmedDate.replace(/\//g, '-');
      date = parseDateFns(formattedStr, 'dd-MM-yyyy', new Date());
    }
    else {
      date = new Date(trimmedDate);
    }
  } else if (dateVal instanceof Date) {
    date = dateVal;
  }

  if (date && isDateValid(date)) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
};

const parseAmountToPaisa = (amountStr?: string | number | null): number | null => {
  if (amountStr === null || amountStr === undefined || amountStr === '') return null;
  const num = Number(String(amountStr).replace(/,/g, '').replace(/₹/g, '').trim());
  if (isNaN(num)) return null;
  return Math.round(num * 100);
};
