// src/app/api/admin/download-participants/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeParticipantData } from '@/lib/utils';
import * as XLSX from 'xlsx';
import type { EventParticipant, User, TicketDefinition } from '@/lib/types';
import { format as formatDateFns, parseISO, isValid as isDateValid } from 'date-fns';

export const dynamic = 'force-dynamic';

const toTitleCase = (str: string | null | undefined): string => {
  if (!str) return '';
  return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

export async function GET(request: NextRequest) {
  const actionName = '[API /download-participants]';
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const backupAll = searchParams.get('backupAll') === 'true';

    if (!eventId) {
      return NextResponse.json({ success: false, message: "Event ID is required." }, { status: 400 });
    }

    const adminDb = getFirestoreInstance();
    const eventDoc = await adminDb.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return NextResponse.json({ success: false, message: "Event not found." }, { status: 404 });
    }
    const eventName = eventDoc.data()?.eventName || 'Export';

    // Fetch tickets to resolve sub-category names (Distances)
    const ticketsSnap = await eventDoc.ref.collection('ticketDefinitions').get();
    const subCategoryMap = new Map<string, string>();
    ticketsSnap.forEach(tDoc => {
        const tData = tDoc.data() as TicketDefinition;
        if (tData.subCategories) {
            tData.subCategories.forEach((sub: any) => {
                subCategoryMap.set(sub.id, sub.name);
            });
        }
    });

    // Base query for participants
    let participantsQuery = adminDb.collection('events').doc(eventId).collection('participants')
      .orderBy('name', 'asc');
      
    if (!backupAll) {
      participantsQuery = participantsQuery.where('ticketStatus', '==', 'Active');
    }
    
    const participantsSnapshot = await participantsQuery.get();
    
    const safeEventName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filenameSuffix = backupAll ? 'full_backup' : 'active_participants';
    const filename = `participants_${safeEventName}_${filenameSuffix}.xlsx`;

    if (participantsSnapshot.empty) {
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
    
    const participantList = participantsSnapshot.docs.map(doc => serializeParticipantData(doc) as EventParticipant);

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

    const participantsData = participantList.map(pData => {
      const formatTimestamp = (ts: string | null | undefined) => {
        if (!ts) return '';
        try {
          const date = parseISO(ts);
          return isDateValid(date) ? formatDateFns(date, 'MMM dd, yyyy p') : '';
        } catch { return ''; }
      };

      const isDeferredFromPune = !!pData.previousDeferralDetails && (pData.previousDeferralDetails.originalEventName || '').toLowerCase().includes('pune');
      const isGenerallyDeferred = pData.ticketStatus === 'Deferred';
      
      const userProfile = pData.email ? userProfiles.get(pData.email.toLowerCase()) : null;

      return {
        'Athlete Name': toTitleCase(pData.name),
        'Email Address': pData.email,
        'Mobile': pData.mobile,
        'Booking ID': pData.bookingId,
        'BIB Number': pData.bibNumber || 'N/A',
        'Ticket Name': pData.ticketName,
        'Distance / Sub-Category': pData.selectedSubCategory ? (subCategoryMap.get(pData.selectedSubCategory) || pData.selectedSubCategory) : 'N/A',
        'Ticket Status': pData.ticketStatus,
        'Affiliated Club': userProfile?.clubName || pData.clubName || 'N/A',
        'Ticket Price': (pData.ticketPrice ?? 0) / 100,
        'Amount Paid (INR)': (pData.amountPaidPaisa ?? 0) / 100,
        'Balance Amount': (pData.balanceAmount ?? 0) / 100,
        'Tax Amount': (pData.taxAmountPaidPaisa ?? 0) / 100,
        'Processing Fee': (pData.processingFeePaidPaisa ?? 0) / 100,
        'Registered At': formatTimestamp(pData.registeredAt),
        'Actual Race Date': pData.eventDate || 'N/A',
        'Waiver Check-in Status': pData.checkInStatus,
        'Waiver Checked-in At': formatTimestamp(pData.checkedInAt),
        'Waiver Volunteer': pData.checkedInByVolunteerName,
        'Waiver Counter': pData.checkInCounter,
        'Handover To Name': pData.checkInDetails?.handedOverTo?.name,
        'Handover To Mobile': pData.checkInDetails?.handedOverTo?.mobile,
        'Bike Check-in': formatTimestamp(pData.bikeCheckedInAt),
        'Bike Check-in Remarks': pData.bikeCheckInDetails?.remarks || 'N/A',
        'Helmet Checked': pData.bikeCheckInDetails?.helmetChecked ? 'Yes' : 'No',
        'Bike Check-out': formatTimestamp(pData.bikeCheckedOutAt),
        'Locker Number': pData.lockerNumber || 'N/A',
        'Medal Issued': pData.medalIssued ? 'Yes' : 'No',
        'Finisher Jersey Issued': pData.finisherJerseyIssued ? 'Yes' : 'No',
        'Food Issued': pData.foodIssued ? 'Yes' : 'No',
        'Gender': pData.gender,
        'DOB': pData.dob,
        'Age': pData.age,
        'Age Category': pData.ageCategory,
        'T-shirt Size': pData.tshirtSize,
        'Blood Group': pData.bloodGroup,
        'Emergency Contact': pData.emergencyContactNumber,
        'Address': pData.address,
        'City': pData.city,
        'State': pData.state,
        'Country': pData.country,
        'Pincode': pData.pincode,
        'Identity Proof': pData.idProofUrl || 'N/A',
        'Transaction ID': pData.transactionId,
        'Deferred': isGenerallyDeferred ? 'Yes' : 'No',
        'Deferred from pune': isDeferredFromPune ? 'Yes' : 'No',
        'Cancellation Reason': pData.cancellationDetails?.reason || null,
        'Updated At': formatTimestamp(pData.updatedAt),
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
