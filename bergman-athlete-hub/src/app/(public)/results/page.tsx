
// src/app/(public)/results/page.tsx
"use client";

import { useEffect, useState, useMemo, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getEventBySlugAction, getEventDetailsWithTicketsAction, getPublicFinalResultsAction, getDistinctEventsFromResultsAction } from '@/lib/actions';
import type { RaceResult, EventCalendarEntry, TicketDefinition } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, CalendarDays, FilterX, Users, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import FinisherCertificate from '@/components/results/FinisherCertificate';
import { AppHeader } from '@/components/layout/AppHeader';
import { format, parseISO } from 'date-fns';
import { normalizeStatus, formatSecondsToHMS, hmsToSeconds } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';


const getInitials = (name?: string | null) => {
    if (!name) return '';
    const names = name?.split(' ') ?? [];
    if (names.length > 1) { return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase(); }
    return name?.substring(0, 2).toUpperCase() ?? '';
};

// Map from country names to ISO 3166-1 alpha-2 codes
const countryNameToCode: { [key: string]: string } = {
    'India': 'IN', 'United States': 'US', 'USA / Canada': 'US', 'United Kingdom': 'GB', 'Canada': 'CA',
    'Australia': 'AU', 'Germany': 'DE', 'France': 'FR', 'Singapore': 'SG', 'United Arab Emirates': 'AE',
    'Afghanistan': 'AF', 'Brazil': 'BR', 'China': 'CN', 'Egypt': 'EG', 'Japan': 'JP',
    'Mexico': 'MX', 'Nigeria': 'NG', 'Russia': 'RU', 'South Africa': 'ZA', 'Other': 'XX'
};

const getCountryFlagEmoji = (countryName?: string | null): string => {
    if (!countryName || typeof countryName !== 'string') return '';
    const countryCode = countryNameToCode[countryName];
    if (!countryCode || countryCode === 'XX') return '';
    // Formula to convert country code to flag emoji
    return String.fromCodePoint(...Array.from(countryCode.toUpperCase()).map(c => 0x1F1A5 + c.charCodeAt(0)));
};

function ResultsPageContent() {
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [events, setEvents] = useState<{ id: string, name: string, date: string | null, customSlug?: string | null }[]>([]);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [results, setResults] = useState<RaceResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [searchType, setSearchType] = useState<'bib' | 'name' | 'email' | 'mobile'>('name');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedAthlete, setSelectedAthlete] = useState<RaceResult | null>(null);
    const [selectedEventDetails, setSelectedEventDetails] = useState<EventCalendarEntry | null>(null);

    const handleSearch = useCallback(async () => {
        if (!selectedEventId) {
            toast({ variant: 'destructive', title: 'Error', description: 'Please select an event first.' });
            return;
        }
         if (!searchTerm) {
            toast({ variant: 'destructive', title: 'Error', description: 'Please enter a search term.' });
            return;
        }
        setIsSearching(true);
        setSelectedAthlete(null); 

        const eventDetailsResult = await getEventDetailsWithTicketsAction(selectedEventId);
        if (eventDetailsResult.success && eventDetailsResult.event) {
            setSelectedEventDetails(eventDetailsResult.event);
        } else {
            setSelectedEventDetails(null);
        }
        
        const allResults = await getPublicFinalResultsAction(selectedEventId);

        if (allResults.success && allResults.participants) {
            let filtered: RaceResult[] = [];
            
            if (searchTerm) {
                const lowerSearchTerm = searchTerm.toLowerCase();
                 filtered = allResults.participants.filter((p: RaceResult) => {
                    const participantData = p as any;
                    switch(searchType) {
                        case 'name': 
                          return p.name.toLowerCase().includes(lowerSearchTerm);
                        case 'bib':
                           return p.bibNumber === searchTerm;
                        case 'email':
                          return participantData.email?.toLowerCase().includes(lowerSearchTerm);
                        case 'mobile':
                          return participantData.mobile?.includes(searchTerm);
                        default: 
                          return true;
                    }
                });
            }
            setResults(filtered);
            if (filtered.length === 0 && searchTerm) {
                 toast({ title: 'No Results', description: 'No matching results found for your search.' });
            }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: allResults.message || 'Could not fetch results for the selected event.' });
            setResults([]);
        }
        setIsSearching(false);
    }, [selectedEventId, searchTerm, searchType, toast]);
    

    const fetchAndSetSelectedAthleteBySlug = useCallback(async (eventSlug: string, bib: string) => {
        setIsLoading(true);
        const eventDetailsResult = await getEventBySlugAction(eventSlug);
        if (eventDetailsResult.success && eventDetailsResult.event) {
            const eventId = eventDetailsResult.event.id;
            setSelectedEventId(eventId);
            
            const fullEventDetailsResult = await getEventDetailsWithTicketsAction(eventId);
            if (fullEventDetailsResult.success && fullEventDetailsResult.event) {
                setSelectedEventDetails(fullEventDetailsResult.event);
            } else {
                 setSelectedEventDetails(eventDetailsResult.event);
            }
            
            const resultsResult = await getPublicFinalResultsAction(eventId, [bib]);
            if (resultsResult.success && resultsResult.participants) {
                const athlete = resultsResult.participants.find((p: RaceResult) => p.bibNumber === bib);
                if (athlete) {
                    setSelectedAthlete(athlete);
                } else {
                    toast({ variant: 'destructive', title: 'Not Found', description: `Athlete with BIB ${bib} not found in this event.` });
                    router.replace('/results');
                }
            } else {
                toast({ variant: 'destructive', title: 'Error', description: resultsResult.message || 'Could not fetch results.' });
                router.replace('/results');
            }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: eventDetailsResult.message || 'Event not found.' });
            router.replace('/results');
        }
        setIsLoading(false);
    }, [toast, router]);

    useEffect(() => {
        const eventSlugFromUrl = searchParams.get('eventSlug');
        const bibFromUrl = searchParams.get('bib');

        async function fetchInitialData() {
            setIsLoading(true);
            try {
                const eventListResult = await getDistinctEventsFromResultsAction();
                if (eventListResult.success && Array.isArray(eventListResult.events)) {
                    const formattedEvents = eventListResult.events.map(e => ({
                        id: e.id,
                        name: e.name,
                        date: e.date,
                        customSlug: e.customSlug,
                    })).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()); // Sort descending
                    setEvents(formattedEvents);

                    if (eventSlugFromUrl && bibFromUrl) {
                        await fetchAndSetSelectedAthleteBySlug(eventSlugFromUrl, bibFromUrl);
                    } else {
                        setIsLoading(false);
                    }
                } else {
                    setIsLoading(false);
                    toast({ variant: 'destructive', title: 'Error', description: eventListResult.message || 'Could not load the list of events.' });
                }
            } catch (error: any) {
                setIsLoading(false);
                toast({ variant: 'destructive', title: 'Error', description: `Failed to load events: ${error.message}` });
            }
        }
        fetchInitialData();
    }, [searchParams, fetchAndSetSelectedAthleteBySlug, toast]);

    
    const openFinisherCertificate = (athlete: RaceResult) => {
        const eventInfo = events.find(e => e.id === selectedEventId);
        // Fallback from customSlug to eventId to ensure a link is always generated.
        const slug = eventInfo?.customSlug || eventInfo?.id;
        if (slug) {
            router.push(`/results?eventSlug=${slug}&bib=${athlete.bibNumber}`);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not generate certificate link.'});
        }
        setSelectedAthlete(athlete);
    };

    const selectedAthleteTicketDef = useMemo(() => {
        if (!selectedAthlete || !selectedEventDetails?.ticketDefinitions) return undefined;
        // Use ticketName if available, otherwise fall back to category
        const keyToMatch = selectedAthlete.ticketName || selectedAthlete.category;
        return selectedEventDetails.ticketDefinitions.find(td => td.ticketName === keyToMatch);
    }, [selectedAthlete, selectedEventDetails]);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }
    
    if (selectedAthlete) {
        return (
            <FinisherCertificate
                athlete={selectedAthlete}
                eventName={selectedEventDetails?.eventName || 'Race'}
                eventSlug={selectedEventDetails?.customSlug || selectedEventDetails?.id}
                onBack={() => {
                    setSelectedAthlete(null);
                    router.push('/results');
                }}
                ticketDef={selectedAthleteTicketDef}
            />
        );
    }
    
    return (
        <>
            <AppHeader />
            <section className="w-full py-12 md:py-16 lg:py-20 bg-gradient-to-r from-primary/10 via-background to-background">
              <div className="container px-4 md:px-6 mx-auto text-center">
                <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl text-primary">
                  Race Results
                </h1>
                <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl mt-4">
                  Find your official race results, view detailed splits, and download your finisher certificate.
                </p>
              </div>
            </section>
            <main className="container mx-auto py-8 px-4 flex-grow">
                <Card className="max-w-4xl mx-auto shadow-lg">
                    <CardHeader>
                        <CardTitle>Find Your Race Result</CardTitle>
                        <CardDescription>Select an event and search for your result.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Select onValueChange={setSelectedEventId} value={selectedEventId || ''}>
                                <SelectTrigger><SelectValue placeholder="Select an Event..." /></SelectTrigger>
                                <SelectContent>
                                  {events.map(e => (
                                    <SelectItem key={e.id} value={e.id}>
                                      {e.date ? `${format(parseISO(e.date), 'dd MMM yyyy')} - ` : ''}{e.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                            </Select>
                            <Select value={searchType} onValueChange={(v) => setSearchType(v as any)}>
                                <SelectTrigger><SelectValue placeholder="Search by..." /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="name">Name</SelectItem>
                                    <SelectItem value="bib">BIB Number</SelectItem>
                                    <SelectItem value="email">Email</SelectItem>
                                    <SelectItem value="mobile">Mobile</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="flex gap-2">
                             <Input placeholder={`Enter ${searchType} to search...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                             <Button type="submit" disabled={isSearching || !selectedEventId}>
                                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                             </Button>
                        </form>

                        {isSearching ? (
                            <div className="flex justify-center items-center p-8">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                        ) : results.length > 0 && (
                            <div className="rounded-md border mt-4">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Athlete</TableHead>
                                            <TableHead>BIB</TableHead>
                                            <TableHead>Category</TableHead>
                                            <TableHead>Overall Rank</TableHead>
                                            <TableHead>Timing</TableHead>
                                            <TableHead className="text-right">Action / Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {results.map(res => (
                                            <TableRow key={res.docId}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-3">
                                                        <Avatar className="h-8 w-8">
                                                            <AvatarImage src={(res as any).photoURL || undefined} alt={res.name} />
                                                            <AvatarFallback>{getInitials(res.name)}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="flex flex-col">
                                                            <Button variant="link" className="p-0 h-auto text-left" onClick={() => openFinisherCertificate(res)}>
                                                                <span className="mr-2">{getCountryFlagEmoji((res as any).country)}</span>
                                                                {res.name}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>{res.bibNumber}</TableCell>
                                                <TableCell>{res.category}</TableCell>
                                                <TableCell>{res.oRank || 'N/A'}</TableCell>
                                                <TableCell className="font-mono">
                                                  {normalizeStatus(res.status) === 'Finished' && res.chipTime
                                                    ? formatSecondsToHMS(hmsToSeconds(res.chipTime))
                                                    : 'N/A'}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {normalizeStatus(res.status) === 'Finished' ? (
                                                        <Button variant="outline" size="sm" onClick={() => openFinisherCertificate(res)}>View & Download</Button>
                                                    ) : (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Badge variant="destructive">{res.status || 'N/A'}</Badge>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="bg-primary text-primary-foreground">
                                                                    <p>Keep pushing! Every race is a learning opportunity. Come back stronger for the next one!</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </main>
        </>
    );
}

export default function ResultsPage() {
    return (
        <Suspense fallback={<div className="flex justify-center items-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
            <ResultsPageContent />
        </Suspense>
    );
}
