"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const TERMS = `BERGMAN EXPO – STALL BOOKING TERMS & REGULATIONS

1. Booking Confirmation
• Stall bookings are confirmed only after full payment is successfully received.
• Submission of a booking request does not guarantee stall allocation.
• Bergman Events reserves the right to accept or reject any booking application.
• The organizer may request additional business documents before confirming a booking.

2. Stall Allocation
• Stalls are allotted on a first-come, first-served basis.
• Online stall selection is subject to real-time availability.
• Once a stall is booked and payment is completed, it cannot be changed without organizer approval.
• Bergman Events reserves the right to relocate exhibitors if required for operational or safety reasons.

3. Payment Policy
• Full payment must be completed during the booking process.
• Supported payment methods: Razorpay (INR) and Stripe (USD).
• Applicable GST and taxes will be added where required.
• An invoice will be generated automatically after successful payment.
• Prices displayed are exclusive of applicable taxes unless otherwise stated.

4. Cancellation & Refund Policy
Cancellation charges:
• More than 90 Days before expo: 75% Refund
• 60–89 Days before expo: 50% Refund
• 30–59 Days before expo: 25% Refund
• Less than 30 Days before expo: No Refund
Processing charges, taxes, and payment gateway fees are non-refundable. No refunds for no-shows.

5. Stall Transfer
• Stall transfers are not permitted without written approval from Bergman Events.
• Subletting or sharing stalls with another company is strictly prohibited.
• Unauthorized transfers may result in cancellation without refund.

6. Booth Usage
Exhibitors may only display products or services approved during registration. The following are strictly prohibited: counterfeit or illegal products, offensive material, political or religious campaigning, hazardous materials, open flames, fireworks, dangerous chemicals, excessive noise, activities obstructing aisles or emergency exits.

7. Booth Setup
• Setup must be completed within the allocated move-in schedule.
• All decorations must remain within allocated stall boundaries.
• Damage to venue property will be charged to the exhibitor.
• Booth dismantling before official closing time is not permitted.

8. Electricity & Equipment
• Standard power supply included (if applicable).
• Additional electrical requirements must be booked in advance.
• Only certified electrical equipment may be used.
• Unauthorized generators or wiring are prohibited.

9. Internet & Audio
• Venue Wi-Fi may be available but is not guaranteed for business-critical activities.
• High-volume music, loudspeakers, or microphones may only be used with organizer approval.

10. Staff Passes
• Staff passes will be issued according to the booked package.
• Passes are non-transferable.
• Every staff member must display their badge while inside the expo.

11. Security
• Exhibitors are responsible for securing their own products, equipment, cash, and valuables.
• Bergman Events is not liable for theft, loss, or damage to exhibitor property.

12. Insurance
Exhibitors are encouraged to arrange their own insurance covering: Products, Equipment, Public Liability, Third-Party Liability, and Staff.

13. Health & Safety
All exhibitors must comply with venue safety regulations. Emergency exits, fire extinguishers, and access routes must remain unobstructed at all times.

14. Cleaning
• Common areas will be cleaned by the organizer.
• Exhibitors are responsible for maintaining cleanliness within their allocated booth.

15. Promotional Activities
Exhibitors may display banners, distribute brochures, demonstrate products, and conduct customer engagement activities only within their allocated stall.

16. Food & Beverage
Only authorized food exhibitors may distribute or sell food and beverages. Food sampling must comply with applicable health and safety regulations.

17. Intellectual Property
Exhibitors are solely responsible for ensuring they have the legal rights to display, market, and sell all products, trademarks, logos, and promotional materials.

18. Photography & Media
By participating, exhibitors grant Bergman Events permission to use photographs and videos taken at the event for marketing purposes without additional compensation.

19. Force Majeure
Bergman Events shall not be liable for cancellation or interruption due to circumstances beyond its reasonable control, including natural disasters, government restrictions, public health emergencies, war, civil unrest, venue closures, or power failures.

20. Organizer Rights
Bergman Events reserves the right to refuse or cancel any booking, reallocate stalls, remove exhibits violating these rules, remove exhibitors engaging in unsafe or illegal conduct, and modify the exhibition layout when necessary.

21. Acceptance of Terms
By submitting a booking and completing payment, the exhibitor acknowledges that they have read, understood, and agreed to all Bergman Expo Stall Booking Terms & Regulations and agree to comply with all organizer instructions before, during, and after the event.`;

export default function ExpoBookingPage() {
  const params = useParams<{ expoId: string; stallId: string }>();
  const expoId = String(params?.expoId || '').trim();
  const stallId = String(params?.stallId || '').trim();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [expo, setExpo] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [stallTypes, setStallTypes] = useState<any[]>([]);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [logoUploadFile, setLogoUploadFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [form, setForm] = useState({
    companyName: '',
    brandName: '',
    contactPerson: '',
    email: '',
    phone: '',
    gstNumber: '',
    country: 'India',
    address: '',
    website: '',
    instagram: '',
    businessCategory: '',
    productsServices: '',
    stallTypeId: '',
    logoUrl: '',
  });

  useEffect(() => {
    if (!expoId) return;
    let isMounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/expo/public/${encodeURIComponent(expoId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load expo');
        if (!isMounted) return;
        setExpo(payload.expo || null);
        setEvent(payload.event || null);
        setStallTypes(Array.isArray(payload.stallTypes) ? payload.stallTypes : []);
        const found = Array.isArray(payload.stalls)
          ? payload.stalls.find((s: any) => String(s.id) === stallId)
          : null;
        setStall(found || null);
        if (found) setForm((c) => ({ ...c, stallTypeId: String(found.stallTypeId || '') }));
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Error loading stall',
          description: error instanceof Error ? error.message : 'Failed to load',
        });
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void load();
    return () => { isMounted = false; };
  }, [expoId, stallId, toast]);

  const selectedType = stallTypes.find((t) => String(t?.id || '') === form.stallTypeId) || null;

  const uploadLogo = async () => {
    if (!logoUploadFile) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', logoUploadFile);

      const response = await fetch(`/api/expo/${encodeURIComponent(expoId)}/booking-logo-upload`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to upload logo');

      setForm((c) => ({ ...c, logoUrl: String(payload?.logo?.fileUrl || '') }));
      setLogoUploadFile(null);
      toast({ title: 'Logo uploaded', description: 'Brand logo added to your booking form.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unable to upload logo',
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.companyName || !form.contactPerson || !form.email || !form.phone) {
      toast({ variant: 'destructive', title: 'Required fields missing', description: 'Company name, contact person, email and mobile are required.' });
      return;
    }
    if (!termsAgreed) {
      toast({ variant: 'destructive', title: 'Please agree to terms', description: 'You must accept the Terms & Regulations to proceed.' });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/expo/${encodeURIComponent(expoId)}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stallId,
          companyName: form.companyName,
          brandName: form.brandName,
          contactPerson: form.contactPerson,
          email: form.email,
          phone: form.phone,
          country: form.country,
          address: form.address,
          gstNumber: form.gstNumber,
          website: form.website,
          instagram: form.instagram,
          businessCategory: form.businessCategory,
          productsServices: form.productsServices,
          logoUrl: form.logoUrl,
          optionalRequirements: {},
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Reservation failed');

      if (payload?.paymentGateway === 'razorpay') {
        if (!(window as any).Razorpay) {
          throw new Error('Payment gateway not loaded. Please refresh and try again.');
        }

        const rzp = new (window as any).Razorpay({
          key: payload?.keyId,
          amount: payload?.amount,
          currency: payload?.currency,
          name: event?.eventName || expo?.expoName || 'Bergman Expo',
          description: `Expo Stall Booking #${payload?.bookingId}`,
          order_id: payload?.orderId,
          notes: payload?.notes || {},
          prefill: {
            name: form.contactPerson,
            email: form.email,
            contact: form.phone,
          },
          handler: async (rzpResponse: any) => {
            try {
              const confirmResponse = await fetch(`/api/expo/${encodeURIComponent(expoId)}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  bookingId: payload?.bookingId,
                  reservationToken: payload?.reservationToken,
                  paymentStatus: 'paid',
                  invoiceStatus: 'generated',
                  paymentGateway: 'razorpay',
                  paymentId: String(rzpResponse?.razorpay_payment_id || '').trim(),
                  razorpay_order_id: rzpResponse?.razorpay_order_id,
                  razorpay_payment_id: rzpResponse?.razorpay_payment_id,
                  razorpay_signature: rzpResponse?.razorpay_signature,
                }),
              });
              const confirmPayload = await confirmResponse.json().catch(() => null);
              if (!confirmResponse.ok || !confirmPayload?.success) {
                throw new Error(confirmPayload?.message || 'Payment captured but confirmation failed');
              }
              toast({ title: 'Booking confirmed!', description: 'Your stall payment is successful.' });
              router.push(`/expo/${expoId}?booking=success&bookingId=${encodeURIComponent(payload?.bookingId || '')}`);
            } catch (confirmError) {
              toast({
                variant: 'destructive',
                title: 'Confirmation failed',
                description: confirmError instanceof Error ? confirmError.message : 'Payment captured but confirmation failed',
              });
            }
          },
          modal: {
            ondismiss: () => {
              toast({ title: 'Payment cancelled', description: 'Your stall is still reserved for 5 minutes.' });
            },
          },
          theme: { color: '#2563eb' },
        });

        rzp.on('payment.failed', (failed: any) => {
          const reason = String(failed?.error?.description || failed?.error?.reason || 'Payment failed');
          toast({ variant: 'destructive', title: 'Payment failed', description: reason });
        });

        toast({ title: 'Stall reserved!', description: 'Your stall is locked for 5 minutes. Complete payment now.' });
        rzp.open();
        return;
      }

      if (payload?.paymentGateway === 'stripe' && payload?.checkoutUrl) {
        toast({ title: 'Stall reserved!', description: 'Redirecting to Stripe checkout…' });
        window.location.assign(String(payload.checkoutUrl));
        return;
      }

      if (payload?.paymentGateway === 'none') {
        const confirmResponse = await fetch(`/api/expo/${encodeURIComponent(expoId)}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: payload?.bookingId,
            reservationToken: payload?.reservationToken,
            paymentStatus: 'paid',
            invoiceStatus: 'generated',
            paymentGateway: 'manual',
          }),
        });
        const confirmPayload = await confirmResponse.json().catch(() => null);
        if (!confirmResponse.ok || !confirmPayload?.success) {
          throw new Error(confirmPayload?.message || 'Booking confirmation failed');
        }
        toast({ title: 'Booking confirmed!', description: 'Your stall is booked successfully.' });
        router.push(`/expo/${expoId}?booking=success&bookingId=${encodeURIComponent(payload?.bookingId || '')}`);
        return;
      }

      throw new Error('Unsupported payment gateway configuration for this expo');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reservation failed', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!stall) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Stall not found or no longer available.</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <div className="flex items-center gap-2 text-sm font-black tracking-wider text-primary">
            <Sparkles className="h-4 w-4" /> BERGMAN EXPO – Stall Booking
          </div>
          {event?.eventName ? (
            <Badge variant="secondary" className="ml-auto hidden sm:flex">{event.eventName}</Badge>
          ) : null}
        </div>
      </div>

      <div className="container mx-auto grid gap-6 px-4 py-8 lg:grid-cols-[1fr_380px]">
        {/* Left: Form */}
        <div className="space-y-6">
          {/* Company Information */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
              <CardDescription>Provide your business details. These will appear on your invoice.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>Company / Brand Name <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="e.g. AeroRide Bikes Pvt Ltd"
                  value={form.companyName}
                  onChange={(e) => setForm((c) => ({ ...c, companyName: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Name of Brand (Optional)</Label>
                <Input
                  placeholder="e.g. Deccan Sports Club"
                  value={form.brandName}
                  onChange={(e) => setForm((c) => ({ ...c, brandName: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Contact Person <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="Full name"
                  value={form.contactPerson}
                  onChange={(e) => setForm((c) => ({ ...c, contactPerson: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Email Address <span className="text-destructive">*</span></Label>
                <Input
                  type="email"
                  placeholder="email@company.com"
                  value={form.email}
                  onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Mobile Number <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="+91 98765 43210"
                  value={form.phone}
                  onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Country</Label>
                <Input
                  placeholder="India"
                  value={form.country}
                  onChange={(e) => setForm((c) => ({ ...c, country: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Business Address</Label>
                <Textarea
                  placeholder="Full address for invoice"
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Upload Brand Logo (Optional)</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    onChange={(e) => setLogoUploadFile(e.target.files?.[0] || null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void uploadLogo()}
                    disabled={!logoUploadFile || uploadingLogo}
                  >
                    {uploadingLogo ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
                    ) : (
                      'Upload Logo'
                    )}
                  </Button>
                </div>
                {form.logoUrl ? (
                  <div className="rounded-md border p-2">
                    <p className="mb-2 text-xs text-muted-foreground">Uploaded logo preview</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.logoUrl} alt="Brand logo" className="h-16 w-auto rounded object-contain" />
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* GST & Invoice Details */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>GST &amp; Invoice Details</CardTitle>
              <CardDescription>Provide GST details for a business invoice. Leave blank if not applicable.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>GSTIN Number</Label>
                <Input
                  placeholder="22AAAAA0000A1Z5"
                  value={form.gstNumber}
                  onChange={(e) => setForm((c) => ({ ...c, gstNumber: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Company Website</Label>
                <Input
                  placeholder="https://www.yourcompany.com"
                  value={form.website}
                  onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Instagram Handle</Label>
                <Input
                  placeholder="@yourbrand"
                  value={form.instagram}
                  onChange={(e) => setForm((c) => ({ ...c, instagram: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Business Category</Label>
                <Input
                  placeholder="e.g. Nutrition, Apparel, Tech, Cycling"
                  value={form.businessCategory}
                  onChange={(e) => setForm((c) => ({ ...c, businessCategory: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Products / Services Description</Label>
                <Textarea
                  placeholder="Briefly describe what you will display or sell at the expo…"
                  rows={3}
                  value={form.productsServices}
                  onChange={(e) => setForm((c) => ({ ...c, productsServices: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Stall Type */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Stall Selection</CardTitle>
              <CardDescription>Your selected stall type. Change if needed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Stall Type</Label>
                <Select value={form.stallTypeId} onValueChange={(v) => setForm((c) => ({ ...c, stallTypeId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select stall type" />
                  </SelectTrigger>
                  <SelectContent>
                    {stallTypes.map((type) => (
                      <SelectItem key={type.id} value={String(type.id)}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedType?.description ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{selectedType.description}</p>
              ) : null}
            </CardContent>
          </Card>

          {/* Terms & Regulations */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Terms &amp; Regulations</CardTitle>
              <CardDescription>Please read and accept the complete terms before proceeding.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-semibold transition-colors hover:bg-muted/30"
                onClick={() => setTermsOpen((v) => !v)}
              >
                <span>Bergman Expo – Stall Booking Terms &amp; Regulations</span>
                {termsOpen
                  ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
              {termsOpen ? (
                <div className="max-h-72 overflow-y-auto rounded-lg border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {TERMS}
                </div>
              ) : null}
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <Checkbox
                  id="terms-agree"
                  checked={termsAgreed}
                  onCheckedChange={(v) => setTermsAgreed(Boolean(v))}
                  className="mt-0.5"
                />
                <label htmlFor="terms-agree" className="cursor-pointer text-sm leading-relaxed">
                  I have read, understood, and agree to all{' '}
                  <strong>Bergman Expo Stall Booking Terms &amp; Regulations</strong>. I understand that by
                  submitting this booking and completing payment, I am bound by these terms.
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Sticky Summary Sidebar */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card className="rounded-2xl border-primary/20">
            <CardHeader>
              <CardTitle className="text-base">Booking Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <div className="flex justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">Event</span>
                  <span className="text-right font-semibold">{event?.eventName || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Venue</span>
                  <span className="font-semibold">{expo?.venue || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stall</span>
                  <span className="font-semibold">#{stall.stallNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-semibold">
                    {selectedType?.name ||
                      stallTypes.find((t) => String(t?.id || '') === String(stall?.stallTypeId || ''))?.name ||
                      'General'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Size</span>
                  <span className="font-semibold">{stall.sizeLabel || `${stall.width}×${stall.height}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hall</span>
                  <span className="font-semibold">{stall.hallName || stall.hall || 'Main Hall'}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold text-muted-foreground">Stall Price</span>
                  <span className="font-black text-primary">
                    {stall.currency} {Number(stall?.price || 0).toLocaleString()}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">+ applicable GST &amp; taxes. Invoice sent after payment.</p>
              </div>

              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
                ⚡ Your stall will be <strong>locked for 5 minutes</strong> after submission. Complete payment within this window to confirm your booking.
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={() => void handleSubmit()}
                disabled={submitting || !termsAgreed}
              >
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
                ) : (
                  'Proceed to Payment →'
                )}
              </Button>

              <p className="text-center text-[11px] text-muted-foreground">
                Secure payment via Razorpay (INR) or Stripe (USD)
              </p>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
