"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Image from 'next/image';
import { Bebas_Neue, Poppins } from 'next/font/google';
import { parseISO, isValid as isDateValid } from 'date-fns';
import { Award, Download, Edit, ExternalLink, Eye, FileSpreadsheet, ImageIcon, Loader2, PlusCircle, RefreshCw, Search, Send, Settings2, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import type { EventCalendarEntry, Influencer, InfluencerFormResponseRow, InfluencerPostTemplateConfig } from '@/lib/types';
import {
  addInfluencerAction,
  deleteInfluencerAction,
  getInfluencersAction,
  getInfluencerPostEmailLogsAction,
  getInfluencerPublicCouponLogsAction,
  getInfluencerFormConfigAction,
  getInfluencerPostTemplateConfigAction,
  importInfluencerFormResponsesAction,
  previewInfluencerFormResponsesAction,
  refundInfluencerDiscountPaymentAction,
  saveInfluencerFormConfigAction,
  saveInfluencerPostTemplateConfigAction,
  sendInfluencerCustomCampaignAction,
  generateInfluencerDiscountCouponsAction,
  sendInfluencerPostCardsAction,
  extendInfluencerRegistrationWindowAction,
  updateInfluencerFormResponseReviewAction,
  updateInfluencerAction,
  updateInfluencerOrderAction,
} from '@/lib/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isValidImageUrl } from '@/lib/utils';

interface InfluencersTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

interface InfluencerImportConfigState {
  formUrl: string;
  sheetUrl: string;
  emailTemplateKey: string;
  whatsappTemplateKey: string;
  defaultWhatsappNumber: string;
  discountPercent: number;
}

interface InfluencerPostConfigState {
  influencerId: string;
  customPhotoUrl: string;
  nameOverride: string;
  squareFrameUrl: string;
  templateOnTop: boolean;
  squareWidth: number;
  squareHeight: number;
  squareImageScale: number;
  squareImageOffsetX: number;
  squareImageOffsetY: number;
  squareNameOffsetX: number;
  squareNameOffsetY: number;
  storyFrameUrl: string;
  storyWidth: number;
  storyHeight: number;
  storyImageScale: number;
  storyImageOffsetX: number;
  storyImageOffsetY: number;
  storyNameOffsetX: number;
  storyNameOffsetY: number;
  nameFontFamily: 'Inter' | 'Poppins' | 'Bebas Neue';
  nameFontSize: number;
  nameFontColor: string;
  nameLetterSpacing: number;
  nameShapeEnabled: boolean;
  nameShapeColor: string;
  nameShapeOpacity: number;
  nameShapePaddingX: number;
  nameShapePaddingY: number;
  nameShapeRadius: number;
  includeBrandingText: boolean;
}

interface InfluencerPostEmailLogItem {
  id: string;
  eventId: string;
  eventName: string;
  influencerId: string;
  influencerName: string;
  recipientEmail: string;
  triggerSource: 'approved' | 'finalized' | 'manual';
  sentAt: string;
  message: string;
}

interface InfluencerCouponLogItem {
  influencerId: string;
  influencerName: string;
  influencerEmail: string | null;
  isActive: boolean;
  code: string;
  usageCount: number;
  usageLimit: number;
  expiryDate: string | null;
}

interface InfluencerCouponUsageLogItem {
  id: string;
  eventId: string;
  influencerId: string | null;
  influencerName: string | null;
  couponCode: string;
  participantId: string | null;
  participantName: string;
  participantEmail: string;
  ticketId: string | null;
  ticketName: string;
  bookingId: string | null;
  usedAt: string;
}

type InfluencerPostTemplateInput = Omit<InfluencerPostTemplateConfig, 'updatedAt'>;

const bebasNeue = Bebas_Neue({ subsets: ['latin'], weight: '400', preload: false });
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], preload: false });

const defaultInfluencerForm = {
  name: '',
  title: '',
  achievements: '',
  details: '',
  socialUrl: '',
  photoUrl: '',
};

const defaultInfluencerImportConfig: InfluencerImportConfigState = {
  formUrl: '',
  sheetUrl: '',
  emailTemplateKey: '',
  whatsappTemplateKey: '',
  defaultWhatsappNumber: '',
  discountPercent: 35,
};

const defaultInfluencerPostConfig: InfluencerPostConfigState = {
  influencerId: '',
  customPhotoUrl: '',
  nameOverride: '',
  squareFrameUrl: '',
  templateOnTop: true,
  squareWidth: 1080,
  squareHeight: 1080,
  squareImageScale: 1,
  squareImageOffsetX: 0,
  squareImageOffsetY: 0,
  squareNameOffsetX: 0,
  squareNameOffsetY: 0,
  storyFrameUrl: '',
  storyWidth: 1080,
  storyHeight: 1920,
  storyImageScale: 1,
  storyImageOffsetX: 0,
  storyImageOffsetY: 0,
  storyNameOffsetX: 0,
  storyNameOffsetY: 0,
  nameFontFamily: 'Bebas Neue',
  nameFontSize: 68,
  nameFontColor: '#ffffff',
  nameLetterSpacing: 2,
  nameShapeEnabled: false,
  nameShapeColor: '#000000',
  nameShapeOpacity: 0.45,
  nameShapePaddingX: 26,
  nameShapePaddingY: 16,
  nameShapeRadius: 18,
  includeBrandingText: true,
};

function buildPostTemplateInput(config: InfluencerPostConfigState): InfluencerPostTemplateInput {
  return {
    squareFrameUrl: config.squareFrameUrl,
    templateOnTop: config.templateOnTop,
    squareWidth: config.squareWidth,
    squareHeight: config.squareHeight,
    squareImageScale: config.squareImageScale,
    squareImageOffsetX: config.squareImageOffsetX,
    squareImageOffsetY: config.squareImageOffsetY,
    squareNameOffsetX: config.squareNameOffsetX,
    squareNameOffsetY: config.squareNameOffsetY,
    storyFrameUrl: config.storyFrameUrl,
    storyWidth: config.storyWidth,
    storyHeight: config.storyHeight,
    storyImageScale: config.storyImageScale,
    storyImageOffsetX: config.storyImageOffsetX,
    storyImageOffsetY: config.storyImageOffsetY,
    storyNameOffsetX: config.storyNameOffsetX,
    storyNameOffsetY: config.storyNameOffsetY,
    nameFontFamily: config.nameFontFamily,
    nameFontSize: config.nameFontSize,
    nameFontColor: config.nameFontColor,
    nameLetterSpacing: config.nameLetterSpacing,
    nameShapeEnabled: config.nameShapeEnabled,
    nameShapeColor: config.nameShapeColor,
    nameShapeOpacity: config.nameShapeOpacity,
    nameShapePaddingX: config.nameShapePaddingX,
    nameShapePaddingY: config.nameShapePaddingY,
    nameShapeRadius: config.nameShapeRadius,
    includeBrandingText: config.includeBrandingText,
  };
}

function applySavedPostTemplateConfig(
  config: Partial<InfluencerPostTemplateConfig> | null | undefined,
  influencerId = '',
  customPhotoUrl = ''
): InfluencerPostConfigState {
  return {
    ...defaultInfluencerPostConfig,
    influencerId,
    customPhotoUrl,
    nameOverride: '',
    squareFrameUrl: String(config?.squareFrameUrl || ''),
    templateOnTop: config?.templateOnTop !== false,
    squareWidth: Number(config?.squareWidth || defaultInfluencerPostConfig.squareWidth),
    squareHeight: Number(config?.squareHeight || defaultInfluencerPostConfig.squareHeight),
    squareImageScale: Number(config?.squareImageScale || defaultInfluencerPostConfig.squareImageScale),
    squareImageOffsetX: Number(config?.squareImageOffsetX || 0),
    squareImageOffsetY: Number(config?.squareImageOffsetY || 0),
    squareNameOffsetX: Number(config?.squareNameOffsetX || 0),
    squareNameOffsetY: Number(config?.squareNameOffsetY || 0),
    storyFrameUrl: String(config?.storyFrameUrl || ''),
    storyWidth: Number(config?.storyWidth || defaultInfluencerPostConfig.storyWidth),
    storyHeight: Number(config?.storyHeight || defaultInfluencerPostConfig.storyHeight),
    storyImageScale: Number(config?.storyImageScale || defaultInfluencerPostConfig.storyImageScale),
    storyImageOffsetX: Number(config?.storyImageOffsetX || 0),
    storyImageOffsetY: Number(config?.storyImageOffsetY || 0),
    storyNameOffsetX: Number(config?.storyNameOffsetX || 0),
    storyNameOffsetY: Number(config?.storyNameOffsetY || 0),
    nameFontFamily: (['Inter', 'Poppins', 'Bebas Neue'].includes(String(config?.nameFontFamily || '')) ? String(config?.nameFontFamily) : defaultInfluencerPostConfig.nameFontFamily) as InfluencerPostConfigState['nameFontFamily'],
    nameFontSize: Number(config?.nameFontSize || defaultInfluencerPostConfig.nameFontSize),
    nameFontColor: String(config?.nameFontColor || defaultInfluencerPostConfig.nameFontColor),
    nameLetterSpacing: Number(config?.nameLetterSpacing ?? defaultInfluencerPostConfig.nameLetterSpacing),
    nameShapeEnabled: config?.nameShapeEnabled === true,
    nameShapeColor: String(config?.nameShapeColor || defaultInfluencerPostConfig.nameShapeColor),
    nameShapeOpacity: Number(config?.nameShapeOpacity ?? defaultInfluencerPostConfig.nameShapeOpacity),
    nameShapePaddingX: Number(config?.nameShapePaddingX ?? defaultInfluencerPostConfig.nameShapePaddingX),
    nameShapePaddingY: Number(config?.nameShapePaddingY ?? defaultInfluencerPostConfig.nameShapePaddingY),
    nameShapeRadius: Number(config?.nameShapeRadius ?? defaultInfluencerPostConfig.nameShapeRadius),
    includeBrandingText: config?.includeBrandingText !== false,
  };
}

type PostEditorDragTarget = 'square-image' | 'square-name' | 'story-image' | 'story-name';

function stripDataUrlPrefix(dataUrl: string): string {
  const index = dataUrl.indexOf(',');
  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl;
}

function normalizePreviewImageUrl(input: string | null | undefined): string {
  let raw = String(input || '').trim();
  if (!raw) return '';

  raw = raw.replace(/^hhtps?:\/\//i, 'https://');
  raw = raw.replace('://googlr.', '://google.');
  raw = raw.replace('googleapis,com', 'googleapis.com');
  raw = raw.replace('googleusercontent,com', 'googleusercontent.com');
  raw = raw.replace('storage.googleapis,com', 'storage.googleapis.com');
  raw = raw.replace(/^https?:\/\/storage\.googleapis\.com\.([^/]+)/i, 'https://storage.googleapis.com/$1');
  raw = raw.replace(/^https?:\/\/storage\.googleapis\.com([^/])/i, 'https://storage.googleapis.com/$1');

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();

    if (!host.includes('drive.google.com')) return raw;

    const byQueryId = parsed.searchParams.get('id');
    if (byQueryId) return `https://drive.google.com/thumbnail?id=${byQueryId}&sz=w2000`;

    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
    if (fileMatch?.[1]) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w2000`;

    return raw;
  } catch {
    return raw;
  }
}

function getPreviewImageSrc(input: string | null | undefined): string {
  const resolvedUrl = normalizePreviewImageUrl(input);
  if (!resolvedUrl) return '';
  if (resolvedUrl.startsWith('data:') || resolvedUrl.startsWith('blob:') || resolvedUrl.startsWith('/')) return resolvedUrl;
  if (/^https?:\/\//i.test(resolvedUrl)) {
    return `/api/proxy-image?url=${encodeURIComponent(resolvedUrl)}`;
  }
  return resolvedUrl;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    const resolvedUrl = getPreviewImageSrc(url);
    image.onerror = () => reject(new Error(`Failed to load image: ${resolvedUrl}`));
    image.src = resolvedUrl;
  });
}

async function ensureCanvasFontsLoaded(fontFamily: InfluencerPostConfigState['nameFontFamily'], fontSize: number) {
  if (typeof document === 'undefined' || !('fonts' in document)) return;

  const fontMap: Record<InfluencerPostConfigState['nameFontFamily'], string> = {
    Inter: 'Inter',
    Poppins: 'Poppins',
    'Bebas Neue': 'Bebas Neue',
  };

  try {
    await Promise.all([
      document.fonts.load(`700 ${Math.max(16, fontSize)}px "${fontMap[fontFamily]}"`),
      document.fonts.ready,
    ]);
  } catch {
    // Ignore font-loading errors and fall back to system rendering.
  }
}

function hexToRgba(hexColor: string, alpha: number) {
  const raw = String(hexColor || '').replace('#', '').trim();
  const safe = raw.length === 3
    ? raw.split('').map((char) => char + char).join('')
    : raw.padEnd(6, '0').slice(0, 6);
  const r = Number.parseInt(safe.slice(0, 2), 16) || 0;
  const g = Number.parseInt(safe.slice(2, 4), 16) || 0;
  const b = Number.parseInt(safe.slice(4, 6), 16) || 0;
  const clampedAlpha = Math.max(0, Math.min(1, Number(alpha || 0)));
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
}

function buildCanvasFont(fontSize: number, fontFamily: InfluencerPostConfigState['nameFontFamily']) {
  const family = fontFamily === 'Bebas Neue' ? '"Bebas Neue", Arial, sans-serif' : fontFamily === 'Poppins' ? 'Poppins, Arial, sans-serif' : 'Inter, Arial, sans-serif';
  const weight = fontFamily === 'Bebas Neue' ? 400 : 700;
  return `${weight} ${Math.max(16, fontSize)}px ${family}`;
}

function measureLetterSpacedText(ctx: CanvasRenderingContext2D, text: string, letterSpacing: number) {
  if (!text) return 0;
  const spacing = Number(letterSpacing || 0);
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += ctx.measureText(text[i]).width;
    if (i < text.length - 1) width += spacing;
  }
  return width;
}

function drawLetterSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number
) {
  const spacing = Number(letterSpacing || 0);
  let currentX = x;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    ctx.fillText(char, currentX, y);
    currentX += ctx.measureText(char).width + spacing;
  }
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function sortInfluencers(list: Influencer[]) {
  return [...list].sort((a, b) => a.order - b.order);
}

function formatInrFromPaisa(amountPaisa: number): string {
  return `₹${(Math.max(0, Number(amountPaisa || 0)) / 100).toFixed(2)}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function getPostSendSourceLabel(source?: 'approved' | 'finalized' | 'manual'): string {
  if (source === 'approved') return 'Auto (Approved)';
  if (source === 'finalized') return 'Manual Send';
  return 'Manual';
}

function stableHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getCouponExpiryLabel(influencer: Influencer): { label: string; tone: 'muted' | 'active' | 'expired' } {
  // Already-registered influencers don't need a registration countdown.
  if (influencer.isActive !== false) {
    return { label: '—', tone: 'muted' };
  }

  if (!influencer.discountCouponCode) {
    return { label: '—', tone: 'muted' };
  }

  const baseDateRaw = influencer.approvedAt || influencer.createdAt;
  const baseDate = baseDateRaw ? new Date(baseDateRaw) : null;
  if (!baseDate || Number.isNaN(baseDate.getTime())) {
    return { label: '—', tone: 'muted' };
  }

  const expiry = new Date(baseDate.getTime() + (5 * 24 * 60 * 60 * 1000));
  const diffMs = expiry.getTime() - Date.now();
  const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

  if (daysLeft <= 0) {
    return { label: 'Expired', tone: 'expired' };
  }
  if (daysLeft === 1) {
    return { label: '1 day left', tone: 'active' };
  }
  return { label: `${daysLeft} days left`, tone: 'active' };
}

function getEffectiveInfluencerPersonalCode(influencer: Influencer): string {
  const current = String(influencer.discountCouponCode || '').trim().toUpperCase();
  if (current.startsWith('INF30')) return current;
  return influencer.id ? `INF30${stableHash(`INF-${influencer.eventId}-${influencer.id}`.replace(/[^A-Z0-9]/gi, '').toUpperCase()).toUpperCase().slice(0, 8)}` : current;
}

function getRefundBreakdown(row: InfluencerFormResponseRow, influencerDiscountPercent: number) {
  const paidAmountPaisa = Math.max(0, Math.round(Number(row.paidAmountPaisa || 0)));
  const couponDiscountPaisa = Math.max(0, Math.round(Number(row.couponDiscountPaisa || 0)));
  const pricingFullStickerPaisa = Math.max(0, Math.round(Number(row.pricingFullStickerPaisa || 0)));
  const ticketPricePaisa = Math.max(0, Math.round(Number(row.ticketPricePaisa || 0)));
  const resolvedInfluencerPercent = Math.max(1, Math.min(100, Number(influencerDiscountPercent || 35)));

  // Full sticker price = what they should have paid without any coupon.
  // pricingFullStickerPaisa is computed from the sum of all pricingBreakdown components (base + GST + fees).
  // This correctly reflects the real ticket price for BOTH online and offline (admin) registrations.
  // For offline: totalPayable == amountPaid (not the real price), but base+eventGST IS the real price.
  // Priority: component-sum (pricingFullStickerPaisa) → ticketPrice field → paidAmount fallback
  const stickerPricePaisa = pricingFullStickerPaisa > 0
    ? pricingFullStickerPaisa
    : ticketPricePaisa > 0
      ? ticketPricePaisa
      : 0;
  const fullPricePaisa = stickerPricePaisa > 0
    ? stickerPricePaisa + couponDiscountPaisa
    : paidAmountPaisa + couponDiscountPaisa;

  // Offline/underpayment: athlete paid less than sticker price (e.g. manual/offline collection)
  const offlineDiscountPaisa = stickerPricePaisa > 0
    ? Math.max(0, stickerPricePaisa - paidAmountPaisa)
    : 0;

  const totalExistingDiscountPaisa = couponDiscountPaisa + offlineDiscountPaisa;
  const influencerDiscountAmountPaisa = Math.round((resolvedInfluencerPercent / 100) * fullPricePaisa);
  const refundAmountPaisa = Math.max(0, Math.min(paidAmountPaisa, influencerDiscountAmountPaisa - totalExistingDiscountPaisa));

  return {
    paidAmountPaisa,
    fullPricePaisa,
    stickerPricePaisa,
    couponDiscountPaisa,
    offlineDiscountPaisa,
    totalExistingDiscountPaisa,
    influencerDiscountAmountPaisa,
    refundAmountPaisa,
    resolvedInfluencerPercent,
  };
}

function renderTextWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`link-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline hover:opacity-80"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
  });
}

function ResponsePreviewImage({ photoUrl, name }: { photoUrl?: string | null; name?: string | null }) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const hasUrl = !!photoUrl && photoUrl.trim().length > 0;

  const thumbnail = hasUrl && !failed ? (
    <button
      type="button"
      className="h-12 w-12 overflow-hidden rounded-lg bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
      title="Click to view full photo"
      onClick={() => setLightboxOpen(true)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl!}
        alt={name || 'Influencer'}
        className="h-full w-full object-cover object-center"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </button>
  ) : (
    hasUrl ? (
      <a
        href={photoUrl!}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground underline hover:bg-muted/80"
        title="Open photo link"
      >
        Link
      </a>
    ) : (
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">No Photo</div>
    )
  );

  return (
    <>
      {thumbnail}
      {lightboxOpen && hasUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-2 mb-2">
              <a
                href={photoUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                onClick={(e) => e.stopPropagation()}
              >
                Open in new tab
              </a>
              <button
                type="button"
                className="rounded bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                onClick={() => setLightboxOpen(false)}
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl!}
              alt={name || 'Influencer'}
              className="max-h-[80vh] w-full rounded-lg object-contain"
              onError={() => { setFailed(true); setLightboxOpen(false); }}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default function InfluencersTab({ events, isLoadingEvents }: InfluencersTabProps) {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [form, setForm] = useState(defaultInfluencerForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [newOrder, setNewOrder] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isExtendingInfluencerId, setIsExtendingInfluencerId] = useState<string | null>(null);
  const [editingInfluencer, setEditingInfluencer] = useState<Influencer | null>(null);
  const [importConfig, setImportConfig] = useState(defaultInfluencerImportConfig);
  const [postConfig, setPostConfig] = useState(defaultInfluencerPostConfig);
  const [responseRows, setResponseRows] = useState<InfluencerFormResponseRow[]>([]);
  const [activeSectionTab, setActiveSectionTab] = useState<'influencers' | 'google-form' | 'influencer-post' | 'campaign' | 'discount'>('influencers');
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);
  const [sendEmailOnApprove, setSendEmailOnApprove] = useState(true);
  const [sendWhatsappOnApprove, setSendWhatsappOnApprove] = useState(true);
  const [selectedResponseIds, setSelectedResponseIds] = useState<string[]>([]);
  const [isSavingImportConfig, setIsSavingImportConfig] = useState(false);
  const [isImportConfigDirty, setIsImportConfigDirty] = useState(false);
  const [isLoadingResponses, setIsLoadingResponses] = useState(false);
  const [isImportingResponses, setIsImportingResponses] = useState(false);
  const [isResponsesModalOpen, setIsResponsesModalOpen] = useState(false);
  const [previewingResponse, setPreviewingResponse] = useState<InfluencerFormResponseRow | null>(null);
  const [isRefundingInfluencer, setIsRefundingInfluencer] = useState<string | null>(null);
  const [registrationFilter, setRegistrationFilter] = useState<'all' | 'registered' | 'not-registered'>('all');
  const [responseSearchTerm, setResponseSearchTerm] = useState('');
  const [influencerSearchTerm, setInfluencerSearchTerm] = useState('');
  const [campaignAudience, setCampaignAudience] = useState<'active' | 'inactive' | 'rejected' | 'not_selected'>('active');
  const [customCampaignChannel, setCustomCampaignChannel] = useState<'email' | 'whatsapp'>('email');
  const [customEmailSubject, setCustomEmailSubject] = useState('');
  const [customEmailHtml, setCustomEmailHtml] = useState('');
  const [customWhatsappCampaignName, setCustomWhatsappCampaignName] = useState('');
  const [customWhatsappParamsText, setCustomWhatsappParamsText] = useState('');
  const [customTestRecipient, setCustomTestRecipient] = useState('');
  const [campaignTargetInfluencerIds, setCampaignTargetInfluencerIds] = useState<string[]>([]);
  const [isSendingCustomCampaign, setIsSendingCustomCampaign] = useState<'send' | 'test' | null>(null);
  const [couponDiscountPercent, setCouponDiscountPercent] = useState(35);
  const [regenerateExistingCoupons, setRegenerateExistingCoupons] = useState(false);
  const [isGeneratingCoupons, setIsGeneratingCoupons] = useState(false);
  const [couponGenerationSummary, setCouponGenerationSummary] = useState<{ generated: number; skipped: number; failed: number } | null>(null);
  const [couponLogs, setCouponLogs] = useState<InfluencerCouponLogItem[]>([]);
  const [couponUsageLogs, setCouponUsageLogs] = useState<InfluencerCouponUsageLogItem[]>([]);
  const [isSavingPostTemplate, setIsSavingPostTemplate] = useState(false);
  const [isGeneratingPostCards, setIsGeneratingPostCards] = useState(false);
  const [isUploadingPostFrame, setIsUploadingPostFrame] = useState<'square' | 'story' | 'photo' | null>(null);
  const [generatedSquarePreview, setGeneratedSquarePreview] = useState<string | null>(null);
  const [generatedStoryPreview, setGeneratedStoryPreview] = useState<string | null>(null);
  const [postEmailLogs, setPostEmailLogs] = useState<InfluencerPostEmailLogItem[]>([]);
  const [isLoadingPostEmailLogs, setIsLoadingPostEmailLogs] = useState(false);
  const [postLogInfluencerFilter, setPostLogInfluencerFilter] = useState<string>('all');
  const [selectedDragTarget, setSelectedDragTarget] = useState<PostEditorDragTarget | null>(null);
  const [activeDragTarget, setActiveDragTarget] = useState<PostEditorDragTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const squareFrameInputRef = useRef<HTMLInputElement>(null);
  const storyFrameInputRef = useRef<HTMLInputElement>(null);
  const postPhotoInputRef = useRef<HTMLInputElement>(null);
  const dragStateRef = useRef<{
    target: PostEditorDragTarget;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const filteredResponseRows = responseRows.filter((row) => {
    if (registrationFilter === 'registered' && row.isRegistered !== true) return false;
    if (registrationFilter === 'not-registered' && row.isRegistered === true) return false;
    if (responseSearchTerm.trim()) {
      const term = responseSearchTerm.toLowerCase();
      return (
        (row.name || '').toLowerCase().includes(term) ||
        (row.email || '').toLowerCase().includes(term) ||
        (row.mobile || '').toLowerCase().includes(term)
      );
    }
    return true;
  });
  const registeredCount = responseRows.filter((row) => row.isRegistered === true).length;
  const notRegisteredCount = responseRows.length - registeredCount;
  const selectedPostInfluencer = influencers.find((item) => item.id === postConfig.influencerId) || null;
  const filteredInfluencers = influencers.filter((influencer) => (
    !influencerSearchTerm.trim() ||
    influencer.name.toLowerCase().includes(influencerSearchTerm.toLowerCase())
  ));
  const effectivePostPhotoUrl = (postConfig.customPhotoUrl || selectedPostInfluencer?.photoUrl || '').trim();
  const selectedEventName = events.find((event) => event.id === selectedEventId)?.eventName || 'Selected event';

  const influencerStats = useMemo(() => {
    const total = influencers.length;
    const active = influencers.filter((item) => item.isActive !== false).length;
    const inactive = total - active;
    const registered = influencers.filter((item) => Boolean(item.registrationMatchedAt)).length;
    const notRegistered = total - registered;

    return { total, active, inactive, registered, notRegistered };
  }, [influencers]);

  const campaignAudienceInfluencers = useMemo(() => {
    if (campaignAudience === 'active') {
      return influencers.filter((influencer) => influencer.isActive !== false);
    }
    if (campaignAudience === 'inactive') {
      return influencers.filter((influencer) => influencer.isActive === false);
    }
    return [];
  }, [campaignAudience, influencers]);

  const rejectedResponsesCount = useMemo(
    () => responseRows.filter((row) => row.isRejected === true && !row.alreadyImported).length,
    [responseRows]
  );

  const notSelectedResponsesCount = useMemo(
    () => responseRows.filter((row) => row.isRejected !== true && !row.alreadyImported).length,
    [responseRows]
  );

  useEffect(() => {
    setCampaignTargetInfluencerIds((prev) => prev.filter((id) => campaignAudienceInfluencers.some((influencer) => influencer.id === id)));
  }, [campaignAudienceInfluencers]);

  useEffect(() => {
    if ((campaignAudience === 'rejected' || campaignAudience === 'not_selected') && customCampaignChannel !== 'email') {
      setCustomCampaignChannel('email');
    }
  }, [campaignAudience, customCampaignChannel]);

  const filteredPostEmailLogs = useMemo(() => {
    if (postLogInfluencerFilter === 'all') return postEmailLogs;
    return postEmailLogs.filter((log) => log.influencerId === postLogInfluencerFilter);
  }, [postEmailLogs, postLogInfluencerFilter]);

  const couponLogByInfluencerId = useMemo(() => {
    const map = new Map<string, InfluencerCouponLogItem>();
    couponLogs.forEach((log) => {
      map.set(log.influencerId, log);
    });
    return map;
  }, [couponLogs]);

  const activeSentPostCount = useMemo(() => {
    const activeInfluencerIds = new Set(influencers.filter((item) => item.isActive !== false).map((item) => item.id));
    const sentToActiveIds = new Set(postEmailLogs.filter((log) => activeInfluencerIds.has(log.influencerId)).map((log) => log.influencerId));
    return sentToActiveIds.size;
  }, [influencers, postEmailLogs]);

  const fetchInfluencers = useCallback(async (eventId: string) => {
    setIsLoading(true);
    const result = await getInfluencersAction(eventId);
    if (result.success && result.influencers) {
      const sortedInfluencers = sortInfluencers(result.influencers);
      setInfluencers(sortedInfluencers);
      setNewOrder(sortedInfluencers.length > 0 ? Math.max(...sortedInfluencers.map((item) => item.order)) + 1 : 1);
    } else {
      setInfluencers([]);
      setNewOrder(1);
      if (!result.success) {
        toast({ variant: 'destructive', title: 'Failed to load influencers', description: result.message });
      }
    }
    setIsLoading(false);
  }, [toast]);

  const fetchInfluencerImportConfig = useCallback(async (eventId: string) => {
    const result = await getInfluencerFormConfigAction(eventId);
    if (result.success && result.config) {
      const configuredDiscount = result.config.discountPercent ?? 35;
      setImportConfig({
        formUrl: result.config.formUrl || '',
        sheetUrl: result.config.sheetUrl || '',
        emailTemplateKey: result.config.emailTemplateKey || '',
        whatsappTemplateKey: result.config.whatsappTemplateKey || '',
        defaultWhatsappNumber: result.config.defaultWhatsappNumber || '',
        discountPercent: configuredDiscount,
      });
      setCouponDiscountPercent(configuredDiscount);
      setIsImportConfigDirty(false);
      return;
    }

    setImportConfig(defaultInfluencerImportConfig);
    setCouponDiscountPercent(defaultInfluencerImportConfig.discountPercent);
    setIsImportConfigDirty(false);
  }, []);

  const fetchInfluencerPostTemplateConfig = useCallback(async (eventId: string) => {
    const result = await getInfluencerPostTemplateConfigAction(eventId);
    if (result.success) {
      setPostConfig((prev) => applySavedPostTemplateConfig(result.config, prev.influencerId, prev.customPhotoUrl));
      return;
    }

    setPostConfig((prev) => applySavedPostTemplateConfig(null, prev.influencerId, prev.customPhotoUrl));
    toast({ variant: 'destructive', title: 'Failed to load template', description: result.message });
  }, [toast]);

  const fetchInfluencerPostEmailLogs = useCallback(async (eventId: string) => {
    setIsLoadingPostEmailLogs(true);
    const result = await getInfluencerPostEmailLogsAction(eventId);
    if (result.success && result.logs) {
      setPostEmailLogs(result.logs as InfluencerPostEmailLogItem[]);
    } else {
      setPostEmailLogs([]);
      if (!result.success) {
        toast({ variant: 'destructive', title: 'Failed to load post email logs', description: result.message });
      }
    }
    setIsLoadingPostEmailLogs(false);
  }, [toast]);

  const fetchInfluencerCouponLogs = useCallback(async (eventId: string) => {
    const result = await getInfluencerPublicCouponLogsAction(eventId);
    if (result.success) {
      setCouponLogs(result.couponLogs || []);
      setCouponUsageLogs(result.usageLogs || []);
      return;
    }

    setCouponLogs([]);
    setCouponUsageLogs([]);
    toast({ variant: 'destructive', title: 'Failed to load coupon logs', description: result.message });
  }, [toast]);

  const handleSavePostTemplateConfig = useCallback(async (configOverride?: InfluencerPostConfigState) => {
    if (!selectedEventId) return false;

    setIsSavingPostTemplate(true);
    const configToSave = configOverride || postConfig;
    const result = await saveInfluencerPostTemplateConfigAction(selectedEventId, buildPostTemplateInput(configToSave));
    setIsSavingPostTemplate(false);

    if (!result.success) {
      toast({ variant: 'destructive', title: 'Template save failed', description: result.message });
      return false;
    }

    if (result.config) {
      setPostConfig((prev) => applySavedPostTemplateConfig(result.config, prev.influencerId, prev.customPhotoUrl));
    }
    toast({ title: 'Template saved', description: 'This event template will be reused for all influencers until updated.' });
    return true;
  }, [postConfig, selectedEventId, toast]);

  useEffect(() => {
    if (selectedEventId) {
      setResponseRows([]);
      setSelectedResponseIds([]);
      setPostConfig(applySavedPostTemplateConfig(null));
      setGeneratedSquarePreview(null);
      setGeneratedStoryPreview(null);
      setPostLogInfluencerFilter('all');
      setCouponGenerationSummary(null);
      setCouponLogs([]);
      setCouponUsageLogs([]);
      void fetchInfluencers(selectedEventId);
      void fetchInfluencerImportConfig(selectedEventId);
      void fetchInfluencerPostTemplateConfig(selectedEventId);
      void fetchInfluencerPostEmailLogs(selectedEventId);
      void fetchInfluencerCouponLogs(selectedEventId);
    } else {
      setInfluencers([]);
      setImportConfig(defaultInfluencerImportConfig);
      setIsImportConfigDirty(false);
      setResponseRows([]);
      setSelectedResponseIds([]);
      setPostConfig(defaultInfluencerPostConfig);
      setGeneratedSquarePreview(null);
      setGeneratedStoryPreview(null);
      setPostEmailLogs([]);
      setPostLogInfluencerFilter('all');
      setCouponGenerationSummary(null);
      setCouponLogs([]);
      setCouponUsageLogs([]);
    }
  }, [selectedEventId, fetchInfluencers, fetchInfluencerImportConfig, fetchInfluencerPostTemplateConfig, fetchInfluencerPostEmailLogs, fetchInfluencerCouponLogs]);

  useEffect(() => {
    if (!postConfig.influencerId && influencers.length > 0) {
      setPostConfig((prev) => ({ ...prev, influencerId: influencers[0].id }));
    }
  }, [influencers, postConfig.influencerId]);

  const startEditorDrag = useCallback((format: 'square' | 'story', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const target = selectedDragTarget;
    if (!target || !target.startsWith(format)) return;

    const isNameTarget = target.endsWith('name');
    const startOffsetX = isNameTarget
      ? (target.startsWith('square') ? postConfig.squareNameOffsetX : postConfig.storyNameOffsetX)
      : (target.startsWith('square') ? postConfig.squareImageOffsetX : postConfig.storyImageOffsetX);
    const startOffsetY = isNameTarget
      ? (target.startsWith('square') ? postConfig.squareNameOffsetY : postConfig.storyNameOffsetY)
      : (target.startsWith('square') ? postConfig.squareImageOffsetY : postConfig.storyImageOffsetY);

    dragStateRef.current = {
      target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX,
      startOffsetY,
    };
    setActiveDragTarget(target);
  }, [postConfig.squareImageOffsetX, postConfig.squareImageOffsetY, postConfig.squareNameOffsetX, postConfig.squareNameOffsetY, postConfig.storyImageOffsetX, postConfig.storyImageOffsetY, postConfig.storyNameOffsetX, postConfig.storyNameOffsetY, selectedDragTarget]);

  const handleEditorPointerMove = useCallback((format: 'square' | 'story', event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    if (!dragState.target.startsWith(format)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.max(200, Number(format === 'square' ? postConfig.squareWidth : postConfig.storyWidth));
    const height = Math.max(200, Number(format === 'square' ? postConfig.squareHeight : postConfig.storyHeight));
    const scaleX = width / Math.max(1, rect.width);
    const scaleY = height / Math.max(1, rect.height);

    const deltaX = (event.clientX - dragState.startClientX) * scaleX;
    const deltaY = (event.clientY - dragState.startClientY) * scaleY;
    const nextOffsetX = Math.round(dragState.startOffsetX + deltaX);
    const nextOffsetY = Math.round(dragState.startOffsetY + deltaY);

    setPostConfig((prev) => {
      if (dragState.target === 'square-image') return { ...prev, squareImageOffsetX: nextOffsetX, squareImageOffsetY: nextOffsetY };
      if (dragState.target === 'square-name') return { ...prev, squareNameOffsetX: nextOffsetX, squareNameOffsetY: nextOffsetY };
      if (dragState.target === 'story-image') return { ...prev, storyImageOffsetX: nextOffsetX, storyImageOffsetY: nextOffsetY };
      return { ...prev, storyNameOffsetX: nextOffsetX, storyNameOffsetY: nextOffsetY };
    });
  }, [postConfig.squareHeight, postConfig.squareWidth, postConfig.storyHeight, postConfig.storyWidth]);

  const stopEditorDrag = useCallback(() => {
    dragStateRef.current = null;
    setActiveDragTarget(null);
  }, []);

  const handleEditorWheelZoom = useCallback((format: 'square' | 'story', event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.05 : -0.05;
    setPostConfig((prev) => {
      if (format === 'square') {
        return { ...prev, squareImageScale: Math.min(6, Math.max(0.2, Number((prev.squareImageScale + delta).toFixed(2)))) };
      }
      return { ...prev, storyImageScale: Math.min(6, Math.max(0.2, Number((prev.storyImageScale + delta).toFixed(2)))) };
    });
  }, []);

  const createInfluencerPostImage = useCallback(async (input: {
    influencer: Influencer;
    photoUrl: string;
    displayName: string;
    width: number;
    height: number;
    frameUrl?: string;
    templateOnTop: boolean;
    includeBrandingText: boolean;
    imageScale: number;
    imageOffsetX: number;
    imageOffsetY: number;
    nameOffsetX: number;
    nameOffsetY: number;
    nameFontFamily: InfluencerPostConfigState['nameFontFamily'];
    nameFontSize: number;
    nameFontColor: string;
    nameLetterSpacing: number;
    nameShapeEnabled: boolean;
    nameShapeColor: string;
    nameShapeOpacity: number;
    nameShapePaddingX: number;
    nameShapePaddingY: number;
    nameShapeRadius: number;
  }): Promise<string> => {
    const {
      photoUrl,
      displayName,
      width,
      height,
      frameUrl,
      templateOnTop,
      includeBrandingText,
      imageScale,
      imageOffsetX,
      imageOffsetY,
      nameOffsetX,
      nameOffsetY,
      nameFontFamily,
      nameFontSize,
      nameFontColor,
      nameLetterSpacing,
      nameShapeEnabled,
      nameShapeColor,
      nameShapeOpacity,
      nameShapePaddingX,
      nameShapePaddingY,
      nameShapeRadius,
    } = input;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Unable to create image canvas context.');

    const normalizedFrameUrl = frameUrl && frameUrl.trim() ? frameUrl.trim() : '';
    const frameImage = normalizedFrameUrl ? await loadImageElement(normalizedFrameUrl) : null;

    if (frameImage && !templateOnTop) {
      ctx.drawImage(frameImage, 0, 0, width, height);
    }

    const influencerImage = await loadImageElement(photoUrl);
    const coverScale = Math.max(width / influencerImage.width, height / influencerImage.height) * Math.max(0.2, Number(imageScale || 1));
    const drawWidth = influencerImage.width * coverScale;
    const drawHeight = influencerImage.height * coverScale;
    const drawX = (width - drawWidth) / 2 + Number(imageOffsetX || 0);
    const drawY = (height - drawHeight) / 2 + Number(imageOffsetY || 0);
    ctx.drawImage(influencerImage, drawX, drawY, drawWidth, drawHeight);

    const gradient = ctx.createLinearGradient(0, height * 0.45, 0, height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (frameImage && templateOnTop) {
      ctx.drawImage(frameImage, 0, 0, width, height);
    }

    if (includeBrandingText && displayName.trim()) {
      const padding = Math.round(width * 0.06);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const resolvedFontSize = Math.max(24, Number(nameFontSize || Math.round(width * 0.044)));
      await ensureCanvasFontsLoaded(nameFontFamily, resolvedFontSize);
      ctx.font = buildCanvasFont(resolvedFontSize, nameFontFamily);

      const textX = padding + Number(nameOffsetX || 0);
      const textY = Math.round(height * 0.78) + Number(nameOffsetY || 0);
      const textWidth = measureLetterSpacedText(ctx, displayName, nameLetterSpacing);
      const textMetrics = ctx.measureText(displayName);
      const textHeight = Math.max(resolvedFontSize, Math.abs(textMetrics.actualBoundingBoxAscent) + Math.abs(textMetrics.actualBoundingBoxDescent) || resolvedFontSize);

      if (nameShapeEnabled) {
        const boxX = textX - Number(nameShapePaddingX || 0);
        const boxY = textY - Number(nameShapePaddingY || 0);
        const boxWidth = textWidth + Number(nameShapePaddingX || 0) * 2;
        const boxHeight = textHeight + Number(nameShapePaddingY || 0) * 2;
        ctx.fillStyle = hexToRgba(nameShapeColor, nameShapeOpacity);
        drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, Number(nameShapeRadius || 0));
        ctx.fill();
      }

      ctx.fillStyle = nameFontColor || '#ffffff';
      drawLetterSpacedText(ctx, displayName, textX, textY, Number(nameLetterSpacing || 0));
    }

    return canvas.toDataURL('image/png');
  }, []);

  const generateInfluencerPostAssets = useCallback(async (influencer: Influencer, options?: { photoUrl?: string | null }) => {
    const photoUrl = String(options?.photoUrl || postConfig.customPhotoUrl || influencer.photoUrl || '').trim();
    const displayName = String(postConfig.nameOverride || influencer.name || '').trim();
    if (!photoUrl) {
      throw new Error('Influencer image is required. Upload or set the post image first.');
    }

    const [squareDataUrl, storyDataUrl] = await Promise.all([
      createInfluencerPostImage({
        influencer,
        photoUrl,
        displayName,
        width: Math.max(200, Number(postConfig.squareWidth || 1080)),
        height: Math.max(200, Number(postConfig.squareHeight || 1080)),
        frameUrl: postConfig.squareFrameUrl,
        templateOnTop: postConfig.templateOnTop,
        includeBrandingText: postConfig.includeBrandingText,
        imageScale: postConfig.squareImageScale,
        imageOffsetX: postConfig.squareImageOffsetX,
        imageOffsetY: postConfig.squareImageOffsetY,
        nameOffsetX: postConfig.squareNameOffsetX,
        nameOffsetY: postConfig.squareNameOffsetY,
        nameFontFamily: postConfig.nameFontFamily,
        nameFontSize: postConfig.nameFontSize,
        nameFontColor: postConfig.nameFontColor,
        nameLetterSpacing: postConfig.nameLetterSpacing,
        nameShapeEnabled: postConfig.nameShapeEnabled,
        nameShapeColor: postConfig.nameShapeColor,
        nameShapeOpacity: postConfig.nameShapeOpacity,
        nameShapePaddingX: postConfig.nameShapePaddingX,
        nameShapePaddingY: postConfig.nameShapePaddingY,
        nameShapeRadius: postConfig.nameShapeRadius,
      }),
      createInfluencerPostImage({
        influencer,
        photoUrl,
        displayName,
        width: Math.max(200, Number(postConfig.storyWidth || 1080)),
        height: Math.max(200, Number(postConfig.storyHeight || 1920)),
        frameUrl: postConfig.storyFrameUrl,
        templateOnTop: postConfig.templateOnTop,
        includeBrandingText: postConfig.includeBrandingText,
        imageScale: postConfig.storyImageScale,
        imageOffsetX: postConfig.storyImageOffsetX,
        imageOffsetY: postConfig.storyImageOffsetY,
        nameOffsetX: postConfig.storyNameOffsetX,
        nameOffsetY: postConfig.storyNameOffsetY,
        nameFontFamily: postConfig.nameFontFamily,
        nameFontSize: postConfig.nameFontSize,
        nameFontColor: postConfig.nameFontColor,
        nameLetterSpacing: postConfig.nameLetterSpacing,
        nameShapeEnabled: postConfig.nameShapeEnabled,
        nameShapeColor: postConfig.nameShapeColor,
        nameShapeOpacity: postConfig.nameShapeOpacity,
        nameShapePaddingX: postConfig.nameShapePaddingX,
        nameShapePaddingY: postConfig.nameShapePaddingY,
        nameShapeRadius: postConfig.nameShapeRadius,
      }),
    ]);

    return { squareDataUrl, storyDataUrl };
  }, [createInfluencerPostImage, postConfig]);

  useEffect(() => {
    const influencer = influencers.find((item) => item.id === postConfig.influencerId);
    if (!influencer) {
      setGeneratedSquarePreview(null);
      setGeneratedStoryPreview(null);
      return;
    }

    const photoUrl = String(postConfig.customPhotoUrl || influencer.photoUrl || '').trim();
    if (!photoUrl) {
      setGeneratedSquarePreview(null);
      setGeneratedStoryPreview(null);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        setIsGeneratingPostCards(true);
        const { squareDataUrl, storyDataUrl } = await generateInfluencerPostAssets(influencer, { photoUrl });
        if (!active) return;
        setGeneratedSquarePreview(squareDataUrl);
        setGeneratedStoryPreview(storyDataUrl);
      } catch {
        if (!active) return;
        setGeneratedSquarePreview(null);
        setGeneratedStoryPreview(null);
      } finally {
        if (active) setIsGeneratingPostCards(false);
      }
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [generateInfluencerPostAssets, influencers, postConfig]);

  const autoSendApprovedPostCards = useCallback(async (approvedInfluencers: Influencer[]) => {
    if (!selectedEventId || approvedInfluencers.length === 0) {
      return { sent: 0, failed: 0, skipped: 0 };
    }

    const eventName = (events.find((event) => event.id === selectedEventId)?.eventName) || 'Bergman Triathlon';
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const influencer of approvedInfluencers) {
      if (!influencer.email || !influencer.photoUrl) {
        skipped += 1;
        continue;
      }

      try {
        const { squareDataUrl, storyDataUrl } = await generateInfluencerPostAssets(influencer, {
          photoUrl: influencer.photoUrl,
        });

        const result = await sendInfluencerPostCardsAction(selectedEventId, influencer.id, {
          eventName,
          squareImageBase64: stripDataUrlPrefix(squareDataUrl),
          storyImageBase64: stripDataUrlPrefix(storyDataUrl),
          triggerSource: 'approved',
        });

        if (result.success) {
          sent += 1;
          setGeneratedSquarePreview(squareDataUrl);
          setGeneratedStoryPreview(storyDataUrl);
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }

    if (sent > 0) {
      await fetchInfluencerPostEmailLogs(selectedEventId);
    }

    return { sent, failed, skipped };
  }, [events, generateInfluencerPostAssets, selectedEventId, fetchInfluencerPostEmailLogs]);

  const handlePreviewInfluencerPost = useCallback(async () => {
    const influencer = influencers.find((item) => item.id === postConfig.influencerId);
    if (!influencer) {
      toast({ variant: 'destructive', title: 'Select influencer', description: 'Choose an influencer to preview cards.' });
      return;
    }

    setIsGeneratingPostCards(true);
    try {
      const { squareDataUrl, storyDataUrl } = await generateInfluencerPostAssets(influencer);
      setGeneratedSquarePreview(squareDataUrl);
      setGeneratedStoryPreview(storyDataUrl);
      toast({ title: 'Preview ready', description: 'Review the design below before sending.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Preview failed', description: error?.message || 'Could not generate preview.' });
    } finally {
      setIsGeneratingPostCards(false);
    }
  }, [generateInfluencerPostAssets, influencers, postConfig.influencerId, toast]);

  const handleGenerateAndSendInfluencerPost = useCallback(async () => {
    if (!selectedEventId) {
      toast({ variant: 'destructive', title: 'Select event', description: 'Please select an event first.' });
      return;
    }

    const influencer = influencers.find((item) => item.id === postConfig.influencerId);
    if (!influencer) {
      toast({ variant: 'destructive', title: 'Select influencer', description: 'Choose an influencer to generate cards.' });
      return;
    }
    if (!influencer.email) {
      toast({ variant: 'destructive', title: 'Email missing', description: 'Selected influencer has no email. Add email in Influencers tab first.' });
      return;
    }

    setIsGeneratingPostCards(true);
    try {
      const { squareDataUrl, storyDataUrl } = generatedSquarePreview && generatedStoryPreview
        ? { squareDataUrl: generatedSquarePreview, storyDataUrl: generatedStoryPreview }
        : await generateInfluencerPostAssets(influencer);

      setGeneratedSquarePreview(squareDataUrl);
      setGeneratedStoryPreview(storyDataUrl);

      const result = await sendInfluencerPostCardsAction(selectedEventId, influencer.id, {
        eventName: (events.find((event) => event.id === selectedEventId)?.eventName) || 'Bergman Triathlon',
        squareImageBase64: stripDataUrlPrefix(squareDataUrl),
        storyImageBase64: stripDataUrlPrefix(storyDataUrl),
        triggerSource: 'finalized',
      });

      if (result.success) {
        await fetchInfluencerPostEmailLogs(selectedEventId);
        toast({ title: 'Post cards sent', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'Send failed', description: result.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Generation failed', description: error?.message || 'Could not generate influencer cards.' });
    } finally {
      setIsGeneratingPostCards(false);
    }
  }, [selectedEventId, influencers, postConfig.influencerId, generatedSquarePreview, generatedStoryPreview, generateInfluencerPostAssets, events, toast, fetchInfluencerPostEmailLogs]);

  const handleDownloadGeneratedImage = useCallback((type: 'square' | 'story') => {
    const dataUrl = type === 'square' ? generatedSquarePreview : generatedStoryPreview;
    if (!dataUrl) {
      toast({ variant: 'destructive', title: 'No preview found', description: 'Generate preview first, then download.' });
      return;
    }

    const influencer = influencers.find((item) => item.id === postConfig.influencerId);
    const safeName = String(influencer?.name || 'influencer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'influencer';
    const size = type === 'square' ? '1080x1080' : '1080x1920';

    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `${safeName}-preview-${size}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [generatedSquarePreview, generatedStoryPreview, influencers, postConfig.influencerId, toast]);

  const handleDownloadInfluencers = useCallback(() => {
    if (!selectedEventId) return;
    if (filteredInfluencers.length === 0) {
      toast({ variant: 'destructive', title: 'No influencers to download', description: 'Nothing to export for the current filter.' });
      return;
    }

    const escapeCsvValue = (value: string | number | boolean | null | undefined) => {
      const text = String(value ?? '');
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const headers = ['Name', 'Title', 'Status', 'Email', 'Mobile', 'Discount Coupon', 'Public Coupon', 'Days to Register', 'Order', 'Created At'];
    const rows = filteredInfluencers.map((influencer) => {
      const couponExpiry = getCouponExpiryLabel(influencer);
      return [
        influencer.name,
        influencer.title || '',
        influencer.isActive === false ? 'Inactive' : 'Active',
        influencer.email || '',
        influencer.mobile || '',
        getEffectiveInfluencerPersonalCode(influencer),
        influencer.publicCouponCode || '',
        couponExpiry.label,
        influencer.order,
        influencer.createdAt || '',
      ].map(escapeCsvValue).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const eventName = events.find((event) => event.id === selectedEventId)?.eventName || 'event';
    const safeEventName = String(eventName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';

    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeEventName}-influencers.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: 'Influencers downloaded', description: `${filteredInfluencers.length} record(s) exported.` });
  }, [events, filteredInfluencers, selectedEventId, toast]);

  const handleDownloadCouponUsageLogs = useCallback(() => {
    if (!selectedEventId) return;
    if (couponUsageLogs.length === 0) {
      toast({ variant: 'destructive', title: 'No coupon usage logs', description: 'No coupon usage has been recorded yet.' });
      return;
    }

    const escapeCsvValue = (value: string | number | boolean | null | undefined) => {
      const text = String(value ?? '');
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const headers = ['Influencer', 'Coupon Code', 'Participant', 'Participant Email', 'Ticket', 'Booking ID', 'Used At'];
    const rows = couponUsageLogs.map((log) => [
      log.influencerName || '',
      log.couponCode,
      log.participantName,
      log.participantEmail,
      log.ticketName,
      log.bookingId || '',
      log.usedAt,
    ].map(escapeCsvValue).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const safeEventName = String(selectedEventName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';

    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeEventName}-influencer-coupon-usage.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: 'Coupon usage exported', description: `${couponUsageLogs.length} usage record(s) exported for Excel.` });
  }, [couponUsageLogs, selectedEventId, selectedEventName, toast]);

  const resetForm = () => {
    setForm(defaultInfluencerForm);
    setPhotoFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Photo must be 4MB or smaller.' });
      return;
    }
    setPhotoFile(file);
    setForm((prev) => ({ ...prev, photoUrl: '' }));
  };

  const handlePostFrameFileUpload = async (type: 'square' | 'story' | 'photo', file?: File | null) => {
    if (!file) return;
    if (!selectedEventId || !firebaseUserFromAuth) {
      toast({ variant: 'destructive', title: 'Select event first', description: 'Please select an event before uploading frame files.' });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Frame image must be 8MB or smaller.' });
      return;
    }

    const requiresPng = type === 'square' || type === 'story';
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (requiresPng && !isPng) {
      toast({ variant: 'destructive', title: 'PNG required', description: 'Please upload frame as PNG for transparent overlay.' });
      return;
    }

    setIsUploadingPostFrame(type);
    try {
      const token = await firebaseUserFromAuth.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('eventId', selectedEventId);

      const response = await fetch('/api/admin/upload-influencer-photo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const result = await response.json();
      if (!response.ok || !result.success || !result.downloadURL) {
        throw new Error(result?.message || 'Frame upload failed.');
      }

      const uploadedUrl = String(result.downloadURL);
      const updatedPostConfig: InfluencerPostConfigState = {
        ...postConfig,
        customPhotoUrl: type === 'photo' ? uploadedUrl : postConfig.customPhotoUrl,
        squareFrameUrl: type === 'square' ? uploadedUrl : postConfig.squareFrameUrl,
        storyFrameUrl: type === 'story' ? uploadedUrl : postConfig.storyFrameUrl,
      };
      setPostConfig(updatedPostConfig);

      if (type === 'square' || type === 'story') {
        await handleSavePostTemplateConfig(updatedPostConfig);
      }

      toast({ title: 'Upload complete', description: `${type === 'photo' ? 'Post image' : type === 'square' ? 'Square frame' : 'Story frame'} uploaded successfully.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: error?.message || 'Could not upload frame image.' });
    } finally {
      setIsUploadingPostFrame(null);
      if (type === 'square' && squareFrameInputRef.current) squareFrameInputRef.current.value = '';
      if (type === 'story' && storyFrameInputRef.current) storyFrameInputRef.current.value = '';
      if (type === 'photo' && postPhotoInputRef.current) postPhotoInputRef.current.value = '';
    }
  };

  const uploadPhotoIfNeeded = async () => {
    if (!photoFile || !selectedEventId || !firebaseUserFromAuth) return form.photoUrl;

    setIsUploading(true);
    const token = await firebaseUserFromAuth.getIdToken();
    const formData = new FormData();
    formData.append('file', photoFile);
    formData.append('eventId', selectedEventId);

    const response = await fetch('/api/admin/upload-influencer-photo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const result = await response.json();
    setIsUploading(false);

    if (!response.ok || !result.success) {
      throw new Error(result?.message || 'Influencer photo upload failed.');
    }

    return String(result.downloadURL || '');
  };

  const handleSaveImportConfig = async () => {
    if (!selectedEventId) return;

    setIsSavingImportConfig(true);
    const result = await saveInfluencerFormConfigAction(selectedEventId, importConfig);

    if (result.success && result.config) {
      setImportConfig({
        formUrl: result.config.formUrl,
        sheetUrl: result.config.sheetUrl,
        emailTemplateKey: result.config.emailTemplateKey || '',
        whatsappTemplateKey: result.config.whatsappTemplateKey || '',
        defaultWhatsappNumber: result.config.defaultWhatsappNumber || '',
        discountPercent: result.config.discountPercent ?? 35,
      });
      setIsImportConfigDirty(false);
      toast({ title: 'Influencer import links saved', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Unable to save links', description: result.message });
    }

    setIsSavingImportConfig(false);
  };

  const syncFormResponses = useCallback(async (options?: { showLoader?: boolean; showToast?: boolean; autoSelectIfEmpty?: boolean }) => {
    if (!selectedEventId) return;

    const showLoader = options?.showLoader !== false;
    const showToast = options?.showToast === true;
    const autoSelectIfEmpty = options?.autoSelectIfEmpty !== false;

    if (showLoader) setIsLoadingResponses(true);
    const result = await previewInfluencerFormResponsesAction(selectedEventId, importConfig);

    if (result.success) {
      const rows = result.rows || [];
      const importableIds = rows.filter((row) => row.canImport).map((row) => row.id);

      setResponseRows(rows);
      setSelectedResponseIds((prev) => {
        if (prev.length === 0 && autoSelectIfEmpty) return importableIds;
        return prev.filter((id) => importableIds.includes(id));
      });

      if (result.config && !isImportConfigDirty) {
        setImportConfig({
          formUrl: result.config.formUrl,
          sheetUrl: result.config.sheetUrl,
          emailTemplateKey: result.config.emailTemplateKey || '',
          whatsappTemplateKey: result.config.whatsappTemplateKey || '',
          defaultWhatsappNumber: result.config.defaultWhatsappNumber || '',
          discountPercent: result.config.discountPercent ?? 35,
        });
      }

      setLastAutoSyncAt(new Date().toISOString());
      if (showToast) {
        toast({ title: 'Form responses synced', description: result.message });
      }
      return;
    }

    if (showToast) {
      toast({ variant: 'destructive', title: 'Unable to load form responses', description: result.message });
    }

    if (showLoader) setIsLoadingResponses(false);
    return;
  }, [selectedEventId, importConfig, isImportConfigDirty, toast]);

  const handleLoadResponses = async () => {
    await syncFormResponses({ showLoader: true, showToast: true, autoSelectIfEmpty: true });
    setIsLoadingResponses(false);
  };

  useEffect(() => {
    const shouldSyncFormResponses = activeSectionTab === 'google-form'
      || (activeSectionTab === 'campaign' && (campaignAudience === 'rejected' || campaignAudience === 'not_selected'));

    if (!selectedEventId || !shouldSyncFormResponses) return;

    void syncFormResponses({ showLoader: false, showToast: false, autoSelectIfEmpty: false });
    const timer = setInterval(() => {
      void syncFormResponses({ showLoader: false, showToast: false, autoSelectIfEmpty: false });
    }, 45000);

    return () => clearInterval(timer);
  }, [selectedEventId, activeSectionTab, campaignAudience, syncFormResponses]);

  const handleToggleResponseSelection = (rowId: string, checked: boolean) => {
    setSelectedResponseIds((prev) => {
      if (checked) return Array.from(new Set([...prev, rowId]));
      return prev.filter((id) => id !== rowId);
    });
  };

  const handleSelectAllImportableResponses = (checked: boolean) => {
    if (checked) {
      setSelectedResponseIds(responseRows.filter((row) => row.canImport).map((row) => row.id));
      return;
    }
    setSelectedResponseIds([]);
  };

  const handleImportSelectedResponses = async () => {
    if (!selectedEventId || selectedResponseIds.length === 0) return;

    setIsImportingResponses(true);
    const result = await importInfluencerFormResponsesAction(selectedEventId, selectedResponseIds, {
      ...importConfig,
      sendEmail: sendEmailOnApprove,
      sendWhatsapp: sendWhatsappOnApprove,
    });

    if (result.success && result.influencers) {
      const couponCodeByImportSource = new Map(result.influencers.map((item) => [item.importSourceKey, item.discountCouponCode || null]));
      const activationByImportSource = new Map(result.influencers.map((item) => [item.importSourceKey, item.isActive !== false]));
      setInfluencers((prev) => sortInfluencers([...prev, ...result.influencers!]));
      setNewOrder((prev) => {
        const importedMaxOrder = Math.max(...result.influencers!.map((item) => item.order ?? 0), prev - 1);
        return importedMaxOrder + 1;
      });
      setResponseRows((prev) => prev.map((row) => (
        selectedResponseIds.includes(row.id)
          ? {
              ...row,
              alreadyImported: true,
              canImport: false,
              isRejected: false,
              isRegistered: activationByImportSource.get(row.id) ?? false,
              couponCode: couponCodeByImportSource.get(row.id) || row.couponCode || null,
            }
          : row
      )));
      setSelectedResponseIds([]);
      toast({ title: 'Influencers imported', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Import failed', description: result.message });
    }

    setIsImportingResponses(false);
  };

  const handleApproveSingleResponse = async (rowId: string) => {
    if (!selectedEventId) return;

    setIsImportingResponses(true);
    const result = await importInfluencerFormResponsesAction(selectedEventId, [rowId], {
      ...importConfig,
      sendEmail: sendEmailOnApprove,
      sendWhatsapp: sendWhatsappOnApprove,
    });

    if (result.success && result.influencers) {
      const approvedInfluencer = result.influencers[0] || null;
      setInfluencers((prev) => sortInfluencers([...prev, ...result.influencers!]));
      setResponseRows((prev) => prev.map((row) => (
        row.id === rowId
          ? {
              ...row,
              alreadyImported: true,
              canImport: false,
              isRejected: false,
              isRegistered: approvedInfluencer?.isActive !== false,
              couponCode: approvedInfluencer?.discountCouponCode || row.couponCode || null,
            }
          : row
      )));
      setSelectedResponseIds((prev) => prev.filter((id) => id !== rowId));
      toast({ title: 'Influencer approved', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Approve failed', description: result.message });
    }

    setIsImportingResponses(false);
  };

  const handleRejectResponse = async (rowId: string, shouldReject: boolean) => {
    if (!selectedEventId) return;

    const result = await updateInfluencerFormResponseReviewAction(selectedEventId, rowId, shouldReject ? 'rejected' : 'pending');
    if (!result.success) {
      toast({ variant: 'destructive', title: shouldReject ? 'Reject failed' : 'Update failed', description: result.message });
      return;
    }

    setResponseRows((prev) => prev.map((row) => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        isRejected: shouldReject,
        canImport: shouldReject ? false : row.missingFields.length === 0 && !row.alreadyImported,
      };
    }));
    setSelectedResponseIds((prev) => shouldReject ? prev.filter((id) => id !== rowId) : prev);
    toast({ title: shouldReject ? 'Response rejected' : 'Response reopened', description: result.message });
  };

  const handleRefundInfluencerDiscount = async (row: InfluencerFormResponseRow) => {
    if (!selectedEventId) return;

    setIsRefundingInfluencer(row.id);
    const result = await refundInfluencerDiscountPaymentAction(selectedEventId, row.id, importConfig.discountPercent);

    if (result.success) {
      setResponseRows((prev) => prev.map((item) => (
        item.id === row.id
          ? {
              ...item,
              isDiscountRefunded: true,
              influencerRefundId: result.refundId || item.influencerRefundId || null,
              influencerRefundStatus: result.status || item.influencerRefundStatus || null,
              influencerRefundPaymentId: result.paymentId || item.influencerRefundPaymentId || null,
              influencerRefundAt: new Date().toISOString(),
              influencerRefundRrn: result.refundRrn || item.influencerRefundRrn || null,
              influencerRefundAmountPaisa: result.amountPaisa || item.influencerRefundAmountPaisa || 0,
            }
          : item
      )));
      const details: string[] = [];
      if (result.refundId) details.push(`Refund ID: ${result.refundId}`);
      if (result.refundRrn) details.push(`Txn Ref: ${result.refundRrn}`);
      toast({ title: 'Refund initiated', description: `${result.message}${details.length ? ` (${details.join(' • ')})` : ''}` });
    } else {
      toast({ variant: 'destructive', title: 'Refund failed', description: result.message });
    }

    setIsRefundingInfluencer(null);
  };

  const handleSendCustomCampaign = async (testMode: boolean) => {
    if (!selectedEventId) return;

    if (customCampaignChannel === 'email') {
      if (!customEmailSubject.trim() || !customEmailHtml.trim()) {
        toast({ variant: 'destructive', title: 'Missing email content', description: 'Custom email subject and HTML are required.' });
        return;
      }
    }

    if (customCampaignChannel === 'whatsapp' && !customWhatsappCampaignName.trim()) {
      toast({ variant: 'destructive', title: 'Missing WhatsApp campaign name', description: 'Please enter a WhatsApp campaign name.' });
      return;
    }

    if (testMode && customCampaignChannel === 'email' && !customTestRecipient.trim()) {
      toast({ variant: 'destructive', title: 'Custom test email required', description: 'Enter a custom test email before running Test Send for email.' });
      return;
    }

    if (!testMode) {
      const modeLabel = customCampaignChannel === 'email' ? 'email' : 'WhatsApp';
      const confirmed = window.confirm(`Send custom ${modeLabel} campaign to ${campaignAudience} influencers?`);
      if (!confirmed) return;
    }

    setIsSendingCustomCampaign(testMode ? 'test' : 'send');

    const whatsappParams = customWhatsappParamsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const result = await sendInfluencerCustomCampaignAction(selectedEventId, {
      channel: customCampaignChannel,
      audience: campaignAudience,
      emailSubject: customEmailSubject,
      emailHtml: customEmailHtml,
      whatsappCampaignName: customWhatsappCampaignName,
      whatsappParams,
      testMode,
      testRecipient: testMode ? customTestRecipient : undefined,
      targetInfluencerIds: campaignTargetInfluencerIds.length > 0 ? campaignTargetInfluencerIds : undefined,
    });

    if (result.success) {
      toast({ title: testMode ? 'Custom test sent' : 'Custom campaign sent', description: result.message });
    } else {
      toast({ variant: 'destructive', title: testMode ? 'Custom test failed' : 'Custom campaign failed', description: result.message });
    }

    setIsSendingCustomCampaign(null);
  };

  const handleGenerateInfluencerCoupons = async () => {
    if (!selectedEventId) return;

    setIsGeneratingCoupons(true);
    const result = await generateInfluencerDiscountCouponsAction(selectedEventId, {
      discountPercent: couponDiscountPercent,
      regenerateExisting: regenerateExistingCoupons,
    });

    if (result.success) {
      if (result.influencers) {
        setInfluencers(sortInfluencers(result.influencers));
      } else {
        await fetchInfluencers(selectedEventId);
      }
      setCouponLogs(result.couponLogs || []);
      setCouponUsageLogs(result.usageLogs || []);
      setCouponGenerationSummary({
        generated: result.generated,
        skipped: result.skipped,
        failed: result.failed,
      });
      toast({ title: 'Coupon generation completed', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Coupon generation failed', description: result.message });
    }

    setIsGeneratingCoupons(false);
  };

  const handleExtendRegistrationWindow = async (influencerId: string, daysToAdd = 5) => {
    if (!selectedEventId) return;

    setIsExtendingInfluencerId(influencerId);
    const result = await extendInfluencerRegistrationWindowAction(selectedEventId, influencerId, daysToAdd);

    if (!result.success) {
      toast({ variant: 'destructive', title: 'Extension failed', description: result.message });
      setIsExtendingInfluencerId(null);
      return;
    }

    if (result.influencer) {
      setInfluencers((prev) => sortInfluencers(prev.map((item) => item.id === influencerId ? result.influencer! : item)));
    } else {
      await fetchInfluencers(selectedEventId);
    }

    toast({ title: 'Registration window extended', description: result.message });
    setIsExtendingInfluencerId(null);
  };

  const handleAddInfluencer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;
    if (!form.name.trim() || !form.achievements.trim()) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Name and achievements are required.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const finalPhotoUrl = await uploadPhotoIfNeeded();
      if (!finalPhotoUrl) {
        throw new Error('Photo is required.');
      }

      const result = await addInfluencerAction(selectedEventId, {
        eventId: selectedEventId,
        name: form.name.trim(),
        title: form.title.trim() || null,
        achievements: form.achievements.trim(),
        details: form.details.trim() || null,
        socialUrl: form.socialUrl.trim() || null,
        photoUrl: finalPhotoUrl,
        order: newOrder,
      });

      if (!result.success) {
        throw new Error(result.message);
      }

      if (result.influencer) {
        const createdInfluencer = result.influencer;
        setInfluencers((prev) => sortInfluencers([...prev, createdInfluencer]));
        setNewOrder((prev) => Math.max(prev, (createdInfluencer.order ?? 0) + 1));
      }
      await fetchInfluencerCouponLogs(selectedEventId);

      toast({ title: 'Influencer added', description: 'The influencer has been added to this event.' });
      resetForm();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to add influencer', description: error?.message || String(error) });
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const handleDeleteInfluencer = async (id: string) => {
    if (!selectedEventId) return;
    setIsDeleting(id);
    const result = await deleteInfluencerAction(selectedEventId, id);
    if (result.success) {
      setInfluencers((prev) => prev.filter((item) => item.id !== id));
    } else {
      toast({ variant: 'destructive', title: 'Delete failed', description: result.message });
    }
    setIsDeleting(null);
  };

  const handleUpdateInfluencer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !editingInfluencer) return;
    setIsSubmitting(true);
    const result = await updateInfluencerAction(selectedEventId, editingInfluencer.id, {
      name: editingInfluencer.name,
      title: editingInfluencer.title || '',
      achievements: editingInfluencer.achievements,
      details: editingInfluencer.details || '',
      socialUrl: editingInfluencer.socialUrl || '',
      photoUrl: editingInfluencer.photoUrl,
      email: editingInfluencer.email || '',
      mobile: editingInfluencer.mobile || '',
      isActive: editingInfluencer.isActive !== false,
      order: editingInfluencer.order,
    });

    if (result.success && result.influencer) {
      const savedInfluencer = result.influencer;
      setInfluencers((prev) => sortInfluencers(prev.map((item) => (
        item.id === editingInfluencer.id
          ? savedInfluencer
          : item
      ))));
      await fetchInfluencerCouponLogs(selectedEventId);
      toast({ title: 'Influencer updated', description: 'Changes saved successfully.' });
      setEditingInfluencer(null);
    } else {
      toast({ variant: 'destructive', title: 'Update failed', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleOrderChange = (id: string, order: number) => {
    setInfluencers((prev) => prev.map((item) => (item.id === id ? { ...item, order } : item)));
  };

  const handleSaveOrder = async () => {
    if (!selectedEventId) return;
    setIsSubmitting(true);
    const result = await updateInfluencerOrderAction(
      selectedEventId,
      influencers.map((item) => ({ id: item.id, order: item.order }))
    );
    if (result.success) {
      setInfluencers((prev) => sortInfluencers(prev));
      toast({ title: 'Order saved', description: 'Influencer card order updated.' });
    } else {
      toast({ variant: 'destructive', title: 'Failed to save order', description: result.message });
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <div className="sr-only">
        <span className={bebasNeue.className}>Bebas Neue preload</span>
        <span className={poppins.className}>Poppins preload</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-primary" /> Influencers</CardTitle>
          <CardDescription>Add and manage event influencers shown above the sponsors section.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-left">
          <div className="space-y-2">
            <Label>Select Event</Label>
            <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
              <SelectTrigger className="w-full md:w-1/2">
                <SelectValue placeholder="Select an event..." />
              </SelectTrigger>
              <SelectContent>
                {(events || [])
                  .filter((event) => {
                    // Show only upcoming events
                    if (!event.eventDate || event.eventDate.toUpperCase() === 'TBD') {
                      return true; // Include TBD events
                    }
                    try {
                      const eventDate = parseISO(event.eventDate);
                      if (!isDateValid(eventDate)) return true; // Include invalid dates (show anyway)
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return eventDate >= today; // Only future dates
                    } catch {
                      return true; // Include if parsing fails
                    }
                  })
                  .map((event) => (
                    <SelectItem key={event.id} value={event.id}>{event.eventName}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {selectedEventId && (
            <div className="space-y-4 border-t pt-4">
              <Tabs value={activeSectionTab} onValueChange={(value) => setActiveSectionTab(value as 'influencers' | 'google-form' | 'influencer-post' | 'campaign' | 'discount')} className="w-full">
                <div className="md:hidden">
                  <Select
                    value={activeSectionTab}
                    onValueChange={(value) => setActiveSectionTab(value as 'influencers' | 'google-form' | 'influencer-post' | 'campaign' | 'discount')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select section" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="influencers">Influencers</SelectItem>
                      <SelectItem value="google-form">Google Form</SelectItem>
                      <SelectItem value="influencer-post">Influencer Post</SelectItem>
                      <SelectItem value="campaign">Campaign</SelectItem>
                      <SelectItem value="discount">Discount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <TabsList className="hidden w-full grid-cols-5 md:grid">
                  <TabsTrigger value="influencers" className="font-bold uppercase text-xs tracking-wide">Influencers</TabsTrigger>
                  <TabsTrigger value="google-form" className="font-bold uppercase text-xs tracking-wide">Google Form</TabsTrigger>
                  <TabsTrigger value="influencer-post" className="font-bold uppercase text-xs tracking-wide">Influencer Post</TabsTrigger>
                  <TabsTrigger value="campaign" className="font-bold uppercase text-xs tracking-wide">Campaign</TabsTrigger>
                  <TabsTrigger value="discount" className="font-bold uppercase text-xs tracking-wide">Discount</TabsTrigger>
                </TabsList>

                <TabsContent value="influencer-post" className="mt-4 space-y-4">
                  <Card className="border-dashed bg-muted/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><ImageIcon className="h-4 w-4 text-primary" /> Influencer Post Generator</CardTitle>
                      <CardDescription>
                        Upload the event template once and reuse it for every influencer until you update it. Name, font, spacing, and shape changes update the preview live like the Bergman race generator.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-left">
                      <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                        Live preview is on. Leave the name field empty to use the selected influencer name automatically.
                      </div>
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Influencer</Label>
                          <Select
                            value={postConfig.influencerId}
                            onValueChange={(value) => setPostConfig((prev) => ({ ...prev, influencerId: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select influencer" />
                            </SelectTrigger>
                            <SelectContent>
                              {influencers.map((influencer) => (
                                <SelectItem key={influencer.id} value={influencer.id}>
                                  {influencer.name}{influencer.isActive === false ? ' (Inactive)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Live Overlay Name</Label>
                          <Input
                            value={postConfig.nameOverride}
                            onChange={(e) => setPostConfig((prev) => ({ ...prev, nameOverride: e.target.value }))}
                            placeholder={selectedPostInfluencer?.name || 'Type a custom display name'}
                          />
                          <p className="text-xs text-muted-foreground">Blank = use influencer name. Edit here for live custom text.</p>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Text Overlay</Label>
                          <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                            <Checkbox
                              id="post-include-branding-text"
                              checked={postConfig.includeBrandingText}
                              onCheckedChange={(checked) => setPostConfig((prev) => ({ ...prev, includeBrandingText: checked === true }))}
                            />
                            <Label htmlFor="post-include-branding-text" className="text-sm font-medium">Include influencer name + achievements</Label>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Template Layer</Label>
                          <div className="flex h-10 items-center rounded-md border px-3 text-sm font-medium">
                            Uploaded template stays in front of influencer image.
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 lg:col-span-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Name Font</Label>
                            <Select value={postConfig.nameFontFamily} onValueChange={(value) => setPostConfig((prev) => ({ ...prev, nameFontFamily: value as InfluencerPostConfigState['nameFontFamily'] }))}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select font" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Inter">Inter</SelectItem>
                                <SelectItem value="Poppins">Poppins</SelectItem>
                                <SelectItem value="Bebas Neue">Bebas Neue</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Name Font Size</Label>
                            <Input type="number" min={16} max={300} value={postConfig.nameFontSize} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameFontSize: Math.max(16, Math.min(300, Number(e.target.value) || 68)) }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Font Color</Label>
                            <div className="flex items-center gap-2">
                              <Input type="color" value={postConfig.nameFontColor} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameFontColor: e.target.value }))} className="h-10 w-16 p-1" />
                              <Input value={postConfig.nameFontColor} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameFontColor: e.target.value || '#ffffff' }))} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Letter Spacing</Label>
                            <Input type="number" step="0.5" min={-10} max={80} value={postConfig.nameLetterSpacing} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameLetterSpacing: Math.max(-10, Math.min(80, Number(e.target.value) || 0)) }))} />
                          </div>
                          <div className="flex items-center gap-2 text-sm lg:col-span-2">
                            <Checkbox id="name-shape-enabled" checked={postConfig.nameShapeEnabled} onCheckedChange={(checked) => setPostConfig((prev) => ({ ...prev, nameShapeEnabled: checked === true }))} />
                            <Label htmlFor="name-shape-enabled" className="text-sm font-medium">Enable name shape background</Label>
                          </div>
                          {postConfig.nameShapeEnabled ? (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold uppercase text-muted-foreground">Shape Color</Label>
                                <div className="flex items-center gap-2">
                                  <Input type="color" value={postConfig.nameShapeColor} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameShapeColor: e.target.value }))} className="h-10 w-16 p-1" />
                                  <Input value={postConfig.nameShapeColor} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameShapeColor: e.target.value || '#000000' }))} />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold uppercase text-muted-foreground">Shape Opacity</Label>
                                <Input type="number" step="0.05" min={0} max={1} value={postConfig.nameShapeOpacity} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameShapeOpacity: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold uppercase text-muted-foreground">Shape Padding X</Label>
                                <Input type="number" min={0} max={200} value={postConfig.nameShapePaddingX} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameShapePaddingX: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold uppercase text-muted-foreground">Shape Padding Y</Label>
                                <Input type="number" min={0} max={200} value={postConfig.nameShapePaddingY} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameShapePaddingY: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))} />
                              </div>
                              <div className="space-y-1 lg:col-span-2">
                                <Label className="text-xs font-bold uppercase text-muted-foreground">Shape Radius</Label>
                                <Input type="number" min={0} max={200} value={postConfig.nameShapeRadius} onChange={(e) => setPostConfig((prev) => ({ ...prev, nameShapeRadius: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))} />
                              </div>
                            </>
                          ) : null}
                        </div>

                        <div className="space-y-1 lg:col-span-2">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Post Image Override</Label>
                          <Input
                            value={postConfig.customPhotoUrl}
                            onChange={(e) => setPostConfig((prev) => ({ ...prev, customPhotoUrl: e.target.value }))}
                            placeholder="Optional: use a different influencer image for this design"
                          />
                          <Input
                            ref={postPhotoInputRef}
                            type="file"
                            accept="image/*"
                            disabled={isUploadingPostFrame === 'photo'}
                            onChange={(e) => void handlePostFrameFileUpload('photo', e.target.files?.[0])}
                          />
                          <p className="text-xs text-muted-foreground">If empty, the selected influencer profile photo is used automatically, including Google Drive-hosted images.</p>
                          {effectivePostPhotoUrl ? (
                            <div className="relative mt-2 h-40 w-full overflow-hidden rounded-lg border bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={getPreviewImageSrc(effectivePostPhotoUrl)} alt="Influencer source image preview" className="h-full w-full object-contain" />
                            </div>
                          ) : null}
                          {selectedPostInfluencer?.photoUrl && !postConfig.customPhotoUrl ? (
                            <p className="text-xs text-muted-foreground">Using influencer photo: {selectedPostInfluencer.photoUrl}</p>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Square Frame URL (1080×1080)</Label>
                          <Input
                            value={postConfig.squareFrameUrl}
                            onChange={(e) => setPostConfig((prev) => ({ ...prev, squareFrameUrl: e.target.value }))}
                            placeholder="https://.../frame-square.png"
                          />
                          <Input
                            ref={squareFrameInputRef}
                            type="file"
                            accept="image/png"
                            disabled={isUploadingPostFrame === 'square'}
                            onChange={(e) => void handlePostFrameFileUpload('square', e.target.files?.[0])}
                          />
                          {postConfig.squareFrameUrl ? (
                            <div className="relative mt-2 aspect-square w-full overflow-hidden rounded-lg border bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={getPreviewImageSrc(postConfig.squareFrameUrl)} alt="Square frame preview" className="h-full w-full object-contain" />
                            </div>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Story Frame URL (1080×1920)</Label>
                          <Input
                            value={postConfig.storyFrameUrl}
                            onChange={(e) => setPostConfig((prev) => ({ ...prev, storyFrameUrl: e.target.value }))}
                            placeholder="https://.../frame-story.png"
                          />
                          <Input
                            ref={storyFrameInputRef}
                            type="file"
                            accept="image/png"
                            disabled={isUploadingPostFrame === 'story'}
                            onChange={(e) => void handlePostFrameFileUpload('story', e.target.files?.[0])}
                          />
                          {postConfig.storyFrameUrl ? (
                            <div className="relative mt-2 aspect-[9/16] w-full overflow-hidden rounded-lg border bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={getPreviewImageSrc(postConfig.storyFrameUrl)} alt="Story frame preview" className="h-full w-full object-contain" />
                            </div>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 lg:col-span-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Width</Label>
                            <Input type="number" min={200} value={postConfig.squareWidth} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareWidth: Number(e.target.value) || 1080 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Height</Label>
                            <Input type="number" min={200} value={postConfig.squareHeight} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareHeight: Number(e.target.value) || 1080 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Image Zoom</Label>
                            <Input type="number" step="0.1" min={0.2} value={postConfig.squareImageScale} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareImageScale: Number(e.target.value) || 1 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Offset X</Label>
                            <Input type="number" step="10" value={postConfig.squareImageOffsetX} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareImageOffsetX: Number(e.target.value) || 0 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Offset Y</Label>
                            <Input type="number" step="10" value={postConfig.squareImageOffsetY} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareImageOffsetY: Number(e.target.value) || 0 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Name X</Label>
                            <Input type="number" step="10" value={postConfig.squareNameOffsetX} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareNameOffsetX: Number(e.target.value) || 0 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Square Name Y</Label>
                            <Input type="number" step="10" value={postConfig.squareNameOffsetY} onChange={(e) => setPostConfig((prev) => ({ ...prev, squareNameOffsetY: Number(e.target.value) || 0 }))} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 lg:col-span-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Width</Label>
                            <Input type="number" min={200} value={postConfig.storyWidth} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyWidth: Number(e.target.value) || 1080 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Height</Label>
                            <Input type="number" min={200} value={postConfig.storyHeight} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyHeight: Number(e.target.value) || 1920 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Image Zoom</Label>
                            <Input type="number" step="0.1" min={0.2} value={postConfig.storyImageScale} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyImageScale: Number(e.target.value) || 1 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Offset X</Label>
                            <Input type="number" step="10" value={postConfig.storyImageOffsetX} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyImageOffsetX: Number(e.target.value) || 0 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Offset Y</Label>
                            <Input type="number" step="10" value={postConfig.storyImageOffsetY} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyImageOffsetY: Number(e.target.value) || 0 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Name X</Label>
                            <Input type="number" step="10" value={postConfig.storyNameOffsetX} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyNameOffsetX: Number(e.target.value) || 0 }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Story Name Y</Label>
                            <Input type="number" step="10" value={postConfig.storyNameOffsetY} onChange={(e) => setPostConfig((prev) => ({ ...prev, storyNameOffsetY: Number(e.target.value) || 0 }))} />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={() => void handleSavePostTemplateConfig()} disabled={isSavingPostTemplate || !selectedEventId}>
                          {isSavingPostTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
                          Save Event Template
                        </Button>
                        <Button type="button" variant="outline" onClick={() => selectedEventId ? void fetchInfluencerPostTemplateConfig(selectedEventId) : undefined} disabled={isSavingPostTemplate || !selectedEventId}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Reload Saved Template
                        </Button>
                        <Button type="button" variant="outline" onClick={handlePreviewInfluencerPost} disabled={isGeneratingPostCards || influencers.length === 0}>
                          {isGeneratingPostCards ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                          Refresh Live Preview
                        </Button>
                        <Button type="button" onClick={handleGenerateAndSendInfluencerPost} disabled={isGeneratingPostCards || influencers.length === 0 || !generatedSquarePreview || !generatedStoryPreview}>
                          {isGeneratingPostCards ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                          Send to Influencer Email
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => handleDownloadGeneratedImage('square')} disabled={!generatedSquarePreview}>
                          <Download className="mr-2 h-4 w-4" />
                          Download 1080×1080
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => handleDownloadGeneratedImage('story')} disabled={!generatedStoryPreview}>
                          <Download className="mr-2 h-4 w-4" />
                          Download 1080×1920
                        </Button>
                      </div>

                      <Card className="border-dashed">
                        <CardHeader className="pb-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <CardTitle className="text-sm">Post Email Logs (Active Members)</CardTitle>
                              <CardDescription>Tracks each influencer post kit sent via email for this event.</CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">{activeSentPostCount} / {influencers.filter(i => i.isActive !== false).length} active influencers sent post</Badge>
                              <Select value={postLogInfluencerFilter} onValueChange={setPostLogInfluencerFilter}>
                                <SelectTrigger className="h-8 w-[220px]">
                                  <SelectValue placeholder="Filter influencer" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All Influencers</SelectItem>
                                  {influencers.filter(i => i.isActive !== false).map((influencer) => (
                                    <SelectItem key={influencer.id} value={influencer.id}>
                                      {influencer.name}
                                    </SelectItem>
                                  ))}
                                  {influencers.some(i => i.isActive === false) && (
                                    <>
                                      <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Inactive</div>
                                      {influencers.filter(i => i.isActive === false).map((influencer) => (
                                        <SelectItem key={influencer.id} value={influencer.id}>
                                          {influencer.name} (Inactive)
                                        </SelectItem>
                                      ))}
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => selectedEventId ? void fetchInfluencerPostEmailLogs(selectedEventId) : undefined}
                                disabled={!selectedEventId || isLoadingPostEmailLogs}
                              >
                                {isLoadingPostEmailLogs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Refresh Logs
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-64 overflow-auto rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Sent At</TableHead>
                                  <TableHead>Influencer</TableHead>
                                  <TableHead>Email</TableHead>
                                  <TableHead>Source</TableHead>
                                  <TableHead>Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {isLoadingPostEmailLogs ? (
                                  <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center">
                                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                                    </TableCell>
                                  </TableRow>
                                ) : filteredPostEmailLogs.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No post email logs yet.</TableCell>
                                  </TableRow>
                                ) : (
                                  filteredPostEmailLogs.map((log) => (
                                    <TableRow key={log.id}>
                                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(log.sentAt)}</TableCell>
                                      <TableCell className="font-medium">{log.influencerName || '—'}</TableCell>
                                      <TableCell className="font-mono text-xs">{log.recipientEmail || '—'}</TableCell>
                                      <TableCell>
                                        <Badge variant="outline">{getPostSendSourceLabel(log.triggerSource)}</Badge>
                                      </TableCell>
                                      <TableCell className="max-w-[380px] truncate" title={log.message}>{log.message || 'Sent'}</TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>

                      {(generatedSquarePreview || generatedStoryPreview) ? (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase text-muted-foreground">Live Preview — 1080×1080</p>
                            <div
                              className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
                              onPointerDown={(event) => startEditorDrag('square', event)}
                              onPointerMove={(event) => handleEditorPointerMove('square', event)}
                              onPointerUp={stopEditorDrag}
                              onPointerLeave={stopEditorDrag}
                              onWheel={(event) => handleEditorWheelZoom('square', event)}
                            >
                              <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${selectedDragTarget === 'square-image' ? 'border-primary bg-primary text-primary-foreground' : 'border-white/30 bg-black/55 text-white'}`}
                                  onClick={() => setSelectedDragTarget('square-image')}
                                >
                                  Drag Image
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${selectedDragTarget === 'square-name' ? 'border-primary bg-primary text-primary-foreground' : 'border-white/30 bg-black/55 text-white'}`}
                                  onClick={() => setSelectedDragTarget('square-name')}
                                >
                                  Drag Name
                                </button>
                              </div>
                              {generatedSquarePreview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={generatedSquarePreview} alt="Square influencer post preview" className="h-full w-full object-contain" />
                              ) : null}
                            </div>
                            <p className="text-[11px] text-muted-foreground">Select Drag Image or Drag Name, then click and drag on the preview. Use mouse wheel to zoom.</p>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase text-muted-foreground">Live Preview — 1080×1920</p>
                            <div
                              className="relative aspect-[9/16] overflow-hidden rounded-lg border bg-muted"
                              onPointerDown={(event) => startEditorDrag('story', event)}
                              onPointerMove={(event) => handleEditorPointerMove('story', event)}
                              onPointerUp={stopEditorDrag}
                              onPointerLeave={stopEditorDrag}
                              onWheel={(event) => handleEditorWheelZoom('story', event)}
                            >
                              <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${selectedDragTarget === 'story-image' ? 'border-primary bg-primary text-primary-foreground' : 'border-white/30 bg-black/55 text-white'}`}
                                  onClick={() => setSelectedDragTarget('story-image')}
                                >
                                  Drag Image
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${selectedDragTarget === 'story-name' ? 'border-primary bg-primary text-primary-foreground' : 'border-white/30 bg-black/55 text-white'}`}
                                  onClick={() => setSelectedDragTarget('story-name')}
                                >
                                  Drag Name
                                </button>
                              </div>
                              {generatedStoryPreview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={generatedStoryPreview} alt="Story influencer post preview" className="h-full w-full object-contain" />
                              ) : null}
                            </div>
                            <p className="text-[11px] text-muted-foreground">Select a drag tool first, then drag on the preview to place the image or name.</p>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="campaign" className="mt-4 space-y-4">
                  <Card className="border-dashed bg-muted/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4 text-primary" /> Influencer Campaign Manager</CardTitle>
                      <CardDescription>
                        Create custom HTML emails/WhatsApp campaigns for Active/Inactive influencers, or send custom email follow-ups to Rejected/Not Selected form responses.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-left">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Audience</Label>
                          <Select value={campaignAudience} onValueChange={(value) => setCampaignAudience(value as 'active' | 'inactive' | 'rejected' | 'not_selected')}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select audience" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active ({influencerStats.active})</SelectItem>
                              <SelectItem value="inactive">Inactive ({influencerStats.inactive})</SelectItem>
                              <SelectItem value="rejected">Rejected Responses ({rejectedResponsesCount})</SelectItem>
                              <SelectItem value="not_selected">Not Selected Responses ({notSelectedResponsesCount})</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Channel</Label>
                          <Select
                            value={customCampaignChannel}
                            onValueChange={(value) => setCustomCampaignChannel(value as 'email' | 'whatsapp')}
                            disabled={campaignAudience === 'rejected' || campaignAudience === 'not_selected'}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select channel" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            </SelectContent>
                          </Select>
                          {(campaignAudience === 'rejected' || campaignAudience === 'not_selected') ? (
                            <p className="text-[11px] text-muted-foreground">For this audience, only Email is supported.</p>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Target Influencer</Label>
                          {(campaignAudience === 'rejected' || campaignAudience === 'not_selected') ? (
                            <div className="rounded-md border bg-background p-3 text-[11px] text-muted-foreground">
                              Target selection is not applicable for this audience. Campaign will send to all matching response rows.
                            </div>
                          ) : (
                          <div className="rounded-md border bg-background p-2">
                            <p className="mb-2 text-[11px] font-semibold text-primary">Multi-select enabled: tick one or more influencers below</p>
                            <label className="flex items-center gap-2 border-b pb-2 text-xs">
                              <button
                                type="button"
                                className="inline-flex items-center"
                                onClick={() => setCampaignTargetInfluencerIds([])}
                                aria-label="Select all influencers in selected audience"
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 rounded-full border ${campaignTargetInfluencerIds.length === 0 ? 'border-primary bg-primary' : 'border-muted-foreground/60 bg-transparent'}`}
                                />
                              </button>
                              <span>All influencers in selected audience</span>
                            </label>
                            <div className="mt-2 max-h-36 space-y-1 overflow-auto pr-1">
                              {campaignAudienceInfluencers.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground">No influencers available in this audience.</p>
                              ) : campaignAudienceInfluencers.map((influencer) => {
                                const checked = campaignTargetInfluencerIds.includes(influencer.id);
                                return (
                                  <button
                                    key={`campaign-target-${influencer.id}`}
                                    type="button"
                                    className="flex w-full items-center gap-2 text-left text-xs"
                                    onClick={() => {
                                      setCampaignTargetInfluencerIds((prev) => {
                                        if (prev.includes(influencer.id)) {
                                          return prev.filter((id) => id !== influencer.id);
                                        }
                                        return [...prev, influencer.id];
                                      });
                                    }}
                                    aria-pressed={checked}
                                  >
                                    <span
                                      className={`inline-block h-3.5 w-3.5 rounded-full border ${checked ? 'border-primary bg-primary' : 'border-muted-foreground/60 bg-transparent'}`}
                                    />
                                    <span>{influencer.name}{influencer.isActive === false ? ' (Inactive)' : ''}</span>
                                  </button>
                                );
                              })}
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              {campaignTargetInfluencerIds.length === 0
                                ? `Sending to all ${campaignAudience} influencers.`
                                : `${campaignTargetInfluencerIds.length} influencer(s) selected.`}
                            </p>
                            {campaignTargetInfluencerIds.length > 0 ? (
                              <div className="mt-2 rounded border border-primary/20 bg-primary/5 p-2 text-[11px]">
                                <p className="mb-1 font-semibold text-primary">Selected:</p>
                                <p className="text-foreground/90">
                                  {campaignAudienceInfluencers
                                    .filter((item) => campaignTargetInfluencerIds.includes(item.id))
                                    .map((item) => item.name)
                                    .join(', ')}
                                </p>
                              </div>
                            ) : null}
                          </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        Supported tokens: {'{{name}}'}, {'{{eventName}}'}, {'{{discountCode}}'} (personal influencer-only), {'{{unique_code}}'} / {'{{promoCode}}'} (followers/friends promo, active influencers only), {'{{registrationUrl}}'}, {'{{email}}'}, {'{{mobile}}'}, {'{{influencerStatus}}'}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-bold uppercase text-muted-foreground">Custom test recipient (optional)</Label>
                        <Input
                          value={customTestRecipient}
                          onChange={(e) => setCustomTestRecipient(e.target.value)}
                          placeholder={customCampaignChannel === 'email' ? 'test@example.com' : '+91XXXXXXXXXX'}
                        />
                        <p className="text-xs text-muted-foreground">Used only for Test Send. Leave blank to test with one influencer from selected audience.</p>
                      </div>

                      {customCampaignChannel === 'email' ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Email Subject</Label>
                            <Input
                              value={customEmailSubject}
                              onChange={(e) => setCustomEmailSubject(e.target.value)}
                              placeholder="e.g. {{name}}, your Bergman code is here"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Custom HTML Email</Label>
                            <Textarea
                              value={customEmailHtml}
                              onChange={(e) => setCustomEmailHtml(e.target.value)}
                              placeholder="<html><body><h2>Hello {{name}}</h2><p>Your personal code: {{discountCode}}</p><p>Promo code for followers: {{unique_code}}</p></body></html>"
                              rows={12}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">WhatsApp Campaign Name</Label>
                            <Input
                              value={customWhatsappCampaignName}
                              onChange={(e) => setCustomWhatsappCampaignName(e.target.value)}
                              placeholder="e.g. influencer_custom_campaign"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">WhatsApp Template Params (one per line)</Label>
                            <Textarea
                              value={customWhatsappParamsText}
                              onChange={(e) => setCustomWhatsappParamsText(e.target.value)}
                              placeholder={"{{name}}\n{{eventName}}\n{{unique_code}}"}
                              rows={8}
                            />
                            <p className="text-xs text-muted-foreground">If empty, default params are: name, eventName, discountCode. Use {'{{unique_code}}'} when sharing the public promo code with followers.</p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={() => handleSendCustomCampaign(true)} disabled={isSendingCustomCampaign !== null}>
                          {isSendingCustomCampaign === 'test' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                          Test Send
                        </Button>
                        <Button type="button" onClick={() => handleSendCustomCampaign(false)} disabled={isSendingCustomCampaign !== null}>
                          {isSendingCustomCampaign === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                          Send Campaign
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="discount" className="mt-4 space-y-4">
                  <Card className="border-dashed bg-muted/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><Award className="h-4 w-4 text-primary" /> Influencer Discount Coupons</CardTitle>
                      <CardDescription>
                        Generate public coupon codes in format <span className="font-semibold">BM- + first 4 letters of influencer name + random 2 digits</span>. These coupons are auto-created when an influencer becomes active and can be used by anyone until expiry.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-left">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Discount Percentage</Label>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={couponDiscountPercent}
                            onChange={(e) => setCouponDiscountPercent(Math.max(1, Math.min(100, Number(e.target.value) || 35)))}
                            className="w-36"
                          />
                        </div>

                        <div className="flex items-end">
                          <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                            <Checkbox
                              id="regenerate-existing-coupons"
                              checked={regenerateExistingCoupons}
                              onCheckedChange={(checked) => setRegenerateExistingCoupons(checked === true)}
                            />
                            <Label htmlFor="regenerate-existing-coupons" className="text-sm font-medium">Regenerate existing coupon codes</Label>
                          </div>
                        </div>

                        <div className="flex items-end">
                          <Button type="button" onClick={handleGenerateInfluencerCoupons} disabled={isGeneratingCoupons || influencers.length === 0}>
                            {isGeneratingCoupons ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Award className="mr-2 h-4 w-4" />}
                            Generate Coupons
                          </Button>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        The 35% influencer code stays reserved for the selected influencer only. The BM promo code below is separate and meant for friends, followers, and community registrations. Promo coupons are stored in KV, can be used by anyone, and stay valid for unlimited uses until 45 days before the selected event date.
                      </p>

                      {couponGenerationSummary ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant="outline">Generated: {couponGenerationSummary.generated}</Badge>
                          <Badge variant="secondary">Skipped: {couponGenerationSummary.skipped}</Badge>
                          <Badge variant={couponGenerationSummary.failed > 0 ? 'destructive' : 'outline'}>Failed: {couponGenerationSummary.failed}</Badge>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">Total coupons: {couponLogs.length}</Badge>
                        <Badge variant="secondary">Total uses: {couponUsageLogs.length}</Badge>
                        <Button type="button" variant="outline" size="sm" onClick={handleDownloadCouponUsageLogs} disabled={couponUsageLogs.length === 0}>
                          <Download className="mr-2 h-4 w-4" />
                          Download Usage Excel
                        </Button>
                      </div>

                      <div className="rounded-md border max-h-[50vh] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Influencer</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Coupon Code</TableHead>
                              <TableHead>Used</TableHead>
                              <TableHead>Expiry</TableHead>
                              <TableHead>Email</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {influencers.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No influencers available for this event.</TableCell>
                              </TableRow>
                            ) : (
                              influencers.map((influencer) => {
                                const log = couponLogByInfluencerId.get(influencer.id);
                                const usedText = log ? String(log.usageCount) : '0';
                                const expiryText = log?.expiryDate || '—';

                                return (
                                  <TableRow key={`discount-${influencer.id}`}>
                                    <TableCell className="font-medium">{influencer.name}</TableCell>
                                    <TableCell>
                                      {influencer.isActive === false ? <Badge variant="secondary">Inactive</Badge> : <Badge>Active</Badge>}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{influencer.publicCouponCode || '—'}</TableCell>
                                    <TableCell className="text-xs">{usedText}</TableCell>
                                    <TableCell className="text-xs">{expiryText}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{influencer.email || '—'}</TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="rounded-md border max-h-[45vh] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Influencer</TableHead>
                              <TableHead>Coupon Code</TableHead>
                              <TableHead>Participant</TableHead>
                              <TableHead>Ticket</TableHead>
                              <TableHead>Booking ID</TableHead>
                              <TableHead>Used At</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {couponUsageLogs.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No coupon usage recorded yet.</TableCell>
                              </TableRow>
                            ) : (
                              couponUsageLogs.map((log) => (
                                <TableRow key={log.id}>
                                  <TableCell className="font-medium">{log.influencerName || '—'}</TableCell>
                                  <TableCell className="font-mono text-xs">{log.couponCode}</TableCell>
                                  <TableCell>
                                    <div className="text-sm font-medium">{log.participantName || '—'}</div>
                                    <div className="text-xs text-muted-foreground">{log.participantEmail || '—'}</div>
                                  </TableCell>
                                  <TableCell className="text-xs">{log.ticketName || '—'}</TableCell>
                                  <TableCell className="text-xs">{log.bookingId || '—'}</TableCell>
                                  <TableCell className="text-xs">{log.usedAt ? new Date(log.usedAt).toLocaleString() : '—'}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="google-form" className="mt-4 space-y-4">
                  <Card className="border-dashed bg-muted/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-primary" /> Influencer Google Form Import</CardTitle>
                      <CardDescription>
                        Configure links in this separate tab. Responses auto-sync every 45 seconds while this tab is open.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-left">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Google Form URL</Label>
                          <Input
                            value={importConfig.formUrl}
                            onChange={(e) => {
                              setIsImportConfigDirty(true);
                              setImportConfig((prev) => ({ ...prev, formUrl: e.target.value }));
                            }}
                            placeholder="https://docs.google.com/forms/..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Google Sheet URL</Label>
                          <Input
                            value={importConfig.sheetUrl}
                            onChange={(e) => {
                              setIsImportConfigDirty(true);
                              setImportConfig((prev) => ({ ...prev, sheetUrl: e.target.value }));
                            }}
                            placeholder="https://docs.google.com/spreadsheets/..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Email Template Key or Provider Template ID (optional)</Label>
                          <Input
                            value={importConfig.emailTemplateKey}
                            onChange={(e) => {
                              setIsImportConfigDirty(true);
                              setImportConfig((prev) => ({ ...prev, emailTemplateKey: e.target.value }));
                            }}
                            placeholder="e.g. influencer_approval_email or 260"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">WhatsApp Template Key or Campaign Name (optional)</Label>
                          <Input
                            value={importConfig.whatsappTemplateKey}
                            onChange={(e) => {
                              setIsImportConfigDirty(true);
                              setImportConfig((prev) => ({ ...prev, whatsappTemplateKey: e.target.value }));
                            }}
                            placeholder="e.g. influencer_approval_whatsapp or influencer"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Default WhatsApp Number (optional)</Label>
                          <Input
                            value={importConfig.defaultWhatsappNumber}
                            onChange={(e) => {
                              setIsImportConfigDirty(true);
                              setImportConfig((prev) => ({ ...prev, defaultWhatsappNumber: e.target.value }));
                            }}
                            placeholder="+91XXXXXXXXXX"
                          />
                          <p className="text-xs text-muted-foreground">Used only for test sends when a row has no mobile number. Live import uses Google Sheet mobile.</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">Influencer Discount %</Label>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={importConfig.discountPercent}
                            onChange={(e) => {
                              setIsImportConfigDirty(true);
                              setImportConfig((prev) => ({ ...prev, discountPercent: Math.max(1, Math.min(100, Number(e.target.value) || 35)) }));
                            }}
                            placeholder="35"
                            className="w-32"
                          />
                          <p className="text-xs text-muted-foreground">Percentage off applied to coupon codes created on approval.</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" onClick={handleSaveImportConfig} disabled={isSavingImportConfig}>
                          {isSavingImportConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                          Save Links
                        </Button>
                        <Button type="button" onClick={handleLoadResponses} disabled={isLoadingResponses || isSavingImportConfig}>
                          {isLoadingResponses ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                          Fetch Form Responses
                        </Button>
                        {importConfig.formUrl ? (
                          <Button type="button" variant="ghost" asChild>
                            <a href={importConfig.formUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" /> Open Form
                            </a>
                          </Button>
                        ) : null}
                        {importConfig.sheetUrl ? (
                          <Button type="button" variant="ghost" asChild>
                            <a href={importConfig.sheetUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" /> Open Sheet
                            </a>
                          </Button>
                        ) : null}
                      </div>

                      <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{responseRows.length} total application{responseRows.length === 1 ? '' : 's'}</Badge>
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{responseRows.filter((row) => row.alreadyImported).length} approved</Badge>
                          <Badge variant="outline" className="border-yellow-400 text-yellow-700">{responseRows.filter((row) => !row.alreadyImported && !row.isRejected).length} pending</Badge>
                          <Badge variant="destructive" className="opacity-80">{responseRows.filter((row) => row.isRejected).length} rejected</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{responseRows.filter((row) => row.canImport).length} ready to import</Badge>
                          <Badge variant="outline">Auto Sync: ON</Badge>
                          <span className="text-xs">Last sync: {lastAutoSyncAt ? new Date(lastAutoSyncAt).toLocaleTimeString() : '—'}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                      <div className="text-sm text-muted-foreground whitespace-nowrap">All people who submitted the form are listed below.</div>
                      <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="search"
                          placeholder="Search by name, email..."
                          value={responseSearchTerm}
                          onChange={(e) => setResponseSearchTerm(e.target.value)}
                          className="pl-8 h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Label htmlFor="registration-filter" className="text-sm font-medium">Filter</Label>
                        <Select value={registrationFilter} onValueChange={(value) => setRegistrationFilter(value as 'all' | 'registered' | 'not-registered')}>
                          <SelectTrigger id="registration-filter" className="w-[180px]">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="registered">Registered ({registeredCount})</SelectItem>
                            <SelectItem value="not-registered">Not Registered ({notRegisteredCount})</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox id="approve-send-email" checked={sendEmailOnApprove} onCheckedChange={(checked) => setSendEmailOnApprove(checked === true)} />
                        <Label htmlFor="approve-send-email" className="text-sm font-medium">Send email</Label>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox id="approve-send-whatsapp" checked={sendWhatsappOnApprove} onCheckedChange={(checked) => setSendWhatsappOnApprove(checked === true)} />
                        <Label htmlFor="approve-send-whatsapp" className="text-sm font-medium">Send WhatsApp</Label>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleSelectAllImportableResponses(selectedResponseIds.length !== responseRows.filter((row) => row.canImport).length)}
                        disabled={responseRows.filter((row) => row.canImport).length === 0}
                      >
                        {selectedResponseIds.length === responseRows.filter((row) => row.canImport).length ? 'Clear Selection' : 'Select All Importable'}
                      </Button>
                      <Button type="button" onClick={handleImportSelectedResponses} disabled={isImportingResponses || selectedResponseIds.length === 0}>
                        {isImportingResponses ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                        Approve & Create Selected ({selectedResponseIds.length})
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Select</TableHead>
                          <TableHead>Preview</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>WhatsApp</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Registered</TableHead>
                          <TableHead>Paid Amount</TableHead>
                          <TableHead>Refund To Be Made</TableHead>
                          <TableHead>Coupon</TableHead>
                          <TableHead>Missing</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResponseRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={13} className="py-10 text-center text-muted-foreground">No form responses match the selected filter.</TableCell>
                          </TableRow>
                        ) : filteredResponseRows.map((row) => {
                          const refund = getRefundBreakdown(row, importConfig.discountPercent);
                          return (
                          <TableRow key={row.id}>
                            <TableCell>
                              <Checkbox
                                checked={selectedResponseIds.includes(row.id)}
                                onCheckedChange={(checked) => handleToggleResponseSelection(row.id, checked === true)}
                                disabled={!row.canImport}
                              />
                            </TableCell>
                            <TableCell>
                              <ResponsePreviewImage photoUrl={row.photoUrl} name={row.name} />
                            </TableCell>
                            <TableCell className="font-medium">
                              <button
                                type="button"
                                className="text-left text-primary underline-offset-2 hover:underline"
                                onClick={() => setPreviewingResponse(row)}
                              >
                                {row.name || '—'}
                              </button>
                            </TableCell>
                            <TableCell>{row.title || '—'}</TableCell>
                            <TableCell className="max-w-[180px] truncate">{row.email || '—'}</TableCell>
                            <TableCell className="max-w-[140px] truncate">{row.mobile || '—'}</TableCell>
                            <TableCell>
                              {row.alreadyImported ? (
                                <Badge variant="secondary">Imported</Badge>
                              ) : row.isRejected ? (
                                <Badge variant="destructive">Rejected</Badge>
                              ) : row.canImport ? (
                                <Badge>Ready</Badge>
                              ) : (
                                <Badge variant="destructive">Needs review</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.isRegistered ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge>Registered</Badge>
                                  {row.isDiscountRefunded ? <Badge variant="secondary">Refunded</Badge> : null}
                                </div>
                              ) : (
                                <Badge variant="outline">Not Registered</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.isRegistered && refund.paidAmountPaisa > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  <span>{formatInrFromPaisa(refund.paidAmountPaisa)}</span>
                                  {row.participantCouponCode ? (
                                    <span className="font-mono text-xs text-muted-foreground">Coupon: {row.participantCouponCode}</span>
                                  ) : refund.couponDiscountPaisa > 0 ? (
                                    <span className="text-xs text-muted-foreground">Coupon: {formatInrFromPaisa(refund.couponDiscountPaisa)} off</span>
                                  ) : null}
                                  {refund.offlineDiscountPaisa > 0 ? (
                                    <span className="text-xs text-muted-foreground">Offline: {formatInrFromPaisa(refund.offlineDiscountPaisa)} off</span>
                                  ) : null}
                                </div>
                              ) : '—'}
                            </TableCell>
                            <TableCell>
                              {row.isRegistered && refund.paidAmountPaisa > 0 ? (
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium">
                                    {formatInrFromPaisa(refund.refundAmountPaisa)}
                                  </span>
                                  {refund.totalExistingDiscountPaisa > 0 ? (
                                    <span className="text-xs text-muted-foreground">
                                      {refund.resolvedInfluencerPercent}% × {formatInrFromPaisa(refund.fullPricePaisa)}
                                      {refund.couponDiscountPaisa > 0 ? ` − ${formatInrFromPaisa(refund.couponDiscountPaisa)} coupon` : ''}
                                      {refund.offlineDiscountPaisa > 0 ? ` − ${formatInrFromPaisa(refund.offlineDiscountPaisa)} offline` : ''}
                                    </span>
                                  ) : null}
                                  {!row.alreadyImported ? (
                                    <Badge variant="outline" className="w-fit">After approval</Badge>
                                  ) : row.isDiscountRefunded ? (
                                    <div className="space-y-1">
                                      <Badge variant="secondary" className="w-fit">Refunded</Badge>
                                      {row.influencerRefundAmountPaisa ? (
                                        <p className="text-xs text-muted-foreground">Amount: {formatInrFromPaisa(row.influencerRefundAmountPaisa)}</p>
                                      ) : null}
                                      {row.influencerRefundStatus ? (
                                        <p className="text-xs text-muted-foreground">Status: {row.influencerRefundStatus}</p>
                                      ) : null}
                                      {row.influencerRefundId ? (
                                        <p className="break-all font-mono text-[11px] text-muted-foreground">Refund ID: {row.influencerRefundId}</p>
                                      ) : null}
                                      {row.influencerRefundRrn ? (
                                        <p className="break-all font-mono text-[11px] text-muted-foreground">Txn Ref: {row.influencerRefundRrn}</p>
                                      ) : null}
                                      {row.influencerRefundPaymentId ? (
                                        <p className="break-all font-mono text-[11px] text-muted-foreground">Payment ID: {row.influencerRefundPaymentId}</p>
                                      ) : null}
                                      {row.influencerRefundAt ? (
                                        <p className="text-[11px] text-muted-foreground">Updated: {formatDateTime(row.influencerRefundAt)}</p>
                                      ) : null}
                                    </div>
                                  ) : refund.refundAmountPaisa <= 0 ? (
                                    <Badge variant="outline" className="w-fit">No refund due</Badge>
                                  ) : (
                                    <Badge variant="outline" className="w-fit">Pending admin refund</Badge>
                                  )}
                                </div>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.couponCode || '—'}
                            </TableCell>
                            <TableCell>
                              {row.missingFields.length > 0 ? row.missingFields.join(', ') : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setPreviewingResponse(row)}>
                                  <Eye className="mr-2 h-4 w-4" /> View
                                </Button>
                                {!row.alreadyImported ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => handleApproveSingleResponse(row.id)}
                                    disabled={!row.canImport || isImportingResponses}
                                  >
                                    Approve
                                  </Button>
                                ) : null}
                                {!row.alreadyImported ? (
                                  <Button
                                    type="button"
                                    variant={row.isRejected ? 'outline' : 'destructive'}
                                    size="sm"
                                    onClick={() => handleRejectResponse(row.id, !row.isRejected)}
                                  >
                                    {row.isRejected ? 'Undo Reject' : 'Reject'}
                                  </Button>
                                ) : null}
                                {row.alreadyImported && row.isRegistered && !row.isDiscountRefunded && refund.refundAmountPaisa > 0 ? (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button type="button" variant="destructive" size="sm" disabled={isRefundingInfluencer === row.id}>
                                        {isRefundingInfluencer === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Refund {formatInrFromPaisa(refund.refundAmountPaisa)}
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="text-left">
                                      <AlertDialogHeader className="text-left">
                                        <AlertDialogTitle className="text-left">Refund discounted paid amount?</AlertDialogTitle>
                                        <AlertDialogDescription className="text-left">
                                          This will initiate a Razorpay refund of {formatInrFromPaisa(refund.refundAmountPaisa)} ({refund.resolvedInfluencerPercent}% × {formatInrFromPaisa(refund.fullPricePaisa)}{refund.couponDiscountPaisa > 0 ? ` − ${formatInrFromPaisa(refund.couponDiscountPaisa)} coupon` : ''}{refund.offlineDiscountPaisa > 0 ? ` − ${formatInrFromPaisa(refund.offlineDiscountPaisa)} offline` : ''}). This action cannot be undone.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter className="text-left">
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => handleRefundInfluencerDiscount(row)}
                                          disabled={isRefundingInfluencer === row.id}
                                          className="bg-destructive hover:bg-destructive/90"
                                        >
                                          Confirm Refund
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        )})}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="influencers" className="mt-4 space-y-4">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Logs for {selectedEventName}</p>
                      <Badge variant="outline" className="font-bold">Total selected: {influencerStats.total}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <div className="rounded-md border bg-background p-2 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Total</p>
                        <p className="text-lg font-black">{influencerStats.total}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Active</p>
                        <p className="text-lg font-black text-emerald-600">{influencerStats.active}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Inactive</p>
                        <p className="text-lg font-black text-amber-600">{influencerStats.inactive}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Registered</p>
                        <p className="text-lg font-black text-sky-600">{influencerStats.registered}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Not Registered</p>
                        <p className="text-lg font-black text-rose-600">{influencerStats.notRegistered}</p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleAddInfluencer} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Name</Label>
                  <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Influencer name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Title / Role</Label>
                  <Input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="e.g. Elite triathlete, creator" />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Achievements</Label>
                  <Textarea value={form.achievements} onChange={(e) => setForm((prev) => ({ ...prev, achievements: e.target.value }))} placeholder="Required. Add highlights, titles, records, etc." rows={4} />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Additional Details</Label>
                  <Textarea value={form.details} onChange={(e) => setForm((prev) => ({ ...prev, details: e.target.value }))} placeholder="Optional bio, social proof, story, or any relevant details." rows={3} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Social / Website URL</Label>
                  <Input value={form.socialUrl} onChange={(e) => setForm((prev) => ({ ...prev, socialUrl: e.target.value }))} placeholder="https://instagram.com/..." />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Photo URL</Label>
                  <Input value={form.photoUrl} onChange={(e) => { setForm((prev) => ({ ...prev, photoUrl: e.target.value })); setPhotoFile(null); }} placeholder="Or paste a photo URL" />
                  <p className="text-xs text-muted-foreground">Recommended ratio: 5:6 (e.g. 800×960 or 1000×1200) for best card fit.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Upload Photo</Label>
                  <Input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoFileChange} />
                  <p className="text-xs text-muted-foreground">Use JPG/PNG/WebP, clear portrait crop, and keep file size under 4MB.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Order</Label>
                  <Input type="number" value={newOrder} onChange={(e) => setNewOrder(Number(e.target.value) || 1)} />
                </div>
                <div className="lg:col-span-2 flex justify-end">
                  <Button type="submit" disabled={isSubmitting}>
                    {isUploading || isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                    {isUploading ? 'Uploading...' : 'Add Influencer'}
                  </Button>
                </div>
                  </form>

                  <div className="flex items-center gap-2 mb-2">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="search"
                        placeholder="Search influencer by name..."
                        value={influencerSearchTerm}
                        onChange={(e) => setInfluencerSearchTerm(e.target.value)}
                        className="pl-8 h-8 text-sm"
                      />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleDownloadInfluencers} disabled={filteredInfluencers.length === 0}>
                      <Download className="mr-2 h-4 w-4" />
                      Download Influencers
                    </Button>
                    {influencerSearchTerm && (
                      <span className="text-xs text-muted-foreground">{filteredInfluencers.length} result(s)</span>
                    )}
                  </div>

                  <div className="rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Photo</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Coupon Code</TableHead>
                          <TableHead>Days to Register</TableHead>
                          <TableHead>Order</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoading ? (
                          <TableRow>
                            <TableCell colSpan={9} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell>
                          </TableRow>
                        ) : filteredInfluencers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No influencers found.</TableCell>
                          </TableRow>
                        ) : (
                          filteredInfluencers.map((influencer) => (
                            <TableRow key={influencer.id}>
                              <TableCell>
                                {isValidImageUrl(influencer.photoUrl) ? (
                                  <div className="relative h-14 w-14 overflow-hidden rounded-xl bg-gray-200">
                                    <Image src={influencer.photoUrl} alt={influencer.name} fill sizes="56px" className="object-cover object-center" />
                                  </div>
                                ) : (
                                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-200 text-[10px]">No Photo</div>
                                )}
                              </TableCell>
                              <TableCell className="font-medium">{influencer.name}</TableCell>
                              <TableCell>{influencer.title || '—'}</TableCell>
                              <TableCell>
                                {influencer.isActive === false ? <Badge variant="secondary">Inactive</Badge> : <Badge>Active</Badge>}
                              </TableCell>
                              <TableCell className="max-w-[220px]">
                                <div className="space-y-0.5 text-xs">
                                  <p className="truncate">{influencer.email || '—'}</p>
                                  <p className="truncate text-muted-foreground">{influencer.mobile || '—'}</p>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[220px]">
                                <div className="space-y-1 text-xs">
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Personal</p>
                                    <p className="font-mono">{getEffectiveInfluencerPersonalCode(influencer) || '—'}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Public</p>
                                    <p className="font-mono">{influencer.publicCouponCode || '—'}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const couponExpiry = getCouponExpiryLabel(influencer);
                                  if (couponExpiry.tone === 'expired') return <Badge variant="destructive">{couponExpiry.label}</Badge>;
                                  if (couponExpiry.tone === 'active') return <Badge variant="outline" className="border-emerald-300 text-emerald-700">{couponExpiry.label}</Badge>;
                                  return <span className="text-muted-foreground">{couponExpiry.label}</span>;
                                })()}
                              </TableCell>
                              <TableCell><Input type="number" value={influencer.order} onChange={(e) => handleOrderChange(influencer.id, Number(e.target.value) || 1)} className="w-20" /></TableCell>
                              <TableCell className="space-x-1 text-right">
                                {influencer.isActive === false ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => handleExtendRegistrationWindow(influencer.id, 5)}
                                    disabled={isExtendingInfluencerId === influencer.id}
                                  >
                                    {isExtendingInfluencerId === influencer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '+5d'}
                                  </Button>
                                ) : null}
                                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setEditingInfluencer(influencer)}><Edit className="h-4 w-4" /></Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="icon" className="h-8 w-8" disabled={isDeleting === influencer.id}><Trash2 className="h-4 w-4" /></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent className="text-left">
                                    <AlertDialogHeader className="text-left">
                                      <AlertDialogTitle className="text-left">Delete {influencer.name}?</AlertDialogTitle>
                                      <AlertDialogDescription className="text-left">This removes the influencer from the selected event page.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter className="text-left">
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteInfluencer(influencer.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={handleSaveOrder} disabled={isSubmitting}>Save Order</Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isResponsesModalOpen} onOpenChange={setIsResponsesModalOpen}>
        <DialogContent className="max-w-6xl text-left">
          <DialogHeader>
            <DialogTitle>Influencer Form Responses</DialogTitle>
            <DialogDescription>
              Review Google Sheet responses, inspect details in a modal view, and import only the influencers selected by admin.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{responseRows.length} total</Badge>
              <Badge variant="outline">{responseRows.filter((row) => row.canImport).length} importable</Badge>
              <Badge variant="outline">{responseRows.filter((row) => row.alreadyImported).length} already imported</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSelectAllImportableResponses(selectedResponseIds.length !== responseRows.filter((row) => row.canImport).length)}
                disabled={responseRows.filter((row) => row.canImport).length === 0}
              >
                {selectedResponseIds.length === responseRows.filter((row) => row.canImport).length ? 'Clear Selection' : 'Select All Importable'}
              </Button>
              <Button type="button" onClick={handleImportSelectedResponses} disabled={isImportingResponses || selectedResponseIds.length === 0}>
                {isImportingResponses ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                Approve & Create Selected ({selectedResponseIds.length})
              </Button>
            </div>
          </div>

          <ScrollArea className="max-h-[60vh] rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Select</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Paid Amount</TableHead>
                  <TableHead>Refund To Be Made</TableHead>
                  <TableHead>Coupon</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResponseRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-muted-foreground">No form responses match the selected filter.</TableCell>
                  </TableRow>
                ) : filteredResponseRows.map((row) => {
                  const refund = getRefundBreakdown(row, importConfig.discountPercent);
                  return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedResponseIds.includes(row.id)}
                        onCheckedChange={(checked) => handleToggleResponseSelection(row.id, checked === true)}
                        disabled={!row.canImport}
                      />
                    </TableCell>
                    <TableCell>
                      <ResponsePreviewImage photoUrl={row.photoUrl} name={row.name} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="text-left text-primary underline-offset-2 hover:underline"
                        onClick={() => setPreviewingResponse(row)}
                      >
                        {row.name || '—'}
                      </button>
                    </TableCell>
                    <TableCell>{row.title || '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{row.email || '—'}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{row.mobile || '—'}</TableCell>
                    <TableCell>
                      {row.alreadyImported ? (
                        <Badge variant="secondary">Imported</Badge>
                      ) : row.isRejected ? (
                        <Badge variant="destructive">Rejected</Badge>
                      ) : row.canImport ? (
                        <Badge>Ready</Badge>
                      ) : (
                        <Badge variant="destructive">Needs review</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.isRegistered ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge>Registered</Badge>
                          {row.isDiscountRefunded ? <Badge variant="secondary">Refunded</Badge> : null}
                        </div>
                      ) : <Badge variant="outline">Not Registered</Badge>}
                    </TableCell>
                    <TableCell>
                      {row.isRegistered && refund.paidAmountPaisa > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{formatInrFromPaisa(refund.paidAmountPaisa)}</span>
                          {row.participantCouponCode ? (
                            <span className="font-mono text-xs text-muted-foreground">Coupon: {row.participantCouponCode}</span>
                          ) : refund.couponDiscountPaisa > 0 ? (
                            <span className="text-xs text-muted-foreground">Coupon: {formatInrFromPaisa(refund.couponDiscountPaisa)} off</span>
                          ) : null}
                          {refund.offlineDiscountPaisa > 0 ? (
                            <span className="text-xs text-muted-foreground">Offline: {formatInrFromPaisa(refund.offlineDiscountPaisa)} off</span>
                          ) : null}
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {row.isRegistered && refund.paidAmountPaisa > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {formatInrFromPaisa(refund.refundAmountPaisa)}
                          </span>
                          {refund.totalExistingDiscountPaisa > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {refund.resolvedInfluencerPercent}% × {formatInrFromPaisa(refund.fullPricePaisa)}
                              {refund.couponDiscountPaisa > 0 ? ` − ${formatInrFromPaisa(refund.couponDiscountPaisa)} coupon` : ''}
                              {refund.offlineDiscountPaisa > 0 ? ` − ${formatInrFromPaisa(refund.offlineDiscountPaisa)} offline` : ''}
                            </span>
                          ) : null}
                          {!row.alreadyImported ? (
                            <Badge variant="outline" className="w-fit">After approval</Badge>
                          ) : row.isDiscountRefunded ? (
                            <div className="space-y-1">
                              <Badge variant="secondary" className="w-fit">Refunded</Badge>
                              {row.influencerRefundAmountPaisa ? (
                                <p className="text-xs text-muted-foreground">Amount: {formatInrFromPaisa(row.influencerRefundAmountPaisa)}</p>
                              ) : null}
                              {row.influencerRefundStatus ? (
                                <p className="text-xs text-muted-foreground">Status: {row.influencerRefundStatus}</p>
                              ) : null}
                              {row.influencerRefundId ? (
                                <p className="break-all font-mono text-[11px] text-muted-foreground">Refund ID: {row.influencerRefundId}</p>
                              ) : null}
                              {row.influencerRefundRrn ? (
                                <p className="break-all font-mono text-[11px] text-muted-foreground">Txn Ref: {row.influencerRefundRrn}</p>
                              ) : null}
                              {row.influencerRefundPaymentId ? (
                                <p className="break-all font-mono text-[11px] text-muted-foreground">Payment ID: {row.influencerRefundPaymentId}</p>
                              ) : null}
                              {row.influencerRefundAt ? (
                                <p className="text-[11px] text-muted-foreground">Updated: {formatDateTime(row.influencerRefundAt)}</p>
                              ) : null}
                            </div>
                          ) : refund.refundAmountPaisa <= 0 ? (
                            <Badge variant="outline" className="w-fit">No refund due</Badge>
                          ) : (
                            <Badge variant="outline" className="w-fit">Pending admin refund</Badge>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.couponCode || '—'}
                    </TableCell>
                    <TableCell>
                      {row.missingFields.length > 0 ? row.missingFields.join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setPreviewingResponse(row)}>
                          <Eye className="mr-2 h-4 w-4" /> View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewingResponse} onOpenChange={(open) => !open && setPreviewingResponse(null)}>
        <DialogContent className="max-w-3xl text-left">
          <DialogHeader>
            <DialogTitle>Influencer Form Details</DialogTitle>
            <DialogDescription>Inspect the normalized influencer data and the raw Google Sheet fields before importing.</DialogDescription>
          </DialogHeader>
          {previewingResponse ? (
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-6 py-2 text-left">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Name</p>
                    <p className="font-semibold">{previewingResponse.name || '—'}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Title / Role</p>
                    <p className="font-semibold">{previewingResponse.title || '—'}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-4 md:col-span-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Achievements</p>
                    <p className="whitespace-pre-wrap">{previewingResponse.achievements || '—'}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-4 md:col-span-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Additional Details</p>
                    <p className="whitespace-pre-wrap">{previewingResponse.details ? renderTextWithLinks(previewingResponse.details) : '—'}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Social URL</p>
                    {previewingResponse.socialUrl ? (
                      <a href={previewingResponse.socialUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary underline hover:opacity-80">
                        {previewingResponse.socialUrl}
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                  <div className="space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Photo URL</p>
                    {previewingResponse.photoUrl ? (
                      <div className="space-y-2">
                        <a href={previewingResponse.photoUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary underline hover:opacity-80">
                          {previewingResponse.photoUrl}
                        </a>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewingResponse.photoUrl}
                          alt={previewingResponse.name || 'Influencer'}
                          className="max-h-48 w-auto rounded-lg object-contain"
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                  <div className="space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Email</p>
                    <p className="break-all">{previewingResponse.email || '—'}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">WhatsApp Number</p>
                    <p className="break-all">{previewingResponse.mobile || '—'}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {previewingResponse.alreadyImported ? <Badge variant="secondary">Already Imported</Badge> : null}
                    {previewingResponse.canImport ? <Badge>Ready to Import</Badge> : <Badge variant="destructive">Needs Review</Badge>}
                    {previewingResponse.missingFields.length > 0 ? <Badge variant="outline">Missing: {previewingResponse.missingFields.join(', ')}</Badge> : null}
                  </div>

                  <div className="rounded-lg border">
                    <div className="border-b px-4 py-3">
                      <p className="text-sm font-semibold">Raw Google Sheet Fields</p>
                    </div>
                    <div className="divide-y">
                      {Object.entries(previewingResponse.rawData).map(([key, value]) => {
                        const isUrl = typeof value === 'string' && /^https?:\/\//.test(value.trim());
                        return (
                          <div key={key} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)]">
                            <p className="text-xs font-bold uppercase text-muted-foreground">{key}</p>
                            {isUrl ? (
                              <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary underline hover:opacity-80">
                                {value}
                              </a>
                            ) : (
                              <p className="break-words text-sm">{value || '—'}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingInfluencer} onOpenChange={(open) => !open && setEditingInfluencer(null)}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Edit Influencer</DialogTitle>
            <DialogDescription>Update influencer details shown on the event page.</DialogDescription>
          </DialogHeader>
          {editingInfluencer && (
            <form onSubmit={handleUpdateInfluencer} className="flex max-h-[calc(80vh-5rem)] flex-col text-left">
              <div className="space-y-4 overflow-y-auto py-4 pr-1">
                <div className="space-y-2"><Label htmlFor="edit-inf-name">Name</Label><Input id="edit-inf-name" value={editingInfluencer.name} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, name: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-title">Title / Role</Label><Input id="edit-inf-title" value={editingInfluencer.title || ''} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, title: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-achievements">Achievements</Label><Textarea id="edit-inf-achievements" rows={4} value={editingInfluencer.achievements} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, achievements: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-details">Additional Details</Label><Textarea id="edit-inf-details" rows={3} value={editingInfluencer.details || ''} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, details: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-social">Social / Website URL</Label><Input id="edit-inf-social" value={editingInfluencer.socialUrl || ''} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, socialUrl: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-photo">Photo URL</Label><Input id="edit-inf-photo" value={editingInfluencer.photoUrl} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, photoUrl: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-email">Email</Label><Input id="edit-inf-email" value={editingInfluencer.email || ''} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, email: e.target.value }) : null)} /></div>
                <div className="space-y-2"><Label htmlFor="edit-inf-mobile">WhatsApp Number</Label><Input id="edit-inf-mobile" value={editingInfluencer.mobile || ''} onChange={(e) => setEditingInfluencer((prev) => prev ? ({ ...prev, mobile: e.target.value }) : null)} /></div>
                <div className="flex items-center gap-2"><Checkbox id="edit-inf-active" checked={editingInfluencer.isActive !== false} onCheckedChange={(checked) => setEditingInfluencer((prev) => prev ? ({ ...prev, isActive: checked === true }) : null)} /><Label htmlFor="edit-inf-active">Influencer Active on Event Page</Label></div>
              </div>
              <DialogFooter className="border-t pt-3">
                <Button type="button" variant="outline" onClick={() => setEditingInfluencer(null)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
