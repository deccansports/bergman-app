
// src/components/admin/SystemControlTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Settings, ShieldAlert, History, User, Clock, Info } from 'lucide-react';
import { getSystemControlAction, updateSystemControlAction, getSystemControlLogsAction } from '@/lib/actions/systemActions';
import { useAuth } from '@/context/AuthContext';
import { format, parseISO } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function SystemControlTab() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState({
    athleteDashboardMaintenance: false,
    clubDashboardMaintenance: false,
    volunteerDashboardMaintenance: false,
    maintenanceMessage: "",
  });
  const [logs, setLogs] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [res, logRes] = await Promise.all([
        getSystemControlAction(),
        getSystemControlLogsAction()
    ]);
    if (res.success && res.settings) {
      setSettings(res.settings);
    }
    if (logRes.success && logRes.logs) {
        setLogs(logRes.logs);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    const result = await updateSystemControlAction(settings, currentUser.uid, currentUser.name || 'Admin');
    if (result.success) {
      toast({ title: 'Settings Saved', description: result.message });
      fetchData();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="border-orange-500/20 bg-orange-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-orange-600"/>Dashboard Maintenance Controls</CardTitle>
          <CardDescription>Instantly toggle maintenance mode for specific dashboards. Admins are unaffected and can always access these dashboards.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-center justify-between p-4 border rounded-xl bg-background shadow-sm">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Athlete Dashboard</Label>
                <p className="text-xs text-muted-foreground">Block athlete access</p>
              </div>
              <Switch 
                checked={settings.athleteDashboardMaintenance} 
                onCheckedChange={(v) => setSettings(s => ({...s, athleteDashboardMaintenance: v}))}
              />
            </div>
            <div className="flex items-center justify-between p-4 border rounded-xl bg-background shadow-sm">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Club Dashboard</Label>
                <p className="text-xs text-muted-foreground">Block club owner access</p>
              </div>
              <Switch 
                checked={settings.clubDashboardMaintenance} 
                onCheckedChange={(v) => setSettings(s => ({...s, clubDashboardMaintenance: v}))}
              />
            </div>
            <div className="flex items-center justify-between p-4 border rounded-xl bg-background shadow-sm">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Volunteer Portal</Label>
                <p className="text-xs text-muted-foreground">Block volunteer access</p>
              </div>
              <Switch 
                checked={settings.volunteerDashboardMaintenance} 
                onCheckedChange={(v) => setSettings(s => ({...s, volunteerDashboardMaintenance: v}))}
              />
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="maintenance-message">Custom Maintenance Message</Label>
            <Textarea 
              id="maintenance-message"
              placeholder="e.g., We&apos;re currently upgrading the rankings engine. Please check back after 2:00 PM."
              value={settings.maintenanceMessage}
              onChange={(e) => setSettings(s => ({...s, maintenanceMessage: e.target.value}))}
              rows={4}
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Info className="h-3 w-3"/> This message will be displayed to all non-admin users trying to access the blocked dashboards.</p>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/30 border-t flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldAlert className="mr-2 h-4 w-4" />}
            Apply System Controls
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest"><History className="h-4 w-4"/> Control History Log</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="rounded-md border overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead>Time</TableHead>
                            <TableHead>Changed By</TableHead>
                            <TableHead>Athlete</TableHead>
                            <TableHead>Club</TableHead>
                            <TableHead>Volunteer</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logs.map((log) => (
                            <TableRow key={log.id} className="text-xs">
                                <TableCell className="whitespace-nowrap"><div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3 w-3"/> {log.timestamp ? format(parseISO(log.timestamp), 'MMM dd, h:mm a') : 'N/A'}</div></TableCell>
                                <TableCell><div className="flex items-center gap-1.5 font-semibold"><User className="h-3 w-3"/> {log.changedBy?.name || 'Admin'}</div></TableCell>
                                <TableCell><Badge variant={log.athleteDashboardMaintenance ? 'destructive' : 'secondary'} className="text-[10px]">{log.athleteDashboardMaintenance ? 'OFFLINE' : 'LIVE'}</Badge></TableCell>
                                <TableCell><Badge variant={log.clubDashboardMaintenance ? 'destructive' : 'secondary'} className="text-[10px]">{log.clubDashboardMaintenance ? 'OFFLINE' : 'LIVE'}</Badge></TableCell>
                                <TableCell><Badge variant={log.volunteerDashboardMaintenance ? 'destructive' : 'secondary'} className="text-[10px]">{log.volunteerDashboardMaintenance ? 'OFFLINE' : 'LIVE'}</Badge></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
