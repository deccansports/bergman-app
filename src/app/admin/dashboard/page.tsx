
// src/app/admin/dashboard/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Loader2, BookOpen, Bike, ShieldAlert, Server, FileText, Satellite, Database, Bug, Megaphone, ShoppingBag, Truck, MessageSquare, LineChart, Award, Trophy, IndianRupee, Warehouse, Mail, KeyRound, MessageCircleQuestion, DatabaseBackup, Repeat, Handshake, ShieldX, Tv, Map, UserPlus, FileClock, Ban, CreditCard, Users2, UtensilsCrossed
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from '@/hooks/use-mobile';
import type { EventCalendarEntry, StoreOrder } from '@/lib/types';
import { _computeCalendarEvents } from '@/lib/actions/eventActions'; 
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, limit, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';

// --- STATIC IMPORTS ---
import RegistrationsTab from '@/components/admin/RegistrationsTab';
import AthletesAndClubsTab from '@/components/admin/AthletesAndClubsTab';
import AthleteMergeTab from '@/components/admin/AthleteMergeTab';
import LiveTrackingAdminTab from '@/components/admin/LiveTrackingAdminTab';
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
import LiveStreamingTab from '@/components/admin/LiveStreamingTab';
import EnquiriesTab from '@/components/admin/EnquiriesTab';
import DataSyncTab from '@/components/admin/DataSyncTab';
import KvAnalyticsTab from '@/components/admin/KvAnalyticsTab';
import FirestoreDebugTab from '@/components/admin/FirestoreDebugTab';
import RegistrationDebugTab from '@/components/admin/RegistrationDebugTab';
import SystemControlTab from '@/components/admin/SystemControlTab';
import AnnouncementsTab from '@/components/admin/AnnouncementsTab';
import StoreInventoryTab from '@/components/admin/StoreInventoryTab';
import StoreOrdersTab from '@/components/admin/StoreOrdersTab';
import ZohoSyncTab from '@/components/admin/ZohoSyncTab';
import PaidFoodTab from '@/components/admin/PaidFoodTab';

export const dynamic = "force-dynamic";

type AdminSection =
  | 'registrations' | 'pages' | 'live_streaming'
  | 'athletes' | 'merge_tool' | 'volunteers' | 'deferrals' | 'cancellations'
  | 'payments' | 'inventory' | 'api_keys' | 'email_campaigns' | 'whatsapp_campaigns' | 'faqs'
  | 'backup' | 'accounting' | 'category_changes' | 'yearly_recap'
  | 'live_tracking' | 'legacy_athletes' | 'athlete_insights'
  | 'bike_racking' | 'blacklist' | 'finish_led' | 'sponsors' | 'webhooks'
  | 'enquiries' | 'data_sync' | 'kv_analytics' | 'firestore_debug' | 'registration_debug' | 'system_control'
  | 'announcements' | 'store_inventory' | 'store_orders' | 'zoho_sync' | 'paid_food';

const adminNavItems: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'registrations', label: 'Registrations & Events', icon: BookOpen },
  { id: 'zoho_sync', label: 'Zoho Sync Tool', icon: CreditCard },
  { id: 'store_inventory', label: 'Store Catalog', icon: ShoppingBag },
  { id: 'store_orders', label: 'Store Orders', icon: Truck },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'system_control', label: 'System Controls', icon: ShieldAlert },
  { id: 'registration_debug', label: 'Registration Debugs', icon: Bug },
  { id: 'live_streaming', label: 'Live Streaming', icon: Satellite },
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'athletes', label: 'Athletes & Clubs', icon: Users2 },
  { id: 'merge_tool', label: 'Athlete Merge Tool', icon: Repeat },
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
  { id: 'paid_food', label: 'Paid Food', icon: UtensilsCrossed },
  { id: 'email_campaigns', label: 'Email Campaigns', icon: Mail },
  { id: 'whatsapp_campaigns', label: 'WhatsApp Campaigns', icon: MessageSquare },
  { id: 'webhooks', label: 'Webhook Health', icon: ShieldAlert },
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
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<AdminSection>('registrations');
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const isMobile = useIsMobile();

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
    if (!db) return;
    const startTime = new Date();
    const q = query(
        collection(db, "storeOrders"),
        where("status", "==", "Paid"),
        orderBy("createdAt", "desc"),
        limit(1)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const order = change.doc.data() as StoreOrder;
                const orderDate = (order.createdAt as any)?.toDate ? (order.createdAt as any).toDate() : new Date(order.createdAt);
                if (orderDate > startTime) {
                    toast({
                        title: "🛒 New Store Order Received!",
                        description: `${order.customerName} just placed order ${order.orderId || change.doc.id.slice(-8)}.`,
                        action: (
                            <Button variant="outline" size="sm" onClick={() => onSectionChange('store_orders')}>
                                View Order
                            </Button>
                        )
                    });
                }
            }
        });
    });
    return () => unsubscribe();
  }, [toast, onSectionChange]);

  const fetchEvents = useCallback(async () => {
    setIsLoadingEvents(true);
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
    setIsLoadingEvents(false);
  }, [searchParams]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const section = searchParams.get('section') as AdminSection | null;
    if (section && adminNavItems.some(item => item.id === section)) {
      setActiveTab(section);
    } else {
      setActiveTab('registrations');
    }
    const evId = searchParams.get('eventId');
    if (evId) setSelectedEventId(evId);
  }, [searchParams]);
  
  const renderNav = () => {
    if (isMobile) {
      return (
        <Select value={activeTab} onValueChange={(value) => onSectionChange(value as AdminSection)}>
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
        <TabsList className="flex flex-wrap h-auto p-1 gap-1 bg-muted/50 rounded-xl">
          {adminNavItems.map(item => (
            <TabsTrigger key={item.id} value={item.id} className="text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <item.icon className="mr-2 h-3.5 w-3.5" />
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
    );
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left">
        <h1 className="text-3xl font-bold tracking-tight text-foreground text-left">Admin Dashboard</h1>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => onSectionChange(value as AdminSection)}
        className="w-full"
      >
        {renderNav()}

        <TabsContent value="registrations" className="mt-4">
          <RegistrationsTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
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

        <TabsContent value="live_streaming" className="mt-4">
          <LiveStreamingTab />
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

        <TabsContent value="yearly_recap" className="mt-4">
          <YearlyRecapTab />
        </TabsContent>

        <TabsContent value="legacy_athletes" className="mt-4">
          <LegacyAthletesTab />
        </TabsContent>

        <TabsContent value="athlete_insights" className="mt-4">
          <AthleteInsightsTab events={events} isLoadingEvents={isLoadingEvents} />
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

        <TabsContent value="paid_food" className="mt-4">
          <PaidFoodTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
