"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Activity,
  Armchair,
  BadgeCheck,
  CircleHelp,
  FileImage,
  FileText,
  Footprints,
  Loader2,
  MapPin,
  Megaphone,
  PackageOpen,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Ticket,
  TrendingUp,
  UtensilsCrossed,
  Users,
  Wifi,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type ExpoRecord = {
  id: string;
  expoName?: string;
  venue?: string | null;
  hallName?: string | null;
  expoStartDate?: string | null;
  expoEndDate?: string | null;
  status?: string | null;
  metrics?: {
    totalStalls?: number;
    availableStalls?: number;
    bookedStalls?: number;
    reservedStalls?: number;
    exhibitorsCount?: number;
  } | null;
  layout?: {
    fileName?: string | null;
    fileUrl?: string | null;
    fileType?: 'png' | 'jpg' | 'jpeg' | 'pdf' | null;
  } | null;
};

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return 'Date TBD';
  if (start && end) return `${start} → ${end}`;
  return start || end || 'Date TBD';
}

const featureCards = [
  {
    title: 'Meet thousands of athletes',
    description: 'Connect with endurance athletes who are ready to discover new brands and gear.',
    icon: Users,
  },
  {
    title: 'Qualified business leads',
    description: 'Reach buyers, coaches, retailers, and event organisers in one high-intent venue.',
    icon: BadgeCheck,
  },
  {
    title: 'Launch new products',
    description: 'Use the expo floor to unveil collections, demos, and product experiences live.',
    icon: PackageOpen,
  },
  {
    title: 'Sell directly to visitors',
    description: 'Drive instant purchases with face-to-face brand interactions and show offers.',
    icon: TrendingUp,
  },
  {
    title: 'Increase brand awareness',
    description: 'Build visibility with premium exposure across the expo, race village, and visitors.',
    icon: Megaphone,
  },
  {
    title: 'Network with leaders',
    description: 'Meet organisers, coaches, athletes, suppliers, and industry decision makers.',
    icon: Activity,
  },
  {
    title: 'Sponsor race experiences',
    description: 'Attach your brand to on-ground race moments and memorable athlete touchpoints.',
    icon: Sparkles,
  },
  {
    title: 'Reach cycling, running & triathlon communities',
    description: 'Engage a focused audience built around performance, health, and endurance sport.',
    icon: Footprints,
  },
  {
    title: 'Thousands of footfalls',
    description: 'Benefit from strong visitor traffic across both expo days and peak race hours.',
    icon: Users,
  },
];

const amenityCards = [
  { title: 'Electricity', icon: Plug },
  { title: 'Branding Panel', icon: Store },
  { title: 'Table & Chairs', icon: Armchair },
  { title: 'Security', icon: ShieldCheck },
  { title: 'Power Backup', icon: Wifi },
  { title: 'Food & Beverages', icon: UtensilsCrossed },
];

const faqs = [
  {
    q: 'How do I book a stall?',
    a: 'Booking a stall at Bergman Expo is simple. Browse the available stalls listed on this page, select the size and location that best suits your brand, and click "Book Now". You will be taken to a secure booking form where you enter your company name, contact details, GST number (for Indian exhibitors), and choose your preferred stall type. After reviewing the full exhibitor terms and regulations and confirming your agreement, you proceed to a secure payment page. Payment can be made via Razorpay (INR) or Stripe (USD for international exhibitors). Once payment is confirmed, you instantly receive a booking confirmation email along with your GST tax invoice or payment receipt — no manual follow-up required.',
  },
  {
    q: 'Can I choose my stall location?',
    a: 'Yes, absolutely. Every stall listed on this page includes its specific hall name, zone, and position reference so you know exactly where within the expo venue your stall is located. Allocation is strictly first-come, first-served — the moment a stall is booked it is immediately marked unavailable in real time. We strongly encourage early booking to secure premium locations near main entry points, food courts, or high-footfall corridors. If you have a specific location preference or need adjacent stalls for a larger setup, contact our expo team at info@bergmantri.com before completing your online booking and we will do our best to accommodate you.',
  },
  {
    q: 'Can I book multiple stalls?',
    a: 'Yes. Multiple stall bookings are supported and are ideal for larger brands wanting to build a combined exhibition space, product showcase, or exclusive launch zone. To book multiple stalls, complete a separate booking request for each stall. Each booking will be independently confirmed with its own invoice and confirmation email. If you want adjacent stalls joined into a single open space, contact our expo management team after completing your individual bookings — we will coordinate the layout and ensure any shared partition panels or walls are handled correctly at no extra charge.',
  },
  {
    q: 'Can I pay in USD and INR?',
    a: 'Bergman Expo supports both INR and USD payments, automatically set based on the event location. For events hosted in India, all stall pricing is in Indian Rupees (INR) and payments are processed securely through Razorpay — accepting all major credit and debit cards, UPI, net banking, and popular wallets. For international exhibitors or events hosted outside India, pricing is displayed in US Dollars (USD) and payments are processed through Stripe — accepting all major global cards. There are no currency mismatch fees. Your invoice or receipt will reflect the exact currency used for your booking.',
  },
  {
    q: 'Will I receive a GST invoice?',
    a: 'Yes. For exhibitors registered in India, a fully GST-compliant tax invoice is automatically generated and emailed to your registered address within minutes of successful payment. This invoice includes your company name, GSTIN, stall number, event details, total amount paid, and the applicable GST breakdown (CGST + SGST for intra-state or IGST for inter-state transactions). For international exhibitors paying in USD, a formal payment receipt is issued in lieu of a GST invoice. Should you need any amendments — such as an updated billing address or corrected GSTIN — please contact info@bergmantri.com within 48 hours of payment.',
  },
  {
    q: 'What facilities are included?',
    a: 'All Bergman Expo stalls include the following as standard: LED lighting within the stall area, one 5-amp power socket (upgradeable to 15-amp on request), one standard table, two chairs, a branded fascia name panel above your stall, and round-the-clock security across all expo halls. Premium stall types additionally include enhanced lighting rigs, multiple power outlets, extra furniture, and priority setup access on the day before the event opens. Any facilities beyond your included package — such as extra chairs, additional power points, AV equipment, or internet upgrades — can be requested through our Exhibitor Services Portal after booking at an additional cost.',
  },
];

export default function ExpoIndexPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expos, setExpos] = useState<ExpoRecord[]>([]);
  const [bookedPreviewByExpoId, setBookedPreviewByExpoId] = useState<Record<string, Array<{ id: string; displayName: string; companyName?: string | null; brandName?: string | null; logoUrl?: string | null; stallNumber?: string | null }>>>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/expo', { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load expos');

        const rows = Array.isArray(payload?.expos) ? payload.expos : [];
        const visible = rows.filter((expo: ExpoRecord) => {
          const status = String(expo?.status || '').toLowerCase();
          return status === 'published' || status === 'draft';
        });

        if (!active) return;
        setExpos(visible);
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Expo load failed',
          description: error instanceof Error ? error.message : 'Unable to load expos',
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expos;
    return expos.filter((expo) => {
      const text = [expo.expoName, expo.venue, expo.hallName, expo.expoStartDate, expo.expoEndDate, expo.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [expos, search]);

  const publishedCount = useMemo(() => expos.filter((expo) => String(expo.status || '').toLowerCase() === 'published').length, [expos]);
  const draftCount = useMemo(() => expos.filter((expo) => String(expo.status || '').toLowerCase() === 'draft').length, [expos]);

  useEffect(() => {
    let active = true;

    const loadBookedPreviews = async () => {
      try {
        const entries = await Promise.all(
          expos.map(async (expo) => {
            try {
              const response = await fetch(`/api/expo/public/${encodeURIComponent(expo.id)}`, { cache: 'no-store' });
              const payload = await response.json().catch(() => null);
              if (!response.ok || !payload?.success) return [expo.id, []] as const;
              return [expo.id, Array.isArray(payload?.bookedExhibitors) ? payload.bookedExhibitors : []] as const;
            } catch {
              return [expo.id, []] as const;
            }
          }),
        );

        if (!active) return;
        setBookedPreviewByExpoId(Object.fromEntries(entries));
      } catch {
        if (active) setBookedPreviewByExpoId({});
      }
    };

    if (expos.length > 0) void loadBookedPreviews();
    else setBookedPreviewByExpoId({});

    return () => { active = false; };
  }, [expos]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <section className="border-b bg-gradient-to-br from-blue-700 via-primary to-purple-700 text-white">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl space-y-5">
            <Badge className="bg-white/20 text-white">Expo Showcase</Badge>
            <h1 className="text-4xl font-black leading-tight md:text-5xl">Choose an Expo and Book Your Stall</h1>
            <p className="text-white/90 md:text-lg">
              Explore upcoming Bergman expo events, review stall availability, and open the booking page for the event you want to participate in.
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-white/70">Published Expos</p>
                <p className="text-2xl font-black">{publishedCount}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-white/70">Draft Expos</p>
                <p className="text-2xl font-black">{draftCount}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-white/70">Total Visible</p>
                <p className="text-2xl font-black">{expos.length}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expos, venue, hall..." />
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="py-16 text-center text-muted-foreground">
              <Store className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No expos found</p>
              <p className="text-sm">Try changing your search query.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((expo) => {
              const status = String(expo.status || '').toLowerCase();
              const isPublished = status === 'published';
              const available = Number(expo.metrics?.availableStalls || 0);
              const booked = Number(expo.metrics?.bookedStalls || 0);
              const total = Number(expo.metrics?.totalStalls || 0);

              return (
                <Card key={expo.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
                  <CardHeader className="space-y-3 border-b bg-slate-50/80">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-xl">{expo.expoName || 'Untitled Expo'}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {expo.venue || 'Venue TBD'}
                        </CardDescription>
                      </div>
                      <Badge className={isPublished ? 'bg-emerald-600' : 'bg-slate-500'}>
                        {status || 'draft'}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>{expo.hallName || 'Hall TBD'}</p>
                      <p>{formatDateRange(expo.expoStartDate, expo.expoEndDate)}</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 p-5">
                    <div className="grid grid-cols-3 gap-3 text-center text-sm">
                      <div className="rounded-xl border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-lg font-black">{total}</p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-xs text-emerald-700">Available</p>
                        <p className="text-lg font-black text-emerald-700">{available}</p>
                      </div>
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="text-xs text-red-700">Booked</p>
                        <p className="text-lg font-black text-red-700">{booked}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Ticket className="h-4 w-4 text-primary" />
                      {isPublished ? 'Open for booking' : 'Draft expo — preview only'}
                    </div>

                    <Button className="w-full" onClick={() => router.push(`/expo/${encodeURIComponent(expo.id)}`)}>
                      {isPublished ? 'View & Book Stalls' : 'Preview Expo'}
                    </Button>

                    {Array.isArray(bookedPreviewByExpoId[expo.id]) && bookedPreviewByExpoId[expo.id].length > 0 ? (
                      <div className="rounded-2xl border bg-slate-50/80 p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-black text-slate-900">Booked stalls online</p>
                            <p className="text-xs text-muted-foreground">Brand / company and logo appear once a stall is paid and confirmed.</p>
                          </div>
                          <Badge className="bg-emerald-600">Live</Badge>
                        </div>
                        <div className="space-y-2">
                          {bookedPreviewByExpoId[expo.id].slice(0, 3).map((exhibitor) => {
                            const initials = String(exhibitor?.displayName || 'E')
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0]?.toUpperCase() || '')
                              .join('') || 'E';

                            return (
                              <div key={exhibitor.id} className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2">
                                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border bg-slate-100 text-xs font-black text-slate-700">
                                  {exhibitor.logoUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={exhibitor.logoUrl} alt={exhibitor.displayName} className="h-full w-full object-cover" />
                                  ) : (
                                    initials
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-slate-900">{exhibitor.displayName}</p>
                                  <p className="truncate text-xs text-muted-foreground">Stall {exhibitor.stallNumber || '—'}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="container mx-auto space-y-6 px-4 pb-10">
        <div className="text-center">
          <h2 className="text-3xl font-black">Why Exhibit at Bergman Expo</h2>
          <p className="mt-2 text-sm text-muted-foreground">A dynamic endurance sports audience with strong footfall and brand discovery opportunities.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="group rounded-2xl border bg-white/80 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                <CardContent className="p-5">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-purple-500/15 text-primary transition-transform group-hover:scale-105">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-black text-slate-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-10">
        <Card className="rounded-2xl border bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Included Amenities</CardTitle>
            <CardDescription>Standard amenities included with all stalls. Premium stalls include additional facilities as described per stall type.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {amenityCards.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-center gap-3 rounded-xl border bg-slate-50/80 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="text-xs text-muted-foreground">Included with eligible stalls</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      {expos.some((expo) => expo?.layout?.fileUrl) ? (
        <section className="container mx-auto px-4 pb-10">
          <Card className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50/80">
              <CardTitle>View Stall Location / Expo Layout</CardTitle>
              <CardDescription>Open the file image or PDF to view stall positions and the venue plan before booking.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 p-5 md:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-white to-purple-500/5 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <MapPin className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stall location</p>
                    <p className="text-lg font-black">See the full expo map before you book</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  If the layout is available as a PDF or image, open it in a new tab to inspect stall positions, halls, entry points, and nearby footfall zones.
                </p>
              </div>
              <div className="space-y-3">
                {expos.filter((expo) => expo?.layout?.fileUrl).slice(0, 1).map((expo) => {
                  const layout = expo.layout;
                  const isPdf = String(layout?.fileType || '').toLowerCase() === 'pdf';
                  const isImage = ['png', 'jpg', 'jpeg'].includes(String(layout?.fileType || '').toLowerCase());
                  return (
                    <div key={expo.id} className="rounded-2xl border p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                          {isPdf ? <FileText className="h-5 w-5" /> : <FileImage className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-black">{expo.expoName || 'Expo Layout'}</p>
                          <p className="text-sm text-muted-foreground">{layout?.fileName || (isPdf ? 'PDF layout file' : 'Image layout file')}</p>
                        </div>
                      </div>
                      {isImage ? (
                        <div className="mt-4 overflow-hidden rounded-xl border bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={layout?.fileUrl || ''} alt={`${expo.expoName || 'Expo'} layout`} className="h-56 w-full object-cover" />
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-dashed bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                          PDF layout preview is available after opening the file.
                        </div>
                      )}
                      <Button
                        className="mt-4 w-full"
                        onClick={() => window.open(String(layout?.fileUrl || ''), '_blank', 'noopener,noreferrer')}
                      >
                        Open {isPdf ? 'PDF' : 'Layout'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="container mx-auto px-4 pb-10">
        <Card className="rounded-2xl border bg-white shadow-sm">
          <CardHeader><CardTitle>Frequently Asked Questions</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {faqs.map((faq) => (
              <div key={faq.q} className="py-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CircleHelp className="h-4 w-4 shrink-0 text-primary" />
                  {faq.q}
                </div>
                <p className="mt-2 pl-6 text-sm text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
