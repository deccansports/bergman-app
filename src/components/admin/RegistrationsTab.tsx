// src/components/admin/RegistrationsTab.tsx
"use client";

import React, { useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Info, Ticket, Hash, Users2, FileUp, Users, TicketPercent, Cake } from 'lucide-react';
import type { EventCalendarEntry } from '@/lib/types';

// Import tab components
import OverviewTab from './OverviewTab';
import EventInfoTab from './EventInfoTab';
import TicketsTab from './TicketsTab';
import BibManagementTab from './BibManagementTab';
import AgeGroupTab from './AgeGroupTab';
import RegistrationAttemptsTab from './RegistrationAttemptsTab';
import BulkUploadParticipantsTab from './BulkUploadParticipantsTab';
import ParticipantsTab from './ParticipantsTab';
import CouponsTab from './CouponsTab';
import BirthdaysTab from './BirthdaysTab';

const registrationNavItems = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'eventInfo', label: 'Event Info', icon: Info },
  { id: 'tickets', label: 'Tickets', icon: Ticket },
  { id: 'ageGroups', label: 'Age Groups', icon: Users2 },
  { id: 'participants', label: 'Participants', icon: Users },
  { id: 'bibs', label: 'BIB Mgmt', icon: Hash },
  { id: 'attempts', label: 'Reg Attempts', icon: FileUp },
  { id: 'coupons', label: 'Coupons', icon: TicketPercent },
  { id: 'bulkUpload', label: 'Bulk Upload', icon: FileUp },
  { id: 'birthdays', label: 'Birthdays', icon: Cake },
];

interface RegistrationsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

export default function RegistrationsTab({ events, isLoadingEvents, onDataRefresh }: RegistrationsTabProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const isMobile = useIsMobile();

  const renderNav = () => {
    if (isMobile) {
      return (
        <Select value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a section..." />
          </SelectTrigger>
          <SelectContent>
            {registrationNavItems.map(item => (
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
      <TabsList className="grid w-full grid-cols-10">
        {registrationNavItems.map(item => (
          <TabsTrigger key={item.id} value={item.id} className="text-xs sm:text-sm h-9">
            <item.icon className="mr-2 h-4 w-4" />
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    );
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      {renderNav()}
      <TabsContent value="overview" className="mt-4">
        <OverviewTab events={events} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="eventInfo" className="mt-4">
        <EventInfoTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
      </TabsContent>
      <TabsContent value="tickets" className="mt-4">
        <TicketsTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
      </TabsContent>
      <TabsContent value="ageGroups" className="mt-4">
        <AgeGroupTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
      </TabsContent>
      <TabsContent value="participants" className="mt-4">
        <ParticipantsTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
      </TabsContent>
       <TabsContent value="bibs" className="mt-4">
        <BibManagementTab events={events} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="attempts" className="mt-4">
        <RegistrationAttemptsTab events={events} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="coupons" className="mt-4">
        <CouponsTab events={events} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="bulkUpload" className="mt-4">
        <BulkUploadParticipantsTab events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
      </TabsContent>
      <TabsContent value="birthdays" className="mt-4">
        <BirthdaysTab events={events} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
    </Tabs>
  );
}
