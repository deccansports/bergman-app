// src/components/bikeRack/useBikeRack.ts
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EventParticipant, BikeRackAssignment } from '@/lib/types';
import { getBikeRackAssignmentsAction, saveBikeRackAssignmentsAction, sendBikeRackNotificationsAction } from '@/lib/actions/bikeRackActions';
import { getParticipantsForEventAction } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

interface BikeStats {
    waiverSigned: number;
    notificationsSent: number;
    yetToSend: number;
}

export function useBikeRack(eventId: string) {
  const [assignments, setAssignments] = useState<Partial<BikeRackAssignment>[]>([]);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [stats, setStats] = useState<BikeStats>({ waiverSigned: 0, notificationsSent: 0, yetToSend: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    if (!eventId) {
        setIsLoading(false);
        setAssignments([]);
        setParticipants([]);
        setStats({ waiverSigned: 0, notificationsSent: 0, yetToSend: 0 });
        return;
    };
    setIsLoading(true);
    
    try {
        const [assignmentResult, participantResult, statsResponse] = await Promise.all([
            getBikeRackAssignmentsAction(eventId),
            getParticipantsForEventAction(eventId),
            fetch(`/api/volunteer-stats/bike?eventId=${eventId}`)
        ]);

        if (assignmentResult.success) {
            setAssignments(assignmentResult.assignments || []);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch rack assignments.' });
        }
        
        if (participantResult.success) {
          setParticipants(participantResult.participants || []);
        }

        if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            if (statsData.success) {
                const fetchedStats = statsData.stats;
                const waiverSigned = fetchedStats.totalParticipants || 0;
                
                // We still need participants to calculate notificationsSent
                const notificationsSent = (participantResult.participants || []).filter(p => (p.notificationsSent?.bikeRackAssignment?.count || 0) > 0).length;

                setStats({
                  waiverSigned,
                  notificationsSent,
                  yetToSend: waiverSigned - notificationsSent,
                });
            }
        } else {
             toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch bike check-in stats.' });
        }

    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: `Failed to fetch data: ${e.message}` });
    } finally {
        setIsLoading(false);
    }
  }, [eventId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveAssignments = async (assignmentsToSave: Partial<BikeRackAssignment>[]) => {
    return await saveBikeRackAssignmentsAction(eventId, assignmentsToSave);
  };

  const sendNotifications = async () => {
    return await sendBikeRackNotificationsAction(eventId);
  };

  return {
    assignments,
    setAssignments,
    participants,
    isLoading,
    saveAssignments,
    sendNotifications,
    stats,
    refresh: fetchData
  };
}
