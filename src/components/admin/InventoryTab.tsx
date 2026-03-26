// src/components/admin/InventoryTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { EventCalendarEntry, EventParticipant, EventInventory, InventoryItemType, TicketDefinition, AidStationConfig, CustomItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Shirt, Medal, Trophy, Loader2, Info, Waves, Edit, Package, Filter, Briefcase, Droplets, Zap, Flag, Route, Bike, Footprints, PlusCircle, Trash2, Save, Copy, MapPin, RefreshCw } from 'lucide-react';
import { getParticipantsForEventAction } from '@/lib/actions/participantActions';
import { getInventoryForEventAction, updateInventoryStockAction, saveWaterStationConfigAction, cloneWaterStationConfigAction, resetInventoryAction, updateTicketDefinitionAction } from '@/lib/actions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import * as XLSX from 'xlsx';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const TSHIRT_SIZES = ["34", "36", "38", "40", "42", "44", "46", "Unknown"];
const GENDERS = ["Male", "Female", "Other"] as const;

const INITIAL_BIKE_ITEMS: CustomItem[] = [
    { id: 'b1', name: "Water", unit: "550ml Bottles", type: 'consumable', consumptionType: 'perHour', consumptionRate: 0.91 },
    { id: 'b2', name: "Energy Drink", unit: "550ml Bottles", type: 'consumable', consumptionType: 'perHour', consumptionRate: 0.455 },
    { id: 'b3', name: "Bananas", unit: "Halves", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1 },
    { id: 'b4', name: "Oranges", unit: "kg", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 0.05 },
    { id: 'b5', name: "Tables", unit: "Units", type: 'fixed', quantityPerStation: 2 },
    { id: 'b6', name: "Chairs", unit: "Units", type: 'fixed', quantityPerStation: 2 },
];

const INITIAL_RUN_ITEMS: CustomItem[] = [
    { id: 'r1', name: "Water", unit: "20L Cans", type: 'consumable', consumptionType: 'perHour', consumptionRate: 0.25 },
    { id: 'r2', name: "Energy Drink", unit: "Liters", type: 'consumable', consumptionType: 'perHour', consumptionRate: 0.5 },
    { id: 'r3', name: "Paper Cups", unit: "Units", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 4 },
    { id: 'r4', name: "Gels", unit: "Units", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1.5 },
    { id: 'r5', name: "Coke/Cola", unit: "Liters", type: 'consumable', consumptionType: 'perHour', consumptionRate: 0.25 },
    { id: 'r6', name: "Watermelon", unit: "kg", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 0.1 },
    { id: 'r7', name: "Tables", unit: "Units", type: 'fixed', quantityPerStation: 2 },
];

const INITIAL_VENUE_ITEMS: CustomItem[] = [
    { id: 'v1', name: "Water", unit: "20L Cans", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 0.5 },
    { id: 'v2', name: "Post-Race Snack", unit: "Packets", type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1 },
    { id: 'v3', name: "First Aid Kits", unit: "Kits", type: 'fixed', quantityPerStation: 1 },
];


// Estimates based on category name
const getCategoryDurationMinutes = (categoryName?: string | null): { bikeMinutes: number; runMinutes: number } => {
    if (!categoryName) return { bikeMinutes: 180, runMinutes: 120 }; // Default average
    const upperCat = categoryName.toUpperCase();
    if (upperCat.includes('113')) return { bikeMinutes: 240, runMinutes: 150 }; // Avg 7-8 hour finish
    if (upperCat.includes('OLYMPIC')) return { bikeMinutes: 105, runMinutes: 75 }; // Avg 3.5 hour finish
    if (upperCat.includes('SPRINT')) return { bikeMinutes: 60, runMinutes: 45 }; // Avg 1.75 hour finish
    return { bikeMinutes: 180, runMinutes: 120 }; // Default
};


export default function InventoryTab() {
  const { toast } = useToast();
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [inventory, setInventory] = useState<EventInventory | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isStockUpdateModalOpen, setIsStockUpdateModalOpen] = useState(false);
  const [stockUpdateData, setStockUpdateData] = useState<{ itemType: InventoryItemType | '', key: string, change: number, fieldToUpdate: 'initial' | 'issued', updateMode: 'increment' | 'set', gender?: 'Male' | 'Female' | 'Other' }>({ itemType: '', key: '', change: 1, fieldToUpdate: 'initial', updateMode: 'increment' });
  const [stockUpdateTicketKey, setStockUpdateTicketKey] = useState<string>('');
  
  const [trophyTicketFilter, setTrophyTicketFilter] = useState<string>('all');
  const [finisherJerseyTicketFilter, setFinisherJerseyTicketFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('tshirt');
  const isMobile = useIsMobile();
  
  // State for Water Station Planning
  const [stationConfig, setStationConfig] = useState<AidStationConfig>({
      bikeStations: 3, runStations: 5, venueStations: 1,
  });
  
  const [bikeStationItems, setBikeStationItems] = useState<CustomItem[]>(INITIAL_BIKE_ITEMS);
  const [runStationItems, setRunStationItems] = useState<CustomItem[]>(INITIAL_RUN_ITEMS);
  const [venueStationItems, setVenueStationItems] = useState<CustomItem[]>(INITIAL_VENUE_ITEMS);

  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [addItemConfig, setAddItemConfig] = useState<{ stationType: 'bike' | 'run' | 'venue' | null, newItem: Omit<CustomItem, 'id'> }>({
    stationType: null, newItem: { name: '', unit: 'Units', type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1, quantityPerStation: 1 }
  });
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // State for cloning water station config
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSourceEventId, setCloneSourceEventId] = useState<string | null>(null);
  const [cloneTargetEventId, setCloneTargetEventId] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<string | null>(null);

  // NEW state for swim cap colors
  const [swimCapColors, setSwimCapColors] = useState<Record<string, string>>({});
  const [isSavingColor, setIsSavingColor] = useState<string | null>(null);

  const navItems = [
    { id: 'tshirt', label: 'T-Shirts', icon: Shirt },
    { id: 'finisherJersey', label: 'Jerseys', icon: Shirt },
    { id: 'medal', label: 'Medals', icon: Medal },
    { id: 'swimCap', label: 'Swim Caps', icon: Waves },
    { id: 'trophy', label: 'Trophies', icon: Trophy },
    { id: 'bag', label: 'Bags', icon: Briefcase },
    { id: 'waterStations', label: 'Water Stations', icon: Droplets },
  ];

  const selectedEvent = useMemo(() => (events || []).find(e => e.id === selectedEventId), [events, selectedEventId]);
  const availableTickets = useMemo(() => selectedEvent?.ticketDefinitions?.filter(t => t.id) || [], [selectedEvent]);
  
  const onDataRefresh = useCallback(async () => {
    if (selectedEventId) {
      setIsLoadingData(true);
      const inventoryResult = await getInventoryForEventAction(selectedEventId);
      if (inventoryResult.success) {
        setInventory(inventoryResult.inventory || null);
      }
      const eventsResult = await getCalendarEventsAction();
      if (eventsResult.success && eventsResult.events) {
        setEvents(eventsResult.events);
      }
      setIsLoadingData(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    async function fetchEvents() {
        setIsLoadingEvents(true);
        const result = await getCalendarEventsAction();
        if (result.success && result.events) {
            setEvents(result.events);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch events list.' });
        }
        setIsLoadingEvents(false);
    }
    fetchEvents();
  }, [toast]);

  useEffect(() => {
    if (selectedEventId) {
      setIsLoadingData(true);
      Promise.all([
        getParticipantsForEventAction(selectedEventId),
        getInventoryForEventAction(selectedEventId)
      ]).then(([participantsResult, inventoryResult]) => {
        if (participantsResult.success) setParticipants(participantsResult.participants || []);
        else { setParticipants([]); toast({ variant: 'destructive', title: 'Error', description: participantsResult.message }); }

        if (inventoryResult.success && inventoryResult.inventory) {
            setInventory(inventoryResult.inventory);
            if (inventoryResult.inventory.waterStationConfig) {
                setStationConfig(inventoryResult.inventory.waterStationConfig.config);
                setBikeStationItems(inventoryResult.inventory.waterStationConfig.bikeItems);
                setRunStationItems(inventoryResult.inventory.waterStationConfig.runItems);
                setVenueStationItems(inventoryResult.inventory.waterStationConfig.venueItems || INITIAL_VENUE_ITEMS);
            } else {
                setStationConfig({ bikeStations: 3, runStations: 5, venueStations: 1 });
                setBikeStationItems(INITIAL_BIKE_ITEMS);
                setRunStationItems(INITIAL_RUN_ITEMS);
                setVenueStationItems(INITIAL_VENUE_ITEMS);
            }
        } else { 
            setInventory(null); 
            setStationConfig({ bikeStations: 3, runStations: 5, venueStations: 1 });
            setBikeStationItems(INITIAL_BIKE_ITEMS);
            setRunStationItems(INITIAL_RUN_ITEMS);
            setVenueStationItems(INITIAL_VENUE_ITEMS);
            if(inventoryResult.message !== 'No inventory record found for this event.') {
                toast({ variant: 'destructive', title: 'Error', description: inventoryResult.message }); 
            }
        }
      }).catch(err => {
        toast({ variant: 'destructive', title: 'Error fetching data', description: err.message });
      }).finally(() => {
        setIsLoadingData(false);
      });
    } else {
      setParticipants([]);
      setInventory(null);
    }
  }, [selectedEventId, toast]);

  const waterStationRequirements = useMemo(() => {
    if (participants.length === 0) return { bike: [], run: [], venue: [] };
    const participantsByCategory = new Map<string, number>();
    participants.forEach(p => { const category = p.ticketName || 'Unknown'; participantsByCategory.set(category, (participantsByCategory.get(category) || 0) + 1); });
    
    const calculateRequirements = (items: CustomItem[], leg: 'bike' | 'run' | 'venue') => {
        return items.map(item => {
            if (item.type === 'fixed') {
                const stations = leg === 'bike' ? stationConfig.bikeStations : (leg === 'run' ? stationConfig.runStations : stationConfig.venueStations);
                const total = (item.quantityPerStation || 1) * stations;
                return { ...item, perStation: item.quantityPerStation || 1, total: Math.ceil(total) };
            }
            
            let totalRequired = 0;
            if (item.consumptionType === 'perAthlete') {
                totalRequired = participants.length * (item.consumptionRate || 0);
            } else if (item.consumptionType === 'perHour') { // perHour - not applicable for venue stations
                if (leg !== 'venue') {
                    participantsByCategory.forEach((count, categoryName) => {
                        const durations = getCategoryDurationMinutes(categoryName);
                        const legDurationHours = (leg === 'bike' ? durations.bikeMinutes : durations.runMinutes) / 60;
                        totalRequired += count * (item.consumptionRate || 0) * legDurationHours;
                    });
                }
            }
            
            const stations = leg === 'bike' ? stationConfig.bikeStations : (leg === 'run' ? stationConfig.runStations : stationConfig.venueStations);
            return { ...item, perStation: stations > 0 ? Math.ceil(totalRequired / stations) : Math.ceil(totalRequired), total: Math.ceil(totalRequired) };
        });
    };
    return { 
        bike: calculateRequirements(bikeStationItems, 'bike'), 
        run: calculateRequirements(runStationItems, 'run'),
        venue: calculateRequirements(venueStationItems, 'venue') 
    };
  }, [participants, stationConfig, bikeStationItems, runStationItems, venueStationItems]);


  const handleAddItem = () => {
    const { stationType, newItem } = addItemConfig;
    if (!stationType || !newItem.name || !newItem.unit) {
        toast({ variant: 'destructive', title: 'Invalid Item', description: "Please provide a valid name and unit." });
        return;
    }
    const fullNewItem = { ...newItem, id: `${stationType}-${Date.now()}` };
    if (stationType === 'bike') setBikeStationItems(prev => [...prev, fullNewItem]);
    else if (stationType === 'run') setRunStationItems(prev => [...prev, fullNewItem]);
    else if (stationType === 'venue') setVenueStationItems(prev => [...prev, fullNewItem]);

    setIsAddItemModalOpen(false);
    setAddItemConfig({ stationType: null, newItem: { name: '', unit: 'Units', type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1, quantityPerStation: 1 } });
  };
  
  const handleRemoveItem = (stationType: 'bike' | 'run' | 'venue', itemId: string) => {
      if (stationType === 'bike') setBikeStationItems(prev => prev.filter(item => item.id !== itemId));
      else if (stationType === 'run') setRunStationItems(prev => prev.filter(item => item.id !== itemId));
      else if (stationType === 'venue') setVenueStationItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleItemValueChange = (stationType: 'bike' | 'run' | 'venue', itemId: string, newValue: any, field: 'rate' | 'type' | 'unit' | 'name') => {
    const updater = stationType === 'bike' ? setBikeStationItems : (stationType === 'run' ? setRunStationItems : setVenueStationItems);
    updater(prevItems => prevItems.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item };
        switch (field) {
            case 'rate':
                if (updatedItem.type === 'consumable') {
                    updatedItem.consumptionRate = Number(newValue);
                } else {
                    updatedItem.quantityPerStation = Number(newValue);
                }
                break;
            case 'type':
                if (updatedItem.type === 'consumable') {
                    updatedItem.consumptionType = newValue as 'perHour' | 'perAthlete';
                }
                break;
            case 'unit': updatedItem.unit = String(newValue); break;
            case 'name': updatedItem.name = String(newValue); break;
        }
        return updatedItem;
      }
      return item;
    }));
  };

  const handleSaveWaterStationPlan = async () => {
    if (!selectedEventId) {
        toast({ variant: 'destructive', title: 'Error', description: 'Please select an event first.' });
        return;
    }
    setIsSavingPlan(true);
    const result = await saveWaterStationConfigAction(selectedEventId, stationConfig, bikeStationItems, runStationItems, venueStationItems);
    if (result.success) {
        toast({ title: 'Success', description: 'Water station plan has been saved.' });
    } else {
        toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
    }
    setIsSavingPlan(false);
  };
  
  const handleClone = async () => {
    if (!cloneSourceEventId || !cloneTargetEventId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select source and target events.' });
      return;
    }
    if (cloneSourceEventId === cloneTargetEventId) {
        toast({ variant: 'destructive', title: 'Error', description: 'Source and target cannot be the same event.' });
        return;
    }
    setIsCloning(true);
    const result = await cloneWaterStationConfigAction(cloneSourceEventId, cloneTargetEventId);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      setIsCloneModalOpen(false);
      // If the currently viewed event was the target, refresh its data
      if (selectedEventId === cloneTargetEventId) {
        const invResult = await getInventoryForEventAction(cloneTargetEventId);
         if (invResult.success && invResult.inventory) {
            setInventory(invResult.inventory);
            if (invResult.inventory.waterStationConfig) {
                setStationConfig(invResult.inventory.waterStationConfig.config);
                setBikeStationItems(invResult.inventory.waterStationConfig.bikeItems);
                setRunStationItems(invResult.inventory.waterStationConfig.runItems);
                setVenueStationItems(invResult.inventory.waterStationConfig.venueItems || INITIAL_VENUE_ITEMS);
            }
        }
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsCloning(false);
  };


  const handleManualStockUpdate = async () => {
    if (!selectedEventId || !stockUpdateData.itemType || !stockUpdateData.key) {
      toast({ variant: "destructive", title: "Invalid Data", description: "Please ensure all fields are set correctly." }); return;
    }
    
    let finalKey = stockUpdateData.key;
    if (stockUpdateData.itemType === 'Finisher Jersey') {
        if(!stockUpdateTicketKey) {
            toast({ variant: 'destructive', title: 'Ticket Required', description: 'Please select a ticket category for the Finisher Jersey.' }); return;
        }
        finalKey = `${stockUpdateTicketKey}_${stockUpdateData.key}`;
    }

    if ((stockUpdateData.itemType === 'T-Shirt' || stockUpdateData.itemType === 'Finisher Jersey') && !stockUpdateData.gender) {
        toast({ variant: 'destructive', title: 'Gender Required', description: 'Please select a gender for apparel stock updates.' }); return;
    }
    const result = await updateInventoryStockAction(selectedEventId, stockUpdateData.itemType, finalKey, stockUpdateData.change, stockUpdateData.fieldToUpdate, stockUpdateData.updateMode, stockUpdateData.gender);
    if(result.success) {
        toast({ title: "Stock Updated", description: result.message });
        const invRes = await getInventoryForEventAction(selectedEventId); if(invRes.success) setInventory(invRes.inventory || null);
        setIsStockUpdateModalOpen(false);
    } else { toast({ variant: 'destructive', title: "Update Failed", description: result.message }); }
  };
  
  const handleResetInventory = async (itemType: 'medals') => {
    if (!selectedEventId) return;
    setIsResetting(itemType);
    const result = await resetInventoryAction(selectedEventId, itemType);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      const invRes = await getInventoryForEventAction(selectedEventId);
      if (invRes.success) setInventory(invRes.inventory || null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsResetting(null);
  };


  const handleDownloadReport = async (reportType: string) => {
    if (!selectedEventId) return;
    setIsDownloading(reportType);
    try {
        if (reportType === 'waterStations') {
            const checklistData = [
                { Item: 'EVENT', Unit: selectedEvent?.eventName },
                { Item: 'Total Participants', Unit: participants.length },
                {},
                { Item: 'BIKE STATIONS', Unit: `(${stationConfig.bikeStations} stations)` },
                ...waterStationRequirements.bike.map(item => ({ Item: item.name, Unit: item.unit, 'Total Required': item.total })),
                {},
                { Item: 'RUN STATIONS', Unit: `(${stationConfig.runStations} stations)` },
                ...waterStationRequirements.run.map(item => ({ Item: item.name, Unit: item.unit, 'Total Required': item.total })),
                {},
                { Item: 'VENUE STATIONS', Unit: `(${stationConfig.venueStations} stations)` },
                ...waterStationRequirements.venue.map(item => ({ Item: item.name, Unit: item.unit, 'Total Required': item.total })),
            ];
            
            const ws = XLSX.utils.json_to_sheet(checklistData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Water Station Checklist");
            const filename = `WaterStationChecklist_${selectedEvent?.eventName?.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
            XLSX.writeFile(wb, filename);

        } else {
            window.location.href = `/api/admin/download-inventory-report?eventId=${selectedEventId}&type=${reportType}`;
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Download Error', description: e.message });
    } finally {
        setTimeout(() => setIsDownloading(null), 1000);
    }
  };


  const { tShirtSummaryData, medalData, trophyData, swimCapData, finisherJerseyData, bagData } = useMemo(() => {
    const data: any = {
      tShirtSummaryData: {}, medalData: {}, trophyData: {}, swimCapData: {}, finisherJerseyData: {},
      bagData: { required: 0, initial: 0, issued: 0 }
    };

    if (!selectedEvent || !participants) return data;
    const ticketDefMap = new Map(availableTickets.map(t => [t.id, t]));

    // 1. Initialize data structures
    TSHIRT_SIZES.forEach(size => { data.tShirtSummaryData[size] = { Male: { required: 0, initial: 0, issued: 0 }, Female: { required: 0, initial: 0, issued: 0 }, Other: { required: 0, initial: 0, issued: 0 }, Total: 0 }; });
    ticketDefMap.forEach(ticket => {
        if (!ticket.id || !ticket.ticketName) return;
        data.medalData[ticket.id] = { name: ticket.ticketName, required: 0, initial: 0, issued: 0 };
        data.trophyData[ticket.id] = { name: ticket.ticketName, ageGroups: {} };
        data.finisherJerseyData[ticket.id] = { name: ticket.ticketName, sizes: {} };
        TSHIRT_SIZES.forEach(size => { data.finisherJerseyData[ticket.id].sizes[size] = { Male: { required: 0, initial: 0, issued: 0 }, Female: { required: 0, initial: 0, issued: 0 }, Other: { required: 0, initial: 0, issued: 0 } }; });
        const ticketNameUpper = ticket.ticketName.toUpperCase();
        let color = ticket.swimCapColor || (ticketNameUpper.includes('113') ? 'Orange' : ticketNameUpper.includes('OLYMPIC') ? 'Blue' : 'Gray');
        data.swimCapData[ticket.id] = { name: ticket.ticketName, color, required: 0, initial: 0, issued: 0 };
    });
    data.bagData.required = participants.length;

    // 2. Process ALL participants to calculate "Required" counts.
    participants.forEach(p => {
        const pGender = p.gender?.trim().toLowerCase();
        let normalizedGender: 'Male' | 'Female' | 'Other' = 'Other';
        if (pGender === 'male') normalizedGender = 'Male'; else if (pGender === 'female') normalizedGender = 'Female';
        const tshirtSize = p.tshirtSize || 'Unknown';
        if (data.tShirtSummaryData[tshirtSize]) { data.tShirtSummaryData[tshirtSize][normalizedGender].required++; data.tShirtSummaryData[tshirtSize].Total++; }
        const ticketId = p.ticketId;
        if (!ticketId || !ticketDefMap.has(ticketId)) return;
        data.medalData[ticketId].required++;
        data.swimCapData[ticketId].required++;
        if (data.finisherJerseyData[ticketId]?.sizes?.[tshirtSize]) { data.finisherJerseyData[ticketId].sizes[tshirtSize][normalizedGender].required++; }
        const ageGroup = p.ageCategory || 'N/A';
        if (!data.trophyData[ticketId].ageGroups[ageGroup]) data.trophyData[ticketId].ageGroups[ageGroup] = {};
        if (!data.trophyData[ticketId].ageGroups[ageGroup][normalizedGender]) data.trophyData[ticketId].ageGroups[ageGroup][normalizedGender] = { required: 0, initial: 0, issued: 0 };
        data.trophyData[ticketId].ageGroups[ageGroup][normalizedGender].required++;
    });

    // 3. Merge inventory stock data
    if (inventory) {
        if (inventory.tshirts) Object.entries(inventory.tshirts).forEach(([key, rawVal]) => { 
          const val = rawVal as { initial: number; issued: number };
          const [size, gender] = key.split('_') as [string, 'Male'|'Female'|'Other']; 
          if (data.tShirtSummaryData[size] && data.tShirtSummaryData[size][gender]) { 
            data.tShirtSummaryData[size][gender].initial = val.initial || 0; 
            data.tShirtSummaryData[size][gender].issued = val.issued || 0; 
          } 
        });
        if (inventory.medals) Object.entries(inventory.medals).forEach(([key, rawVal]) => { 
          const val = rawVal as { initial: number; issued: number };
          ticketDefMap.forEach(ticket => { if (ticket.ticketName === key && data.medalData[ticket.id]) { data.medalData[ticket.id].initial = val.initial || 0; data.medalData[ticket.id].issued = val.issued || 0; } }); 
        });
        if (inventory.swimCaps) Object.entries(inventory.swimCaps).forEach(([key, rawVal]) => { 
          const val = rawVal as { initial: number; issued: number };
          ticketDefMap.forEach(ticket => { if (ticket.ticketName === key && data.swimCapData[ticket.id]) { data.swimCapData[ticket.id].initial = val.initial || 0; data.swimCapData[ticket.id].issued = val.issued || 0; } }); 
        });
        if (inventory.trophies) Object.entries(inventory.trophies).forEach(([key, rawVal]) => { 
          const val = rawVal as { initial: number; issued: number };
          const [cat, age, gender] = key.split('_'); 
          ticketDefMap.forEach(ticket => { if (ticket.ticketName === cat && data.trophyData[ticket.id]?.ageGroups[age]?.[gender]) { data.trophyData[ticket.id].ageGroups[age][gender].initial = val.initial || 0; data.trophyData[ticket.id].ageGroups[age][gender].issued = val.issued || 0; } }); 
        });
        if (inventory.finisherJerseys) Object.entries(inventory.finisherJerseys).forEach(([key, rawVal]) => { 
          const val = rawVal as { initial: number; issued: number };
          const [ticketName, size, gender] = key.split('_') as [string, string, 'Male'|'Female'|'Other']; 
          const ticket = Array.from(ticketDefMap.values()).find(t => t.ticketName === ticketName); 
          if (ticket && data.finisherJerseyData[ticket.id]?.sizes[size]?.[gender]) { 
            data.finisherJerseyData[ticket.id].sizes[size][gender].initial = val.initial || 0; 
            data.finisherJerseyData[ticket.id].sizes[size][gender].issued = val.issued || 0; 
          } 
        });
        if (inventory.bags) { data.bagData.initial = inventory.bags.initial || 0; data.bagData.issued = inventory.bags.issued || 0; }
    }
    return data;
  }, [participants, inventory, selectedEvent, availableTickets]);
  
  useEffect(() => {
    if (swimCapData) {
      const initialColors = Object.entries(swimCapData).reduce((acc, [ticketId, data]: [string, any]) => {
        acc[ticketId] = data.color;
        return acc;
      }, {} as Record<string, string>);
      setSwimCapColors(initialColors);
    }
  }, [swimCapData]);

  const handleSaveSwimCapColor = async (ticketId: string) => {
    if (!selectedEventId) return;
    const newColor = swimCapColors[ticketId];
    if (!newColor) {
        toast({ variant: 'destructive', title: 'Error', description: 'Color cannot be empty.' });
        return;
    }
    setIsSavingColor(ticketId);
    const result = await updateTicketDefinitionAction(selectedEventId, ticketId, { swimCapColor: newColor });
    if (result.success) {
      toast({ title: 'Success', description: 'Swim cap color updated.' });
      onDataRefresh();
    } else {
      toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
    }
    setIsSavingColor(null);
  };


  const chartData = useMemo(() => {
    return TSHIRT_SIZES.map(size => {
        const sizeData = tShirtSummaryData[size];
        const initialTotal = (sizeData?.Male.initial || 0) + (sizeData?.Female.initial || 0) + (sizeData?.Other.initial || 0);
        const issuedTotal = (sizeData?.Male.issued || 0) + (sizeData?.Female.issued || 0) + (sizeData?.Other.issued || 0);
        return {
            name: size,
            Required: sizeData?.Total || 0,
            Issued: issuedTotal,
            Remaining: initialTotal - issuedTotal,
        };
    });
  }, [tShirtSummaryData]);
  
  const filteredTrophyData = useMemo(() => { if (trophyTicketFilter === 'all' || !trophyData[trophyTicketFilter]) return trophyData; return { [trophyTicketFilter]: trophyData[trophyTicketFilter] }; }, [trophyData, trophyTicketFilter]);
  const filteredFinisherJerseyData = useMemo(() => { if (finisherJerseyTicketFilter === 'all' || !finisherJerseyData[finisherJerseyTicketFilter]) return finisherJerseyData; return { [finisherJerseyTicketFilter]: finisherJerseyData[finisherJerseyTicketFilter] }; }, [finisherJerseyData, finisherJerseyTicketFilter]);
  
  const renderNav = () => {
    if (isMobile) {
      return (
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select Inventory Type..." />
          </SelectTrigger>
          <SelectContent>
            {navItems.map(item => (
              <SelectItem key={item.id} value={item.id}>
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
        <TabsList className="grid w-full grid-cols-7">
          {navItems.map(item => (
            <TabsTrigger key={item.id} value={item.id} className="h-9 text-xs sm:text-sm">
              <item.icon className={`mr-2 h-4 w-4 ${item.id === 'waterStations' ? 'text-blue-600' : ''}`} />
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
    );
  };


  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><Package className="text-primary"/>Inventory Management</CardTitle>
          <CardDescription>Track required and available stock for event items.</CardDescription>
        </div>
        <Dialog open={isStockUpdateModalOpen} onOpenChange={setIsStockUpdateModalOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={!selectedEventId}><Edit className="mr-2 h-4 w-4"/>Manual Stock Update</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Manual Stock Update</DialogTitle><DialogDescription>Add or remove stock manually.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1"><Label>Item Type</Label><Select onValueChange={(v) => setStockUpdateData(d => ({...d, itemType:v as any, key:'', gender:undefined, change:1, fieldToUpdate:'initial'}))} value={stockUpdateData.itemType||undefined}><SelectTrigger><SelectValue placeholder="Select item..."/></SelectTrigger><SelectContent><SelectItem value="T-Shirt">T-Shirt</SelectItem><SelectItem value="Finisher Jersey">Finisher Jersey</SelectItem><SelectItem value="Swim Cap">Swim Cap</SelectItem><SelectItem value="Medal">Medal</SelectItem><SelectItem value="Trophy">Trophy</SelectItem><SelectItem value="Bag">Bag</SelectItem></SelectContent></Select></div>
              {stockUpdateData.itemType&&(<div className="space-y-1"><Label>Specific Item</Label>
                {stockUpdateData.itemType === 'T-Shirt' ?
                    (<Select onValueChange={(v) => setStockUpdateData(d => ({...d, key:v}))} value={stockUpdateData.key||undefined}><SelectTrigger><SelectValue placeholder="Select a size..."/></SelectTrigger><SelectContent>{TSHIRT_SIZES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>)
                : stockUpdateData.itemType === 'Finisher Jersey' ? (
                    <div className="grid grid-cols-2 gap-2">
                        <Select onValueChange={(v)=>setStockUpdateTicketKey(v)} value={stockUpdateTicketKey||undefined}>
                            <SelectTrigger><SelectValue placeholder="Select Ticket..."/></SelectTrigger>
                            <SelectContent>{availableTickets.map(t=><SelectItem key={t.id} value={t.ticketName}>{t.ticketName}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select onValueChange={(v) => setStockUpdateData(d => ({...d, key:v}))} value={stockUpdateData.key||undefined}>
                            <SelectTrigger><SelectValue placeholder="Select Size..."/></SelectTrigger>
                            <SelectContent>{TSHIRT_SIZES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                )
                : stockUpdateData.itemType === 'Swim Cap' || stockUpdateData.itemType === 'Medal' ? (
                    <Select onValueChange={(v)=>setStockUpdateData(d=>({...d, key:v}))} value={stockUpdateData.key||undefined}>
                        <SelectTrigger><SelectValue placeholder="Select ticket category..."/></SelectTrigger>
                        <SelectContent>{availableTickets.map(t=><SelectItem key={t.id} value={t.ticketName}>{t.ticketName}</SelectItem>)}</SelectContent>
                    </Select>
                )
                : stockUpdateData.itemType === 'Bag' ? (
                    <Input value={stockUpdateData.key} onChange={e=>setStockUpdateData(d=>({...d, key:e.target.value}))} placeholder="e.g., 'EventBag' (or any name)" />
                )
                : (<Input value={stockUpdateData.key} onChange={e=>setStockUpdateData(d=>({...d, key:e.target.value}))} placeholder="e.g., 'Olympic_Triathlon_16-30_Male'"/>)}
              </div>)}
              {(stockUpdateData.itemType==='T-Shirt'||stockUpdateData.itemType==='Finisher Jersey')&&(<div className="space-y-1"><Label>Gender</Label><Select onValueChange={(v)=>setStockUpdateData(d=>({...d, gender:v as any}))} value={stockUpdateData.gender||undefined}><SelectTrigger><SelectValue placeholder="Select gender..."/></SelectTrigger><SelectContent>{GENDERS.map(g=><SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></div>)}
              <div className="space-y-1"><Label>Field to Update</Label><RadioGroup value={stockUpdateData.fieldToUpdate} onValueChange={(v)=>setStockUpdateData(d=>({...d, fieldToUpdate:v as any}))} className="flex gap-4"><div className="flex items-center space-x-2"><RadioGroupItem value="initial" id="initial"/><Label htmlFor="initial">Initial Stock</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="issued" id="issued"/><Label htmlFor="issued">Issued Count</Label></div></RadioGroup></div>
              <div className="space-y-1"><Label>Update Mode</Label><RadioGroup value={stockUpdateData.updateMode} onValueChange={(v=>setStockUpdateData(d=>({...d, updateMode:v as any})))} className="flex gap-4"><div className="flex items-center space-x-2"><RadioGroupItem value="increment" id="increment"/><Label htmlFor="increment">Add/Remove</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="set" id="set"/><Label htmlFor="set">Set Total</Label></div></RadioGroup></div>
              <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={stockUpdateData.change} onChange={e=>setStockUpdateData(d=>({...d, change:parseInt(e.target.value)||0}))}/><p className="text-xs text-muted-foreground">{stockUpdateData.updateMode==='increment'?'Use a negative number to decrease.':'This will overwrite current value.'}</p></div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={()=>setIsStockUpdateModalOpen(false)}>Cancel</Button><Button onClick={handleManualStockUpdate}>Update Stock</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}><SelectTrigger className="w-full"><SelectValue placeholder="1. Select an Event..." /></SelectTrigger><SelectContent>{isLoadingEvents ? <SelectItem value="loading" disabled>Loading events...</SelectItem> : events.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent></Select>
        </div>
        {!selectedEventId ? <p className="text-center text-muted-foreground pt-4">Please select an event to view its inventory.</p> : isLoadingData ? <div className="flex justify-center py-6"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div> : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            {renderNav()}
            <TabsContent value="tshirt" className="mt-4"><Card><CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"><div><CardTitle className="flex items-center gap-2"><Shirt className="text-primary"/>T-Shirt Inventory</CardTitle></div><Button size="sm" onClick={()=>handleDownloadReport('tshirt')} disabled={isDownloading==='tshirt'}>{isDownloading==='tshirt'?<Loader2 className="animate-spin h-4 w-4 mr-2"/>:<Download className="h-4 w-4 mr-2"/>}Download</Button></CardHeader><CardContent><div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Table><TableHeader><TableRow><TableHead>Size</TableHead><TableHead>Male Req.</TableHead><TableHead>Female Req.</TableHead><TableHead>Other Req.</TableHead><TableHead>Total Req.</TableHead><TableHead>Issued</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader><TableBody>
                {TSHIRT_SIZES.map(size => {
                  const sizeData = tShirtSummaryData[size];
                  const issuedTotal = (sizeData?.Male.issued || 0) + (sizeData?.Female.issued || 0) + (sizeData?.Other.issued || 0);
                  const initialTotal = (sizeData?.Male.initial || 0) + (sizeData?.Female.initial || 0) + (sizeData?.Other.initial || 0);
                  const remaining = initialTotal - issuedTotal;
                  return (
                    <TableRow key={size}>
                      <TableCell>{size}</TableCell>
                      <TableCell>{sizeData?.Male.required || 0}</TableCell>
                      <TableCell>{sizeData?.Female.required || 0}</TableCell>
                      <TableCell>{sizeData?.Other.required || 0}</TableCell>
                      <TableCell>{sizeData?.Total || 0}</TableCell>
                      <TableCell>{issuedTotal}</TableCell>
                      <TableCell className={remaining < 0 ? 'font-bold text-destructive' : 'font-bold'}>{remaining}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              </Table><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{top:5,right:20,left:-10,bottom:5}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" fontSize={12}/><YAxis fontSize={12} allowDecimals={false}/><Tooltip contentStyle={{fontSize:'12px',padding:'5px'}}/><Legend wrapperStyle={{fontSize:'12px'}}/><Bar dataKey="Required" fill="#8884d8"/><Bar dataKey="Issued" fill="#82ca9d"/><Bar dataKey="Remaining" fill="#ffc658"/></BarChart></ResponsiveContainer></div></div></CardContent></Card></TabsContent>
            <TabsContent value="finisherJersey" className="mt-4"><Card><CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"><div><CardTitle className="flex items-center gap-2"><Shirt className="text-primary"/>Finisher Jersey</CardTitle><CardDescription className="text-xs mt-1">Required vs. stock.</CardDescription></div><div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto"><Select value={finisherJerseyTicketFilter} onValueChange={setFinisherJerseyTicketFilter}><SelectTrigger className="w-full sm:w-[200px] text-xs h-9"><SelectValue placeholder="Filter by Ticket..."/></SelectTrigger><SelectContent><SelectItem value="all">All Tickets</SelectItem>{availableTickets.map(t=><SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>)}</SelectContent></Select><Button size="sm" onClick={()=>handleDownloadReport('finisherjersey')} disabled={isDownloading==='finisherjersey'}>{isDownloading==='finisherjersey'?<Loader2 className="animate-spin h-4 w-4 mr-2"/>:<Download className="h-4 w-4 mr-2"/>}Download</Button></div></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Category/Size/Gender</TableHead><TableHead>Required</TableHead><TableHead>Initial</TableHead><TableHead>Issued</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader><TableBody>{Object.entries(filteredFinisherJerseyData).sort((a: [string, any], b: [string, any])=>a[1].name.localeCompare(b[1].name)).map(([catId,catData]: [string, any])=>(<React.Fragment key={catId}><TableRow className="bg-muted/50"><TableCell colSpan={5} className="font-semibold text-primary">{catData.name}</TableCell></TableRow>{Object.entries(catData.sizes).sort((a:any,b:any)=>TSHIRT_SIZES.indexOf(a[0]) - TSHIRT_SIZES.indexOf(b[0])).map(([size,genders]: [string, any])=>(<React.Fragment key={`${catId}-${size}`}><TableRow className="font-medium"><TableCell className="pl-8">{size}</TableCell><TableCell>{genders.Male.required + genders.Female.required + genders.Other.required}</TableCell><TableCell colSpan={3}></TableCell></TableRow>
              <TableRow><TableCell className="pl-12 text-muted-foreground">Male</TableCell><TableCell>{genders.Male.required}</TableCell><TableCell>{genders.Male.initial}</TableCell><TableCell>{genders.Male.issued}</TableCell><TableCell className={(genders.Male.initial-genders.Male.issued)<0?'text-destructive font-semibold':'font-semibold'}>{genders.Male.initial-genders.Male.issued}</TableCell></TableRow>
              <TableRow><TableCell className="pl-12 text-muted-foreground">Female</TableCell><TableCell>{genders.Female.required}</TableCell><TableCell>{genders.Female.initial}</TableCell><TableCell>{genders.Female.issued}</TableCell><TableCell className={(genders.Female.initial-genders.Female.issued)<0?'text-destructive font-semibold':'font-semibold'}>{genders.Female.initial-genders.Female.issued}</TableCell></TableRow>
              <TableRow><TableCell className="pl-12 text-muted-foreground">Other</TableCell><TableCell>{genders.Other.required}</TableCell><TableCell>{genders.Other.initial}</TableCell><TableCell>{genders.Other.issued}</TableCell><TableCell className={(genders.Other.initial-genders.Other.issued)<0?'text-destructive font-semibold':'font-semibold'}>{genders.Other.initial-genders.Other.issued}</TableCell></TableRow>
              </React.Fragment>))}</React.Fragment>))}</TableBody></Table></CardContent></Card></TabsContent>
            <TabsContent value="medal" className="mt-4"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2 text-base"><Medal className="text-primary"/>Medal Inventory</CardTitle><div className="flex gap-2">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={isResetting === 'medals'}>
                            {isResetting === 'medals' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            <span className="ml-2">Reset Stock</span>
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Reset Medal Inventory?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently delete all initial and issued stock counts for all medal categories for this event. Participant requirement data will remain. Are you sure?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handleResetInventory('medals')}>Confirm Reset</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <Button size="sm" onClick={()=>handleDownloadReport('medal')} disabled={isDownloading==='medal'}>{isDownloading==='medal'?<Loader2 className="animate-spin h-4 w-4 mr-2"/>:<Download className="h-4 w-4 mr-2"/>}Download</Button>
            </div></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Required</TableHead><TableHead>Initial</TableHead><TableHead>Issued</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader><TableBody>{Object.entries(medalData).map(([catId,data]: [string, any])=>{const rem=(data.initial||0)-(data.issued||0); return(<TableRow key={catId}><TableCell>{data.name}</TableCell><TableCell>{data.required}</TableCell><TableCell>{data.initial}</TableCell><TableCell>{data.issued}</TableCell><TableCell className={`font-bold ${rem<0?'text-destructive':''}`}>{rem}</TableCell></TableRow>)})}</TableBody></Table></CardContent></Card></TabsContent>
            <TabsContent value="swimCap" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><Waves className="text-primary"/>Swim Cap Inventory</CardTitle><Button size="sm" onClick={()=>handleDownloadReport('swimcap')} disabled={isDownloading==='swimcap'}>{isDownloading==='swimcap'?<Loader2 className="animate-spin h-4 w-4 mr-2"/>:<Download className="h-4 w-4 mr-2"/>}Download</Button></CardHeader>
                <CardContent><Table>
                  <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Color</TableHead><TableHead>Required</TableHead><TableHead>Initial</TableHead><TableHead>Issued</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader>
                  <TableBody>{Object.entries(swimCapData).map(([catId,data]: [string, any])=>{ const rem=(data.initial||0)-(data.issued||0); return(<TableRow key={catId}><TableCell>{data.name}</TableCell><TableCell>
                    <div className="flex items-center gap-2">
                        <Input value={swimCapColors[catId] || ''} onChange={(e) => setSwimCapColors(prev => ({ ...prev, [catId]: e.target.value }))} className="h-8 w-24" />
                        <div className="h-6 w-6 rounded-full border" style={{ backgroundColor: swimCapColors[catId]?.toLowerCase() || 'transparent' }}></div>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleSaveSwimCapColor(catId)} disabled={isSavingColor === catId}>
                            {isSavingColor === catId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </Button>
                    </div>
                  </TableCell><TableCell>{data.required}</TableCell><TableCell>{data.initial}</TableCell><TableCell>{data.issued}</TableCell><TableCell className={`font-bold ${rem<0?'text-destructive':''}`}>{rem}</TableCell></TableRow>)})}</TableBody>
                </Table></CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="trophy" className="mt-4"><Card><CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"><div><CardTitle className="flex items-center gap-2 text-base"><Trophy className="text-primary"/>Trophy Inventory</CardTitle><CardDescription className="text-xs mt-1">Based on top 3 per category.</CardDescription></div><div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto"><Select value={trophyTicketFilter} onValueChange={setTrophyTicketFilter}><SelectTrigger className="w-full sm:w-[200px] text-xs h-9"><SelectValue placeholder="Filter by Ticket..."/></SelectTrigger><SelectContent><SelectItem value="all">All Tickets</SelectItem>{availableTickets.map(t=><SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" onClick={()=>handleDownloadReport('trophy')} disabled={isDownloading==='trophy'}><Download className="h-4 w-4 mr-2"/>Download</Button></div></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Age Group</TableHead><TableHead>Gender</TableHead><TableHead>#Participants</TableHead><TableHead>Needed</TableHead><TableHead>Initial</TableHead><TableHead>Issued</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader><TableBody>{Object.keys(filteredTrophyData).sort().map(ticketId=>(<React.Fragment key={ticketId}><TableRow className="bg-muted/50"><TableCell colSpan={8} className="font-semibold text-primary">{filteredTrophyData[ticketId].name}</TableCell></TableRow>{Object.keys(filteredTrophyData[ticketId].ageGroups).sort().map(ag=>(Object.keys(filteredTrophyData[ticketId].ageGroups[ag]).sort().map(g=>{const d=filteredTrophyData[ticketId].ageGroups[ag][g];const n=Math.min(3,d.required);const rem=(d.initial||0)-(d.issued||0);return(<TableRow key={`${ticketId}-${ag}-${g}`}><TableCell></TableCell><TableCell>{ag}</TableCell><TableCell>{g}</TableCell><TableCell>{d.required}</TableCell><TableCell>{n}</TableCell><TableCell>{d.initial||0}</TableCell><TableCell>{d.issued||0}</TableCell><TableCell className={`font-bold ${rem<0?'text-destructive':''}`}>{rem}</TableCell></TableRow>)})))}</React.Fragment>))}</TableBody></Table></CardContent></Card></TabsContent>
            <TabsContent value="bag" className="mt-4"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><Briefcase className="text-primary"/>Bag Inventory</CardTitle><Button size="sm" onClick={()=>handleDownloadReport('bag')} disabled={isDownloading==='bag'}>{isDownloading==='bag'?<Loader2 className="animate-spin h-4 w-4 mr-2"/>:<Download className="h-4 w-4 mr-2"/>}Download</Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Required (Total Participants)</TableHead><TableHead>Initial Stock</TableHead><TableHead>Issued</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell className="font-medium">Event Bags</TableCell><TableCell>{bagData.required}</TableCell><TableCell>{bagData.initial}</TableCell><TableCell>{bagData.issued}</TableCell><TableCell className={`font-bold ${(bagData.initial - bagData.issued) < 0 ? 'text-destructive' : ''}`}>{bagData.initial - bagData.issued}</TableCell></TableRow></TableBody></Table></CardContent></Card></TabsContent>
            
            <TabsContent value="waterStations" className="mt-4">
              <Card>
                  <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2"><Droplets className="text-blue-500"/>Water Station Planning</CardTitle>
                      <CardDescription>Estimate hydration and nutrition needs for each aid station based on event parameters.</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                      <div className="p-4 border rounded-lg bg-muted/20"><h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Zap className="text-accent"/>Customizable Parameters ({participants.length} Participants)</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div><Label className="text-xs">Bike Stations</Label><Input type="number" value={stationConfig.bikeStations} onChange={e => setStationConfig(c => ({...c, bikeStations: Number(e.target.value)}))} /></div>
                          <div><Label className="text-xs">Run Stations</Label><Input type="number" value={stationConfig.runStations} onChange={e => setStationConfig(c => ({...c, runStations: Number(e.target.value)}))} /></div>
                          <div><Label className="text-xs">Venue Stations</Label><Input type="number" value={stationConfig.venueStations} onChange={e => setStationConfig(c => ({...c, venueStations: Number(e.target.value)}))} /></div>
                      </div></div><Separator />
                      <div><div className="flex justify-between items-center mb-3"><h3 className="text-lg font-semibold flex items-center gap-2"><Bike className="text-green-600"/>Cycling Aid Station Requirements</h3><Button size="xs" variant="outline" onClick={() => { setAddItemConfig({ stationType: 'bike', newItem: { name: '', unit: 'Units', type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1, quantityPerStation: 1 }}); setIsAddItemModalOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add Item</Button></div>
                        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Unit</TableHead><TableHead>Rate</TableHead><TableHead>Est. per Station</TableHead><TableHead>Total Est.</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>
                          {waterStationRequirements.bike.map(item => (<TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.unit}</TableCell>
                            <TableCell><div className="flex items-center gap-1"><Input type="number" step="0.1" value={item.type === 'consumable' ? item.consumptionRate : item.quantityPerStation} onChange={(e) => handleItemValueChange('bike', item.id, parseFloat(e.target.value), 'rate')} className="h-7 w-20 text-xs"/>{item.type === 'consumable' && (<Select value={item.consumptionType} onValueChange={(value) => handleItemValueChange('bike', item.id, value as any, 'type')}><SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="perHour">per Hour</SelectItem><SelectItem value="perAthlete">per Athlete</SelectItem></SelectContent></Select>)}</div></TableCell>
                            <TableCell>{item.perStation}</TableCell><TableCell>{item.total}</TableCell><TableCell><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveItem('bike', item.id)}><Trash2 className="h-3.5 w-3.5 text-destructive"/></Button></TableCell></TableRow>))}
                        </TableBody></Table></div>
                      </div>
                      <div><div className="flex justify-between items-center mb-3"><h3 className="text-lg font-semibold flex items-center gap-2"><Footprints className="text-orange-600"/>Running Aid Station Requirements</h3><Button size="xs" variant="outline" onClick={() => { setAddItemConfig({ stationType: 'run', newItem: { name: '', unit: 'Units', type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1, quantityPerStation: 1 }}); setIsAddItemModalOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add Item</Button></div>
                        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Unit</TableHead><TableHead>Rate</TableHead><TableHead>Est. / Station</TableHead><TableHead>Total Est.</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>
                          {waterStationRequirements.run.map(item => (<TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.unit}</TableCell>
                            <TableCell><div className="flex items-center gap-1"><Input type="number" step="0.1" value={item.type === 'consumable' ? item.consumptionRate : item.quantityPerStation} onChange={(e) => handleItemValueChange('run', item.id, parseFloat(e.target.value), 'rate')} className="h-7 w-20 text-xs"/>{item.type === 'consumable' && (<Select value={item.consumptionType} onValueChange={(value) => handleItemValueChange('run', item.id, value as any, 'type')}><SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="perHour">per Hour</SelectItem><SelectItem value="perAthlete">per Athlete</SelectItem></SelectContent></Select>)}</div></TableCell>
                            <TableCell>{item.perStation}</TableCell><TableCell>{item.total}</TableCell><TableCell><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveItem('run', item.id)}><Trash2 className="h-3.5 w-3.5 text-destructive"/></Button></TableCell></TableRow>))}
                        </TableBody></Table></div>
                      </div>
                       <div><div className="flex justify-between items-center mb-3"><h3 className="text-lg font-semibold flex items-center gap-2"><MapPin className="text-purple-600"/>Venue Station Requirements</h3><Button size="xs" variant="outline" onClick={() => { setAddItemConfig({ stationType: 'venue', newItem: { name: '', unit: 'Units', type: 'consumable', consumptionType: 'perAthlete', consumptionRate: 1, quantityPerStation: 1 }}); setIsAddItemModalOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add Item</Button></div>
                        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Unit</TableHead><TableHead>Rate</TableHead><TableHead>Est. per Station</TableHead><TableHead>Total Est.</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>
                          {waterStationRequirements.venue.map(item => (<TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.unit}</TableCell>
                            <TableCell><div className="flex items-center gap-1"><Input type="number" step="0.1" value={item.type === 'consumable' ? item.consumptionRate : item.quantityPerStation} onChange={(e) => handleItemValueChange('venue', item.id, parseFloat(e.target.value), 'rate')} className="h-7 w-20 text-xs"/>{item.type === 'consumable' && (<Select value={item.consumptionType} onValueChange={(value) => handleItemValueChange('venue', item.id, value as any, 'type')}><SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="perAthlete">per Athlete</SelectItem></SelectContent></Select>)}</div></TableCell>
                            <TableCell>{item.perStation}</TableCell><TableCell>{item.total}</TableCell><TableCell><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveItem('venue', item.id)}><Trash2 className="h-3.5 w-3.5 text-destructive"/></Button></TableCell></TableRow>))}
                        </TableBody></Table></div>
                      </div>
                      <CardFooter className="mt-4 pt-4 border-t flex-col sm:flex-row justify-end items-center gap-2">
                         <Dialog open={isCloneModalOpen} onOpenChange={setIsCloneModalOpen}><DialogTrigger asChild><Button variant="outline"><Copy className="mr-2 h-4 w-4"/>Clone Plan</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Clone Water Station Plan</DialogTitle><DialogDescription>Copy the plan from another event. This will overwrite the current plan for <strong>{selectedEvent?.eventName}</strong>.</DialogDescription></DialogHeader><div className="py-4 space-y-4"><div className="space-y-1"><Label>Source Event</Label><Select onValueChange={setCloneSourceEventId}><SelectTrigger><SelectValue placeholder="Select event to clone from..."/></SelectTrigger><SelectContent>{events.filter(e => e.id !== selectedEventId).map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Target Event (This Event)</Label><Input value={selectedEvent?.eventName} disabled/></div></div><DialogFooter><Button variant="ghost" onClick={() => setIsCloneModalOpen(false)}>Cancel</Button><Button onClick={handleClone} disabled={isCloning || !cloneSourceEventId}>{isCloning && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Clone</Button></DialogFooter></DialogContent></Dialog>
                        <Button variant="secondary" onClick={() => handleDownloadReport('waterStations')} disabled={isDownloading === 'waterStations' || !selectedEventId}>
                          {isDownloading === 'waterStations' ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Download className="mr-2 h-4 w-4" />}
                          Download Checklist
                        </Button>
                         <Button onClick={handleSaveWaterStationPlan} disabled={isSavingPlan}>
                            {isSavingPlan && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                            Save Plan
                        </Button>
                      </CardFooter>
                  </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        )}
      </CardContent>
      <Dialog open={isAddItemModalOpen} onOpenChange={setIsAddItemModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Custom Aid Station Item</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1"><Label>Item Type</Label><RadioGroup value={addItemConfig.newItem.type} onValueChange={(v) => setAddItemConfig(c=>({...c,newItem:{...c.newItem, type:v as any}}))} className="flex gap-4"><div className="flex items-center space-x-2"><RadioGroupItem value="consumable" id="consumable"/><Label htmlFor="consumable">Consumable</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="fixed" id="fixed"/><Label htmlFor="fixed">Fixed Quantity</Label></div></RadioGroup></div>
            <div className="space-y-1"><Label>Item Name</Label><Input value={addItemConfig.newItem.name} onChange={e => setAddItemConfig(c => ({ ...c, newItem: { ...c.newItem, name: e.target.value } }))} placeholder="e.g., Salt Sticks"/></div>
            <div className="space-y-1"><Label>Unit</Label><Input value={addItemConfig.newItem.unit} onChange={e => setAddItemConfig(c => ({ ...c, newItem: { ...c.newItem, unit: e.target.value } }))} placeholder="e.g., packets, kg, pieces"/></div>
            {addItemConfig.newItem.type === 'consumable' && (
              <>
                <div className="space-y-1"><Label>Consumption Type</Label>
                    <Select value={addItemConfig.newItem.consumptionType} onValueChange={(value) => setAddItemConfig(c => ({...c, newItem: {...c.newItem, consumptionType: value as any}}))}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="perAthlete">per Athlete</SelectItem>
                          {addItemConfig.stationType !== 'venue' && <SelectItem value="perHour">per Hour</SelectItem>}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1"><Label>Consumption Rate</Label><Input type="number" value={addItemConfig.newItem.consumptionRate} onChange={e => setAddItemConfig(c => ({ ...c, newItem: { ...c.newItem, consumptionRate: Number(e.target.value) } }))}/>
                    <p className="text-xs text-muted-foreground">
                        {addItemConfig.newItem.consumptionType === 'perHour' ? 'Estimated units taken by one athlete per hour of the activity.' : 'Estimated units taken by one athlete over the entire activity leg.'}
                    </p>
                </div>
              </>
            )}
            {addItemConfig.newItem.type === 'fixed' && (
              <div className="space-y-1"><Label>Quantity per Station</Label><Input type="number" value={addItemConfig.newItem.quantityPerStation} onChange={e => setAddItemConfig(c => ({ ...c, newItem: { ...c.newItem, quantityPerStation: Number(e.target.value) } }))}/></div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>setIsAddItemModalOpen(false)}>Cancel</Button><Button onClick={handleAddItem}>Add Item</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
