'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  clearBergTechnoDeliveryLogsAction,
  getBergTechnoDeliveryLogsAction,
  getBergTechnoIntegrationAction,
  saveBergTechnoIntegrationAction,
  testBergTechnoConnectionAction,
} from '@/lib/actions/templateActions';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

const DEFAULT_WEBHOOK_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.unsubscribed',
  'email.bounced',
  'email.spam',
];

export default function IntegrationTab() {
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isClearingLogs, setIsClearingLogs] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'not_connected'>('unknown');
  const [connectionMessage, setConnectionMessage] = useState('Not checked yet.');
  const [showDeliveryLogs, setShowDeliveryLogs] = useState(false);
  const [deliveryLogs, setDeliveryLogs] = useState<Array<{ id: string; event: string; status: string; recipient: string; messageId: string; createdAt: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [data, setData] = useState({
    apiBaseUrl: '',
    senderEmail: 'info@bergmantri.com',
    senderName: 'Bergman Triathlon',
    apiKeyHeader: 'x-api-key',
    templateSendPath: '/email/send-template',
    rawSendPath: '/email/send',
    timeoutMs: 15000,
    hasApiKey: false,
    apiKeyMasked: '',
    webhookUrl: 'https://raceupshot.com/api/webhooks/bergtecno',
    webhookEvents: [...DEFAULT_WEBHOOK_EVENTS],
    webhookActive: true,
  });

  const loadDeliveryLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    const res = await getBergTechnoDeliveryLogsAction(100);
    if (res.success && res.logs) {
      setDeliveryLogs(res.logs);
    } else {
      toast({ variant: 'destructive', title: 'Failed to load delivery logs', description: res.message || 'Could not load logs.' });
    }
    setIsLoadingLogs(false);
  }, [toast]);

  const checkConnection = useCallback(async (override?: { apiBaseUrl?: string; apiKey?: string; apiKeyHeader?: string }) => {
    setIsCheckingConnection(true);
    const res = await testBergTechnoConnectionAction(override);
    if (res.connected) {
      setConnectionStatus('connected');
      setConnectionMessage(res.checkedUrl ? `Connected via ${res.checkedUrl}` : 'Connected');
    } else {
      setConnectionStatus('not_connected');
      setConnectionMessage(res.message || 'Not connected');
    }
    setIsCheckingConnection(false);
  }, []);

  const load = useCallback(async (autoCheck = false) => {
    setIsLoading(true);
    const res = await getBergTechnoIntegrationAction();
    if (res.success && res.data) {
      setData({
        apiBaseUrl: res.data.apiBaseUrl || '',
        senderEmail: res.data.senderEmail || 'info@bergmantri.com',
        senderName: res.data.senderName || 'Bergman Triathlon',
        apiKeyHeader: res.data.apiKeyHeader || 'x-api-key',
        templateSendPath: res.data.templateSendPath || '/email/send-template',
        rawSendPath: res.data.rawSendPath || '/email/send',
        timeoutMs: Number(res.data.timeoutMs || 15000),
        hasApiKey: !!res.data.hasApiKey,
        apiKeyMasked: res.data.apiKeyMasked || '',
        webhookUrl: res.data.webhookUrl || 'https://raceupshot.com/api/webhooks/bergtecno',
        webhookEvents: res.data.webhookEvents?.length ? res.data.webhookEvents : [...DEFAULT_WEBHOOK_EVENTS],
        webhookActive: res.data.webhookActive !== false,
      });
      setApiKey('');
      await loadDeliveryLogs();
      // Auto-check connection if settings are already configured
      if (autoCheck && res.data.apiBaseUrl && res.data.hasApiKey) {
        setIsLoading(false);
        await checkConnection({ apiBaseUrl: res.data.apiBaseUrl, apiKeyHeader: res.data.apiKeyHeader });
        return;
      }
    } else {
      toast({ variant: 'destructive', title: 'Load Failed', description: res.message || 'Failed to load integration settings.' });
    }
    setIsLoading(false);
  }, [toast, checkConnection, loadDeliveryLogs]);

  useEffect(() => {
    load(true); // auto-check on initial mount if settings are already saved
  }, [load]);

  // Connection status is NOT reset when fields change.
  // It only updates via Test Connection button or after Save.

  const save = async () => {
    if (!data.apiBaseUrl.trim()) {
      toast({ variant: 'destructive', title: 'API base URL required' });
      return;
    }
    if (!data.hasApiKey && !apiKey.trim()) {
      toast({ variant: 'destructive', title: 'API key required' });
      return;
    }

    setIsSaving(true);
    const res = await saveBergTechnoIntegrationAction({
      apiBaseUrl: data.apiBaseUrl,
      apiKey,
      senderEmail: data.senderEmail,
      senderName: data.senderName,
      apiKeyHeader: data.apiKeyHeader,
      templateSendPath: data.templateSendPath,
      rawSendPath: data.rawSendPath,
      timeoutMs: Number(data.timeoutMs || 15000),
      webhookUrl: data.webhookUrl,
      webhookEvents: data.webhookEvents,
      webhookActive: data.webhookActive,
    });

    if (res.success) {
      toast({ title: 'Saved', description: res.message });
      await load(true); // reload + auto-check connection after save
    } else {
      toast({ variant: 'destructive', title: 'Save Failed', description: res.message });
    }
    setIsSaving(false);
  };

  const clearLogs = async () => {
    setIsClearingLogs(true);
    const res = await clearBergTechnoDeliveryLogsAction();
    if (res.success) {
      toast({ title: 'Delivery logs cleared', description: res.message });
      await loadDeliveryLogs();
    } else {
      toast({ variant: 'destructive', title: 'Failed to clear logs', description: res.message });
    }
    setIsClearingLogs(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Integration</CardTitle>
          <Badge
            variant={connectionStatus === 'connected' ? 'default' : connectionStatus === 'not_connected' ? 'destructive' : 'secondary'}
            className="uppercase tracking-wider"
          >
            {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'not_connected' ? 'Not Connected' : 'Unknown'}
          </Badge>
        </div>
        <CardDescription>
          Configure Bergtecno API email delivery. Template numbering remains unchanged.
        </CardDescription>
        <p className="text-xs text-muted-foreground">Status: {connectionMessage}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading integration settings...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label>API Base URL *</Label>
                <Input
                  value={data.apiBaseUrl}
                  onChange={(e) => setData((p) => ({ ...p, apiBaseUrl: e.target.value }))}
                  placeholder="https://bergtecno.com/api"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label>API Key {data.hasApiKey ? '(saved)' : '*'}</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={data.hasApiKey ? `Leave blank to keep ${data.apiKeyMasked}` : 'Enter API key'}
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label>API Key Header</Label>
                <Input
                  value={data.apiKeyHeader}
                  onChange={(e) => setData((p) => ({ ...p, apiKeyHeader: e.target.value }))}
                  placeholder="x-api-key"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Sender Email</Label>
                <Input
                  value={data.senderEmail}
                  onChange={(e) => setData((p) => ({ ...p, senderEmail: e.target.value }))}
                  placeholder="info@bergmantri.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Sender Name</Label>
                <Input
                  value={data.senderName}
                  onChange={(e) => setData((p) => ({ ...p, senderName: e.target.value }))}
                  placeholder="Bergman Triathlon"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Template Send Path</Label>
                <Input
                  value={data.templateSendPath}
                  onChange={(e) => setData((p) => ({ ...p, templateSendPath: e.target.value }))}
                  placeholder="/email/send-template"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Raw Send Path</Label>
                <Input
                  value={data.rawSendPath}
                  onChange={(e) => setData((p) => ({ ...p, rawSendPath: e.target.value }))}
                  placeholder="/email/send"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  value={data.timeoutMs}
                  onChange={(e) => setData((p) => ({ ...p, timeoutMs: Number(e.target.value || 15000) }))}
                  className="font-mono"
                />
              </div>
            </div>

            <Separator />

            <div className="rounded-md border p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Bergtecno Webhooks</p>
                  <p className="text-xs text-muted-foreground">Configure delivery callbacks and monitor events.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Active</Label>
                  <Switch
                    checked={data.webhookActive}
                    onCheckedChange={(v) => setData((p) => ({ ...p, webhookActive: v }))}
                  />
                  <Button variant="ghost" size="icon" onClick={clearLogs} disabled={isClearingLogs}>
                    {isClearingLogs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Webhook URL</Label>
                <Input
                  value={data.webhookUrl}
                  onChange={(e) => setData((p) => ({ ...p, webhookUrl: e.target.value }))}
                  className="font-mono"
                  placeholder="https://raceupshot.com/api/webhooks/bergtecno"
                />
              </div>

              <div className="space-y-2">
                <Label>Subscribed Events</Label>
                <div className="flex flex-wrap gap-2">
                  {data.webhookEvents.map((eventName) => (
                    <Badge key={eventName} variant="secondary" className="font-mono text-[11px]">
                      {eventName}
                    </Badge>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDeliveryLogs((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                {showDeliveryLogs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showDeliveryLogs ? 'Hide delivery logs' : 'Show delivery logs'}
              </button>

              {showDeliveryLogs && (
                <div className="rounded-md border overflow-hidden">
                  {isLoadingLogs ? (
                    <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries...
                    </div>
                  ) : deliveryLogs.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground">No deliveries recorded yet.</div>
                  ) : (
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="text-left p-2">Event</th>
                            <th className="text-left p-2">Recipient</th>
                            <th className="text-left p-2">Status</th>
                            <th className="text-left p-2">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deliveryLogs.map((log) => (
                            <tr key={log.id} className="border-t">
                              <td className="p-2 font-mono">{log.event}</td>
                              <td className="p-2">{log.recipient}</td>
                              <td className="p-2">{log.status}</td>
                              <td className="p-2 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save Integration
              </Button>
              <Button
                variant="outline"
                onClick={() => checkConnection({ apiBaseUrl: data.apiBaseUrl, apiKey: apiKey || undefined, apiKeyHeader: data.apiKeyHeader })}
                disabled={isCheckingConnection || isSaving}
              >
                {isCheckingConnection ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Test Connection
              </Button>
              <Button variant="outline" onClick={() => load(true)} disabled={isLoading || isSaving}>
                <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                Reload
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
