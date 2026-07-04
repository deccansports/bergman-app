'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, AlertCircle, Loader2, Wifi, KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type DiagnosticCheck = {
  key: string;
  label: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  httpStatus: number;
  message?: string;
};

type CredentialValidationResult = {
  credentialType: 'event' | 'account';
  success: boolean;
  message: string;
  checks?: DiagnosticCheck[];
  connected?: boolean;
  eventsCount?: number;
  eventUuidBound?: string;
  lastAuthAt?: string;
};

type FeibotCredentialCardsProps = {
  bergmanEventId: string;
  resolvedEventUuid: string;
  lockedApiBaseUrl: string;
  apiBaseUrl: string;
  credentials: any;
  onEventCredentialSave?: (data: { accessKey: string; secretKey: string; eventUuid: string }) => void;
  onAccountCredentialSave?: (data: { accessKey: string; secretKey: string; accountId: string }) => void;
  onEventCredentialTest?: (data: { accessKey: string; secretKey: string; eventUuid: string }) => void;
  onAccountCredentialTest?: (data: { accessKey: string; secretKey: string; accountId: string }) => void;
  loadStatus?: () => Promise<void>;
};

export default function FeibotCredentialCards({
  bergmanEventId,
  resolvedEventUuid,
  lockedApiBaseUrl,
  apiBaseUrl,
  credentials,
  onEventCredentialSave,
  onAccountCredentialSave,
  onEventCredentialTest,
  onAccountCredentialTest,
  loadStatus,
}: FeibotCredentialCardsProps) {
  // Event Credential State
  const [eventAccessKey, setEventAccessKey] = useState('');
  const [eventSecretKey, setEventSecretKey] = useState('');
  const [boundEventUuidInput, setBoundEventUuidInput] = useState('');
  const [savingEventCredential, setSavingEventCredential] = useState(false);
  const [testingEventConnection, setTestingEventConnection] = useState(false);
  const [eventValidation, setEventValidation] = useState<CredentialValidationResult | null>(null);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);

  useEffect(() => {
    const stored = String(credentials?.credentialBoundEventUuid || credentials?.storedBoundEventUuid || '').trim();
    if (stored) {
      setBoundEventUuidInput((prev) => (String(prev || '').trim() ? prev : stored));
    }
  }, [credentials?.credentialBoundEventUuid, credentials?.storedBoundEventUuid]);

  const linkedEventUuid = String(credentials?.linkedEventUuid || credentials?.cloudEventUuid || credentials?.eventUuid || resolvedEventUuid || '').trim();
  const credentialBoundEventUuid = String(credentials?.credentialBoundEventUuid || credentials?.storedBoundEventUuid || '').trim();
  const runtimeEventUuid = String(credentials?.runtimeEventUuid || '').trim();
  const credentialMismatch = Boolean(linkedEventUuid && credentialBoundEventUuid && linkedEventUuid !== credentialBoundEventUuid);

  // Account Credential State
  const [accountId, setAccountId] = useState('feibot');
  const [accountAccessKey, setAccountAccessKey] = useState('');
  const [accountSecretKey, setAccountSecretKey] = useState('');
  const [savingAccountCredential, setSavingAccountCredential] = useState(false);
  const [testingAccountConnection, setTestingAccountConnection] = useState(false);
  const [accountValidation, setAccountValidation] = useState<CredentialValidationResult | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Event Credential Handlers
  const handleSaveEventCredential = useCallback(async () => {
    const boundEventUuid = String(boundEventUuidInput || '').trim();
    if (!eventAccessKey || !eventSecretKey || !boundEventUuid) {
      setEventError('Access Key, Secret Key, and Bound Feibot Event UUID are required');
      return;
    }

    setSavingEventCredential(true);
    setEventMessage(null);
    setEventError(null);

    try {
      if (onEventCredentialSave) {
        await onEventCredentialSave({
          accessKey: eventAccessKey,
          secretKey: eventSecretKey,
          eventUuid: boundEventUuid,
        });
      } else {
        const response = await fetch('/api/live/provider/credentials', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            credentialType: 'event',
            accessKey: eventAccessKey,
            secretKey: eventSecretKey,
            boundEventUuid,
            eventId: bergmanEventId.trim(),
            apiBaseUrl: lockedApiBaseUrl,
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
        }

        setEventMessage('Event credentials saved successfully.');
        setEventAccessKey('');
        setEventSecretKey('');
        setBoundEventUuidInput('');
        setEventValidation(null);
      }

      if (loadStatus) {
        await loadStatus();
      }
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Failed to save event credentials.');
    } finally {
      setSavingEventCredential(false);
    }
  }, [eventAccessKey, eventSecretKey, boundEventUuidInput, bergmanEventId, lockedApiBaseUrl, onEventCredentialSave, loadStatus]);

  const handleTestEventConnection = useCallback(async () => {
    const boundEventUuid = String(boundEventUuidInput || '').trim();
    if (!eventAccessKey || !eventSecretKey || !boundEventUuid) {
      setEventError('Access Key, Secret Key, and Bound Feibot Event UUID are required');
      return;
    }

    setTestingEventConnection(true);
    setEventMessage(null);
    setEventError(null);

    try {
      if (onEventCredentialTest) {
        await onEventCredentialTest({
          accessKey: eventAccessKey,
          secretKey: eventSecretKey,
          eventUuid: boundEventUuid,
        });
      } else {
        const response = await fetch('/api/live/provider/verify-auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: 'feibot',
            credentialType: 'event',
            eventUuid: boundEventUuid,
            eventId: bergmanEventId.trim(),
            apiBaseUrl: lockedApiBaseUrl,
            accessKey: eventAccessKey,
            secretKey: eventSecretKey,
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          setEventValidation({
            credentialType: 'event',
            success: false,
            message: data?.message || `Request failed with HTTP ${response.status}`,
            checks: data?.checks || [],
          });
          throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
        }

        setEventValidation({
          credentialType: 'event',
          success: true,
          message: 'Event credential is valid and connected.',
          checks: data?.checks || [],
          connected: true,
          eventUuidBound: boundEventUuid,
          lastAuthAt: new Date().toISOString(),
        });
        setEventMessage('Event credential verified successfully.');
      }
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Failed to verify event credential.');
    } finally {
      setTestingEventConnection(false);
    }
  }, [eventAccessKey, eventSecretKey, boundEventUuidInput, bergmanEventId, lockedApiBaseUrl, onEventCredentialTest]);

  // Account Credential Handlers
  const handleSaveAccountCredential = useCallback(async () => {
    if (!accountAccessKey || !accountSecretKey) {
      setAccountError('Access Key and Secret Key are required');
      return;
    }

    setSavingAccountCredential(true);
    setAccountMessage(null);
    setAccountError(null);

    try {
      if (onAccountCredentialSave) {
        await onAccountCredentialSave({
          accessKey: accountAccessKey,
          secretKey: accountSecretKey,
          accountId: accountId,
        });
      } else {
        const response = await fetch('/api/admin/live-tracking/feibot/save-credentials', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            credentialType: 'account',
            accessKey: accountAccessKey,
            secretKey: accountSecretKey,
            account: accountId,
            eventId: bergmanEventId.trim(),
            apiBaseUrl: lockedApiBaseUrl,
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
        }

        setAccountMessage('Account credentials saved successfully.');
        setAccountAccessKey('');
        setAccountSecretKey('');
        setAccountValidation(null);
      }

      if (loadStatus) {
        await loadStatus();
      }
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to save account credentials.');
    } finally {
      setSavingAccountCredential(false);
    }
  }, [accountAccessKey, accountSecretKey, accountId, bergmanEventId, lockedApiBaseUrl, onAccountCredentialSave, loadStatus]);

  const handleTestAccountConnection = useCallback(async () => {
    if (!accountAccessKey || !accountSecretKey) {
      setAccountError('Access Key and Secret Key are required');
      return;
    }

    setTestingAccountConnection(true);
    setAccountMessage(null);
    setAccountError(null);

    try {
      if (onAccountCredentialTest) {
        await onAccountCredentialTest({
          accessKey: accountAccessKey,
          secretKey: accountSecretKey,
          accountId: accountId,
        });
      } else {
        const response = await fetch('/api/live/provider/verify-auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: 'feibot',
            credentialType: 'account',
            eventId: bergmanEventId.trim(),
            apiBaseUrl: lockedApiBaseUrl,
            accessKey: accountAccessKey,
            secretKey: accountSecretKey,
            accountId: accountId,
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          setAccountValidation({
            credentialType: 'account',
            success: false,
            message: data?.message || `Request failed with HTTP ${response.status}`,
            checks: data?.checks || [],
          });
          throw new Error(data?.message || `Request failed with HTTP ${response.status}`);
        }

        setAccountValidation({
          credentialType: 'account',
          success: true,
          message: 'Account credential is valid and connected.',
          checks: data?.checks || [],
          connected: true,
          eventsCount: data?.eventsCount || 0,
          lastAuthAt: new Date().toISOString(),
        });
        setAccountMessage('Account credential verified successfully.');
      }
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to verify account credential.');
    } finally {
      setTestingAccountConnection(false);
    }
  }, [accountAccessKey, accountSecretKey, accountId, bergmanEventId, lockedApiBaseUrl, onAccountCredentialTest]);

  const getCredentialStatus = (credentialType: 'event' | 'account') => {
    const validation = credentialType === 'event' ? eventValidation : accountValidation;
    if (!validation) return null;

    return {
      connected: validation.connected,
      checks: validation.checks || [],
      message: validation.message,
    };
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* ===== AK-EVENT Card ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                AK-EVENT (Event Credentials)
              </CardTitle>
              <CardDescription className="mt-1">
                Event-scoped credentials generated after opening a specific event in Feibot. Valid only for the bound event.
              </CardDescription>
            </div>
            {eventValidation?.connected ? (
              <Badge variant="default" className="flex-shrink-0">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {eventError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{eventError}</AlertDescription>
            </Alert>
          ) : null}

          {eventMessage ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{eventMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">Access Key</label>
            <Input
              value={eventAccessKey}
              onChange={(e) => setEventAccessKey(e.target.value)}
              placeholder="Enter Event Access Key"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Secret Key</label>
            <Input
              value={eventSecretKey}
              onChange={(e) => setEventSecretKey(e.target.value)}
              placeholder="Enter Event Secret Key"
              type="password"
              autoComplete="new-password"
            />
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Linked Feibot Event UUID</div>
              <div className="font-mono text-sm break-all">{linkedEventUuid || 'Not configured'}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Credential Bound Event UUID</div>
              <div className="font-mono text-sm break-all">{credentialBoundEventUuid || 'Not configured'}</div>
            </div>
            {credentialMismatch ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>⚠ Event Credential is bound to a different Feibot Event than the linked event.</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Diagnostic</div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Credential Type:</span>
                <span className="font-medium">Event</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Linked Event UUID:</span>
                <span className="font-mono break-all text-right">{linkedEventUuid || '—'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Credential Bound UUID:</span>
                <span className="font-mono break-all text-right">{credentialBoundEventUuid || '—'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Runtime UUID:</span>
                <span className="font-mono break-all text-right">{runtimeEventUuid || '—'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Credential Bound Event UUID</label>
            <Input
              value={boundEventUuidInput}
              onChange={(e) => setBoundEventUuidInput(e.target.value)}
              placeholder="Enter the Feibot event_uuid used to generate this AK-EVENT"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void handleSaveEventCredential()}
              disabled={savingEventCredential || !eventAccessKey || !eventSecretKey || !String(boundEventUuidInput || '').trim()}
              className="flex-1"
            >
              {savingEventCredential ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              {savingEventCredential ? 'Saving…' : 'Save Event Credentials'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleTestEventConnection()}
              disabled={testingEventConnection || !eventAccessKey || !eventSecretKey || !String(boundEventUuidInput || '').trim()}
            >
              {testingEventConnection ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="mr-2 h-4 w-4" />
              )}
              {testingEventConnection ? 'Testing…' : 'Test Connection'}
            </Button>
          </div>

          {eventValidation ? (
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                {eventValidation.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
                <span className="font-medium">{eventValidation.message}</span>
              </div>

              {eventValidation.connected && eventValidation.eventUuidBound && (
                <div className="mt-3 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Bound to Event:</span>
                    <span className="ml-2 font-mono">{eventValidation.eventUuidBound}</span>
                  </div>
                  {eventValidation.lastAuthAt && (
                    <div>
                      <span className="text-muted-foreground">Last Auth:</span>
                      <span className="ml-2">{new Date(eventValidation.lastAuthAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

              {eventValidation.checks && eventValidation.checks.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Validation Checks</div>
                  {eventValidation.checks.map((check) => (
                    <div
                      key={check.key}
                      className="flex items-center gap-2 rounded p-2 text-xs"
                      style={{
                        backgroundColor:
                          check.status === 'PASS' ? 'rgb(220, 252, 231)' : check.status === 'WARNING' ? 'rgb(254, 243, 199)' : 'rgb(254, 226, 226)',
                        color:
                          check.status === 'PASS' ? 'rgb(6, 95, 70)' : check.status === 'WARNING' ? 'rgb(92, 51, 23)' : 'rgb(127, 29, 29)',
                      }}
                    >
                      {check.status === 'PASS' ? (
                        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      )}
                      <span className="flex-1">{check.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ===== AK-ACCOUNT Card ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                AK-ACCOUNT (Account Credentials)
              </CardTitle>
              <CardDescription className="mt-1">
                Account-scoped credentials with access to all events owned by the Feibot account (subject to API permissions).
              </CardDescription>
            </div>
            {accountValidation?.connected ? (
              <Badge variant="default" className="flex-shrink-0">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {accountError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{accountError}</AlertDescription>
            </Alert>
          ) : null}

          {accountMessage ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{accountMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">Account ID</label>
            <Input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="feibot"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Access Key</label>
            <Input
              value={accountAccessKey}
              onChange={(e) => setAccountAccessKey(e.target.value)}
              placeholder="Enter Account Access Key"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Secret Key</label>
            <Input
              value={accountSecretKey}
              onChange={(e) => setAccountSecretKey(e.target.value)}
              placeholder="Enter Account Secret Key"
              type="password"
              autoComplete="new-password"
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium text-muted-foreground">API Base URL</div>
            <div className="mt-1 font-mono text-sm break-all">{lockedApiBaseUrl}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void handleSaveAccountCredential()}
              disabled={savingAccountCredential || !accountAccessKey || !accountSecretKey}
              className="flex-1"
            >
              {savingAccountCredential ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              {savingAccountCredential ? 'Saving…' : 'Save Account Credentials'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleTestAccountConnection()}
              disabled={testingAccountConnection || !accountAccessKey || !accountSecretKey}
            >
              {testingAccountConnection ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="mr-2 h-4 w-4" />
              )}
              {testingAccountConnection ? 'Testing…' : 'Test Connection'}
            </Button>
          </div>

          {accountValidation ? (
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                {accountValidation.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
                <span className="font-medium">{accountValidation.message}</span>
              </div>

              {accountValidation.connected && (
                <div className="mt-3 space-y-2 text-sm">
                  {accountValidation.eventsCount !== undefined && (
                    <div>
                      <span className="text-muted-foreground">Accessible Events:</span>
                      <span className="ml-2 font-medium">{accountValidation.eventsCount}</span>
                    </div>
                  )}
                  {accountValidation.lastAuthAt && (
                    <div>
                      <span className="text-muted-foreground">Last Auth:</span>
                      <span className="ml-2">{new Date(accountValidation.lastAuthAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

              {accountValidation.checks && accountValidation.checks.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Validation Checks</div>
                  {accountValidation.checks.map((check) => (
                    <div
                      key={check.key}
                      className="flex items-center gap-2 rounded p-2 text-xs"
                      style={{
                        backgroundColor:
                          check.status === 'PASS' ? 'rgb(220, 252, 231)' : check.status === 'WARNING' ? 'rgb(254, 243, 199)' : 'rgb(254, 226, 226)',
                        color:
                          check.status === 'PASS' ? 'rgb(6, 95, 70)' : check.status === 'WARNING' ? 'rgb(92, 51, 23)' : 'rgb(127, 29, 29)',
                      }}
                    >
                      {check.status === 'PASS' ? (
                        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      )}
                      <span className="flex-1">{check.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
