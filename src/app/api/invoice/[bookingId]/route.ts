// src/app/api/invoice/[bookingId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventParticipant } from '@/lib/types';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format as formatDateFns, parseISO } from 'date-fns';
import path from 'path';
import { promises as fs } from 'fs';

const getBase64Image = async (imagePath: string): Promise<string | null> => {
  try {
    const fullPath = path.join(process.cwd(), 'public', imagePath);
    const imageBuffer = await fs.readFile(fullPath);
    return `data:image/png;base64,${imageBuffer.toString('base64')}`;
  } catch (error) {
    console.error(`Error reading image file at ${imagePath}:`, error);
    return null;
  }
};

const formatCurrency = (paisa: number | null | undefined) => {
    if (paisa === null || paisa === undefined) return '0.00';
    return (paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export async function GET(
  request: NextRequest,
  { params }: { params: { bookingId: string } }
) {
  const { bookingId } = params;
  if (!bookingId) {
    return NextResponse.json({ success: false, message: 'Booking ID is required.' }, { status: 400 });
  }

  try {
    const adminDb = getFirestoreInstance();
    const participantsSnapshot = await adminDb.collectionGroup('participants').where('bookingId', '==', bookingId).limit(1).get();

    if (participantsSnapshot.empty) {
      return NextResponse.json({ success: false, message: `No participant found with Booking ID: ${bookingId}` }, { status: 404 });
    }

    const participantDoc = participantsSnapshot.docs[0];
    const participant = participantDoc.data() as EventParticipant;

    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const docWidth = doc.internal.pageSize.getWidth();
    const docHeight = doc.internal.pageSize.getHeight();

    // 1. Header
    const logoBase64 = await getBase64Image('/Bmlogowhite.png');
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', docWidth - 160, 40, 120, 40);
    }
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.text('TAX INVOICE', 40, 60);

    // 2. Organizer Details
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('DECCAN SPORTS CLUB', 40, 100);
    doc.setFont('helvetica', 'normal');
    const organizerAddress = [
      'E/G - 1 Apurva Tower opp Swami Pani Puravtha',
      'Rajarampuri 13th Lane',
      'Kolhapur, Maharashtra, 416008, India'
    ];
    doc.text(organizerAddress, 40, 112);
    doc.text(`Company ID: U84300PN2019NPL183235`, 40, 148);
    doc.text(`GSTIN: 27AAHCD1733D1Z0`, 40, 160);

    // 3. Bill To Details
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO:', docWidth - 200, 100);
    doc.setFont('helvetica', 'normal');
    const billingAddress = [
      participant.name,
      participant.address || 'Address not provided',
      `${participant.city || ''}, ${participant.state || ''} ${participant.pincode || ''}`,
      participant.country || 'India',
      `Email: ${participant.email}`,
      `Mobile: ${participant.mobile || 'N/A'}`
    ];
    doc.text(billingAddress, docWidth - 200, 112);

    // 4. Invoice Details
    const invoiceDetails = [
      ['Invoice No:', participant.invoiceNumber || 'N/A'],
      ['Invoice Date:', participant.registeredAt ? formatDateFns(parseISO(participant.registeredAt), 'MMM dd, yyyy') : 'N/A'],
      ['Booking ID:', participant.bookingId || 'N/A'],
      ['Event Name:', participant.eventName || 'N/A'],
    ];
    (doc as any).autoTable({
      startY: 200,
      body: invoiceDetails,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold' } },
    });

    // 5. Line Items Table
    const ticketPrice = participant.ticketPrice || 0;
    const discount = participant.couponDiscountPaisa || 0;
    const taxAmount = participant.taxAmountPaidPaisa || 0;
    const platformFee = participant.platformFeePaidPaisa || 0;
    const processingFee = participant.processingFeePaidPaisa || 0;
    
    const taxableAmount = ticketPrice - discount;

    const tableBody: any[] = [
        ['Event Ticket: ' + (participant.ticketName || 'N/A'), '1', formatCurrency(ticketPrice)],
    ];
    if (discount > 0) {
        tableBody.push([{content: 'Coupon Discount', styles: { fontStyle: 'bold' }}, '', `-${formatCurrency(discount)}`]);
    }
    tableBody.push(
      [{content: 'Taxable Amount', styles: { fontStyle: 'bold' }}, '', formatCurrency(taxableAmount)],
      ['CGST @ 9%', '', formatCurrency(taxAmount / 2)],
      ['SGST @ 9%', '', formatCurrency(taxAmount / 2)],
      ['Platform Fee', '', formatCurrency(platformFee)],
      ['Gateway Fee', '', formatCurrency(processingFee)]
    );


    (doc as any).autoTable({
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Description', 'Quantity', 'Amount (INR)']],
      body: tableBody,
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      didDrawPage: (data: any) => {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Total Amount:', data.settings.margin.left, data.cursor.y + 20);
        doc.text(formatCurrency(participant.amountPaidPaisa), docWidth - data.settings.margin.right, data.cursor.y + 20, { align: 'right' });
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Notes:', data.settings.margin.left, docHeight - 60);
        doc.text('Thanks for your business', data.settings.margin.left, docHeight - 48);
        doc.setFont('helvetica', 'bold');
        doc.text('This is a system Generated Invoice hence signature no required', data.settings.margin.left, docHeight - 36);
      }
    });

    const pdfBuffer = doc.output('arraybuffer');
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice_${participant.bookingId}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('Failed to generate invoice PDF:', error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
