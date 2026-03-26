// src/app/api/admin/download-live-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import * as XLSX from 'xlsx';
import type { RaceResult } from '@/lib/types';

// This function will fetch data from the timing partner API for a single BIB
async function fetchApiData(apiUrl: string, bib: string, apiKey: string | null): Promise<any[]> {
    const url = new URL(apiUrl);
    url.searchParams.set('bibno', bib);
    const fullUrl = url.toString();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    try {
        const response = await fetch(fullUrl, { headers, signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
            console.warn(`API call for bib ${bib} failed with status ${response.status}`);
            return [];
        }
        const data = await response.json();
        if (data.result === 'pass' && data.data && Array.isArray(data.data)) {
            return data.data;
        }
        return [];
    } catch (e: any) {
        console.error(`Error fetching data for bib ${bib}:`, e.message);
        return [];
    }
}

// Case-insensitive and flexible getter for object properties.
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


export async function POST(request: NextRequest) {
  const actionName = '[API /admin/download-live-data]';
  try {
    const { eventId, apiUrl, apiKey } = await request.json();

    if (!eventId || !apiUrl) {
      return NextResponse.json({ success: false, message: "Event ID and API URL are required." }, { status: 400 });
    }

    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    const participantsSnapshot = await participantsRef.where('ticketStatus', '==', 'Active').get();

    if (participantsSnapshot.empty) {
        return NextResponse.json({ success: false, message: "No active participants found for this event." }, { status: 404 });
    }

    const bibToParticipantMap = new Map();
    participantsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if(data.bibNumber) {
        bibToParticipantMap.set(String(data.bibNumber), { name: data.name, email: data.email, mobile: data.mobile });
      }
    });

    const bibNumbers = Array.from(bibToParticipantMap.keys());
    if (bibNumbers.length === 0) {
        return NextResponse.json({ success: false, message: "No participants with BIB numbers found." }, { status: 404 });
    }
    
    const allData: any[] = [];
    
    // Fetch data for all bibs concurrently
    const promises = bibNumbers.map(bib => fetchApiData(apiUrl, bib, apiKey || null));
    const results = await Promise.all(promises);

    results.forEach((result, index) => {
        if (result && result.length > 0) {
            const bib = bibNumbers[index];
            const participantInfo = bibToParticipantMap.get(bib);
            // Assuming the most recent result is first in the array from the API
            const mostRecentData = result[0]; 
            const combinedData = {
                ...mostRecentData, // Timing partner data
                'Name': participantInfo?.name || mostRecentData.Name,
                'E-mail': participantInfo?.email || mostRecentData.Email,
                'Mobile': participantInfo?.mobile || mostRecentData.Mobile,
            };
            allData.push(combinedData);
        }
    });

    if (allData.length === 0) {
        return NextResponse.json({ success: false, message: "No data could be retrieved from the timing partner API for any participant." }, { status: 404 });
    }

    const headers = [
      "Bib Number", "Name", "Mobile", "E-mail", "Status", "status", "Category", "Gender",
      "Swim", "RUN 1", "T1", "Bike", "T2", "Run", "RUN 2", "Chip Time",
      "C Rank", "O Rank", "G Rank", "RACE CAT", "RACE YEAR", "RACE DATE",
      "LOCATION", "EVENT CAT", "EVENT NAME"
    ];

    const dataForSheet = allData.map(item => {
        const rowData: Record<string, any> = {};
        headers.forEach(header => {
            // Use getVal for each header to find the corresponding data in the item
            // Pass alt headers if needed, e.g., getVal(item, "Chip Time", ["chiptimestr"])
            rowData[header] = getVal(item, header);
        });
         // Ensure Name, Email, Mobile from our DB take precedence if they existed
        rowData['Name'] = item.Name;
        rowData['E-mail'] = item['E-mail'];
        rowData['Mobile'] = item.Mobile;
        
        return rowData;
    });


    const worksheet = XLSX.utils.json_to_sheet(dataForSheet, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Live Data Export");

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const eventName = (await adminDb.collection('events').doc(eventId).get()).data()?.eventName || 'Event';
    const filename = `live_data_export_${eventName.replace(/[^a-z0-9]/gi, '_')}.xlsx`;

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
