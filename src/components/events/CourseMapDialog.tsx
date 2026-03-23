// src/components/events/CourseMapDialog.tsx
"use client";

import React, { useState, useMemo, useCallback } from 'react';
import type { EventCalendarEntry, TicketDefinition, CustomSplitPoint } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import MapViewer, { type GpxPath } from '@/components/live-tracking/MapViewer';
import ElevationProfileChart from '@/components/live-tracking/ElevationProfileChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Map as MapIcon, Download, Waves, Bike, Footprints, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const gpxAssetConfig = {
  swimGpxUrl: { color: '#0ea5e9', type: 'swim', icon: Waves, descriptionKey: 'swimDescription' },
  bikeGpxUrl: { color: '#22c55e', type: 'bike', icon: Bike, descriptionKey: 'bikeDescription' },
  runGpxUrl: { color: '#f97316', type: 'run', icon: Footprints, descriptionKey: 'runDescription' },
  run1GpxUrl: { color: '#f97316', type: 'run1', icon: Footprints, descriptionKey: 'run1Description' },
  run2GpxUrl: { color: '#f59e0b', type: 'run2', icon: Footprints, descriptionKey: 'run2Description' },
};

interface CourseMapDialogProps {
  event: EventCalendarEntry;
  isOpen: boolean;
  onClose: () => void;
  ticketId?: string | null; 
}

export default function CourseMapDialog({ event, isOpen, onClose, ticketId }: CourseMapDialogProps) {
  const { toast } = useToast();

  const ticketsWithMaps = useMemo(() => {
    return (event.ticketDefinitions || []).filter(td => 
      td.courseMaps?.swimGpxUrl || 
      td.courseMaps?.bikeGpxUrl || 
      td.courseMaps?.runGpxUrl ||
      td.courseMaps?.run1GpxUrl ||
      td.courseMaps?.run2GpxUrl
    );
  }, [event.ticketDefinitions]);

  const [selectedTicket, setSelectedTicket] = useState<TicketDefinition | null>(() => {
    if (ticketId) {
      return ticketsWithMaps.find(t => t.id === ticketId) || ticketsWithMaps[0] || null;
    }
    return ticketsWithMaps[0] || null;
  });

  const [elevationData, setElevationData] = useState<GpxPath[]>([]);

  const onGpxDataLoaded = useCallback((gpxPaths: GpxPath[]) => {
    setElevationData(gpxPaths);
  }, []);

  const mapRoutes = useMemo(() => {
    if (!selectedTicket?.courseMaps) return [];
    const gpxKeys = Object.keys(gpxAssetConfig) as (keyof typeof gpxAssetConfig)[];
    return gpxKeys
        .map(assetKey => {
            const url = (selectedTicket.courseMaps as any)?.[assetKey];
            const descKey = (gpxAssetConfig as any)[assetKey]?.descriptionKey;
            const description = (selectedTicket.courseMaps as any)?.[descKey];
            if (url) {
                return { 
                  url, 
                  color: (gpxAssetConfig as any)[assetKey]?.color || '#8884d8',
                  type: (gpxAssetConfig as any)[assetKey]?.type || 'bike',
                  icon: (gpxAssetConfig as any)[assetKey]?.icon || Download,
                  description: description || null
                };
            }
            return null;
        })
        .filter((route): route is { url: string; color: string; type: string, icon: React.ElementType, description: string | null } => route !== null);
  }, [selectedTicket]);

  const handleDownloadGpx = (url: string | null | undefined, leg: string) => {
    if (!url) {
      toast({ variant: 'destructive', title: 'Error', description: 'No GPX file available.' });
      return;
    }
    const downloadUrl = `/api/proxy-gpx?url=${encodeURIComponent(url)}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${event.eventName}_${selectedTicket?.ticketName}_${leg}.gpx`.replace(/ /g, '_'));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-full h-[90vh] flex flex-col p-0 text-left">
        <DialogHeader className="p-6 pb-4 border-b flex-shrink-0 text-left">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-left">
                <MapIcon className="h-6 w-6 text-primary"/> Course Maps: {event.eventName}
            </DialogTitle>
            <DialogDescription className="text-left">
                Select a ticket category to view its course map, elevation profile, and specific leg descriptions.
            </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
            <div className="grid md:grid-cols-2 p-6 gap-8 text-left">
                {/* Left Column */}
                <div className="space-y-6 flex flex-col text-left">
                    <div className="space-y-2 text-left">
                        <h4 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground text-left">Select a Category</h4>
                        <Select
                            value={selectedTicket?.id || ''}
                            onValueChange={(ticketId) => {
                            const newTicket = ticketsWithMaps.find(t => t.id === ticketId);
                            setSelectedTicket(newTicket || null);
                            }}
                        >
                            <SelectTrigger className="w-full h-11 text-base font-bold text-left">
                            <SelectValue placeholder="Select a ticket category..." />
                            </SelectTrigger>
                            <SelectContent className="text-left">
                            {ticketsWithMaps.map(ticket => (
                                <SelectItem key={ticket.id} value={ticket.id}>{ticket.ticketName}</SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {selectedTicket && (
                        <div className="space-y-6 animate-in fade-in duration-500 text-left">
                            {mapRoutes.map((route, i) => (
                                <div key={i} className="p-4 rounded-xl border bg-muted/20 relative overflow-hidden group text-left">
                                    <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: route.color }} />
                                    <div className="flex items-center justify-start gap-3 mb-2 text-left">
                                        <route.icon className="h-5 w-5" style={{ color: route.color }} />
                                        <h5 className="font-bold uppercase tracking-tight text-sm text-left">{route.type} Leg</h5>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line text-left">
                                        {route.description || `Follow the marked ${route.type} route. Ensure you are familiar with the course before race day.`}
                                    </p>
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="mt-3 h-8 text-[10px] font-black uppercase tracking-widest px-0 hover:bg-transparent hover:text-primary text-left"
                                        onClick={() => handleDownloadGpx(route.url, route.type)}
                                    >
                                        <Download className="mr-1.5 h-3 w-3" /> Download GPX
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right Column */}
                <div className="space-y-4 text-left">
                    {selectedTicket ? (
                    <>
                        <div className="rounded-2xl overflow-hidden border shadow-xl bg-background text-left">
                        <MapViewer
                            routes={mapRoutes}
                            trackedAthletes={[]}
                            focusedAthlete={null}
                            onGpxDataLoaded={onGpxDataLoaded}
                            containerStyle={{ height: '400px', width: '100%' }}
                        />
                        </div>
                        <div className="grid grid-cols-1 gap-6 text-left">
                        {elevationData.map((path, index) => {
                            const routeInfo = mapRoutes[index];
                            // ONLY SHOW ELEVATION FOR NON-SWIM LEGS
                            if (routeInfo?.type === 'swim') return null;
                            
                            return (
                            <div key={index} className="p-4 border rounded-xl bg-background shadow-sm text-left">
                                <h4 className="font-bold text-center text-xs mb-3 uppercase tracking-widest text-muted-foreground flex items-center justify-center gap-2 text-left">
                                    {routeInfo?.icon && <routeInfo.icon className="h-3 w-3" style={{ color: routeInfo.color }} />}
                                    {routeInfo?.type} Elevation Profile
                                </h4>
                                <ElevationProfileChart data={path.elevationData} strokeColor={path.color} height={120} />
                            </div>
                            )
                        })}
                        </div>
                    </>
                    ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground border-2 border-dashed rounded-2xl py-20 text-left">
                        <MapIcon className="h-12 w-12 opacity-20 mb-4" />
                        <p className="font-medium text-left">Select a ticket to see the map.</p>
                    </div>
                    )}
                </div>
            </div>
        </ScrollArea>

        <DialogFooter className="p-4 border-t flex-shrink-0 text-left">
            <DialogClose asChild><Button variant="outline" className="rounded-xl font-bold uppercase text-xs text-left">Close Maps</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
