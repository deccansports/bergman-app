// src/app/api/admin/download-participants/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV } from '@/lib/cloudflare/kv';
import { serializeParticipantData } from '@/lib/utils';
import { getRegistrationsCollectionRef } from '@/lib/eventDataPaths';
import * as XLSX from 'xlsx';
import type { EventParticipant, User, TicketDefinition } from '@/lib/types';
import { format as formatDateFns, parseISO, isValid as isDateValid } from 'date-fns';
import type { BelRankedAthlete } from '@/lib/actions/eliteLeagueActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BEL_SEASON = 2025;

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toParticipantRowsFromKvPayload(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.participants)) return payload.participants;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  // Prefer booking-based maps to avoid duplicate aliases from bib/uuid compact keys
  if (payload?.byBookingId && typeof payload.byBookingId === 'object') return Object.values(payload.byBookingId);
  if (payload?.byBooking && typeof payload.byBooking === 'object') return Object.values(payload.byBooking);
  if (payload?.byUuid && typeof payload.byUuid === 'object') return Object.values(payload.byUuid);
  if (payload?.byUUID && typeof payload.byUUID === 'object') return Object.values(payload.byUUID);
  if (payload?.byProviderUuid && typeof payload.byProviderUuid === 'object') return Object.values(payload.byProviderUuid);
  if (payload?.byBib && typeof payload.byBib === 'object') return Object.values(payload.byBib);
  return [];
}

function pickBestKvParticipantRows(candidates: Array<{ payload: any; source: string }>): { rows: any[]; source: string } {
  for (const candidate of candidates) {
    const rows = dedupeParticipants(toParticipantRowsFromKvPayload(candidate.payload));
    if (rows.length > 0) {
      return { rows, source: candidate.source };
    }
  }
  return { rows: [], source: 'none' };
}

function getParticipantDedupKey(participant: any, fallbackIndex: number): string {
  const normalize = (value: any) => String(value || '').trim().toLowerCase();
  const registrationId = normalize(participant?.registrationId);
  if (registrationId) return `registration:${registrationId}`;

  const bookingId = normalize(participant?.bookingId);
  if (bookingId) return `booking:${bookingId}`;

  const participantId = normalize(participant?.participantId || participant?.id);
  if (participantId) return `participant:${participantId}`;

  const providerUuid = normalize(
    participant?.providerUuid || participant?.provider_uuid || participant?.providerParticipantUuid || participant?.participantUuid || participant?.participant_uuid,
  );
  if (providerUuid) return `provider:${providerUuid}`;

  const athleteUid = normalize(participant?.athleteUid || participant?.userId || participant?.bergmanAthleteId);
  if (athleteUid) return `athlete:${athleteUid}`;

  const email = normalize(participant?.email || participant?.emailAddress || participant?.mail);
  if (email) return `email:${email}`;

  const bibNumber = normalize(participant?.bibNumber);
  if (bibNumber) return `bib:${bibNumber}`;

  return `fallback:${fallbackIndex}`;
}

function dedupeParticipants<T extends Record<string, any>>(items: T[]): T[] {
  const merged = new Map<string, T>();
  items.forEach((participant, index) => {
    const key = getParticipantDedupKey(participant, index);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        ...participant,
      });
      return;
    }
    merged.set(key, participant);
  });
  return Array.from(merged.values());
}

function toNumberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMoneyDisplayValue(...values: any[]): number {
  for (const value of values) {
    const parsed = toNumberOrNull(value);
    if (parsed === null) continue;
    return parsed / 100;
  }
  return 0;
}

const toTitleCase = (str: string | null | undefined): string => {
  if (!str) return '';
  const normalized = String(str).trim().replace(/\s+/g, ' ');
  return normalized.replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
};

export async function GET(request: NextRequest) {
  const actionName = '[API /download-participants]';
  
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const backupAll = searchParams.get('backupAll') === 'true';
    const downloadType = searchParams.get('type') === 'relay' ? 'relay' : 'individual';
    const statusFilter = String(searchParams.get('statusFilter') || 'all');
    const ticketFilter = String(searchParams.get('ticketFilter') || 'all');
    const ageCategoryFilter = String(searchParams.get('ageCategoryFilter') || 'all');
    const puneDeferredFilter = String(searchParams.get('puneDeferredFilter') || 'all');
    const billingFilter = String(searchParams.get('billingFilter') || 'all');
    const clubFilter = String(searchParams.get('clubFilter') || 'all');
    const belTierFilter = String(searchParams.get('belTierFilter') || 'all');
    const participantSearchTerm = String(searchParams.get('participantSearchTerm') || '').toLowerCase();

    if (!eventId) {
      return NextResponse.json({ success: false, message: "Event ID is required." }, { status: 400 });
    }

    const adminDb = getFirestoreInstance();
    const eventDoc = await adminDb.collection('events').doc(eventId).get();
    const eventName = eventDoc.exists
      ? (eventDoc.data()?.eventName || 'Export')
      : `event_${eventId}`;

    // Fetch tickets to resolve sub-category names (Distances)
    const ticketsSnap = eventDoc.exists
      ? await eventDoc.ref.collection('ticketDefinitions').get()
      : null;
    const subCategoryMap = new Map<string, string>();
    ticketsSnap?.forEach(tDoc => {
      const tData = tDoc.data() as TicketDefinition;
      if (tData.subCategories) {
        tData.subCategories.forEach((sub: any) => {
          subCategoryMap.set(sub.id, sub.name);
        });
      }
    });

    // Base query for participants (type filtering happens in-memory)
    const participantsRef = getRegistrationsCollectionRef(adminDb, eventId);
    const registrationsSnapshot = backupAll
      ? await participantsRef.get()
      : await participantsRef.where('ticketStatus', '==', 'Active').get();

    // If indexed active query returns empty, fallback to full scan + in-memory active filter.
    const registrationsDocs = (!backupAll && registrationsSnapshot.empty)
      ? (await participantsRef.get()).docs.filter((doc) => {
          const data = doc.data() as any;
          return String(data?.ticketStatus || '').trim() === 'Active';
        })
      : registrationsSnapshot.docs;

    let participantListAll = dedupeParticipants(
      registrationsDocs.map((doc) => ({
        ...(serializeParticipantData(doc) as EventParticipant),
        id: doc.id,
      }))
    );

    // Legacy Firestore fallback (events/{eventId}/participants) before KV fallback.
    if (participantListAll.length === 0) {
      const legacyParticipantsRef = adminDb.collection('events').doc(eventId).collection('participants');
      const legacySnapshot = backupAll
        ? await legacyParticipantsRef.get()
        : await legacyParticipantsRef.where('ticketStatus', '==', 'Active').get();

      const legacyDocs = (!backupAll && legacySnapshot.empty)
        ? (await legacyParticipantsRef.get()).docs.filter((doc) => {
            const data = doc.data() as any;
            return String(data?.ticketStatus || '').trim() === 'Active';
          })
        : legacySnapshot.docs;

      participantListAll = dedupeParticipants(
        legacyDocs.map((doc) => ({
          ...(serializeParticipantData(doc) as EventParticipant),
          id: doc.id,
        }))
      );

      if (participantListAll.length > 0) {
        console.log(`${actionName} Using legacy Firestore participants source`, {
          eventId,
          rows: participantListAll.length,
        });
      }
    }

    if (participantListAll.length === 0) {
      const [legacyIndex, fullParticipantsIndex, liveParticipantIndex, eventParticipantIndex] = await Promise.all([
        getKV<any>(`event:${eventId}:index`, actionName),
        getKV<any>(`event:${eventId}:participants:index`, actionName),
        getKV<any>(`live:event:${eventId}:participant:index`, actionName),
        getKV<any>(`event:${eventId}:participant:index`, actionName),
      ]);

      const kvPicked = pickBestKvParticipantRows([
        { payload: liveParticipantIndex, source: `live:event:${eventId}:participant:index` },
        { payload: eventParticipantIndex, source: `event:${eventId}:participant:index` },
        { payload: fullParticipantsIndex, source: `event:${eventId}:participants:index` },
        { payload: legacyIndex, source: `event:${eventId}:index` },
      ]);
      const kvRows = kvPicked.rows;

      if (kvRows.length > 0) {
        console.log(`${actionName} Using KV source for download`, {
          eventId,
          source: kvPicked.source,
          rows: kvRows.length,
        });

        participantListAll = kvRows.map((row: any) => {
          const bookingId = String(row?.bookingId || row?.registrationId || row?.id || '').trim();
          const bibNumber = String(row?.bibNumber || row?.bib || '').trim();
          const ticketStatus = String(row?.ticketStatus || row?.registration?.ticketStatus || row?.registration?.status || row?.status || 'Active').trim();
          const ticketName = String(row?.ticketName || row?.registration?.ticketName || row?.contestName || row?.category || '').trim();
          const selectedSubCategory = String(row?.selectedSubCategory || row?.subCategoryId || row?.subCategoryUuid || row?.ageGroupName || '').trim();

          return {
            ...row,
            id: row?.id || bookingId || bibNumber || undefined,
            bookingId,
            bibNumber,
            ticketStatus,
            ticketName,
            selectedSubCategory,
            isRelay: Boolean(row?.isRelay || row?.relayTeamName || row?.relayParticipants),
            name: row?.name || row?.fullName || row?.athleteName || row?.registration?.name || '',
            email: row?.email || row?.registration?.email || '',
            mobile: row?.mobile || row?.phone || row?.phoneNumber || row?.registration?.mobile || '',
          };
        });

        // Final safety dedupe after normalization/mapping
        participantListAll = dedupeParticipants(participantListAll);
      }
    }
    
    const safeEventName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const typeSuffix = downloadType === 'relay' ? 'relay' : 'individual';
    const filenameSuffix = backupAll ? `full_backup_${typeSuffix}` : `active_${typeSuffix}_participants`;
    const filename = `participants_${safeEventName}_${filenameSuffix}.xlsx`;

    if (participantListAll.length === 0) {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet([{'Message': `No ${backupAll ? '' : 'active'} participants found for this event.`}]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Participants");
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    }
    
    participantListAll = participantListAll.sort((a, b) => String((a as any).name || '').localeCompare(String((b as any).name || '')));

    const belRankings = await getKV<BelRankedAthlete[]>(`bel:season:${BEL_SEASON}:rankings`, actionName) || [];
    const belLookup = new Map<string, string>();
    belRankings.forEach((athlete) => {
      if (athlete.athleteId) belLookup.set(`uid:${athlete.athleteId}`, athlete.belTier);
      if (athlete.email) belLookup.set(`email:${athlete.email.toLowerCase()}`, athlete.belTier);
      if (athlete.mobile) belLookup.set(`mobile:${String(athlete.mobile).replace(/\D/g, '')}`, athlete.belTier);
    });

    const filteredParticipants = participantListAll
      .filter((p) => statusFilter === 'all' || p.ticketStatus === statusFilter)
      .filter((p) => ticketFilter === 'all' || p.ticketId === ticketFilter)
      .filter((p) => ageCategoryFilter === 'all' || String(p.ageCategory || '').trim() === ageCategoryFilter)
      .filter((p) => billingFilter === 'all' || p.billingType === billingFilter)
      .filter((p) => {
        const hasClub = !!(p.clubId || p.clubName);
        if (clubFilter === 'all') return true;
        if (clubFilter === 'with-club') return hasClub;
        if (clubFilter === 'no-club') return !hasClub;
        return p.clubId === clubFilter;
      })
      .filter((p) => {
        const isPune = p.previousDeferralDetails?.originalEventName?.toLowerCase().includes('pune');
        if (puneDeferredFilter === 'all') return true;
        if (puneDeferredFilter === 'yes') return !!isPune;
        if (puneDeferredFilter === 'no') return !isPune;
        return true;
      })
      .filter((p) => {
        if (belTierFilter === 'all') return true;
        const athleteUid = p.athleteUid ? `uid:${p.athleteUid}` : null;
        const emailKey = p.email ? `email:${p.email.toLowerCase()}` : null;
        const mobileKey = p.mobile ? `mobile:${String(p.mobile).replace(/\D/g, '')}` : null;
        const rawTier = (athleteUid && belLookup.get(athleteUid)) || (emailKey && belLookup.get(emailKey)) || (mobileKey && belLookup.get(mobileKey)) || null;
        const tier = (!rawTier || rawTier === 'Unranked') ? 'No Tier' : rawTier;
        return tier === belTierFilter;
      })
      .filter((p) => {
        if (!participantSearchTerm) return true;
        const relayMembers = Array.isArray((p as any).relayParticipants) ? (p as any).relayParticipants : [];
        return (
          p.name?.toLowerCase().includes(participantSearchTerm) ||
          p.email?.toLowerCase().includes(participantSearchTerm) ||
          p.bibNumber?.toLowerCase().includes(participantSearchTerm) ||
          p.bookingId?.toLowerCase().includes(participantSearchTerm) ||
          (p.relayTeamName || '').toLowerCase().includes(participantSearchTerm) ||
          relayMembers.some((member: any) =>
            (member.name || '').toLowerCase().includes(participantSearchTerm) ||
            (member.email || '').toLowerCase().includes(participantSearchTerm) ||
            (member.bibNumber || member.bib || '').toLowerCase().includes(participantSearchTerm)
          )
        );
      });

    const participantList = filteredParticipants.filter((participant) =>
      downloadType === 'relay' ? !!participant.isRelay : !participant.isRelay
    );

    if (participantList.length === 0) {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet([{
        'Message': downloadType === 'relay'
          ? `No ${backupAll ? '' : 'active'} relay teams found for this event.`
          : `No ${backupAll ? '' : 'active'} individual participants found for this event.`
      }]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Participants");
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    }

    const emails = participantList.map(p => p.email?.toLowerCase()).filter(Boolean) as string[];
    const userProfiles = new Map<string, User>();

    if (emails.length > 0) {
      for (let i = 0; i < emails.length; i += 30) {
        const batchEmails = emails.slice(i, i + 30);
        const usersSnapshot = await adminDb.collection('users').where('email', 'in', batchEmails).get();
        usersSnapshot.forEach(doc => {
            const data = doc.data() as User;
            if (data.email) userProfiles.set(data.email.toLowerCase(), data);
        });
      }
    }

    const participantsData = participantList.map((pData) => {
      const participant = pData as any;
      const formatTimestamp = (ts: string | null | undefined) => {
        if (!ts) return '';
        try {
          const date = parseISO(ts);
          return isDateValid(date) ? formatDateFns(date, 'MMM dd, yyyy p') : '';
        } catch { return ''; }
      };

      const isDeferredFromPune = !!participant.previousDeferralDetails && (participant.previousDeferralDetails.originalEventName || '').toLowerCase().includes('pune');
      const isGenerallyDeferred = participant.ticketStatus === 'Deferred';
      
      const userProfile = participant.email ? userProfiles.get(participant.email.toLowerCase()) : null;
      const pricingBreakdown = (participant.pricingBreakdown && typeof participant.pricingBreakdown === 'object')
        ? (participant.pricingBreakdown as Record<string, any>)
        : ({} as Record<string, any>);
            const ticketPrice = getMoneyDisplayValue(
        participant.ticketPrice,
        participant.basePricePaisa,
        participant.basePrice,
        pricingBreakdown.base,
        pricingBreakdown.totalBase,
      );
            const amountPaid = getMoneyDisplayValue(
        participant.amountPaidPaisa,
        participant.originalAmountPaidAtFirstRegistrationPaisa,
        participant.totalAmountPaidPaisa,
        pricingBreakdown.totalPayable,
        pricingBreakdown.amountPaid,
      );
            const taxAmount = getMoneyDisplayValue(
        participant.taxAmountPaidPaisa,
        participant.gstAmountPaidPaisa,
        participant.totalTaxPaidPaisa,
        pricingBreakdown.eventGST,
        pricingBreakdown.taxAmount,
        pricingBreakdown.gstAmount,
      );
            const processingFee = getMoneyDisplayValue(
        participant.processingFeePaidPaisa,
        participant.platformFeePaidPaisa,
        participant.processingFeePaisa,
        pricingBreakdown.processingFeeBase,
        pricingBreakdown.processingGST,
        pricingBreakdown.platformFeeBase,
        pricingBreakdown.platformGST,
        pricingBreakdown.processingFee,
      );
      const belTier =
        (participant.athleteUid ? belLookup.get(`uid:${participant.athleteUid}`) : null) ||
        (participant.email ? belLookup.get(`email:${participant.email.toLowerCase()}`) : null) ||
        (participant.mobile ? belLookup.get(`mobile:${String(participant.mobile).replace(/\D/g, '')}`) : null) ||
        'N/A';

      const relayAthletes = Array.isArray(participant.relayParticipants)
        ? participant.relayParticipants
        : [];
      const relayAthleteNames = relayAthletes.length > 0
        ? relayAthletes
            .map((member: any) => {
              const athleteBib = member.bibNumber || member.bib || 'N/A';
              const athleteName = toTitleCase(member.name) || 'N/A';
              return `${athleteBib} ${athleteName}`;
            })
            .join(' | ')
        : '';

      return {
        'Athlete Name': toTitleCase((pData.isRelay ? (pData.relayTeamName || pData.name) : pData.name) || userProfile?.name),
        ...(downloadType === 'relay' ? { 'Relay Athlete Names': relayAthleteNames || 'N/A' } : {}),
        'Email Address': pData.email,
        'Mobile': participant.mobile,
        'BEL Season': BEL_SEASON,
        'BEL Recognition': belTier,
        'Booking ID': participant.bookingId,
        'BIB Number': participant.bibNumber || 'N/A',
        'Ticket Name': toTitleCase(participant.ticketName),
        'Distance / Sub-Category': participant.selectedSubCategory ? (subCategoryMap.get(participant.selectedSubCategory) || participant.selectedSubCategory) : 'N/A',
        'Ticket Status': participant.ticketStatus,
        'Affiliated Club': toTitleCase(userProfile?.clubName || participant.clubName) || 'N/A',
        'Ticket Price': ticketPrice,
        'Amount Paid (INR)': amountPaid,
        'Balance Amount': getMoneyDisplayValue(participant.balanceAmount, participant.balanceAmountPaisa, pricingBreakdown.balanceAmount, pricingBreakdown.balanceAmountPaisa),
        'Tax Amount': taxAmount,
        'Processing Fee': processingFee,
        'Registered At': formatTimestamp(participant.registeredAt),
        'Actual Race Date': participant.eventDate || 'N/A',
        'Waiver Check-in Status': participant.checkInStatus,
        'Waiver Checked-in At': formatTimestamp(participant.checkedInAt),
        'Waiver Volunteer': participant.checkedInByVolunteerName,
        'Waiver Counter': participant.checkInCounter,
        'Handover To Name': participant.checkInDetails?.handedOverTo?.name,
        'Handover To Mobile': participant.checkInDetails?.handedOverTo?.mobile,
        'Bike Check-in': formatTimestamp(participant.bikeCheckedInAt),
        'Bike Check-in Remarks': participant.bikeCheckInDetails?.remarks || 'N/A',
        'Helmet Checked': participant.bikeCheckInDetails?.helmetChecked ? 'Yes' : 'No',
        'Bike Check-out': formatTimestamp(participant.bikeCheckedOutAt),
        'Locker Number': participant.lockerNumber || 'N/A',
        'Medal Issued': participant.medalIssued ? 'Yes' : 'No',
        'Finisher Jersey Issued': participant.finisherJerseyIssued ? 'Yes' : 'No',
        'Food Issued': participant.foodIssued ? 'Yes' : 'No',
        'Gender': toTitleCase(participant.gender),
        'DOB': participant.dob,
        'Age': participant.age,
        'Age Category': participant.ageCategory,
        'T-shirt Size': (participant.tshirtSize || '').toUpperCase(),
        'Blood Group': (participant.bloodGroup || '').toUpperCase(),
        'Emergency Contact': participant.emergencyContactNumber,
        'Address': participant.address,
        'City': toTitleCase(participant.city),
        'State': toTitleCase(participant.state),
        'Country': toTitleCase(participant.country),
        'Pincode': participant.pincode,
        'Identity Proof': participant.idProofUrl || userProfile?.idProofUrl || 'N/A',
        'Transaction ID': participant.transactionId,
        'Deferred': isGenerallyDeferred ? 'Yes' : 'No',
        'Deferred from pune': isDeferredFromPune ? 'Yes' : 'No',
        'Cancellation Reason': participant.cancellationDetails?.reason || null,
        'Updated At': formatTimestamp(participant.updatedAt),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(participantsData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Participants");
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });

  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
