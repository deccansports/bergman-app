
// src/components/live-tracking/LiveTrackingClientPage.tsx
"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getLiveTimingDataAction } from '@/lib/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Search, 
  Map as MapIcon, 
  List as ListIcon, 
  Loader2, 
  ArrowLeft, 
  Users, 
  X, 
  PlusCircle, 
  FilterX, 
  Filter, 
  Play, 
  Pause, 
  FastForward, 
  Rewind,
  TrendingUp
} from 'lucide-react';
import type { EventCalendarEntry, LiveAthlete, EventParticipant, TicketDefinition, CustomSplitPoint, RaceResult, Status, Leg, Split } from '@/lib/types';
import MapViewer, { type GpxPath } from '@/components/live-tracking/MapViewer';
import LeaderboardView from '@/components/live-tracking/LeaderboardView';
import BergmanTrackerCard from '@/components/live-tracking/BergmanTrackerCard'; 
import AthleteDetailModal from '@/components/live-tracking/AthleteDetailModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isDuathlonEvent, isTriathlonEvent, normalizeStatus, hmsToSeconds, formatSecondsToHMS } from '@/lib/utils';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import ElevationProfileChart from './ElevationProfileChart';
import { getPublicFinalResultsAction } from '@/lib/actions/publicResultActions';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';


const gpxAssetConfig = {
  swimGpxUrl: { color: '#0ea5e9', type: 'swim' }, // sky-500
  bikeGpxUrl: { color: '#22c55e', type: 'bike' }, // green-500
  runGpxUrl: { color: '#f97316', type: 'run' },  // orange-500
  run1GpxUrl: { color: '#f97316', type: 'run' }, // orange-500
  run2GpxUrl: { color: '#f59e0b', type: 'run' }, // amber-500
};

interface LiveTrackingClientPageProps {
  initialEventDetails: EventCalendarEntry;
  isPastEvent: boolean;
  initialLiveData?: LiveAthlete[];
}

export default function LiveTrackingClientPage({ initialEventDetails, isPastEvent, initialLiveData = [] }: LiveTrackingClientPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [eventDetails] = useState(initialEventDetails);
  const [liveData, setLiveData] = useState<LiveAthlete[]>(initialLiveData);
  const [isFetching, setIsFetching] = useState(initialLiveData.length === 0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [trackedAthleteIds, setTrackedAthleteIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [searchBy, setSearchBy] = useState<'bib' | 'name'>('bib');
  const [searchResults, setSearchResults] = useState<LiveAthlete[]>([]);
  const [selectedAthleteForModal, setSelectedAthleteForModal] = useState<LiveAthlete | null>(null);
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [focusedAthlete, setFocusedAthlete] = useState<LiveAthlete | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [elevationData, setElevationData] = useState<GpxPath[]>([]);
  
  // Replay Mode State
  const [isReplayMode, setIsReplayMode] = useState(isPastEvent);
  const [replayTime, setReplayTime] = useState(0); // Current replay time in seconds from race start
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [isReplaying, setIsReplaying] = useState(false);
  const replayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Filters are now managed here
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ticketFilter, setTicketFilter] = useState<string>('all');
  
  const [notificationPermission, setNotificationPermission] = useState('default');
  const prevLiveDataRef = useRef<Map<string, LiveAthlete>>(new Map());

  const allSplitsForReplay = useMemo(() => {
    if (!isReplayMode) return [];
    return initialLiveData.flatMap(a => a.splits.map(s => ({ ...s, athleteId: a.id }))).sort((a, b) => a.time - b.time);
  }, [isReplayMode, initialLiveData]);

  const maxReplayTime = useMemo(() => allSplitsForReplay[allSplitsForReplay.length - 1]?.time || 0, [allSplitsForReplay]);

  const replayData = useMemo(() => {
    if (!isReplayMode) return liveData;
    
    return initialLiveData.map(athlete => {
      const splitsBeforeOrAtReplayTime = athlete.splits.filter(s => s.time <= replayTime);
      
      const lastSplit = splitsBeforeOrAtReplayTime[splitsBeforeOrAtReplayTime.length - 1];
      let status: Status = 'Not Started';
      let leg: Leg | 'NOT_STARTED' = 'NOT_STARTED';

      if (lastSplit) {
          leg = lastSplit.segment as Leg;
          status = leg === 'FINISHED' ? 'Finished' : 'On Course';
      }
      
      return {
          ...athlete,
          splits: splitsBeforeOrAtReplayTime,
          status,
          leg,
          lastUpdateTime: replayTime
      };
    });
  }, [isReplayMode, replayTime, initialLiveData, liveData]);


  useEffect(() => {
    if (isReplaying && isReplayMode) {
      replayIntervalRef.current = setInterval(() => {
        setReplayTime(prevTime => {
          const nextTime = prevTime + replaySpeed;
          if (nextTime >= maxReplayTime) {
            setIsReplaying(false);
            return maxReplayTime;
          }
          return nextTime;
        });
      }, 1000);
    } else {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
      }
    }
    return () => {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
      }
    };
  }, [isReplaying, isReplayMode, replaySpeed, maxReplayTime]);

  const handleSliderChange = (value: number[]) => {
    setReplayTime(value[0]);
  };

  const toggleReplay = () => {
    if (replayTime >= maxReplayTime) {
        setReplayTime(0); // Restart if at the end
    }
    setIsReplaying(!isReplaying);
  };
  
  const handleSpeedChange = () => {
    const speeds = [1, 5, 10, 50, 100];
    const currentIndex = speeds.indexOf(replaySpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setReplaySpeed(speeds[nextIndex]);
  };

  useEffect(() => {
    if (isReplayMode) {
      setIsFetching(false);
      setLiveData(initialLiveData);
      return;
    }

    const isLiveSource = eventDetails.liveDataSource === 'participants' || eventDetails.liveDataSource === 'timing_partner';
    if (!isLiveSource) {
      setIsFetching(false);
      setLiveData(initialLiveData);
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      if (!isMounted) return;
      try {
        const result = await getLiveTimingDataAction(eventDetails.id, 'live');
        if (isMounted) {
          if (result.success && result.participants) {
            setLiveData(result.participants);
          }
          setIsFetching(false);
        }
      } catch (error) {
        if (isMounted) {
          console.error("Error fetching live athletes:", error);
          toast({ variant: 'destructive', title: 'Live Data Error', description: 'Could not connect to live athlete data.' });
          setIsFetching(false);
        }
      }
    };

    fetchData(); // Initial fetch
    const interval = setInterval(fetchData, 15000); // Poll every 15 seconds

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [eventDetails.id, eventDetails.liveDataSource, toast, isReplayMode, initialLiveData]);

  const handleGpxDataLoaded = useCallback((gpxPaths: GpxPath[]) => {
    setElevationData(gpxPaths);
  }, []);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      toast({ variant: 'destructive', title: 'Invalid Search', description: 'Please enter a BIB number or name.' });
      return;
    }
    setHasSearched(true);
    setIsSearching(true);
    
    const dataToSearch = isReplayMode ? replayData : liveData;
    
    const results = dataToSearch.filter(athlete => {
        if (searchBy === 'bib') {
            return athlete.bib.toLowerCase() === term;
        }
        if (searchBy === 'name') {
            return athlete.name.toLowerCase().includes(term);
        }
        return false;
    });

    if (results.length > 0) {
        setSearchResults(results);
    } else {
        setSearchResults([]);
        toast({ variant: 'destructive', title: 'Not Found', description: `No data found for "${searchTerm}".` });
    }
    setIsSearching(false);
  };
  
  const clearSearch = () => {
    setSearchTerm('');
    setHasSearched(false);
    setSearchResults([]);
  };

  const trackedAthletes = useMemo(() => {
    if (trackedAthleteIds.size === 0) return [];
    const dataToFilter = isReplayMode ? replayData : liveData;
    return dataToFilter.filter(athlete => trackedAthleteIds.has(athlete.id));
  }, [isReplayMode, replayData, liveData, trackedAthleteIds]);
  
  const athletesToDisplayOnMap = useMemo(() => {
    return focusedAthlete ? [focusedAthlete] : trackedAthletes;
  }, [focusedAthlete, trackedAthletes]);

  const ticketToCourseMap = useMemo(() => {
    const map = new Map<string, { url: string; color: string; type: string }[]>();
    eventDetails.ticketDefinitions?.forEach(ticket => {
        if (!ticket) return;
        const routes: { url: string; color: string; type: string }[] = [];
        const gpxKeys = Object.keys(gpxAssetConfig) as (keyof typeof gpxAssetConfig)[];
        gpxKeys.forEach(assetKey => {
            const url = (ticket.courseMaps as any)?.[assetKey];
            if (typeof url === 'string' && url) {
                routes.push({ 
                    url, 
                    color: (gpxAssetConfig as any)[assetKey]?.color || '#8884d8',
                    type: (gpxAssetConfig as any)[assetKey]?.type || 'bike'
                });
            }
        });
        map.set(ticket.id, routes);
    });
    return map;
  }, [eventDetails.ticketDefinitions]);

  useEffect(() => {
    if (eventDetails.ticketDefinitions && eventDetails.ticketDefinitions.length > 0) {
        for (const ticket of eventDetails.ticketDefinitions) {
            const routes = ticketToCourseMap.get(ticket.id);
            if (routes && routes.length > 0) {
                setSelectedTicketId(ticket.id);
                return;
            }
        }
    }
  }, [eventDetails.ticketDefinitions, ticketToCourseMap]);
  
  const mapRoutes = useMemo(() => {
      if (focusedAthlete && focusedAthlete.ticketId) {
          return ticketToCourseMap.get(focusedAthlete.ticketId) || [];
      }
      if (!selectedTicketId) return [];
      const routes = ticketToCourseMap.get(selectedTicketId);
      if (!routes) return [];
      // De-duplicate routes
      return Array.from(new Set(routes.map(r => JSON.stringify(r)))).map(s => JSON.parse(s));
  }, [selectedTicketId, focusedAthlete, ticketToCourseMap]);

  const handleToggleTrackAthlete = (athlete: LiveAthlete) => {
    if (typeof window !== 'undefined' && 'Notification' in window && notificationPermission === 'default') {
        Notification.requestPermission().then(setNotificationPermission);
    }
    
    const athleteId = athlete.id;
    setTrackedAthleteIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(athleteId)) {
        newSet.delete(athleteId);
        toast({ title: 'Athlete Untracked', description: `${athlete.name} removed from your tracking list.` });
      } else {
        newSet.add(athleteId);
        toast({ title: 'Athlete Tracked!', description: `${athlete.name} added to your personal tracking list.` });
      }
      return newSet;
    });
  };

  const handleViewOnMap = (athleteId: string) => {
    const dataToSearch = isReplayMode ? replayData : liveData;
    const athlete = dataToSearch.find(a => a.id === athleteId);
    if (athlete) {
      setFocusedAthlete(athlete);
      setActiveTab('map');
    }
  };

  const selectedAthleteTicketDef = useMemo(() => {
    if (!selectedAthleteForModal || !selectedAthleteForModal.ticketId) return undefined;
    return eventDetails.ticketDefinitions?.find(td => td.id === selectedAthleteForModal.ticketId);
  }, [selectedAthleteForModal, eventDetails.ticketDefinitions]);

  return (
    <>
      <div className="container mx-auto py-8 px-4 text-left">
        <Card className="mb-4 border-none shadow-xl text-left">
          <CardHeader className="text-left">
            <Button variant="outline" size="sm" onClick={() => router.push('/tracking')} className="absolute top-4 left-4 text-xs h-8 rounded-lg"><ArrowLeft className="h-4 w-4 mr-1.5"/>Back to Events</Button>
            <CardTitle className="text-center pt-8 text-2xl font-black uppercase italic tracking-tighter text-primary">
              {eventDetails?.eventName || 'Live Tracking'}
            </CardTitle>
            <CardDescription className="text-center font-bold uppercase text-[10px] tracking-[0.2em] text-muted-foreground">
              {eventDetails?.eventDate ? new Date(eventDetails.eventDate + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Date TBD'}
            </CardDescription>
          </CardHeader>
        </Card>
        
        {isReplayMode && (
            <Card className="mb-4 p-4 border-none shadow-lg bg-slate-900 text-white text-left">
                <div className="flex flex-col sm:flex-row items-center gap-4 text-left">
                    <div className="flex items-center gap-2 text-left">
                        <Button size="icon" onClick={toggleReplay} className="bg-white text-slate-900 hover:bg-slate-200">
                            {isReplaying ? <Pause className="h-5 w-5"/> : <Play className="h-5 w-5"/>}
                        </Button>
                        <Button size="icon" variant="outline" onClick={handleSpeedChange} className="border-white/20 hover:bg-white/10">
                           <span className="text-xs font-semibold">{replaySpeed}x</span>
                        </Button>
                    </div>
                    <div className="w-full flex-grow flex items-center gap-3 text-left">
                         <span className="text-xs font-mono text-slate-400">{formatSecondsToHMS(replayTime)}</span>
                        <Slider
                            value={[replayTime]}
                            onValueChange={handleSliderChange}
                            max={maxReplayTime}
                            step={1}
                            className="w-full"
                        />
                         <span className="text-xs font-mono text-slate-400">{formatSecondsToHMS(maxReplayTime)}</span>
                    </div>
                </div>
            </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-left">
            <TabsList className="grid w-full grid-cols-3 bg-muted/50 p-1 rounded-xl border border-border/50">
                <TabsTrigger value="leaderboard" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><ListIcon className="h-4 w-4"/>Leaderboard</TabsTrigger>
                <TabsTrigger value="search" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><Users className="h-4 w-4"/>Search & Track</TabsTrigger>
                <TabsTrigger value="map" className="rounded-lg gap-2 font-bold uppercase text-[10px] tracking-widest"><MapIcon className="h-4 w-4"/>Live Map</TabsTrigger>
            </TabsList>
            <TabsContent value="map" className="mt-4 animate-in fade-in duration-500 text-left">
                <div className="mb-4 space-y-2 text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Displaying Route Path:</p>
                    <div className="flex flex-wrap gap-2 text-left">
                        {eventDetails.ticketDefinitions?.map(ticket => {
                             const routes = ticketToCourseMap.get(ticket.id);
                             if (!routes || routes.length === 0) return null;
                             return (
                                <Button
                                    key={ticket.id}
                                    variant={selectedTicketId === ticket.id && !focusedAthlete ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => { setSelectedTicketId(ticket.id); setFocusedAthlete(null); }}
                                    className={cn(
                                        "h-8 rounded-lg font-bold text-[10px] uppercase tracking-widest",
                                        selectedTicketId === ticket.id && !focusedAthlete && "bg-primary hover:bg-primary/90 text-white border-none"
                                    )}
                                >
                                    {ticket.ticketName}
                                </Button>
                            )
                        })}
                    </div>
                     {focusedAthlete && (
                        <div className="pt-2 text-left">
                            <Button variant="secondary" size="sm" onClick={() => setFocusedAthlete(null)} className="h-8 rounded-lg font-bold text-[10px] uppercase tracking-widest bg-orange-100 text-orange-700 hover:bg-orange-200">
                                <X className="h-3 w-3 mr-2" />
                                Exit Focus Mode
                            </Button>
                        </div>
                    )}
                </div>
                <div className="rounded-2xl overflow-hidden border shadow-2xl bg-muted/20">
                    <MapViewer 
                        routes={mapRoutes}
                        trackedAthletes={athletesToDisplayOnMap}
                        focusedAthlete={focusedAthlete}
                        onGpxDataLoaded={handleGpxDataLoaded}
                    />
                </div>
                 {elevationData.length > 0 && (
                  <Card className="mt-6 border-none shadow-xl overflow-hidden text-left">
                    <CardHeader className="bg-muted/30 p-4 text-left border-b">
                      <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-left">
                          <TrendingUp className="h-4 w-4 text-primary" /> Elevation Dynamics
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      {elevationData.map((path, index) => {
                        const routeInfo = mapRoutes[index];
                        // ONLY SHOW ELEVATION FOR NON-SWIM LEGS
                        if (routeInfo?.type === 'swim') return null;
                        return (
                            <div key={index}>
                               <ElevationProfileChart data={path.elevationData} strokeColor={path.color} height={120} athleteProgress={replayData[0]?.courseProgress}/>
                            </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
            </TabsContent>
            <TabsContent value="leaderboard" className="mt-4 animate-in fade-in duration-500 text-left">
               {isFetching ? (
                    <div className="flex flex-col justify-center items-center py-24 gap-4 text-left">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse text-left">Initializing Leaderboard...</p>
                    </div>
                ) : (
                    <LeaderboardView 
                        athletes={replayData} 
                        onAthleteSelect={setSelectedAthleteForModal} 
                        tickets={eventDetails.ticketDefinitions} 
                        categoryFilter={categoryFilter}
                        setCategoryFilter={setCategoryFilter}
                        genderFilter={genderFilter}
                        setGenderFilter={setGenderFilter}
                        ticketFilter={ticketFilter}
                        setTicketFilter={setTicketFilter}
                    />
                )}
            </TabsContent>
            <TabsContent value="search" className="mt-4 animate-in fade-in duration-500 text-left space-y-6">
                 <Card className="border-none shadow-xl text-left">
                    <CardHeader className="text-left border-b bg-muted/30">
                        <CardTitle className="text-lg font-black uppercase tracking-tight text-left">Athlete Finder</CardTitle>
                        <CardDescription className="text-left">Identify athletes to track their progress on the map.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 text-left">
                         <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 text-left">
                            <Select value={searchBy} onValueChange={(v) => setSearchBy(v as any)}>
                                <SelectTrigger className="w-full sm:w-[140px] h-11 rounded-xl font-bold text-left shadow-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="text-left">
                                    <SelectItem value="bib" className="font-bold text-left">BIB #</SelectItem>
                                    <SelectItem value="name" className="font-bold text-left">Athlete Name</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="relative flex-grow text-left">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder={`Search by ${searchBy}...`} 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="h-11 rounded-xl pl-10 bg-muted/20 border-none font-bold placeholder:font-normal text-left"
                                />
                            </div>
                            <Button type="submit" disabled={isSearching} className="h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-xs shadow-lg shadow-primary/20 text-left">
                                {isSearching ? <Loader2 className="animate-spin h-4 w-4" /> : <Search className="h-4 w-4 mr-2" />}
                                Search
                            </Button>
                        </form>
                         {hasSearched && searchResults.length === 0 && !isSearching && (
                            <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-3 text-left">
                                <FilterX className="h-10 w-10 opacity-30"/>
                                <p className="font-bold uppercase text-[10px] tracking-widest text-left">No matches found for &quot;{searchTerm}&quot;</p>
                            </div>
                         )}
                        {searchResults.length > 0 && (
                            <div className="mt-8 space-y-4 text-left">
                                <div className="flex justify-between items-center text-left">
                                  <h4 className="font-black text-[10px] uppercase tracking-widest text-primary text-left">Query Results:</h4>
                                  <button onClick={clearSearch} className="text-[10px] font-black uppercase text-muted-foreground hover:text-primary transition-colors text-left underline underline-offset-4">Reset Query</button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                                    {searchResults.map(athlete => (
                                        <div key={`search-${athlete.id}`} className="flex items-center justify-between p-4 rounded-xl border-2 border-primary/10 bg-primary/5 hover:border-primary/30 transition-all text-left">
                                            <div className="text-left">
                                                <p className="font-black uppercase text-sm leading-tight text-left">{athlete.name}</p>
                                                <div className="flex items-center gap-2 mt-1 text-left">
                                                    <Badge variant="outline" className="h-4 text-[9px] font-black font-mono border-primary/20 text-primary">BIB {athlete.bib}</Badge>
                                                    <span className="text-[9px] font-bold text-muted-foreground uppercase text-left">{athlete.category}</span>
                                                </div>
                                            </div>
                                            <Button size="sm" variant="ghost" onClick={() => handleToggleTrackAthlete(athlete)} className="h-9 w-9 rounded-full bg-white shadow-sm border p-0 hover:bg-primary hover:text-white transition-all">
                                                <PlusCircle className="h-5 w-5"/>
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                    </Card>
                    <Card className="border-none shadow-xl text-left overflow-hidden">
                    <CardHeader className="text-left border-b bg-primary/5">
                        <CardTitle className="text-lg font-black uppercase tracking-tight text-left">Personal Watchlist ({trackedAthletes.length})</CardTitle>
                        <CardDescription className="text-left">Selected athletes for real-time map visualization.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar text-left">
                        {isFetching && trackedAthletes.length === 0 && trackedAthleteIds.size > 0 ? (
                           <div className="flex flex-col justify-center items-center py-12 gap-3 text-left">
                               <Loader2 className="h-8 w-8 animate-spin text-primary" />
                               <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Synchronizing Watchlist...</p>
                           </div>
                        ) : trackedAthletes.length > 0 ? (
                           <div className="grid grid-cols-1 gap-4 text-left">
                               {trackedAthletes.map(athlete => (
                                <BergmanTrackerCard 
                                    key={athlete.id} 
                                    data={athlete}
                                    onViewMap={handleViewOnMap} 
                                    onRemove={() => handleToggleTrackAthlete(athlete)} 
                                    onSelect={() => setSelectedAthleteForModal(athlete)}
                                />
                                ))}
                           </div>
                        ) : (
                           <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-4 text-left">
                               <Users className="h-12 w-12 opacity-20" />
                               <p className="font-bold uppercase text-[10px] tracking-widest max-w-[200px] text-left">Your watchlist is empty. Add athletes using the finder above.</p>
                           </div>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
      </div>

      <AthleteDetailModal
        athlete={selectedAthleteForModal}
        isOpen={!!selectedAthleteForModal}
        onClose={() => setSelectedAthleteForModal(null)}
        ticketDef={selectedAthleteTicketDef}
      />
    </>
  );
}
