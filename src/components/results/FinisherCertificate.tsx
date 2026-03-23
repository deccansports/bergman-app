// src/components/results/FinisherCertificate.tsx
/* eslint-disable @next/next/no-img-element */
import React, { useRef, useCallback, useState, useEffect, useMemo } from "react";
import Image from "next/image";
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";

import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Download,
  Loader2,
  Waves,
  Bike as BikeIcon,
  Footprints,
  ChevronsRight,
  Flag,
  ShieldAlert,
  Rocket,
  Award as AwardIcon,
  Hash as HashIcon,
  User as UserIcon,
  CalendarDays,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';


import type { RaceResult, TicketDefinition } from "@/lib/types";
import {
  formatSecondsToHMS,
  hmsToSeconds,
  getOrdinal,
  getPace,
  isDuathlonEvent,
  cleanText,
  getCountryCode,
  normalizeStatus,
} from "@/lib/utils";

import { CertificatePost } from "./CertificatePost";
import { CertificateStory } from "./CertificateStory";
import { CertificateSquare } from "./CertificateSquare";
import { CertificatePrint } from "./CertificatePrint";


interface Props {
  athlete: RaceResult;
  eventName: string;
  eventSlug?: string | null;
  ticketDef?: TicketDefinition;
  totalYearlyPoints?: number | null;
  onBack: () => void;
}

const Stat = ({ label, value }: { label: string, value: string | number | undefined | null }) => (
  <div className="text-center bg-slate-800/50 p-4 rounded-lg">
    <p className="text-sm text-slate-400">{label}</p>
    <p className="text-3xl font-bold text-white">{value || 'N/A'}</p>
  </div>
);

const NonFinisherDisplay = ({ athlete, eventName, raceDate, onBack }: { athlete: RaceResult, eventName: string, raceDate: string, onBack: () => void; }) => {
    const status = normalizeStatus(athlete.status);
    return (
        <Card className="w-full max-w-2xl mx-auto shadow-lg rounded-2xl overflow-hidden border-2 border-amber-500 bg-gradient-to-br from-amber-50/50 via-background to-background">
            <CardHeader className="p-8 text-center bg-amber-100/50">
                <ShieldAlert className="h-16 w-16 mx-auto text-amber-600" />
                <CardTitle className="text-2xl font-bold text-amber-800 mt-4">Event Participation Update</CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
                <div className="text-center">
                    <p className="text-lg text-muted-foreground">Thank you for being registered for <strong>{eventName}</strong>.</p>
                    <p className="mt-4">According to the official race results, this event was marked as:</p>
                    <Badge variant="destructive" className="text-2xl font-bold mt-2 px-4 py-2">{status}</Badge>
                    <p className="text-xs text-muted-foreground mt-2">(This message also applies to DNQ or DNF results.)</p>
                </div>

                <div className="p-4 bg-muted/50 rounded-lg border text-sm">
                    <h3 className="font-semibold text-lg text-center mb-4">{athlete.name}</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-2"><HashIcon className="h-4 w-4 text-muted-foreground" /> <strong>Bib:</strong> {athlete.bibNumber}</div>
                        <div className="flex items-center gap-2"><AwardIcon className="h-4 w-4 text-muted-foreground" /> <strong>Category:</strong> {athlete.category}</div>
                        <div className="col-span-2 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> <strong>Date:</strong> {raceDate}</div>
                    </div>
                </div>

                <Separator />

                <div>
                    <h3 className="text-xl font-semibold text-center text-primary">But This Is Not The End</h3>
                    <p className="text-muted-foreground text-center mt-2 max-w-md mx-auto">
                        Every athlete’s journey includes challenges. Missing a start, facing a tough race, or not finishing does not define your capability. What defines you is your decision to return stronger.
                    </p>
                </div>

                <div className="p-6 bg-primary/10 rounded-lg text-center">
                    <h3 className="text-xl font-semibold text-center text-primary flex items-center justify-center gap-2">
                        <Rocket className="h-6 w-6" /> Your Comeback Starts Now
                    </h3>
                    <p className="text-muted-foreground mt-2 mb-4">We invite you to register for the upcoming Bergman events and continue your journey toward greatness.</p>
                    <Button asChild>
                        <Link href="/races">Register for the next Bergman event</Link>
                    </Button>
                </div>
                
                 <p className="text-center text-lg italic text-muted-foreground pt-4">
                    “Champions are not built in comfort. They are built in comeback stories.”
                </p>
            </CardContent>
        </Card>
    );
};


export default function FinisherCertificate({
  athlete,
  eventName,
  eventSlug,
  ticketDef,
  onBack
}: Props) {
  const { toast } = useToast();
  const postRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const [isDownloadingPost, setIsDownloadingPost] = useState(false);
  const [isDownloadingStory, setIsDownloadingStory] = useState(false);
  const [isDownloadingSquare, setIsDownloadingSquare] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  const raceDate = athlete.raceDate
    ? format(parseISO(athlete.raceDate), "MMMM dd, yyyy")
    : "Race Day";

  const countryCode = getCountryCode(athlete.countryAtRace);
  const flagSrc = countryCode ? `https://flagcdn.com/h40/${countryCode.toLowerCase()}.png` : null;

  const status = normalizeStatus(athlete.status);
  const isFinished = status === 'Finished';

  const verificationUrl = useMemo(() => {
    if (typeof window === 'undefined' || !eventSlug || !athlete.bibNumber) return '';
    return `${window.location.origin}/results?eventSlug=${eventSlug}&bib=${athlete.bibNumber}`;
  }, [eventSlug, athlete.bibNumber]);

  useEffect(() => {
    if (!verificationUrl) return;

    const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
      verificationUrl
    )}`;

    fetch(`/api/proxy-image?url=${encodeURIComponent(qrApi)}`)
      .then(r => r.blob())
      .then(b => {
        const reader = new FileReader();
        reader.onload = () => setQrCodeDataUrl(reader.result as string);
        reader.readAsDataURL(b);
      })
      .catch(e => console.error("QR Code fetch error:", e));
  }, [verificationUrl]);

  const isDua = isDuathlonEvent(athlete.ticketName || athlete.category);

  const legs = useMemo(() => {
    const m = ticketDef?.courseMaps;
    const resultLegs: { k: string, t: string, d?: number | null, type: 'swim'|'bike'|'run'|'transition' }[] = [];

    if (isDua) {
        if (athlete.run1) resultLegs.push({ k: "Run 1", t: athlete.run1, d: m?.run1Distance, type: "run" });
        if (athlete.t1) resultLegs.push({ k: "T1", t: athlete.t1, type: "transition" });
        if (athlete.bike) resultLegs.push({ k: "Bike", t: athlete.bike, d: m?.bikeDistance, type: "bike" });
        if (athlete.t2) resultLegs.push({ k: "T2", t: athlete.t2, type: "transition" });
        if (athlete.run2) resultLegs.push({ k: "Run 2", t: athlete.run2, d: m?.run2Distance, type: "run" });
    } else {
        if (athlete.swim) resultLegs.push({ k: "Swim", t: athlete.swim, d: m?.swimDistance, type: "swim" });
        if (athlete.t1) resultLegs.push({ k: "T1", t: athlete.t1, type: "transition" });
        if (athlete.bike) resultLegs.push({ k: "Bike", t: athlete.bike, d: m?.bikeDistance, type: "bike" });
        if (athlete.t2) resultLegs.push({ k: "T2", t: athlete.t2, type: "transition" });
        if (athlete.run) resultLegs.push({ k: "Run", t: athlete.run, d: m?.runDistance, type: "run" });
    }
    return resultLegs;
  }, [athlete, ticketDef, isDua]);
  
  const certificateData = useMemo(() => {
    const isFemale = athlete.gender?.toLowerCase() === 'female';
    const logoUrl = isFemale ? '/Bwwhitelogo.png' : '/Bmlogowhite.png';

    return {
      name: cleanText(athlete.name),
      eventName: cleanText(eventName),
      category: cleanText(athlete.ticketName || athlete.raceCategory),
      date: raceDate,
      finishTime: formatSecondsToHMS(hmsToSeconds(athlete.chipTime)),
      overallRank: `${athlete.oRank || 'N/A'}${getOrdinal(Number(athlete.oRank))}`,
      genderRank: `${athlete.gRank || 'N/A'}${getOrdinal(Number(athlete.gRank))}`,
      categoryRank: `${athlete.cRank || 'N/A'}${getOrdinal(Number(athlete.cRank))}`,
      logoUrl: logoUrl,
      signatureUrl: '/white signature.png',
      qrCodeUrl: qrCodeDataUrl,
      splits: legs.map(l => ({
          label: l.k,
          distance: l.d ? `${l.d.toFixed(2)} km` : '-',
          pace: getPace(hmsToSeconds(l.t), l.d, l.type),
          time: formatSecondsToHMS(hmsToSeconds(l.t)),
      })),
      flagSrc: flagSrc,
    };
  }, [athlete, eventName, raceDate, qrCodeDataUrl, legs, flagSrc]);

  const downloadImage = useCallback(async (ref: React.RefObject<HTMLDivElement>, format: 'post' | 'story' | 'square') => {
    if (!ref.current) return;
    
    let setDownloading: (isDownloading: boolean) => void;
    switch (format) {
      case 'post': setDownloading = setIsDownloadingPost; break;
      case 'story': setDownloading = setIsDownloadingStory; break;
      case 'square': setDownloading = setIsDownloadingSquare; break;
    }
    
    setDownloading(true);

    try {
      const dataUrl = await toPng(ref.current, { cacheBust: true, pixelRatio: 2 });
      const a = document.createElement("a");
      a.download = `Bergman_${cleanText(athlete.name)}_${format}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Export failed", description: e.message });
    } finally {
      setDownloading(false);
    }
  }, [athlete.name, toast]);

 const downloadPdf = useCallback(async () => {
    if (!printRef.current) {
      toast({ title: "Error", description: "Certificate template not ready.", variant: "destructive" });
      return;
    }
    setIsDownloadingPdf(true);
    try {
      const dataUrl = await toPng(printRef.current, { cacheBust: true, pixelRatio: 2 });
      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Finisher_Certificate_${cleanText(athlete.name)}.pdf`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "PDF Export failed", description: e.message });
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [athlete.name, toast]);

  const isFemale = athlete.gender?.toLowerCase() === 'female';
  const logoUrl = isFemale ? '/Bwwhitelogo.png' : '/Bmlogowhite.png';

  if (!isFinished) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="mb-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Results
          </Button>
        </div>
        <NonFinisherDisplay athlete={athlete} eventName={eventName} raceDate={raceDate} onBack={onBack} />
        
        <Card className="mt-8">
            <CardHeader><CardTitle>Share Your Achievement</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <Button disabled className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    <Download className="mr-2"/> Print (PDF)
                </Button>
                <Button disabled className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    <Download className="mr-2"/> Post (4:5)
                </Button>
                <Button disabled className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    <Download className="mr-2"/> Story (9:16)
                </Button>
                <Button disabled className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    <Download className="mr-2"/> Square (1:1)
                </Button>
            </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Results
        </Button>
      </div>

      <div className="w-full max-w-4xl mx-auto shadow-2xl rounded-2xl overflow-hidden bg-slate-900 text-white p-8">
        <div className="text-center space-y-6">
            <Image
                src={logoUrl}
                alt="Bergman Logo"
                width={200}
                height={66}
                className="object-contain mx-auto"
            />
             <div className="flex items-center justify-center gap-4">
                {flagSrc && <img src={flagSrc} alt={`${athlete.countryAtRace} flag`} className="h-8 rounded-sm"/>}
                <h1 className="text-4xl font-bold">{cleanText(athlete.name)}</h1>
            </div>
            <p className="text-base text-slate-300 max-w-2xl mx-auto">
                In recognition of determination, resilience, and athletic excellence. This certificate is awarded for the successful completion of the <strong className="text-primary">{eventName}</strong> held on {raceDate} in the <strong className="text-primary">{athlete.category}</strong>.
            </p>
        </div>

        <div className="my-8 py-6 text-center border-y-2 border-primary/50">
            <p className="text-sm text-slate-400">Finish Time</p>
            <p className="text-6xl font-bold tracking-tighter text-primary">{formatSecondsToHMS(hmsToSeconds(athlete.chipTime))}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8">
            <Stat label="Overall Rank" value={certificateData.overallRank} />
            <Stat label="Gender Rank" value={certificateData.genderRank} />
            <Stat label="Category Rank" value={certificateData.categoryRank} />
        </div>
        
        <div className="my-8">
             <h3 className="text-xl font-semibold text-center text-primary mb-4">Your Splits</h3>
             <div className="rounded-lg border border-slate-700 bg-slate-800/50">
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 hover:bg-slate-800">
                        <TableHead className="text-slate-300">Segment</TableHead>
                        <TableHead className="text-slate-300">Distance</TableHead>
                        <TableHead className="text-slate-300">Pace</TableHead>
                        <TableHead className="text-right text-slate-300">Time</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                        {legs.map(l => (
                            <TableRow key={l.k} className="border-slate-700/50 hover:bg-slate-800 text-sm">
                                <TableCell className="font-medium flex items-center gap-2">{l.k}</TableCell>
                                <TableCell className="text-slate-300">{l.d ? `${l.d.toFixed(2)} km` : '-'}</TableCell>
                                <TableCell className="text-slate-300">{getPace(hmsToSeconds(l.t), l.d, l.type)}</TableCell>
                                <TableCell className="text-right font-mono text-white">{formatSecondsToHMS(hmsToSeconds(l.t))}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                  </Table>
            </div>
        </div>

        <div className="relative mt-8 pt-8 border-t border-slate-700">
            <div className="flex justify-between items-end">
                <div className="text-left">
                    <Image src="/white signature.png" alt="Race Director Signature" width={150} height={38} className="object-contain" />
                </div>
                {qrCodeDataUrl && (
                    <div className="text-right">
                        <Image src={qrCodeDataUrl} alt="Verification QR Code" width={80} height={80} className="bg-white p-1 rounded-md" />
                        <p className="text-[10px] text-slate-400 mt-1">Scan to verify</p>
                    </div>
                )}
            </div>
        </div>
      </div>
      
      <Card className="mt-8">
        <CardHeader><CardTitle>Share Your Achievement</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-2">
           <Button onClick={downloadPdf} disabled={isDownloadingPdf} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                {isDownloadingPdf ? <Loader2 className="animate-spin mr-2"/> : <Download className="mr-2"/>} Print (PDF)
            </Button>
            <Button onClick={() => downloadImage(postRef, 'post')} disabled={isDownloadingPost} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                {isDownloadingPost ? <Loader2 className="animate-spin mr-2"/> : <Download className="mr-2"/>} Post (4:5)
            </Button>
            <Button onClick={() => downloadImage(storyRef, 'story')} disabled={isDownloadingStory} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    {isDownloadingStory ? <Loader2 className="animate-spin mr-2"/> : <Download className="mr-2"/>} Story (9:16)
            </Button>
            <Button onClick={() => downloadImage(squareRef, 'square')} disabled={isDownloadingSquare} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    {isDownloadingSquare ? <Loader2 className="animate-spin mr-2"/> : <Download className="mr-2"/>} Square (1:1)
            </Button>
        </CardContent>
      </Card>


      <div className="fixed -z-10 -left-[9999px] top-0">
          <div ref={postRef} style={{ display: 'inline-block' }}><CertificatePost data={certificateData} /></div>
          <div ref={storyRef} style={{ display: 'inline-block' }}><CertificateStory data={certificateData} /></div>
          <div ref={squareRef} style={{ display: 'inline-block' }}><CertificateSquare data={certificateData} /></div>
          <div ref={printRef} style={{ display: 'inline-block' }}><CertificatePrint data={certificateData} /></div>
      </div>
    </div>
  );
}
