import { NextRequest, NextResponse } from 'next/server';
import {
  getFinishersFromKV,
  _syncAllFinishersToKV,
  _syncFinisherToKV,
  clearFinishLineKVCache,
  getPodiumOptions,
  getPodiumResults,
  upsertManualPodiumEntry,
  getManualPodiumEntries,
  deleteManualPodiumEntry,
  getPodiumCategoryEntries,
  setPodiumCurrentDisplay,
  getPodiumCurrentDisplay,
  resolveAthleteByBib,
  getFinishLedBranding,
  getFinishLedTracing,
} from '@/lib/actions/finishLineLedActions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const action = searchParams.get('action');
    const category = searchParams.get('category') || '';
    const ageGroup = searchParams.get('ageGroup') || '';
    const bibNumber = searchParams.get('bibNumber') || '';

    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'Missing eventId parameter' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'get': {
        // Get finishers from KV (or fallback to Firestore)
        const result = await getFinishersFromKV(eventId);
        return NextResponse.json(result);
      }

      case 'sync': {
        // Bulk sync from Firestore to KV
        const result = await _syncAllFinishersToKV(eventId);
        return NextResponse.json(result);
      }

      case 'clear': {
        // Clear KV cache
        const result = await clearFinishLineKVCache(eventId);
        return NextResponse.json(result);
      }

      case 'podium-options': {
        const result = await getPodiumOptions(eventId);
        return NextResponse.json(result);
      }

      case 'podium': {
        if (!category || !ageGroup) {
          return NextResponse.json(
            { success: false, message: 'Missing category or ageGroup parameter', podium: [] },
            { status: 400 }
          );
        }
        const result = await getPodiumResults(eventId, category, ageGroup);
        return NextResponse.json(result);
      }

      case 'manual-list': {
        const result = await getManualPodiumEntries(eventId);
        return NextResponse.json(result);
      }

      case 'podium-entries': {
        if (!category || !ageGroup) {
          return NextResponse.json(
            { success: false, message: 'Missing category or ageGroup parameter', entries: [] },
            { status: 400 }
          );
        }
        const result = await getPodiumCategoryEntries(eventId, category, ageGroup);
        return NextResponse.json(result);
      }

      case 'podium-current': {
        const result = await getPodiumCurrentDisplay(eventId);
        return NextResponse.json(result);
      }

      case 'resolve-bib': {
        if (!bibNumber) {
          return NextResponse.json({ success: false, message: 'Missing bibNumber parameter' }, { status: 400 });
        }
        const result = await resolveAthleteByBib(eventId, bibNumber);
        return NextResponse.json(result);
      }

      case 'branding': {
        const result = await getFinishLedBranding(eventId);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'tracing': {
        const result = await getFinishLedTracing(eventId);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      default:
        // Default: get finishers
        const result = await getFinishersFromKV(eventId);
        return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Error in finish-line-led API:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        finishers: []
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action;

    if (action === 'manual-podium-entry') {
      const result = await upsertManualPodiumEntry({
        eventId: body?.eventId,
        bibNumber: body?.bibNumber,
        timingMode: body?.timingMode,
        podiumPosition: body?.podiumPosition,
        overallTime: body?.overallTime,
        swim: body?.swim,
        t1: body?.t1,
        bike: body?.bike,
        t2: body?.t2,
        run: body?.run,
        athleteName: body?.athleteName,
        category: body?.category,
        ageGroup: body?.ageGroup,
      });

      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'manual-podium-delete') {
      const result = await deleteManualPodiumEntry(body?.eventId, body?.docId);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'podium-delete') {
      const result = await deleteManualPodiumEntry(body?.eventId, body?.docId);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'set-podium-current') {
      const result = await setPodiumCurrentDisplay({
        eventId: body?.eventId,
        category: body?.category,
        ageGroup: body?.ageGroup,
        style: body?.style,
        displayMode: body?.displayMode,
        selectedDocId: body?.selectedDocId,
        athleteDisplaySeconds: body?.athleteDisplaySeconds,
        replayToken: body?.replayToken,
        guests: body?.guests,
      });
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    const { eventId, finisherData } = body;

    if (!eventId || !finisherData) {
      return NextResponse.json(
        { success: false, message: 'Missing eventId or finisherData' },
        { status: 400 }
      );
    }

    // Sync individual finisher to KV
    await _syncFinisherToKV(eventId, finisherData);

    return NextResponse.json({
      success: true,
      message: `Synced finisher ${finisherData.name} to KV`
    });
  } catch (error) {
    console.error('Error syncing finisher:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}
