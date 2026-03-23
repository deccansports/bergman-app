
// src/app/volunteer/dashboard/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { HandHelping, ClipboardList, Info, Loader2, Bike, Medal, UtensilsCrossed, Package, IndianRupee, UserCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import { format as formatDateFns, parseISO } from 'date-fns';

// Import the new modular tab components
import WaiverCheckinTab from '@/components/volunteer/WaiverCheckinTab';
import BikeCheckinTab from '@/components/volunteer/BikeCheckinTab';
import BikeCheckoutTab from '@/components/volunteer/BikeCheckoutTab';
import FinisherItemsTab from '@/components/volunteer/FinisherItemsTab';
import LockerCounterTab from '@/components/volunteer/LockerCounterTab';
import FoodLogTab from '@/components/volunteer/FoodLogTab';
import PaidFoodTab from '@/components/volunteer/PaidFoodTab';
import { getCalendarEventsAction } from '@/lib/actions/eventActions'; // To fetch event names
import type { EventCalendarEntry } from '@/lib/types';


const VOLUNTEER_COUNTERS = [
  { value: 'waiver_checkin', label: 'Waiver / Check-in', icon: UserCheck },
  { value: 'bike_checkin', label: 'Bike Check-in', icon: Bike },
  { value: 'bike_checkout', label: 'Bike Check-out', icon: Bike },
  { value: 'medal_counter', label: 'Finisher goodies', icon: Medal },
  { value: 'food_counter', label: 'Food', icon: UtensilsCrossed },
  { value: 'paid_food_counter', label: 'Paid Food', icon: IndianRupee },
  { value: 'locker_counter', label: 'Locker Counter', icon: Package },
  { value: 'transition_area', label: 'Transition Area Marshal', icon: ClipboardList },
  { value: 'course_marshal', label: 'Course Marshal', icon: ClipboardList },
  { value: 'aid_station', label: 'Aid Station', icon: ClipboardList },
  { value: 'finish_line', label: 'Finish Line Support', icon: ClipboardList },
  { value: 'info_desk', label: 'Information Desk', icon: ClipboardList },
  { value: 'other', label: 'Other', icon: ClipboardList },
];

export default function VolunteerDashboardPage() {
  const { currentUser, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  const isMobile = useIsMobile();
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  useEffect(() => {
    async function fetchEvents() {
        const result = await getCalendarEventsAction();
        if (result.success && result.events) {
            setEvents(result.events);
        }
        setIsLoadingEvents(false);
    }
    fetchEvents();
  }, []);

  const assignedRoles = useMemo(() => Array.isArray(currentUser?.assignedCounter)
    ? currentUser.assignedCounter
    : (currentUser?.assignedCounter ? [currentUser.assignedCounter] : []), [currentUser]);

  const navItems = useMemo(() => [
    { id: 'waiverCheckin', label: 'Waiver / Check-in', icon: UserCheck, enabled: assignedRoles.includes('waiver_checkin') },
    { id: 'bikeCheckin', label: 'Bike Check-in', icon: Bike, enabled: assignedRoles.includes('bike_checkin') },
    { id: 'bikeCheckout', label: 'Bike Check-out', icon: Bike, enabled: assignedRoles.includes('bike_checkout') },
    { id: 'lockerCounter', label: 'Locker Counter', icon: Package, enabled: assignedRoles.includes('locker_counter') },
    { id: 'medalCounter', label: 'Finisher goodies', icon: Medal, enabled: assignedRoles.includes('medal_counter') },
    { id: 'foodLog', label: 'Food', icon: UtensilsCrossed, enabled: assignedRoles.includes('food_counter') },
    { id: 'paidFood', label: 'Paid Food', icon: IndianRupee, enabled: assignedRoles.includes('paid_food_counter') },
  ].filter(item => item.enabled), [assignedRoles]);

  useEffect(() => {
    if (!activeTab && navItems.length > 0) {
      setActiveTab(navItems[0].id);
    }
  }, [activeTab, navItems]);

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Loading Volunteer Dashboard...</p>
      </div>
    );
  }

  if (!currentUser || !currentUser.isVolunteer) {
    return (
        <Card className="shadow-xl rounded-xl my-8">
            <CardHeader className="bg-destructive/10">
                <CardTitle className="text-destructive text-center">Access Denied</CardTitle>
            </CardHeader>
            <CardContent className="text-center py-6">
                <p>You are not authorized to view this page.</p>
            </CardContent>
        </Card>
    );
  }

  const renderNav = () => {
    if (navItems.length === 0) return null;
    
    if (isMobile) {
        return (
            <Select value={activeTab} onValueChange={(value) => setActiveTab(value)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a section..." />
                </SelectTrigger>
                <SelectContent>
                    {navItems.map(item => (
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
            <TabsList className="inline-flex h-auto p-1">
                {navItems.map(item => (
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
    <div className="space-y-8">
      <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-primary">
        <CardHeader className="bg-primary/10 p-6">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <HandHelping className="h-12 w-12 text-primary" />
            <div>
              <CardTitle className="text-3xl font-bold text-primary">Welcome, {currentUser.name || 'Volunteer'}!</CardTitle>
              <CardDescription className="text-md text-primary/80">Thank you for your invaluable contribution to Bergman events.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Card className="bg-background shadow-md mb-6">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2 text-foreground">
                <Info className="h-5 w-5" /> Your Current Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <p><strong>Event Name:</strong> <span className="text-foreground">{currentUser.assignedEventName || 'Not Assigned'}</span></p>
                <p><strong>Event Date:</strong> <span className="text-foreground">{currentUser.assignedEventDate ? formatDateFns(parseISO(currentUser.assignedEventDate), 'MMMM dd, yyyy') : 'TBD'}</span></p>
                <div className="flex items-start gap-2">
                  <strong>Assigned Role(s):</strong>
                  <div className="flex flex-wrap gap-1.5">
                    {assignedRoles.length > 0 ? (
                      assignedRoles.map(role => <Badge key={role} variant="secondary">{VOLUNTEER_COUNTERS.find(c => c.value === role)?.label || role}</Badge>)
                    ) : (
                      <span className="text-foreground">Not Assigned</span>
                    )}
                  </div>
                </div>
                {!currentUser.assignedEventId && (
                  <p className="text-muted-foreground mt-2">You are not currently assigned to a specific event or counter. Please check back or contact the event coordinator.</p>
                )}
            </CardContent>
          </Card>

          {currentUser.assignedEventId ? (
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
               {renderNav()}
              
              <TabsContent value="waiverCheckin" className="mt-4">
                {assignedRoles.includes('waiver_checkin') && <WaiverCheckinTab eventId={currentUser.assignedEventId} activeTab={activeTab || ''} volunteerId={currentUser.uid} volunteerName={currentUser.name || 'Volunteer'} />}
              </TabsContent>
              <TabsContent value="bikeCheckin" className="mt-4">
                {assignedRoles.includes('bike_checkin') && <BikeCheckinTab eventId={currentUser.assignedEventId} />}
              </TabsContent>
              <TabsContent value="bikeCheckout" className="mt-4">
                {assignedRoles.includes('bike_checkout') && <BikeCheckoutTab eventId={currentUser.assignedEventId} volunteerId={currentUser.uid} volunteerName={currentUser.name || 'Volunteer'} />}
              </TabsContent>
              <TabsContent value="lockerCounter" className="mt-4">
                {assignedRoles.includes('locker_counter') && <LockerCounterTab eventId={currentUser.assignedEventId} />}
              </TabsContent>
              <TabsContent value="medalCounter" className="mt-4">
                {assignedRoles.includes('medal_counter') && <FinisherItemsTab eventId={currentUser.assignedEventId} />}
              </TabsContent>
              <TabsContent value="foodLog" className="mt-4">
                {assignedRoles.includes('food_counter') && <FoodLogTab eventId={currentUser.assignedEventId} />}
              </TabsContent>
              <TabsContent value="paidFood" className="mt-4">
                {assignedRoles.includes('paid_food_counter') && <PaidFoodTab eventId={currentUser.assignedEventId} />}
              </TabsContent>
            </Tabs>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
