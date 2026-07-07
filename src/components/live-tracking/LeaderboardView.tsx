
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

const parseContestDistanceScore = (value: unknown) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return -1;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(km|kms|mtrs|mtr|m)/i);
    if (!match) return -1;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return -1;
    const unit = match[2].toLowerCase();
    if (unit === 'm' || unit === 'mtr' || unit === 'mtrs') return amount / 1000;
    return amount;
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
  getAthleteContestFilterKey?: (athlete: LiveAthlete) => string;
  eventId?: string;
  authHeaders?: Record<string, string>;
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
  getAthleteContestFilterKey: getAthleteContestFilterKeyProp,
  eventId,
  authHeaders = {},
}: LeaderboardViewProps) {
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll KV leaderboard endpoint if eventId provided
  useEffect(() => {
    if (!eventId || !authHeaders || Object.keys(authHeaders).length === 0) return;

    const pollLeaderboard = async () => {
      try {
        const params = new URLSearchParams();
        if (categoryFilter && categoryFilter !== 'all') params.append('ageGroup', categoryFilter);
        if (genderFilter && genderFilter !== 'all') params.append('gender', genderFilter);
        if (ticketFilter && ticketFilter !== 'all') params.append('contest', ticketFilter);

        const response = await fetch(`/api/live/leaderboard/${encodeURIComponent(eventId)}?${params.toString()}`, {
          cache: 'no-store',
          headers: authHeaders,
        });

        if (response.ok) {
          const data = await response.json();
          // Athletes will be updated through the parent component's state management
          // This just ensures we're polling fresh data from KV
          console.log('[Leaderboard] Polled KV:', { count: data.count, timestamp: data.timestamp });
        }
      } catch (error) {
        console.error('[Leaderboard] Poll error:', error);
      }
    };

    // Poll every 2 seconds during race
    pollLeaderboard();
    pollIntervalRef.current = setInterval(pollLeaderboard, 2000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [eventId, authHeaders, categoryFilter, genderFilter, ticketFilter]);

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
                        const bib = String(athlete?.bib || athlete?.bibNumber || '').trim();
                        const key = bib
                          ? `bib:${bib.toLowerCase()}${contestKey ? `:${contestKey.toLowerCase()}` : ''}`
                          : String(
                              athlete?.participantUuid
                              || athlete?.participant_uuid
                              || athlete?.athleteUid
                              || athlete?.id
                              || [contestKey, (athlete as any)?.registration?.subCategoryId || (athlete as any)?.subCategoryId || (athlete as any)?.selectedSubCategory || '']
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
                                                                        return Boolean(bib) && bib !== '—';
                                                                });
        }, [athletes]);

  const normalizeFullName = (athlete: LiveAthlete) => {
    const fullName = String(
      (athlete as any)?.fullName
      || athlete.name
      || [(athlete as any)?.firstName, (athlete as any)?.lastName].filter(Boolean).join(' ')
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
                        // Use the prop function if provided (more reliable as it uses resolveAthleteTicketIdentity)
                        if (getAthleteContestFilterKeyProp) {
                            return getAthleteContestFilterKeyProp(athlete);
                        }

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
        }, [resolveContestLabel, tickets, getAthleteContestFilterKeyProp]);

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
            : dedupedAthletes.filter((a) => {
                const athleteKey = getAthleteContestFilterKey(a);
                if (athleteKey === ticketFilter) return true;

                if (ticketFilter.includes(':') && !athleteKey.includes(':')) {
                    const colonIndex = ticketFilter.indexOf(':');
                    const parentId = ticketFilter.slice(0, colonIndex);
                    const subId = ticketFilter.slice(colonIndex + 1);
                    if (athleteKey !== parentId) return false;
                    const ticket = tickets.find(t => String(t.id) === parentId);
                    const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
                    const sub = subCategories.find((s: any) => String(s?.id || '').trim() === subId);
                    if (!sub) return false;
                    const athleteLabel = resolveContestLabel(a).toLowerCase();
                    const subLabels = [sub?.id, sub?.name, sub?.title, sub?.label]
                        .map((v: any) => String(v || '').trim().toLowerCase())
                        .filter(Boolean);
                    return subLabels.some((sl: string) => athleteLabel.includes(sl) || sl.includes(athleteLabel));
                }

                if (!ticketFilter.includes(':')) {
                    return athleteKey === ticketFilter || athleteKey.startsWith(ticketFilter + ':');
                }
                return false;
            });

        const cats = new Set(filteredByTicket.map(getAgeGroupLabel).filter((cat): cat is string => !!cat && cat !== 'Unknown'));
        return ['all', ...Array.from(cats).sort()];
    }, [dedupedAthletes, ticketFilter, getAthleteContestFilterKey, getAgeGroupLabel, tickets, resolveContestLabel]);

        const availableTickets = useMemo(() => {
                const values: Array<{ id: string; label: string; order: number }> = [];
                const seen = new Set<string>();

                for (const athlete of dedupedAthletes) {
                    let key = getAthleteContestFilterKey(athlete);
                    if (!key) continue;
                    const label = String(resolveContestLabel(athlete) || '').trim();

                    // If the key resolved to just a parent ticket (no colon), try to map it
                    // to a specific sub-category using the athlete's contest label.
                    // This handles cases where the athlete data lacks an explicit subCategoryId.
                    if (!key.includes(':')) {
                        const ticket = tickets.find(t => String(t.id) === key);
                        const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
                        if (subCategories.length > 0 && label) {
                            const labelLower = label.toLowerCase();
                            const matchedSub = subCategories.find((sub: any) => {
                                const subLabels = [sub?.id, sub?.name, sub?.title, sub?.label]
                                    .map((v: any) => String(v || '').trim().toLowerCase())
                                    .filter(Boolean);
                                return subLabels.some((sl: string) => labelLower.includes(sl) || sl.includes(labelLower));
                            });
                            if (matchedSub?.id) {
                                key = `${key}:${String(matchedSub.id).trim()}`;
                            }
                        }
                    }

                    const dedupeKey = `${key.toLowerCase()}::${label.toLowerCase()}`;
                    if (seen.has(dedupeKey)) continue;
                    seen.add(dedupeKey);
                    values.push({
                        id: key,
                        label: label || 'Contest',
                        order: Number((athlete as any)?.rank || values.length + 1),
                    });
                }

                if (values.length > 0) {
                    return values;
                }

                for (const ticket of tickets.filter((t) => t.id && t.ticketName)) {
                    const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
                    if (subCategories.length === 0) {
                        values.push({
                            id: String(ticket.id),
                            label: String(ticket.ticketName || 'Contest').trim() || 'Contest',
                            order: Number((ticket as any)?.order || 0),
                        });
                        continue;
                    }

                    for (const sub of subCategories) {
                        const subId = String(sub?.id || '').trim();
                        const subName = String(sub?.name || sub?.title || sub?.label || 'Sub Category').trim() || 'Sub Category';
                        if (!subId) continue;
                        values.push({
                            id: `${ticket.id}:${subId}`,
                            label: `${String(ticket.ticketName || '').trim()} - ${subName}`,
                            order: Number(sub?.order ?? ticket.order ?? 0),
                        });
                    }
                }
                return values;
    }, [dedupedAthletes, getAthleteContestFilterKey, resolveContestLabel, tickets]);

    const contestOptions = useMemo(() => {
        const seen = new Set<string>();
        const seenLabels = new Set<string>();
        
        // First, identify parent ticket IDs that have sub-categories (from both availableTickets AND tickets prop)
        const parentTicketsWithSubs = new Set<string>();
        
        // From availableTickets
        for (const item of availableTickets) {
            if (item.id.includes(':')) {
                const parentId = item.id.split(':')[0];
                parentTicketsWithSubs.add(parentId);
            }
        }
        
        // From tickets prop - include parents that have sub-categories even if no athletes exist
        for (const ticket of tickets) {
            const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
            if (subCategories.length > 0) {
                parentTicketsWithSubs.add(String(ticket.id));
            }
        }
        
        return availableTickets
                    .sort((a, b) => {
                        const distanceA = parseContestDistanceScore(a.label);
                        const distanceB = parseContestDistanceScore(b.label);
                        const aHasDistance = distanceA >= 0;
                        const bHasDistance = distanceB >= 0;
                        if (aHasDistance && bHasDistance && distanceA !== distanceB) return distanceB - distanceA;
                        if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
                        return a.label.localeCompare(b.label);
                    })
                    .filter((item) => {
                        // Filter out parent ticket IDs when sub-categories exist (Swimathon only shows sub-categories)
                        if (parentTicketsWithSubs.has(item.id) && !item.id.includes(':')) {
                            return false;
                        }
                        
                        const key = `${item.id.toLowerCase()}::${item.label.toLowerCase()}`;
                        if (seen.has(key)) return false;
                        const labelKey = item.label.trim().toLowerCase();
                        if (seenLabels.has(labelKey)) return false;
                        seen.add(key);
                        seenLabels.add(labelKey);
                        return true;
                    })
                    .map(({ order, ...item }) => item);
    }, [availableTickets, tickets]);

        useEffect(() => {
            if (contestOptions.length === 0) return;

            if (ticketFilter === 'all') return;
            const hasCurrentSelection = contestOptions.some((option) => option.id === ticketFilter);
            if (!hasCurrentSelection) {
                setTicketFilter('all');
            }
        }, [contestOptions, ticketFilter, setTicketFilter]);

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
        const selectedContestLabel = contestOptions.find((option) => option.id === ticketFilter)?.label || '';
        const selectedContestDistance = parseContestDistanceScore(selectedContestLabel);

        const hasCompatibleDistance = (athlete: LiveAthlete) => {
            if (selectedContestDistance < 0) return true;
            const athleteContestDistance = parseContestDistanceScore(resolveContestLabel(athlete));
            if (athleteContestDistance < 0) return true;
            return Math.abs(athleteContestDistance - selectedContestDistance) < 0.001;
        };

        const filtered = rankedAthletes
            .filter((a) => {
                if (ticketFilter === 'all') return true;

                const athleteKey = getAthleteContestFilterKey(a);
                // Exact match on contest key (includes sub-category if applicable)
                if (athleteKey === ticketFilter) return hasCompatibleDistance(a);

                // If ticketFilter has sub-category but athlete key is parent-only,
                // try label-based sub-category matching as a fallback.
                if (ticketFilter.includes(':') && !athleteKey.includes(':')) {
                    const colonIndex = ticketFilter.indexOf(':');
                    const parentId = ticketFilter.slice(0, colonIndex);
                    const subId = ticketFilter.slice(colonIndex + 1);
                    // Must at least belong to the same parent ticket
                    if (athleteKey !== parentId) return false;
                    // Find the sub-category entry from tickets prop
                    const ticket = tickets.find(t => String(t.id) === parentId);
                    const subCategories = Array.isArray((ticket as any)?.subCategories) ? (ticket as any).subCategories : [];
                    const sub = subCategories.find((s: any) => String(s?.id || '').trim() === subId);
                    if (!sub) return false;
                    // Compare the athlete's contest label against the sub-category names
                    const athleteLabel = resolveContestLabel(a).toLowerCase();
                    const subLabels = [sub?.id, sub?.name, sub?.title, sub?.label]
                        .map((v: any) => String(v || '').trim().toLowerCase())
                        .filter(Boolean);
                    const labelMatch = subLabels.some((sl: string) => athleteLabel.includes(sl) || sl.includes(athleteLabel));
                    return labelMatch && hasCompatibleDistance(a);
                }

                // Only allow parent-level match if sub-categories don't exist
                if (!ticketFilter.includes(':') && athleteKey === ticketFilter) return hasCompatibleDistance(a);

                return false;
            })
            .filter(a => categoryFilter === 'all' || getAgeGroupLabel(a) === categoryFilter)
            .filter(a => genderFilter === 'all' || getGenderLabel(a) === genderFilter);

        return filtered.map((athlete, index) => ({...athlete, rank: index + 1}));

    }, [rankedAthletes, categoryFilter, genderFilter, ticketFilter, getAgeGroupLabel, getAthleteContestFilterKey, tickets, resolveContestLabel, contestOptions]);

    const leader = filteredAthletes[0];

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Select value={ticketFilter} onValueChange={setTicketFilter}>
                    <SelectTrigger className="h-11 rounded-xl border border-border bg-background font-bold text-left shadow-sm ring-1 ring-transparent focus:ring-2 focus:ring-primary/20">
                        <SelectValue placeholder="All Contests" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] overflow-y-auto">
                        <SelectItem value="all">All Contests</SelectItem>
                        {contestOptions.map((ticket) => (
                            <SelectItem key={ticket.id} value={ticket.id} title={ticket.label}>
                                {ticket.label}
                            </SelectItem>
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
                        <div className="max-h-[70vh] overflow-auto rounded-2xl border border-border bg-background shadow-sm">
              <Table>
                  <TableHeader>
                    <TableRow>
                                                <TableHead className="sticky top-0 z-10 bg-background">Rank</TableHead>
                                                <TableHead className="sticky top-0 z-10 bg-background">Athlete</TableHead>
                                                <TableHead className="sticky top-0 z-10 bg-background">Contest</TableHead>
                                                <TableHead className="sticky top-0 z-10 bg-background">Age Group</TableHead>
                                                <TableHead className="sticky top-0 z-10 bg-background">Current Leg</TableHead>
                                                <TableHead className="sticky top-0 z-10 bg-background">Gap</TableHead>
                                                <TableHead className="sticky top-0 z-10 bg-background">Δ</TableHead>
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
