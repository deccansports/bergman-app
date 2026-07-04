"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Copy, ExternalLink, LayoutGrid, ListChecks, Pencil, Plus, RefreshCw, Store, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type { EventCalendarEntry, ExpoRecord, ExpoStall, ExpoStallType } from '@/lib/types';

interface ExpoTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

type ExpoStatus = 'draft' | 'published' | 'closed';

type CurrencyMode = 'INR' | 'USD' | 'BOTH';

type StallStatus = 'available' | 'reserved' | 'pending_payment' | 'booked' | 'blocked' | 'cancelled' | 'refunded';

type ExpoCoupon = {
  id: string;
  expoId: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  usageLimit: number;
  usageCount: number;
  isActive: boolean;
  startDate?: string | null;
  expiryDate?: string | null;
  minCartValue?: number | null;
  stallIds?: string[];
  stallTypeIds?: string[];
};

const DEFAULT_EXPO_FORM = {
  eventId: '',
  expoName: '',
  venue: '',
  hallName: '',
  expoStartDate: '',
  expoEndDate: '',
  bookingOpensAt: '',
  bookingClosesAt: '',
  currencyMode: 'INR' as CurrencyMode,
  paymentGateway: 'razorpay',
  invoiceProvider: 'zoho_invoice',
  status: 'draft' as ExpoStatus,
};

const EMPTY_DASHBOARD = {
  totalStalls: 0,
  availableStalls: 0,
  reservedStalls: 0,
  bookedStalls: 0,
  pendingPayments: 0,
  revenueCollected: 0,
  expectedRevenue: 0,
  exhibitorsCount: 0,
};

type ExpoBookingRow = {
  id: string;
  bookingId: string;
  stallId: string;
  stallNumber: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  status: string;
  paymentStatus: string;
  createdAt?: any;
  updatedAt?: any;
};

function toDisplayDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toLocaleString();
    return value;
  }
  if (typeof value === 'number') return new Date(value).toLocaleString();
  if (typeof value === 'object') {
    const seconds = Number(value?.seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(seconds * 1000).toLocaleString();
    }
  }
  return '—';
}

function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'published') return <Badge className="bg-emerald-600">Published</Badge>;
  if (normalized === 'closed') return <Badge variant="destructive">Closed</Badge>;
  return <Badge variant="secondary">Draft</Badge>;
}

export default function ExpoTab({ events, isLoadingEvents }: ExpoTabProps) {
  const { toast } = useToast();

  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);

  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [expos, setExpos] = useState<ExpoRecord[]>([]);
  const [selectedExpoId, setSelectedExpoId] = useState<string>('');
  const [editingExpoId, setEditingExpoId] = useState<string>('');

  const [expoForm, setExpoForm] = useState(DEFAULT_EXPO_FORM);

  const [layoutFileName, setLayoutFileName] = useState('');
  const [layoutFileUrl, setLayoutFileUrl] = useState('');
  const [layoutFileType, setLayoutFileType] = useState<'png' | 'jpg' | 'jpeg' | 'pdf'>('png');
  const [layoutUploadFile, setLayoutUploadFile] = useState<File | null>(null);

  const [stallTypeForm, setStallTypeForm] = useState({
    name: '',
    width: '10',
    height: '10',
    currency: 'INR' as 'INR' | 'USD',
    price: '0',
    electricityIncluded: false,
    furnitureIncluded: false,
    internetIncluded: false,
    description: '',
  });
  const [editingStallTypeId, setEditingStallTypeId] = useState<string>('');

  const [stallTypes, setStallTypes] = useState<ExpoStallType[]>([]);

  const [stallForm, setStallForm] = useState({
    stallNumber: '',
    stallTypeId: '',
    sizeLabel: '',
    price: '0',
    currency: 'INR' as 'INR' | 'USD',
    status: 'available' as StallStatus,
    x: '0',
    y: '0',
    width: '10',
    height: '10',
    rotation: '0',
    notes: '',
  });

  const [stalls, setStalls] = useState<ExpoStall[]>([]);
  const [coupons, setCoupons] = useState<ExpoCoupon[]>([]);
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false);

  const [couponForm, setCouponForm] = useState({
    code: '',
    discountType: 'percentage' as 'percentage' | 'fixed',
    discountValue: '0',
    usageLimit: '1',
    minCartValue: '',
    startDate: '',
    expiryDate: '',
    isActive: true,
  });
  const [editingCouponId, setEditingCouponId] = useState<string>('');
  const [bookings, setBookings] = useState<ExpoBookingRow[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);
  const [activeExpoTab, setActiveExpoTab] = useState<'setup' | 'bookings' | 'coupons'>('setup');

  const selectedExpo = useMemo(() => expos.find((item) => item.id === selectedExpoId) || null, [expos, selectedExpoId]);
  const publicExpoPath = selectedExpoId ? `/expo/${encodeURIComponent(selectedExpoId)}` : '';
  const publicExpoUrl = useMemo(() => {
    if (!publicExpoPath) return '';
    if (typeof window !== 'undefined') return `${window.location.origin}${publicExpoPath}`;
    const site = String(process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
    return site ? `${site}${publicExpoPath}` : publicExpoPath;
  }, [publicExpoPath]);

  const loadExpos = useCallback(async () => {
    if (!selectedEventId) {
      setExpos([]);
      setDashboard(EMPTY_DASHBOARD);
      return;
    }
    try {
      setIsBusy(true);
      const response = await fetch(`/api/expo?eventId=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load expo module');

      setExpos(Array.isArray(payload?.expos) ? payload.expos : []);
      setDashboard({ ...EMPTY_DASHBOARD, ...(payload?.dashboard || {}) });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Expo load failed',
        description: error instanceof Error ? error.message : 'Unable to load expos',
      });
    } finally {
      setIsBusy(false);
    }
  }, [selectedEventId, toast]);

  const loadStallTypes = useCallback(async () => {
    if (!selectedExpoId) {
      setStallTypes([]);
      return;
    }
    const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/stall-types`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success) {
      setStallTypes(Array.isArray(payload?.stallTypes) ? payload.stallTypes : []);
    }
  }, [selectedExpoId]);

  const loadStalls = useCallback(async () => {
    if (!selectedExpoId) {
      setStalls([]);
      return;
    }
    const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/stalls`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success) {
      setStalls(Array.isArray(payload?.stalls) ? payload.stalls : []);
    }
  }, [selectedExpoId]);

  const loadCoupons = useCallback(async () => {
    if (!selectedExpoId) {
      setCoupons([]);
      return;
    }
    try {
      setIsLoadingCoupons(true);
      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/coupons`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load coupons');
      setCoupons(Array.isArray(payload?.coupons) ? payload.coupons : []);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Coupons load failed', description: error instanceof Error ? error.message : 'Unable to load coupons' });
    } finally {
      setIsLoadingCoupons(false);
    }
  }, [selectedExpoId, toast]);

  const loadBookings = useCallback(async () => {
    if (!selectedExpoId) {
      setBookings([]);
      return;
    }
    try {
      setIsLoadingBookings(true);
      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/bookings`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load expo bookings');

      const successful = Array.isArray(payload?.successfulBookings) ? payload.successfulBookings : [];
      setBookings(successful as ExpoBookingRow[]);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Bookings load failed',
        description: error instanceof Error ? error.message : 'Unable to load expo bookings',
      });
    } finally {
      setIsLoadingBookings(false);
    }
  }, [selectedExpoId, toast]);

  useEffect(() => {
    if (!selectedEventId && events.length > 0) {
      setSelectedEventId(events[0].id);
      setExpoForm((current) => ({ ...current, eventId: events[0].id }));
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) return;
    setExpoForm((current) => ({ ...current, eventId: selectedEventId }));
    void loadExpos();
  }, [selectedEventId, loadExpos]);

  useEffect(() => {
    if (!selectedExpoId && expos.length > 0) {
      setSelectedExpoId(expos[0].id);
    }
  }, [selectedExpoId, expos]);

  useEffect(() => {
    void loadStallTypes();
    void loadStalls();
    void loadCoupons();
    void loadBookings();
  }, [loadStallTypes, loadStalls, loadCoupons, loadBookings]);

  const startEditExpo = (expo: ExpoRecord) => {
    setEditingExpoId(expo.id);
    setSelectedExpoId(expo.id);
    setActiveExpoTab('setup');
    setExpoForm({
      eventId: expo.eventId || selectedEventId || '',
      expoName: expo.expoName || '',
      venue: expo.venue || '',
      hallName: expo.hallName || '',
      expoStartDate: expo.expoStartDate || '',
      expoEndDate: expo.expoEndDate || '',
      bookingOpensAt: expo.bookingOpensAt || '',
      bookingClosesAt: expo.bookingClosesAt || '',
      currencyMode: (expo.currencyMode || 'INR') as CurrencyMode,
      paymentGateway: expo.paymentGateway || 'razorpay',
      invoiceProvider: expo.invoiceProvider || 'zoho_invoice',
      status: expo.status || 'draft',
    });
  };

  const cancelEditExpo = () => {
    setEditingExpoId('');
    setExpoForm({ ...DEFAULT_EXPO_FORM, eventId: selectedEventId || '' });
  };

  const createExpo = async () => {
    try {
      if (!expoForm.eventId || !expoForm.expoName.trim()) {
        toast({ variant: 'destructive', title: 'Missing fields', description: 'Event and Expo Name are required.' });
        return;
      }
      setIsBusy(true);
      const response = await fetch(editingExpoId ? `/api/expo/${encodeURIComponent(editingExpoId)}` : '/api/expo', {
        method: editingExpoId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expoForm),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || (editingExpoId ? 'Failed to update expo' : 'Failed to create expo'));

      toast({ title: editingExpoId ? 'Expo updated' : 'Expo created', description: 'Expo configuration saved.' });
      setExpoForm({ ...DEFAULT_EXPO_FORM, eventId: selectedEventId || '' });
      setEditingExpoId('');
      await loadExpos();
      if (payload?.expo?.id) setSelectedExpoId(String(payload.expo.id));
    } catch (error) {
      toast({ variant: 'destructive', title: editingExpoId ? 'Update failed' : 'Create failed', description: error instanceof Error ? error.message : editingExpoId ? 'Unable to update expo' : 'Unable to create expo' });
    } finally {
      setIsBusy(false);
    }
  };

  const updateLayout = async () => {
    if (!selectedExpoId) return;
    try {
      setIsBusy(true);
      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: {
            fileName: layoutFileName.trim() || null,
            fileUrl: layoutFileUrl.trim() || null,
            fileType: layoutFileType,
            uploadedAt: new Date().toISOString(),
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to save layout');
      toast({ title: 'Layout saved', description: 'Expo layout metadata updated.' });
      await loadExpos();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Layout save failed', description: error instanceof Error ? error.message : 'Unable to save layout' });
    } finally {
      setIsBusy(false);
    }
  };

  const uploadLayoutFile = async () => {
    if (!selectedExpoId || !layoutUploadFile) return;
    try {
      setIsBusy(true);
      const formData = new FormData();
      formData.append('file', layoutUploadFile);

      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/layout-upload`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to upload layout file');

      setLayoutFileName(String(payload?.layout?.fileName || ''));
      setLayoutFileUrl(String(payload?.layout?.fileUrl || ''));
      setLayoutFileType((String(payload?.layout?.fileType || 'png') as 'png' | 'jpg' | 'jpeg' | 'pdf'));
      setLayoutUploadFile(null);
      toast({ title: 'Layout uploaded', description: 'Layout file uploaded and saved to expoLayouts.' });
      await loadExpos();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Upload failed', description: error instanceof Error ? error.message : 'Unable to upload layout file' });
    } finally {
      setIsBusy(false);
    }
  };

  const createStallType = async () => {
    if (!selectedExpoId) return;
    try {
      setIsBusy(true);
      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/stall-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stallTypeForm,
          width: Number(stallTypeForm.width || 0),
          height: Number(stallTypeForm.height || 0),
          price: Number(stallTypeForm.price || 0),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to create stall type');

      toast({ title: 'Stall type added', description: `${stallTypeForm.name} created.` });
      setStallTypeForm({
        name: '',
        width: '10',
        height: '10',
        currency: 'INR',
        price: '0',
        electricityIncluded: false,
        furnitureIncluded: false,
        internetIncluded: false,
        description: '',
      });
      setEditingStallTypeId('');
      await loadStallTypes();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Create failed', description: error instanceof Error ? error.message : 'Unable to create stall type' });
    } finally {
      setIsBusy(false);
    }
  };

  const startEditStallType = (type: ExpoStallType) => {
    setEditingStallTypeId(type.id);
    setStallTypeForm({
      name: String(type?.name || ''),
      width: String(type?.width ?? '10'),
      height: String(type?.height ?? '10'),
      currency: (String(type?.currency || 'INR') as 'INR' | 'USD'),
      price: String(type?.price ?? '0'),
      electricityIncluded: !!type?.electricityIncluded,
      furnitureIncluded: !!type?.furnitureIncluded,
      internetIncluded: !!type?.internetIncluded,
      description: String(type?.description || ''),
    });
  };

  const cancelEditStallType = () => {
    setEditingStallTypeId('');
    setStallTypeForm({
      name: '',
      width: '10',
      height: '10',
      currency: 'INR',
      price: '0',
      electricityIncluded: false,
      furnitureIncluded: false,
      internetIncluded: false,
      description: '',
    });
  };

  const updateStallType = async () => {
    if (!selectedExpoId || !editingStallTypeId) return;
    try {
      setIsBusy(true);
      const response = await fetch(
        `/api/expo/${encodeURIComponent(selectedExpoId)}/stall-types/${encodeURIComponent(editingStallTypeId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: stallTypeForm.name,
            width: Number(stallTypeForm.width || 0),
            height: Number(stallTypeForm.height || 0),
            currency: stallTypeForm.currency,
            price: Number(stallTypeForm.price || 0),
            electricityIncluded: !!stallTypeForm.electricityIncluded,
            furnitureIncluded: !!stallTypeForm.furnitureIncluded,
            internetIncluded: !!stallTypeForm.internetIncluded,
            description: stallTypeForm.description || null,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to update stall type');

      toast({ title: 'Stall type updated', description: `${stallTypeForm.name} updated.` });
      cancelEditStallType();
      await loadStallTypes();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Update failed', description: error instanceof Error ? error.message : 'Unable to update stall type' });
    } finally {
      setIsBusy(false);
    }
  };

  const deleteStallType = async (stallTypeId: string, stallTypeName: string) => {
    if (!selectedExpoId || !stallTypeId) return;
    const confirmed = window.confirm(`Delete stall type "${stallTypeName}"?`);
    if (!confirmed) return;

    try {
      setIsBusy(true);
      const response = await fetch(
        `/api/expo/${encodeURIComponent(selectedExpoId)}/stall-types/${encodeURIComponent(stallTypeId)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to delete stall type');

      if (editingStallTypeId === stallTypeId) cancelEditStallType();
      toast({ title: 'Stall type deleted', description: `${stallTypeName} removed.` });
      await loadStallTypes();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error instanceof Error ? error.message : 'Unable to delete stall type' });
    } finally {
      setIsBusy(false);
    }
  };

  const startEditCoupon = (coupon: ExpoCoupon) => {
    setEditingCouponId(coupon.id);
    setActiveExpoTab('coupons');
    setCouponForm({
      code: coupon.code || '',
      discountType: coupon.discountType || 'percentage',
      discountValue: String(coupon.discountValue ?? 0),
      usageLimit: String(coupon.usageLimit ?? 1),
      minCartValue: coupon.minCartValue == null ? '' : String(coupon.minCartValue),
      startDate: coupon.startDate || '',
      expiryDate: coupon.expiryDate || '',
      isActive: !!coupon.isActive,
    });
  };

  const cancelEditCoupon = () => {
    setEditingCouponId('');
    setCouponForm({
      code: '',
      discountType: 'percentage',
      discountValue: '0',
      usageLimit: '1',
      minCartValue: '',
      startDate: '',
      expiryDate: '',
      isActive: true,
    });
  };

  const saveCoupon = async () => {
    if (!selectedExpoId) return;
    try {
      setIsBusy(true);
      const response = await fetch(
        editingCouponId
          ? `/api/expo/${encodeURIComponent(selectedExpoId)}/coupons/${encodeURIComponent(editingCouponId)}`
          : `/api/expo/${encodeURIComponent(selectedExpoId)}/coupons`,
        {
          method: editingCouponId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: couponForm.code,
            discountType: couponForm.discountType,
            discountValue: Number(couponForm.discountValue || 0),
            usageLimit: Number(couponForm.usageLimit || 1),
            minCartValue: couponForm.minCartValue === '' ? null : Number(couponForm.minCartValue),
            startDate: couponForm.startDate || null,
            expiryDate: couponForm.expiryDate || null,
            isActive: couponForm.isActive,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || (editingCouponId ? 'Failed to update coupon' : 'Failed to create coupon'));

      toast({ title: editingCouponId ? 'Coupon updated' : 'Coupon created', description: `${String(couponForm.code || '').toUpperCase()} saved.` });
      cancelEditCoupon();
      await loadCoupons();
    } catch (error) {
      toast({ variant: 'destructive', title: editingCouponId ? 'Coupon update failed' : 'Coupon create failed', description: error instanceof Error ? error.message : 'Unable to save coupon' });
    } finally {
      setIsBusy(false);
    }
  };

  const deleteCoupon = async (couponId: string, code: string) => {
    if (!selectedExpoId) return;
    const confirmed = window.confirm(`Delete coupon ${code}?`);
    if (!confirmed) return;
    try {
      setIsBusy(true);
      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/coupons/${encodeURIComponent(couponId)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to delete coupon');
      toast({ title: 'Coupon deleted', description: `${code} removed.` });
      await loadCoupons();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error instanceof Error ? error.message : 'Unable to delete coupon' });
    } finally {
      setIsBusy(false);
    }
  };

  const createStall = async () => {
    if (!selectedExpoId) return;
    try {
      setIsBusy(true);
      const response = await fetch(`/api/expo/${encodeURIComponent(selectedExpoId)}/stalls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stallNumber: stallForm.stallNumber,
          stallTypeId: stallForm.stallTypeId || null,
          sizeLabel: stallForm.sizeLabel || null,
          price: Number(stallForm.price || 0),
          currency: stallForm.currency,
          status: stallForm.status,
          position: { x: Number(stallForm.x || 0), y: Number(stallForm.y || 0) },
          width: Number(stallForm.width || 10),
          height: Number(stallForm.height || 10),
          rotation: Number(stallForm.rotation || 0),
          notes: stallForm.notes || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to create stall');

      toast({ title: 'Stall added', description: `Stall ${stallForm.stallNumber} created.` });
      setStallForm({
        stallNumber: '',
        stallTypeId: '',
        sizeLabel: '',
        price: '0',
        currency: 'INR',
        status: 'available',
        x: '0',
        y: '0',
        width: '10',
        height: '10',
        rotation: '0',
        notes: '',
      });
      await Promise.all([loadStalls(), loadExpos()]);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Create failed', description: error instanceof Error ? error.message : 'Unable to create stall' });
    } finally {
      setIsBusy(false);
    }
  };

  const copyExpoLink = async () => {
    if (!publicExpoUrl) return;
    try {
      await navigator.clipboard.writeText(publicExpoUrl);
      toast({ title: 'Link copied', description: 'Public expo booking link copied to clipboard.' });
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Unable to copy expo link.' });
    }
  };

  const statusColor = (status: string) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'available') return 'bg-emerald-600';
    if (normalized === 'reserved') return 'bg-blue-600';
    if (normalized === 'pending_payment') return 'bg-orange-500';
    if (normalized === 'booked') return 'bg-red-600';
    if (normalized === 'blocked') return 'bg-slate-500';
    if (normalized === 'cancelled') return 'bg-zinc-600';
    if (normalized === 'refunded') return 'bg-purple-600';
    return 'bg-slate-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-black tracking-tight">Expo Stalls</h2>
          <p className="text-sm text-muted-foreground">End-to-end expo booking and stall operations module.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedEventId || ''} onValueChange={setSelectedEventId}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder={isLoadingEvents ? 'Loading events...' : 'Select Event'} />
            </SelectTrigger>
            <SelectContent>
              {(events || []).map((event) => (
                <SelectItem key={event.id} value={event.id}>{event.eventName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void loadExpos()} disabled={isBusy || !selectedEventId}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total Stalls</CardDescription><CardTitle>{dashboard.totalStalls}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Available</CardDescription><CardTitle>{dashboard.availableStalls}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Reserved</CardDescription><CardTitle>{dashboard.reservedStalls}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Booked</CardDescription><CardTitle>{dashboard.bookedStalls}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Pending Payments</CardDescription><CardTitle>{dashboard.pendingPayments}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Revenue Collected</CardDescription><CardTitle>{dashboard.revenueCollected.toLocaleString()}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Expected Revenue</CardDescription><CardTitle>{dashboard.expectedRevenue.toLocaleString()}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Exhibitors</CardDescription><CardTitle>{dashboard.exhibitorsCount}</CardTitle></CardHeader></Card>
      </div>

      <Tabs value={activeExpoTab} onValueChange={(value) => setActiveExpoTab(value as 'setup' | 'bookings' | 'coupons')}>
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="setup">Expo Setup</TabsTrigger>
          <TabsTrigger value="bookings">Expo Bookings</TabsTrigger>
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-6 mt-4">

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Create Expo</CardTitle>
            <CardDescription>Link expo to an existing event and publish booking settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Expo Name</Label><Input value={expoForm.expoName} onChange={(e) => setExpoForm((c) => ({ ...c, expoName: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Venue</Label><Input value={expoForm.venue} onChange={(e) => setExpoForm((c) => ({ ...c, venue: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Hall Name</Label><Input value={expoForm.hallName} onChange={(e) => setExpoForm((c) => ({ ...c, hallName: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Status</Label>
                <Select value={expoForm.status} onValueChange={(value) => setExpoForm((c) => ({ ...c, status: value as ExpoStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Expo Start</Label><Input type="date" value={expoForm.expoStartDate} onChange={(e) => setExpoForm((c) => ({ ...c, expoStartDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Expo End</Label><Input type="date" value={expoForm.expoEndDate} onChange={(e) => setExpoForm((c) => ({ ...c, expoEndDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Booking Opens</Label><Input type="datetime-local" value={expoForm.bookingOpensAt} onChange={(e) => setExpoForm((c) => ({ ...c, bookingOpensAt: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Booking Closes</Label><Input type="datetime-local" value={expoForm.bookingClosesAt} onChange={(e) => setExpoForm((c) => ({ ...c, bookingClosesAt: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Currency</Label>
                <Select value={expoForm.currencyMode} onValueChange={(value) => setExpoForm((c) => ({ ...c, currencyMode: value as CurrencyMode }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="BOTH">BOTH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Payment Gateway</Label><Input value={expoForm.paymentGateway} onChange={(e) => setExpoForm((c) => ({ ...c, paymentGateway: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Invoice Provider</Label><Input value={expoForm.invoiceProvider} onChange={(e) => setExpoForm((c) => ({ ...c, invoiceProvider: e.target.value }))} /></div>
            </div>
            <Button onClick={() => void createExpo()} disabled={isBusy || !selectedEventId}>
              <Plus className="mr-2 h-4 w-4" /> {editingExpoId ? 'Save Changes' : 'Create Expo'}
            </Button>
            {editingExpoId ? (
              <Button variant="outline" onClick={cancelEditExpo} disabled={isBusy}>
                Cancel Edit
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Store className="h-4 w-4" /> Expos</CardTitle>
            <CardDescription>Select an expo to configure layout, stall types and stalls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {expos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expos found for this event.</p>
            ) : (
              <div className="space-y-2">
                {expos.map((expo) => (
                  <div
                    key={expo.id}
                    className={`w-full cursor-pointer rounded-md border p-3 text-left transition ${selectedExpoId === expo.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                    onClick={() => setSelectedExpoId(expo.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{expo.expoName}</p>
                        <p className="text-xs text-muted-foreground">{expo.venue || 'Venue TBD'}{expo.hallName ? ` · ${expo.hallName}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={expo.status} />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={(e) => { e.stopPropagation(); startEditExpo(expo); }}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedExpoId ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Public Expo Page Link</p>
                <Input value={publicExpoUrl} readOnly />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open(publicExpoPath, '_blank', 'noopener,noreferrer')}
                    disabled={!publicExpoPath}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" /> Open Link
                  </Button>
                  <Button variant="outline" onClick={() => void copyExpoLink()} disabled={!publicExpoUrl}>
                    <Copy className="mr-2 h-4 w-4" /> Copy Link
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Expo Layout</CardTitle>
          <CardDescription>Upload floor-plan file (PNG/JPG/PDF) or save an external URL.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-4">
            <Label>Upload Layout File</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="file"
                accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                onChange={(e) => setLayoutUploadFile(e.target.files?.[0] || null)}
              />
              <Button onClick={() => void uploadLayoutFile()} disabled={!selectedExpoId || isBusy || !layoutUploadFile}>
                Upload File
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">File is stored in Firebase Storage under expoLayouts and metadata is saved in Firestore.</p>
          </div>

          <div className="sm:col-span-4">
            <Separator />
          </div>

          <div className="space-y-1"><Label>File Name</Label><Input value={layoutFileName} onChange={(e) => setLayoutFileName(e.target.value)} placeholder="hall-layout-v1" /></div>
          <div className="space-y-1 sm:col-span-2"><Label>File URL</Label><Input value={layoutFileUrl} onChange={(e) => setLayoutFileUrl(e.target.value)} placeholder="https://..." /></div>
          <div className="space-y-1"><Label>Format</Label>
            <Select value={layoutFileType} onValueChange={(value) => setLayoutFileType(value as 'png' | 'jpg' | 'jpeg' | 'pdf')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="jpg">JPG</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-4">
            <Button variant="outline" onClick={() => void updateLayout()} disabled={!selectedExpoId || isBusy}>Save URL Metadata</Button>
            {selectedExpo?.layout?.fileUrl ? <p className="mt-2 text-xs text-muted-foreground">Current layout: {selectedExpo.layout.fileUrl}</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Stall Type</CardTitle>
            <CardDescription>Define unlimited stall products (Standard, Premium, Corner, Island...).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Name</Label><Input value={stallTypeForm.name} onChange={(e) => setStallTypeForm((c) => ({ ...c, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Currency</Label>
                <Select value={stallTypeForm.currency} onValueChange={(value) => setStallTypeForm((c) => ({ ...c, currency: value as 'INR' | 'USD' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Width</Label><Input type="number" value={stallTypeForm.width} onChange={(e) => setStallTypeForm((c) => ({ ...c, width: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Height</Label><Input type="number" value={stallTypeForm.height} onChange={(e) => setStallTypeForm((c) => ({ ...c, height: e.target.value }))} /></div>
              <div className="space-y-1 sm:col-span-2"><Label>Price</Label><Input type="number" value={stallTypeForm.price} onChange={(e) => setStallTypeForm((c) => ({ ...c, price: e.target.value }))} /></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stallTypeForm.electricityIncluded} onChange={(e) => setStallTypeForm((c) => ({ ...c, electricityIncluded: e.target.checked }))} /> Electricity</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stallTypeForm.furnitureIncluded} onChange={(e) => setStallTypeForm((c) => ({ ...c, furnitureIncluded: e.target.checked }))} /> Furniture</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stallTypeForm.internetIncluded} onChange={(e) => setStallTypeForm((c) => ({ ...c, internetIncluded: e.target.checked }))} /> Internet</label>
            </div>
            <div className="space-y-1"><Label>Description</Label><Input value={stallTypeForm.description} onChange={(e) => setStallTypeForm((c) => ({ ...c, description: e.target.value }))} /></div>
            <div className="flex flex-wrap items-center gap-2">
              {editingStallTypeId ? (
                <>
                  <Button onClick={() => void updateStallType()} disabled={!selectedExpoId || isBusy}><Pencil className="mr-2 h-4 w-4" /> Save Changes</Button>
                  <Button variant="outline" onClick={cancelEditStallType} disabled={isBusy}>Cancel</Button>
                </>
              ) : (
                <Button onClick={() => void createStallType()} disabled={!selectedExpoId || isBusy}><Plus className="mr-2 h-4 w-4" /> Add Stall Type</Button>
              )}
            </div>

            <Separator />
            <div className="space-y-2">
              {stallTypes.map((type) => (
                <div key={type.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{type.name}</p>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditStallType(type)} title="Edit stall type">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => void deleteStallType(type.id, String(type.name || 'Stall Type'))} title="Delete stall type">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{type.width}×{type.height} · {type.currency} {Number(type.price || 0).toLocaleString()}</p>
                </div>
              ))}
              {stallTypes.length === 0 ? <p className="text-xs text-muted-foreground">No stall types yet.</p> : null}
            </div>
          </CardContent>
        </Card>

      </div>

        </TabsContent>

        <TabsContent value="bookings" className="space-y-6 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4" /> Successful Stall Bookings</CardTitle>
                <CardDescription>
                  Shows exhibitors with successful bookings and mapped stall numbers.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => void loadBookings()} disabled={isBusy || isLoadingBookings || !selectedExpoId}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {!selectedExpoId ? (
                <p className="text-sm text-muted-foreground">Select an expo to view bookings.</p>
              ) : isLoadingBookings ? (
                <p className="text-sm text-muted-foreground">Loading bookings...</p>
              ) : bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No successful stall bookings yet.</p>
              ) : (
                <div className="space-y-2 max-h-[540px] overflow-auto pr-1">
                  {bookings.map((booking) => (
                    <div key={booking.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">{booking.companyName || 'Unnamed Company'}</p>
                          <p className="text-xs text-muted-foreground">
                            Stall {booking.stallNumber || booking.stallId || '—'} · Booking {booking.bookingId}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-emerald-600">{booking.status || 'paid'}</Badge>
                          <Badge variant="secondary">Payment: {booking.paymentStatus || 'paid'}</Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Contact: {booking.contactPerson || '—'} · {booking.email || '—'} · {booking.phone || '—'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Booked on: {toDisplayDate(booking.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coupons" className="space-y-6 mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Expo Coupons</CardTitle>
                <CardDescription>Create and manage discount coupons for expo stall bookings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Coupon Code</Label>
                    <Input value={couponForm.code} onChange={(e) => setCouponForm((c) => ({ ...c, code: e.target.value }))} placeholder="SAVE10" />
                  </div>
                  <div className="space-y-1">
                    <Label>Discount Type</Label>
                    <Select value={couponForm.discountType} onValueChange={(value) => setCouponForm((c) => ({ ...c, discountType: value as 'percentage' | 'fixed' }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Discount Value</Label>
                    <Input type="number" value={couponForm.discountValue} onChange={(e) => setCouponForm((c) => ({ ...c, discountValue: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Usage Limit</Label>
                    <Input type="number" value={couponForm.usageLimit} onChange={(e) => setCouponForm((c) => ({ ...c, usageLimit: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Minimum Cart Value</Label>
                    <Input type="number" value={couponForm.minCartValue} onChange={(e) => setCouponForm((c) => ({ ...c, minCartValue: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="space-y-1">
                    <Label>Status</Label>
                    <Select value={couponForm.isActive ? 'active' : 'inactive'} onValueChange={(value) => setCouponForm((c) => ({ ...c, isActive: value === 'active' }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Start Date</Label>
                    <Input type="date" value={couponForm.startDate} onChange={(e) => setCouponForm((c) => ({ ...c, startDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Expiry Date</Label>
                    <Input type="date" value={couponForm.expiryDate} onChange={(e) => setCouponForm((c) => ({ ...c, expiryDate: e.target.value }))} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void saveCoupon()} disabled={!selectedExpoId || isBusy}>
                    <Plus className="mr-2 h-4 w-4" /> {editingCouponId ? 'Save Coupon' : 'Add Coupon'}
                  </Button>
                  {editingCouponId ? (
                    <Button variant="outline" onClick={cancelEditCoupon} disabled={isBusy}>Cancel Edit</Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Existing Coupons</CardTitle>
                <CardDescription>All coupons created for the selected expo.</CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedExpoId ? (
                  <p className="text-sm text-muted-foreground">Select an expo to view coupons.</p>
                ) : isLoadingCoupons ? (
                  <p className="text-sm text-muted-foreground">Loading coupons...</p>
                ) : coupons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No coupons created yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[540px] overflow-auto pr-1">
                    {coupons.map((coupon) => (
                      <div key={coupon.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-mono font-semibold">{coupon.code}</p>
                            <p className="text-xs text-muted-foreground">
                              {coupon.discountType === 'percentage' ? `${coupon.discountValue}% off` : `₹${coupon.discountValue} off`} · Used {coupon.usageCount}/{coupon.usageLimit}
                            </p>
                          </div>
                          <Badge className={coupon.isActive ? 'bg-emerald-600' : 'bg-slate-500'}>{coupon.isActive ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => startEditCoupon(coupon)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => void deleteCoupon(coupon.id, coupon.code)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
