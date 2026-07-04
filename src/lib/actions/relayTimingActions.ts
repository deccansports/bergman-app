'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { RelayTeamRegistration } from '@/lib/types';
import { parseRelayBib, getRelayTeamBibs } from '@/lib/utils/relayTimingUtils';

/**
 * Get relay team by bib
 */
export async function getRelayTeamByBibAction(eventId: string, teamBib: string): Promise<{
  success: boolean;
  message: string;
  team?: RelayTeamRegistration;
}> {
  try {
    const adminDb = getFirestoreInstance();
    const query = adminDb
      .collection('relayTeamRegistrations')
      .where('eventId', '==', eventId)
      .where('teamBib', '==', teamBib);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { success: false, message: 'Relay team not found' };
    }

    const team = {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data(),
    } as RelayTeamRegistration;

    return { success: true, message: 'Team found', team };
  } catch (e: any) {
    console.error('getRelayTeamByBibAction error:', e);
    return { success: false, message: `Failed to fetch team: ${e.message}` };
  }
}

/**
 * Process relay athlete timing result
 * Called when a relay athlete (e.g., R101-S) finishes
 */
export async function processRelayAthleteResultAction(
  eventId: string,
  athleteBib: string, // e.g., "R101-S"
  athleteName: string,
  legTime: number, // in seconds
  timestamp: string
): Promise<{
  success: boolean;
  message: string;
  teamBib?: string;
  role?: string;
}> {
  try {
    const bibInfo = parseRelayBib(athleteBib);

    if (!bibInfo.isRelay || !bibInfo.teamBib || !bibInfo.role) {
      return {
        success: false,
        message: 'Invalid relay bib format. Expected format: R101-S (e.g., R101-S for swimmer)',
      };
    }

    const adminDb = getFirestoreInstance();

    // Find relay team
    const teamResult = await getRelayTeamByBibAction(eventId, bibInfo.teamBib);
    if (!teamResult.success || !teamResult.team) {
      return { success: false, message: `Relay team ${bibInfo.teamBib} not found` };
    }

    const team = teamResult.team;

    // Find participant with matching role
    const participantIndex = team.participants.findIndex(
      (p) => p.role === bibInfo.role
    );

    if (participantIndex === -1) {
      return {
        success: false,
        message: `No ${bibInfo.role} participant found in team ${bibInfo.teamBib}`,
      };
    }

    // Update participant with result
    const updatedParticipants = [...team.participants];
    updatedParticipants[participantIndex] = {
      ...updatedParticipants[participantIndex],
      finishTime: legTime,
      finishTimestamp: timestamp,
      status: 'Finished',
    };

    // Calculate team total if all legs are complete
    const allLegsFinished = updatedParticipants.every((p) => p.finishTime !== undefined);
    const teamTotalTime = allLegsFinished
      ? updatedParticipants.reduce((sum, p) => sum + (p.finishTime || 0), 0)
      : undefined;

    // Update team in Firestore
    const teamRef = adminDb
      .collection('relayTeamRegistrations')
      .doc(team.id);

    await teamRef.update({
      participants: updatedParticipants,
      ...(allLegsFinished && {
        totalTime: teamTotalTime,
        status: 'Completed',
        completedAt: new Date().toISOString(),
      }),
      updatedAt: new Date().toISOString(),
    });

    return {
      success: true,
      message: allLegsFinished
        ? `All legs completed! Team total: ${teamTotalTime}s`
        : `${bibInfo.role} leg recorded. Waiting for other legs.`,
      teamBib: bibInfo.teamBib,
      role: bibInfo.role,
    };
  } catch (e: any) {
    console.error('processRelayAthleteResultAction error:', e);
    return { success: false, message: `Failed to process result: ${e.message}` };
  }
}

/**
 * Get relay team results
 */
export async function getRelayTeamResultsAction(eventId: string): Promise<{
  success: boolean;
  message: string;
  results?: Array<{
    teamBib: string;
    teamName: string;
    totalTime?: number;
    status: string;
    participants: Array<{
      role: string;
      name: string;
      legTime?: number;
    }>;
  }>;
}> {
  try {
    const adminDb = getFirestoreInstance();
    const query = adminDb
      .collection('relayTeamRegistrations')
      .where('eventId', '==', eventId)
      .where('status', '==', 'Completed')
      .orderBy('totalTime', 'asc');

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { success: true, message: 'No completed relay teams', results: [] };
    }

    const results = snapshot.docs.map((doc) => {
      const team = doc.data() as RelayTeamRegistration;
      return {
        teamBib: team.teamBib,
        teamName: team.teamName,
        totalTime: team.totalTime,
        status: team.status,
        participants: team.participants.map((p) => ({
          role: p.role,
          name: p.name,
          legTime: p.finishTime,
        })),
      };
    });

    return { success: true, message: 'Results fetched', results };
  } catch (e: any) {
    console.error('getRelayTeamResultsAction error:', e);
    return { success: false, message: `Failed to fetch results: ${e.message}` };
  }
}

/**
 * Get team live progress
 * Shows current status: which athlete is currently racing
 */
export async function getRelayTeamProgressAction(
  eventId: string,
  teamBib: string
): Promise<{
  success: boolean;
  message: string;
  currentLeg?: 'swim' | 'bike' | 'run' | 'finished';
  legStatus?: Record<'swim' | 'bike' | 'run', { status: string; time?: number }>;
  totalTimeRun?: number;
}> {
  try {
    const teamResult = await getRelayTeamByBibAction(eventId, teamBib);

    if (!teamResult.success || !teamResult.team) {
      return { success: false, message: 'Team not found' };
    }

    const team = teamResult.team;
    const legStatus: Record<'swim' | 'bike' | 'run', { status: string; time?: number }> = {
      swim: { status: 'Pending' },
      bike: { status: 'Pending' },
      run: { status: 'Pending' },
    };

    let currentLeg: 'swim' | 'bike' | 'run' | 'finished' = 'swim';
    let totalTimeRun = 0;

    const roleOrder: Array<'swim' | 'bike' | 'run'> = ['swim', 'bike', 'run'];

    // Check status of each leg
    roleOrder.forEach((role) => {
      const participant = team.participants.find((p) => p.role === role);
      if (participant) {
        if (participant.finishTime !== undefined) {
          legStatus[role] = {
            status: 'Finished',
            time: participant.finishTime,
          };
          totalTimeRun += participant.finishTime;
        } else {
          legStatus[role] = { status: 'In Progress' };
          if (currentLeg === roleOrder[0]) {
            currentLeg = role;
          }
        }
      }
    });

    // Check if all legs are done
    const allDone = roleOrder.every((role) => legStatus[role].status === 'Finished');
    if (allDone) {
      currentLeg = 'finished';
    }

    return {
      success: true,
      message: 'Progress fetched',
      currentLeg,
      legStatus,
      totalTimeRun: totalTimeRun > 0 ? totalTimeRun : undefined,
    };
  } catch (e: any) {
    console.error('getRelayTeamProgressAction error:', e);
    return { success: false, message: `Failed to fetch progress: ${e.message}` };
  }
}
