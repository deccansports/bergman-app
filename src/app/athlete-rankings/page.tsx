
// src/app/athlete-rankings/page.tsx
"use client";

import React, { useEffect, useState, useMemo, Suspense, useCallback } from 'react';
import { getAthleteRankingData, getLegacyAthletesAction } from '@/lib/actions/athleteRankingActions';
import { getBelSeasonLeaderboardAction } from '@/lib/actions';
import type { AthleteRankingEntry, RankedAthlete, LegacyAthlete, RaceResult } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Loader2, Search, CalendarDays, FilterX, User as UserIconLucide, 
  Users as UsersIcon, Filter, Building, Rocket, Trophy, Award, 
  Star, BarChart, Flag, ChevronDown, ChevronUp, Globe, Clock, 
  MapPin, HelpCircle, Zap, Sparkles, CheckCircle2 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import EliteLeagueSection from '@/components/layout/EliteLeagueSection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { getOrdinal, formatSecondsToHMS, hmsToSeconds } from '@/lib/utils';
import LegacyAthleteDisplayCard from '@/components/rankings/LegacyAthleteDisplayCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';


const MIN_ATHLETE_RANKING_YEAR = 2023;

const toTitleCase = (str: string | null | undefined): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const countryList = [
  {"code":"AF","name":"Afghanistan","flag":"🇦🇫"}, {"code":"AL","name":"Albania","flag":"🇦🇱"}, {"code":"DZ","name":"Algeria","flag":"🇩🇿"},
  {"code":"AD","name":"Andorra","flag":"🇦🇩"}, {"code":"AO","name":"Angola","flag":"🇦🇴"}, {"code":"AG","name":"Antigua and Barbuda","flag":"🇦🇬"},
  {"code":"AR","name":"Argentina","flag":"🇦🇷"}, {"code":"AM","name":"Armenia","flag":"🇦🇲"}, {"code":"AU","name":"Australia","flag":"🇦🇺"},
  {"code":"AT","name":"Austria","flag":"🇦🇹"}, {"code":"AZ","name":"Azerbaijan","flag":"🇦🇿"}, {"code":"BS","name":"Bahamas","flag":"🇧🇸"},
  {"code":"BH","name":"Bahrain","flag":"🇧🇭"}, {"code":"BB","name":"Barbados","flag":"🇧🇧"}, {"code":"BY","name":"Belarus","flag":"🇧🇾"},
  {"code":"BE","name":"Belgium","flag":"🇧🇪"}, {"code":"BZ","name":"Belize","flag":"🇧🇿"}, {"code":"BJ","name":"Benin","flag":"🇧🇯"},
  {"code":"BT","name":"Bhutan","flag":"🇧🇹"}, {"code":"BO","name":"Bolivia","flag":"🇧🇴"}, {"code":"BA","name":"Bosnia and Herzegovina","flag":"🇧🇦"},
  {"code":"BW","name":"Botswana","flag":"🇧🇼"}, {"code":"BR","name":"Brazil","flag":"🇧🇷"}, {"code":"BN","name":"Brunei","flag":"🇧🇳"},
  {"code":"BG","name":"Bulgaria","flag":"🇧🇬"}, {"code":"BF","name":"Burkina Faso","flag":"🇧🇫"}, {"code":"BI","name":"Burundi","flag":"🇧🇮"},
  {"code":"KH","name":"Cambodia","flag":"🇰🇭"}, {"code":"CM","name":"Cameroon","flag":"🇨🇲"}, {"code":"CA","name":"Canada","flag":"🇨🇦"},
  {"code":"CV","name":"Cape Verde","flag":"🇨🇻"}, {"code":"CF","name":"Central African Republic","flag":"🇨🇫"}, {"code":"TD","name":"Chad","flag":"🇹🇩"},
  {"code":"CL","name":"Chile","flag":"🇨🇱"}, {"code":"CN","name":"China","flag":"🇨🇳"}, {"code":"CO","name":"Colombia","flag":"🇨🇴"},
  {"code":"KM","name":"Comoros","flag":"🇰🇲"}, {"code":"CG","name":"Congo","flag":"🇨🇬"}, {"code":"CR","name":"Costa Rica","flag":"🇨🇷"},
  {"code":"CI","name":"Côte d’Ivoire","flag":"🇨🇮"}, {"code":"HR","name":"Croatia","flag":"🇭🇷"}, {"code":"CU","name":"Cuba","flag":"🇨🇺"},
  {"code":"CY","name":"Cyprus","flag":"🇨🇾"}, {"code":"CZ","name":"Czech Republic","flag":"🇨🇿"}, {"code":"DK","name":"Denmark","flag":"🇩🇰"},
  {"code":"DJ","name":"Djibouti","flag":"🇩🇯"}, {"code":"DM","name":"Dominica","flag":"🇩🇲"}, {"code":"DO","name":"Dominican Republic","flag":"🇩🇴"},
  {"code":"EC","name":"Ecuador","flag":"🇪🇨"}, {"code":"EG","name":"Egypt","flag":"🇪🇬"}, {"code":"SV","name":"El Salvador","flag":"🇸🇻"},
  {"code":"EE","name":"Estonia","flag":"🇪🇪"}, {"code":"ET","name":"Ethiopia","flag":"🇪🇹"}, {"code":"FJ","name":"Fiji","flag":"🇫🇯"},
  {"code":"FI","name":"Finland","flag":"🇫🇮"}, {"code":"FR","name":"France","flag":"🇫🇷"}, {"code":"GA","name":"Gabon","flag":"🇬🇦"},
  {"code":"GM","name":"Gambia","flag":"🇬🇲"}, {"code":"GE","name":"Georgia","flag":"🇬🇪"}, {"code":"DE","name":"Germany","flag":"🇩🇪"},
  {"code":"GH","name":"Ghana","flag":"🇬🇭"}, {"code":"GR","name":"Greece","flag":"🇬🇷"}, {"code":"GT","name":"Guatemala","flag":"🇬🇹"},
  {"code":"GN","name":"Guinea","flag":"🇬🇳"}, {"code":"GY","name":"Guyana","flag":"🇬🇾"}, {"code":"HT","name":"Haiti","flag":"🇭🇹"},
  {"code":"HN","name":"Honduras","flag":"🇭🇳"}, {"code":"HU","name":"Hungary","flag":"🇭🇺"}, {"code":"IS","name":"Iceland","flag":"🇮🇸"},
  {"code":"IN","name":"India","flag":"🇮🇳"}, {"code":"ID","name":"Indonesia","flag":"🇮🇩"}, {"code":"IR","name":"Iran","flag":"🇮🇷"},
  {"code":"IQ","name":"Iraq","flag":"🇮🇶"}, {"code":"IE","name":"Ireland","flag":"🇮🇪"}, {"code":"IL","name":"Israel","flag":"🇮🇱"},
  {"code":"IT","name":"Italy","flag":"🇮🇹"}, {"code":"JP","name":"Japan","flag":"🇯🇵"}, {"code":"JO","name":"Jordan","flag":"🇯🇴"},
  {"code":"KZ","name":"Kazakhstan","flag":"🇰🇿"}, {"code":"KE","name":"Kenya","flag":"🇰🇪"}, {"code":"KW","name":"Kuwait","flag":"🇰🇼"},
  {"code":"KG","name":"Kyrgyzstan","flag":"🇰🇬"}, {"code":"LA","name":"Laos","flag":"🇱🇦"}, {"code":"LV","name":"Latvia","flag":"🇱🇻"},
  {"code":"LB","name":"Lebanon","flag":"🇱🇧"}, {"code":"LS","name":"Lesotho","flag":"🇱🇸"}, {"code":"LR","name":"Liberia","flag":"🇱🇷"},
  {"code":"LY","name":"Libya","flag":"🇱🇾"}, {"code":"LI","name":"Liechtenstein","flag":"🇱🇮"}, {"code":"LT","name":"Lithuania","flag":"🇱🇹"},
  {"code":"LU","name":"Luxembourg","flag":"🇱🇺"}, {"code":"MY","name":"Malaysia","flag":"🇲🇾"}, {"code":"MV","name":"Maldives","flag":"🇲🇻"},
  {"code":"ML","name":"Mali","flag":"🇲🇱"}, {"code":"MT","name":"Malta","flag":"🇲🇹"}, {"code":"MX","name":"Mexico","flag":"🇲🇽"},
  {"code":"MD","name":"Moldova","flag":"🇲🇩"}, {"code":"MC","name":"Monaco","flag":"🇲🇨"}, {"code":"MN","name":"Mongolia","flag":"🇲🇳"},
  {"code":"ME","name":"Montenegro","flag":"🇲🇪"}, {"code":"MA","name":"Morocco","flag":"🇲🇦"}, {"code":"MZ","name":"Mozambique","flag":"🇲🇿"},
  {"code":"MM","name":"Myanmar","flag":"🇲🇲"}, {"code":"NA","name":"Namibia","flag":"🇳🇦"}, {"code":"NP","name":"Nepal","flag":"🇳🇵"},
  {"code":"NL","name":"Netherlands","flag":"🇳🇱"}, {"code":"NZ","name":"New Zealand","flag":"🇳🇿"}, {"code":"NG","name":"Nigeria","flag":"🇳🇬"},
  {"code":"NO","name":"Norway","flag":"🇳🇴"}, {"code":"OM","name":"Oman","flag":"🇴🇲"}, {"code":"PH","name":"Philippines","flag":"🇵🇭"},
  {"code":"PL","name":"Poland","flag":"🇵🇱"}, {"code":"PT","name":"Portugal","flag":"🇵🇹"}, {"code":"QA","name":"Qatar","flag":"🇶🇦"},
  {"code":"RO","name":"Romania","flag":"🇷🇴"}, {"code":"RU","name":"Russia","flag":"🇷🇺"}, {"code":"SA","name":"Saudi Arabia","flag":"🇸🇦"},
  {"code":"SG","name":"Singapore","flag":"🇸🇬"}, {"code":"ZA","name":"South Africa","flag":"🇿🇦"}, {"code":"KR","name":"South Korea","flag":"🇰🇷"},
  {"code":"ES","name":"Spain","flag":"🇪🇸"}, {"code":"LK","name":"Sri Lanka","flag":"🇱🇰"}, {"code":"SE","name":"Sweden","flag":"🇸🇪"},
  {"code":"CH","name":"Switzerland","flag":"🇨🇭"}, {"code":"TH","name":"Thailand","flag":"🇹🇭"}, {"code":"TR","name":"Turkey","flag":"🇹🇷"},
  {"code":"UA","name":"Ukraine","flag":"🇺🇦"}, {"code":"AE","name":"United Arab Emirates","flag":"🇦🇪"}, {"code":"GB","name":"United Kingdom","flag":"🇬🇧"},
  {"code":"US","name":"United States","flag":"🇺🇸"}, {"code":"VN","name":"Vietnam","flag":"🇻🇳"}, {"code":"ZM","name":"Zambia","flag":"🇿🇲"},
  {"code":"ZW","name":"Zimbabwe","flag":"🇿🇼"}
];

const getCountryFlagEmoji = (countryName?: string | null): string => {
    if (!countryName) return '';
    const countryData = countryList.find(c => c.name.toLowerCase() === countryName.toLowerCase());
    return countryData ? countryData.flag : '';
};

const getInitials = (name?: string | null) => {
    if (!name) return '';
    const names = name?.split(' ') ?? [];
    if (names.length > 1) { return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase(); }
    return name?.substring(0, 2).toUpperCase() ?? '';
};

const normalizeCountryName = (country?: string | null): string | null => {
    if (!country) return null;
    const lowerCountry = country.toLowerCase().trim();
    if (['us', 'usa', 'united states of america'].includes(lowerCountry)) {
        return 'United States';
    }
    if (['uk', 'great britain'].includes(lowerCountry)) {
        return 'United Kingdom';
    }
     if (['uae'].includes(lowerCountry)) {
        return 'United Arab Emirates';
    }
    if (['in', 'india'].includes(lowerCountry)) {
        return 'India';
    }
    return toTitleCase(country);
};


function AthleteRankingsDisplay() {
  const [allRankings, setAllRankings] = useState<RankedAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legacyAthletes, setLegacyAthletes] = useState<LegacyAthlete[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(true);
  const [errorLegacy, setErrorLegacy] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [belLookup, setBelLookup] = useState<Map<string, string>>(new Map());

  const currentYear = new Date().getFullYear();

  const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());

  const [rankingYearToDisplay, setRankingYearToDisplay] = useState<number>(parseInt(selectedYear, 10));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAgeCategory, setSelectedAgeCategory] = useState<string>('all');
  const [selectedGender, setSelectedGender] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    const maxYear = currentYear;
    const startYear = Math.min(maxYear, Math.max(currentYear, MIN_ATHLETE_RANKING_YEAR));

    for (let y = startYear; y >= MIN_ATHLETE_RANKING_YEAR; y--) {
      years.add(y.toString());
    }
    if (MIN_ATHLETE_RANKING_YEAR <= currentYear) {
        years.add(currentYear.toString());
    }
    years.add(MIN_ATHLETE_RANKING_YEAR.toString());

    let sortedYears = Array.from(new Set(years))
      .map(y => parseInt(y,10))
      .filter(yearNum => yearNum <= maxYear && yearNum >= MIN_ATHLETE_RANKING_YEAR)
      .sort((a,b) => b - a)
      .map(String);

    if (sortedYears.length === 0) {
        sortedYears = [MIN_ATHLETE_RANKING_YEAR.toString()];
    }
    return Array.from(new Set(sortedYears)); 
  }, [currentYear]);


  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    } else if (availableYears.length === 0 && selectedYear !== MIN_ATHLETE_RANKING_YEAR.toString()){
      setSelectedYear(MIN_ATHLETE_RANKING_YEAR.toString());
    }
  }, [availableYears, selectedYear]);

  useEffect(() => {
    async function fetchRankingsAndLegacy() {
      setLoading(true); setLoadingLegacy(true);
      setError(null); setErrorLegacy(null);
      const yearToFetch = parseInt(selectedYear, 10);

      const rankingsPromise = getAthleteRankingData({ year: yearToFetch })
        .then((result: { success: boolean; rankings?: RankedAthlete[]; message?: string; rankingYear?: number; }) => {
          if (result.success && result.rankings) {
            setAllRankings(result.rankings);
            setRankingYearToDisplay(result.rankingYear || yearToFetch);
          } else {
            setError(result.message || "Failed to load athlete rankings.");
            setAllRankings([]); setRankingYearToDisplay(yearToFetch);
          }
        }).catch((e: Error) => {
          setError((e as Error).message || "An unexpected error occurred.");
          setAllRankings([]); setRankingYearToDisplay(yearToFetch);
        }).finally(() => setLoading(false));

      const legacyPromise = getLegacyAthletesAction()
        .then((result: { success: boolean; legacyAthletes?: LegacyAthlete[]; message?: string; }) => {
          if (result.success && result.legacyAthletes) {
            setLegacyAthletes(result.legacyAthletes);
          } else {
            setErrorLegacy(result.message || "Failed to load legacy athletes.");
            setLegacyAthletes([]);
          }
        }).catch((e: Error) => {
          setErrorLegacy((e as Error).message || "An unexpected error occurred.");
          setLegacyAthletes([]);
        }).finally(() => setLoadingLegacy(false));

      await Promise.all([rankingsPromise, legacyPromise]);
    }
    if (selectedYear) fetchRankingsAndLegacy();
  }, [selectedYear]);

  useEffect(() => {
    let mounted = true;

    async function loadBelBadges() {
      const year = parseInt(selectedYear, 10);
      const result = await getBelSeasonLeaderboardAction(year);
      if (!mounted || !result.success || !result.rankings) {
        if (mounted) setBelLookup(new Map());
        return;
      }

      const lookup = new Map<string, string>();
      result.rankings.forEach((athlete) => {
        if (athlete.belTier === 'Gold' || athlete.belTier === 'Silver' || athlete.belTier === 'Bronze' || athlete.belTier === 'Provisional') {
          if (athlete.athleteId) lookup.set(`uid:${athlete.athleteId}`, athlete.belTier);
          if (athlete.email) lookup.set(`email:${athlete.email.toLowerCase()}`, athlete.belTier);
          if (athlete.mobile) lookup.set(`mobile:${String(athlete.mobile).replace(/\D/g, '')}`, athlete.belTier);
        }
      });

      setBelLookup(lookup);
    }

    loadBelBadges();
    return () => {
      mounted = false;
    };
  }, [selectedYear]);

  const getBelTierForAthlete = useCallback((athlete: RankedAthlete) => {
    const athleteUid = athlete.athleteId ? `uid:${athlete.athleteId}` : null;
    const email = athlete.email ? `email:${athlete.email.toLowerCase()}` : null;
    const mobile = athlete.mobile ? `mobile:${String(athlete.mobile).replace(/\D/g, '')}` : null;
    const tier = (athleteUid && belLookup.get(athleteUid)) || (email && belLookup.get(email)) || (mobile && belLookup.get(mobile)) || null;
    if (!tier || tier === 'Unranked' || tier === 'No Tier') return null;
    return tier;
  }, [belLookup]);

  const renderBelBadge = (athlete?: RankedAthlete) => {
    if (!athlete) return null;
    const tier = getBelTierForAthlete(athlete);
    if (!tier) return null;

    const badgeClass =
      tier === 'Gold'
        ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
        : tier === 'Silver'
        ? 'bg-slate-100 text-slate-700 border-slate-300'
        : tier === 'Bronze'
        ? 'bg-amber-100 text-amber-800 border-amber-300'
        : 'bg-purple-100 text-purple-800 border-purple-300';

    const emoji = tier === 'Gold' ? '🥇' : tier === 'Silver' ? '🥈' : tier === 'Bronze' ? '🥉' : '🔵';
    return (
      <Badge variant="outline" className={cn('ml-2 text-[9px] font-black uppercase tracking-widest', badgeClass)}>
        {emoji} BEL {tier}
      </Badge>
    );
  };

 const uniqueAgeCategories = useMemo(() => {
    if (!allRankings || allRankings.length === 0) return ['all'];
    
    const normalizeCategory = (cat: string | null | undefined): string => {
      return (cat || 'Unknown').replace(/\s+/g, '');
    };

    const categories = new Set<string>();
    allRankings.forEach(ranking => {
      const normalizedCategory = normalizeCategory(ranking.ageCategory);
      if (normalizedCategory !== 'Unknown' && /^\d/.test(normalizedCategory)) { // Ensure it starts with a number
        categories.add(normalizedCategory);
      }
    });

    const getFirstNumber = (s: string) => {
        if (!s) return 999;
        if (s.toLowerCase().includes('above')) {
            return parseInt(s.replace(/[^0-9]/g, ''), 10) || 999;
        }
        const match = s.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
    };

    const sortedCategories = Array.from(categories).sort((a, b) => {
        const numA = getFirstNumber(a);
        const numB = getFirstNumber(b);
        return numA - numB;
    });
    
    return ['all', ...sortedCategories];
  }, [allRankings]);


  const uniqueGenders = useMemo(() => {
    if (!allRankings || allRankings.length === 0) return ['all'];
    const genders = new Set<string>();
    allRankings.forEach(ranking => {
      if (ranking.gender && typeof ranking.gender === 'string' && ranking.gender.trim() !== '') {
        const normalizedGender = toTitleCase(ranking.gender.trim());
        if (normalizedGender === 'Male' || normalizedGender === 'Female') {
            genders.add(normalizedGender);
        }
      }
    });
    return ['all', ...Array.from(genders).sort()];
  }, [allRankings]);
  
  const uniqueCountries = useMemo(() => {
    if (!allRankings || allRankings.length === 0) return ['all'];
    const countries = new Set<string>();
    allRankings.forEach(ranking => {
        const normalizedCountry = normalizeCountryName(ranking.country);
        if(normalizedCountry) countries.add(normalizedCountry);
    });
    return ['all', ...Array.from(countries).sort()];
  }, [allRankings]);

  const overallRankedAthletes = useMemo((): RankedAthlete[] => {
    const athletesWithCountryRank = [...allRankings].map(athlete => {
      const normalizedCountry = normalizeCountryName(athlete.country);
      const countryAthletes = allRankings.filter(a => normalizeCountryName(a.country) === normalizedCountry);
      const countryRank = countryAthletes
        .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
        .findIndex(a => a.athleteId === athlete.athleteId) + 1;
      return { ...athlete, country: normalizedCountry, countryRank: countryRank > 0 ? countryRank : undefined };
    });
    
    return athletesWithCountryRank
      .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0) || a.name.localeCompare(b.name))
      .map((athlete, index) => ({ ...athlete, overallRank: index + 1 }));
  }, [allRankings]);
  
  
  const top3Male = useMemo(() => overallRankedAthletes.filter(a => a.gender === 'Male' && (selectedCountry === 'all' || a.country === selectedCountry)).slice(0, 3), [overallRankedAthletes, selectedCountry]);
  const top3Female = useMemo(() => overallRankedAthletes.filter(a => a.gender === 'Female' && (selectedCountry === 'all' || a.country === selectedCountry)).slice(0, 3), [overallRankedAthletes, selectedCountry]);

  const isAnyFilterActive = useMemo(() => searchTerm || selectedAgeCategory !== 'all' || selectedGender !== 'all' || selectedCountry !== 'all', [searchTerm, selectedAgeCategory, selectedGender, selectedCountry]);
  const showPodium = !isAnyFilterActive;

  const groupedAndFilteredRankings = useMemo(() => {
      const normalizeCategory = (cat: string | null | undefined): string => {
        if (!cat) return 'UnknownCategory';
        return cat.replace(/\s+/g, '');
      };
      
      const normalizeGender = (gender: string | null | undefined): 'Male' | 'Female' | 'Other' => {
        const g = (gender || 'Other').trim().toLowerCase();
        if (g === 'male') return 'Male';
        if (g === 'female') return 'Female';
        return 'Other';
      };

    let athletesToProcess = overallRankedAthletes.map(athlete => ({
      ...athlete,
      normalizedAgeCategory: normalizeCategory(athlete.ageCategory),
      normalizedGender: normalizeGender(athlete.gender),
    }));

    if (selectedCountry !== 'all') {
        athletesToProcess = athletesToProcess.filter(athlete => athlete.country === selectedCountry);
    }
    if (selectedGender !== 'all') {
      athletesToProcess = athletesToProcess.filter(athlete => athlete.normalizedGender === selectedGender);
    }
    if (searchTerm) {
      athletesToProcess = athletesToProcess.filter(athlete =>
        athlete.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (athlete.clubName && athlete.clubName.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    if (selectedAgeCategory !== 'all') {
      athletesToProcess = athletesToProcess.filter(athlete => athlete.normalizedAgeCategory === selectedAgeCategory);
    }

    if (isAnyFilterActive) {
      return { 'Search Results': athletesToProcess.sort((a, b) => (a.overallRank || Infinity) - (b.overallRank || Infinity)) };
    }

    const grouped: Record<string, RankedAthlete[]> = {};
    athletesToProcess.forEach(athlete => {
      if (athlete.normalizedGender === 'Other' || athlete.normalizedAgeCategory === 'UnknownCategory') return;
      
      const groupKey = `${athlete.normalizedAgeCategory} ${athlete.normalizedGender}`;

      if (!grouped[groupKey]) grouped[groupKey] = [];
      grouped[groupKey].push(athlete);
    });
    
    for (const group in grouped) {
      grouped[group].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
      grouped[group] = grouped[group].map((athlete, index) => ({
          ...athlete,
          categoryRank: index + 1,
      })).slice(0, 5); // Take top 5 after ranking
    }
    
    const getFirstNumber = (s: string) => {
        if (!s) return 999;
        if (s.toLowerCase().includes('above')) {
            return parseInt(s.replace(/[^0-9]/g, ''), 10) || 999;
        }
        const match = s.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
    };

    const sortedGroupKeys = Object.keys(grouped).sort((a, b) => {
        const [ageA, genderA] = a.split(' ');
        const [ageB, genderB] = b.split(' ');
        
        const numA = getFirstNumber(ageA);
        const numB = getFirstNumber(ageB);
        if (numA !== numB) return numA - numB;

        const genderOrder = { 'Male': 1, 'Female': 2 };
        const orderA = genderOrder[genderA as 'Male' | 'Female'] || 99;
        const orderB = genderOrder[genderB as 'Male' | 'Female'] || 99;
        return orderA - orderB;
    });

    const sortedGrouped: Record<string, RankedAthlete[]> = {};
    sortedGroupKeys.forEach(key => {
        sortedGrouped[key] = grouped[key];
    });

    return sortedGrouped;
  }, [overallRankedAthletes, searchTerm, selectedAgeCategory, selectedGender, selectedCountry, isAnyFilterActive]);

  const toggleRowExpansion = (athleteId: string) => {
    setExpandedRow(prev => (prev === athleteId ? null : athleteId));
  };


  const PodiumCard = ({ athlete, rank }: { athlete: RankedAthlete; rank: number }) => {
    const isExpanded = expandedRow === athlete.athleteId;
    return (
        <div>
            <Card
                role="button" tabIndex={0} onClick={() => toggleRowExpansion(athlete.athleteId)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleRowExpansion(athlete.athleteId)}
                className={cn(
                  "text-center transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden group/podium cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
                  rank === 1 && "bg-gradient-to-br from-yellow-300 via-amber-400 to-yellow-500 shadow-yellow-500/30 shadow-lg scale-105",
                  rank === 2 && "bg-gradient-to-br from-slate-300 via-slate-400 to-slate-500 shadow-lg",
                  rank === 3 && "bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 shadow-lg"
                )}
                aria-expanded={isExpanded}
            >
               <div className="absolute inset-0 bg-black/10 group-hover/podium:bg-black/20 transition-colors duration-300"></div>
               <CardHeader className="relative pt-6 pb-2 items-center text-white text-center border-none">
                    <div className={cn("absolute -top-6 -right-6 w-20 h-20 rounded-full flex items-center justify-center font-extrabold text-5xl opacity-20",
                      rank === 1 && "bg-yellow-500/50 text-yellow-900",
                      rank === 2 && "bg-slate-500/50 text-slate-900",
                      rank === 3 && "bg-amber-700/50 text-amber-900"
                    )}>{rank}</div>
                    <Avatar className="w-24 h-24 border-4 border-white/50 shadow-lg">
                        <AvatarImage src={athlete.photoURL || undefined} alt={athlete.name}/>
                        <AvatarFallback className="bg-slate-700 text-slate-200 text-3xl">{getInitials(athlete.name)}</AvatarFallback>
                    </Avatar>
                    <CardTitle className="text-xl mt-2 text-shadow-md">{getCountryFlagEmoji(athlete.country)} {toTitleCase(athlete.name)}</CardTitle>
                    <div>{renderBelBadge(athlete)}</div>
                    <CardDescription className="text-white/80">{athlete.clubName || 'Unaffiliated'}</CardDescription>
                </CardHeader>
                <CardContent className="relative pb-4 text-center">
                    <p className="text-4xl font-bold text-white text-shadow-lg">{athlete.totalPoints}</p>
                    <p className="text-xs text-white/80 uppercase tracking-widest">Total Points</p>
                </CardContent>
            </Card>
            {isExpanded && (
                <div className="p-4 bg-muted/20 rounded-b-lg border-x border-b border-border">
                    <AthleteDetails athlete={athlete} rankingYearToDisplay={rankingYearToDisplay}/>
                </div>
            )}
        </div>
    )
  };

  const AthleteDetails = ({ athlete, rankingYearToDisplay }: { athlete: RankedAthlete, rankingYearToDisplay: number }) => (
    <div className="space-y-4 text-left">
        <h4 className="font-semibold text-md text-center">Rank Summary</h4>
        <div className="grid grid-cols-2 gap-4 text-center">
          <Card className="bg-background/70 border-none"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Country Rank</p><p className="text-xl font-bold">{athlete.countryRank}{getOrdinal(athlete.countryRank || 0)}</p></CardContent></Card>
          <Card className="bg-background/70 border-none"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Gender Rank</p><p className="text-xl font-bold">{athlete.genderOverallRank?.rank}{getOrdinal(athlete.genderOverallRank?.rank || 0)}</p></CardContent></Card>
        </div>
        <h4 className="font-semibold text-md text-center mt-4">Race Breakdown for {rankingYearToDisplay}</h4>
        <div className="space-y-2 text-left">
            {athlete.races.map((race, idx) => (
                <div key={idx} className="p-2.5 border bg-background rounded-md shadow-sm text-left">
                    <p className="font-semibold text-primary">{race.raceCategory}</p>
                    <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3"/>{race.location} &bull; {race.raceDate}</span>
                        <div className="flex items-center gap-4">
                            <span className="font-mono flex items-center gap-1.5"><Clock className="h-3 w-3"/>{formatSecondsToHMS(hmsToSeconds(race.chipTime))}</span>
                            <span className="font-bold text-accent flex items-center gap-1.5"><Star className="h-3 w-3"/>{race.pointsAwarded} pts</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );

  const NoRankingsContent = () => {
    if (isAnyFilterActive) {
      return (
        <Card className="my-6 bg-primary/5 border-primary/20 shadow-md">
          <CardContent className="p-8 text-center">
            <FilterX className="h-16 w-16 text-primary mx-auto mb-4 opacity-70" />
            <p className="text-xl font-semibold text-primary mb-2">No athletes match your current filters.</p>
            <p className="text-muted-foreground text-center">Try different search terms or broaden your filters to see results.</p>
          </CardContent>
        </Card>
      );
    }
  
    return (
      <Card className="my-6 bg-primary/5 border-primary/20 shadow-md">
        <CardContent className="p-8 text-center">
          <Rocket className="h-16 w-16 text-primary mx-auto mb-4 opacity-70" />
          <p className="text-xl font-semibold text-primary mb-2">The {selectedYear} season is about to begin.</p>
          <p className="text-muted-foreground mb-2 text-center">Points will start reflecting here as soon as race results are published.</p>
          <p className="text-muted-foreground mb-4 text-center">This is your moment to prepare — register now, race strong, and be on top when the season kicks off.</p>
          <Button asChild variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl h-12 px-8 font-black uppercase tracking-widest shadow-lg shadow-orange-600/20 border-none">
            <Link href="/#events">
              🏁 Register for Upcoming Events
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto py-8 px-4 flex-grow text-left">

      {/* Navigation Buttons */}
      <div className="mb-12 flex flex-wrap gap-4 justify-center md:justify-start items-center">
        <Button 
          onClick={() => document.getElementById('about-bel')?.scrollIntoView({ behavior: 'smooth' })}
          className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl h-11 px-6 font-black uppercase tracking-widest shadow-lg shadow-purple-600/30 border-none transition-all duration-200"
        >
          📚 About BEL
        </Button>
        <Button 
          onClick={() => document.getElementById('athlete-rankings')?.scrollIntoView({ behavior: 'smooth' })}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-slate-900 rounded-xl h-11 px-6 font-black uppercase tracking-widest shadow-lg shadow-amber-600/30 border-none transition-all duration-200"
        >
          🏆 Athlete Rankings
        </Button>
        <Button 
          onClick={() => document.getElementById('legacy-athletes')?.scrollIntoView({ behavior: 'smooth' })}
          className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl h-11 px-6 font-black uppercase tracking-widest shadow-lg shadow-orange-600/30 border-none transition-all duration-200"
        >
          👑 Legacy Athletes
        </Button>
      </div>

      <div id="about-bel" className="mb-10 scroll-mt-20">
        <EliteLeagueSection />
      </div>

      <div id="legacy-athletes" className="scroll-mt-20">
        {loadingLegacy ? <Skeleton className="h-64 w-full rounded-xl mb-8" /> : errorLegacy ? ( <Card className="mb-8 border-destructive bg-destructive/10 text-left"><CardHeader className="text-left border-none"><CardTitle className="text-destructive flex items-center gap-2 text-left"><Trophy className="h-6 w-6"/> Legacy Athlete Status</CardTitle></CardHeader><CardContent className="text-left"><p className="text-sm text-destructive-foreground text-left">Error loading legacy athlete data: {errorLegacy}</p></CardContent></Card> ) : legacyAthletes.length > 0 ? ( <LegacyAthleteDisplayCard legacyAthletes={legacyAthletes} /> ) : ( <Card className="mb-8 border-primary/30 bg-primary/5 text-left"><CardHeader className="text-left border-none"><CardTitle className="text-primary flex items-center gap-2 text-left"><Trophy className="h-6 w-6"/> Bergman Legacy Athletes</CardTitle></CardHeader><CardContent className="text-left"><p className="text-sm text-muted-foreground text-left">No athletes currently meet the Legacy criteria (3 finishes over 3 consecutive years). Keep racing to achieve this honor!</p></CardContent></Card> )}
      </div>
      
      <Card id="athlete-rankings" className="shadow-xl rounded-xl overflow-hidden border-t-4 border-accent text-left border-none scroll-mt-20">
        <CardHeader className="bg-accent/5 text-center py-6 text-left border-none">
          <UsersIcon className="h-12 w-12 text-accent mx-auto mb-3" />
          <CardTitle className="text-3xl font-bold text-accent text-center">Athlete Rankings {selectedCountry === 'all' ? '- Global' : `- ${selectedCountry}`}</CardTitle>
          <CardDescription className="text-lg text-muted-foreground mt-1 text-center">Displaying rankings for {rankingYearToDisplay}</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 text-left">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6 items-center text-left">
            <div className="w-full text-left"><Select value={selectedYear} onValueChange={setSelectedYear} disabled={loading || availableYears.length === 0}><SelectTrigger className="w-full h-11 rounded-xl"><CalendarDays className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Select Year" /></SelectTrigger><SelectContent>{availableYears.length > 0 ? availableYears.map(year => (<SelectItem key={year} value={year}>{year} Season</SelectItem>)): <SelectItem value={MIN_ATHLETE_RANKING_YEAR.toString()} disabled>No years available</SelectItem>}</SelectContent></Select></div>
            <div className="w-full text-left"><Select value={selectedCountry} onValueChange={setSelectedCountry} disabled={loading || uniqueCountries.length <= 1}><SelectTrigger className="w-full h-11 rounded-xl"><Globe className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Country" /></SelectTrigger><SelectContent>{uniqueCountries.map(country => (<SelectItem key={country} value={country}>{country === 'all' ? 'All Countries' : country}</SelectItem>))}</SelectContent></Select></div>
            <div className="w-full text-left"><Select value={selectedGender} onValueChange={setSelectedGender} disabled={loading || uniqueGenders.length <= 1}><SelectTrigger className="w-full h-11 rounded-xl"><Filter className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Gender" /></SelectTrigger><SelectContent>{uniqueGenders.map(gender => (<SelectItem key={gender} value={gender}>{gender === 'all' ? 'All Genders' : gender}</SelectItem>))}</SelectContent></Select></div>
            <div className="w-full text-left"><Select value={selectedAgeCategory} onValueChange={setSelectedAgeCategory} disabled={loading || uniqueAgeCategories.length <= 1}><SelectTrigger className="w-full h-11 rounded-xl"><Filter className="mr-2 h-4 w-4 opacity-70" /><SelectValue placeholder="Age Category" /></SelectTrigger><SelectContent>{uniqueAgeCategories.map(category => (<SelectItem key={category} value={category}>{category === 'all' ? 'All Age Categories' : category}</SelectItem>))}</SelectContent></Select></div>
            <div className="relative w-full text-left"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" /><Input type="search" placeholder="Search athlete or club..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 w-full h-11 rounded-xl bg-muted/30 border-none" aria-label="Search athlete name or club" disabled={loading} /></div>
          </div>

          {loading ? <div className="flex flex-col items-center justify-center py-20 text-left"><Loader2 className="h-12 w-12 animate-spin text-accent" /><p className="mt-4 text-muted-foreground font-bold uppercase tracking-widest text-[10px] text-left">Calculating Rankings for {selectedYear}...</p></div>
          : error ? <div className="text-center py-20 text-destructive text-left"><p className="text-lg font-semibold text-left">Error loading rankings:</p><p className="text-sm text-left">{error}</p></div>
          : (
            <div className="space-y-8 text-left">
              {showPodium && (top3Male.length > 0 || top3Female.length > 0) && (
                <div className="space-y-10 text-left">
                  <div className="text-center text-left">
                    <h3 className="text-2xl font-black uppercase italic tracking-tighter text-foreground text-center">Top Bergman Athletes {rankingYearToDisplay}</h3>
                    <p className="text-muted-foreground italic text-center">&quot;The body achieves what the mind believes.&quot;</p>
                  </div>
                  {top3Male.length > 0 && (
                      <div className="text-left">
                      <h4 className="text-lg font-black uppercase text-center text-slate-400 mb-8">Top Male</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end text-left">
                        {top3Male.map((athlete, i) => <PodiumCard key={`male-podium-${i}`} athlete={athlete} rank={i+1}/>)}
                      </div>
                      </div>
                  )}
                  {top3Female.length > 0 && (
                      <div className="text-left">
                      <h4 className="text-lg font-black uppercase text-center text-slate-400 mb-8 mt-12">Top Female</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end mt-10 text-left">
                        {top3Female.map((athlete, i) => <PodiumCard key={`female-podium-${i}`} athlete={athlete} rank={i+1}/>)}
                      </div>
                      </div>
                  )}
                </div>
              )}
              {Object.keys(groupedAndFilteredRankings).length > 0 && (Object.values(groupedAndFilteredRankings).some(arr => arr.length > 0)) ? (
                Object.entries(groupedAndFilteredRankings).map(([groupKey, athletes]) => {
                  if (athletes.length === 0) return null;
                  return (
                  <Card key={groupKey} className="rounded-2xl border shadow-xl text-left overflow-hidden border-none">
                    <CardHeader className="bg-muted/30 text-left border-none"><CardTitle className="text-xl font-black uppercase italic tracking-tighter text-primary text-left">{groupKey}</CardTitle><CardDescription className="text-left font-bold text-[10px] uppercase tracking-widest">Rankings for {rankingYearToDisplay}{selectedGender !== 'all' && ` (Gender: ${selectedGender})`}{searchTerm && `, searching for "${searchTerm}"`}.</CardDescription></CardHeader>
                    <CardContent className="p-0 text-left"><div className="overflow-x-auto text-left"><Table>
                          <TableHeader className="bg-muted/50"><TableRow><TableHead className="w-[100px] text-center font-black uppercase text-[10px] tracking-widest text-left">Overall Rank</TableHead><TableHead className="text-center font-black uppercase text-[10px] tracking-widest text-left">Cat Rank</TableHead><TableHead className="font-black uppercase tracking-tight text-sm text-foreground min-w-[200px] text-left">Athlete Identity</TableHead><TableHead className="font-black uppercase text-[10px] tracking-widest text-left">Gender</TableHead><TableHead className="font-black uppercase text-[10px] tracking-widest text-left">Affiliation</TableHead><TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Total Pts</TableHead><TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Starts</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {athletes.map((athlete: RankedAthlete) => {
                              const isExpanded = expandedRow === athlete.athleteId;
                              return (
                              <React.Fragment key={athlete.athleteId}>
                              <TableRow onClick={() => toggleRowExpansion(athlete.athleteId)} className="cursor-pointer hover:bg-primary/5 transition-colors text-left border-border/50">
                                  <TableCell className="font-black text-center text-foreground italic">{athlete.overallRank || 'N/A'}</TableCell>
                                  <TableCell className="font-black text-center text-slate-400 italic">{athlete.categoryRank ? `${athlete.categoryRank}${getOrdinal(athlete.categoryRank)}` : 'N/A'}</TableCell>
                                  <TableCell className="font-black uppercase tracking-tight text-primary text-left">
                                      <div className="flex items-center gap-3 text-left">
                                          <Avatar className="h-10 w-10 border bg-white shadow-sm">
                                              <AvatarImage src={athlete.photoURL || undefined} alt={athlete.name}/>
                                              <AvatarFallback className="bg-muted text-muted-foreground">{getInitials(athlete.name)}</AvatarFallback>
                                          </Avatar>
                                          <div className="text-left"><span className="mr-1">{getCountryFlagEmoji(athlete.country)}</span>{toTitleCase(athlete.name)}</div>
                                            {renderBelBadge(athlete)}
                                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                      </div>
                                  </TableCell>
                                  <TableCell className="text-muted-foreground font-bold uppercase text-[10px] text-left">{athlete.gender || 'N/A'}</TableCell>
                                   <TableCell className="text-muted-foreground text-left">{athlete.clubName ? (<div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-tight text-left"><Building className="h-3.5 w-3.5 text-primary/70"/>{athlete.clubName}</div>) : <span className="text-[10px] font-bold text-slate-300">N/A</span>}</TableCell>
                                  <TableCell className="text-right font-black text-xl italic text-primary tracking-tighter">{athlete.totalPoints}</TableCell>
                                  <TableCell className="text-right text-muted-foreground font-mono font-bold text-sm">{athlete.racesFinished}</TableCell>
                              </TableRow>
                              {isExpanded && (
                                  <TableRow className="bg-primary/5 border-none"><TableCell colSpan={7} className="p-0 text-left">
                                      <div className="p-6 text-left">
                                          <AthleteDetails athlete={athlete} rankingYearToDisplay={rankingYearToDisplay} />
                                      </div>
                                  </TableCell></TableRow>
                              )}
                              </React.Fragment>
                            )})}
                          </TableBody>
                        </Table></div></CardContent>
                  </Card>
                  )
                })
              ) : (
                <NoRankingsContent />
              )}
            </div>
          )}
           <p className="text-center mt-10 text-xs text-muted-foreground font-medium max-w-3xl mx-auto leading-relaxed">Overall Rank is based on total points among all athletes for the selected Year. Rank in Category is within the specific Age Group for that gender. Club affiliation shown is based on current records and might not reflect affiliation at the time of past races.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FullPageLoader() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen text-left">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="mt-2 text-muted-foreground font-black uppercase text-[10px] tracking-widest text-left">Synchronizing Podium Data...</p>
        </div>
    )
}

export default function AthleteRankingsPageContainer() {
    return (
      <main className="text-left">
        <Suspense fallback={<FullPageLoader />}>
            <AthleteRankingsDisplay />
        </Suspense>
      </main>
    )
}
