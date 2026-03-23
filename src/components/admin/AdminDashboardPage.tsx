// src/components/admin/AdminDashboardPage.tsx
"use client";

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Loader2, Users2, FileUp, UserPlus, FileClock, Ban, IndianRupee, Warehouse, KeyRound,
  Mail, MessageCircleQuestion, DatabaseBackup, Repeat, UtensilsCrossed, Award, Map,
  Trophy, LineChart, BookOpen, Bike, ShieldX, Tv, Handshake, ShieldAlert, Server, FileText, Satellite, Database, ShoppingBag, Truck, MessageSquare, Megaphone
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from '@/hooks/use-mobile';
import type { EventCalendarEntry } from '@/lib/types';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';

// Admin tab components
import RegistrationsTab from '@/components/admin/RegistrationsTab';
import AthletesAndClubsTab from '@/components/admin/AthletesAndClubsTab';
import LiveTrackingAdminTab from '@/components/admin/LiveTrackingAdminTab';
import YearlyRecapTab from '@/components/admin/YearlyRecapTab';
import LegacyAthletesTab from '@/components/admin/LegacyAthletesTab';
import AthleteInsightsTab from '@/components/admin/AthleteInsightsTab';
import InventoryTab from '@/components/admin/InventoryTab';
import PaymentsTab from '@/components/admin/PaymentsTab';
import AccountingTab from '@/components/admin/AccountingTab';
import EmailCampaignsTab from '@/components/admin/EmailCampaignsTab';
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
import LiveStreamingTab from '@/components/admin/LiveStreamingTab';
import EnquiriesTab from '@/components/admin/EnquiriesTab';
import DataSyncTab from '@/components/admin/DataSyncTab';
import KvAnalyticsTab from '@/components/admin/KvAnalyticsTab';
import FirestoreDebugTab from '@/components/admin/FirestoreDebugTab';
import RegistrationDebugTab from '@/components/admin/RegistrationDebugTab';
import AnnouncementsTab from '@/components/admin/AnnouncementsTab';
import PaidFoodTab from '@/components/admin/PaidFoodTab';


type AdminSection =
  | 'registrations' | 'pages' | 'live_streaming'
  | 'athletes' | 'volunteers' | 'deferrals' | 'cancellations'
  | 'payments' | 'inventory' | 'api_keys' | 'email_campaigns' | 'faqs'
  | 'backup' | 'accounting' | 'category_changes' | 'yearly_recap'
  | 'live_tracking' | 'legacy_athletes' | 'athlete_insights'
  | 'bike_racking' | 'blacklist' | 'finish_led' | 'sponsors' | 'webhooks'
  | 'enquiries' | 'data_sync' | 'kv_analytics' | 'firestore_debug' | 'reg_debug'
  | 'announcements' | 'paid_food';

const adminNavItems: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'registrations', label: 'Registrations & Events', icon: BookOpen },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'live_streaming', label: 'Live Streaming', icon: Satellite },
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'athletes', label: 'Athletes & Clubs', icon: Users2 },
  { id: 'paid_food', label: 'Paid Food', icon: UtensilsCrossed },
  { id: 'live_tracking', label: 'Live Tracking', icon: Map },
  { id: 'finish_led', label: 'Finish LED', icon: Tv },
  { id: 'bike_racking', label: 'Bike Racking', icon: Bike },
  { id: 'yearly_recap', label: 'Yearly Recap', icon: Award },
  { id: 'legacy_athletes', label: 'Legacy Athletes', icon: Trophy },
  { id: 'athlete_insights', label: 'Athlete Insights', icon: LineChart },
  { id: 'inventory', label: 'Inventory', icon: Warehouse },
  { id: 'payments', label: 'Payments', icon: IndianRupee },
  { id: 'accounting', label: 'Accounting', icon: IndianRupee },
  { id: 'sponsors', label: 'Sponsors', icon: Handshake },
  { id: 'email_campaigns', label: 'Email Campaigns', icon: Mail },
  { id: 'webhooks', label: 'Webhook Health', icon: ShieldAlert },
  { id: 'reg_debug', label: 'Reg Debug', icon: ShieldAlert },
  { id: 'data_sync', label: 'Data Sync', icon: Database },
  { id: 'kv_analytics', label: 'KV Analytics', icon: Database },
  { id: 'firestore_debug', label: 'Firestore Debug', icon: Server },
  { id: 'enquiries', label: 'Enquiries', icon: MessageCircleQuestion },
  { id: 'volunteers', label: 'Volunteers', icon: UserPlus },
  { id: 'deferrals', label: 'Deferrals', icon: FileClock },
  { id: 'cancellations', label: 'Cancellations', icon: Ban },
  { id: 'blacklist', label: 'Blacklist', icon: ShieldX },
  { id: 'category_changes', label: 'Category Changes', icon: Repeat },
  { id: 'api_keys', label: 'API Keys', icon: KeyRound },
  { id: 'faqs', label: 'FAQs', icon: MessageCircleQuestion },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeSection, setActiveSection] = useState<AdminSection>('registrations');
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const fetchEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    const result = await getCalendarEventsAction();
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
    setIsLoadingEvents(false);
  }, [searchParams]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const section = searchParams.get('section') as AdminSection | null;
    if (section && adminNavItems.some(item => item.id === section)) {
      setActiveSection(section);
    } else {
      setActiveSection('registrations');
    }
    const evId = searchParams.get('eventId');
    if (evId) setSelectedEventId(evId);
  }, [searchParams]);

  const onSectionChange = useCallback(
    (section: AdminSection) => {
      setActiveSection(section);
      router.push(
        `/admin/dashboard?section=${section}${selectedEventId ? `&eventId=${selectedEventId}` : ''}`,
        { scroll: false }
      );
    },
    [router, selectedEventId]
  );
  
  const renderNav = () => {
    if (isMobile) {
      return (
        <Select value={activeSection} onValueChange={(value) => onSectionChange(value as AdminSection)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a section..." />
          </SelectTrigger>
          <SelectContent>
            {adminNavItems.map(item => (
              <SelectItem key={item.id} value={item.id}>
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
      <ScrollArea className="w-full whitespace-nowrap">
        <TabsList className="inline-flex h-auto p-1 flex-wrap">
          {adminNavItems.map(item => (
            <TabsTrigger key={item.id} value={item.id} className="text-xs sm:text-sm h-9">
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin Dashboard</h1>
      </div>

      <Tabs
        value={activeSection}
        onValueChange={(value) => onSectionChange(value as AdminSection)}
        className="w-full"
      >
        {renderNav()}

        <Suspense fallback={
          <div className="mt-10 flex justify-center">
            <Loader2 className="animate-spin h-8 w-8 text-primary" />
          </div>
        }>
          <TabsContent value="registrations" className="mt-4">
            <RegistrationsTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
          </TabsContent>

          <TabsContent value="announcements" className="mt-4">
            <AnnouncementsTab />
          </TabsContent>

          <TabsContent value="live_streaming" className="mt-4">
            <LiveStreamingTab />
          </TabsContent>
          
          <TabsContent value="pages" className="mt-4">
            <PagesTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
          </TabsContent>

          <TabsContent value="athletes" className="mt-4">
            <AthletesAndClubsTab />
          </TabsContent>

          <TabsContent value="paid_food" className="mt-4">
            <PaidFoodTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
          </TabsContent>

          <TabsContent value="live_tracking" className="mt-4">
            <LiveTrackingAdminTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
          </TabsContent>

          <TabsContent value="finish_led" className="mt-4">
            <FinishLedTab events={events} isLoadingEvents={isLoadingEvents} />
          </TabsContent>
          
          <TabsContent value="bike_racking" className="mt-4">
            <BikeRackAdminTab events={events} isLoadingEvents={isLoadingEvents} />
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
          
          <TabsContent value="webhooks" className="mt-4">
            <WebhookHealthTab />
          </TabsContent>

          <TabsContent value="reg_debug" className="mt-4">
            <RegistrationDebugTab />
          </TabsContent>

          <TabsContent value="data_sync" className="mt-4">
            <DataSyncTab events={events} isLoadingEvents={isLoadingEvents} />
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

          <TabsContent value="email_campaigns" className="mt-4">
            <EmailCampaignsTab />
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
        </Suspense>
      </Tabs>
    </div>
  );
}
