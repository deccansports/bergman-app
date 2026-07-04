'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  CheckCircle,
  CloudIcon,
  Database,
  Link as LinkIcon,
  Server,
  Shield,
  Zap,
} from 'lucide-react';

interface ProviderDashboardProps {
  eventId: string;
  eventName?: string;
  provider?: any;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function ProviderDashboard({
  eventId,
  eventName,
  provider,
  onRefresh,
  isLoading,
}: ProviderDashboardProps) {
  const isConnected = provider?.status === 'connected';
  const isVerified = provider?.authentication === 'verified';

  // Provider diagnostics
  const diagnostics = [
    {
      name: 'Connection',
      status: isConnected ? 'verified' : 'pending',
      detail: isConnected ? 'Connected to Feibot' : 'Not connected',
    },
    {
      name: 'Authentication',
      status: isVerified ? 'verified' : 'pending',
      detail: isVerified ? 'Credentials verified' : 'Not verified',
    },
    {
      name: 'Cloud API',
      status: provider?.cloudEventUuid ? 'verified' : 'pending',
      detail: provider?.cloudEventUuid ? 'Metadata loaded' : 'Metadata pending',
    },
    {
      name: 'Timing Rules',
      status: provider?.timingRulesImported ? 'verified' : 'pending',
      detail: provider?.timingRulesImported ? 'Rules cached' : 'Rules not cached',
    },
    {
      name: 'Participants',
      status: provider?.participantsImported ? 'verified' : 'pending',
      detail: provider?.participantsImported ? 'Participants synced' : 'Sync pending',
    },
    {
      name: 'Results',
      status: provider?.resultsImported ? 'verified' : 'pending',
      detail: provider?.resultsImported ? 'Results available' : 'No results',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Provider: Feibot</h2>
              <p className="text-sm text-gray-600 mt-1">
                Cloud API-based event provider configuration
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant={isConnected ? 'default' : 'secondary'}>
                {isConnected ? '● Connected' : '◌ Disconnected'}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={onRefresh}
                disabled={isLoading}
              >
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Overview */}
      {!isConnected && (
        <Alert className="border-yellow-200 bg-yellow-50">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            Provider is not configured. Complete the setup wizard to connect Feibot.
          </AlertDescription>
        </Alert>
      )}

      {isConnected && !isVerified && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-800">
            Provider credentials are not verified. Please verify authentication in the setup wizard.
          </AlertDescription>
        </Alert>
      )}

      {isConnected && isVerified && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Provider is fully configured and ready for live tracking.
          </AlertDescription>
        </Alert>
      )}

      {/* Cloud Event Information */}
      {provider?.cloudEventUuid && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudIcon className="h-5 w-5" />
              Cloud Event Information
            </CardTitle>
            <CardDescription>Data sourced from Feibot Cloud API</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 p-3 rounded border border-blue-200">
                <div className="text-xs text-blue-600 font-semibold">Event UUID</div>
                <div className="text-sm font-mono text-gray-900 mt-1 truncate">
                  {provider.cloudEventUuid}
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded border border-blue-200">
                <div className="text-xs text-blue-600 font-semibold">Score Event UUID</div>
                <div className="text-sm font-mono text-gray-900 mt-1 truncate">
                  {provider.scoreEventUuid || 'N/A'}
                </div>
              </div>
            </div>
            <div className="border-t pt-3">
              <div className="text-xs text-gray-600 font-semibold">Timing Rules Summary</div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[
                  { label: 'Contests', value: provider.cloud?.contests || 0 },
                  { label: 'Splits', value: provider.cloud?.splits || 0 },
                  { label: 'Timing Points', value: provider.cloud?.timingPoints || 0 },
                  { label: 'Age Groups', value: provider.cloud?.ageGroups || 0 },
                ].map((item, idx) => (
                  <div key={idx} className="bg-gray-50 p-2 rounded text-center">
                    <div className="text-lg font-bold text-indigo-600">{item.value}</div>
                    <div className="text-xs text-gray-600">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-gray-600">Provider</span>
            <Badge>Feibot</Badge>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-gray-600">Status</span>
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-gray-600">Configuration Source</span>
            <Badge>Cloud API</Badge>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-600">API Base URL</span>
            <span className="text-xs font-mono text-gray-700">
              {provider?.apiBaseUrl || 'apicn.feibot.com'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Authentication */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-gray-600">Status</span>
            <Badge variant={isVerified ? 'default' : 'secondary'}>
              {isVerified ? 'Verified' : 'Not Verified'}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-gray-600">Method</span>
            <span className="text-sm font-semibold text-gray-900">Basic HTTP Auth</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-600">Access Key Status</span>
            <Badge variant={provider?.accessKey ? 'default' : 'secondary'}>
              {provider?.accessKey ? 'Configured' : 'Not Set'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Cloud Data Metrics */}
      {provider?.cloud && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Cloud Data Metrics
            </CardTitle>
            <CardDescription>Live statistics from Feibot Cloud API</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Contests', value: provider.cloud.contests || 0 },
                { label: 'Participants', value: provider.cloud.participants || 0 },
                { label: 'Splits', value: provider.cloud.splits || 0 },
                { label: 'Timing Points', value: provider.cloud.timingPoints || 0 },
                { label: 'Age Groups', value: provider.cloud.ageGroups || 0 },
                { label: 'Devices', value: provider.cloud.devices || 0 },
              ].map((metric, idx) => (
                <div key={idx} className="bg-indigo-50 border border-indigo-200 p-3 rounded">
                  <div className="text-xs text-indigo-600 font-semibold">{metric.label}</div>
                  <div className="text-2xl font-bold text-indigo-900 mt-1">{metric.value}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* API Status */}
      {provider?.lastApiCall && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Last API Call
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Endpoint</span>
              <span className="font-mono text-gray-900">{provider.lastApiCall.endpoint || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Status Code</span>
              <span className="font-semibold">{provider.lastApiCall.statusCode || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Response Time</span>
              <span className="font-semibold">{provider.lastApiCall.responseTimeMs || '—'} ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Timestamp</span>
              <span className="font-mono text-xs text-gray-700">
                {provider.lastApiCall.timestamp ? new Date(provider.lastApiCall.timestamp).toLocaleString() : '—'}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Diagnostics */}
      <Card>
        <CardHeader>
          <CardTitle>System Diagnostics</CardTitle>
          <CardDescription>Health status of all provider components</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {diagnostics.map((diag, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded border"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900">{diag.name}</div>
                  <div className="text-xs text-gray-600">{diag.detail}</div>
                </div>
                {diag.status === 'verified' ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <div className="h-5 w-5 border-2 border-yellow-400 rounded-full" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data Source Information */}
      <Card className="border-indigo-200 bg-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Source: Cloud API Only
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-indigo-900">
          <p>
            This provider configuration uses only Feibot Cloud API as the source of truth.
            All timing rules, participants, and results are fetched live from the cloud,
            ensuring real-time synchronization and eliminating local database dependencies.
          </p>
          <div className="mt-3 p-2 bg-white rounded border border-indigo-200 text-xs font-mono">
            <div>Configuration Type: <span className="font-bold">cloud_api</span></div>
            <div>Data Freshness: <span className="font-bold">Real-time</span></div>
            <div>Fallback: <span className="font-bold">None (Cloud Only)</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

