// src/components/admin/ParticipantDetailView.tsx
"use client";

import type { EventParticipant } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  UserCircle, Mail, Smartphone, Ticket, Hash, Info, Calendar, Clock,
  Banknote, FileText, ShieldCheck, HeartPulse, Shirt, MapPin, CheckCircle2,
  Users, Edit, Award, MessageCircle, Building, User as UserIcon, 
  Handshake, Check, Download, Loader2, CreditCard
} from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import Image from 'next/image';
import { isValidImageUrl, getInitials } from '@/lib/utils';
import jsPDF from 'jspdf';
import { useToast } from '@/hooks/use-toast';
import { waiverTextTemplate } from '@/lib/constants/waiver';

interface ParticipantDetailViewProps {
  participant: EventParticipant;
}

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

export default function ParticipantDetailView({ participant }: ParticipantDetailViewProps) {
    const { toast } = useToast();
    const [isWaiverModalOpen, setIsWaiverModalOpen] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    if (!participant) return null;

    const getPopulatedWaiverText = (forPdf = false) => {
        const eventDateStr = participant.eventDate ? format(parseISO(participant.eventDate), 'MMMM dd, yyyy') : 'TBD';
        const registrationDate = participant.registeredAt ? parseISO(participant.registeredAt) : new Date();

        let text = waiverTextTemplate
          .replace(/{{name}}/g, participant.name || 'N/A')
          .replace(/{{eventname}}/g, participant.eventName || 'the event')
          .replace(/{{category}}/g, participant.ticketName || 'Selected Category')
          .replace(/{{eventdate}}/g, eventDateStr)
          .replace(/{{address}}/g, participant.address || 'N/A')
          .replace(/{{phone}}/g, participant.mobile || 'N/A')
          .replace(/{{email}}/g, participant.email || 'N/A')
          .replace(/{{emergency_number}}/g, participant.emergencyContactNumber || 'N/A')
          .replace(/{{signature}}/g, participant.digitalSignatureName || participant.name || 'N/A')
          .replace(/{{day}}/g, format(registrationDate, 'do'))
          .replace(/{{date}}/g, format(registrationDate, 'MMMM, yyyy'))
          .replace(/{{organizer_name}}/g, participant.organizerName || 'Deccan Sports Club')
          .replace(/{{company_description}}/g, participant.organizerCompanyDescription || '')
          .replace(/{{organizer_address}}/g, participant.organizerAddress || '')
          .replace(/{{country}}/g, participant.country || 'India');

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
            
            const fileName = `Waiver_${participant.bookingId || 'NoID'}_${participant.name.replace(/\s+/g, '_')}.pdf`;
            doc.save(fileName);
            toast({ title: "Download Started" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error", description: error.message });
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const formatCurrency = (paisa: number | null | undefined) => {
        if (paisa === null || paisa === undefined) return 'N/A';
        return `₹${(paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatDate = (dateString: string | null | undefined) => {
        if (!dateString) return 'N/A';
        try {
            return format(parseISO(dateString), 'MMM dd, yyyy, p');
        } catch {
            return dateString;
        }
    };
    
    const checkInStatusVariant = participant.checkInStatus === 'CheckedIn' ? 'default' : 'destructive';
    const ticketStatusVariant = participant.ticketStatus?.toLowerCase() === 'active' ? 'default' : 'destructive';

    const locationStr = [participant.address, participant.city, participant.pincode].filter(Boolean).join(', ');
    const stateCountryStr = [participant.state, participant.country].filter(Boolean).join(', ');

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
                            <DetailRow icon={UserCircle} label="Full Name" value={participant.name} />
                            <DetailRow icon={Mail} label="Email Address" value={participant.email} />
                            <DetailRow icon={Smartphone} label="Contact No." value={participant.mobile} />
                            <DetailRow icon={Calendar} label="Date of Birth" value={participant.dob ? format(parseISO(participant.dob), 'MMM dd, yyyy') : 'N/A'} />
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
                            <DetailRow icon={Info} label="Sub-Category ID" value={participant.selectedSubCategory} />
                            <DetailRow icon={ShieldCheck} label="Ticket Status" value={participant.ticketStatus} isBadge badgeVariant={ticketStatusVariant} />
                            <DetailRow icon={Calendar} label="Actual Race Date" value={participant.eventDate ? format(parseISO(participant.eventDate), 'MMM dd, yyyy') : 'TBD'} />
                            <DetailRow icon={Calendar} label="Registered Date" value={formatDate(participant.registeredAt)} />
                            <DetailRow icon={Building} label="Affiliated Club" value={participant.clubName} />
                            <DetailRow icon={Hash} label="BIB Assigned" value={participant.bibNumber} />

                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Financials</h4>
                            <DetailRow icon={Banknote} label="Payment ID" value={participant.paymentId || participant.transactionId} />
                            <DetailRow icon={CreditCard} label="Method" value={participant.paymentMethod || 'Online'} />
                            <DetailRow icon={Banknote} label="Total Paid" value={formatCurrency(participant.amountPaidPaisa)} />
                            <DetailRow icon={Info} label="Balance Amount" value={formatCurrency(participant.balanceAmount)} />
                            <DetailRow icon={Info} label="Invoice No." value={participant.invoiceNumber} />

                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Check-In Progress</h4>
                            <DetailRow icon={CheckCircle2} label="Waiver Status" value={participant.checkInStatus || 'Pending'} isBadge badgeVariant={checkInStatusVariant} />
                            {participant.checkedInAt && <DetailRow icon={Clock} label="Check-in Time" value={formatDate(participant.checkedInAt)} />}
                            <DetailRow icon={UserIcon} label="Handled By" value={participant.checkedInByVolunteerName} />
                            
                            <h4 className="font-black text-[10px] uppercase tracking-widest pt-4 border-t mt-4 text-primary">Legal & Files</h4>
                            <DetailRow icon={FileText} label="Identity Proof" value={participant.idProofUrl ? "Open Document" : "Not Provided"} isClickable={!!participant.idProofUrl} onClick={() => participant.idProofUrl && window.open(participant.idProofUrl, '_blank')}/>
                            <DetailRow icon={Edit} label="Signature" value={participant.digitalSignatureName} />
                            <DetailRow 
                                icon={Handshake} 
                                label="Waiver Document" 
                                value={participant.agreedWaiver ? "Read Signed Waiver" : "No"} 
                                isClickable={!!participant.agreedWaiver} 
                                onClick={() => participant.agreedWaiver && setIsWaiverModalOpen(true)} 
                            />
                            <DetailRow icon={MessageCircle} label="Marketing Consent" value={participant.consentPromotions} isBoolean />
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            <Dialog open={isWaiverModalOpen} onOpenChange={setIsWaiverModalOpen}>
              <DialogContent className="max-w-2xl flex flex-col h-[90vh]">
                <DialogHeader>
                  <DialogTitle className="text-left font-black uppercase tracking-tight italic">Signed Waiver Agreement</DialogTitle>
                  <DialogDescription className="text-left">
                    Digitally signed by {participant.name} on {formatDate(participant.registeredAt)}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 p-4 pr-6 text-xs text-muted-foreground border rounded-xl bg-muted/30 whitespace-pre-line text-left leading-relaxed">
                  <div dangerouslySetInnerHTML={{ __html: getPopulatedWaiverText().replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                </ScrollArea>
                <DialogFooter className="pt-4 border-t gap-2 sm:justify-end">
                  <Button variant="outline" onClick={handleDownloadWaiverPdf} disabled={isGeneratingPdf} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">
                    {isGeneratingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4" />}
                    Download PDF
                  </Button>
                  <DialogClose asChild>
                    <Button type="button" className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Close</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
        </>
    );
}
