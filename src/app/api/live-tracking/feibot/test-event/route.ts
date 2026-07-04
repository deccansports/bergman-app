import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getFeibotRuntimeSecretsAsync, getEventFeibotUuids } from '@/lib/feibot-integration/secure-credentials';
import { getKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';

function maskSignature(value: string) {
  if (!value) return '****';
  return value.length <= 12 ? `${value.slice(0, 4)}****` : `${value.slice(0, 8)}****${value.slice(-4)}`;
}

function parseMaybeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function resolveEventUuid(eventId?: string | null, eventUuid?: string | null) {
  const explicit = String(eventUuid || '').trim();
  if (explicit) return explicit;

  const id = String(eventId || '').trim();
  if (!id) return '';

  const db = getFirestoreInstance();
  const liveDoc = await db.collection('liveTracking').doc(id).get();
  const liveData = liveDoc.exists ? (liveDoc.data() || {}) : {};
  const fromLiveTracking = String((liveData as any)?.database?.localEventUuid || '').trim();
  if (fromLiveTracking) return fromLiveTracking;

  const fromKvConfig = await getKV<any>(`live:event:${id}:config`, '[API /live-tracking/feibot/test-event]');
  const fromKv = String(fromKvConfig?.eventUuid || '').trim();
  if (fromKv) return fromKv;

  const linked = await getEventFeibotUuids(id);
  return String(linked?.eventUuid || '').trim();
}

export async function GET(request: NextRequest) {
  try {
    const sourceQuery = String(request.nextUrl.searchParams.get('source') || '').trim();
    const sourceHeader = String(request.headers.get('x-test-event-source') || '').trim();
    const isManualInvocation = sourceQuery === 'admin-test-event-button' && sourceHeader === 'admin-test-event-button';

    if (!isManualInvocation) {
      console.warn('[Test Event API] Blocked non-manual invocation', {
        sourceQuery: sourceQuery || null,
        sourceHeader: sourceHeader || null,
        eventId: String(request.nextUrl.searchParams.get('eventId') || '').trim() || null,
      });
      return NextResponse.json(
        {
          success: false,
          valid: false,
          message: 'Test Event UUID can only be invoked from the admin button.',
        },
        { status: 400 },
      );
    }

    const eventId = String(request.nextUrl.searchParams.get('eventId') || '').trim();
    const requestedEventUuid = String(request.nextUrl.searchParams.get('eventUuid') || '').trim();

    const resolvedEventUuid = await resolveEventUuid(eventId, requestedEventUuid);
    if (!resolvedEventUuid) {
      return NextResponse.json(
        {
          success: false,
          message: 'Unable to resolve Event UUID. Pass eventUuid or import an FDB first.',
        },
        { status: 400 },
      );
    }

    const runtime = await getFeibotRuntimeSecretsAsync();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = '/eventConfigFile/timingRulesGet';
    const sortedQuery = `event_uuid=${resolvedEventUuid}`;
    const stringToSign = `GET${path}${timestamp}${sortedQuery}`;
    const signature = crypto.createHmac('sha256', runtime.secretKey).update(stringToSign, 'utf8').digest('hex');

    const requestUrl = `${String(runtime.apiBaseUrl || 'https://apicn.feibot.com').replace(/\/$/, '')}${path}?${new URLSearchParams({ event_uuid: resolvedEventUuid }).toString()}`;

    console.log('[Test Event API] Started', { eventId: eventId || null, eventUuid: resolvedEventUuid, requestUrl });

    const startedAt = Date.now();
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'X-Feibot-AK': runtime.accessKey,
        'X-Feibot-Timestamp': timestamp,
        'X-Feibot-Signature': signature,
      },
      cache: 'no-store',
    });
    const responseTimeMs = Date.now() - startedAt;
    const rawText = await response.text();
    const parsed = parseMaybeJson(rawText);
    const providerMessage = String(parsed?.message || parsed?.msg || '').trim() || null;
    const reasonCode = response.ok
      ? 'OK'
      : response.status === 403
        ? 'EVENT_NOT_ACCESSIBLE_FOR_CURRENT_ACCOUNT_OR_PERMISSION_DENIED'
        : response.status === 404
          ? 'EVENT_UUID_NOT_FOUND'
          : response.status === 401
            ? 'AUTHENTICATION_FAILED'
            : 'UPSTREAM_ERROR';

    console.log('[Test Event API] Completed', { status: response.status });

    const diagnostics = {
      timestamp,
      requestUrl,
      requestPath: path,
      sortedQuery,
      stringToSign,
      generatedSignature: signature,
      generatedSignatureMasked: maskSignature(signature),
      httpStatus: response.status,
      responseTimeMs,
      source: runtime.source,
    };

    const summary = {
      eventName: parsed?.event_name || parsed?.name || parsed?.eventName || null,
      contestCount: Array.isArray(parsed?.contests) ? parsed.contests.length : Number(parsed?.contest_count || 0),
      splitCount: Array.isArray(parsed?.splits) ? parsed.splits.length : Number(parsed?.split_count || 0),
      timingPoints: Array.isArray(parsed?.timing_points) ? parsed.timing_points.length : Number(parsed?.timing_points_count || 0),
      ageGroups: Array.isArray(parsed?.age_groups) ? parsed.age_groups.length : Number(parsed?.age_groups_count || 0),
    };

    if (eventId) {
      const db = getFirestoreInstance();
      await db.collection('liveTracking').doc(eventId).set(
        {
          verifiedEventUuid: resolvedEventUuid,
          verifiedAt: new Date().toISOString(),
          lastStatus: response.ok ? 'VALID' : 'INVALID',
          verification: {
            diagnostics,
            summary,
            rawBody: rawText,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (response.ok) {
        await db.collection('events').doc(eventId).set(
          {
            liveTrackingHub: {
              provider: 'feibot',
              feibotConfig: {
                eventUuid: resolvedEventUuid,
                verifiedEventUuid: resolvedEventUuid,
                verifiedAt: new Date().toISOString(),
                lastStatus: 'VALID',
              },
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    return NextResponse.json(
      {
        success: response.ok,
        valid: response.ok,
        message: response.ok
          ? 'Event UUID Valid. Timing Rules Loaded Successfully.'
          : providerMessage || 'Event UUID Invalid.',
        reasonCode,
        eventId: eventId || null,
        eventUuid: resolvedEventUuid,
        httpStatus: response.status,
        summary,
        parsedJson: parsed,
        rawJson: rawText,
        diagnostics,
      },
      { status: response.ok ? 200 : response.status || 500 },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        valid: false,
        message: error?.message || 'Failed to verify Event UUID',
      },
      { status: 500 },
    );
  }
}
