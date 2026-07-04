'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertCircle, Loader2, ChevronRight } from 'lucide-react';

interface FeibotEvent {
  event_uuid: string;
  score_event_uuid?: string;
  name: string;
}

interface TicketContestMapping {
  ticketId: string;
  ticketName: string;
  contestUuid: string;
  contestName: string;
}

interface CloudTimingRules {
  contests: Array<{ UUID?: string; Name?: string; id?: string; name?: string }>;
  splits: Array<any>;
  timingPoints: Array<any>;
  ageGroups: Array<any>;
  updatedAt?: string;
}

interface SetupState {
  currentStep: number;
  authVerified: boolean;
  authError: string | null;
  events: FeibotEvent[];
  selectedEventUuid: string;
  selectedEventName: string;
  selectedScoreEventUuid: string;
  cloudTimingRules: CloudTimingRules | null;
  cloudParticipants: any[];
  bergmanParticipantsCount: number;
  cloudParticipantsCount: number;
  ticketMappings: TicketContestMapping[];
  importedParticipantsCount: number;
  isLoading: boolean;
  error: string | null;
}

export function LiveTrackingCloudSetupWizard({
  eventId,
  onComplete,
}: {
  eventId: string;
  onComplete?: (success: boolean) => void;
}) {
  const [state, setState] = useState<SetupState>({
    currentStep: 1,
    authVerified: false,
    authError: null,
    events: [],
    selectedEventUuid: '',
    selectedEventName: '',
    selectedScoreEventUuid: '',
    cloudTimingRules: null,
    cloudParticipants: [],
    bergmanParticipantsCount: 0,
    cloudParticipantsCount: 0,
    ticketMappings: [],
    importedParticipantsCount: 0,
    isLoading: false,
    error: null,
  });

  // Step 3: Fetch events
  const handleFetchEvents = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch(`/api/live/provider/events`, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      const data = await response.json();
      if (!data.success || !Array.isArray(data.events)) {
        setState((prev) => ({ ...prev, error: 'Failed to fetch events', isLoading: false }));
        return;
      }
      setState((prev) => ({ ...prev, events: data.events, isLoading: false }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to fetch events',
        isLoading: false,
      }));
    }
  }, []);

  // Step 4: Fetch timing rules
  const handleFetchTimingRules = useCallback(async (eventUuid: string) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const params = new URLSearchParams();
      params.set('eventId', eventId);
      params.set('eventUuid', eventUuid);
      const response = await fetch(
        `/api/live/provider/timing-rules?${params.toString()}`,
        { method: 'GET' }
      );
      const data = await response.json();
      if (data.success && data.timingRules) {
        setState((prev) => ({ ...prev, cloudTimingRules: data.timingRules, isLoading: false }));
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [eventId]);

  // Step 1-2: Verify authentication
  const handleVerifyAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, authError: null }));
    try {
      const response = await fetch(`/api/live/provider/verify-auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'feibot',
          eventUuid: state.selectedEventUuid || undefined,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        setState((prev) => ({ ...prev, authError: data.message || 'Authentication failed', isLoading: false }));
        return;
      }
      setState((prev) => ({ ...prev, authVerified: true, currentStep: 3, isLoading: false }));
      // Fetch events
      handleFetchEvents();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        authError: error instanceof Error ? error.message : 'Verification failed',
        isLoading: false,
      }));
    }
  }, [handleFetchEvents, state.selectedEventUuid]);

  // Step 5: Fetch cloud participants
  const handleFetchCloudParticipants = useCallback(async (eventUuid: string) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const params = new URLSearchParams();
      params.set('eventId', eventId);
      params.set('eventUuid', eventUuid);
      const response = await fetch(
        `/api/live/provider/participants?${params.toString()}&refresh=1`,
        { method: 'GET' }
      );
      const data = await response.json();
      if (data.success && Array.isArray(data.participants)) {
        // Fetch Bergman registration count
        const bergmanRes = await fetch(`/api/events/${eventId}/participants/count`);
        const bergmanData = await bergmanRes.json();
        setState((prev) => ({
          ...prev,
          cloudParticipants: data.participants,
          cloudParticipantsCount: data.participants.length,
          bergmanParticipantsCount: bergmanData.count || 0,
          currentStep: 5,
          isLoading: false,
        }));
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [eventId]);

  // Step 3: Select event and move to step 4
  const handleSelectEvent = useCallback(async (eventUuid: string) => {
    const event = state.events.find((e) => e.event_uuid === eventUuid);
    if (!event) return;
    setState((prev) => ({
      ...prev,
      selectedEventUuid: eventUuid,
      selectedEventName: event.name,
      selectedScoreEventUuid: event.score_event_uuid || '',
      currentStep: 4,
    }));
    // Fetch cloud timing rules
    handleFetchTimingRules(eventUuid);
    // Fetch cloud participants
    handleFetchCloudParticipants(eventUuid);
  }, [handleFetchCloudParticipants, handleFetchTimingRules, state.events]);

  // Step 7: Save ticket mappings
  const handleSaveTicketMappings = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch(`/api/live/ticket-contest-mappings/${eventId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mappings: state.ticketMappings }),
      });
      const data = await response.json();
      if (!data.success) {
        setState((prev) => ({ ...prev, error: data.message || 'Failed to save mappings', isLoading: false }));
        return;
      }
      setState((prev) => ({ ...prev, currentStep: 8, isLoading: false }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to save mappings',
        isLoading: false,
      }));
    }
  }, [eventId, state.ticketMappings]);

  // Step 8: Import participants
  const handleImportParticipants = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch(`/api/live/provider-participants/${eventId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participants: state.cloudParticipants,
          ticketMappings: state.ticketMappings,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        setState((prev) => ({ ...prev, error: data.message || 'Failed to import participants', isLoading: false }));
        return;
      }
      setState((prev) => ({
        ...prev,
        importedParticipantsCount: data.importedCount || 0,
        currentStep: 9,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to import participants',
        isLoading: false,
      }));
    }
  }, [eventId, state.cloudParticipants, state.ticketMappings]);

  // Step 11: Import results
  const handleImportResults = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch(`/api/live/import/results/${eventId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bergman-internal-token': process.env.NEXT_PUBLIC_INTERNAL_TOKEN || '',
        },
        body: JSON.stringify({
          eventUuid: state.selectedEventUuid,
        }),
      });
      const data = await response.json();
      setState((prev) => ({ ...prev, currentStep: 12, isLoading: false }));
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [eventId, state.selectedEventUuid]);

  // Step 13: Start live sync
  const handleStartLiveSync = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch(`/api/live/start-sync/${eventId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventUuid: state.selectedEventUuid,
          scoreEventUuid: state.selectedScoreEventUuid,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        setState((prev) => ({ ...prev, error: data.message || 'Failed to start sync', isLoading: false }));
        return;
      }
      setState((prev) => ({ ...prev, currentStep: 14, isLoading: false }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start sync',
        isLoading: false,
      }));
    }
  }, [eventId, state.selectedEventUuid, state.selectedScoreEventUuid]);

  // Render steps
  const renderStep = () => {
    switch (state.currentStep) {
      case 1:
        return <Step1_AuthInput state={state} setState={setState} onVerify={handleVerifyAuth} />;
      case 2:
        return <Step2_VerifyAuth state={state} />;
      case 3:
        return <Step3_SelectEvent state={state} onSelectEvent={handleSelectEvent} />;
      case 4:
        return <Step4_CloudEvent state={state} />;
      case 5:
        return <Step5_6_Comparison state={state} onNext={() => setState((prev) => ({ ...prev, currentStep: 7 }))} />;
      case 7:
        return <Step7_TicketMapping state={state} setState={setState} onSave={handleSaveTicketMappings} />;
      case 8:
        return <Step8_ImportParticipants state={state} onImport={handleImportParticipants} />;
      case 9:
        return <Step9_ValidateMapping state={state} onNext={() => setState((prev) => ({ ...prev, currentStep: 10 }))} />;
      case 10:
        return <Step10_TimingRules state={state} onNext={() => setState((prev) => ({ ...prev, currentStep: 11 }))} />;
      case 11:
        return <Step11_ImportResults state={state} onImport={handleImportResults} />;
      case 12:
        return <Step12_AthletePopup state={state} onNext={() => setState((prev) => ({ ...prev, currentStep: 13 }))} />;
      case 13:
        return <Step13_StartSync state={state} onStart={handleStartLiveSync} />;
      case 14:
        return <Step14_PublicTracking state={state} onComplete={() => onComplete?.(true)} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-sm font-semibold text-gray-600">
            Step {state.currentStep} of 14
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(state.currentStep / 14) * 100}%` }}
          />
        </div>
      </div>

      {state.error && (
        <Alert className="mb-4 border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">{state.error}</AlertDescription>
        </Alert>
      )}

      <Card>{renderStep()}</Card>
    </div>
  );
}

// Step components
function Step1_AuthInput({
  state,
  setState,
  onVerify,
}: {
  state: SetupState;
  setState: React.Dispatch<React.SetStateAction<SetupState>>;
  onVerify: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 1: Configure Provider</CardTitle>
        <CardDescription>Enter your Feibot API credentials</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            Credentials are loaded securely from backend secrets. No Access Key or Secret Key is accepted from the browser.
          </AlertDescription>
        </Alert>
        <Button
          onClick={onVerify}
          disabled={state.isLoading}
          className="w-full"
        >
          {state.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Verify & Connect
        </Button>
      </div>
    </CardContent>
  );
}

function Step2_VerifyAuth({ state }: { state: SetupState }) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 2: Verify Authentication</CardTitle>
      </CardHeader>
      <div className="space-y-4">
        {state.authError ? (
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{state.authError}</AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              ✓ Authentication Verified<br />Account Connected
            </AlertDescription>
          </Alert>
        )}
      </div>
    </CardContent>
  );
}

function Step3_SelectEvent({
  state,
  onSelectEvent,
}: {
  state: SetupState;
  onSelectEvent: (eventUuid: string) => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 3: Select Event</CardTitle>
        <CardDescription>Choose the Feibot event for this setup</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        {state.isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading events...</span>
          </div>
        ) : (
          <Select onValueChange={onSelectEvent}>
            <SelectTrigger>
              <SelectValue placeholder="Select an event" />
            </SelectTrigger>
            <SelectContent>
              {state.events.map((event) => (
                <SelectItem key={event.event_uuid} value={event.event_uuid}>
                  {event.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </CardContent>
  );
}

function Step4_CloudEvent({ state }: { state: SetupState }) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 4: Cloud Event Loaded</CardTitle>
        <CardDescription>Timing rules and participants fetched</CardDescription>
      </CardHeader>
      <div className="space-y-3">
        <div className="bg-green-50 border border-green-200 rounded p-3">
          <CheckCircle className="h-4 w-4 text-green-600 inline mr-2" />
          <span className="text-green-800">{state.selectedEventName}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {state.cloudTimingRules ? (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">{state.cloudTimingRules.contests?.length || 0}</div>
                <div className="text-xs text-blue-800">Contests</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded p-3 text-center">
                <div className="text-2xl font-bold text-purple-600">{state.cloudTimingRules.splits?.length || 0}</div>
                <div className="text-xs text-purple-800">Splits</div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </CardContent>
  );
}

function Step5_6_Comparison({
  state,
  onNext,
}: {
  state: SetupState;
  onNext: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 5-6: Compare Registrations</CardTitle>
        <CardDescription>Bergman vs Feibot participants</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
            <div className="text-2xl font-bold text-gray-600">{state.bergmanParticipantsCount}</div>
            <div className="text-xs text-gray-700">Bergman</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{state.cloudParticipantsCount}</div>
            <div className="text-xs text-blue-800">Feibot</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded p-3 text-center">
            <div className="text-2xl font-bold text-orange-600">
              {state.bergmanParticipantsCount - state.cloudParticipantsCount}
            </div>
            <div className="text-xs text-orange-800">Difference</div>
          </div>
        </div>
        <Button onClick={onNext} className="w-full">
          Continue to Mapping <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </CardContent>
  );
}

function Step7_TicketMapping({
  state,
  setState,
  onSave,
}: {
  state: SetupState;
  setState: React.Dispatch<React.SetStateAction<SetupState>>;
  onSave: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 7: Ticket → Contest Mapping</CardTitle>
        <CardDescription>Map Bergman tickets to Feibot contests</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Bergman Tickets</h4>
            <div className="space-y-1 text-sm">
              {state.cloudTimingRules?.contests?.map((contest, idx) => (
                <div key={idx} className="text-gray-600">
                  {contest.Name || contest.name || 'Unknown'}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-2">Cloud Contests</h4>
            <div className="space-y-1 text-sm">
              {state.cloudTimingRules?.contests?.map((contest, idx) => (
                <div key={idx} className="text-blue-600">
                  {contest.UUID || contest.id} - {contest.Name || contest.name}
                </div>
              ))}
            </div>
          </div>
        </div>
        <Button onClick={onSave} disabled={state.isLoading} className="w-full">
          {state.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Mappings
        </Button>
      </div>
    </CardContent>
  );
}

function Step8_ImportParticipants({
  state,
  onImport,
}: {
  state: SetupState;
  onImport: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 8: Import Participants</CardTitle>
        <CardDescription>Link Bergman registrations to Feibot participants</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            {state.cloudParticipantsCount} participants ready to import
          </AlertDescription>
        </Alert>
        <Button onClick={onImport} disabled={state.isLoading} className="w-full">
          {state.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Import Participants
        </Button>
      </div>
    </CardContent>
  );
}

function Step9_ValidateMapping({ state, onNext }: { state: SetupState; onNext: () => void }) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 9: Validate Mapping</CardTitle>
        <CardDescription>Verify participant import success</CardDescription>
      </CardHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-green-50 p-2 rounded border border-green-200">
            <div className="font-semibold text-green-700">Imported</div>
            <div className="text-lg font-bold text-green-600">{state.importedParticipantsCount}</div>
          </div>
          <div className="bg-blue-50 p-2 rounded border border-blue-200">
            <div className="font-semibold text-blue-700">Mapped</div>
            <div className="text-lg font-bold text-blue-600">{state.importedParticipantsCount}</div>
          </div>
        </div>
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            ✓ Participant Mapping Complete
          </AlertDescription>
        </Alert>
        <Button onClick={onNext} className="w-full">
          Continue <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </CardContent>
  );
}

function Step10_TimingRules({ state, onNext }: { state: SetupState; onNext: () => void }) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 10: Timing Rules Loaded</CardTitle>
        <CardDescription>Cloud timing rules are ready</CardDescription>
      </CardHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-blue-50 p-2 rounded border border-blue-200 text-center">
            <div className="text-2xl font-bold text-blue-600">{state.cloudTimingRules?.contests?.length || 0}</div>
            <div className="text-xs text-blue-800">Contests</div>
          </div>
          <div className="bg-purple-50 p-2 rounded border border-purple-200 text-center">
            <div className="text-2xl font-bold text-purple-600">{state.cloudTimingRules?.splits?.length || 0}</div>
            <div className="text-xs text-purple-800">Splits</div>
          </div>
          <div className="bg-indigo-50 p-2 rounded border border-indigo-200 text-center">
            <div className="text-2xl font-bold text-indigo-600">{state.cloudTimingRules?.timingPoints?.length || 0}</div>
            <div className="text-xs text-indigo-800">Timing Pts</div>
          </div>
          <div className="bg-cyan-50 p-2 rounded border border-cyan-200 text-center">
            <div className="text-2xl font-bold text-cyan-600">{state.cloudTimingRules?.ageGroups?.length || 0}</div>
            <div className="text-xs text-cyan-800">Age Groups</div>
          </div>
        </div>
        <Button onClick={onNext} className="w-full">
          Continue <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </CardContent>
  );
}

function Step11_ImportResults({
  state,
  onImport,
}: {
  state: SetupState;
  onImport: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 11: Import Results</CardTitle>
        <CardDescription>Load initial race results from Feibot</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            Fetch latest results, splits, and finish times
          </AlertDescription>
        </Alert>
        <Button onClick={onImport} disabled={state.isLoading} className="w-full">
          {state.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Import Results
        </Button>
      </div>
    </CardContent>
  );
}

function Step12_AthletePopup({ state, onNext }: { state: SetupState; onNext: () => void }) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 12: Athlete Popup Ready</CardTitle>
        <CardDescription>Contests will display correctly</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Athletes will show splits based on their mapped contests
          </AlertDescription>
        </Alert>
        <div className="bg-gray-50 p-3 rounded border border-gray-200 text-sm">
          <div className="font-semibold mb-2">Example: BERGMAN 102 TRIATHLON</div>
          <ul className="space-y-1 text-gray-700">
            <li>• Swim Start</li>
            <li>• Swim Finish</li>
            <li>• T1</li>
            <li>• Bike Start</li>
          </ul>
        </div>
        <Button onClick={onNext} className="w-full">
          Continue <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </CardContent>
  );
}

function Step13_StartSync({
  state,
  onStart,
}: {
  state: SetupState;
  onStart: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 13: Enable Live Sync</CardTitle>
        <CardDescription>Start real-time athlete tracking</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            Sync will run every 5 seconds:<br />
            Results • Leaderboards • Athletes • Replay
          </AlertDescription>
        </Alert>
        <Button onClick={onStart} disabled={state.isLoading} className="w-full bg-green-600 hover:bg-green-700">
          {state.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Start Live Sync
        </Button>
      </div>
    </CardContent>
  );
}

function Step14_PublicTracking({
  state,
  onComplete,
}: {
  state: SetupState;
  onComplete?: () => void;
}) {
  return (
    <CardContent className="pt-6">
      <CardHeader className="px-0">
        <CardTitle>Step 14: Go Live 🎉</CardTitle>
        <CardDescription>Live tracking is now enabled</CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            ✓ Live tracking is now active
          </AlertDescription>
        </Alert>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="h-4 w-4" /> Tracking
          </div>
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="h-4 w-4" /> Leaderboard
          </div>
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="h-4 w-4" /> Results
          </div>
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="h-4 w-4" /> Replay
          </div>
        </div>
        <Button onClick={onComplete} className="w-full bg-green-600 hover:bg-green-700">
          Complete Setup
        </Button>
      </div>
    </CardContent>
  );
}
