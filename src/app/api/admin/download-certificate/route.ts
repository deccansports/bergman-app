// src/app/api/admin/download-certificate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { RaceResult, TicketDefinition } from '@/lib/types';
import { formatSecondsToHMS, getOrdinal, hmsToSeconds, isDuathlonEvent, getPace, cleanText, getCountryCode } from '@/lib/utils';
import { format as formatDateFns, parseISO, getYear } from 'date-fns';
import path from 'path';
import { promises as fs } from 'fs';

export const dynamic = "force-dynamic";

const getBase64Image = async (imagePath: string): Promise<string | null> => {
  try {
    const fullPath = path.join(process.cwd(), 'public', imagePath);
    const imageBuffer = await fs.readFile(fullPath);
    const extension = path.extname(imagePath).substring(1);
    const mimeType = `image/${extension === 'svg' ? 'svg+xml' : extension}`;
    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  } catch (error) {
    console.error(`[API Download Certificate] Error reading image file at ${imagePath}:`, error);
    return null;
  }
};

const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/png';
        const base64 = Buffer.from(buffer).toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error(`[API Download Certificate] Error fetching image from ${url}:`, error);
        return null;
    }
};

export async function POST(request: NextRequest) {
    try {
        const { athlete, eventName, ticketDef, totalYearlyPoints, qrCodeUrl } = await request.json() as { 
            athlete: RaceResult, 
            eventName: string, 
            ticketDef?: TicketDefinition, 
            totalYearlyPoints?: number, 
            qrCodeUrl?: string,
        };

        if (!athlete || !eventName) {
            return NextResponse.json({ success: false, message: 'Missing athlete or event data.' }, { status: 400 });
        }
        
        const qrCodeBase64 = qrCodeUrl ? await fetchImageAsBase64(qrCodeUrl) : null;
        const isFemale = athlete.gender?.toLowerCase() === 'female';
        const logoPath = isFemale ? '/Bwwhitelogo.png' : '/Bmlogowhite.png';
        const mainLogoBase64 = await getBase64Image(logoPath);
        const directorSigBase64 = await getBase64Image('/white signature.png');
        const flagCode = getCountryCode(athlete.countryAtRace);
        const flagUrl = flagCode ? `https://flagcdn.com/w80/${flagCode.toLowerCase()}.png` : null;
        const flagBase64 = flagUrl ? await fetchImageAsBase64(flagUrl) : null;

        const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
        
        const docWidth = doc.internal.pageSize.getWidth();
        const docHeight = doc.internal.pageSize.getHeight();
        const margin = 64;
        const contentWidth = docWidth - (margin * 2);

        // Background & Border
        doc.setFillColor('#0f172a');
        doc.rect(0, 0, docWidth, docHeight, 'F');
        doc.setDrawColor('#facc15');
        doc.setLineWidth(3);
        doc.rect(10, 10, docWidth - 20, docHeight - 20);

        let currentY = margin;

        // Header
        if (mainLogoBase64) {
            doc.addImage(mainLogoBase64, 'PNG', (docWidth - 240) / 2, currentY, 240, 80, undefined, 'FAST');
            currentY += 80 + 16;
        }
        doc.setFontSize(16);
        doc.setTextColor('#facc15');
        doc.setFont('helvetica', 'bold');
        doc.text('FINISHER CERTIFICATE', docWidth / 2, currentY, { align: 'center' });
        currentY += 48;

        // Athlete Info
        const nameY = currentY;
        const cleanedName = cleanText(athlete.name);
        
        if (flagBase64) {
            const nameWidth = doc.getStringUnitWidth(cleanedName) * 36 / doc.internal.scaleFactor;
            const flagWidth = 36;
            const totalWidth = nameWidth + flagWidth + 8;
            const startX = (docWidth - totalWidth) / 2;
            doc.addImage(flagBase64, 'PNG', startX, nameY - 30, flagWidth, 24, undefined, 'FAST');
            doc.setFontSize(36);
            doc.setTextColor('#ffffff');
            doc.setFont('helvetica', 'bold');
            doc.text(cleanedName, startX + flagWidth + 8, nameY);
        } else {
            doc.setFontSize(36);
            doc.setTextColor('#ffffff');
            doc.setFont('helvetica', 'bold');
            doc.text(cleanedName, docWidth / 2, nameY, { align: 'center' });
        }
        currentY += 40;

        // Standardized Text
        const cleanEventName = cleanText(eventName);
        const cleanRaceCategory = cleanText(athlete.ticketName || athlete.raceCategory || eventName);
        const raceDateFormatted = athlete.raceDate ? formatDateFns(parseISO(athlete.raceDate), 'MMMM dd, yyyy') : 'race day';
        
        const completionMessageLine1 = "In recognition of determination, resilience, and athletic excellence.";
        const completionMessageLine2 = `This certificate is awarded for the successful completion of the`;
        const completionMessageLine3 = `${cleanEventName}`;
        const completionMessageLine4 = `held on ${raceDateFormatted}, in the ${cleanRaceCategory}.`;
        
        doc.setFontSize(12);
        doc.setTextColor('#d1d5db');
        doc.setFont('helvetica', 'normal');
        doc.text(completionMessageLine1, docWidth / 2, currentY, { align: 'center' });
        currentY += 15;
        doc.text(completionMessageLine2, docWidth / 2, currentY, { align: 'center' });
        currentY += 18;
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor('#facc15');
        doc.text(completionMessageLine3, docWidth / 2, currentY, { align: 'center' });
        currentY += 18;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor('#d1d5db');
        doc.text(completionMessageLine4, docWidth / 2, currentY, { align: 'center' });
        currentY += 24; 
        
        // Finish Time Hero Block
        doc.setFillColor(30, 41, 59, 0.5);
        doc.setDrawColor('#facc15');
        doc.setLineWidth(1);
        doc.roundedRect(margin, currentY, contentWidth, 96, 8, 8, 'FD');
        currentY += 28;
        doc.setFontSize(12);
        doc.setTextColor('#facc15');
        doc.text('FINISH TIME', docWidth / 2, currentY, { align: 'center' });
        currentY += 40;
        doc.setFontSize(48);
        doc.setFont('monospace', 'bold');
        doc.setTextColor('#ffffff');
        doc.text(formatSecondsToHMS(hmsToSeconds(athlete.chipTime)), docWidth / 2, currentY, { align: 'center' });
        currentY += 48;

        // Ranks and Points
        const rankData = [
            ['Overall Rank', `${athlete.oRank || 'N/A'}${getOrdinal(Number(athlete.oRank))}`],
            ['Gender Rank', `${athlete.gRank || 'N/A'}${getOrdinal(Number(athlete.gRank))}`],
            ['Category Rank', `${athlete.cRank || 'N/A'}${getOrdinal(Number(athlete.cRank))}`],
        ];
        
        const raceYear = athlete.raceDate ? getYear(parseISO(athlete.raceDate)) : new Date().getFullYear();
        const pointsData = [
            ['Points for this event', `${athlete.pointsAwarded || '0'}`],
            [`Total Points for ${raceYear}`, `${totalYearlyPoints || 0}`]
        ];
        
        (doc as any).autoTable({
            startY: currentY,
            body: [rankData.map(r=>cleanText(r[0])), rankData.map(r=>cleanText(r[1]))],
            theme: 'plain',
            styles: { halign: 'center', fontSize: 11, cellPadding: 8, textColor: '#ffffff' },
            headStyles: { fontSize: 9, textColor: '#d1d5db' },
            bodyStyles: { fontStyle: 'bold', fontSize: 20 },
            margin: { left: margin, right: margin },
        });
        currentY = (doc as any).lastAutoTable.finalY + 8;
        
        (doc as any).autoTable({
            startY: currentY,
            body: [pointsData.map(p=>cleanText(p[0])), pointsData.map(p=>cleanText(p[1]))],
            theme: 'plain',
            styles: { halign: 'center', fontSize: 11, cellPadding: 8, textColor: '#facc15', fontStyle: 'bold' },
            headStyles: { fontSize: 9, textColor: '#d1d5db', fontStyle: 'normal' },
            bodyStyles: { fontStyle: 'bold', fontSize: 20 },
            margin: { left: margin, right: margin },
        });
        currentY = (doc as any).lastAutoTable.finalY + 32;
        
        // Splits Table
        doc.setFontSize(14); doc.setTextColor('#facc15'); doc.setFont('helvetica', 'bold');
        doc.text('Your Splits', docWidth / 2, currentY, { align: 'center' });
        currentY += 24;

        const isDua = isDuathlonEvent(athlete.ticketName || athlete.category);
        const legs = [];
        if (isDua) {
            if (athlete.run1) legs.push({ label: 'Run 1', time: athlete.run1, distance: ticketDef?.courseMaps?.run1Distance, legType: 'run' });
            if (athlete.t1) legs.push({ label: 'T1', time: athlete.t1, distance: null, legType: 'transition' });
            if (athlete.bike) legs.push({ label: 'Bike', time: athlete.bike, distance: ticketDef?.courseMaps?.bikeDistance, legType: 'bike' });
            if (athlete.t2) legs.push({ label: 'T2', time: athlete.t2, distance: null, legType: 'transition' });
            if (athlete.run2) legs.push({ label: 'Run 2', time: athlete.run2, distance: ticketDef?.courseMaps?.run2Distance, legType: 'run' });
        } else {
            if (athlete.swim) legs.push({ label: 'Swim', time: athlete.swim, distance: ticketDef?.courseMaps?.swimDistance, legType: 'swim' });
            if (athlete.t1) legs.push({ label: 'T1', time: athlete.t1, distance: null, legType: 'transition' });
            if (athlete.bike) legs.push({ label: 'Bike', time: athlete.bike, distance: ticketDef?.courseMaps?.bikeDistance, legType: 'bike' });
            if (athlete.t2) legs.push({ label: 'T2', time: athlete.t2, distance: null, legType: 'transition' });
            if (athlete.run) legs.push({ label: 'Run', time: athlete.run, distance: ticketDef?.courseMaps?.runDistance, legType: 'run' });
        }

        const tableBody = legs.map(leg => {
            const timeSeconds = hmsToSeconds(leg.time);
            return [ cleanText(leg.label), leg.distance ? `${leg.distance.toFixed(2)} km` : '-', getPace(timeSeconds, leg.distance, leg.legType as any), formatSecondsToHMS(timeSeconds)];
        });
        const totalDistance = legs.reduce((acc, leg) => acc + (leg.distance || 0), 0);
        tableBody.push(['Finish', `${totalDistance.toFixed(2)} km`, getPace(hmsToSeconds(athlete.chipTime), totalDistance, 'run'), formatSecondsToHMS(hmsToSeconds(athlete.chipTime))]);
        
        (doc as any).autoTable({
            startY: currentY,
            head: [['Segment', 'Distance', 'Avg Pace / Speed', 'Time']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [30, 41, 59], textColor: [209, 213, 219], fontSize: 10, fontStyle: 'bold' },
            bodyStyles: { textColor: [229, 231, 235], fontSize: 11 },
            columnStyles: { 0: { fontStyle: 'bold' }, 3: { halign: 'right', font: 'courier', fontStyle: 'bold' }, 2: { halign: 'right' }, 1: { halign: 'right' } },
            didDrawCell: (data: any) => { if (data.section === 'body' && data.row.index === tableBody.length - 1) { data.cell.styles.fillColor = [48, 63, 89]; data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = '#facc15'; data.cell.styles.fontSize = 12; } },
            margin: { left: margin, right: margin },
        });

        // --- FOOTER ---
        const footerY = docHeight - margin + 10; 

        if (directorSigBase64) {
            const sigWidth = 120;
            const imgProps = doc.getImageProperties(directorSigBase64);
            const sigHeight = (imgProps.height * sigWidth) / imgProps.width;
            doc.addImage(directorSigBase64, 'PNG', margin, footerY - sigHeight, sigWidth, sigHeight);
        }

        if (qrCodeBase64) {
            const qrSize = 60;
            const qrX = docWidth - margin - qrSize;
            const qrY = footerY - qrSize - 10; 
            doc.addImage(qrCodeBase64, 'PNG', qrX, qrY, qrSize, qrSize);
            doc.setFontSize(8); doc.setTextColor('#9ca3af'); doc.setFont('helvetica', 'normal');
            doc.text('Scan to Verify', qrX + (qrSize / 2), qrY + qrSize + 8, { align: 'center' });
        }
        
        const pdfBuffer = doc.output('arraybuffer');
        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Finisher_Certificate_${cleanText(athlete.name).replace(/ /g, '_')}.pdf"`,
            },
        });
    } catch (error: any) {
        console.error('Failed to generate certificate PDF:', error);
        return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
    }
}
