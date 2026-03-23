// src/components/admin/VolunteerStatsCard.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getVolunteerStatsAction } from '@/lib/actions';
import type { VolunteerStats } from '@/lib/types';

export default function VolunteerStatsCard() {
    const { toast } = useToast();
    const [volunteerStats, setVolunteerStats] = useState<VolunteerStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchStats = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await getVolunteerStatsAction();
            if (result.success && result.stats) {
                setVolunteerStats(result.stats);
            } else {
                toast({ variant: 'destructive', title: 'Error fetching stats', description: result.message });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: `Failed to fetch volunteer stats: ${e.message}` });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    if (isLoading) {
        return (
            <div className="grid grid-cols-3 gap-4 text-center">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
            </div>
        );
    }
    
    if (!volunteerStats) {
         return <p className="text-sm text-muted-foreground text-center py-4">Could not load volunteer stats.</p>;
    }

    return (
        <div className="grid grid-cols-3 gap-4 text-center">
            <Card>
                <CardHeader className="p-2 pb-1">
                    <CardTitle>{volunteerStats.totalVolunteers}</CardTitle>
                    <CardDescription className="text-xs">Total Volunteers</CardDescription>
                </CardHeader>
            </Card>
            <Card>
                <CardHeader className="p-2 pb-1">
                    <CardTitle className="text-green-600">{volunteerStats.volunteersAssignedToAnyEvent}</CardTitle>
                    <CardDescription className="text-xs">Active / Assigned</CardDescription>
                </CardHeader>
            </Card>
            <Card>
                <CardHeader className="p-2 pb-1">
                    <CardTitle className="text-yellow-600">{volunteerStats.volunteersCurrentlyUnassigned}</CardTitle>
                    <CardDescription className="text-xs">Unassigned</CardDescription>
                </CardHeader>
            </Card>
        </div>
    );
}
