
// src/app/admin/dashboard/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import nextDynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Loader2, BookOpen, Bike, ShieldAlert, Server, FileText, Satellite, Database, Bug, Megaphone, ShoppingBag, Truck, MessageSquare, LineChart, Award, Trophy, IndianRupee, Warehouse, Mail, KeyRound, MessageCircleQuestion, DatabaseBackup, Repeat, Handshake, ShieldX, Tv, Map, UserPlus, FileClock, Ban, CreditCard, Users2, UtensilsCrossed, Building2, RefreshCw, Activity, Search, ClipboardList, Gift, MapPinned, HardDrive
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/context/AuthContext';
import type { EventCalendarEntry, StoreOrder } from '@/lib/types';
import { _computeCalendarEvents } from '@/lib/actions/eventActions'; 
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

// --- STATIC IMPORTS ---
import RegistrationsTab from '@/components/admin/RegistrationsTab';
import AthletesAndClubsTab from '@/components/admin/AthletesAndClubsTab';
import AthleteMergeTab from '@/components/admin/AthleteMergeTab';
import ClubMergeTab from '@/components/admin/ClubMergeTab';
import LiveTrackingHub from '@/components/admin/LiveTrackingHub';
import YearlyRecapTab from '@/components/admin/YearlyRecapTab';
import LegacyAthletesTab from '@/components/admin/LegacyAthletesTab';
import AthleteInsightsTab from '@/components/admin/AthleteInsightsTab';
import InventoryTab from '@/components/admin/InventoryTab';
import PaymentsTab from '@/components/admin/PaymentsTab';
import AccountingTab from '@/components/admin/AccountingTab';
import EmailCampaignsTab from '@/components/admin/EmailCampaignsTab';
import WhatsAppCampaignsTab from '@/components/admin/WhatsAppCampaignsTab';
import VolunteersTab from '@/components/admin/VolunteersTab';
import DeferralsTab from '@/components/admin/DeferralsTab';
import CancellationsTab from '@/components/admin/CancellationsTab';
import CategoryChangesTab from '@/components/admin/CategoryChangesTab';
import ApiKeysTab from '@/components/admin/ApiKeysTab';
import FaqsTab from '@/components/admin/FaqsTab';
import BackupTab from '@/components/admin/BackupTab';
import BikeRackAdminTab from '@/components/bikeRack/BikeRackAdminTab';
import BlacklistTab from '@/components/admin/BlacklistTab';
import FinishLedTab from '@/components/admin/FinishLedTab';
import SponsorsTab from '@/components/admin/SponsorsTab';
import WebhookHealthTab from '@/components/admin/WebhookHealthTab';
import PagesTab from '@/components/admin/PagesTab';
const BroadcastCenterTab = nextDynamic(() => import('@/components/admin/BroadcastCenterTab'), {
  ssr: false,
  loading: () => <div className="rounded-2xl border p-6 text-sm text-muted-foreground">Loading broadcast tools...</div>,
});
import EnquiriesTab from '@/components/admin/EnquiriesTab';
import DataSyncTab from '@/components/admin/DataSyncTab';
import UserDataSyncTab from '@/components/admin/UserDataSyncTab';
import LiveSyncFeedTab from '@/components/admin/LiveSyncFeedTab';

import KvAnalyticsTab from '@/components/admin/KvAnalyticsTab';
import FirestoreDebugTab from '@/components/admin/FirestoreDebugTab';
import RegistrationDebugTab from '@/components/admin/RegistrationDebugTab';
import SystemControlTab from '@/components/admin/SystemControlTab';
import AnnouncementsTab from '@/components/admin/AnnouncementsTab';
import StoreInventoryTab from '@/components/admin/StoreInventoryTab';
import StoreOrdersTab from '@/components/admin/StoreOrdersTab';
import ZohoSyncTab from '@/components/admin/ZohoSyncTab';
import PaidFoodTab from '@/components/admin/PaidFoodTab';
import ClubHistoryTab from '@/components/admin/ClubHistoryTab';
import TemplatesTab from '@/components/admin/TemplatesTab';
import GoogleFormTab from '@/components/admin/GoogleFormTab';
import FeedbackFormsTab from '@/components/admin/FeedbackFormsTab';
import BirthdayCampaignTab from '@/components/admin/BirthdayCampaignTab';
import BelAdminTab from '@/components/admin/BelAdminTab';
import EventMapperProTab from '@/components/admin/EventMapperProTab';
import RacePhotosAdminTab from '@/components/admin/RacePhotosAdminTab';
import TerraMasterDriveTab from '@/components/admin/TerraMasterDriveTab';
import InfluencersTab from '@/components/admin/InfluencersTab';
import AthleteJourneyTab from '@/components/admin/AthleteJourneyTab';
import IntegrationTab from '@/components/admin/IntegrationTab';
import WaitlistTab from '@/components/admin/WaitlistTab';
import ExpoTab from '@/components/admin/ExpoTab';
import WorkWithBergmanPanel from '@/components/admin/WorkWithBergman/WorkWithBergmanPanel';

export const dynamic = "force-dynamic";

type AdminSection =
  | 'registrations' | 'pages' | 'broadcast'
  | 'athletes' | 'merge_tool' | 'volunteers' | 'deferrals' | 'cancellations'
  | 'payments' | 'inventory' | 'api_keys' | 'email_campaigns' | 'whatsapp_campaigns' | 'faqs'
  | 'backup' | 'accounting' | 'category_changes' | 'yearly_recap'
  | 'live_tracking' | 'legacy_athletes' | 'athlete_insights'
  | 'bike_racking' | 'blacklist' | 'finish_led' | 'sponsors' | 'influencers' | 'webhooks' | 'live_sync'
  | 'enquiries' | 'data_sync' | 'id_sync' | 'club_history' | 'kv_analytics' | 'firestore_debug' | 'registration_debug' | 'system_control'
  | 'announcements' | 'store_inventory' | 'store_orders' | 'zoho_sync' | 'paid_food' | 'club_merge'
  | 'templates'
  | 'integration'
  | 'work_with_bergman'
  | 'athlete_journey'
  | 'google_form_registrations'
  | 'feedback_forms'
  | 'birthday_campaign'
  | 'bel'
  | 'event_mapper_pro'
  | 'race_photos'
  | 'terramaster_drive'
  | 'waitlist'
  | 'expo';

const adminNavItems: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'accounting', label: 'Accounting', icon: IndianRupee },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'api_keys', label: 'API Keys', icon: KeyRound },
  { id: 'athlete_insights', label: 'Athlete Insights', icon: LineChart },
  { id: 'athlete_journey', label: 'Athlete Journey', icon: Activity },
  { id: 'athletes', label: 'Athletes & Clubs', icon: Users2 },
  { id: 'merge_tool', label: 'Athlete Merge Tool', icon: Repeat },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'bel', label: 'BEL', icon: Trophy },
  { id: 'birthday_campaign', label: 'Birthday Campaign', icon: Gift },
  { id: 'bike_racking', label: 'Bike Racking', icon: Bike },
  { id: 'blacklist', label: 'Blacklist', icon: ShieldX },
  { id: 'cancellations', label: 'Cancellations', icon: Ban },
  { id: 'category_changes', label: 'Category Changes', icon: Repeat },
  { id: 'club_history', label: 'Club History', icon: Building2 },
  { id: 'club_merge', label: 'Club Merge Tool', icon: Building2 },
  { id: 'data_sync', label: 'Data Sync', icon: Database },
  { id: 'deferrals', label: 'Deferrals', icon: FileClock },
  { id: 'email_campaigns', label: 'Email Campaigns', icon: Mail },
  { id: 'enquiries', label: 'Enquiries', icon: MessageCircleQuestion },
  { id: 'expo', label: 'Expo', icon: Building2 },
  { id: 'faqs', label: 'FAQs', icon: MessageCircleQuestion },
  { id: 'finish_led', label: 'Finish LED', icon: Tv },
  { id: 'google_form_registrations', label: 'Google Form Registrations', icon: ClipboardList },
  { id: 'feedback_forms', label: 'Feedback Forms', icon: MessageCircleQuestion },
  { id: 'firestore_debug', label: 'Firestore Debug', icon: Server },
  { id: 'influencers', label: 'Influencers', icon: Award },
  { id: 'inventory', label: 'Inventory', icon: Warehouse },
  { id: 'kv_analytics', label: 'KV Analytics', icon: Database },
  { id: 'legacy_athletes', label: 'Legacy Athletes', icon: Trophy },
  { id: 'broadcast', label: 'Broadcast', icon: Satellite },
  { id: 'live_sync', label: 'Live Sync Feed', icon: Activity },
  { id: 'live_tracking', label: 'Live Tracking', icon: Map },
  { id: 'event_mapper_pro', label: 'Event Mapper Pro', icon: MapPinned },
  { id: 'templates', label: 'Notification Templates', icon: Mail },
  { id: 'integration', label: 'Integration', icon: Server },
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'paid_food', label: 'Paid Food', icon: UtensilsCrossed },
  { id: 'payments', label: 'Payments', icon: IndianRupee },
  { id: 'race_photos', label: 'Race Photos', icon: MapPinned },
  { id: 'terramaster_drive', label: 'TerraMaster Drive', icon: HardDrive },
  { id: 'registration_debug', label: 'Registration Debugs', icon: Bug },
  { id: 'registrations', label: 'Registrations & Events', icon: BookOpen },
  { id: 'sponsors', label: 'Sponsors', icon: Handshake },
  { id: 'store_inventory', label: 'Store Catalog', icon: ShoppingBag },
  { id: 'store_orders', label: 'Store Orders', icon: Truck },
  { id: 'system_control', label: 'System Controls', icon: ShieldAlert },
  { id: 'id_sync', label: 'User Data Sync', icon: RefreshCw },
  { id: 'volunteers', label: 'Volunteers', icon: UserPlus },
  { id: 'waitlist', label: 'Waitlist', icon: Users2 },
  { id: 'work_with_bergman', label: 'Work With Bergman', icon: UserPlus },
  { id: 'whatsapp_campaigns', label: 'WhatsApp Campaigns', icon: MessageSquare },
  { id: 'webhooks', label: 'Webhook Health', icon: ShieldAlert },
  { id: 'yearly_recap', label: 'Yearly Recap', icon: Award },
  { id: 'zoho_sync', label: 'Zoho Sync Tool', icon: CreditCard },
];

const VIEW_ONLY_ACTION_PATTERN = /\b(edit|delete|remove|download|export|update|save)\b/i;

function shouldDisableInViewOnly(el: HTMLElement): boolean {
  const text = (el.textContent || '').trim();
  const title = (el.getAttribute('title') || '').trim();
  const ariaLabel = (el.getAttribute('aria-label') || '').trim();
  const combined = `${text} ${title} ${ariaLabel}`.trim();
  return VIEW_ONLY_ACTION_PATTERN.test(combined);
}

function applyViewOnlyActionDisables(container: HTMLElement | null) {
  if (!container) return;

  const interactive = container.querySelectorAll<HTMLElement>('button, a, [role="button"]');

  interactive.forEach((el) => {
    // Never disable tab navigation itself.
    if (el.getAttribute('role') === 'tab' || el.closest('[role="tablist"]')) return;

    if (!shouldDisableInViewOnly(el)) return;

    if (el.tagName.toLowerCase() === 'button') {
      const button = el as HTMLButtonElement;
      button.disabled = true;
      button.classList.add('opacity-50', 'cursor-not-allowed');
      button.setAttribute('data-view-only-disabled', 'true');
      return;
    }

    if (el.tagName.toLowerCase() === 'a') {
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('tabindex', '-1');
      el.classList.add('pointer-events-none', 'opacity-50', 'cursor-not-allowed');
      el.setAttribute('data-view-only-disabled', 'true');
      return;
    }

    el.classList.add('pointer-events-none', 'opacity-50', 'cursor-not-allowed');
    el.setAttribute('data-view-only-disabled', 'true');
  });
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<AdminSection>('registrations');
  const [navSearch, setNavSearch] = useState('');
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [storeNewOrderCount, setStoreNewOrderCount] = useState(0);
  const [storePendingShipCount, setStorePendingShipCount] = useState(0);
  const isMobile = useIsMobile();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');
  const hasInitializedStoreOrderWatcherRef = useRef(false);
  const seenStoreOrderIdsRef = useRef<Set<string>>(new Set());
  const storeOrderStatusRef = useRef<globalThis.Map<string, string>>(new globalThis.Map());
  const dashboardContentRef = useRef<HTMLDivElement | null>(null);

  const storeOrdersAttentionCount = storeNewOrderCount + storePendingShipCount;

  const filteredAdminNavItems = useMemo(() => {
    const sortedItems = [...adminNavItems].sort((a, b) =>
      a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })
    );

    const normalizedSearch = navSearch.trim().toLowerCase();
    if (!normalizedSearch) return sortedItems;

    return sortedItems.filter((item) =>
      item.label.toLowerCase().includes(normalizedSearch) ||
      item.id.toLowerCase().includes(normalizedSearch.replace(/\s+/g, '_'))
    );
  }, [navSearch]);

  const onSectionChange = useCallback(
    (section: AdminSection) => {
      setActiveTab(section);
      router.push(
        `/admin/dashboard?section=${section}${selectedEventId ? `&eventId=${selectedEventId}` : ''}`,
        { scroll: false }
      );
    },
    [router, selectedEventId]
  );

  useEffect(() => {
    if (!db || !currentUser?.isAdmin) return;

    const watchedStatuses = new Set(['Paid', 'Processing']);

    const handleWatchSnapshot = (snapshot: any) => {
      if (!hasInitializedStoreOrderWatcherRef.current) {
        snapshot.docs.forEach((doc: any) => {
          const data = doc.data() as StoreOrder;
          seenStoreOrderIdsRef.current.add(doc.id);
          storeOrderStatusRef.current.set(doc.id, data.status || '');
        });
        const docs = snapshot.docs.map((doc: any) => doc.data() as StoreOrder);
        setStoreNewOrderCount(docs.filter((order: StoreOrder) => order.status === 'Paid').length);
        setStorePendingShipCount(docs.filter((order: StoreOrder) => order.status === 'Processing').length);
        hasInitializedStoreOrderWatcherRef.current = true;
        return;
      }

      const docs = snapshot.docs.map((doc: any) => doc.data() as StoreOrder);
      setStoreNewOrderCount(docs.filter((order: StoreOrder) => order.status === 'Paid').length);
      setStorePendingShipCount(docs.filter((order: StoreOrder) => order.status === 'Processing').length);

      snapshot.docChanges().forEach((change: any) => {
        const docId = change.doc.id;

        if (change.type === 'removed') {
          seenStoreOrderIdsRef.current.delete(docId);
          storeOrderStatusRef.current.delete(docId);
          return;
        }

        const order = change.doc.data() as StoreOrder;
        const previousStatus = storeOrderStatusRef.current.get(docId) || '';
        const nextStatus = order.status || '';
        const wasSeen = seenStoreOrderIdsRef.current.has(docId);
        const enteredWatchedStatus = watchedStatuses.has(nextStatus) && !watchedStatuses.has(previousStatus);

        seenStoreOrderIdsRef.current.add(docId);
        storeOrderStatusRef.current.set(docId, nextStatus);

        if ((change.type === 'added' && watchedStatuses.has(nextStatus) && !wasSeen) || (change.type === 'modified' && enteredWatchedStatus)) {
          toast({
            title: '🛒 New Store Order Received!',
            description: `${order.customerName} just placed order ${order.orderId || docId.slice(-8)}.`,
            action: (
              <Button variant="outline" size="sm" onClick={() => onSectionChange('store_orders')}>
                View Order
              </Button>
            )
          });
        }
      });
    };

    const handleWatchError = (error: any) => {
      if (error?.code === 'permission-denied') {
        return;
      }
      console.error('[AdminDashboard] Store order watcher failed:', error);
    };

    const unsubscribeStoreOrders = onSnapshot(
      collection(db, 'storeOrders'),
      handleWatchSnapshot,
      handleWatchError
    );

    return () => {
      unsubscribeStoreOrders();
    };
  }, [toast, onSectionChange, currentUser?.isAdmin]);

  const fetchEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      const result = await _computeCalendarEvents();
      if (result && result.success && result.events) {
        setEvents(result.events);
        setSelectedEventId(prev => {
          if (prev) return prev;
          const fromUrl = searchParams.get('eventId');
          const list = result.events ?? [];
          if (fromUrl && list.some(e => e.id === fromUrl)) return fromUrl;
          return list[0]?.id ?? null;
        });
      } else {
        setEvents([]);
        setSelectedEventId(null);
      }
    } catch (error) {
      console.error('Failed to fetch events:', error);
      setEvents([]);
      setSelectedEventId(null);
    } finally {
      setIsLoadingEvents(false);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const rawSection = searchParams.get('section');
    const section = (rawSection === 'live_streaming' ? 'broadcast' : rawSection) as AdminSection | null;
    if (section && adminNavItems.some(item => item.id === section)) {
      setActiveTab(section);
    } else {
      setActiveTab('registrations');
    }
    const evId = searchParams.get('eventId');
    if (evId) setSelectedEventId(evId);
  }, [searchParams]);

  useEffect(() => {
    if (!isViewOnlyAdmin) return;

    const container = dashboardContentRef.current;
    if (!container) return;

    // Lightweight re-apply passes after tab/content changes.
    // Avoid MutationObserver here because it can cause excessive rescans and UI freezes.
    const t1 = window.setTimeout(() => applyViewOnlyActionDisables(container), 0);
    const t2 = window.setTimeout(() => applyViewOnlyActionDisables(container), 250);
    const t3 = window.setTimeout(() => applyViewOnlyActionDisables(container), 1000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [isViewOnlyAdmin, activeTab, selectedEventId]);
  
  const renderNav = () => {
    if (isMobile) {
      return (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="Search admin tabs..."
              className="pl-9"
            />
          </div>
          <Select value={activeTab} onValueChange={(value) => onSectionChange(value as AdminSection)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a section..." />
            </SelectTrigger>
            <SelectContent>
              {filteredAdminNavItems.length > 0 ? filteredAdminNavItems.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    {item.id === 'store_orders' && storeOrdersAttentionCount > 0 ? (
                      <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                        {storeOrdersAttentionCount}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              )) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">No matching admin tabs.</div>
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {filteredAdminNavItems.length} of {adminNavItems.length} tabs shown
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            placeholder="Search admin tabs..."
            className="pl-9"
          />
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{filteredAdminNavItems.length} of {adminNavItems.length} tabs shown</span>
          {navSearch && filteredAdminNavItems.length > 0 ? (
            <span>
              Matches: {filteredAdminNavItems.map(item => item.label).join(', ')}
            </span>
          ) : null}
        </div>

        {filteredAdminNavItems.length > 0 ? (
          <TabsList className="flex flex-wrap h-auto p-1 gap-1 bg-muted/50 rounded-xl">
            {filteredAdminNavItems.map(item => (
              <TabsTrigger key={item.id} value={item.id} className="text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <item.icon className="mr-2 h-3.5 w-3.5" />
                {item.label}
                {item.id === 'store_orders' && storeOrdersAttentionCount > 0 ? (
                  <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 text-[10px] leading-none">
                    {storeOrdersAttentionCount}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            No matching admin tabs. Try a different search.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left">
        <div className="space-y-1 text-left">
          <h1 className="text-3xl font-bold tracking-tight text-foreground text-left">Admin Dashboard</h1>
          {isViewOnlyAdmin && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 font-black uppercase text-[10px] tracking-widest">
              View Only Access
            </Badge>
          )}
        </div>
      </div>

      <Tabs
        ref={dashboardContentRef}
        value={activeTab}
        onValueChange={(value) => onSectionChange(value as AdminSection)}
        className="w-full"
      >
        {renderNav()}

        <TabsContent value="registrations" className="mt-4">
          <RegistrationsTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
        </TabsContent>

        <TabsContent value="work_with_bergman" className="mt-4">
          <WorkWithBergmanPanel />
        </TabsContent>

        <TabsContent value="zoho_sync" className="mt-4">
          <ZohoSyncTab />
        </TabsContent>

        <TabsContent value="store_inventory" className="mt-4">
          <StoreInventoryTab />
        </TabsContent>

        <TabsContent value="store_orders" className="mt-4">
          <StoreOrdersTab />
        </TabsContent>

        <TabsContent value="announcements" className="mt-4">
          <AnnouncementsTab />
        </TabsContent>
        
        <TabsContent value="system_control" className="mt-4">
          <SystemControlTab />
        </TabsContent>

        <TabsContent value="registration_debug" className="mt-4">
          <RegistrationDebugTab />
        </TabsContent>

        <TabsContent value="broadcast" className="mt-4">
          <BroadcastCenterTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>
        
        <TabsContent value="pages" className="mt-4">
          <PagesTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
        </TabsContent>

        <TabsContent value="athletes" className="mt-4">
          <AthletesAndClubsTab />
        </TabsContent>

        <TabsContent value="merge_tool" className="mt-4">
          <AthleteMergeTab />
        </TabsContent>

        <TabsContent value="club_merge" className="mt-4">
          <ClubMergeTab />
        </TabsContent>

        <TabsContent value="yearly_recap" className="mt-4">
          <YearlyRecapTab />
        </TabsContent>

        <TabsContent value="legacy_athletes" className="mt-4">
          <LegacyAthletesTab />
        </TabsContent>

        <TabsContent value="athlete_insights" className="mt-4">
          <AthleteInsightsTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="athlete_journey" className="mt-4">
          <AthleteJourneyTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="live_tracking" className="mt-4">
          <LiveTrackingHub />
        </TabsContent>

        <TabsContent value="event_mapper_pro" className="mt-4">
          <EventMapperProTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="race_photos" className="mt-4">
          <RacePhotosAdminTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
        </TabsContent>

        <TabsContent value="terramaster_drive" className="mt-4">
          <TerraMasterDriveTab />
        </TabsContent>

        <TabsContent value="finish_led" className="mt-4">
          <FinishLedTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>
        
        <TabsContent value="bike_racking" className="mt-4">
          <BikeRackAdminTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <InventoryTab />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <PaymentsTab selectedEventId={selectedEventId} />
        </TabsContent>

        <TabsContent value="accounting" className="mt-4">
          <AccountingTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="sponsors" className="mt-4">
          <SponsorsTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="influencers" className="mt-4">
          <InfluencersTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>
        
        <TabsContent value="webhooks" className="mt-4">
          <WebhookHealthTab />
        </TabsContent>

        <TabsContent value="live_sync" className="mt-4">
          <LiveSyncFeedTab />
        </TabsContent>

        <TabsContent value="data_sync" className="mt-4">
          <DataSyncTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>
        
        <TabsContent value="id_sync" className="mt-4">
          <UserDataSyncTab />
        </TabsContent>
        
        <TabsContent value="club_history" className="mt-4">
          <ClubHistoryTab />
        </TabsContent>
        
        <TabsContent value="kv_analytics" className="mt-4">
          <KvAnalyticsTab />
        </TabsContent>
        
        <TabsContent value="firestore_debug" className="mt-4">
          <FirestoreDebugTab />
        </TabsContent>

        <TabsContent value="enquiries" className="mt-4">
          <EnquiriesTab />
        </TabsContent>

        <TabsContent value="volunteers" className="mt-4">
          <VolunteersTab />
        </TabsContent>

        <TabsContent value="deferrals" className="mt-4">
          <DeferralsTab />
        </TabsContent>

        <TabsContent value="cancellations" className="mt-4">
          <CancellationsTab />
        </TabsContent>
        
        <TabsContent value="blacklist" className="mt-4">
          <BlacklistTab />
        </TabsContent>

        <TabsContent value="category_changes" className="mt-4">
          <CategoryChangesTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="api_keys" className="mt-4">
          <ApiKeysTab />
        </TabsContent>

        <TabsContent value="faqs" className="mt-4">
          <FaqsTab />
        </TabsContent>

        <TabsContent value="backup" className="mt-4">
          <BackupTab
            events={events}
            isLoadingEvents={isLoadingEvents}
            onDataRefresh={fetchEvents}
          />
        </TabsContent>

        <TabsContent value="bel" className="mt-4">
          <BelAdminTab />
        </TabsContent>

        <TabsContent value="email_campaigns" className="mt-4">
          <EmailCampaignsTab />
        </TabsContent>

        <TabsContent value="whatsapp_campaigns" className="mt-4">
          <WhatsAppCampaignsTab />
        </TabsContent>

          <TabsContent value="templates" className="mt-4">
            <div className="h-[calc(100vh-26rem)] overflow-hidden">
              <TemplatesTab />
            </div>
          </TabsContent>

        <TabsContent value="integration" className="mt-4">
          <IntegrationTab />
        </TabsContent>

        <TabsContent value="paid_food" className="mt-4">
          <PaidFoodTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
        </TabsContent>

        <TabsContent value="google_form_registrations" className="mt-4">
          <GoogleFormTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="feedback_forms" className="mt-4">
          <FeedbackFormsTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="birthday_campaign" className="mt-4">
          <BirthdayCampaignTab />
        </TabsContent>

        <TabsContent value="waitlist" className="mt-4">
          <WaitlistTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>

        <TabsContent value="expo" className="mt-4">
          <ExpoTab events={events} isLoadingEvents={isLoadingEvents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
