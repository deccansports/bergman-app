import { NextRequest, NextResponse } from 'next/server';
import { 
  _computeAdminAthleteAnalytics,
  _computeGlobalParticipantStats,
  _computeCalendarEvents,
  _computeClubRankings
} from '@/lib/actions';
import { _computeAllEventTicketStats } from '@/lib/actions/ticketActions';

export async function POST(req: NextRequest) {
  try {
    const results = [];

    // 1. Admin Athlete Analytics
    try {
      const athleteAnalytics = await _computeAdminAthleteAnalytics();
      results.push({
        name: 'Admin Athlete Analytics',
        status: athleteAnalytics.success ? 'success' : 'error',
        message: athleteAnalytics.message
      });
    } catch (error) {
      results.push({
        name: 'Admin Athlete Analytics',
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // 2. Global Participant Stats
    try {
      const participantStats = await _computeGlobalParticipantStats();
      results.push({
        name: 'Global Participant Stats',
        status: participantStats.success ? 'success' : 'error',
        message: participantStats.message
      });
    } catch (error) {
      results.push({
        name: 'Global Participant Stats',
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // 3. Calendar Events
    try {
      const calendarResult = await _computeCalendarEvents();
      results.push({
        name: 'Calendar Events',
        status: calendarResult.success ? 'success' : 'error',
        message: calendarResult.message
      });
    } catch (error) {
      results.push({
        name: 'Calendar Events',
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // 4. Event Ticket Stats
    try {
      const ticketStats = await _computeAllEventTicketStats();
      results.push({
        name: 'Event Ticket Stats',
        status: ticketStats.success ? 'success' : 'error',
        message: ticketStats.message
      });
    } catch (error) {
      results.push({
        name: 'Event Ticket Stats',
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // 5. Club Rankings
    try {
      const clubRankings = await _computeClubRankings();
      results.push({
        name: 'Club Rankings',
        status: clubRankings.success ? 'success' : 'error',
        message: clubRankings.message
      });
    } catch (error) {
      results.push({
        name: 'Club Rankings',
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Count successes and errors
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return NextResponse.json({
      success: errorCount === 0,
      message: `Analytics sync complete: ${successCount} succeeded, ${errorCount} failed`,
      synced: successCount,
      errors: errorCount,
      total: results.length,
      results
    });
  } catch (error) {
    console.error('Error syncing analytics:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error syncing analytics: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}
