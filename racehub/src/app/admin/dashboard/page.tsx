// racehub/src/app/admin/dashboard/page.tsx
"use client";

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Loader2, Users2, FileUp, UserPlus, FileClock, Ban, IndianRupee, Warehouse, KeyRound,
  Mail, MessageCircleQuestion, DatabaseBackup, Repeat, UtensilsCrossed, Award, Map,
  Trophy, LineChart, BookOpen
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';
import type { EventCalendarEntry } from '@/lib/types';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';

// Admin tab components
import RegistrationsTab from '@/components/admin/RegistrationsTab';
import AthletesTab from '@/components/admin/AthletesTab';
import LiveTrackingAdminTab from '@/components/admin/LiveTrackingAdminTab';
import YearlyRecapTab from '@/components/admin/YearlyRecapTab';
import LegacyAthletesTab from '@/components/admin/LegacyAthletesTab';
import AthleteInsightsTab from '@/components/admin/AthleteInsightsTab';
import InventoryTab from '@/components/admin/InventoryTab';
import PaymentsTab from '@/components/admin/PaymentsTab';
import AccountingTab from '@/components/admin/AccountingTab';
import PaidFoodTab from '@/components/admin/PaidFoodTab';
import EmailCampaignsTab from '@/components/admin/EmailCampaignsTab';
import VolunteersTab from '@/components/admin/VolunteersTab';
import DeferralsTab from '@/components/admin/DeferralsTab';
import CancellationsTab from '@/components/admin/CancellationsTab';
import CategoryChangesTab from '@/components/admin/CategoryChangesTab';
import ApiKeysTab from '@/components/admin/ApiKeysTab';
import FaqsTab from '@/components/admin/FaqsTab'; // ✅ fixed path
import BackupTab from '@/components/admin/BackupTab';
import AgeGroupTab from '@/components/admin/AgeGroupTab';

type AdminSection =
  | 'registrations'
  | 'athletes' | 'volunteers' | 'deferrals' | 'cancellations'
  | 'payments' | 'inventory' | 'api_keys' | 'email_campaigns' | 'faqs'
  | 'backup' | 'accounting' | 'category_changes' | 'paid_food' | 'yearly_recap'
  | 'live_tracking' | 'legacy_athletes' | 'athlete_insights' | 'age_groups';

const adminNavItems = [
  { id: 'registrations', label: 'Registrations & Events', icon: BookOpen },
  { id: 'athletes', label: 'Athletes & Clubs', icon: Users2 },
  { id: 'live_tracking', label: 'Live Tracking', icon: Map },
  { id: 'yearly_recap', label: 'Yearly Recap', icon: Award },
  { id: 'legacy_athletes', label: 'Legacy Athletes', icon: Trophy },
  { id: 'athlete_insights', label: 'Athlete Insights', icon: LineChart },
  { id: 'inventory', label: 'Inventory', icon: Warehouse },
  { id: 'payments', label: 'Payments', icon: IndianRupee },
  { id: 'accounting', label: 'Accounting', icon: IndianRupee },
  { id: 'paid_food', label: 'Paid Food', icon: UtensilsCrossed },
  { id: 'email_campaigns', label: 'Email Campaigns', icon: Mail },
  { id: 'volunteers', label: 'Volunteers', icon: UserPlus },
  { id: 'deferrals', label: 'Deferrals', icon: FileClock },
  { id: 'cancellations', label: 'Cancellations', icon: Ban },
  { id: 'category_changes', label: 'Category Changes', icon: Repeat },
  { id: 'api_keys', label: 'API Keys', icon: KeyRound },
  { id: 'faqs', label: 'FAQs', icon: MessageCircleQuestion },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'age_groups', label: 'Age Groups', icon: UserPlus },
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
    if (result.success && result.events) {
      setEvents(result.events);

      // Seed selected event if not set (guard events undefined)
      setSelectedEventId(prev => {
        if (prev) return prev;
        const fromUrl = searchParams.get('eventId');
        const list = result.events ?? [];
        if (fromUrl && list.some(e => e.id === fromUrl)) return fromUrl;
        return list[0]?.id ?? null;
      });
    } else {
      // If fetch failed, clear events & selected event
      setEvents([]);
      setSelectedEventId(null);
    }
    setIsLoadingEvents(false);
  }, [searchParams]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    // pick section from URL
    const section = searchParams.get('section') as AdminSection | null;
    if (section && adminNavItems.some(item => item.id === section)) {
      setActiveSection(section);
    } else {
      setActiveSection('registrations');
    }
    // react to eventId changes in URL
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

  const onEventChange = useCallback(
    (eventId: string) => {
      setSelectedEventId(eventId);
      router.push(`/admin/dashboard?section=${activeSection}&eventId=${eventId}`, { scroll: false });
    },
    [router, activeSection]
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

  // Event picker (for tabs that operate on a single event)
  const renderEventPicker = () => {
    if (isLoadingEvents || events.length === 0) return null;
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Event:</span>
        <Select value={selectedEventId ?? ''} onValueChange={onEventChange}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Select event..." />
          </SelectTrigger>
          <SelectContent>
            {events.map(ev => (
              <SelectItem key={ev.id} value={ev.id}>
                {ev.eventName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin Dashboard</h1>

      {renderEventPicker()}

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

          <TabsContent value="athletes" className="mt-4">
            <AthletesTab />
          </TabsContent>

          <TabsContent value="live_tracking" className="mt-4">
            <LiveTrackingAdminTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
          </TabsContent>

          <TabsContent value="inventory" className="mt-4">
            <InventoryTab />
          </TabsContent>

          <TabsContent value="payments" className="mt-4">
            <PaymentsTab selectedEventId={selectedEventId} />
          </TabsContent>

          {/* ✅ AccountingTab expects props */}
          <TabsContent value="accounting" className="mt-4">
            <AccountingTab events={events} isLoadingEvents={isLoadingEvents} />
          </TabsContent>

          <TabsContent value="email_campaigns" className="mt-4">
            <EmailCampaignsTab />
          </TabsContent>

          <TabsContent value="paid_food" className="mt-4">
            <PaidFoodTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
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

          <TabsContent value="volunteers" className="mt-4">
            <VolunteersTab />
          </TabsContent>

          <TabsContent value="deferrals" className="mt-4">
            <DeferralsTab />
          </TabsContent>

          <TabsContent value="cancellations" className="mt-4">
            <CancellationsTab />
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
            <BackupTab events={events} isLoadingEvents={isLoadingEvents} />
          </TabsContent>

          <TabsContent value="age_groups" className="mt-4">
            <AgeGroupTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
          </TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}