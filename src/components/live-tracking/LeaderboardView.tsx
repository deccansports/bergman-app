
// src/components/live-tracking/LeaderboardView.tsx
"use client";

import React, { useMemo, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { LiveAthlete, Status, Leg, TicketDefinition } from '@/lib/types';
import { Flag, PlayCircle, XCircle, Filter, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { hmsToSeconds, formatSecondsToHMS, isDuathlonEvent, getCountryFlagEmoji, getInitials, isValidImageUrl } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion, AnimatePresence } from 'framer-motion';

interface LeaderboardViewProps {
  athletes: LiveAthlete[];
  onAthleteSelect: (athlete: LiveAthlete) => void;
  tickets?: TicketDefinition[];
  // Filter states and setters are now props
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  genderFilter: string;
  setGenderFilter: (value: string) => void;
  ticketFilter: string;
  setTicketFilter: (value: string) => void;
}

const RankDelta = ({ delta }: { delta: number | undefined }) => {
    if (delta === undefined || delta === 0) return <Minus className="h-3 w-3 text-gray-500" />;
    if (delta < 0) return <ArrowUp className="h-4 w-4 text-green-500" />;
    return <ArrowDown className="h-4 w-4 text-red-500" />;
};


export default function LeaderboardView({
  athletes,
  onAthleteSelect,
  tickets = [],
  categoryFilter,
  setCategoryFilter,
  genderFilter,
  setGenderFilter,
  ticketFilter,
  setTicketFilter,
}: LeaderboardViewProps) {
    const uniqueCategories = useMemo(() => {
        const cats = new Set(athletes.map(a => a.ageGroup).filter((cat): cat is string => !!cat));
        return ['all', ...Array.from(cats).sort()];
    }, [athletes]);

    const availableTickets = useMemo(() => {
        return tickets.filter(t => t.id && t.ticketName);
    }, [tickets]);

    const rankedAthletes = useMemo(() => {
        const legOrder: (Leg | 'NOT_STARTED' | 'FINISHED')[] = ['FINISHED', 'FINISH', 'RUN2', 'RUN', 'T2', 'BIKE', 'T1', 'SWIM', 'RUN1', 'NOT_STARTED'];
        
        const athletesWithSortKey = athletes.map(athlete => {
            let sortKey: number;
            if (athlete.status === 'Finished') {
                sortKey = athlete.summary?.FINISHED || Infinity;
            } else if (athlete.status === 'On Course') {
                const legIndex = legOrder.indexOf(athlete.leg as Leg | 'NOT_STARTED' | 'FINISHED');
                const progressFactor = 1 - ((athlete.legProgressPct || 0) / 100);
                sortKey = -((100 - legIndex) + progressFactor); // Use negative to sort descending
            } else {
                 sortKey = Infinity;
            }
            return { ...athlete, prevRank: athlete.rank || 0, rank: 0, sortKey };
        });

        athletesWithSortKey.sort((a, b) => {
            if (a.status === 'Finished' && b.status !== 'Finished') return -1;
            if (b.status === 'Finished' && a.status !== 'Finished') return 1;
            
            if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;

            return (a.bib || '').localeCompare(b.bib || '');
        });

        return athletesWithSortKey.map((athlete, index) => ({ ...athlete, rank: index + 1 }));
    }, [athletes]);

    const filteredAthletes = useMemo(() => {
        const filtered = rankedAthletes
            .filter(a => ticketFilter === 'all' || a.ticketId === ticketFilter)
            .filter(a => categoryFilter === 'all' || a.ageGroup === categoryFilter)
            .filter(a => genderFilter === 'all' || a.gender === genderFilter);
        
        return filtered.map((athlete, index) => ({...athlete, rank: index + 1}));

    }, [rankedAthletes, categoryFilter, genderFilter, ticketFilter]);

    const leader = filteredAthletes[0];

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Select value={ticketFilter} onValueChange={setTicketFilter}>
                    <SelectTrigger><SelectValue placeholder="Ticket" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Tickets</SelectItem>
                        {availableTickets.map(ticket => (
                            <SelectItem key={ticket.id} value={ticket.id}>{ticket.ticketName}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                 <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                        {uniqueCategories.map(cat => (
                            <SelectItem key={cat} value={cat}>{cat === 'all' ? 'All Age Groups' : cat}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={genderFilter} onValueChange={setGenderFilter}>
                    <SelectTrigger><SelectValue placeholder="Gender" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Genders</SelectItem>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="overflow-x-auto">
              <Table>
                  <TableHeader>
                    <TableRow>
                        <TableHead>Rank</TableHead>
                        <TableHead>Athlete</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Current Leg</TableHead>
                        <TableHead>Gap</TableHead>
                        <TableHead>Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <AnimatePresence>
                      <TableBody>
                            {filteredAthletes.length > 0 ? filteredAthletes.map((a) => {
                                const rankDelta = a.prevRank ? a.prevRank - a.rank : undefined;
                                const leaderLastSplitTime = leader?.summary?.FINISHED || leader?.lastUpdateTime || 0;
                                const athleteLastSplitTime = a.summary?.FINISHED || a.lastUpdateTime || 0;
                                
                                const gap = (leader && leader !== a && a.status === 'Finished' && leader.status === 'Finished') ? `+${formatSecondsToHMS(athleteLastSplitTime - leaderLastSplitTime)}` : (a.status === 'Finished' ? formatSecondsToHMS(athleteLastSplitTime) : '—');
                                const validAvatarUrl = isValidImageUrl(a.avatarUrl) ? a.avatarUrl : undefined;

                                return (
                                <motion.tr
                                    key={a.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.5 }}
                                    className="hover:bg-muted"
                                >
                                    <TableCell>{a.rank}</TableCell>
                                    <TableCell>
                                        <button onClick={() => onAthleteSelect(a)} className="font-medium text-primary hover:underline text-left flex items-center gap-2">
                                            <Avatar className="h-6 w-6 text-xs">
                                                <AvatarImage src={validAvatarUrl} />
                                                <AvatarFallback>{getInitials(a.name)}</AvatarFallback>
                                            </Avatar>
                                            <span>{getCountryFlagEmoji(a.country)} {a.bib} - {a.name}</span>
                                        </button>
                                    </TableCell>
                                    <TableCell>{a.ageGroup}</TableCell>
                                    <TableCell>{a.leg}</TableCell>
                                    <TableCell>{gap}</TableCell>
                                    <TableCell><RankDelta delta={rankDelta} /></TableCell>
                                </motion.tr>
                                );
                            }) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-muted-foreground">No athletes match the current filters.</TableCell>
                                </TableRow>
                            )}
                      </TableBody>
                  </AnimatePresence>
              </Table>
            </div>
        </div>
    );
}
