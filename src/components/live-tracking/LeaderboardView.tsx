
// src/components/live-tracking/LeaderboardView.tsx
"use client";

import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { LiveAthlete, Status, Leg, TicketDefinition } from '@/lib/types';
import { Flag, PlayCircle, XCircle, Filter, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { hmsToSeconds, formatSecondsToHMS, isDuathlonEvent, getCountryFlagEmoji, isValidImageUrl } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion, AnimatePresence } from 'framer-motion';

const isPlaceholderContestLabel = (value: unknown) => /^contest\s*\d+$/i.test(String(value ?? '').trim());
const getContestUuid = (athlete: LiveAthlete) => String(athlete.contestUuid || athlete.contest_uuid || athlete.providerContestUuid || athlete.liveTracking?.contestUuid || '').trim();
const isInternalAgeGroupId = (value: unknown) => {
    const label = String(value ?? '').trim();
    if (!label) return false;
    if (/^sub[-_]/i.test(label) || /^[0-9a-f]{8}-[0-9a-f-]{12,}$/i.test(label)) return true;
    const looksHuman = /(under|open|junior|senior|master|youth|adult|men|male|women|female|\d{1,2}\s*[+\-]|\d{1,2}\s*to\s*\d{1,2})/i.test(label) || /\s/.test(label);
    if (looksHuman) return false;
    return /^[A-Za-z0-9]{7,}$/.test(label) && /[A-Z]/.test(label) && /[a-z]/.test(label);
};
const sanitizeAgeGroupLabel = (value: unknown) => {
    const label = String(value ?? '').trim();
    if (!label) return '';
    if (isPlaceholderContestLabel(label)) return '';
    if (isInternalAgeGroupId(label)) return '';
    return label;
};

interface LeaderboardViewProps {
  athletes: LiveAthlete[];
  onAthleteSelect: (athlete: LiveAthlete) => void;
  tickets?: TicketDefinition[];
    contestByUuid?: Record<string, any>;
    ageGroupByUuid?: Record<string, any>;
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
    contestByUuid = {},
    ageGroupByUuid = {},
  categoryFilter,
  setCategoryFilter,
  genderFilter,
  setGenderFilter,
  ticketFilter,
  setTicketFilter,
}: LeaderboardViewProps) {
        const resolveCountry = (athlete: LiveAthlete) => String(
            athlete.country
            || (athlete as any)?.countryCode
            || (athlete as any)?.country_code
            || (athlete as any)?.countryName
            || (athlete as any)?.countryAtRace
            || (athlete as any)?.nationality
            || (athlete as any)?.registration?.country
            || (athlete as any)?.registration?.countryCode
            || (athlete as any)?.registration?.country_code
            || (athlete as any)?.registration?.countryName
            || (athlete as any)?.registration?.countryAtRace
            || (athlete as any)?.provider?.country
            || (athlete as any)?.provider?.countryCode
            || (athlete as any)?.provider?.countryName
            || '',
        ).trim();
        const normalizeFullName = (athlete: LiveAthlete) => {
                const fullName = String(
                    (athlete as any)?.fullName
                    || athlete.name
                    || [ (athlete as any)?.firstName, (athlete as any)?.lastName ].filter(Boolean).join(' ')
                    || athlete.bib
                    || 'Unknown Athlete',
                ).trim();
                return fullName || 'Unknown Athlete';
        };

        const initialsFromName = (value: string) => {
                const initials = String(value || '')
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join('')
                    .toUpperCase();
                return initials || 'AT';
        };

        const dedupedAthletes = useMemo(() => {
                const byKey = new Map<string, LiveAthlete>();
                for (const athlete of athletes) {
                                                const contestKey = String(
                                                    athlete?.contestUuid
                                                    || athlete?.contest_uuid
                                                    || athlete?.providerContestUuid
                                                    || athlete?.ticketId
                                                    || athlete?.liveTracking?.contestUuid
                                                    || '',
                                                ).trim();
                                                const key = String(
                                                    athlete?.participantUuid
                                                    || athlete?.participant_uuid
                                                    || athlete?.athleteUid
                                                    || athlete?.id
                                                    || [athlete?.bib, contestKey, (athlete as any)?.registration?.subCategoryId || (athlete as any)?.subCategoryId || (athlete as any)?.selectedSubCategory || '']
                                                        .map((value) => String(value || '').trim())
                                                        .filter(Boolean)
                                                        .join('|')
                                                    || athlete?.name
                                                    || '',
                                                ).trim();
                        if (!key) continue;
                        if (!byKey.has(key)) {
                                byKey.set(key, athlete);
                                continue;
                        }
                        const existing = byKey.get(key)!;
                        const existingScore = Object.values(existing || {}).filter((value) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)).length;
                        const nextScore = Object.values(athlete || {}).filter((value) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)).length;
                        if (nextScore > existingScore) byKey.set(key, athlete);
                }
                                return Array.from(byKey.values()).filter((athlete) => {
                                      const bib = String(athlete.bib || (athlete as any).bibNumber || '').trim();
                                    const ageGroup = String(athlete.ageGroupName || athlete.age_group_name || athlete.ageGroup || '').trim();
                                    return Boolean(bib) && bib !== '—' && ageGroup && ageGroup !== 'Unknown' && ageGroup !== 'null';
                                });
        }, [athletes]);

                const resolveContestLabel = useCallback((athlete: LiveAthlete) => {
                    const contestUuid = getContestUuid(athlete);
                    const contest = contestUuid ? (contestByUuid as any)?.[contestUuid.toLowerCase()] : null;
                    const contestFromAthlete = String(athlete.contestName || athlete.contest_name || athlete.providerContestName || '').trim();
                    const contestFromTicket = tickets.find((ticket) => ticket.id === athlete.ticketId)?.ticketName || '';
                    const candidate = String(
                        contest?.contestName
                        || contest?.contest?.contestName
                        || contestFromAthlete
                        || contestFromTicket
                        || contestUuid
                        || '',
                    ).trim();
                    return candidate && !isPlaceholderContestLabel(candidate) ? candidate : 'Unknown';
                }, [contestByUuid, tickets]);

            const getAgeGroupLabel = useCallback((athlete: LiveAthlete) => {
                const ageGroupUuid = String((athlete as any)?.ageGroupUuid || (athlete as any)?.age_group_uuid || (athlete as any)?.provider?.ageGroupUuid || (athlete as any)?.provider?.age_group_uuid || '').trim();
                const ageGroupFromIndexRow = ageGroupUuid ? (ageGroupByUuid as any)?.[ageGroupUuid.toLowerCase()] : null;
                const ageGroupFromIndex = String(ageGroupFromIndexRow?.name || ageGroupFromIndexRow?.label || ageGroupFromIndexRow?.displayName || '').trim();
                const candidate = [
                    athlete.ageGroupName,
                    athlete.age_group_name,
                    athlete.ageGroup,
                    ageGroupFromIndex,
                ]
                    .map((value) => sanitizeAgeGroupLabel(value))
                    .find((value) => !!value);
                const renderedAgeGroup = candidate || 'Unknown';
                if (process.env.NODE_ENV !== 'production') {
                    console.log({
                        bib: athlete.bib,
                        athlete: athlete.name,
                        ageGroup: (athlete as any)?.ageGroup,
                        ageGroupName: (athlete as any)?.ageGroupName,
                        renderedAgeGroup,
                    });
                }
                return renderedAgeGroup || 'Unknown';
            }, [ageGroupByUuid]);

        const getAthleteContestFilterKey = useCallback((athlete: LiveAthlete) => {
                        const ticketId = String(athlete.ticketId || (athlete as any)?.registration?.ticketId || (athlete as any)?.provider?.ticketId || '').trim();
            const subCategoryId = String(
                (athlete as any)?.subCategoryId
                || (athlete as any)?.selectedSubCategoryId
                || (athlete as any)?.registration?.subCategoryId
                || (athlete as any)?.registration?.selectedSubCategoryId
                || '',
            ).trim();
                        if (ticketId) return subCategoryId ? `${ticketId}:${subCategoryId}` : ticketId;

                        const contestLabel = resolveContestLabel(athlete).toLowerCase();
                        const matchedTicket = tickets.find((ticket) => {
                            const ticketName = String(ticket?.ticketName || (ticket as any)?.name || '').trim().toLowerCase();
                            if (!ticketName) return false;
                            if (contestLabel === ticketName || contestLabel.includes(ticketName) || ticketName.includes(contestLabel)) return true;
                            const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
                            return subCategories.some((sub: any) => {
                                const subName = String(sub?.name || sub?.label || sub?.title || '').trim().toLowerCase();
                                return subName && (contestLabel.includes(subName) || subName.includes(contestLabel));
                            });
                        });
                        if (!matchedTicket) return '';
                        const matchedTicketId = String(matchedTicket.id || '').trim();
                        const subCategories = Array.isArray((matchedTicket as any)?.subCategories) ? (matchedTicket as any).subCategories : [];
                        const matchedSub = subCategories.find((sub: any) => {
                            const subName = String(sub?.name || sub?.label || sub?.title || '').trim().toLowerCase();
                            return subName && (contestLabel.includes(subName) || subName.includes(contestLabel));
                        });
                        return matchedTicketId ? (matchedSub ? `${matchedTicketId}:${String(matchedSub.id || '').trim()}` : matchedTicketId) : '';
        }, [resolveContestLabel, tickets]);

    const getGenderLabel = (athlete: LiveAthlete) => {
        const raw = String(athlete.gender || (athlete as any)?.registration?.gender || (athlete as any)?.provider?.gender || '').trim().toLowerCase();
        if (raw.startsWith('f')) return 'Female';
        if (raw.startsWith('m')) return 'Male';
        return 'Unknown';
    };

        const uniqueAgeGroups = useMemo(() => {
        // Filter athletes by selected contest first, then get unique categories
        const filteredByTicket = ticketFilter === 'all' 
            ? dedupedAthletes 
                        : dedupedAthletes.filter((a) => getAthleteContestFilterKey(a) === ticketFilter || a.ticketId === ticketFilter);
        
        const cats = new Set(filteredByTicket.map(getAgeGroupLabel).filter((cat): cat is string => !!cat && cat !== 'Unknown'));
        return ['all', ...Array.from(cats).sort()];
    }, [dedupedAthletes, ticketFilter, getAthleteContestFilterKey, getAgeGroupLabel]);

        const availableTickets = useMemo(() => {
                const values: Array<{ id: string; label: string }> = [];
                for (const ticket of tickets.filter((t) => t.id && t.ticketName)) {
                    const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
                    if (subCategories.length === 0) {
                        values.push({
                            id: String(ticket.id),
                            label: String(ticket.ticketName || 'Contest').trim() || 'Contest',
                        });
                        continue;
                    }

                    for (const sub of subCategories) {
                        const subId = String(sub?.id || '').trim();
                        const subName = String(sub?.name || 'Sub Category').trim() || 'Sub Category';
                        if (!subId) continue;
                        values.push({
                            id: `${ticket.id}:${subId}`,
                            label: `${String(ticket.ticketName || '').trim()} · ${subName}`,
                        });
                    }
                }
                return values;
    }, [tickets]);

    const contestOptions = useMemo(() => {
        const seen = new Set<string>();
                return availableTickets.filter((item) => {
                    const key = `${item.id.toLowerCase()}::${item.label.toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }, [availableTickets]);

    const rankedAthletes = useMemo(() => {
        const legOrder: (Leg | 'NOT_STARTED' | 'FINISHED')[] = ['FINISHED', 'FINISH', 'RUN2', 'RUN', 'T2', 'BIKE', 'T1', 'SWIM', 'RUN1', 'NOT_STARTED'];
        
        const athletesWithSortKey = dedupedAthletes.map(athlete => {
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
    }, [dedupedAthletes]);

    const filteredAthletes = useMemo(() => {
        const filtered = rankedAthletes
            .filter((a) => ticketFilter === 'all' || getAthleteContestFilterKey(a) === ticketFilter || a.ticketId === ticketFilter)
            .filter(a => categoryFilter === 'all' || getAgeGroupLabel(a) === categoryFilter)
            .filter(a => genderFilter === 'all' || getGenderLabel(a) === genderFilter);
        
        return filtered.map((athlete, index) => ({...athlete, rank: index + 1}));

    }, [rankedAthletes, categoryFilter, genderFilter, ticketFilter, getAgeGroupLabel, getAthleteContestFilterKey]);

    const leader = filteredAthletes[0];

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Select value={ticketFilter} onValueChange={setTicketFilter}>
                    <SelectTrigger><SelectValue placeholder="Contest" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Contests</SelectItem>
                        {contestOptions.map(ticket => (
                            <SelectItem key={ticket.id} value={ticket.id}>{ticket.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                 <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger><SelectValue placeholder="Age Group" /></SelectTrigger>
                    <SelectContent>
                        {uniqueAgeGroups.map(cat => (
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
                        <TableHead>Contest</TableHead>
                        <TableHead>Age Group</TableHead>
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
                                const fullName = normalizeFullName(a);
                                const canOpenAthlete = (a as any)?.modalVisible !== false;
                                const contestLabel = resolveContestLabel(a);

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
                                                                                        {canOpenAthlete ? (
                                                                                            <button onClick={() => onAthleteSelect(a)} className="font-medium text-blue-900 dark:text-sky-300 hover:underline text-left flex items-center gap-2">
                                            <Avatar className="h-6 w-6 text-xs">
                                                <AvatarImage src={validAvatarUrl} />
                                                <AvatarFallback>{initialsFromName(fullName)}</AvatarFallback>
                                            </Avatar>
                                            <span>
                                                <span className="text-slate-700 dark:text-slate-200">{getCountryFlagEmoji(resolveCountry(a))} {a.bib}</span>
                                                <span className="mx-1 text-slate-500 dark:text-slate-300">-</span>
                                                <span className="text-blue-900 dark:text-sky-300">{fullName}</span>
                                            </span>
                                                                                            </button>
                                                                                        ) : (
                                                                                            <div className="font-medium text-blue-900 dark:text-sky-300 text-left flex items-center gap-2">
                                                                                                <Avatar className="h-6 w-6 text-xs">
                                                                                                    <AvatarFallback>{initialsFromName(fullName)}</AvatarFallback>
                                                                                                </Avatar>
                                                                                                <span className="text-blue-900 dark:text-sky-300">{fullName}</span>
                                                                                            </div>
                                                                                        )}
                                    </TableCell>
                                    <TableCell className="uppercase text-xs font-semibold text-slate-900 dark:text-slate-100">{contestLabel}</TableCell>
                                    <TableCell>{getAgeGroupLabel(a)}</TableCell>
                                    <TableCell>{a.status === 'Finished' ? 'FINISHED' : (a.leg || 'NOT_STARTED')}</TableCell>
                                    <TableCell>{gap}</TableCell>
                                    <TableCell><RankDelta delta={rankDelta} /></TableCell>
                                </motion.tr>
                                );
                            }) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground">No athletes match the current filters.</TableCell>
                                </TableRow>
                            )}
                      </TableBody>
                  </AnimatePresence>
              </Table>
            </div>
        </div>
    );
}
