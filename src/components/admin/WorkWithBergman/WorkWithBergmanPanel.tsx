"use client";

import React, { useState, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BarChart3,
  Users,
  Award,
  UserCheck,
  FileText,
  MessageSquare,
  CreditCard,
  FileStack,
  TrendingUp,
  Settings,
} from 'lucide-react';

import DashboardTab from '@/components/admin/WorkWithBergman/tabs/DashboardTab';
import WorkersDatabaseTab from '@/components/admin/WorkWithBergman/tabs/WorkersDatabaseTab';
import OpenRolesTab from '@/components/admin/WorkWithBergman/tabs/OpenRolesTab';
import EventStaffingTab from '@/components/admin/WorkWithBergman/tabs/EventStaffingTab';
import ApplicationsTab from '@/components/admin/WorkWithBergman/tabs/ApplicationsTab';
import PendingApplicationsTab from '@/components/admin/WorkWithBergman/tabs/PendingApplicationsTab';
import CommunicationsTab from '@/components/admin/WorkWithBergman/tabs/CommunicationsTab';
import PaymentsTab from '@/components/admin/WorkWithBergman/tabs/PaymentsTab';
import DocumentsTab from '@/components/admin/WorkWithBergman/tabs/DocumentsTab';
import ReportsTab from '@/components/admin/WorkWithBergman/tabs/ReportsTab';
import SettingsTab from '@/components/admin/WorkWithBergman/tabs/SettingsTab';

export default function WorkWithBergmanPanel() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleNavigateTab = (tabId: string) => {
    setActiveTab(tabId);
  };

  const scroll = (dir: 'left' | 'right') => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' });
    }
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: BarChart3 },
    { id: 'workers', label: 'Workers Database', shortLabel: 'Workers', icon: Users },
    { id: 'roles', label: 'Open Roles', shortLabel: 'Roles', icon: Award },
    { id: 'staffing', label: 'Event Staffing', shortLabel: 'Staffing', icon: UserCheck },
    { id: 'applications', label: 'Applications', shortLabel: 'Apps', icon: FileText },
    { id: 'pending-applications', label: 'Pending Applications', shortLabel: 'Pending', icon: FileText },
    { id: 'communications', label: 'Communications', shortLabel: 'Comms', icon: MessageSquare },
    { id: 'payments', label: 'Payments', shortLabel: 'Pay', icon: CreditCard },
    { id: 'documents', label: 'Documents & Certifications', shortLabel: 'Docs', icon: FileStack },
    { id: 'reports', label: 'Reports & Analytics', shortLabel: 'Reports', icon: TrendingUp },
    { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
  ];

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 min-w-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-6 py-3 sm:py-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Work With Bergman</h1>
        <p className="text-sm text-gray-600 mt-1">Manage event staff, volunteers, and freelancers</p>
      </div>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200">
          {/* Mobile: dropdown */}
          <div className="sm:hidden px-3 py-2">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder="Select section" />
              </SelectTrigger>
              <SelectContent>
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <SelectItem key={tab.id} value={tab.id}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop: scrollable tab bar with arrow buttons */}
          <div className="hidden sm:flex items-center">
            <button
              type="button"
              onClick={() => scroll('left')}
              className="flex-shrink-0 h-12 w-8 flex items-center justify-center border-r text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              aria-label="Scroll tabs left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div
              ref={scrollRef}
              className="flex-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <TabsList className="flex w-max justify-start gap-0 bg-transparent border-b-0 p-0 h-auto flex-nowrap">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium text-gray-600 border-b-2 border-transparent rounded-none data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 hover:text-gray-900 whitespace-nowrap min-h-[44px]"
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <button
              type="button"
              onClick={() => scroll('right')}
              className="flex-shrink-0 h-12 w-8 flex items-center justify-center border-l text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              aria-label="Scroll tabs right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          <TabsContent value="dashboard" className="px-3 py-4 sm:p-6 h-full mt-0">
            <DashboardTab onNavigateTab={handleNavigateTab} />
          </TabsContent>
          <TabsContent value="workers" className="px-3 py-4 sm:p-6 h-full mt-0">
            <WorkersDatabaseTab />
          </TabsContent>
          <TabsContent value="roles" className="px-3 py-4 sm:p-6 h-full mt-0">
            <OpenRolesTab />
          </TabsContent>
          <TabsContent value="staffing" className="px-3 py-4 sm:p-6 h-full mt-0">
            <EventStaffingTab />
          </TabsContent>
          <TabsContent value="applications" className="px-3 py-4 sm:p-6 h-full mt-0">
            <ApplicationsTab />
          </TabsContent>
          <TabsContent value="pending-applications" className="px-3 py-4 sm:p-6 h-full mt-0">
            <PendingApplicationsTab />
          </TabsContent>
          <TabsContent value="communications" className="px-3 py-4 sm:p-6 h-full mt-0">
            <CommunicationsTab />
          </TabsContent>
          <TabsContent value="payments" className="px-3 py-4 sm:p-6 h-full mt-0">
            <PaymentsTab />
          </TabsContent>
          <TabsContent value="documents" className="px-3 py-4 sm:p-6 h-full mt-0">
            <DocumentsTab />
          </TabsContent>
          <TabsContent value="reports" className="px-3 py-4 sm:p-6 h-full mt-0">
            <ReportsTab />
          </TabsContent>
          <TabsContent value="settings" className="px-3 py-4 sm:p-6 h-full mt-0">
            <SettingsTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
