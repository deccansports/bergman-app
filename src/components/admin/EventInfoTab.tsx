// src/components/admin/EventInfoTab.tsx
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import type { EventCalendarEntry, TicketDefinition, ContentBlock } from '@/lib/types';
import { addCalendarEventAction, updateCalendarEventAction, deleteCalendarEventAction } from '@/lib/actions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogFooter, 
    DialogClose,
    DialogDescription 
} from '@/components/ui/dialog';
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogHeader, 
    AlertDialogTitle, 
    AlertDialogTrigger, 
    AlertDialogFooter, 
    AlertDialogDescription 
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { 
    PlusCircle, Loader2, ArrowUp, ArrowDown, Save, Trash2, 
    Plane, MapPin, UserCircle, ShieldCheck, FileText, 
    LayoutGrid, Image as ImageIcon, Globe, Info, Waves, Bike, Footprints, BookOpen
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { countriesByContinent } from '@/lib/countries';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { parseISO, startOfDay, isBefore } from 'date-fns';
import { INDIAN_STATES, USA_STATES } from '@/lib/constants';
import { getEventRegistrationButtonState, isEventHidden, normalizeStateNameForCountry } from '@/lib/utils';

interface EventInfoTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

const EventFormSchema = z.object({
    eventName: z.string().min(1, "Event name is required."),
    organizerName: z.string().optional().nullable(),
    organizerAddress: z.string().optional().nullable(),
    organizerCompanyDescription: z.string().optional().nullable(),
    eventDate: z.string().optional().nullable().refine(val => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), { message: "Date must be in YYYY-MM-DD format." }),
    currency: z.enum(['INR', 'USD'], { required_error: "Currency is required." }),
    registrationUrl: z.string().url({ message: "Must be a valid URL." }).optional().or(z.literal('')),
    customSlug: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    photoUrl: z.string().url().optional().nullable(),
    athleteGuideBookUrl: z.string().url().optional().nullable(),
    customRules: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    startTime: z.string().optional().nullable(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Date must be in YYYY-MM-DD format." }).optional().nullable(),
    endTime: z.string().optional().nullable(),
    mode: z.enum(['Offline', 'Virtual', 'Hybrid']).optional().nullable(),
    venueName: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    venueDetails: z.string().optional().nullable(),
    googleMapsUrl: z.string().url().optional().nullable(),
    isSoldOut: z.boolean().default(false),
    isHidden: z.boolean().default(false),
    registrationButtonState: z.enum(['show', 'hide', 'sold_out']).default('show'),
    courseDetails: z.object({
        swim: z.string().optional().nullable(),
        bike: z.string().optional().nullable(),
        run: z.string().optional().nullable(),
    }).optional().nullable(),
    nearestAirport: z.object({
        name: z.string().optional().nullable(),
        url: z.string().url().optional().nullable(),
    }).optional().nullable(),
    blocks: z.array(z.object({
        id: z.string(),
        html: z.string(),
    })).optional().nullable(),
        temperatureMetrics: z.object({
            highAirTemp: z.string().optional().nullable(),
            lowAirTemp: z.string().optional().nullable(),
            avgWaterTemp: z.string().optional().nullable(),
        }).optional().nullable(),
});

type EventFormInput = z.infer<typeof EventFormSchema>;

const allCountriesList = Object.values(countriesByContinent).flat();
const getCountryFlagEmoji = (countryName?: string | null): string => {
    if (!countryName) return '';
    const countryData = allCountriesList.find(c => c.name.toLowerCase() === countryName.toLowerCase());
    return countryData ? countryData.flag : '';
};

export default function EventInfoTab({ events, isLoadingEvents, onDataRefresh }: EventInfoTabProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isViewOnlyAdmin = !!(currentUser?.isAdmin && currentUser?.adminAccessMode === 'view');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventCalendarEntry | null>(null);
  const [isUploading, setIsUploading] = useState<'image' | 'guidebook' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
    const [eventScope, setEventScope] = useState<'all' | 'upcoming'>('upcoming');
    const [eventSearchQuery, setEventSearchQuery] = useState('');
    const [countryFilter, setCountryFilter] = useState('all');
    const [stateFilter, setStateFilter] = useState('all');
    const [cityFilter, setCityFilter] = useState('all');

    const parseEventDateSafe = (value: any): Date | null => {
        if (!value) return null;
        if (value instanceof Date) return value;
        if (typeof value?.toDate === 'function') return value.toDate();
        if (typeof value === 'string') {
            const parsed = parseISO(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    };

    const upcomingEvents = useMemo(() => {
        const today = startOfDay(new Date());
        return events.filter((event) => {
            const eventDate = parseEventDateSafe(event.eventDate);
            return !!eventDate && !isBefore(startOfDay(eventDate), today);
        });
    }, [events]);

    const eventCity = (event: EventCalendarEntry) => {
        return (((event as any).city || '').toString().trim()) || (event.venueName || '').toString().trim();
    };

    const eventState = (event: EventCalendarEntry) => {
        return (normalizeStateNameForCountry(event.state, event.country) || '').toString().trim();
    };

    const scopedEvents = useMemo(() => eventScope === 'upcoming' ? upcomingEvents : events, [eventScope, upcomingEvents, events]);

    const countryOptions = useMemo(() => {
        const values = new Set(scopedEvents.map(e => (e.country || '').toString().trim()).filter(Boolean));
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [scopedEvents]);

    const stateOptions = useMemo(() => {
        const values = new Set(
            scopedEvents
                .filter(e => countryFilter === 'all' || (e.country || '').toString().trim() === countryFilter)
                .map(e => eventState(e))
                .filter(Boolean)
        );
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [scopedEvents, countryFilter]);

    const cityOptions = useMemo(() => {
        const values = new Set(
            scopedEvents
                .filter(e => countryFilter === 'all' || (e.country || '').toString().trim() === countryFilter)
                .filter(e => stateFilter === 'all' || eventState(e) === stateFilter)
                .map(e => eventCity(e))
                .filter(Boolean)
        );
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [scopedEvents, countryFilter, stateFilter]);

    const filteredEvents = useMemo(() => {
        const query = eventSearchQuery.trim().toLowerCase();
        return scopedEvents.filter(e => {
            const country = (e.country || '').toString().trim();
            const state = eventState(e);
            const city = eventCity(e);

            const matchesCountry = countryFilter === 'all' || country === countryFilter;
            const matchesState = stateFilter === 'all' || state === stateFilter;
            const matchesCity = cityFilter === 'all' || city === cityFilter;

            const haystack = `${e.eventName || ''} ${country} ${state} ${city}`.toLowerCase();
            const matchesSearch = !query || haystack.includes(query);

            return matchesCountry && matchesState && matchesCity && matchesSearch;
        });
    }, [scopedEvents, eventSearchQuery, countryFilter, stateFilter, cityFilter]);

    const sortedFilteredEvents = useMemo(() => {
        const today = startOfDay(new Date());
        
        const upcoming: EventCalendarEntry[] = [];
        const past: EventCalendarEntry[] = [];
        
        filteredEvents.forEach(event => {
            const eventDate = event.eventDate ? startOfDay(parseISO(event.eventDate)) : null;
            if (eventDate && eventDate >= today) {
                upcoming.push(event);
            } else {
                past.push(event);
            }
        });
        
        // Sort upcoming by date ascending (earliest first)
        upcoming.sort((a, b) => {
            const aDate = a.eventDate ? startOfDay(parseISO(a.eventDate)) : null;
            const bDate = b.eventDate ? startOfDay(parseISO(b.eventDate)) : null;
            if (aDate && bDate) return aDate.getTime() - bDate.getTime();
            if (aDate) return -1;
            if (bDate) return 1;
            return 0;
        });
        
        // Sort past by date descending (latest first, so 2025, 2024, 2023, etc.)
        past.sort((a, b) => {
            const aDate = a.eventDate ? startOfDay(parseISO(a.eventDate)) : null;
            const bDate = b.eventDate ? startOfDay(parseISO(b.eventDate)) : null;
            if (aDate && bDate) return bDate.getTime() - aDate.getTime();
            if (aDate) return 1;
            if (bDate) return -1;
            return 0;
        });
        
        return [...upcoming, ...past];
    }, [filteredEvents]);

  const form = useForm<EventFormInput>({
    resolver: zodResolver(EventFormSchema),
    defaultValues: { 
        eventName: '', eventDate: '', currency: 'INR', registrationUrl: '', blocks: [],
        registrationButtonState: 'show',
        courseDetails: { swim: '', bike: '', run: '' },
        nearestAirport: { name: '', url: '' },
            temperatureMetrics: { highAirTemp: '', lowAirTemp: '', avgWaterTemp: '' },
        customRules: ''
    }
  });

    const eventCountryValue = form.watch('country');
    const isIndiaSelectedInEventForm = (eventCountryValue || '').trim().toLowerCase() === 'india';
    const isUSASelectedInEventForm = (eventCountryValue || '').trim().toLowerCase() === 'united states';

    const uniqueIndianStates = useMemo(() => {
        const seen = new Set<string>();
        return INDIAN_STATES.filter((stateItem) => {
            const key = (stateItem.value || stateItem.label || '').trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, []);

    const uniqueUSAStates = useMemo(() => {
        const seen = new Set<string>();
        return USA_STATES.filter((stateItem) => {
            const key = (stateItem.value || stateItem.label || '').trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, []);

    useEffect(() => {
        if (!eventCountryValue) return;

        // Keep state field free-text for countries other than India/USA.
        // If switching to India/USA and existing value isn't in list, clear it.
        const currentState = (form.getValues('state') || '').trim();
        if (!currentState) return;

        if (isIndiaSelectedInEventForm) {
            const valid = uniqueIndianStates.some(s => s.value === currentState);
            if (!valid) form.setValue('state', null);
            return;
        }

        if (isUSASelectedInEventForm) {
            const valid = uniqueUSAStates.some(s => s.value === currentState);
            if (!valid) form.setValue('state', null);
        }
    }, [eventCountryValue, isIndiaSelectedInEventForm, isUSASelectedInEventForm, uniqueIndianStates, uniqueUSAStates, form]);

  const onEventSubmit = async (data: EventFormInput) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const payload: { [key: string]: any } = {};
     for (const key in data) {
        if (data[key as keyof EventFormInput] !== undefined && data[key as keyof EventFormInput] !== '') {
            payload[key] = data[key as keyof EventFormInput];
        }
     }

    payload.isSoldOut = data.registrationButtonState === 'sold_out';
    
    try {
        const action = editingEvent ? updateCalendarEventAction(editingEvent.id, payload) : addCalendarEventAction(payload);
        const result = await action;
        if(result.success) {
            toast({ title: 'Success', description: result.message });
            onDataRefresh();
            setIsEventModalOpen(false);
            setEditingEvent(null);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleFileUpload = async (file: File | null, type: 'image' | 'athleteGuideBookUrl') => {
    if (!file || !editingEvent?.id) return;
    
    const uploadKey = type === 'image' ? 'image' : 'guidebook';
    setIsUploading(uploadKey);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    formData.append('eventId', editingEvent.id);

    try {
        const response = await fetch('/api/admin/upload-event-asset', {
            method: 'POST',
            body: formData,
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.message || 'File upload failed.');
        }
        
        toast({ title: "Upload Successful" });
        form.setValue(result.fieldToUpdate as any, result.downloadURL);

    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Upload Failed', description: error.message });
    } finally {
        setIsUploading(null);
    }
  };

  const handleEditClick = (event: EventCalendarEntry) => {
    setEditingEvent(event);
    form.reset({
      eventName: event.eventName,
      organizerName: event.organizerName || null,
      organizerAddress: event.organizerAddress || null,
      organizerCompanyDescription: event.organizerCompanyDescription || null,
      eventDate: event.eventDate || null,
      currency: (event.currency as 'INR' | 'USD') || 'INR',
      registrationUrl: event.registrationUrl || '',
      customSlug: event.customSlug || null,
      description: event.description || null,
      photoUrl: event.photoUrl || null,
      athleteGuideBookUrl: event.athleteGuideBookUrl || null,
      customRules: event.customRules || null,
      address: event.address || null,
      startTime: event.startTime || null,
      endDate: event.endDate || null,
      endTime: event.endTime || null,
      mode: event.mode || null,
      venueName: event.venueName || null,
      country: event.country || null,
      state: event.state || null,
      venueDetails: event.venueDetails || null,
      googleMapsUrl: event.googleMapsUrl || null,
      isSoldOut: event.isSoldOut || false,
      isHidden: isEventHidden(event),
    registrationButtonState: getEventRegistrationButtonState(event),
      courseDetails: {
          swim: event.courseDetails?.swim || '',
          bike: event.courseDetails?.bike || '',
          run: event.courseDetails?.run || '',
      },
          temperatureMetrics: {
              highAirTemp: event.temperatureMetrics?.highAirTemp || '',
              lowAirTemp: event.temperatureMetrics?.lowAirTemp || '',
              avgWaterTemp: event.temperatureMetrics?.avgWaterTemp || '',
          },
      nearestAirport: {
          name: event.nearestAirport?.name || '',
          url: event.nearestAirport?.url || '',
      },
      blocks: event.blocks || [],
    });
    setIsEventModalOpen(true);
  };
  
    const handleAddBlock = () => {
        const currentBlocks = form.getValues('blocks') || [];
        form.setValue('blocks', [...currentBlocks, { id: `b${Date.now()}`, html: '<p>New section content...</p>' }]);
    };

    const handleUpdateBlock = (index: number, html: string) => {
        const currentBlocks = form.getValues('blocks') || [];
        const newBlocks = [...currentBlocks];
        newBlocks[index].html = html;
        form.setValue('blocks', newBlocks);
    };
  
  const handleRemoveBlock = (blockId: string) => {
        const currentBlocks = form.getValues('blocks') || [];
        form.setValue('blocks', currentBlocks.filter(b => b.id !== blockId));
  };
  
  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    const currentBlocks = form.getValues('blocks') || [];
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === currentBlocks.length - 1)) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const newBlocks = [...currentBlocks];
    const temp = newBlocks[index];
    newBlocks[index] = newBlocks[newIndex];
    newBlocks[newIndex] = temp;
    form.setValue('blocks', newBlocks);
  };

  return (
    <div className="space-y-6 text-left">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between text-left">
          <div className="text-left">
            <CardTitle>Event Catalog</CardTitle>
            <CardDescription>Manage all race events, venues, and rich page content.</CardDescription>
          </div>
          <Button size="sm" onClick={() => { setEditingEvent(null); form.reset({ eventName: '', eventDate: '', currency: 'INR', blocks: [], registrationButtonState: 'show' }); setIsEventModalOpen(true); }} disabled={isViewOnlyAdmin}><PlusCircle className="mr-2 h-4 w-4"/>Add Event</Button>
        </CardHeader>
        <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
                        <Select value={eventScope} onValueChange={(v: 'all' | 'upcoming') => setEventScope(v)}>
                            <SelectTrigger><SelectValue placeholder="Event Scope" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="upcoming">Upcoming Events</SelectItem>
                                <SelectItem value="all">All Events</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            placeholder="Search events..."
                            value={eventSearchQuery}
                            onChange={(e) => setEventSearchQuery(e.target.value)}
                            className="md:col-span-1"
                        />
                        <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setStateFilter('all'); setCityFilter('all'); }}>
                            <SelectTrigger><SelectValue placeholder="Country" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Countries</SelectItem>
                                {countryOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={stateFilter} onValueChange={(v) => { setStateFilter(v); setCityFilter('all'); }}>
                            <SelectTrigger><SelectValue placeholder="State" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All States</SelectItem>
                                {stateOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={cityFilter} onValueChange={setCityFilter}>
                            <SelectTrigger><SelectValue placeholder="City" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Cities</SelectItem>
                                {cityOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="text-xs text-muted-foreground mb-3">
                        Showing {filteredEvents.length} of {scopedEvents.length} {eventScope === 'upcoming' ? 'upcoming' : 'total'} event(s)
                    </div>

          {isLoadingEvents ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin h-4 w-4 text-primary"/></div>
          ) : (
                        <div className="rounded-md border">
                            <ScrollArea className={eventScope === 'upcoming' && filteredEvents.length > 3 ? 'max-h-[360px]' : ''}>
                            <Table>
              <TableHeader><TableRow><TableHead>Event Identity</TableHead><TableHead>Race Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                            <TableBody>{sortedFilteredEvents.map(event => (<TableRow key={event.id}>
                <TableCell className="font-bold uppercase tracking-tight text-left">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">{getCountryFlagEmoji(event.country)}</span>
                        <div className="text-left">
                            <p>{event.eventName}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{event.id}</p>
                        </div>
                    </div>
                </TableCell>
                <TableCell className="font-medium">{event.eventDate || 'TBD'}</TableCell>
                <TableCell>
                    <div className="flex gap-1.5 text-left">
                        {isEventHidden(event) && <Badge variant="secondary" className="text-[10px] uppercase">Hidden</Badge>}
                        {getEventRegistrationButtonState(event) === 'hide' && <Badge variant="outline" className="text-[10px] uppercase">Reg Hidden</Badge>}
                        {event.isSoldOut && <Badge variant="destructive" className="text-[10px] uppercase">Sold Out</Badge>}
                        {!isEventHidden(event) && getEventRegistrationButtonState(event) === 'show' && !event.isSoldOut && <Badge variant="default" className="bg-green-600 text-[10px] uppercase text-left">Live</Badge>}
                    </div>
                </TableCell>
                <TableCell className="text-right space-x-1">
                <Button type="button" size="xs" variant="outline" onClick={() => handleEditClick(event)} disabled={isViewOnlyAdmin}>Edit</Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild><Button type="button" size="xs" variant="destructive" disabled={isViewOnlyAdmin}>Delete</Button></AlertDialogTrigger>
                    <AlertDialogContent className="text-left">
                        <AlertDialogHeader className="text-left">
                            <AlertDialogTitle className="text-left">Confirm Permanent Deletion?</AlertDialogTitle>
                            <AlertDialogDescription className="text-left">This will remove &quot;{event.eventName}&quot; from the catalog. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="text-left">
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={async () => await deleteCalendarEventAction(event.id).then(() => onDataRefresh())} className="bg-destructive hover:bg-destructive/90">Confirm Delete</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                            </TableCell></TableRow>))}
                            {sortedFilteredEvents.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground italic">
                                        No events match current filters.
                                    </TableCell>
                                </TableRow>
                            )}
                            </TableBody>
                        </Table>
                        </ScrollArea>
                        </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEventModalOpen} onOpenChange={setIsEventModalOpen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden text-left">
            <DialogHeader className="p-6 border-b flex-shrink-0 text-left">
                <DialogTitle className="text-2xl font-black uppercase italic tracking-tighter text-left">{editingEvent ? 'Update Event Record' : 'Create New Event'}</DialogTitle>
                <DialogDescription className="text-left">Configure all global parameters, location, media, and rich content blocks.</DialogDescription>
            </DialogHeader>
             <ScrollArea className="flex-1 px-6 text-left">
                 <Form {...form}>
                    <form onSubmit={form.handleSubmit(onEventSubmit)} className="space-y-10 py-8 text-left">
                            
                            {/* SECTION 1: GENERAL IDENTITY */}
                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 border-b pb-2 text-left">
                                    <Info className="h-4 w-4" /> 1. General Identity & Status
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                    <FormField control={form.control} name="eventName" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Official Event Name*</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Bergman Ozar Pune 2026" className="font-bold"/></FormControl><FormMessage/></FormItem>)}/>
                                    <FormField control={form.control} name="customSlug" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">SEO URL Slug</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. bergman-ozar-pune" className="font-mono"/></FormControl><FormDescription className="text-[10px] text-left">Appears as /races/[slug]</FormDescription><FormMessage/></FormItem>)}/>
                                </div>
                                <FormField control={form.control} name="description" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Summary Description</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} placeholder="Short overview for the race list card..." rows={3}/></FormControl><FormMessage/></FormItem>)}/>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                                    <FormField control={form.control} name="eventDate" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Race Start Date (Optional)</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''}/></FormControl><FormMessage/></FormItem>)}/>
                                    <FormField control={form.control} name="currency" render={({field}) => (
                                        <FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Base Currency</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value || 'INR'}>
                                                <FormControl><SelectTrigger className="text-left"><SelectValue/></SelectTrigger></FormControl>
                                                <SelectContent className="text-left"><SelectItem value="INR">Indian Rupee (INR)</SelectItem><SelectItem value="USD">US Dollar (USD)</SelectItem></SelectContent>
                                            </Select>
                                        </FormItem>
                                    )} />
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:col-span-2 text-left">
                                        <FormField control={form.control} name="registrationButtonState" render={({ field }) => (
                                            <FormItem className="text-left">
                                                <FormLabel className="text-xs font-bold uppercase text-left">Registration Button</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value || 'show'}>
                                                    <FormControl><SelectTrigger className="text-left"><SelectValue /></SelectTrigger></FormControl>
                                                    <SelectContent className="text-left">
                                                        <SelectItem value="show">Show Register Button</SelectItem>
                                                        <SelectItem value="hide">Hide Register Button</SelectItem>
                                                        <SelectItem value="sold_out">Show Sold Out</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormDescription className="text-[10px] text-left">Controls only the registration CTA on public event pages.</FormDescription>
                                            </FormItem>
                                        )}/>
                                        <FormField control={form.control} name="isHidden" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-2 space-y-0 text-left text-left"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange}/></FormControl><FormLabel className="font-bold text-xs uppercase cursor-pointer text-destructive text-left">Hidden</FormLabel></FormItem>
                                        )}/>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION 2: LOCATION & VENUE */}
                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 border-b pb-2 text-left">
                                    <MapPin className="h-4 w-4" /> 2. Venue & Logistics
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                    <FormField control={form.control} name="venueName" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Venue/Dam Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Ozar Dam" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="address" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Detailed Address</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Full postal address" /></FormControl></FormItem>)}/>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                                    <FormField control={form.control} name="country" render={({ field }) => (
                                        <FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Country</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                                <FormControl><SelectTrigger className="rounded-xl h-11 font-bold text-left"><SelectValue placeholder="Select Country"/></SelectTrigger></FormControl>
                                                <SelectContent className="text-left">
                                                    {Object.entries(countriesByContinent).map(([continent, countries]) => (
                                                        <SelectGroup key={continent}>
                                                            <SelectLabel>{continent}</SelectLabel>
                                                            {countries.map(c => (<SelectItem key={c.code} value={c.name}>{c.name}</SelectItem>))}
                                                        </SelectGroup>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}/>
                                    <FormField control={form.control} name="state" render={({field})=>(
                                        <FormItem className="text-left">
                                            <FormLabel className="text-xs font-bold uppercase text-left">State</FormLabel>
                                            {isIndiaSelectedInEventForm || isUSASelectedInEventForm ? (
                                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                                    <FormControl>
                                                        <SelectTrigger className="rounded-xl h-11 font-bold text-left">
                                                            <SelectValue placeholder="Select State" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="text-left">
                                                        {(isIndiaSelectedInEventForm ? uniqueIndianStates : uniqueUSAStates).map((stateItem) => (
                                                            <SelectItem key={stateItem.value} value={stateItem.value}>{stateItem.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Maharashtra" /></FormControl>
                                            )}
                                        </FormItem>
                                    )}/>
                                    <FormField control={form.control} name="googleMapsUrl" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Google Maps URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="https://maps.google.com/..." /></FormControl></FormItem>)}/>
                                </div>
                                <Separator className="bg-primary/10" />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                    <FormField control={form.control} name="nearestAirport.name" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase flex items-center gap-2 text-left text-left"><Plane className="h-3 w-3" /> Nearest Airport Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Pune International Airport (PNQ)" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="nearestAirport.url" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left text-left">Airport Directions URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="https://..." /></FormControl></FormItem>)}/>
                                </div>
                            </div>

                            {/* SECTION 3: COURSE OVERVIEW */}
                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 border-b pb-2 text-left">
                                    <LayoutGrid className="h-4 w-4" /> 3. Course Profile Summary
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                                    <FormField control={form.control} name="courseDetails.swim" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left"><Waves className="h-3 w-3 text-sky-500" /> Swim Characteristics</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Fresh Water Lake, Calm" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="courseDetails.bike" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left"><Bike className="h-3 w-3 text-green-600" /> Bike Characteristics</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Fast Rolling, Highway" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="courseDetails.run" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left"><Footprints className="h-3 w-3 text-orange-600" /> Run Characteristics</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Completely Flat, Scenic" /></FormControl></FormItem>)}/>
                                </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                                        <FormField control={form.control} name="temperatureMetrics.highAirTemp" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">High Air Temp</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="23°C / 74°F" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="temperatureMetrics.lowAirTemp" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">Low Air Temp</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="13°C / 55°F" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="temperatureMetrics.avgWaterTemp" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2 text-left text-left">Avg. Water Temp</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="20°C / 68°F" /></FormControl></FormItem>)}/>
                                    </div>
                            </div>

                            {/* SECTION 4: ORGANIZER DETAILS */}
                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 border-b pb-2 text-left">
                                    <UserCircle className="h-4 w-4" /> 4. Organizer Information
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                    <FormField control={form.control} name="organizerName" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Official Entity Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="e.g. Deccan Sports Club" /></FormControl></FormItem>)}/>
                                    <FormField control={form.control} name="organizerAddress" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Registered Office Address</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl></FormItem>)}/>
                                </div>
                                <FormField control={form.control} name="organizerCompanyDescription" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Company Short Bio</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} placeholder="About the organizer for invoices and guides..." rows={3}/></FormControl></FormItem>)}/>
                            </div>

                            {/* SECTION 5: MEDIA & RESOURCES */}
                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 border-b pb-2 text-left">
                                    <ImageIcon className="h-4 w-4" /> 5. Media & Athlete Resources
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                                    <div className="p-6 border-2 border-dashed rounded-2xl bg-muted/30 space-y-4 text-left">
                                        <div className="flex items-center justify-between text-left">
                                            <Label className="font-black uppercase text-xs text-left">Event Hero Banner</Label>
                                            {isUploading === 'image' && <Loader2 className="h-4 w-4 animate-spin text-primary"/>}
                                        </div>
                                        <Input type="file" onChange={(e) => handleFileUpload(e.target.files?.[0] || null, 'image')} accept="image/*" disabled={!editingEvent?.id || !!isUploading} />
                                        <FormField control={form.control} name="photoUrl" render={({field}) => (
                                            <FormItem className="text-left"><FormLabel className="text-[10px] uppercase font-bold text-muted-foreground text-left">Or Direct Image URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-8 text-xs font-mono" /></FormControl></FormItem>
                                        )}/>
                                    </div>
                                    <div className="p-6 border-2 border-dashed rounded-2xl bg-muted/30 space-y-4 text-left">
                                        <div className="flex items-center justify-between text-left">
                                            <Label className="font-black uppercase text-xs text-left">Athlete Guide (PDF)</Label>
                                            {isUploading === 'guidebook' && <Loader2 className="h-4 w-4 animate-spin text-primary"/>}
                                        </div>
                                        <Input type="file" onChange={(e) => handleFileUpload(e.target.files?.[0] || null, 'athleteGuideBookUrl')} accept="application/pdf" disabled={!editingEvent?.id || !!isUploading} />
                                        <FormField control={form.control} name="athleteGuideBookUrl" render={({field}) => (
                                            <FormItem className="text-left"><FormLabel className="text-[10px] uppercase font-bold text-muted-foreground text-left">Or Direct PDF URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="h-8 text-xs font-mono" /></FormControl></FormItem>
                                        )}/>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION 6: RULES & REGULATIONS */}
                            <div className="space-y-6 text-left">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 border-b pb-2 text-left">
                                    <BookOpen className="h-4 w-4" /> 6. Rules & Regulations
                                </h3>
                                <FormField control={form.control} name="customRules" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs font-bold uppercase text-left">Rules Content (HTML/Text)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} placeholder="Detailed race rules, weather disclaimers, etc..." rows={10} className="font-mono text-xs"/></FormControl><FormDescription className="text-[10px] text-left">Custom rules will overwrite the default site rules for this event.</FormDescription><FormMessage/></FormItem>)}/>
                            </div>

                            {/* SECTION 7: RICH CONTENT BLOCKS */}
                            <div className="space-y-6 pt-4 border-t text-left">
                                <div className="flex justify-between items-center text-left">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 text-left">
                                        <ShieldCheck className="h-4 w-4" /> 7. Dynamic Content Sections (SEO)
                                    </h3>
                                    <Button type="button" size="sm" variant="outline" onClick={handleAddBlock} disabled={isSubmitting} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">
                                        <PlusCircle className="mr-2 h-4 w-4"/>Add Rich Section
                                    </Button>
                                </div>
                                <div className="space-y-4 text-left">
                                    {(form.watch('blocks') || []).length === 0 && (
                                        <div className="text-center py-10 border border-dashed rounded-2xl text-muted-foreground italic text-sm text-left">
                                            No custom sections added yet.
                                        </div>
                                    )}
                                    {(form.watch('blocks') || []).map((block, index) => (
                                        <div key={block.id} className="p-4 border-2 rounded-2xl bg-muted/10 space-y-3 relative text-left">
                                            <div className="flex justify-between items-center text-left">
                                                <Badge variant="outline" className="font-mono text-[10px]">Block ID: {block.id}</Badge>
                                                <div className="flex gap-1 text-left">
                                                    <Button size="icon" variant="ghost" type="button" onClick={() => handleMoveBlock(index, 'up')} disabled={index === 0} className="h-8 w-8"><ArrowUp className="h-4 w-4"/></Button>
                                                    <Button size="icon" variant="ghost" type="button" onClick={() => handleMoveBlock(index, 'down')} disabled={index === (form.watch('blocks')?.length || 0) - 1} className="h-8 w-8"><ArrowDown className="h-4 w-4"/></Button>
                                                    <Button size="icon" variant="ghost" className="text-destructive h-8 w-8" type="button" onClick={() => handleRemoveBlock(block.id)}><Trash2 className="h-4 w-4"/></Button>
                                                </div>
                                            </div>
                                            <Textarea 
                                                value={block.html} 
                                                onChange={(e) => handleUpdateBlock(index, e.target.value)} 
                                                rows={10} 
                                                className="bg-background font-mono text-xs leading-relaxed text-left" 
                                                placeholder="<section><h2>Title</h2><p>Content...</p></section>"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                    </form>
                </Form>
            </ScrollArea>
            <DialogFooter className="p-6 border-t bg-muted/20 flex-shrink-0 text-left">
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button onClick={form.handleSubmit(onEventSubmit)} disabled={isSubmitting || !!isUploading} className="min-w-[160px] h-12 rounded-xl font-black uppercase tracking-widest shadow-xl">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                    {editingEvent ? 'Save Changes' : 'Publish Event'}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
