"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, UserCheck, Clock, Award, CheckCircle, Calendar, DollarSign, AlertCircle, Activity } from 'lucide-react';
import { getDashboardMetrics, getOpenRoles } from '@/lib/actions/workBergmanActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import type { OpenRole } from '@/lib/types/workWithBergman';
import type { EventCalendarEntry } from '@/lib/types/event';

interface MetricsData {
  totalWorkers: number;
  activeWorkers: number;
  pendingApplications: number;
  openRoles: number;
  filledRoles: number;
  upcomingEvents: number;
  totalPaymentsDue: number;
  totalPaymentsPaid: number;
}

export default function DashboardTab({ onNavigateTab }: { onNavigateTab?: (tabId: string) => void }) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [openRoles, setOpenRoles] = useState<OpenRole[]>([]);
  const [eventsById, setEventsById] = useState<Record<string, EventCalendarEntry>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const [data, roles, calendarResult] = await Promise.all([
        getDashboardMetrics(),
        getOpenRoles(),
        getCalendarEventsAction(),
      ]);
      setMetrics(data);
      setOpenRoles(roles);

      const byId: Record<string, EventCalendarEntry> = {};
      if (calendarResult.success && Array.isArray(calendarResult.events)) {
        for (const event of calendarResult.events) {
          if (!event?.id) continue;
          byId[String(event.id)] = event;
        }
      }
      setEventsById(byId);
    } catch (error) {
      console.error('Failed to load dashboard metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const resolveEventName = useCallback((role: OpenRole) => {
    const eventMeta = eventsById[role.eventId];
    const fallback = String(role.eventName || '').trim();
    const resolved = String(eventMeta?.eventName || fallback || role.eventId || 'Untitled Event').trim();

    if (resolved === role.eventId && fallback && fallback !== role.eventId) return fallback;
    return resolved;
  }, [eventsById]);

  const staffingOverview = useMemo(() => {
    const grouped = new Map<string, { eventName: string; rolesNeeded: number; filled: number; remaining: number }>();

    for (const role of openRoles) {
      const eventName = resolveEventName(role);
      const existing = grouped.get(role.eventId) || {
        eventName,
        rolesNeeded: 0,
        filled: 0,
        remaining: 0,
      };
      const assigned = role.numberAssigned || 0;
      const remaining = Math.max(0, role.numberRequired - assigned);

      existing.rolesNeeded += role.numberRequired;
      existing.filled += assigned;
      existing.remaining += remaining;
      existing.eventName = eventName;
      grouped.set(role.eventId, existing);
    }

    return Array.from(grouped.values()).slice(0, 5);
  }, [openRoles, resolveEventName]);

  const roleAmountSummary = useMemo(() => {
    return openRoles.reduce(
      (acc, role) => {
        const paymentPerRole = Math.max(0, Number(role.paymentAmount) || 0);
        const required = Math.max(0, Number(role.numberRequired) || 0);
        const assigned = Math.max(0, Number(role.numberAssigned) || 0);
        const remaining = Math.max(0, required - assigned);

        acc.totalCreatedAmount += paymentPerRole * required;
        acc.totalAssignedAmount += paymentPerRole * assigned;
        acc.totalRemainingAmount += paymentPerRole * remaining;
        return acc;
      },
      { totalCreatedAmount: 0, totalAssignedAmount: 0, totalRemainingAmount: 0 }
    );
  }, [openRoles]);

  const recentActivity = useMemo(() => {
    const latestRoles = [...openRoles]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 4)
      .map((role) => ({
        title: 'Role Updated',
        description: `${role.roleName} for ${resolveEventName(role)}`,
        time: new Date(role.updatedAt).toLocaleString('en-IN'),
        icon: Award,
        color: 'bg-orange-500',
      }));

    if (latestRoles.length > 0) return latestRoles;

    return [] as Array<{
      title: string;
      description: string;
      time: string;
      icon: React.ElementType;
      color: string;
    }>;
  }, [openRoles, resolveEventName]);

  const StatCard = ({
    icon: Icon,
    title,
    value,
    subtitle,
    color,
  }: {
    icon: React.ElementType;
    title: string;
    value: number | string;
    subtitle?: string;
    color: string;
  }) => (
    <Card className="bg-white hover:shadow-lg transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
            {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          </div>
          <div className={`p-3 rounded-lg ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Loading metrics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          title="Total Workers"
          value={metrics?.totalWorkers || 0}
          subtitle={`${metrics?.activeWorkers || 0} active`}
          color="bg-blue-500"
        />
        <StatCard
          icon={Clock}
          title="Pending Applications"
          value={metrics?.pendingApplications || 0}
          subtitle="Awaiting review"
          color="bg-yellow-500"
        />
        <StatCard
          icon={Award}
          title="Open Roles"
          value={metrics?.openRoles || 0}
          subtitle={`${metrics?.filledRoles || 0} filled · ₹${roleAmountSummary.totalCreatedAmount.toLocaleString('en-IN')} total role amount`}
          color="bg-green-500"
        />
        <StatCard
          icon={DollarSign}
          title="Payments Due"
          value={`₹${(metrics?.totalPaymentsDue || 0).toLocaleString('en-IN')}`}
          subtitle={`₹${(metrics?.totalPaymentsPaid || 0).toLocaleString('en-IN')} paid · ₹${roleAmountSummary.totalAssignedAmount.toLocaleString('en-IN')} assigned value`}
          color="bg-purple-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Staffing Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Staffing Overview</CardTitle>
            <CardDescription>Live event staffing requirements from Firestore</CardDescription>
          </CardHeader>
          <CardContent>
            {staffingOverview.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No open roles yet. Create a role to see live staffing requirements here.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Event Name</TableHead>
                    <TableHead className="text-right">Roles Needed</TableHead>
                    <TableHead className="text-right">Filled</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffingOverview.map((row) => (
                    <TableRow key={row.eventName}>
                      <TableCell className="text-gray-600">{row.eventName}</TableCell>
                      <TableCell className="text-right font-medium">{row.rolesNeeded}</TableCell>
                      <TableCell className="text-right font-medium text-green-600">{row.filled}</TableCell>
                      <TableCell className="text-right font-medium text-yellow-600">{row.remaining}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full justify-start" variant="outline" onClick={() => onNavigateTab?.('workers')}>
              <UserCheck className="w-4 h-4 mr-2" />
              Add New Worker
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => onNavigateTab?.('roles')}>
              <Award className="w-4 h-4 mr-2" />
              Create Role
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => onNavigateTab?.('applications')}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Review Applications
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => onNavigateTab?.('payments')}>
              <DollarSign className="w-4 h-4 mr-2" />
              Process Payments
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest updates from live staffing data</CardDescription>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No recent activity yet. New roles, assignments, or payments will appear here.
            </div>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={`${item.title}-${index}`} className="flex items-center gap-4 py-3 border-b last:border-b-0">
                    <div className={`w-2 h-2 ${item.color} rounded-full`} />
                    <div className="flex-1">
                      <p className="font-medium text-sm flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" />{item.title}</p>
                      <p className="text-xs text-gray-500">{item.description}</p>
                    </div>
                    <span className="text-xs text-gray-400">{item.time}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
