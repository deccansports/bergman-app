// src/components/layout/RaceCardGeneratorSection.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventCalendarEntry } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getFinishedRacesForAthleteAction } from '@/lib/actions/userActions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import CheerCardGeneratorTab from './CheerCardGeneratorTab';
import { Bebas_Neue } from 'next/font/google';
import { ChevronDown, Download, ImageUp, RefreshCcw, Share2, Sparkles } from 'lucide-react';

type TemplateType = 'racing' | 'finisher';
type CardFormat = 'square' | 'story';
type GeneratorEventOption = {
  id: string;
  name: string;
  date?: string | null;
  categories: string[];
  ticketSubCategories?: Record<string, string[]>; // ticket name → sub-category names
  ticketDates?: Record<string, string | null | undefined>;
};
const BERGMAN_LOGO_URL = '/brand/bm-logo.png';
const bebasNeue = Bebas_Neue({ subsets: ['latin'], weight: '400', preload: false });

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number
) {
  let size = baseSize;
  ctx.font = `400 ${size}px 'Bebas Neue', Arial`;

  while (ctx.measureText(text).width > maxWidth && size > 20) {
    size -= 2;
    ctx.font = `400 ${size}px 'Bebas Neue', Arial`;
  }

  return size;
}

function getContrastColor(_hasImage: boolean) {
  return '#ffffff';
}

function getEventCategories(event?: EventCalendarEntry | null): string[] {
  if (!event) return ['Open'];

  const fromTickets = (event.ticketDefinitions || [])
    .map((t) => (t.ticketName || '').trim())
    .filter(Boolean);

  const fromSchedule = (event.disciplineSchedule || []).flatMap((d) => d.disciplines || []).map((d) => (d || '').trim()).filter(Boolean);

  const unique = Array.from(new Set([...fromTickets, ...fromSchedule]));
  return unique.length ? unique : ['Open'];
}

function getTicketSubCategories(event?: EventCalendarEntry | null): Record<string, string[]> {
  if (!event?.ticketDefinitions) return {};
  const result: Record<string, string[]> = {};
  for (const ticket of event.ticketDefinitions) {
    if (ticket.subCategories?.length) {
      result[ticket.ticketName] = ticket.subCategories
        .map((s) => s.name)
        .filter(Boolean);
    }
  }
  return result;
}

function getTicketDates(event?: EventCalendarEntry | null): Record<string, string | null | undefined> {
  if (!event?.ticketDefinitions) return {};
  const result: Record<string, string | null | undefined> = {};
  for (const ticket of event.ticketDefinitions) {
    const ticketName = (ticket.ticketName || '').trim();
    if (!ticketName) continue;
    result[ticketName] = ticket.eventDate || event.eventDate || null;
  }
  return result;
}

function formatEventDateLabel(rawDate?: string | null): string {
  const value = (rawDate || '').trim();
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  zoom: number,
  offsetX: number,
  offsetY: number
) {
  const baseScale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const scale = baseScale * zoom;
  const x = canvas.width / 2 - (image.width * scale) / 2 + offsetX;
  const y = canvas.height / 2 - (image.height * scale) / 2 + offsetY;
  ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
}

export default function RaceCardGeneratorSection({ events, defaultExpanded = false }: { events: EventCalendarEntry[]; defaultExpanded?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<'image' | 'text'>('image');
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const eventsWithDate = useMemo(
    () =>
      (events || []).filter((event) => {
        const date = (event.eventDate || '').trim();
        return !!date && date.toUpperCase() !== 'TBD';
      }),
    [events]
  );

  const [selectedEventId, setSelectedEventId] = useState<string>(eventsWithDate[0]?.id || '');
  const [selectedCategory, setSelectedCategory] = useState<string>('Open');
  const [template, setTemplate] = useState<TemplateType>('racing'); // default template rule
  const [format, setFormat] = useState<CardFormat>('square');
  const [athleteName, setAthleteName] = useState('');
  const [uploadedImage, setUploadedImage] = useState<HTMLImageElement | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffsetX, setImageOffsetX] = useState(0);
  const [imageOffsetY, setImageOffsetY] = useState(0);
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [eventTextOffsetX, setEventTextOffsetX] = useState(0);
  const [eventTextOffsetY, setEventTextOffsetY] = useState(0);
  const [fontColor, setFontColor] = useState('#ffffff');
  const [racingTitleColor, setRacingTitleColor] = useState('#ffffff');
  const [eventStrokeColor, setEventStrokeColor] = useState('#ffffff');
  const [eventFillTransparent, setEventFillTransparent] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);
  const [textBandOpacity, setTextBandOpacity] = useState(0.34);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('');
  const [finishedEventOptions, setFinishedEventOptions] = useState<GeneratorEventOption[]>([]);
  const [isLoadingFinishedEvents, setIsLoadingFinishedEvents] = useState(false);

  const upcomingEventOptions = useMemo<GeneratorEventOption[]>(
    () =>
      eventsWithDate.map((event) => ({
        id: event.id,
        name: event.eventName,
        date: event.eventDate,
        categories: getEventCategories(event),
        ticketSubCategories: getTicketSubCategories(event),
        ticketDates: getTicketDates(event),
      })),
    [eventsWithDate]
  );

  const canUseFinisher = !!currentUser?.uid && finishedEventOptions.length > 0;
  const eventOptions = useMemo<GeneratorEventOption[]>(
    () => (template === 'finisher' && canUseFinisher ? finishedEventOptions : upcomingEventOptions),
    [template, canUseFinisher, finishedEventOptions, upcomingEventOptions]
  );

  const selectedEvent = useMemo(
    () => eventOptions.find((e) => e.id === selectedEventId) || eventOptions[0] || null,
    [eventOptions, selectedEventId]
  );

  useEffect(() => {
    if (!eventOptions.length) {
      setSelectedEventId('');
      return;
    }
    const exists = eventOptions.some((e) => e.id === selectedEventId);
    if (!exists) {
      setSelectedEventId(eventOptions[0].id);
    }
  }, [eventOptions, selectedEventId]);

  useEffect(() => {
    let active = true;
    const loadFinishedEvents = async () => {
      if (!currentUser?.uid) {
        if (active) setFinishedEventOptions([]);
        return;
      }

      setIsLoadingFinishedEvents(true);
      try {
        const res = await getFinishedRacesForAthleteAction(currentUser.uid, currentUser.email || null);
        if (!active) return;
        if (res.success && Array.isArray(res.events)) {
          setFinishedEventOptions(
            res.events.map((e) => ({
              id: e.id,
              name: e.name,
              date: e.date || null,
              categories: e.categories?.length ? e.categories : ['Finished'],
            }))
          );
        } else {
          setFinishedEventOptions([]);
        }
      } catch {
        if (active) setFinishedEventOptions([]);
      } finally {
        if (active) setIsLoadingFinishedEvents(false);
      }
    };

    loadFinishedEvents();
    return () => {
      active = false;
    };
  }, [currentUser?.uid, currentUser?.email]);

  useEffect(() => {
    if (template === 'finisher' && !canUseFinisher) {
      setTemplate('racing');
    }
  }, [template, canUseFinisher]);

  const categories = useMemo(() => selectedEvent?.categories || ['Open'], [selectedEvent]);

  useEffect(() => {
    if (!selectedCategory || !categories.includes(selectedCategory)) {
      setSelectedCategory(categories[0] || 'Open');
    }
  }, [categories, selectedCategory]);

  const subCategories = useMemo<string[]>(
    () => (selectedEvent?.ticketSubCategories?.[selectedCategory] ?? []),
    [selectedEvent, selectedCategory]
  );

  useEffect(() => {
    setSelectedSubCategory('');
  }, [selectedCategory, selectedEventId]);

  useEffect(() => {
    if (!athleteName && currentUser?.name) {
      setAthleteName(currentUser.name);
    }
  }, [athleteName, currentUser?.name]);

  useEffect(() => {
    const logo = new Image();
    logo.onload = () => setLogoImage(logo);
    logo.onerror = () => setLogoImage(null);
    logo.src = BERGMAN_LOGO_URL;
  }, []);

  const handlePreviewPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Track all active pointers
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    // 2-finger pinch: capture start distance and current zoom
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartZoomRef.current = imageZoom;
      // Cancel any ongoing single-finger drag
      isDraggingRef.current = false;
      setIsDraggingImage(false);
      setIsDraggingText(false);
      lastPointerPositionRef.current = null;
      return;
    }

    // Single-finger: drag text or image
    const rect = e.currentTarget.getBoundingClientRect();
    const canvas = canvasRef.current;
    const scale = rect.width > 0 && canvas ? canvas.width / rect.width : 1;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;

    const H = canvas?.height || (format === 'story' ? 1920 : 1080);
    const eventBaseY = H - (format === 'story' ? 360 : 300) + eventTextOffsetY;
    const categoryBaseY = eventBaseY + 62;
    const clubBaseY = categoryBaseY + 54;
    const athleteBaseY = Math.max(format === 'story' ? 700 : 520, Math.min(H - 260, eventBaseY - 120));

    const inTextX = px >= 120 && px <= 960;
    const inTextY = py >= athleteBaseY - 90 && py <= clubBaseY + 36;
    dragTargetRef.current = inTextX && inTextY ? 'text' : 'image';

    if (dragTargetRef.current === 'image' && !uploadedImage) return;

    isDraggingRef.current = true;
    setIsDraggingImage(dragTargetRef.current === 'image');
    setIsDraggingText(dragTargetRef.current === 'text');
    lastPointerPositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePreviewPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Update stored position for this pointer
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 2-finger pinch zoom
    if (activePointersRef.current.size === 2 && pinchStartDistRef.current !== null) {
      if (!uploadedImage) return;
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const ratio = dist / pinchStartDistRef.current;
      const newZoom = Math.min(3, Math.max(1, pinchStartZoomRef.current * ratio));
      setImageZoom(Number(newZoom.toFixed(2)));
      return;
    }

    // Single-finger drag
    if (!isDraggingRef.current || !lastPointerPositionRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const canvas = canvasRef.current;
    const scale = rect.width > 0 && canvas ? canvas.width / rect.width : 1;
    const dx = (e.clientX - lastPointerPositionRef.current.x) * scale;
    const dy = (e.clientY - lastPointerPositionRef.current.y) * scale;
    lastPointerPositionRef.current = { x: e.clientX, y: e.clientY };

    if (dragTargetRef.current === 'text') {
      setEventTextOffsetX((prev) => prev + Math.round(dx));
      setEventTextOffsetY((prev) => prev + Math.round(dy));
      return;
    }

    if (!uploadedImage) return;
    setImageOffsetX((prev) => prev + Math.round(dx));
    setImageOffsetY((prev) => prev + Math.round(dy));
  };

  const handlePreviewPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
    }
    isDraggingRef.current = false;
    setIsDraggingImage(false);
    setIsDraggingText(false);
    lastPointerPositionRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePreviewWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!uploadedImage) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setImageZoom((prev) => Math.min(3, Math.max(1, Number((prev + delta).toFixed(2)))));
  };

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = 1080;
    const H = format === 'story' ? 1920 : 1080;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const centerX = W / 2;

    const eventLabel = (selectedEvent?.name || 'Bergman Race').toUpperCase();
    const categoryLabel = selectedSubCategory
      ? `${(selectedCategory || 'Open').toUpperCase()} › ${selectedSubCategory.toUpperCase()}`
      : (selectedCategory || 'Open').toUpperCase();
    const rawEventDate = selectedEvent?.ticketDates?.[selectedCategory] || selectedEvent?.date || null;
    const eventDateLabel = formatEventDateLabel(rawEventDate);
    const categoryWithDateLabel = eventDateLabel ? `${categoryLabel} | ${eventDateLabel}` : categoryLabel;
    const athleteLabel = (athleteName || currentUser?.name || 'ATHLETE').toUpperCase();
    const clubSource = currentUser?.clubName || currentUser?.ownedClubName || '';
    const clubLabel = clubSource ? `REPRESENTING ${clubSource.toUpperCase()}` : '';
    const resolvedFontColor = fontColor || getContrastColor(!!uploadedImage);

    ctx.clearRect(0, 0, W, H);

    if (uploadedImage) {
      drawCoverImage(ctx, canvas, uploadedImage, imageZoom, imageOffsetX, imageOffsetY);
    } else {
      const baseGrad = ctx.createLinearGradient(0, 0, W, H);
      baseGrad.addColorStop(0, '#111827');
      baseGrad.addColorStop(1, '#020617');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, W, H);
    }

    if (template === 'racing') {
      const overlay = ctx.createLinearGradient(0, 0, W, H);
      const midOpacity = Math.max(0, Math.min(1, overlayOpacity - 0.1));
      overlay.addColorStop(0, `rgba(59,130,246,${overlayOpacity})`);
      overlay.addColorStop(0.5, `rgba(99,102,241,${midOpacity})`);
      overlay.addColorStop(1, `rgba(168,85,247,${overlayOpacity})`);
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = racingTitleColor;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,255,255,0.4)';
      ctx.shadowBlur = 20;
      ctx.font = "400 110px 'Bebas Neue', Arial";
      ctx.fillText("I\'M RACING", centerX, format === 'story' ? 160 : 128);
      ctx.shadowBlur = 0;
    } else {
      const overlay = ctx.createLinearGradient(0, 0, W, H);
      const darkStart = Math.max(0, Math.min(1, overlayOpacity));
      const darkEnd = Math.max(0, Math.min(1, overlayOpacity + 0.1));
      overlay.addColorStop(0, `rgba(10, 10, 10, ${darkStart})`);
      overlay.addColorStop(1, `rgba(0, 0, 0, ${darkEnd})`);
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 12;
      ctx.strokeRect(28, 28, W - 56, H - 56);

      ctx.fillStyle = racingTitleColor;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,255,255,0.4)';
      ctx.shadowBlur = 20;
      ctx.font = "400 94px 'Bebas Neue', Arial";
      ctx.fillText('OFFICIAL FINISHER', centerX, format === 'story' ? 165 : 132);
      ctx.shadowBlur = 0;
      ctx.font = "400 52px 'Bebas Neue', Arial";
      ctx.fillStyle = 'rgba(255,255,255,0.80)';
      ctx.fillText('I AM BERGMAN', centerX, format === 'story' ? 230 : 194);
    }

    // Event/category text block defaults at bottom (end), user can shift via controls
    const eventBaseX = centerX + eventTextOffsetX;
    const eventBaseY = H - (format === 'story' ? 360 : 300) + eventTextOffsetY;
    const categoryBaseY = eventBaseY + 62;
    const clubBaseY = categoryBaseY + 54;

    ctx.fillStyle = `rgba(0,0,0,${textBandOpacity})`;
    ctx.fillRect(0, eventBaseY - 96, W, 240);

    ctx.textAlign = 'center';

    // Keep athlete name above event/category block to avoid overlap.
    const athleteBaseY = Math.max(format === 'story' ? 700 : 520, Math.min(H - 320, eventBaseY - 130));

    const eventSize = fitText(ctx, eventLabel, 900, 68);
    ctx.font = `400 ${eventSize}px 'Bebas Neue', Arial`;
    if (eventFillTransparent) {
      ctx.strokeStyle = eventStrokeColor;
      ctx.lineWidth = 4;
      ctx.strokeText(eventLabel, eventBaseX, eventBaseY);
    } else {
      ctx.fillStyle = resolvedFontColor;
      ctx.fillText(eventLabel, eventBaseX, eventBaseY);
    }

    const categorySize = fitText(ctx, categoryWithDateLabel, 900, 44);
    ctx.font = `400 ${categorySize}px 'Bebas Neue', Arial`;
    if (eventFillTransparent) {
      ctx.strokeStyle = eventStrokeColor;
      ctx.lineWidth = 3;
      ctx.strokeText(categoryWithDateLabel, eventBaseX, categoryBaseY);
    } else {
      ctx.fillStyle = resolvedFontColor;
      ctx.fillText(categoryWithDateLabel, eventBaseX, categoryBaseY);
    }

    const nameSize = fitText(ctx, athleteLabel, 900, 72);
    ctx.font = `400 ${nameSize}px 'Bebas Neue', Arial`;
    ctx.fillStyle = resolvedFontColor;
    ctx.fillText(athleteLabel, centerX, athleteBaseY);

    if (clubLabel) {
      const clubSize = fitText(ctx, clubLabel, 900, 40);
      ctx.font = `400 ${clubSize}px 'Bebas Neue', Arial`;
      ctx.fillStyle = resolvedFontColor;
      ctx.fillText(clubLabel, eventBaseX, clubBaseY);
    }

    if (logoImage) {
      const targetWidth = format === 'story' ? 420 : 340;
      const targetHeight = (logoImage.height / logoImage.width) * targetWidth;
      const logoX = centerX - targetWidth / 2;
      const logoY = H - targetHeight - 18;
      ctx.drawImage(logoImage, logoX, logoY, targetWidth, targetHeight);
    }

  }, [
    athleteName,
    currentUser?.name,
    currentUser?.clubName,
    currentUser?.ownedClubName,
    format,
    imageOffsetX,
    imageOffsetY,
    imageZoom,
    eventTextOffsetX,
    eventTextOffsetY,
    eventFillTransparent,
    eventStrokeColor,
    fontColor,
    racingTitleColor,
    overlayOpacity,
    textBandOpacity,
    logoImage,
    selectedCategory,
    selectedSubCategory,
    selectedEvent?.date,
    selectedEvent?.name,
    selectedEvent?.ticketDates,
    template,
    uploadedImage,
  ]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  const onUploadImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      setUploadedImage(img);
      setImageZoom(1);
      setImageOffsetX(0);
      setImageOffsetY(0);
      URL.revokeObjectURL(objectUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      toast({ variant: 'destructive', title: 'Image Error', description: 'Unable to load selected image.' });
    };

    img.src = objectUrl;
  };

  const downloadCard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!uploadedImage) {
      toast({ title: 'Upload image first' });
      return;
    }

    try {
      const link = document.createElement('a');
      link.download = `bergman-${template}-card.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch {
      toast({ variant: 'destructive', title: 'Download failed', description: 'Please regenerate card and try again.' });
    }
  };

  const shareCard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!navigator.share) {
      toast({ title: 'Share not supported', description: 'Download the card and share it manually.' });
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    const file = new File([blob], `bergman-${template}-card.png`, { type: 'image/png' });
    const data: ShareData = {
      title: 'Bergman Race Card',
      text: 'My Bergman race card is ready!',
      files: [file],
    };

    try {
      if ((navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare?.(data)) {
        await navigator.share(data);
      } else {
        await navigator.share({ title: data.title, text: data.text });
      }
    } catch {
      // User cancelled share; no toast required.
    }
  };

  return (
    <section className="container mx-auto px-4 py-12 md:py-16">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className="rounded-2xl border-2 border-white bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white shadow-2xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/5 px-3 py-1 text-xs font-black uppercase tracking-widest text-white">
            <Sparkles className="h-3.5 w-3.5" />
            Race Card Generator
          </div>
          <CardTitle className={`text-3xl uppercase tracking-tight md:text-5xl ${bebasNeue.className}`}>Bergman Race Card Generator</CardTitle>
          <CardDescription className="text-slate-300">Create and share your Racing or Finisher card instantly.</CardDescription>
          <div className="flex justify-center pt-1">
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="border-white/60 bg-transparent text-white hover:bg-white/10 uppercase tracking-widest font-black">
                {isExpanded ? 'Collapse' : 'Expand'}
                <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
        <Tabs defaultValue="race" className="w-full">
          <div className="px-6 pt-1">
            <TabsList className="grid w-full grid-cols-2 border border-white/30 bg-slate-900/70">
              <TabsTrigger value="race" className="font-black uppercase tracking-widest">Race Card</TabsTrigger>
              <TabsTrigger value="cheer" className="font-black uppercase tracking-widest">Cheer Card</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="race">
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 md:p-5">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Event</Label>
              <Select value={selectedEvent?.id || ''} onValueChange={setSelectedEventId}>
                <SelectTrigger className="h-11 border-white/60 bg-slate-900/70 font-bold text-white">
                  <SelectValue placeholder="Select event" />
                </SelectTrigger>
                <SelectContent>
                  {eventOptions.length > 0 ? (
                    eventOptions.map((eventItem) => (
                      <SelectItem key={eventItem.id} value={eventItem.id}>
                        {eventItem.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__no-events__" disabled>
                      {template === 'finisher' ? (isLoadingFinishedEvents ? 'Loading finished races...' : 'No finished races available') : 'No dated events available'}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Category</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="h-11 border-white/60 bg-slate-900/70 font-bold text-white">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {subCategories.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Sub Category</Label>
                <Select value={selectedSubCategory || '__none__'} onValueChange={(v) => setSelectedSubCategory(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-11 border-white/60 bg-slate-900/70 font-bold text-white">
                    <SelectValue placeholder="Select sub category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {subCategories.map((sc) => (
                      <SelectItem key={sc} value={sc}>{sc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Template</Label>
              <Select value={template} onValueChange={(value: TemplateType) => setTemplate(value)}>
                <SelectTrigger className="h-11 border-white/60 bg-slate-900/70 font-bold text-white">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="racing">Racing</SelectItem>
                  {canUseFinisher && <SelectItem value="finisher">Finisher</SelectItem>}
                </SelectContent>
              </Select>
              {!canUseFinisher && (
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Finisher template unlocks for logged-in athletes with finished races.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Format</Label>
              <Select value={format} onValueChange={(v: CardFormat) => setFormat(v)}>
                <SelectTrigger className="h-11 border-white/60 bg-slate-900/70 font-bold text-white">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">Instagram Post</SelectItem>
                  <SelectItem value="story">Instagram Story</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Athlete Name</Label>
              <Input
                value={athleteName}
                onChange={(e) => setAthleteName(e.target.value)}
                placeholder="Auto-filled if logged in"
                className="h-11 border-white/60 bg-slate-900/70 font-bold text-white placeholder:text-slate-400"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Upload Image</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={onUploadImage}
                className="h-11 border-white/60 bg-slate-900/70 text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1 file:text-xs file:font-black file:text-slate-900"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-white/40 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Text Style</Label>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setImageZoom(1);
                    setImageOffsetX(0);
                    setImageOffsetY(0);
                    setEventTextOffsetX(0);
                    setEventTextOffsetY(0);
                  }}
                  className="h-7 px-2 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/10"
                >
                  Reset Positions
                </Button>
              </div>

              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Mouse/Touch: drag on text area = move event + athlete name • drag elsewhere = move image • wheel = zoom image.
              </p>

              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Default event text starts at card end (bottom).
              </p>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="event-fill-transparent"
                  checked={eventFillTransparent}
                  onCheckedChange={(v) => setEventFillTransparent(v === true)}
                />
                <Label htmlFor="event-fill-transparent" className="text-[10px] uppercase tracking-widest text-slate-300">
                  Transparent event fill + outlined text
                </Label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-slate-400">
                    {template === 'finisher' ? 'Finisher Title Color' : "I\u2019M Racing Color"}
                  </Label>
                  <Input
                    type="color"
                    value={racingTitleColor}
                    onChange={(e) => setRacingTitleColor(e.target.value)}
                    className="h-9 w-full border-white/40 bg-slate-900 p-1"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-slate-400">Font Color</Label>
                  <Input
                    type="color"
                    value={fontColor}
                    onChange={(e) => setFontColor(e.target.value)}
                    className="h-9 w-full border-white/40 bg-slate-900 p-1"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-slate-400">Outline Color</Label>
                  <Input
                    type="color"
                    value={eventStrokeColor}
                    onChange={(e) => setEventStrokeColor(e.target.value)}
                    className="h-9 w-full border-white/40 bg-slate-900 p-1"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-slate-400">
                  Overlay Transparency: {overlayOpacity.toFixed(2)}
                </Label>
                <Input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.01}
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="h-8 border-0 bg-transparent px-0"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-slate-400">
                  Text Band Transparency: {textBandOpacity.toFixed(2)}
                </Label>
                <Input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.01}
                  value={textBandOpacity}
                  onChange={(e) => setTextBandOpacity(Number(e.target.value))}
                  className="h-8 border-0 bg-transparent px-0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button onClick={drawPreview} className="h-11 rounded-xl border border-white bg-white text-slate-900 font-black uppercase tracking-widest hover:bg-slate-200">
                <RefreshCcw className="mr-2 h-4 w-4" />
                Generate
              </Button>
              <Button onClick={downloadCard} variant="secondary" className="h-11 rounded-xl border border-white bg-slate-200 font-black uppercase tracking-widest text-slate-900 hover:bg-slate-300">
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
              <Button onClick={shareCard} variant="outline" className="h-11 rounded-xl border-white bg-transparent font-black uppercase tracking-widest text-white hover:bg-white/10">
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-white bg-black/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-300">
              <ImageUp className="h-4 w-4 text-white" />
              Preview Area
            </div>
            <div className="overflow-hidden rounded-2xl border border-white bg-slate-950/80">
              <canvas
                ref={canvasRef}
                width={1080}
                height={1080}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                onPointerCancel={handlePreviewPointerUp}
                onWheel={handlePreviewWheel}
                className={`h-auto w-full touch-none ${isDraggingText || isDraggingImage ? 'cursor-grabbing' : uploadedImage ? 'cursor-grab' : 'cursor-default'}`}
                aria-label="Race card preview"
              />
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">
              🖥️ <span className="font-semibold text-slate-300">Best on desktop</span> for full quality output &nbsp;·&nbsp; 📱 Mobile: drag to reposition · pinch to zoom
            </p>
          </div>
        </CardContent>
          </TabsContent>

          <TabsContent value="cheer">
            <CardContent>
              <CheerCardGeneratorTab />
            </CardContent>
          </TabsContent>
        </Tabs>
        </CollapsibleContent>
      </Card>
      </Collapsible>
    </section>
  );
}
