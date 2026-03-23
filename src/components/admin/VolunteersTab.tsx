// src/components/admin/VolunteersTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import {
  Users, UserPlus, Loader2, Edit, Trash2, Search as SearchIcon, ClipboardList, Bike, Medal, UtensilsCrossed, IndianRupee, Package, UserCheck, Clock, Award, Repeat, Waves, Footprints
} from 'lucide-react';
import type { User, EventCalendarEntry } from '@/lib/types';
import {
  getAllVolunteersAction,
  createAndAssignVolunteerAction,
  assignVolunteerToEventAction,
  removeVolunteerAssignmentAction,
} from '@/lib/actions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { 
    CreateVolunteerUserActionSchema, 
    type CreateVolunteerUserActionInput, 
    VolunteerAssignmentSchema, 
    type VolunteerAssignmentFormInput 
} from '@/lib/schemas';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format as formatDateFns, parseISO, isValid as isDateValid } from 'date-fns';
import { Label } from '@/components/ui/label';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import VolunteerStatsCard from '@/components/admin/VolunteerStatsCard';
import CheckinLogTab from '@/components/volunteer/CheckinLogTab';
import BikeCheckinLogTab from '@/components/volunteer/BikeCheckinLogTab';
import BikeCheckoutLogTab from '@/components/volunteer/BikeCheckoutLogTab';
import FinisherItemsLogTab from '@/components/admin/FinisherItemsLogTab'; 
import FoodLogTab from '@/components/admin/FoodLogTab'; 
import PaidFoodTab from '@/components/admin/PaidFoodTab';
import LockerCounterTab from '@/components/volunteer/LockerCounterTab';
import TimeVolunteerTab from '@/components/volunteer/TimeVolunteerTab';
import FinishLineVolunteerTab from '@/components/volunteer/FinishLineVolunteerTab';
import LoopLogTab from '@/components/admin/LoopLogTab';
import LoopManagementTab from './LoopManagementTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


const VOLUNTEER_COUNTERS = [
  { value: 'waiver_checkin', label: 'Waiver / Check-in' },
  { value: 'bike_checkin', label: 'Bike Check-in' },
  { value: 'bike_checkout', label: 'Bike Check-out' },
  { value: 'bike_rack_marshal', label: 'Bike Rack Marshal' },
  { value: 'medal_counter', label: 'Finisher goodies' },
  { value: 'food_counter', label: 'Food' },
  { value: 'paid_food_counter', label: 'Paid Food' },
  { value: 'locker_counter', label: 'Locker Counter' },
  { value: 'time_volunteer', label: 'Time Volunteer' },
  { value: 'finish_line_volunteer', label: 'Finish Line Volunteer' },
  { value: 'swim_loop_volunteer', label: 'Swim Loop Counter' },
  { value: 'bike_loop_volunteer', label: 'Bike Loop Counter' },
  { value: 'run_loop_volunteer', label: 'Run Loop Counter' },
  { value: 'transition_area', label: 'Transition Area Marshal' },
  { value: 'course_marshal', label: 'Course Marshal' },
  { value: 'aid_station', label: 'Aid Station' },
  { value: 'finish_line', label: 'Finish Line Support' },
  { value: 'info_desk', label: 'Information Desk' },
  { value: 'other', label: 'Other (Specify in Notes)' },
];
const NO_ASSIGNMENT_PLACEHOLDER_VALUE = "--no-assignment-placeholder--";

function ManageAssignmentsTab({
  allVolunteers,
  calendarEvents,
  isLoadingAllVolunteers,
  isLoadingEvents,
  fetchVolunteersAndStats
}: {
  allVolunteers: User[];
  calendarEvents: EventCalendarEntry[];
  isLoadingAllVolunteers: boolean;
  isLoadingEvents: boolean;
  fetchVolunteersAndStats: () => void;
}) {
  const { toast } = useToast();
  const [isCreateVolunteerModalOpen, setIsCreateVolunteerModalOpen] = useState(false);
  const [searchedVolunteerUsers, setSearchedVolunteerUsers] = useState<User[]>([]);
  const [volunteerSearchTerm, setVolunteerSearchTerm] = useState('');
  const [isLoadingVolunteerSearch, setIsLoadingVolunteerSearch] = useState(false);
  const [selectedUserForVolunteerAssignment, setSelectedUserForVolunteerAssignment] = useState<User | null>(null);
  const [isAssigningVolunteer, setIsAssigningVolunteer] = useState(false);
  const [isCreatingVolunteer, setIsCreatingVolunteer] = useState(false);

  const volunteerAssignmentForm = useForm<VolunteerAssignmentFormInput>({ resolver: zodResolver(VolunteerAssignmentSchema), defaultValues: { userId: '', isVolunteer: false, assignedEventId: null, assignedCounter: [] } });
  
  // Adjusted schema name and fields to match CreateVolunteerUserActionSchema
  const createVolunteerUserForm = useForm<CreateVolunteerUserActionInput>({ 
    resolver: zodResolver(CreateVolunteerUserActionSchema), 
    defaultValues: { name: '', email: '', mobile: '', password: '', assignedEventId: null, assignedCounter: [] } 
  });
  
  useEffect(() => {
    if (selectedUserForVolunteerAssignment) {
        volunteerAssignmentForm.reset({ userId: selectedUserForVolunteerAssignment.uid, isVolunteer: !!selectedUserForVolunteerAssignment.isVolunteer, assignedEventId: selectedUserForVolunteerAssignment.assignedEventId || null, assignedCounter: selectedUserForVolunteerAssignment.assignedCounter || [], });
    }
  }, [selectedUserForVolunteerAssignment, volunteerAssignmentForm]);
  
  const handleSearchUsersForVolunteer = async(term: string) => {
    setVolunteerSearchTerm(term);
    if (term.length < 3) {
      setSearchedVolunteerUsers([]);
      return;
    }
    setIsLoadingVolunteerSearch(true);
    try {
      const response = await fetch(`/api/admin/search-users?term=${encodeURIComponent(term)}`);
      const result = await response.json();
      if (result.success && Array.isArray(result.users)) {
        setSearchedVolunteerUsers(result.users);
      } else {
        setSearchedVolunteerUsers([]);
      }
    } catch (e: any) {
      setSearchedVolunteerUsers([]);
      toast({ variant: 'destructive', title: 'Search Error', description: 'Failed to fetch users.' });
    } finally {
      setIsLoadingVolunteerSearch(false);
    }
  };

  const handleAssignVolunteerToEvent = async(data: VolunteerAssignmentFormInput) => {
    if (!selectedUserForVolunteerAssignment) return;
    setIsAssigningVolunteer(true);
    const event=calendarEvents.find(e=>e.id===data.assignedEventId);
    const result=await assignVolunteerToEventAction(selectedUserForVolunteerAssignment.uid,data.isVolunteer,data.assignedEventId||null,event?.eventName||null,event?.eventDate||null, data.assignedCounter||null);
    if(result.success) { toast({title:"Success",description:result.message}); fetchVolunteersAndStats(); setSelectedUserForVolunteerAssignment(null); }
    else { toast({variant:"destructive",title:"Error",description:result.message}); }
    setIsAssigningVolunteer(false);
  };

  const handleRemoveVolunteerAssignment = async(userId: string) => {
    setIsAssigningVolunteer(true);
    const result=await removeVolunteerAssignmentAction(userId);
    if(result.success) { toast({title:"Success",description:result.message}); fetchVolunteersAndStats(); }
    else { toast({variant:"destructive",title:"Error",description:result.message}); }
    setIsAssigningVolunteer(false); setSelectedUserForVolunteerAssignment(null);
  };
  
  const handleCreateVolunteerSubmit = useCallback(async (data: CreateVolunteerUserActionInput) => {
    setIsCreatingVolunteer(true); const res = await createAndAssignVolunteerAction(data);
    if (res.success) { toast({ title: "Success", description: res.message }); fetchVolunteersAndStats(); }
    else { toast({ variant: "destructive", title: "Error", description: res.message }); }
    setIsCreatingVolunteer(false); setIsCreateVolunteerModalOpen(false);
  }, [toast, fetchVolunteersAndStats]);

  const filteredVolunteers = useMemo(() => {
    if (!volunteerSearchTerm) return allVolunteers;
    const lowerTerm = volunteerSearchTerm.toLowerCase();
    return allVolunteers.filter(v =>
        (v.name?.toLowerCase().includes(lowerTerm)) ||
        (v.email?.toLowerCase().includes(lowerTerm)) ||
        (v.mobile?.includes(lowerTerm))
    );
  }, [allVolunteers, volunteerSearchTerm]);

  return (
    <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
              <div>
                  <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary"/>Manage Volunteer Assignments</CardTitle>
                  <CardDescription>Assign existing users as volunteers or create new volunteer accounts.</CardDescription>
              </div>
              <Button size="sm" onClick={()=>setIsCreateVolunteerModalOpen(true)}><UserPlus className="mr-2 h-4 w-4"/>Create New Volunteer</Button>
          </CardHeader>
          <CardContent className="space-y-6">
               <div className="p-4 border rounded-lg bg-background">
                  <h4 className="font-semibold mb-2">Assign Existing User</h4>
                  <Input placeholder="Search user by name or email..." onChange={e=>handleSearchUsersForVolunteer(e.target.value)} disabled={isAssigningVolunteer} className="text-sm"/>
                  {isLoadingVolunteerSearch ? <p className="text-xs mt-2">Searching...</p> : searchedVolunteerUsers.length > 0 && (<div className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-2">{searchedVolunteerUsers.map(u=>(<Button key={u.uid} variant="ghost" size="sm" onClick={()=>setSelectedUserForVolunteerAssignment(u)} className={`w-full justify-start ${selectedUserForVolunteerAssignment?.uid===u.uid?'bg-accent':''}`}>{u.name} ({u.email})</Button>))}</div>)}
              </div>
              {selectedUserForVolunteerAssignment && (
                <Form {...volunteerAssignmentForm}>
                    <form onSubmit={volunteerAssignmentForm.handleSubmit(handleAssignVolunteerToEvent)} className="space-y-3 p-4 border-2 border-primary/50 rounded-lg shadow-md">
                        <h4 className="font-semibold text-primary">Editing: {selectedUserForVolunteerAssignment.name}</h4>
                        <FormField control={volunteerAssignmentForm.control} name="isVolunteer" render={({field}) => (
                            <FormItem className="flex flex-row items-center space-x-3">
                                <FormControl>
                                    <Checkbox checked={!!field.value} onCheckedChange={field.onChange}/>
                                </FormControl>
                                <FormLabel>Mark as Volunteer</FormLabel>
                                <FormMessage />
                            </FormItem>
                        )}/>
                        <FormField control={volunteerAssignmentForm.control} name="assignedEventId" render={({field})=>(<FormItem><FormLabel className="text-xs">Assign to Event</FormLabel><Select onValueChange={field.onChange} value={field.value||NO_ASSIGNMENT_PLACEHOLDER_VALUE} disabled={!volunteerAssignmentForm.watch('isVolunteer')}><FormControl><SelectTrigger className="text-sm"><SelectValue placeholder="Select event..."/></SelectTrigger></FormControl><SelectContent><SelectItem value={NO_ASSIGNMENT_PLACEHOLDER_VALUE}>None</SelectItem>{calendarEvents.filter(e => e && e.id && e.id.trim() !== '' && (e.eventDate && !isDateValid(new Date(e.eventDate))?true:(e.eventDate&&new Date(e.eventDate)>=new Date(new Date().setHours(0,0,0,0))))).map(e=>(<SelectItem key={e.id} value={e.id!}>{e.eventName} ({e.eventDate?formatDateFns(parseISO(e.eventDate),'MMM dd, yyyy'):'TBD'})</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                        <FormField control={volunteerAssignmentForm.control} name="assignedCounter" render={({ field }) => (
                            <FormItem>
                                <div className="mb-2"><FormLabel className="text-xs">Assign to Counter/Role(s)</FormLabel></div>
                                <div className="flex flex-wrap gap-2 p-2 border rounded-md">{VOLUNTEER_COUNTERS.map((counter) => (<FormItem key={counter.value} className="flex flex-row items-start space-x-2 space-y-0">
                                    <FormControl><Checkbox checked={field.value?.includes(counter.value)} onCheckedChange={(checked: boolean) => { const currentValue = field.value || []; return checked ? field.onChange([...currentValue, counter.value]) : field.onChange(currentValue.filter((value: string) => value !== counter.value)); }} disabled={!volunteerAssignmentForm.watch('isVolunteer')} /></FormControl>
                                    <Label className="text-xs font-normal cursor-pointer">{counter.label}</Label>
                                </FormItem>))}</div><FormMessage />
                            </FormItem>
                        )} />
                        <div className="flex justify-end gap-2"><Button type="button" variant="destructive" size="sm" onClick={()=>handleRemoveVolunteerAssignment(selectedUserForVolunteerAssignment.uid)} disabled={isAssigningVolunteer}>Remove Volunteer Role</Button><Button type="submit" size="sm" disabled={isAssigningVolunteer}>{isAssigningVolunteer&&<Loader2 className="animate-spin h-4 w-4 mr-2"/>}Save Assignment</Button></div>
                    </form>
                </Form>
              )}
               <div className="mt-4 border-t pt-4 text-left">
                 <h4 className="font-semibold mb-2 text-left">All Volunteers</h4>
                 <Input placeholder="Search volunteers..." value={volunteerSearchTerm} onChange={(e) => setVolunteerSearchTerm(e.target.value)} className="mb-2" />
                 {isLoadingAllVolunteers ? <p>Loading all volunteers...</p> : filteredVolunteers.length > 0 ? (<div className="max-h-80 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Mobile</TableHead><TableHead>Assigned Event</TableHead><TableHead>Roles</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                   <TableBody>{filteredVolunteers.map(v=>(<TableRow key={v.uid} className="text-xs text-left"><TableCell>{v.name}</TableCell><TableCell>{v.email}</TableCell><TableCell>{v.mobile || 'N/A'}</TableCell><TableCell>{v.assignedEventName||'N/A'}</TableCell><TableCell>{(Array.isArray(v.assignedCounter)?v.assignedCounter:v.assignedCounter?[v.assignedCounter]:[]).join(', ')||'N/A'}</TableCell>
                     <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="xs" onClick={() => setSelectedUserForVolunteerAssignment(v)} disabled={isAssigningVolunteer}><Edit className="h-3.5 w-3.5"/></Button>
                        <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="xs" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5"/></Button></AlertDialogTrigger>
                          <AlertDialogContent className="text-left"><AlertDialogHeader className="text-left"><AlertDialogTitle className="text-left">Remove {v.name} as Volunteer?</AlertDialogTitle><AlertDialogDescription className="text-left">This will remove their volunteer status and all event assignments. They will still be a regular user.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter className="text-left"><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handleRemoveVolunteerAssignment(v.uid)}>Remove Volunteer</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                        </AlertDialog>
                     </TableCell>
                   </TableRow>))}</TableBody>
                 </Table></div>) : <p>No users marked as volunteers.</p>}
               </div>
          </CardContent>
        </Card>
        <Dialog open={isCreateVolunteerModalOpen} onOpenChange={setIsCreateVolunteerModalOpen}>
              <DialogContent className="text-left">
                  <DialogHeader className="text-left"><DialogTitle className="text-left">Create New Volunteer Account</DialogTitle><DialogDescription className="text-left">Create a new user and assign them as a volunteer. They will receive an email with their credentials.</DialogDescription></DialogHeader>
                   <ScrollArea className="max-h-[70vh] p-1 pr-4 custom-scrollbar">
                      <Form {...createVolunteerUserForm}>
                          <form onSubmit={createVolunteerUserForm.handleSubmit(handleCreateVolunteerSubmit)} className="space-y-3 py-4 text-left">
                              <FormField control={createVolunteerUserForm.control} name="name" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs text-left">Full Name</FormLabel><Input {...field} value={field.value || ''} placeholder="Volunteer's name"/><FormMessage /></FormItem>)}/>
                              <FormField control={createVolunteerUserForm.control} name="email" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs text-left">Email</FormLabel><Input type="email" {...field} value={field.value || ''} placeholder="volunteer@example.com"/><FormMessage /></FormItem>)}/>
                              <FormField control={createVolunteerUserForm.control} name="mobile" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs text-left">Mobile (e.g., +91987...)</FormLabel><Input type="tel" {...field} value={field.value || ''} placeholder="+919876543210"/><FormMessage /></FormItem>)}/>
                              <FormField control={createVolunteerUserForm.control} name="password" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs text-left">Password</FormLabel><Input type="password" {...field} value={field.value || ''}/><FormMessage /></FormItem>)}/>
                              <FormField control={createVolunteerUserForm.control} name="assignedEventId" render={({field})=>(<FormItem className="text-left"><FormLabel className="text-xs text-left">Assign to Event (Optional)</FormLabel><Select onValueChange={field.onChange} value={field.value||NO_ASSIGNMENT_PLACEHOLDER_VALUE}><FormControl><SelectTrigger className="text-sm"><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value={NO_ASSIGNMENT_PLACEHOLDER_VALUE}>None</SelectItem>{calendarEvents.filter(e => e && e.id && e.id.trim() !== '').map(e=>(<SelectItem key={e.id} value={e.id!}>{e.eventName}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)}/>
                              <FormField control={createVolunteerUserForm.control} name="assignedCounter" render={({ field }) => (
                                  <FormItem className="text-left">
                                      <FormLabel className="text-xs text-left">Assign to Role(s) (Optional)</FormLabel>
                                      <div className="grid grid-cols-2 gap-2 border p-2 rounded-md">
                                          {VOLUNTEER_COUNTERS.map((counter) => (<FormItem key={counter.value} className="flex items-center space-x-2">
                                              <FormControl><Checkbox checked={field.value?.includes(counter.value)} onCheckedChange={(checked: boolean) => { const currentValue = field.value || []; return checked ? field.onChange([...currentValue, counter.value]) : field.onChange(currentValue.filter((value: string) => value !== counter.value)); }} /></FormControl>
                                              <Label className="text-xs font-normal text-left">{counter.label}</Label>
                                          </FormItem>))}
                                      </div>
                                      <FormMessage />
                                  </FormItem>
                              )} />
                              <DialogFooter className="pt-4 text-left"><Button type="button" variant="outline" onClick={()=>setIsCreateVolunteerModalOpen(false)}>Cancel</Button><Button type="submit" disabled={isCreatingVolunteer}>{isCreatingVolunteer&&<Loader2 className="animate-spin h-4 w-4 mr-2"/>}Create Volunteer</Button></DialogFooter>
                          </form>
                      </Form>
                  </ScrollArea>
              </DialogContent>
        </Dialog>
    </div>
  );
}

export default function VolunteersTab() {
  type AdminVolunteerTab = 'manageAssignments' | 'loopManagement' | 'loopLog' | 'checkInLog' | 'bikeCheckinLog' | 'bikeCheckoutLog' | 'foodLog' | 'finisherItemsLog' | 'lockerCounter' | 'paidFood';

  const [activeTab, setActiveTab] = useState<AdminVolunteerTab>('manageAssignments');
  const [allVolunteers, setAllVolunteers] = useState<User[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoadingAllVolunteers, setIsLoadingAllVolunteers] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const fetchVolunteersAndStats = useCallback(() => {
    setIsLoadingAllVolunteers(true);
    getAllVolunteersAction().then((volunteersResult: { success: boolean, volunteers?: User[] }) => {
        if (volunteersResult.success && volunteersResult.volunteers) setAllVolunteers(volunteersResult.volunteers); else setAllVolunteers([]);
    }).catch((e: Error) => { toast({ variant: 'destructive', title: 'Error', description: 'Failed to fetch volunteer data.' }); })
    .finally(() => { setIsLoadingAllVolunteers(false); });
  }, [toast]);
  
  const fetchEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      const result = await getCalendarEventsAction();
      if (result.success && result.events) { setCalendarEvents(result.events); }
      else { toast({ variant: "destructive", title: "Error", description: result.message || "Could not fetch events." }); }
    } catch (error: any) { toast({ variant: "destructive", title: "Fetch Error", description: error.message || "An unexpected error occurred." }); }
    finally { setIsLoadingEvents(false); }
  }, [toast]);

  useEffect(() => {
    fetchVolunteersAndStats();
    fetchEvents();
  }, [fetchVolunteersAndStats, fetchEvents]);

  const navItems = [
    { id: 'manageAssignments', label: 'Assignments', icon: UserPlus },
    { id: 'loopManagement', label: 'Loop Management', icon: Repeat },
    { id: 'loopLog', label: 'Loop Log', icon: ClipboardList },
    { id: 'checkInLog', label: 'Waiver Log', icon: ClipboardList },
    { id: 'bikeCheckinLog', label: 'Bike-in Log', icon: Bike },
    { id: 'bikeCheckoutLog', label: 'Bike-out Log', icon: Bike },
    { id: 'lockerCounter', label: 'Locker Log', icon: Package },
    { id: 'finisherItemsLog', label: 'Finisher Items', icon: Medal },
    { id: 'foodLog', label: 'Food Log', icon: UtensilsCrossed },
    { id: 'paidFood', label: 'Paid Food Log', icon: IndianRupee },
  ];

  const renderNav = () => {
    if (isMobile) {
        return (
            <Select value={activeTab} onValueChange={(value) => setActiveTab(value as AdminVolunteerTab)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select Section..." />
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
      <ScrollArea className="w-full whitespace-nowrap">
        <TabsList className="inline-flex h-auto p-1 flex-wrap">
            {navItems.map(item => (
                 <TabsTrigger key={item.id} value={item.id} className="text-left"><item.icon className="mr-1.5 h-4 w-4"/>{item.label}</TabsTrigger>
            ))}
        </TabsList>
         <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  };


  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AdminVolunteerTab)} className="w-full">
      {renderNav()}
      <div className="mt-4 text-left">
        <TabsContent value="manageAssignments" className="mt-4 text-left">
         <Card className="bg-muted/30 mb-6 text-left">
            <CardHeader className="pb-4 text-left"><CardTitle className="text-lg text-left">Volunteer Stats</CardTitle></CardHeader>
            <CardContent className="text-left"><VolunteerStatsCard /></CardContent>
        </Card>
        <ManageAssignmentsTab
          allVolunteers={allVolunteers}
          calendarEvents={calendarEvents}
          isLoadingAllVolunteers={isLoadingAllVolunteers}
          isLoadingEvents={isLoadingEvents}
          fetchVolunteersAndStats={fetchVolunteersAndStats}
        />
      </TabsContent>
      <TabsContent value="loopManagement" className="mt-4">
          <LoopManagementTab events={calendarEvents} isLoadingEvents={isLoadingEvents} onDataRefresh={fetchEvents} />
      </TabsContent>
      <TabsContent value="loopLog" className="mt-4">
          <LoopLogTab events={calendarEvents} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="checkInLog" className="mt-4">
          <CheckinLogTab events={calendarEvents} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="bikeCheckinLog" className="mt-4">
          <BikeCheckinLogTab events={calendarEvents} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
       <TabsContent value="bikeCheckoutLog" className="mt-4">
          <BikeCheckoutLogTab events={calendarEvents} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
       <TabsContent value="lockerCounter" className="mt-4">
          <LockerCounterTab eventId={''} />
      </TabsContent>
      <TabsContent value="foodLog" className="mt-4">
          <FoodLogTab events={calendarEvents} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
      <TabsContent value="finisherItemsLog" className="mt-4">
        <FinisherItemsLogTab events={calendarEvents} isLoadingEvents={isLoadingEvents} />
      </TabsContent>
       <TabsContent value="paidFood" className="mt-4">
        <PaidFoodTab events={calendarEvents} isLoadingEvents={isLoadingEvents} onDataRefresh={() => {}}/>
      </TabsContent>
    </div>
    </Tabs>
  );
}
