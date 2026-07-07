// src/components/results/FinisherCertificate.tsx
/* eslint-disable @next/next/no-img-element */
import React, { useRef, useCallback, useState, useEffect, useMemo } from "react";
import Image from "next/image";
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { toJpeg, toPng } from "html-to-image";
import jsPDF from "jspdf";

import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Copy,
  Download,
  Facebook,
  Instagram,
  Loader2,
  MessageCircle,
  Twitter,
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

async function fetchImageAsDataUrl(url: string, proxy = false): Promise<string> {
  const finalUrl = proxy
    ? `/api/proxy-image?url=${encodeURIComponent(url)}`
    : url;

  const response = await fetch(finalUrl);
  if (!response.ok) {
    throw new Error(`Failed to load image: ${url}`);
  }

  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read image: ${url}`));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [meta, base64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || 'image/png';
  const binary = atob(base64 || '');
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], fileName, { type: mime });
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
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [flagDataUrl, setFlagDataUrl] = useState<string | null>(null);

  const raceDate = athlete.raceDate
    ? format(parseISO(athlete.raceDate), "MMMM dd, yyyy")
    : "Race Day";

  const countryCode = getCountryCode(athlete.countryAtRace);
  const flagSrc = countryCode ? `https://flagcdn.com/h40/${countryCode.toLowerCase()}.png` : null;

  const status = normalizeStatus(athlete.status);
  const isFinished = status === 'Finished';

  const verificationUrl = useMemo(() => {
    if (typeof window === 'undefined' || !eventSlug || !athlete.bibNumber) return '';
    return `${window.location.origin}/certificate/${encodeURIComponent(eventSlug)}/${encodeURIComponent(athlete.bibNumber)}`;
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

  useEffect(() => {
    const isFemale = athlete.gender?.toLowerCase() === 'female';
    const targetLogoUrl = isFemale ? '/Bwwhitelogo.png' : '/Bmlogowhite.png';

    fetchImageAsDataUrl(targetLogoUrl)
      .then(setLogoDataUrl)
      .catch((e) => {
        console.error('Certificate logo fetch error:', e);
        setLogoDataUrl(targetLogoUrl);
      });

    fetchImageAsDataUrl('/white signature.png')
      .then(setSignatureDataUrl)
      .catch((e) => {
        console.error('Certificate signature fetch error:', e);
        setSignatureDataUrl('/white signature.png');
      });
  }, [athlete.gender]);

  useEffect(() => {
    if (!flagSrc) {
      setFlagDataUrl(null);
      return;
    }

    fetchImageAsDataUrl(flagSrc, true)
      .then(setFlagDataUrl)
      .catch((e) => {
        console.error('Certificate flag fetch error:', e);
        setFlagDataUrl(flagSrc);
      });
  }, [flagSrc]);

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
      gender: athlete.gender || null,
      logoUrl: logoDataUrl || logoUrl,
      signatureUrl: signatureDataUrl || '/white signature.png',
      qrCodeUrl: qrCodeDataUrl,
      splits: legs.map(l => ({
          label: l.k,
          distance: l.d ? `${l.d.toFixed(2)} km` : '-',
          pace: getPace(hmsToSeconds(l.t), l.d, l.type),
          time: formatSecondsToHMS(hmsToSeconds(l.t)),
      })),
      flagSrc: flagDataUrl || flagSrc,
    };
  }, [athlete, eventName, raceDate, qrCodeDataUrl, legs, flagSrc, logoDataUrl, signatureDataUrl, flagDataUrl]);

  const areExportAssetsReady = useMemo(() => {
    const logoReady = !!certificateData.logoUrl;
    const signatureReady = !!certificateData.signatureUrl;
    const flagReady = !flagSrc || !!certificateData.flagSrc;
    return logoReady && signatureReady && flagReady;
  }, [certificateData.logoUrl, certificateData.signatureUrl, certificateData.flagSrc, flagSrc]);

  const downloadImage = useCallback(async (ref: React.RefObject<HTMLDivElement>, format: 'post' | 'story' | 'square') => {
    if (!ref.current) return;
    if (!areExportAssetsReady) {
      toast({ variant: "destructive", title: "Export not ready", description: "Certificate assets are still loading. Please try again in a moment." });
      return;
    }
    
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
  }, [athlete.name, toast, areExportAssetsReady]);

  const copyCertificateLink = useCallback(async () => {
    if (!verificationUrl) {
      toast({ variant: "destructive", title: "Link unavailable", description: "Certificate link is not ready yet." });
      return;
    }

    try {
      await navigator.clipboard.writeText(verificationUrl);
      toast({ title: "Link copied", description: "Certificate link copied to clipboard." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Copy failed", description: e?.message || "Could not copy certificate link." });
    }
  }, [verificationUrl, toast]);

  const buildShareImageFile = useCallback(async (format: 'post' | 'story') => {
    const sourceRef = format === 'story' ? storyRef.current : postRef.current;
    if (!sourceRef) {
      throw new Error('Certificate image is not ready yet.');
    }
    if (!areExportAssetsReady) {
      throw new Error('Certificate assets are still loading.');
    }

    const dataUrl = await toPng(sourceRef, { cacheBust: true, pixelRatio: 2 });
    return dataUrlToFile(dataUrl, `Bergman_${cleanText(athlete.name)}_${format}_certificate.png`);
  }, [athlete.name, areExportAssetsReady]);

  const shareCertificate = useCallback(async (platform: 'facebook' | 'whatsapp' | 'instagram-story' | 'instagram-post' | 'x') => {
    if (!verificationUrl) {
      toast({ variant: "destructive", title: "Link unavailable", description: "Certificate link is not ready yet." });
      return;
    }

    const shareText = `${cleanText(athlete.name)}'s Bergman finisher certificate`;
    const encodedUrl = encodeURIComponent(verificationUrl);
    const encodedText = encodeURIComponent(`${shareText} - ${verificationUrl}`);

    try {
      if (platform === 'whatsapp') {
        try {
          const imageFile = await buildShareImageFile('post');
          if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [imageFile] }))) {
            await navigator.share({
              title: shareText,
              text: `${shareText}\n${verificationUrl}`,
              url: verificationUrl,
              files: [imageFile],
            });
            return;
          }
        } catch (shareFileError) {
          console.warn('WhatsApp file share fallback:', shareFileError);
        }
      }

      if (platform === 'instagram-story' || platform === 'instagram-post') {
        const format = platform === 'instagram-story' ? 'story' : 'post';
        try {
          const imageFile = await buildShareImageFile(format);
          if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [imageFile] }))) {
            await navigator.share({
              title: shareText,
              text: `${shareText}\n${verificationUrl}`,
              url: verificationUrl,
              files: [imageFile],
            });
            return;
          }
        } catch (shareFileError) {
          console.warn('Instagram file share fallback:', shareFileError);
        }

        await navigator.clipboard.writeText(verificationUrl);
        window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        toast({ title: 'Link copied', description: `Certificate link copied. Use the ${format} image after Instagram opens.` });
        return;
      }

      const shareUrls = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
        whatsapp: `https://wa.me/?text=${encodedText}`,
        x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodedUrl}`,
      } as const;

      window.open(shareUrls[platform], '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Share failed', description: e?.message || 'Could not open share link.' });
    }
  }, [verificationUrl, athlete.name, toast, buildShareImageFile]);

 const downloadPdf = useCallback(async () => {
    if (!printRef.current) {
      toast({ title: "Error", description: "Certificate template not ready.", variant: "destructive" });
      return;
    }
    if (!areExportAssetsReady) {
      toast({ variant: "destructive", title: "PDF Export not ready", description: "Certificate assets are still loading. Please try again in a moment." });
      return;
    }
    setIsDownloadingPdf(true);
    try {
      const dataUrl = await toJpeg(printRef.current, { cacheBust: true, pixelRatio: 1.35, quality: 0.84 });
      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'MEDIUM');
      pdf.save(`Finisher_Certificate_${cleanText(athlete.name)}.pdf`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "PDF Export failed", description: e.message });
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [athlete.name, toast, areExportAssetsReady]);

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
              className="h-auto w-auto object-contain mx-auto"
              style={{ width: 'auto', height: 'auto' }}
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
           <div className="overflow-hidden rounded-xl border border-slate-600 bg-slate-900/80 shadow-inner shadow-slate-950/40">
                  <Table>
              <TableHeader><TableRow className="border-b border-slate-600 bg-slate-800/90 hover:bg-slate-800/90">
                <TableHead className="py-4 text-sm font-semibold uppercase tracking-wide text-slate-200">Segment</TableHead>
                <TableHead className="py-4 text-sm font-semibold uppercase tracking-wide text-slate-200">Distance</TableHead>
                <TableHead className="py-4 text-sm font-semibold uppercase tracking-wide text-slate-200">Pace</TableHead>
                <TableHead className="py-4 text-right text-sm font-semibold uppercase tracking-wide text-slate-200">Time</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                        {legs.map(l => (
                  <TableRow key={l.k} className="border-b border-slate-700/70 text-base hover:bg-slate-800/70">
                    <TableCell className="py-4 font-semibold text-white">{l.k}</TableCell>
                    <TableCell className="py-4 text-slate-200">{l.d ? `${l.d.toFixed(2)} km` : '-'}</TableCell>
                    <TableCell className="py-4 text-slate-200">{getPace(hmsToSeconds(l.t), l.d, l.type)}</TableCell>
                    <TableCell className="py-4 text-right font-mono text-lg font-semibold text-white">{formatSecondsToHMS(hmsToSeconds(l.t))}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                  </Table>
            </div>
        </div>

        <div className="relative mt-8 pt-8 border-t border-slate-700">
            <div className="flex justify-between items-end">
                <div className="text-left">
              <Image src="/white signature.png" alt="Race Director Signature" width={280} height={84} className="h-auto w-36 sm:w-52 md:w-[280px] object-contain" />
                </div>
                {qrCodeDataUrl && (
              <div className="flex items-center gap-3">
                <Image src={qrCodeDataUrl} alt="Verification QR Code" width={80} height={80} className="bg-white p-1 rounded-md" />
                <p className="text-xs text-slate-400 text-center leading-tight">Scan to verify</p>
                    </div>
                )}
            </div>
        </div>
      </div>
      
      <Card className="mt-8">
        <CardHeader><CardTitle>Share Your Achievement</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
             <Button onClick={copyCertificateLink} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                <Copy className="mr-2 h-4 w-4" /> Copy Link
            </Button>
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
          </div>

          <div className="border-t pt-4">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Share certificate link</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Button onClick={() => shareCertificate('facebook')} className="w-full bg-[#1877F2] hover:bg-[#166FE5] text-white">
                <Facebook className="mr-2 h-4 w-4" /> Facebook
              </Button>
              <Button onClick={() => shareCertificate('whatsapp')} className="w-full bg-[#25D366] hover:bg-[#1EBE5B] text-white">
                <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
              </Button>
              <Button onClick={() => shareCertificate('instagram-story')} className="w-full bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] hover:opacity-90 text-white">
                <Instagram className="mr-2 h-4 w-4" /> Insta Story
              </Button>
              <Button onClick={() => shareCertificate('instagram-post')} className="w-full bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] hover:opacity-90 text-white">
                <Instagram className="mr-2 h-4 w-4" /> Insta Post
              </Button>
              <Button onClick={() => shareCertificate('x')} className="w-full bg-black hover:bg-zinc-800 text-white">
                <Twitter className="mr-2 h-4 w-4" /> X
              </Button>
            </div>
          </div>
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
