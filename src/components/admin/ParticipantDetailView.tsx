// src/components/admin/ParticipantDetailView.tsx
"use client";

import type { EventParticipant } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, isValid, parse, parseISO } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  UserCircle, Mail, Smartphone, Ticket, Hash, Info, Calendar, Clock,
  Banknote, FileText, ShieldCheck, HeartPulse, Shirt, MapPin, CheckCircle2,
  Users, Edit, Award, MessageCircle, Building, User as UserIcon, 
  Handshake, Check, Download, Loader2, CreditCard, IndianRupee, DollarSign
} from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import Image from 'next/image';
import { isValidImageUrl, getInitials } from '@/lib/utils';
import jsPDF from 'jspdf';
import { useToast } from '@/hooks/use-toast';
import { waiverTextTemplate } from '@/lib/constants/waiver';
import { rulesAndRegulationsText } from '@/lib/constants/rules';

interface ParticipantDetailViewProps {
  participant: EventParticipant;
  isViewOnlyAdmin?: boolean;
}

const getIdProofType = (url?: string | null): 'pdf' | 'image' | 'other' => {
    if (!url) return 'other';
    const cleanUrl = url.split('?')[0].toLowerCase();
    if (cleanUrl.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)$/.test(cleanUrl)) return 'image';
    return isValidImageUrl(url) ? 'image' : 'other';
};

const parseDateSafe = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const parsedIso = parseISO(raw);
  if (isValid(parsedIso)) return parsedIso;

  const candidates = [
    parse(raw, 'yyyy-MM-dd', new Date()),
    parse(raw, 'dd/MM/yyyy', new Date()),
    parse(raw, 'MM/dd/yyyy', new Date()),
    parse(raw, 'dd-MM-yyyy', new Date()),
    parse(raw, 'MM-dd-yyyy', new Date()),
  ];
  const matched = candidates.find((d) => isValid(d));
  return matched ?? null;
};

const formatDateSafe = (value: string | null | undefined, pattern: string, fallback = 'N/A'): string => {
  const parsed = parseDateSafe(value);
  if (!parsed) return fallback;
  return format(parsed, pattern);
};

const acceptanceMark = (accepted?: boolean | null): string => (accepted ? '[✓] Accepted' : '[ ] Not Accepted');

const DetailRow = ({ icon: Icon, label, value, isBadge = false, badgeVariant = 'secondary', isBoolean = false, isClickable = false, onClick }: { icon: React.ElementType, label: string, value: React.ReactNode, isBadge?: boolean, badgeVariant?: any, isBoolean?: boolean, isClickable?: boolean, onClick?: () => void }) => {
    const isAnchorTag = React.isValidElement(value) && value.type === 'a';
  
    return (
        <div className="flex items-start py-1.5 border-b border-border/50">
            <div className="flex items-center gap-2 w-2/5 text-muted-foreground shrink-0">
                <Icon className="h-4 w-4" />
                <span className="font-medium text-xs">{label}</span>
            </div>
            <div className="w-3/5 break-words text-xs">
                {isClickable ? (
                    <Button variant="link" className="p-0 h-auto text-left text-primary text-xs" onClick={onClick}>{value}</Button>
                ) : isAnchorTag ? (
                    value 
                ) : React.isValidElement(value) && !isAnchorTag ? (
                    value
                ) : isBadge && typeof value === 'string' ? (
                    <Badge variant={badgeVariant} className="text-[10px] font-black uppercase">{value}</Badge>
                ) : isBoolean ? (
                    value ? <Check className="h-4 w-4 text-green-600" /> : <Info className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <span className="font-semibold">{value ?? <span className="text-muted-foreground italic font-normal">N/A</span>}</span>
                )}
            </div>
        </div>
    );
};

export default function ParticipantDetailView({ participant, isViewOnlyAdmin = false }: ParticipantDetailViewProps) {
    const { toast } = useToast();
    const [isWaiverModalOpen, setIsWaiverModalOpen] = useState(false);
    const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    if (!participant) return null;

    const relayMembers = Array.isArray(participant.relayParticipants) ? participant.relayParticipants : [];
    const isRelayTeam = !!participant.isRelay && relayMembers.length > 0;
    const displayName = isRelayTeam ? (participant.relayTeamName || participant.name) : participant.name;
    const primaryContactName = participant.buyerName || relayMembers[0]?.name || participant.name;
    const primaryContactEmail = participant.buyerEmail || relayMembers[0]?.email || participant.email;
    const relayAthleteNames = relayMembers
      .map((member) => `${member.role?.toUpperCase?.() || 'LEG'}: ${member.name || 'N/A'}`)
      .join(', ');

    const getPopulatedWaiverText = (forPdf = false) => {
      const eventDateStr = formatDateSafe(participant.eventDate, 'MMMM dd, yyyy', 'TBD');
      const registrationDate = parseDateSafe(participant.registeredAt) ?? new Date();

        let text = waiverTextTemplate
          .replace(/{{name}}/g, isRelayTeam ? (displayName || primaryContactName || 'N/A') : (primaryContactName || 'N/A'))
          .replace(/{{eventname}}/g, participant.eventName || 'the event')
          .replace(/{{category}}/g, participant.ticketName || 'Selected Category')
          .replace(/{{eventdate}}/g, eventDateStr)
          .replace(/{{address}}/g, participant.address || 'N/A')
          .replace(/{{phone}}/g, participant.mobile || 'N/A')
          .replace(/{{email}}/g, primaryContactEmail || 'N/A')
          .replace(/{{emergency_number}}/g, participant.emergencyContactNumber || 'N/A')
          .replace(/{{signature}}/g, participant.digitalSignatureName || primaryContactName || 'N/A')
          .replace(/{{day}}/g, format(registrationDate, 'do'))
          .replace(/{{date}}/g, format(registrationDate, 'MMMM, yyyy'))
          .replace(/{{organizer_name}}/g, participant.organizerName || 'Deccan Sports Club')
          .replace(/{{company_description}}/g, participant.organizerCompanyDescription || '')
          .replace(/{{organizer_address}}/g, participant.organizerAddress || '')
          .replace(/{{country}}/g, participant.country || 'India');

        if (isRelayTeam && relayAthleteNames) {
          text += `\n\nRelay Team Name: ${displayName || 'N/A'}\nRelay Athletes: ${relayAthleteNames}`;
        }

        if (forPdf) {
            return text.replace(/<[^>]*>?/gm, ''); // Strip HTML for PDF
        }
        return text;
    };

    const handleDownloadWaiverPdf = async () => {
        setIsGeneratingPdf(true);
        try {
            const doc = new jsPDF();
            const text = getPopulatedWaiverText(true);
            const splitText = doc.splitTextToSize(text, 180);
            
            const pageHeight = doc.internal.pageSize.getHeight();
            let y = 25;
            const margin = 15;
            const lineHeight = 5;

            doc.setFontSize(16);
            doc.text("Signed Indemnity Cum Waiver Agreement", 105, 15, { align: 'center' });
            
            doc.setFontSize(10);
            for (let i = 0; i < splitText.length; i++) {
                if (y + lineHeight > pageHeight - margin) {
                    doc.addPage();
                    y = margin;
                }
                doc.text(splitText[i], margin, y);
                y += lineHeight;
            }
            
            const fileName = `Waiver_${participant.bookingId || 'NoID'}_${displayName.replace(/\s+/g, '_')}.pdf`;
            doc.save(fileName);
            toast({ title: "Download Started" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error", description: error.message });
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const handleDownloadFilledFormPdf = async () => {
        setIsGeneratingPdf(true);
        try {
            const loadLogoData = async (): Promise<{ dataUrl: string; width: number; height: number } | null> => {
              try {
                const response = await fetch('/bwshop.png');
                if (!response.ok) return null;
                const blob = await response.blob();
                const dataUrl = await new Promise<string | null>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
                  reader.onerror = () => resolve(null);
                  reader.readAsDataURL(blob);
                });

                if (!dataUrl) return null;

                const dims = await new Promise<{ width: number; height: number }>((resolve) => {
                  const img = new window.Image();
                  img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
                  img.onerror = () => resolve({ width: 1, height: 1 });
                  img.src = dataUrl;
                });

                return { dataUrl, ...dims };
              } catch {
                return null;
              }
            };

            const doc = new jsPDF();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 14;
            const contentWidth = 210 - (margin * 2);
            let y = 16;
            const logoData = await loadLogoData();
            const signedOnDate = formatDate(participant.registeredAt) || format(new Date(), 'MMM dd, yyyy, p');
            const digitalSignatureValue = participant.digitalSignatureName || primaryContactName || 'N/A';

            const policySummaryText = [
              'Cancellation / Category Change / Deferral Policy',
              '',
              'Please review the latest policy before continuing. Key points:',
              '• Cancellation, deferral, and category-change requests are governed by Bergman policy windows.',
              '• Applicable fees, refunds, and timelines depend on event date, request date, and category.',
              '• Final approval and accounting actions are processed according to official policy terms.',
              '',
              'For full details, visit: /refund-policy',
            ].join('\n');

            const toPlainText = (html: string): string => {
              return String(html || '')
                .replace(/<li[^>]*>/gi, '\n• ')
                .replace(/<\/li>/gi, '')
                .replace(/<br\s*\/?\s*>/gi, '\n')
                .replace(/<\/p>/gi, '\n')
                .replace(/<\/h[1-6]>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            };

            const addSignatureFooter = () => {
              const footerY = pageHeight - 10;
              doc.setDrawColor(229, 231, 235);
              doc.line(margin, footerY - 4, margin + contentWidth, footerY - 4);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(8);
              doc.setTextColor(107, 114, 128);
              doc.text(`Digital Signature: ${digitalSignatureValue}`, margin, footerY);
              doc.text(`Signed as on: ${signedOnDate}`, margin + contentWidth, footerY, { align: 'right' });
              doc.setTextColor(0, 0, 0);
            };

            const addNewPage = () => {
              addSignatureFooter();
              doc.addPage();
              y = margin;
            };

            const ensureSpace = (requiredHeight: number) => {
              if (y + requiredHeight > pageHeight - margin) {
                addNewPage();
              }
            };

            const drawHeader = () => {
              ensureSpace(38);
              doc.setFillColor(255, 247, 237);
              doc.roundedRect(margin, y - 4, contentWidth, 28, 3, 3, 'F');

              if (logoData?.dataUrl) {
                try {
                  const logoBoxX = margin + 3;
                  const logoBoxY = y - 1.5;
                  const logoBoxW = 22;
                  const logoBoxH = 22;
                  const ratio = Math.max((logoData.width || 1) / (logoData.height || 1), 0.1);

                  let drawW = logoBoxW;
                  let drawH = drawW / ratio;
                  if (drawH > logoBoxH) {
                    drawH = logoBoxH;
                    drawW = drawH * ratio;
                  }

                  const drawX = logoBoxX + (logoBoxW - drawW) / 2;
                  const drawY = logoBoxY + (logoBoxH - drawH) / 2;
                  doc.addImage(logoData.dataUrl, 'PNG', drawX, drawY, drawW, drawH);
                } catch {
                  // Ignore logo render issues and continue generating PDF.
                }
              }

              doc.setTextColor(255, 255, 255);
              doc.setFont('helvetica', 'bold');
              doc.setFillColor(249, 115, 22);
              doc.roundedRect(margin + 26, y, contentWidth - 29, 8.5, 2, 2, 'F');
              doc.setFontSize(12);
              doc.text('PARTICIPANT FILLED FORM', margin + 29, y + 5.8);

              doc.setTextColor(55, 65, 81);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9);
              doc.text(`Registered and accepted the terms on: ${signedOnDate}`, margin + 29, y + 13.5);
              const note = 'Note: This is the form the participant has filled and accepted all the terms.';
              const noteLines = doc.splitTextToSize(note, contentWidth - 8);
              doc.setTextColor(75, 85, 99);
              doc.text(noteLines, margin + 3, y + 20.5);
              y += 34;
              doc.setTextColor(0, 0, 0);
              doc.setFont('helvetica', 'normal');
            };

            const drawSectionTitle = (title: string) => {
              ensureSpace(11);
              doc.setFillColor(243, 244, 246);
              doc.roundedRect(margin, y - 1.5, contentWidth, 8.5, 2, 2, 'F');
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(10);
              doc.setTextColor(31, 41, 55);
              doc.text(title.toUpperCase(), margin + 3, y + 3.8);
              y += 10.5;
            };

            const drawDetailRow = (label: string, value: string) => {
              const safeValue = value || 'N/A';
              const valueLines = doc.splitTextToSize(String(safeValue), 108);
              const rowHeight = Math.max(9, valueLines.length * 4.4 + 3);
              ensureSpace(rowHeight + 1.2);

              doc.setDrawColor(229, 231, 235);
              doc.line(margin, y + rowHeight, margin + contentWidth, y + rowHeight);

              doc.setFont('helvetica', 'bold');
              doc.setFontSize(8.8);
              doc.setTextColor(107, 114, 128);
              doc.text(label, margin + 2, y + 5.6);

              doc.setFont('helvetica', 'normal');
              doc.setTextColor(17, 24, 39);
              doc.text(valueLines, margin + 72, y + 5.6);
              y += rowHeight;
            };

            const drawLongTextSection = (title: string, text: string) => {
              addNewPage();
              drawSectionTitle(title);
              const lines = doc.splitTextToSize(text, contentWidth - 4);

              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9.2);
              doc.setTextColor(31, 41, 55);

              for (let i = 0; i < lines.length; i++) {
                if (y + 5 > pageHeight - (margin + 10)) {
                  addNewPage();
                  drawSectionTitle(title);
                  doc.setFont('helvetica', 'normal');
                  doc.setFontSize(9.2);
                  doc.setTextColor(31, 41, 55);
                }
                doc.text(lines[i], margin + 2, y + 3.8);
                y += 4.6;
              }

              y += 3;
            };

            drawHeader();
            drawDetailRow('Record ID', participant.id || 'N/A');
            drawDetailRow('Booking ID', participant.bookingId || 'N/A');

            drawSectionTitle('Identity');
            drawDetailRow('Full Name', isRelayTeam ? primaryContactName : participant.name || 'N/A');
            drawDetailRow('Email Address', String(isRelayTeam ? primaryContactEmail : participant.email || 'N/A'));
            drawDetailRow('Contact No.', participant.mobile || 'N/A');
            drawDetailRow('Emergency Contact', participant.emergencyContactNumber || 'N/A');
            drawDetailRow('Date of Birth', formatDateSafe(participant.dob, 'MMM dd, yyyy', 'N/A'));
            drawDetailRow('Gender', participant.gender || 'N/A');
            drawDetailRow('Blood Group', participant.bloodGroup || 'N/A');
            drawDetailRow('T-Shirt Size', participant.tshirtSize || 'N/A');

            drawSectionTitle('Logistics');
            drawDetailRow('Address', locationStr || 'N/A');
            drawDetailRow('State / Country', stateCountryStr || 'N/A');

            drawSectionTitle('Registration');
            drawDetailRow('Event Name', participant.eventName || 'N/A');
            drawDetailRow('Event Date', formatDateSafe(participant.eventDate, 'MMM dd, yyyy', 'TBD'));
            drawDetailRow('Race Ticket', participant.ticketName || 'N/A');
            drawDetailRow('Sub-Category ID', participant.selectedSubCategory || 'N/A');
            drawDetailRow('Ticket Status', participant.ticketStatus || 'N/A');
            drawDetailRow('Registered Date', formatDate(participant.registeredAt));
            drawDetailRow('BIB Assigned', participant.bibNumber || 'N/A');

            drawSectionTitle('Legal & Consent');
            drawDetailRow('Digital Signature', participant.digitalSignatureName || primaryContactName || 'N/A');
            drawDetailRow('Rules & Regulations', acceptanceMark(participant.agreedRules));
            drawDetailRow('Waiver Agreement', acceptanceMark(participant.agreedWaiver));
            drawDetailRow('Cut-Off Timings', acceptanceMark(participant.agreedCutoff));
            drawDetailRow('Cancellation/Category/Deferral Policy', acceptanceMark(true));
            drawDetailRow('Marketing Consent', acceptanceMark(participant.consentPromotions));

            drawLongTextSection('Detailed Rules & Regulations', toPlainText(rulesAndRegulationsText));
            drawLongTextSection('Detailed Waiver Agreement', getPopulatedWaiverText(true));
            drawLongTextSection('Detailed Cancellation / Category / Deferral Policy', policySummaryText);

            addSignatureFooter();

            const fileName = `Registration_Form_${participant.bookingId || 'NoID'}_${displayName.replace(/\s+/g, '_')}.pdf`;
            doc.save(fileName);
            toast({ title: 'Download Started' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const currencyCode: 'INR' | 'USD' =
      String((participant as any).currency || '').toUpperCase() === 'USD' ||
      participant.pricingBreakdown?.currency === 'USD' ||
      participant.paymentMethod?.toLowerCase().includes('stripe')
        ? 'USD'
        : 'INR';

    const CurrencyIcon = currencyCode === 'USD' ? DollarSign : IndianRupee;

    const formatCurrency = (paisa: number | null | undefined) => {
      if (paisa === null || paisa === undefined) return 'N/A';
      const locale = currencyCode === 'USD' ? 'en-US' : 'en-IN';
      const symbol = currencyCode === 'USD' ? '$' : '₹';
      return `${symbol}${(paisa / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const displayPaymentMethod = (() => {
      const rawMethod = String(participant.paymentMethod || '').trim();
      if (currencyCode === 'USD') return 'Stripe';
      return rawMethod || 'Online';
    })();

    const appliedCouponCode = String(participant.couponCode || '').trim();
    const couponDiscountPaisa = Number(
      participant.couponDiscountPaisa ?? participant.pricingBreakdown?.discount ?? 0
    );
    const baseForPercent = Number(
      participant.basePricePaisa ?? participant.pricingBreakdown?.base ?? 0
    );
    const couponDiscountPercent =
      couponDiscountPaisa > 0 && baseForPercent > 0
        ? Number(((couponDiscountPaisa / baseForPercent) * 100).toFixed(2))
        : 0;

    const formatDate = (dateString: string | null | undefined) => {
        if (!dateString) return 'N/A';
      return formatDateSafe(dateString, 'MMM dd, yyyy, p', dateString);
    };
    
    const checkInStatusVariant = participant.checkInStatus === 'CheckedIn' ? 'default' : 'destructive';
    const ticketStatusVariant = participant.ticketStatus?.toLowerCase() === 'active' ? 'default' : 'destructive';

    const locationStr = [participant.address, participant.city, participant.pincode].filter(Boolean).join(', ');
    const stateCountryStr = [participant.state, participant.country].filter(Boolean).join(', ');
    const effectiveIdProofUrl = participant.idProofUrl || participant.userProfile?.idProofUrl || null;
    const idProofType = getIdProofType(effectiveIdProofUrl);
    const proxiedIdProofUrl = effectiveIdProofUrl
      ? `/api/proxy-image?url=${encodeURIComponent(effectiveIdProofUrl)}`
      : null;

    return (
        <>
            <Card className="bg-muted/30 border-dashed text-left shadow-none border-none">
                <CardHeader className="pb-4 pt-4 px-0">
                    <CardTitle className="text-xl font-black uppercase tracking-tighter italic">Participant Profile</CardTitle>
                    <CardDescription className="text-xs font-medium">Record ID: {participant.id}</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                    <ScrollArea className="h-[60vh] pr-4">
                        <div className="space-y-1 text-sm">
                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-2 text-primary">Identity</h4>
                            {isRelayTeam && (
                              <>
                                <DetailRow icon={Users} label="Team Name" value={displayName} />
                                <DetailRow icon={Hash} label="Team BIB" value={participant.relayTeamBib || participant.bibNumber} />
                                <DetailRow icon={UserCircle} label="Team Captain" value={primaryContactName} />
                                <DetailRow icon={Mail} label="Captain Email" value={primaryContactEmail} />
                              </>
                            )}
                            <DetailRow icon={UserCircle} label={isRelayTeam ? 'Primary Contact' : 'Full Name'} value={isRelayTeam ? primaryContactName : participant.name} />
                            <DetailRow icon={Mail} label="Email Address" value={isRelayTeam ? primaryContactEmail : participant.email} />
                            <DetailRow icon={Smartphone} label="Contact No." value={participant.mobile} />
                            <DetailRow icon={Smartphone} label="Emergency Contact" value={participant.emergencyContactNumber} />
                            <DetailRow icon={Calendar} label="Date of Birth" value={formatDateSafe(participant.dob, 'MMM dd, yyyy', 'N/A')} />
                            <DetailRow icon={Award} label="Calculated Age" value={participant.age ? `${participant.age} years` : 'N/A'} />
                            <DetailRow icon={Users} label="Age Category" value={participant.ageCategory} />
                            <DetailRow icon={Users} label="Gender" value={participant.gender} />
                            <DetailRow icon={HeartPulse} label="Blood Group" value={participant.bloodGroup} />
                            <DetailRow icon={Shirt} label="T-Shirt Size" value={participant.tshirtSize} />

                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Logistics</h4>
                            <DetailRow icon={MapPin} label="Address" value={locationStr || null} />
                            <DetailRow icon={MapPin} label="State / Country" value={stateCountryStr || null} />

                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Registration</h4>
                            <DetailRow icon={Info} label="Booking ID" value={participant.bookingId} />
                            <DetailRow icon={Ticket} label="Race Ticket" value={participant.ticketName} />
                            {isRelayTeam && <DetailRow icon={Users} label="Relay Athletes" value={String(relayMembers.length)} />}
                            <DetailRow icon={Info} label="Sub-Category ID" value={participant.selectedSubCategory} />
                            <DetailRow icon={ShieldCheck} label="Ticket Status" value={participant.ticketStatus} isBadge badgeVariant={ticketStatusVariant} />
                            <DetailRow icon={Calendar} label="Actual Race Date" value={formatDateSafe(participant.eventDate, 'MMM dd, yyyy', 'TBD')} />
                            <DetailRow icon={Calendar} label="Registered Date" value={formatDate(participant.registeredAt)} />
                            <DetailRow icon={Building} label="Affiliated Club" value={participant.clubName} />
                            <DetailRow icon={Hash} label="BIB Assigned" value={participant.bibNumber} />

                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Financials</h4>
                            <DetailRow icon={Banknote} label="Payment ID" value={participant.paymentId || participant.transactionId} />
                            <DetailRow icon={CreditCard} label="Method" value={displayPaymentMethod} />
                            <DetailRow icon={CurrencyIcon} label="Total Paid" value={formatCurrency(participant.amountPaidPaisa)} />
                            <DetailRow icon={CurrencyIcon} label="Balance Amount" value={formatCurrency(participant.balanceAmount)} />
                            <DetailRow icon={Ticket} label="Coupon Used" value={appliedCouponCode || 'No'} isBadge badgeVariant={appliedCouponCode ? 'default' : 'secondary'} />
                            <DetailRow icon={CurrencyIcon} label="Coupon Discount" value={appliedCouponCode ? formatCurrency(couponDiscountPaisa) : 'N/A'} />
                            <DetailRow icon={Info} label="Coupon %" value={appliedCouponCode ? `${couponDiscountPercent}%` : 'N/A'} />
                            <DetailRow icon={Info} label="Invoice No." value={participant.invoiceNumber} />

                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Check-In Progress</h4>
                            <DetailRow icon={CheckCircle2} label="Waiver Status" value={participant.checkInStatus || 'Pending'} isBadge badgeVariant={checkInStatusVariant} />
                            {participant.checkedInAt && <DetailRow icon={Clock} label="Check-in Time" value={formatDate(participant.checkedInAt)} />}
                            <DetailRow icon={UserIcon} label="Handled By" value={participant.checkedInByVolunteerName} />
                            
                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Legal & Files</h4>
                            <DetailRow icon={FileText} label="Identity Proof" value={effectiveIdProofUrl ? "Open Document" : "Not Provided"} isClickable={!!effectiveIdProofUrl} onClick={() => effectiveIdProofUrl && setIsDocumentModalOpen(true)}/>
                            <DetailRow icon={Edit} label="Signature" value={participant.digitalSignatureName} />
                            <DetailRow 
                                icon={Handshake} 
                                label="Waiver Document" 
                                value={participant.agreedWaiver ? "Read Signed Waiver" : "No"} 
                                isClickable={!!participant.agreedWaiver} 
                                onClick={() => participant.agreedWaiver && setIsWaiverModalOpen(true)} 
                            />
                            <DetailRow icon={ShieldCheck} label="Rules Accepted" value={participant.agreedRules ? 'Yes' : 'No'} isBadge badgeVariant={participant.agreedRules ? 'default' : 'secondary'} />
                            <DetailRow icon={ShieldCheck} label="Cut-off Accepted" value={participant.agreedCutoff ? 'Yes' : 'No'} isBadge badgeVariant={participant.agreedCutoff ? 'default' : 'secondary'} />
                            <DetailRow icon={ShieldCheck} label="Cancellation/Category/Deferral Policy" value={participant.agreedPolicyChangeFlow ? 'Yes' : 'No'} isBadge badgeVariant={participant.agreedPolicyChangeFlow ? 'default' : 'secondary'} />
                            <DetailRow icon={MessageCircle} label="Marketing Consent" value={participant.consentPromotions} isBoolean />
                            <DetailRow 
                              icon={Download}
                              label="Filled Form"
                              value="Download Filled Form PDF"
                              isClickable
                              onClick={handleDownloadFilledFormPdf}
                            />

                            {isRelayTeam && (
                              <>
                                <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Relay Team Members</h4>
                                <div className="space-y-3 pt-2">
                                  {relayMembers.map((member, index) => (
                                    <div key={`${member.role}-${index}`} className="rounded-xl border bg-background p-3 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="font-black uppercase tracking-wide text-[11px] text-primary">
                                          {member.role} Leg
                                        </div>
                                        <Badge variant="outline" className="text-[10px] uppercase font-black">
                                          {member.bibNumber || member.bib || 'No BIB'}
                                        </Badge>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                        <div><span className="text-muted-foreground">Name:</span> <span className="font-semibold">{member.name || 'N/A'}</span></div>
                                        <div><span className="text-muted-foreground">Email:</span> <span className="font-semibold">{member.email || 'N/A'}</span></div>
                                        <div><span className="text-muted-foreground">Mobile:</span> <span className="font-semibold">{member.mobile || 'N/A'}</span></div>
                                        <div><span className="text-muted-foreground">Emergency:</span> <span className="font-semibold">{member.emergencyContactNumber || 'N/A'}</span></div>
                                        <div><span className="text-muted-foreground">DOB:</span> <span className="font-semibold">{formatDateSafe(member.dob, 'MMM dd, yyyy', 'N/A')}</span></div>
                                        <div><span className="text-muted-foreground">Gender:</span> <span className="font-semibold">{member.gender || 'N/A'}</span></div>
                                        <div><span className="text-muted-foreground">Blood Group:</span> <span className="font-semibold">{member.bloodGroup || 'N/A'}</span></div>
                                        <div><span className="text-muted-foreground">T-Shirt:</span> <span className="font-semibold">{member.tshirtSize || 'N/A'}</span></div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            <Dialog open={isWaiverModalOpen} onOpenChange={setIsWaiverModalOpen}>
              <DialogContent className="max-w-2xl flex flex-col h-[90vh]">
                <DialogHeader>
                  <DialogTitle className="text-left font-black uppercase tracking-tight italic">Signed Waiver Agreement</DialogTitle>
                  <DialogDescription className="text-left">
                    Digitally signed by {primaryContactName} on {formatDate(participant.registeredAt)}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 p-4 pr-6 text-xs text-muted-foreground border rounded-xl bg-muted/30 whitespace-pre-line text-left leading-relaxed">
                  <div dangerouslySetInnerHTML={{ __html: getPopulatedWaiverText().replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                </ScrollArea>
                <DialogFooter className="pt-4 border-t gap-2 sm:justify-end">
                  <Button variant="outline" onClick={handleDownloadFilledFormPdf} disabled={isGeneratingPdf || isViewOnlyAdmin} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">
                    {isGeneratingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4" />}
                    Download Filled Form
                  </Button>
                  <Button variant="outline" onClick={handleDownloadWaiverPdf} disabled={isGeneratingPdf || isViewOnlyAdmin} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">
                    {isGeneratingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4" />}
                    Download PDF
                  </Button>
                  <DialogClose asChild>
                    <Button type="button" className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Close</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isDocumentModalOpen} onOpenChange={setIsDocumentModalOpen}>
              <DialogContent className="max-w-3xl flex flex-col h-[90vh]">
                <DialogHeader>
                  <DialogTitle className="text-left font-black uppercase tracking-tight italic">Identity Proof</DialogTitle>
                  <DialogDescription className="text-left">
                    Uploaded by {displayName}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 flex items-center justify-center p-4 pr-6 border rounded-xl bg-muted/30">
                  {effectiveIdProofUrl && (
                    idProofType === 'pdf' ? (
                      <iframe
                        src={proxiedIdProofUrl || effectiveIdProofUrl}
                        title="Identity Proof PDF"
                        className="w-full h-[68vh] rounded-lg bg-white"
                      />
                    ) : idProofType === 'image' ? (
                      <Image
                        src={proxiedIdProofUrl || effectiveIdProofUrl}
                        alt="Identity Proof"
                        width={1200}
                        height={1600}
                        unoptimized
                        className="max-w-full h-auto object-contain rounded-lg"
                      />
                    ) : (
                      <div className="text-center text-sm text-muted-foreground space-y-2">
                        <p>Preview unavailable for this file type.</p>
                        <a href={effectiveIdProofUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                          Open document in new tab
                        </a>
                      </div>
                    )
                  )}
                </ScrollArea>
                <DialogFooter className="pt-4 border-t gap-2 sm:justify-end">
                  {effectiveIdProofUrl && (
                    <Button asChild variant="outline" className="rounded-xl font-bold uppercase text-[10px] tracking-widest">
                      <a href={effectiveIdProofUrl} target="_blank" rel="noreferrer">Open in New Tab</a>
                    </Button>
                  )}
                  <DialogClose asChild>
                    <Button type="button" className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Close</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
        </>
    );
}
