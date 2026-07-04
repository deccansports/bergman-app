import { callFeibotAPI, fetchTimingRules } from './api-client';
import type { FeibotAPIConfig } from './types';

type FeibotEventRecord = {
  event_uuid?: string;
  uuid?: string;
  id?: string;
  event_name?: string;
  name?: string;
  status?: string;
  [key: string]: any;
};

type FeibotTimingRulesClient = Pick<FeibotAPIConfig, 'accountId' | 'accessKey' | 'secretKey' | 'apiBaseUrl'>;

export async function debugTimingRules(
  client: FeibotTimingRulesClient,
  providerConfig: { eventId?: string; eventUuid?: string; eventName?: string },
  resolvedUuid: string,
  overrideUsed: boolean,
) {
  console.log('====================================================');
  console.log('FEIBOT TIMING RULES DEBUG');
  console.log('====================================================');

  console.log('Firestore Configuration');
  console.table({
    eventId: providerConfig.eventId ?? '',
    firestoreEventUuid: providerConfig.eventUuid ?? '',
    firestoreEventName: providerConfig.eventName ?? '',
    resolvedUuid,
    overrideUsed,
    selectedUuidSource: overrideUsed ? 'override' : 'Firestore / resolved value',
  });

  console.log('');
  console.log('eventsList check is disabled (undocumented endpoint).');

  let events: FeibotEventRecord[] = [];

  try {
    console.log('Skipping eventsList fetch by design.');
  } catch (error) {
    console.error('Failed while processing debug pre-check');
    console.error(error);
  }

  console.log('');
  console.log(`Calling timingRulesGet(${resolvedUuid})`);
  console.log(`Selected UUID reason: ${overrideUsed ? 'override UUID was explicitly requested' : 'Firestore UUID / resolved UUID was used with no override'}`);
  console.log('No UUID substitution will be performed.');

  try {
    const timingRules = await fetchTimingRules(client, resolvedUuid);

    const timingRulesDiagnostics = timingRules.diagnostics;
    console.log('');
    console.log('String-To-Sign verification');
    console.log('Expected format: GET/eventConfigFile/timingRulesGet<TIMESTAMP>event_uuid=<EVENT_UUID>');
    console.log({
      requestUrl: timingRulesDiagnostics.requestUrl,
      timestampUsed: timingRulesDiagnostics.timestamp,
      rawQueryString: timingRulesDiagnostics.rawQueryString,
      stringToSign: timingRulesDiagnostics.stringToSign,
      generatedSignature: timingRulesDiagnostics.requestSignature,
      headerTimestampMatchesSignatureTimestamp: String(timingRulesDiagnostics.requestHeaders['X-Feibot-Timestamp']) === String(timingRulesDiagnostics.timestamp),
      eventUuidUsed: timingRulesDiagnostics.selectedEventUuid,
      responseStatus: timingRules.status,
      responseHeaders: timingRulesDiagnostics.responseHeaders,
      responseBody: timingRulesDiagnostics.responseBodyText,
    });

    if (!timingRules.ok) {
      console.error('');
      console.error('❌ timingRulesGet FAILED');
      console.error({
        status: timingRules.status,
        statusText: timingRulesDiagnostics.responseHeaders?.['status'] ?? '',
        message: timingRules.error,
        diagnostics: timingRulesDiagnostics,
      });

      if (timingRules.status === 403) {
        console.error('');
        console.error('Possible Causes');
        console.error('--------------------------------');
        console.error('1. UUID belongs to another Feibot account');
        console.error('2. Account has no permission for Timing Rules');
        console.error('3. Wrong Event UUID saved in Firestore');
        console.error('4. Override UUID replaced the correct UUID');
        console.error('--------------------------------');
        console.error('This is a Feibot permission issue. The credentials are valid but the Access Key does not have permission to access timingRulesGet for this event.');
      }

      throw new Error(`Feibot request failed (${timingRules.status})`);
    }

    console.log('');
    console.log('✓ timingRulesGet SUCCESS');
    console.log({
      requestUrl: timingRulesDiagnostics.requestUrl,
      timestampUsed: timingRulesDiagnostics.timestamp,
      rawQueryString: timingRulesDiagnostics.rawQueryString,
      stringToSign: timingRulesDiagnostics.stringToSign,
      generatedSignature: timingRulesDiagnostics.requestSignature,
      headerTimestampMatchesSignatureTimestamp: String(timingRulesDiagnostics.requestHeaders['X-Feibot-Timestamp']) === String(timingRulesDiagnostics.timestamp),
      eventUuidUsed: timingRulesDiagnostics.selectedEventUuid,
      responseStatus: timingRules.status,
      responseHeaders: timingRulesDiagnostics.responseHeaders,
      responseBody: timingRulesDiagnostics.responseBodyText,
    });
    console.log({
      contests: timingRules.data?.timing_rules?.contests?.length ?? timingRules.data?.data?.timing_rules?.contests?.length ?? 0,
      timingPoints: timingRules.data?.timing_rules?.timing_points?.length ?? timingRules.data?.data?.timing_rules?.timing_points?.length ?? 0,
      splits: timingRules.data?.timing_rules?.splits?.length ?? timingRules.data?.data?.timing_rules?.splits?.length ?? 0,
    });

    return timingRules.data;
  } catch (error: any) {
    console.error('');
    console.error('❌ timingRulesGet FAILED');
    console.error({
      status: error?.status ?? error?.response?.status,
      statusText: error?.statusText ?? error?.response?.statusText,
      message: error?.message,
      data: error?.response?.data,
      diagnostics: error?.diagnostics,
    });

    const diagnostics = error?.diagnostics;
    if (diagnostics) {
      console.log('');
      console.log('Full request diagnostics');
      console.log({
        method: diagnostics.method,
        path: diagnostics.path,
        requestUrl: diagnostics.requestUrl,
        eventUuidUsed: diagnostics.selectedEventUuid,
        queryParameters: diagnostics.queryParameters,
        rawQueryString: diagnostics.rawQueryString,
        timestamp: diagnostics.timestamp,
        rawBody: diagnostics.body,
        stringToSign: diagnostics.stringToSign,
        generatedSignature: diagnostics.requestSignature,
        accessKey: diagnostics.masked?.['X-Feibot-AK'],
        requestHeaders: diagnostics.requestHeaders,
        responseHeaders: diagnostics.responseHeaders,
        responseBody: diagnostics.responseBodyText,
      });
    }

    if (error?.status === 403 || error?.response?.status === 403) {
      console.error('');
      console.error('Possible Causes');
      console.error('--------------------------------');
      console.error('1. UUID belongs to another Feibot account');
      console.error('2. Account has no permission for Timing Rules');
      console.error('3. Wrong Event UUID saved in Firestore');
      console.error('4. Override UUID replaced the correct UUID');
      console.error('--------------------------------');
    }

    throw error;
  }
}