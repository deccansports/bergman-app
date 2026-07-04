"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Gift, CalendarHeart, RefreshCw, Mail, MessageCircle } from 'lucide-react';
import { getBirthdayCampaignDashboardStatusAction, runBirthdayCampaignTodayAction, runUpcomingBirthdayCampaignAction, syncUserDobToKVAction } from '@/lib/actions/birthdayCampaignActions';
import type { BirthdayCampaignResult, TodayBirthdayCampaignStatus } from '@/lib/actions/birthdayCampaignActions';

export default function BirthdayCampaignTab() {
  const { toast } = useToast();
  const [isRunningCampaign, setIsRunningCampaign] = useState(false);
  const [isRunningUpcomingCampaign, setIsRunningUpcomingCampaign] = useState(false);
  const [isSyncingDob, setIsSyncingDob] = useState(false);
  const [isLoadingToday, setIsLoadingToday] = useState(false);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(false);
  const [result, setResult] = useState<BirthdayCampaignResult | null>(null);
  const [todayStatus, setTodayStatus] = useState<TodayBirthdayCampaignStatus | null>(null);
  const [upcomingStatus, setUpcomingStatus] = useState<TodayBirthdayCampaignStatus | null>(null);

  const loadDashboardStatuses = useCallback(async () => {
    setIsLoadingToday(true);
    setIsLoadingUpcoming(true);
    try {
      const res = await Promise.race([
        getBirthdayCampaignDashboardStatusAction(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Birthday dashboard request timed out.')), 20000)),
      ]);
      setTodayStatus(res.today);
      setUpcomingStatus(res.upcoming);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Failed to Load Birthday Dashboard', description: res.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Load Birthday Dashboard', description: error?.message || 'Unknown error' });
    } finally {
      setIsLoadingToday(false);
      setIsLoadingUpcoming(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDashboardStatuses();
  }, [loadDashboardStatuses]);

  const handleDobSync = async () => {
    setIsSyncingDob(true);
    try {
      const res = await syncUserDobToKVAction();
      if (res.success) {
        toast({ title: 'DOB Sync Complete', description: `${res.synced} profiles synced (${res.scanned} scanned).` });
        await loadDashboardStatuses();
      } else {
        toast({ variant: 'destructive', title: 'DOB Sync Failed', description: res.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'DOB Sync Failed', description: error?.message || 'Unknown error' });
    } finally {
      setIsSyncingDob(false);
    }
  };

  const handleRunCampaign = async () => {
    setIsRunningCampaign(true);
    try {
      const res = await runBirthdayCampaignTodayAction();
      setResult(res);
      if (res.success) {
        toast({ title: 'Birthday Campaign Completed', description: res.message });
        await loadDashboardStatuses();
      } else {
        toast({ variant: 'destructive', title: 'Birthday Campaign Failed', description: res.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Birthday Campaign Failed', description: error?.message || 'Unknown error' });
    } finally {
      setIsRunningCampaign(false);
    }
  };

  const handleRunUpcomingCampaign = async () => {
    setIsRunningUpcomingCampaign(true);
    try {
      const res = await runUpcomingBirthdayCampaignAction();
      setResult(res);
      if (res.success) {
        toast({ title: 'Upcoming Birthday Campaign Completed', description: res.message });
        await loadDashboardStatuses();
      } else {
        toast({ variant: 'destructive', title: 'Upcoming Birthday Campaign Failed', description: res.message });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upcoming Birthday Campaign Failed', description: error?.message || 'Unknown error' });
    } finally {
      setIsRunningUpcomingCampaign(false);
    }
  };

  const stats = result?.stats;

  return (
    <div className="space-y-6 text-left">
      <Card className="border-none shadow-xl overflow-hidden text-left">
        <CardHeader className="bg-primary/5 border-b text-left">
          <CardTitle className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tighter text-left">
            <CalendarHeart className="h-5 w-5 text-primary" />
            Birthday Campaign
          </CardTitle>
          <CardDescription className="text-left">
            Sends birthday email + WhatsApp, creates annual 15% coupon, and links it to athlete email for auto-apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6 text-left">
          <div className="flex flex-wrap items-end gap-2 text-left">
              <Button onClick={handleDobSync} variant="outline" disabled={isSyncingDob || isRunningCampaign || isRunningUpcomingCampaign}>
                {isSyncingDob ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync DOB to KV
              </Button>
              <Button onClick={handleRunCampaign} disabled={isRunningCampaign || isSyncingDob || isRunningUpcomingCampaign}>
                {isRunningCampaign ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
                Run Birthday Campaign (Today)
              </Button>
              <Button onClick={handleRunUpcomingCampaign} disabled={isRunningUpcomingCampaign || isSyncingDob || isRunningCampaign}>
                {isRunningUpcomingCampaign ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
                Run Upcoming (1 Day)
              </Button>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2 text-left">
            <Badge variant="secondary">Coupon: 15%</Badge>
            <Badge variant="secondary">Type: Birthday Coupon</Badge>
            <Badge variant="secondary">Usage: Once / Year</Badge>
            <Badge variant="secondary">Auto Run: Daily (Today + 1 Day Upcoming)</Badge>
            <Badge variant="secondary">Best Send Time: 10:00 IST</Badge>
            <Badge variant="secondary">Scope: Any event + any ticket</Badge>
            <Badge variant="secondary">Link: Athlete email</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="text-left">
        <CardHeader className="text-left">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-left">Today Birthday List</CardTitle>
              <CardDescription className="text-left">Shows whose birthday is today and which coupon was sent.</CardDescription>
            </div>
            <Button variant="outline" onClick={loadDashboardStatuses} disabled={isLoadingToday || isRunningCampaign || isRunningUpcomingCampaign || isSyncingDob}>
              {isLoadingToday ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-left">
          <div className="flex flex-wrap gap-2 text-left">
            <Badge variant="outline">Today: {todayStatus?.birthdayToday ?? 0}</Badge>
            <Badge variant="outline">Processed: {todayStatus?.processed ?? 0}</Badge>
            <Badge variant="outline">Failed: {todayStatus?.failed ?? 0}</Badge>
            <Badge variant="secondary">Not Sent: {todayStatus?.notSent ?? 0}</Badge>
          </div>

          <div className="rounded-lg border overflow-x-auto text-left">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>DOB</TableHead>
                  <TableHead>Coupon</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingToday ? (
                  <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      <Loader2 className="h-5 w-5 mx-auto animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : !todayStatus || todayStatus.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No birthdays found for today.</TableCell>
                  </TableRow>
                ) : todayStatus.items.map((row) => (
                  <TableRow key={`today-${row.uid}-${row.email}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.email || '—'}</TableCell>
                    <TableCell>{row.mobile || '—'}</TableCell>
                    <TableCell>{row.dob || '—'}</TableCell>
                    <TableCell>{row.couponCode || '—'}</TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        Email: {row.emailSent ? 'Yes' : 'No'} / WA: {row.whatsappSent ? 'Yes' : 'No'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.status === 'processed' ? <Badge>Processed</Badge> : row.status === 'failed' ? <Badge variant="destructive">Failed</Badge> : <Badge variant="secondary">Not Sent</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.reason || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="text-left">
        <CardHeader className="text-left">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-left">Upcoming Birthday (In 1 Day)</CardTitle>
              <CardDescription className="text-left">Shows tomorrow birthdays and whether coupon/email/WhatsApp is already sent.</CardDescription>
            </div>
            <Button variant="outline" onClick={loadDashboardStatuses} disabled={isLoadingUpcoming || isRunningCampaign || isRunningUpcomingCampaign || isSyncingDob}>
              {isLoadingUpcoming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-left">
          <div className="flex flex-wrap gap-2 text-left">
            <Badge variant="outline">Upcoming: {upcomingStatus?.birthdayToday ?? 0}</Badge>
            <Badge variant="outline">Processed: {upcomingStatus?.processed ?? 0}</Badge>
            <Badge variant="outline">Failed: {upcomingStatus?.failed ?? 0}</Badge>
            <Badge variant="secondary">Not Sent: {upcomingStatus?.notSent ?? 0}</Badge>
          </div>

          <div className="rounded-lg border overflow-x-auto text-left">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>DOB</TableHead>
                  <TableHead>Coupon</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingUpcoming ? (
                  <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      <Loader2 className="h-5 w-5 mx-auto animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : !upcomingStatus || upcomingStatus.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No upcoming birthdays for next day.</TableCell>
                  </TableRow>
                ) : upcomingStatus.items.map((row) => (
                  <TableRow key={`upcoming-${row.uid}-${row.email}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.email || '—'}</TableCell>
                    <TableCell>{row.mobile || '—'}</TableCell>
                    <TableCell>{row.dob || '—'}</TableCell>
                    <TableCell>{row.couponCode || '—'}</TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        Email: {row.emailSent ? 'Yes' : 'No'} / WA: {row.whatsappSent ? 'Yes' : 'No'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.status === 'processed' ? <Badge>Processed</Badge> : row.status === 'failed' ? <Badge variant="destructive">Failed</Badge> : <Badge variant="secondary">Not Sent</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.reason || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="text-left">
          <CardHeader className="text-left">
            <CardTitle className="text-left">Run Summary</CardTitle>
            <CardDescription className="text-left">{result.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-left">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-left">
              <Badge variant="outline" className="justify-center py-2">Scanned: {stats?.scanned ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2">Birthdays: {stats?.birthdayToday ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2">Created: {stats?.couponsCreated ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2">Reused: {stats?.couponsReused ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2">Synced DOB: {stats?.syncedDobToKv ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2"><Mail className="h-3.5 w-3.5 mr-1" /> Email: {stats?.emailSent ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2"><MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp: {stats?.whatsappSent ?? 0}</Badge>
              <Badge variant="outline" className="justify-center py-2">Already: {stats?.alreadyProcessed ?? 0}</Badge>
              <Badge variant="destructive" className="justify-center py-2">Failed: {stats?.failed ?? 0}</Badge>
            </div>

            <div className="rounded-lg border overflow-x-auto text-left">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>DOB</TableHead>
                    <TableHead>Coupon</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.recipients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No recipients for this run.</TableCell>
                    </TableRow>
                  ) : result.recipients.map((row) => (
                    <TableRow key={`${row.uid}-${row.email}`}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.email || '—'}</TableCell>
                      <TableCell>{row.mobile || '—'}</TableCell>
                      <TableCell>{row.dob || '—'}</TableCell>
                      <TableCell>{row.couponCode || '—'}</TableCell>
                      <TableCell>
                        {row.status === 'processed' ? <Badge>Processed</Badge> : row.status === 'skipped' ? <Badge variant="secondary">Skipped</Badge> : <Badge variant="destructive">Failed</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.reason || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
