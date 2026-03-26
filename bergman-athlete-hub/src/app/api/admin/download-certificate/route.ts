// src/app/api/admin/download-certificate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { RaceResult, TicketDefinition } from '@/lib/types';
import { formatSecondsToHMS, getOrdinal, hmsToSeconds, isDuathlonEvent } from '@/lib/utils';
import { format as formatDateFns, parseISO } from 'date-fns';
import path from 'path';
import { promises as fs } from 'fs';

const getBase64Image = async (imagePath: string): Promise<string | null> => {
  try {
    const fullPath = path.join(process.cwd(), 'public', imagePath);
    const imageBuffer = await fs.readFile(fullPath);
    const imageBase64 = imageBuffer.toString('base64');
    const extension = path.extname(imagePath).substring(1);
    return `data:image/${extension};base64,${imageBase64}`;
  } catch (error) {
    console.error(`[API Download Certificate] Error reading image file at ${imagePath}:`, error);
    return null;
  }
};

export async function POST(request: NextRequest) {
    try {
        const { athlete, eventName, ticketDef } = await request.json() as { athlete: RaceResult, eventName: string, ticketDef?: TicketDefinition };

        if (!athlete || !eventName) {
            return NextResponse.json({ success: false, message: 'Missing athlete or event data.' }, { status: 400 });
        }

        const doc = new jsPDF({
            orientation: 'p',
            unit: 'px',
            format: [800, 1120]
        });
        
        const docWidth = doc.internal.pageSize.getWidth();
        const docHeight = doc.internal.pageSize.getHeight();

        // 1. Set Background Color
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, docWidth, docHeight, 'F');
        
        // 2. Add Border
        doc.setDrawColor(251, 191, 36); // amber-400
        doc.setLineWidth(4);
        doc.rect(2, 2, docWidth - 4, docHeight - 4, 'S');

        // 3. Add Logo
        const logoSrc = athlete.gender === 'Female' ? '/Bwwhitelogo.png' : '/Bmlogowhite.png';
        const logoBase64 = await getBase64Image(logoSrc);
        if (logoBase64) {
            doc.addImage(logoBase64, 'PNG', (docWidth - 200) / 2, 40, 200, 66);
        }

        // 4. Main Content
        doc.setFontSize(18);
        doc.setTextColor(251, 191, 36); // amber-400
        doc.text('FINISHER CERTIFICATE', docWidth / 2, 130, { align: 'center' });

        doc.setFontSize(36);
        doc.setTextColor(255, 255, 255);
        doc.text(athlete.name, docWidth / 2, 180, { align: 'center' });

        doc.setFontSize(14);
        doc.setTextColor(203, 213, 225); // slate-300
        const raceCategory = athlete.ticketName || athlete.raceCategory || eventName;
        const descriptionText = `This certificate is proudly presented for successfully completing the ${eventName} on ${athlete.raceDate ? formatDateFns(parseISO(athlete.raceDate), 'MMMM dd, yyyy') : 'race day'}, in ${raceCategory} demonstrating exceptional endurance, discipline and commitment.`;

        const splitText = doc.splitTextToSize(descriptionText, docWidth - 100);
        doc.text(splitText, docWidth / 2, 210, { align: 'center' });
        
        const descriptionTextHeight = doc.getTextDimensions(splitText).h;
        let currentY = 210 + descriptionTextHeight + 20;

        // 5. Chip Time
        doc.setFontSize(12);
        doc.setTextColor(251, 191, 36); // amber-400
        doc.text('FINISH TIME', docWidth / 2, currentY, { align: 'center' });
        currentY += 45;
        doc.setFontSize(56);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        const chipTime = formatSecondsToHMS(hmsToSeconds(athlete.chipTime));
        doc.text(chipTime, docWidth / 2, currentY, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        currentY += 25;

        // 6. Ranks
        doc.autoTable({
            startY: currentY,
            body: [[
                { content: `Overall: ${athlete.oRank || 'N/A'}${getOrdinal(Number(athlete.oRank))}`, styles: { halign: 'center' } },
                { content: `Gender: ${athlete.gRank || 'N/A'}${getOrdinal(Number(athlete.gRank))}`, styles: { halign: 'center' } },
                { content: `Category: ${athlete.cRank || 'N/A'}${getOrdinal(Number(athlete.cRank))}`, styles: { halign: 'center' } },
            ]],
            theme: 'plain',
            styles: { textColor: [255, 255, 255], fontSize: 16, fontStyle: 'bold' },
            margin: { left: 40, right: 40 },
        });

        // 7. Splits Table
        const legs = [];
        const isDua = isDuathlonEvent(athlete.ticketName || athlete.category);

        if (isDua) {
            if (athlete.run1) legs.push(['Run 1', formatSecondsToHMS(hmsToSeconds(athlete.run1))]);
            if (athlete.t1) legs.push(['T1', formatSecondsToHMS(hmsToSeconds(athlete.t1))]);
            if (athlete.bike) legs.push(['Bike', formatSecondsToHMS(hmsToSeconds(athlete.bike))]);
            if (athlete.t2) legs.push(['T2', formatSecondsToHMS(hmsToSeconds(athlete.t2))]);
            if (athlete.run2) legs.push(['Run 2', formatSecondsToHMS(hmsToSeconds(athlete.run2))]);
        } else {
            if (athlete.swim) legs.push(['Swim', formatSecondsToHMS(hmsToSeconds(athlete.swim))]);
            if (athlete.t1) legs.push(['T1', formatSecondsToHMS(hmsToSeconds(athlete.t1))]);
            if (athlete.bike) legs.push(['Bike', formatSecondsToHMS(hmsToSeconds(athlete.bike))]);
            if (athlete.t2) legs.push(['T2', formatSecondsToHMS(hmsToSeconds(athlete.t2))]);
            if (athlete.run) legs.push(['Run', formatSecondsToHMS(hmsToSeconds(athlete.run))]);
        }
        
        if (legs.length > 0) {
            doc.autoTable({
                startY: (doc as any).lastAutoTable.finalY + 30,
                head: [['Segment', 'Time']],
                body: legs,
                theme: 'striped',
                headStyles: { fillColor: [30, 41, 59], textColor: [251, 191, 36] },
                styles: { cellPadding: 8, fontSize: 12 },
                bodyStyles: { fillColor: [15, 23, 42], textColor: [226, 232, 240] },
                alternateRowStyles: { fillColor: [30, 41, 59] },
                margin: { left: 150, right: 150 },
            });
        }
        
        // 8. Footer with Signatures
        const signatureBase64 = await getBase64Image('/white signature.png');
        const roundLogoBase64 = await getBase64Image('/bmround.png');
        
        const footerY = docHeight - 100;
        if(signatureBase64) doc.addImage(signatureBase64, 'PNG', 40, footerY, 150, 50);
        if(roundLogoBase64) doc.addImage(roundLogoBase64, 'PNG', docWidth - 90, footerY - 10, 60, 60);
        
        const pdfBuffer = doc.output('arraybuffer');

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Finisher_Certificate_${athlete.name.replace(/ /g, '_')}.pdf"`,
            },
        });

    } catch (error: any) {
        console.error('Failed to generate certificate PDF:', error);
        return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
    }
}
