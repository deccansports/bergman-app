
// src/app/api/admin/download-coupon-usage/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import * as XLSX from 'xlsx';
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const actionName = '[API /download-coupon-usage]';
  try {
    const { searchParams } = new URL(request.url);
    const couponCode = searchParams.get('couponCode');

    if (!couponCode) {
      return NextResponse.json({ success: false, message: "Coupon code is required." }, { status: 400 });
    }

    const adminDb = getFirestoreInstance();
    const allUsageData: EventParticipant[] = [];

    // Get all events first
    const eventsSnapshot = await adminDb.collection('events').get();

    // Iterate through each event and fetch its participants, then filter in memory
    for (const eventDoc of eventsSnapshot.docs) {
      const participantsSnapshot = await eventDoc.ref.collection('participants').get();
      participantsSnapshot.forEach(participantDoc => {
        const pData = participantDoc.data() as EventParticipant;
        if (pData.couponCode === couponCode) {
          allUsageData.push(pData);
        }
      });
    }
    
    const usageData = allUsageData.map(pData => {
        return {
          'Athlete Name': pData.name,
          'Email Address': pData.email,
          'Event Name': pData.eventName,
          'Ticket Name / Category': pData.ticketName,
          'Registered At': pData.registeredAt ? new Date(pData.registeredAt).toLocaleString() : 'N/A',
          'Booking ID': pData.bookingId,
        };
    });

    const safeCouponCode = couponCode.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `coupon_usage_${safeCouponCode}.xlsx`;

    if (usageData.length === 0) {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet([{'Message': `No usage found for coupon code: ${couponCode}`}]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Usage Report");
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(usageData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Usage Report");
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
