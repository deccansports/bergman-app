// @ts-nocheck
// CONTEST SYNC FIX - POST ENDPOINT RESPONSE
// File: /src/app/api/live/contest-mapping/[eventId]/route.ts
// Location: Lines 1287-1330 (POST handler)

export async function POST(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalizeText(params.eventId);
    if (!eventId) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const startedAt = Date.now();
    const config = await loadConfigFromKv(eventId);
    const synced = await syncContestsFromFeibot(eventId, config, { force: true });
    const contests = Array.isArray((synced as any)?.contests) ? (synced as any).contests : [];
    const durationMs = Date.now() - startedAt;
    
    // === KEY FIX ===
    // Determine success based on ACTUAL API result, not cached data presence
    const syncStatus = (synced as any)?.sync;
    const authenticationStatus = syncStatus?.authentication || 'UNKNOWN';
    const httpStatus = Number(syncStatus?.httpStatus || 0);
    const kvWritten = syncStatus?.kvWrite === 'PASS';
    const wasSuccessful = httpStatus === 200 && kvWritten;  // Only success if API returned 200 AND we wrote to KV
    
    // Distinguish between auth failures and other failures
    const isAuthFailure = authenticationStatus === 'AUTHENTICATION_FAILED';
    const isSyncFailure = !wasSuccessful && !isAuthFailure;

    return NextResponse.json({
      // SUCCESS: Only true if HTTP 200 AND KV written
      success: wasSuccessful,
      eventId,
      
      // MESSAGE: Clearly state what happened
      message: isAuthFailure 
        ? `Authentication failed (HTTP 401). Displaying ${contests.length} contests from cache.`
        : wasSuccessful 
          ? `Successfully synced ${contests.length} contests from Feibot API`
          : `Contest sync failed: ${syncStatus?.reason || 'HTTP ' + httpStatus}`,
      
      request: {
        endpoint: syncStatus?.requestUrl || null,
        httpStatus,
        durationMs,
        authentication: authenticationStatus,
        provider: 'Feibot',
      },
      rawResponse: syncStatus?.rawResponse || null,
      normalizedContests: syncStatus?.normalizedContests || contests,
      kvPayload: syncStatus?.kvPayload || null,
      
      // SUMMARY: Clearly separate API results from cache information
      summary: {
        // What the API returned
        apiStatus: httpStatus === 200 ? 'SUCCESS' : (isAuthFailure ? 'AUTH_FAILED_HTTP_401' : 'FAILED'),
        fetched: wasSuccessful ? Number(syncStatus?.contestReturned || 0) : 0,  // Only non-zero if HTTP 200
        saved: kvWritten ? contests.length : 0,  // Only non-zero if KV was written
        
        // What we're showing the user
        loaded: contests.length,
        dataSource: kvWritten ? 'FRESH_API' : (isAuthFailure || isSyncFailure ? 'CACHED' : 'NONE'),
        kvUpdated: kvWritten,
        usingCache: isAuthFailure || (isSyncFailure && contests.length > 0),
        
        // Diagnostics
        skipped: syncStatus?.contestApi === 'SKIPPED' ? 1 : 0,
        errors: syncStatus?.contestApi === 'FAILED' ? 1 : 0,
        kvWriteStatus: syncStatus?.kvWrite || 'UNKNOWN',
        cacheStatus: syncStatus?.cacheStatus || null,  // Cache age, last sync time, etc
      },
      
      diagnostics: syncStatus || {},
      lastContestSync: (synced as any)?.config?.lastContestSync || null,
      
      // HTTP Status Code
      // - 200: Successful sync (HTTP 200 + KV written)
      // - 401: Auth failure (no KV write)
      // - 502: Other failures
    }, { status: wasSuccessful ? 200 : (isAuthFailure ? 401 : 502) });
    
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to sync contests',
      },
      { status: 500 },
    );
  }
}

// === BEFORE vs AFTER ===
// 
// BEFORE (WRONG):
// ===============
// success: contests.length > 0         ← Based on cache, not API
// message: `Synced ${contests.length}` ← Misleading when showing cache
// fetched: Number(...contestReturned)  ← Shows API count even on 401
// saved: kvWrite === 'PASS' ? count : 0 ← Correct but doesn't prevent message
// HTTP Status: contests.length > 0 ? 200 : 502 ← Wrong when showing cache
// 
// Result: Shows "Synced 6" when actually HTTP 401 and showing cache
//
// 
// AFTER (CORRECT):
// ================
// success: httpStatus === 200 && kvWritten  ← Based on actual API success
// message: Shows auth failure OR success    ← Clear indication
// fetched: 0 when httpStatus !== 200        ← Honest about what we got
// saved: 0 when kvWritten !== 'PASS'        ← Honest about what we wrote
// HTTP Status: 401 for auth, 200 for success ← Correct HTTP semantics
//
// Result: Shows "Authentication failed. Displaying X from cache."
