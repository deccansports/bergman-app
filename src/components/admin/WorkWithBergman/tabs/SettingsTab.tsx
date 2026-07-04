"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KeyIcon, LinkIcon, RefreshCw, SettingsIcon, ShieldCheck } from 'lucide-react';
import {
  getWorkBergmanSettingsAction,
  saveWorkBergmanSettingsAction,
  testGoogleSheetConnectionAction,
  importWorkersFromGoogleSheet,
} from '@/lib/actions/workBergmanActions';

export default function SettingsTab() {
  const getRuntimeCareersUrl = () => {
    if (typeof window === 'undefined') return 'https://bergmantri.com/work-with-bergman';

    const origin = window.location.origin;
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return `${origin}/work-with-bergman`;
    }

    return `${origin}/work-with-bergman`;
  };

  const [sheetUrl, setSheetUrl] = useState('');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState('60');
  const [publicCareersUrl, setPublicCareersUrl] = useState('');
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(false);
  const [requiredDocuments, setRequiredDocuments] = useState('Aadhaar, Bank Details, PAN');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState<'idle' | 'success' | 'error'>('idle');
  const [activeTab, setActiveTab] = useState('sheet');

  const settingsTabs = [
    { id: 'sheet', label: 'Google Sheet Integration' },
    { id: 'recruitment', label: 'Recruitment Settings' },
  ];

  useEffect(() => {
    let mounted = true;

    (async () => {
      const result = await getWorkBergmanSettingsAction();
      if (!mounted) return;

      if (result.success && result.data) {
        setSheetUrl(result.data.googleSheetUrl || '');
        setAutoSyncEnabled(!!result.data.googleSheetSyncEnabled);
        setSyncInterval(String(result.data.autoSyncInterval ?? 60));
        const runtimeUrl = getRuntimeCareersUrl();
        const savedUrl = String(result.data.publicCareersUrl || '').trim();
        const normalizedSaved = savedUrl ? savedUrl.replace(/\/$/, '') : '';
        const normalizedRuntime = runtimeUrl.replace(/\/$/, '');

        // If old hardcoded default is present, switch to current host automatically.
        if (
          !normalizedSaved ||
          normalizedSaved.includes('localhost:3000/work-with-bergman') ||
          normalizedSaved.includes('127.0.0.1/work-with-bergman') ||
          normalizedSaved.includes('www.bergmanwithyou.com/work-with-bergman')
        ) {
          setPublicCareersUrl(normalizedRuntime);
        } else {
          setPublicCareersUrl(normalizedSaved);
        }
        setAutoApprovalEnabled(!!result.data.autoApprovalEnabled);
        setRequiredDocuments((result.data.requiredDocuments || ['Aadhaar', 'Bank Details', 'PAN']).join(', '));
      } else {
        setStatusMessage(result.error || 'Unable to load settings.');
        setStatusTone('error');
      }

      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const showStatus = (message: string, tone: 'success' | 'error') => {
    setStatusMessage(message);
    setStatusTone(tone);
  };

  const normalizePublicCareersUrl = (rawInput: string) => {
    const raw = String(rawInput || '').trim();
    const protocolForHost = (hostLike: string) => {
      const lower = String(hostLike || '').toLowerCase();
      if (lower.includes('localhost') || lower.startsWith('127.0.0.1')) return 'http:';
      return 'https:';
    };
    const withProtocol = raw
      ? (/^https?:\/\//i.test(raw) ? raw : `${protocolForHost(raw)}//${raw}`)
      : (typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin);

    try {
      const parsed = new URL(withProtocol);
      const protocol = parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.protocol
        : protocolForHost(parsed.host);
      return `${protocol}//${parsed.host}/work-with-bergman`;
    } catch {
      return getRuntimeCareersUrl();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage('');
    const result = await saveWorkBergmanSettingsAction({
      googleSheetUrl: sheetUrl.trim(),
      googleSheetSyncEnabled: autoSyncEnabled,
      autoSyncInterval: Number(syncInterval) || 60,
      publicCareersUrl: normalizePublicCareersUrl(publicCareersUrl),
      autoApprovalEnabled,
      requiredDocuments: requiredDocuments.split(',').map((item) => item.trim()).filter(Boolean),
    });
    setSaving(false);

    if (result.success) showStatus('Settings saved for production use.', 'success');
    else showStatus(result.error || 'Failed to save settings.', 'error');
  };

  const handleTestConnection = async () => {
    setWorking(true);
    setStatusMessage('');
    const result = await testGoogleSheetConnectionAction(sheetUrl.trim());
    setWorking(false);

    if (result.success) {
      showStatus(`${result.message} Headers: ${result.headers?.join(', ') || 'none'}.`, 'success');
      return;
    }

    showStatus(result.message, 'error');
  };

  const handleManualSync = async () => {
    setWorking(true);
    setStatusMessage('');
    const result = await importWorkersFromGoogleSheet(sheetUrl.trim(), {});
    setWorking(false);

    if (result.success) {
      showStatus(
        `Sync complete. Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`,
        'success'
      );
      return;
    }

    showStatus(result.error || 'Sync failed.', 'error');
  };

  if (loading) {
    return <div className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">Loading production settings…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-gray-600 mt-1">Production configuration for Work With Bergman</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="sm:hidden">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Select settings tab" />
            </SelectTrigger>
            <SelectContent>
              {settingsTabs.map((tab) => (
                <SelectItem key={tab.id} value={tab.id}>{tab.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsList className="hidden sm:grid w-full grid-cols-2">
          <TabsTrigger value="sheet">Google Sheet Integration</TabsTrigger>
          <TabsTrigger value="recruitment">Recruitment Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="sheet">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5" />
                Google Sheet Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Sheet URL</Label>
                <Input
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="mt-2"
                />
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoSyncEnabled}
                    onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                  />
                  Enable Auto-Sync
                </Label>
                <p className="text-sm text-gray-600 mt-1">Automatically import new workers from the sheet on the configured interval.</p>
              </div>

              <div>
                <Label>Sync Interval (minutes)</Label>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  value={syncInterval}
                  onChange={(e) => setSyncInterval(e.target.value)}
                  className="mt-2"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleTestConnection} disabled={working || saving}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Test Connection
                </Button>
                <Button variant="outline" onClick={handleManualSync} disabled={working || saving || !sheetUrl.trim()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Manual Sync
                </Button>
                <Button variant="outline" onClick={handleSave} disabled={saving || working}>
                  Save Changes
                </Button>
              </div>

              {statusMessage ? (
                <div className={`rounded-md border px-3 py-2 text-sm ${statusTone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  {statusMessage}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Secrets tab removed - secrets are managed via deployment secret manager */}

        <TabsContent value="recruitment">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" />
                Recruitment Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Public Careers Domain / URL</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={publicCareersUrl}
                    onChange={(e) => setPublicCareersUrl(e.target.value)}
                    placeholder="https://bergmantri.com/work-with-bergman"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPublicCareersUrl(normalizePublicCareersUrl(getRuntimeCareersUrl()))}
                  >
                    Auto Generate Link
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Link is auto-generated from the active website domain. Development shows localhost, production shows the live domain.
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Current URL: <span className="font-medium">{publicCareersUrl || getRuntimeCareersUrl()}</span>
                </p>
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoApprovalEnabled}
                    onChange={(e) => setAutoApprovalEnabled(e.target.checked)}
                  />
                  Enable Auto-Approval
                </Label>
                <p className="text-sm text-gray-600 mt-1">Automatically approve applicants that match the configured criteria.</p>
              </div>

              <div>
                <Label>Required Documents</Label>
                <Input
                  value={requiredDocuments}
                  onChange={(e) => setRequiredDocuments(e.target.value)}
                  className="mt-2"
                  placeholder="Aadhaar, Bank Details, PAN"
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated list of required documents.</p>
              </div>

              <Button variant="outline" onClick={handleSave} disabled={saving || working}>
                Save Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
