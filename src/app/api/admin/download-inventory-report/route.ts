// src/app/api/admin/download-inventory-report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import * as XLSX from 'xlsx';
import { getParticipantsForEventAction } from '@/lib/actions/participantActions';
import type { EventParticipant, EventCalendarEntry, TicketDefinition, EventInventory } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getEventData = async (eventId: string) => {
    // Safety check for Firebase configuration
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Firebase not configured');
    }
    
    const adminDb = getFirestoreInstance();
    const eventDocRef = adminDb.collection('events').doc(eventId);
    const eventDoc = await eventDocRef.get();
    if (!eventDoc.exists) {
        throw new Error("Event not found.");
    }
    const eventData = eventDoc.data() as EventCalendarEntry;
    const ticketDefsSnapshot = await eventDocRef.collection('ticketDefinitions').get();
    const ticketDefinitions = ticketDefsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TicketDefinition);
    
    const participantsResult = await getParticipantsForEventAction(eventId);
    if (!participantsResult.success || !participantsResult.participants) {
        throw new Error(participantsResult.message || "Could not fetch participants.");
    }

    const inventorySnap = await adminDb.collection('events').doc(eventId).collection('inventory').doc('mainInventory').get();
    const inventory = inventorySnap.exists ? inventorySnap.data() as EventInventory : null;

    return {
        eventData: { ...eventData, ticketDefinitions },
        participants: participantsResult.participants,
        inventory
    };
};

const generateTshirtReport = (participants: any[]) => {
    const sizeGenderCounts: { [size: string]: { Male: number; Female: number; Other: number; Total: number } } = {};
    participants.forEach(p => {
        const size = p.tshirtSize || 'Unknown';
        const pGender = p.gender?.trim().toLowerCase();
        let normalizedGender: 'Male' | 'Female' | 'Other' = 'Other';
        if (pGender === 'male') normalizedGender = 'Male';
        else if (pGender === 'female') normalizedGender = 'Female';

        if (!sizeGenderCounts[size]) {
            sizeGenderCounts[size] = { Male: 0, Female: 0, Other: 0, Total: 0 };
        }
        sizeGenderCounts[size][normalizedGender]++;
        sizeGenderCounts[size].Total++;
    });
    const reportData = Object.entries(sizeGenderCounts).map(([size, counts]) => ({
        'T-Shirt Size': size, 'Male': counts.Male, 'Female': counts.Female,
        'Other/Unspecified': counts.Other, 'Total': counts.Total,
    })).sort((a,b) => a['T-Shirt Size'].localeCompare(b['T-Shirt Size']));
    const totalsRow = reportData.reduce((acc, curr) => ({
        Male: acc.Male + curr.Male, Female: acc.Female + curr.Female,
        Other: acc.Other + curr['Other/Unspecified'], Total: acc.Total + curr.Total
    }), { Male: 0, Female: 0, Other: 0, Total: 0 });
    reportData.push({ 'T-Shirt Size': 'GRAND TOTAL', 'Male': totalsRow.Male, 'Female': totalsRow.Female, 'Other/Unspecified': totalsRow.Other, 'Total': totalsRow.Total });
    return XLSX.utils.json_to_sheet(reportData);
};

const generateMedalReport = (participants: any[], eventData: EventCalendarEntry) => {
    const medalCounts: { [category: string]: { required: number, male: number, female: number, other: number } } = {};

    // Pre-populate with all ticket types from event definition to ensure all appear
    eventData.ticketDefinitions?.forEach(ticket => {
        if (ticket.ticketName) {
            medalCounts[ticket.ticketName] = { required: 0, male: 0, female: 0, other: 0 };
        }
    });

    // Count participants for each ticket type
    participants.forEach(p => {
        const category = p.ticketName || 'Uncategorized';
        // Only count if the category exists in our pre-populated list
        if (medalCounts[category]) {
            medalCounts[category].required++;
            const pGender = p.gender?.trim().toLowerCase();
            if (pGender === 'male') medalCounts[category].male++;
            else if (pGender === 'female') medalCounts[category].female++;
            else medalCounts[category].other++;
        }
    });

    const reportData = Object.entries(medalCounts).map(([category, counts]) => ({
        'Ticket Category': category, 
        'Total Required': counts.required,
        'Male': counts.male, 
        'Female': counts.female,
        'Other/Unspecified': counts.other,
    })).sort((a,b) => a['Ticket Category'].localeCompare(b['Ticket Category']));

    return XLSX.utils.json_to_sheet(reportData);
};


const generateTrophyReport = (participants: EventParticipant[]) => {
    const trophyCounts: { [raceCategory: string]: { [ageGroup: string]: { [gender: string]: number } } } = {};
    participants.forEach(p => {
        const raceCategory = p.ticketName || 'Uncategorized';
        const ageGroup = p.ageCategory || 'N/A';
        const gender = p.gender || 'Other';

        if (!trophyCounts[raceCategory]) trophyCounts[raceCategory] = {};
        if (!trophyCounts[raceCategory][ageGroup]) trophyCounts[raceCategory][ageGroup] = {};
        if (!trophyCounts[raceCategory][ageGroup][gender]) trophyCounts[raceCategory][ageGroup][gender] = 0;
        
        trophyCounts[raceCategory][ageGroup][gender]++;
    });

    const reportData: any[] = [];
    const sortedRaceCategories = Object.keys(trophyCounts).sort();

    for (const category of sortedRaceCategories) {
        reportData.push({ 'Race Category': category, 'Age Group': '', Gender: '', 'Participants': '', 'Trophies Needed (Top 3)': '' });
        const sortedAgeGroups = Object.keys(trophyCounts[category]).sort();
        
        for (const ageGroup of sortedAgeGroups) {
            const sortedGenders = Object.keys(trophyCounts[category][ageGroup]).sort();
            for (const gender of sortedGenders) {
                const count = trophyCounts[category][ageGroup][gender];
                reportData.push({
                    'Race Category': '',
                    'Age Group': ageGroup,
                    Gender: gender,
                    'Participants': count,
                    'Trophies Needed (Top 3)': Math.min(3, count)
                });
            }
        }
    }
    return XLSX.utils.json_to_sheet(reportData);
};

const generateSwimCapReport = (eventData: EventCalendarEntry, participants: EventParticipant[]) => {
    const swimCapCounts: { [category: string]: { required: number, color: string } } = {};
    
    eventData.ticketDefinitions?.forEach((ticket) => {
        if (ticket.ticketName) {
            const ticketNameUpper = ticket.ticketName.toUpperCase();
            let color = 'Gray';
            if (ticketNameUpper.includes('113')) color = 'Orange';
            else if (ticketNameUpper.includes('OLYMPIC')) color = 'Blue';
            
            swimCapCounts[ticket.ticketName] = { required: 0, color };
        }
    });

    participants.forEach(p => {
        if (p.ticketName && swimCapCounts[p.ticketName]) {
            swimCapCounts[p.ticketName].required++;
        }
    });
    
    const reportData = Object.entries(swimCapCounts).map(([category, data]) => ({
        'Ticket Category': category, 'Assigned Color': data.color, 'Quantity Needed': data.required
    }));

    if (reportData.length === 0) {
        return XLSX.utils.json_to_sheet([{ Message: "No tickets defined for this event." }]);
    }
    return XLSX.utils.json_to_sheet(reportData);
};


const generateFinisherJerseyReport = (participants: any[]) => {
    const jerseyCounts: { [category: string]: { [size: string]: { Male: number; Female: number; Other: number; Total: number } } } = {};
    participants.forEach(p => {
        const category = p.ticketName || 'Uncategorized';
        const size = p.tshirtSize || 'Unknown';
        const pGender = p.gender?.trim().toLowerCase();
        let normalizedGender: 'Male' | 'Female' | 'Other' = 'Other';
        if (pGender === 'male') normalizedGender = 'Male';
        else if (pGender === 'female') normalizedGender = 'Female';
        
        if (!jerseyCounts[category]) jerseyCounts[category] = {};
        if (!jerseyCounts[category][size]) jerseyCounts[category][size] = { Male: 0, Female: 0, Other: 0, Total: 0 };
        jerseyCounts[category][size][normalizedGender]++;
        jerseyCounts[category][size].Total++;
    });
    const reportData = [];
    for (const [category, sizes] of Object.entries(jerseyCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
        reportData.push({ 'Category/Size': category, 'Male': '', 'Female': '', 'Other': '', 'Total': '' });
        for (const [size, counts] of Object.entries(sizes).sort((a,b)=>a[0].localeCompare(b[0]))) {
            reportData.push({ 'Category/Size': `  ${size}`, 'Male': counts.Male, 'Female': counts.Female, 'Other': counts.Other, 'Total': counts.Total });
        }
    }
    return XLSX.utils.json_to_sheet(reportData);
};

const generateBagReport = (participants: any[], inventory: EventInventory | null) => {
    const required = participants.length;
    const initial = inventory?.bags?.initial || 0;
    const issued = inventory?.bags?.issued || 0;
    const remaining = initial - issued;
    const reportData = [
        { 'Item': 'Event Bags', 'Required': required, 'Initial Stock': initial, 'Issued': issued, 'Remaining': remaining }
    ];
    return XLSX.utils.json_to_sheet(reportData);
};

export async function POST(request: NextRequest) {
    const actionName = '[API /download-inventory-report POST]';
    try {
        const { type, data } = await request.json();

        if (type !== 'waterStations' || !data) {
            return NextResponse.json({ success: false, message: "Invalid report type or missing data for POST request." }, { status: 400 });
        }

        const { eventId, stationConfig, bikeStationItems, runStationItems } = data;
        
        // **FIX:** Fetch full participant data for the specified event
        const { eventData, participants } = await getEventData(eventId);
        
        const eventName = eventData.eventName || 'Export';
        const safeEventName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        const getCategoryDurationMinutes = (categoryName?: string | null): { bikeMinutes: number; runMinutes: number } => {
            if (!categoryName) return { bikeMinutes: 180, runMinutes: 120 };
            const upperCat = categoryName.toUpperCase();
            if (upperCat.includes('113')) return { bikeMinutes: 240, runMinutes: 150 };
            if (upperCat.includes('OLYMPIC')) return { bikeMinutes: 105, runMinutes: 75 };
            if (upperCat.includes('SPRINT')) return { bikeMinutes: 60, runMinutes: 45 };
            return { bikeMinutes: 180, runMinutes: 120 };
        };

        const participantsByCategory = new Map<string, number>();
        participants.forEach(p => {
            const category = p.ticketName || 'Unknown';
            participantsByCategory.set(category, (participantsByCategory.get(category) || 0) + 1);
        });

        const calculateRequirements = (items: any[], leg: 'bike' | 'run') => {
            return items.map(item => {
                if (item.type === 'fixed') {
                    const stations = leg === 'bike' ? stationConfig.bikeStations : stationConfig.runStations;
                    const total = (item.quantityPerStation || 1) * stations;
                    return { 'Item': item.name, 'Unit': item.unit, 'Rate/Qty per Station': item.quantityPerStation || 1, 'Est. per Station': Math.ceil(total / stations), 'Total Est.': Math.ceil(total) };
                }
                let totalRequired = 0;
                participantsByCategory.forEach((count, categoryName) => {
                    const durations = getCategoryDurationMinutes(categoryName);
                    const legDurationHours = (leg === 'bike' ? durations.bikeMinutes : durations.runMinutes) / 60;
                    totalRequired += count * (item.consumptionPerHour || 0) * legDurationHours;
                });
                const stations = leg === 'bike' ? stationConfig.bikeStations : stationConfig.runStations;
                return { 'Item': item.name, 'Unit': item.unit, 'Rate/Qty per Station': item.consumptionPerHour || 0, 'Est. per Station': stations > 0 ? Math.ceil(totalRequired / stations) : Math.ceil(totalRequired), 'Total Est.': Math.ceil(totalRequired) };
            });
        };

        const bikeReportData = calculateRequirements(bikeStationItems, 'bike');
        const runReportData = calculateRequirements(runStationItems, 'run');
        
        const wb = XLSX.utils.book_new();
        const wsBike = XLSX.utils.json_to_sheet(bikeReportData);
        const wsRun = XLSX.utils.json_to_sheet(runReportData);

        XLSX.utils.book_append_sheet(wb, wsBike, "Cycling Stations");
        XLSX.utils.book_append_sheet(wb, wsRun, "Running Stations");

        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
        const filename = `WaterStationReport_${safeEventName}.xlsx`;

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


export async function GET(request: NextRequest) {
  const actionName = '[API /download-inventory-report GET]';
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const reportType = searchParams.get('type');

    if (!eventId || !reportType) {
      return NextResponse.json({ success: false, message: "Event ID and Report Type are required." }, { status: 400 });
    }
    
    const { eventData, participants, inventory } = await getEventData(eventId);
    const eventName = eventData.eventName || 'Export';
    const safeEventName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    let worksheet;
    let filename = `inventory_report_${safeEventName}.xlsx`;

    switch (reportType) {
        case 'tshirt':
            worksheet = generateTshirtReport(participants);
            filename = `tshirt_inventory_report_${safeEventName}.xlsx`;
            break;
        case 'medal':
            worksheet = generateMedalReport(participants, eventData);
            filename = `medal_inventory_report_${safeEventName}.xlsx`;
            break;
        case 'trophy':
            worksheet = generateTrophyReport(participants);
            filename = `trophy_inventory_report_${safeEventName}.xlsx`;
            break;
        case 'swimcap':
            worksheet = generateSwimCapReport(eventData, participants);
            filename = `swimcap_inventory_report_${safeEventName}.xlsx`;
            break;
        case 'finisherjersey':
            worksheet = generateFinisherJerseyReport(participants);
            filename = `finisher_jersey_inventory_report_${safeEventName}.xlsx`;
            break;
        case 'bag':
            worksheet = generateBagReport(participants, inventory);
            filename = `bag_inventory_report_${safeEventName}.xlsx`;
            break;
        default:
            return NextResponse.json({ success: false, message: "Invalid report type specified." }, { status: 400 });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report`);
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
