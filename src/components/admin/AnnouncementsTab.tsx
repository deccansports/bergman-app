// src/components/admin/AnnouncementsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { 
    Megaphone, PlusCircle, Trash2, Edit, Save, Loader2, 
    Globe, Users, Building, Link as LinkIcon
} from 'lucide-react';
import { 
    addAnnouncementAction, 
    updateAnnouncementAction, 
    deleteAnnouncementAction,
    getAllAnnouncementsAdminAction 
} from '@/lib/actions/announcementActions';
import type { Announcement, AnnouncementType, EventCalendarEntry, AnnouncementFormInput } from '@/lib/types';
import { AnnouncementSchema } from '@/lib/schemas';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
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

export default function AnnouncementsTab() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<EventCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const form = useForm<AnnouncementFormInput>({
    resolver: zodResolver(AnnouncementSchema),
    defaultValues: {
      title: '',
      message: '',
      type: 'global',
      priority: 'low',
      isTicker: true,
      isModal: false,
      linkUrl: '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      isActive: true,
    }
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
        const [annRes, eventRes] = await Promise.all([
            getAllAnnouncementsAdminAction(),
            getCalendarEventsAction()
        ]);
        if (annRes.success && annRes.announcements) setAnnouncements(annRes.announcements);
        if (eventRes.success && eventRes.events) setEvents(eventRes.events);
    } catch (error) {
        console.error("Failed to load admin announcement data:", error);
    } finally {
        setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const upcomingEvents = useMemo(() => {
    const today = startOfDay(new Date());
    return events.filter(e => {
      if (!e.eventDate) return true; 
      try {
        const eventDate = parseISO(e.eventDate);
        return !isBefore(eventDate, today);
      } catch (err) {
        return true;
      }
    });
  }, [events]);

  const onSubmit = async (values: AnnouncementFormInput) => {
    if (!currentUser) return;
    setIsSubmitting(true);
    
    const result = editingId 
        ? await updateAnnouncementAction(editingId, values)
        : await addAnnouncementAction(values, currentUser.uid);

    if (result.success) {
        toast({ title: 'Success', description: result.message });
        setIsModalOpen(false);
        setEditingId(null);
        fetchData();
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    setIsDeletingId(id);
    const res = await deleteAnnouncementAction(id);
    if (res.success) {
        toast({ title: 'Deleted', description: 'Announcement has been removed.' });
        fetchData();
    } else {
        toast({ variant: 'destructive', title: 'Error', description: res.message });
    }
    setIsDeletingId(null);
  };

  const handleToggle = async (id: string, current: boolean) => {
      await updateAnnouncementAction(id, { isActive: !current });
      fetchData();
  };

  const handleEdit = (a: Announcement) => {
      setEditingId(a.id);
      form.reset({
          title: a.title,
          message: a.message,
          type: a.type,
          priority: a.priority,
          isTicker: a.isTicker,
          isModal: a.isModal,
          linkUrl: a.linkUrl || '',
          targetEventId: a.targetEventId || 'all',
          startDate: a.startDate.split('T')[0],
          endDate: a.endDate.split('T')[0],
          isActive: a.isActive,
      });
      setIsModalOpen(true);
  };

  const typeIcon = {
      global: Globe,
      athlete: Users,
      club: Building
  };

  return (
    <div className="space-y-6 text-left">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="text-left">
            <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary"/>Live Announcements</CardTitle>
            <CardDescription>Broadcast messages to specific user roles or event participants.</CardDescription>
          </div>
          <Button onClick={() => { setEditingId(null); form.reset(); setIsModalOpen(true); }} size="sm">
            <PlusCircle className="mr-2 h-4 w-4" /> Create New
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Announcement</TableHead>
                  <TableHead>Validity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center p-8"><Loader2 className="animate-spin mx-auto"/></TableCell></TableRow>
                ) : announcements.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">No announcements found.</TableCell></TableRow>
                ) : announcements.map(a => {
                    const Icon = typeIcon[a.type];
                    return (
                        <TableRow key={a.id}>
                            <TableCell><div className="flex items-center gap-2 text-left text-xs"><Icon className="h-4 w-4 opacity-70"/><span className="capitalize font-semibold">{a.type}</span></div></TableCell>
                            <TableCell>
                                <div className="max-w-md text-left">
                                    <p className="font-bold text-sm">{a.title}</p>
                                    <p className="text-xs text-muted-foreground line-clamp-1">{a.message}</p>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {a.isTicker && <Badge variant="outline" className="text-[10px] scale-90 origin-left">Ticker</Badge>}
                                        {a.isModal && <Badge variant="outline" className="text-[10px] scale-90 origin-left">Modal</Badge>}
                                        {a.linkUrl && <Badge variant="outline" className="text-[10px] scale-90 origin-left bg-blue-50 text-blue-600 border-blue-200">Link</Badge>}
                                        <Badge variant={a.priority === 'high' ? 'destructive' : a.priority === 'medium' ? 'default' : 'secondary'} className="text-[10px] scale-90 origin-left lowercase">{a.priority}</Badge>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                                {format(parseISO(a.startDate), 'MMM dd')} - {format(parseISO(a.endDate), 'MMM dd')}
                            </TableCell>
                            <TableCell>
                                <Switch checked={a.isActive} onCheckedChange={() => handleToggle(a.id, a.isActive)} />
                            </TableCell>
                            <TableCell className="text-right space-x-1">
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(a)}><Edit className="h-3.5 w-3.5"/></Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive" disabled={isDeletingId === a.id}>
                                            {isDeletingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Trash2 className="h-3.5 w-3.5"/>}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="text-left">
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete Announcement?</AlertDialogTitle>
                                            <AlertDialogDescription>This will permanently remove the announcement from all dashboards. This action cannot be undone.</AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(a.id)} className="bg-destructive hover:bg-destructive/90">Delete Permanently</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </TableCell>
                        </TableRow>
                    )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl text-left">
            <DialogHeader>
                <DialogTitle className="text-left">{editingId ? 'Edit' : 'Create'} Announcement</DialogTitle>
            </DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 text-left">
                    <FormField control={form.control} name="title" render={({field}) => (<FormItem><FormLabel>Ticker Heading</FormLabel><Input {...field} placeholder="e.g., Ozar 2026 - Registration Milestone"/><FormMessage/></FormItem>)}/>
                    <FormField control={form.control} name="message" render={({field}) => (<FormItem><FormLabel>Detailed Message (for Modal)</FormLabel><Textarea {...field} rows={4} placeholder="Full content shown when user clicks... "/><FormMessage/></FormItem>)}/>
                    
                    <FormField control={form.control} name="linkUrl" render={({field}) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2"><LinkIcon className="h-4 w-4"/>Redirect URL Link (Optional)</FormLabel>
                            <FormControl><Input {...field} value={field.value || ''} placeholder="e.g., /races or https://event-site.com" /></FormControl>
                            <FormDescription className="text-[10px]">When set, clicking the ticker will redirect the user to this page instead of opening a modal.</FormDescription>
                            <FormMessage/>
                        </FormItem>
                    )}/>

                    <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="type" render={({field}) => (
                            <FormItem><FormLabel>Target Audience</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="global">Global (Everyone)</SelectItem>
                                        <SelectItem value="athlete">Athletes Only</SelectItem>
                                        <SelectItem value="club">Club Owners Only</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )}/>
                        <FormField control={form.control} name="priority" render={({field}) => (
                            <FormItem><FormLabel>Priority / Color</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="low">Low (Default Dark)</SelectItem>
                                        <SelectItem value="medium">Medium (Orange)</SelectItem>
                                        <SelectItem value="high">High (Red Alert)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )}/>
                    </div>

                    {form.watch('type') === 'athlete' && (
                        <FormField control={form.control} name="targetEventId" render={({field}) => (
                            <FormItem><FormLabel>Specific Event Participants (Optional)</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || 'all'}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="All events"/></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="all">All Registered Athletes</SelectItem>
                                        <SelectGroup>
                                          <SelectLabel>Upcoming Events</SelectLabel>
                                          {upcomingEvents.map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <FormDescription className="text-[10px]">Only upcoming events are shown for selection.</FormDescription>
                            </FormItem>
                        )}/>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="startDate" render={({field}) => (<FormItem><FormLabel>Start Display</FormLabel><Input type="date" {...field}/></FormItem>)}/>
                        <FormField control={form.control} name="endDate" render={({field}) => (<FormItem><FormLabel>Auto-Hide After</FormLabel><Input type="date" {...field}/></FormItem>)}/>
                    </div>

                    <div className="flex flex-wrap gap-6 pt-2">
                        <FormField control={form.control} name="isTicker" render={({field}) => (
                            <FormItem className="flex items-center gap-2 space-y-0 text-left"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange}/></FormControl><FormLabel className="font-bold cursor-pointer">Show in Ticker</FormLabel></FormItem>
                        )}/>
                        <FormField control={form.control} name="isModal" render={({field}) => (
                            <FormItem className="flex items-center gap-2 space-y-0 text-left"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange}/></FormControl><FormLabel className="font-bold cursor-pointer">Click to open Modal</FormLabel></FormItem>
                        )}/>
                    </div>

                    <DialogFooter className="pt-4 border-t">
                        <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2"/>}{editingId ? 'Update' : 'Publish'}</Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
