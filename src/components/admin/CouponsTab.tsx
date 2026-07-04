// src/components/admin/CouponsTab.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, Edit, Trash2, Loader2, Download, Search } from 'lucide-react';
import {
  createCouponAction,
  updateCouponAction,
  deleteCouponAction,
  getAllCouponsAction,
  getAllClubs,
} from '@/lib/actions';
import type { Club, Coupon, EventCalendarEntry, TicketDefinition } from '@/lib/types';
import { CouponCreateSchema, type CouponCreateFormInput, CouponUpdateSchema, type CouponUpdateFormInput } from '@/lib/schemas';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';


interface CouponsTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
}

export default function CouponsTab({ events, isLoadingEvents }: CouponsTabProps) {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [couponTypeFilter, setCouponTypeFilter] = useState<string>('all');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubSearchTerm, setClubSearchTerm] = useState('');

  const form = useForm<CouponCreateFormInput>({
    resolver: zodResolver(CouponCreateSchema),
    defaultValues: {
      code: '',
      couponType: 'Discount Code',
      discountType: 'percentage',
      discountValue: 10,
      usageLimit: 100,
      startDate: '',
      expiryDate: '',
      isActive: true,
      applicableEventIds: [],
      sourceEventIds: [],
      applicableTicketIds: [],
      applicableClubIds: [],
    },
  });
  
  const watchedCouponType = form.watch('couponType');
  const watchedApplicableEventIds = form.watch('applicableEventIds');

  const availableTicketsForSelection = useMemo(() => {
    if (!watchedApplicableEventIds || watchedApplicableEventIds.length === 0) {
      return [];
    }
    return events
      .filter(event => watchedApplicableEventIds.includes(event.id))
      .flatMap(event => event.ticketDefinitions || [])
      .filter(ticket => !!ticket); // filter out undefined tickets
  }, [events, watchedApplicableEventIds]);

  const fetchCoupons = useCallback(async () => {
    setIsLoading(true);
    const result = await getAllCouponsAction();
    if (result.success && result.coupons) {
      setCoupons(result.coupons);
    } else {
      toast({ variant: 'destructive', title: 'Error fetching coupons', description: result.message });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  useEffect(() => {
    (async () => {
      const result = await getAllClubs();
      if (result.success && result.clubs) {
        setClubs(result.clubs);
      }
    })();
  }, []);

  useEffect(() => {
    if (isModalOpen) {
        if (editingCoupon) {
          form.reset({
            code: editingCoupon.code,
            couponType: editingCoupon.couponType,
            discountType: editingCoupon.discountType,
            discountValue: editingCoupon.discountValue,
            startDate: editingCoupon.startDate || '',
            expiryDate: editingCoupon.expiryDate || '',
            usageLimit: editingCoupon.usageLimit,
            isActive: editingCoupon.isActive,
            applicableEventIds: editingCoupon.applicableEventIds,
            sourceEventIds: editingCoupon.sourceEventIds || [],
            applicableTicketIds: editingCoupon.applicableTicketIds,
            applicableClubIds: editingCoupon.applicableClubIds || [],
            minCartValue: editingCoupon.minCartValue || undefined,
          });
        } else {
          form.reset({
              code: '', couponType: 'Discount Code', discountType: 'percentage', discountValue: 10,
              usageLimit: 100, startDate: '', expiryDate: '', isActive: true,
              applicableEventIds: [], sourceEventIds: [], applicableTicketIds: [], applicableClubIds: [], minCartValue: undefined
          });
        }
    }
  }, [editingCoupon, isModalOpen, form]);


  const onCouponSubmit = async (data: CouponCreateFormInput) => {
    setIsSubmitting(true);
    const result = editingCoupon
      ? await updateCouponAction(editingCoupon.id, data as CouponUpdateFormInput)
      : await createCouponAction(data);
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      fetchCoupons();
      setIsModalOpen(false);
      setEditingCoupon(null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };
  
  const handleDownloadUsage = (couponCode: string) => {
      window.location.href = `/api/admin/download-coupon-usage?couponCode=${encodeURIComponent(couponCode)}`;
  };

  const couponTypeOptions = useMemo(() => {
    const uniqueTypes = Array.from(new Set(coupons.map((c) => c.couponType).filter(Boolean)));
    return uniqueTypes.sort((a, b) => a.localeCompare(b));
  }, [coupons]);

  const filteredCoupons = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return coupons.filter((c) => {
      const matchesSearch = !normalizedSearch || c.code.toLowerCase().includes(normalizedSearch);
      const matchesType = couponTypeFilter === 'all' || c.couponType === couponTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [coupons, searchTerm, couponTypeFilter]);

  const filteredClubs = useMemo(() => {
    const term = clubSearchTerm.trim().toLowerCase();
    if (!term) return clubs;
    return clubs.filter((club) =>
      club.name?.toLowerCase().includes(term) ||
      club.email?.toLowerCase().includes(term)
    );
  }, [clubs, clubSearchTerm]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
               <CardTitle>Manage Coupons</CardTitle>
               <CardDescription>Create, edit, and track coupon usage.</CardDescription>
            </div>
            <Button size="sm" onClick={() => { setEditingCoupon(null); setIsModalOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Create Coupon</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Input
              placeholder="Search coupon code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
            <Select value={couponTypeFilter} onValueChange={setCouponTypeFilter}>
              <SelectTrigger className="w-full md:w-[240px]">
                <SelectValue placeholder="Filter by coupon type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {couponTypeOptions.map((type) => (
                  <SelectItem key={`coupon-type-filter-${type}`} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Valid From</TableHead>
                  <TableHead>Valid To</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center">
                      <Loader2 className="animate-spin my-4 mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filteredCoupons.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center">
                      No coupons found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCoupons.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.code}</TableCell>
                      <TableCell>{c.couponType}</TableCell>
                      <TableCell>
                        {c.discountType === 'percentage'
                          ? `${c.discountValue}%`
                          : `₹${c.discountValue}`}
                      </TableCell>
                      <TableCell>
                        {c.usageCount} / {c.usageLimit}
                      </TableCell>
                      <TableCell>{c.startDate ? format(parseISO(c.startDate), 'MMM dd, yyyy') : 'N/A'}</TableCell>
                      <TableCell>{c.expiryDate ? format(parseISO(c.expiryDate), 'MMM dd, yyyy') : 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant={c.isActive ? 'default' : 'secondary'}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => handleDownloadUsage(c.code)}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            setEditingCoupon(c);
                            setIsModalOpen(true);
                          }}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="xs">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Coupon?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the coupon &quot;{c.code}&quot;.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  deleteCouponAction(c.id).then(fetchCoupons)
                                }
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-xl text-left">
            <DialogHeader>
                <DialogTitle>{editingCoupon ? `Edit Coupon: ${editingCoupon.code}` : 'Create New Coupon'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onCouponSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto p-1 pr-4">
                 <FormField control={form.control} name="code" render={({field})=>(<FormItem><FormLabel>Coupon Code</FormLabel><Input {...field} disabled={!!editingCoupon} /></FormItem>)} />
                 <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="couponType" render={({field})=>(<FormItem><FormLabel>Coupon Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="Discount Code">Discount</SelectItem><SelectItem value="Group Discount">Group</SelectItem><SelectItem value="Access Code">Access</SelectItem><SelectItem value="Early Bird / Sale">Sale</SelectItem><SelectItem value="Club Coupon">Club Coupon</SelectItem><SelectItem value="Previous Participant">Previous Participant</SelectItem><SelectItem value="Feedback Coupon">Feedback Coupon</SelectItem></SelectContent></Select></FormItem>)}/>
                  {watchedCouponType !== 'Access Code' && (
                    <FormField control={form.control} name="discountType" render={({field})=>(<FormItem><FormLabel>Discount Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="percentage">Percentage</SelectItem><SelectItem value="fixed">Fixed</SelectItem></SelectContent></Select></FormItem>)}/>
                  )}
                 </div>
                 {watchedCouponType !== 'Access Code' && (
                 <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="discountValue" render={({field})=>(<FormItem><FormLabel>Discount Value</FormLabel><Input type="number" {...field} onChange={e => field.onChange(Number(e.target.value))}/></FormItem>)}/>
                  <FormField control={form.control} name="minCartValue" render={({field})=>(<FormItem><FormLabel>Min Cart Value (Paisa)</FormLabel><Input type="number" {...field} value={field.value ?? ''} onChange={e=>field.onChange(e.target.value==='' ? null : parseInt(e.target.value, 10))}/></FormItem>)}/>
                 </div>
                 )}
                 {watchedCouponType === 'Access Code' && (
                   <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
                     <p className="font-medium">Access codes unlock hidden tickets without applying a discount.</p>
                   </div>
                 )}
                 <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="startDate" render={({field})=>(<FormItem><FormLabel>Start Date</FormLabel><Input type="date" {...field} value={field.value || ''}/></FormItem>)}/>
                  <FormField control={form.control} name="expiryDate" render={({field})=>(<FormItem><FormLabel>Expiry Date</FormLabel><Input type="date" {...field} value={field.value || ''}/></FormItem>)}/>
                 </div>
                 <FormField control={form.control} name="usageLimit" render={({field})=>(<FormItem><FormLabel>Usage Limit</FormLabel><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))}/></FormItem>)}/>
                  
                  {watchedCouponType === 'Previous Participant' && (
                    <FormField
                      control={form.control}
                      name="sourceEventIds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Source Events (Eligibility)</FormLabel>
                          <FormDescription>Select events an athlete must have participated in to be eligible for this coupon.</FormDescription>
                          <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                              {events.map(event => (
                                <FormItem key={`source-${event.id}`} className="flex flex-row items-start space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={(field.value || []).includes(event.id)}
                                      onCheckedChange={checked => {
                                        return checked
                                          ? field.onChange([...(field.value || []), event.id])
                                          : field.onChange((field.value || []).filter((v: string) => v !== event.id));
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal">{event.eventName}</FormLabel>
                                </FormItem>
                              ))}
                          </div>
                        </FormItem>
                      )}
                    />
                  )}

                  {watchedCouponType === 'Club Coupon' && (
                    <FormField
                      control={form.control}
                      name="applicableClubIds"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between gap-2">
                            <FormLabel>Applicable Clubs</FormLabel>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => field.onChange(clubs.map((c) => c.id))}
                                disabled={clubs.length === 0}
                              >
                                Select All
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => field.onChange([])}
                                disabled={(field.value || []).length === 0}
                              >
                                Clear
                              </Button>
                            </div>
                          </div>
                          <FormDescription>Select one or multiple clubs eligible for this club coupon.</FormDescription>
                          <Input
                            placeholder="Search club by name or email..."
                            value={clubSearchTerm}
                            onChange={(e) => setClubSearchTerm(e.target.value)}
                            className="h-9"
                          />
                          <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                            {filteredClubs.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No clubs found.</p>
                            ) : (
                              filteredClubs.map((club) => (
                                <FormItem key={`club-item-${club.id}`} className="flex flex-row items-start space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={(field.value || []).includes(club.id)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), club.id])
                                          : field.onChange((field.value || []).filter((value: string) => value !== club.id));
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal">{club.name}</FormLabel>
                                </FormItem>
                              ))
                            )}
                          </div>
                        </FormItem>
                      )}
                    />
                  )}

                 <FormField 
                    control={form.control} 
                    name="applicableEventIds" 
                    render={({ field }) => (
                      <FormItem>
                          <FormLabel>{watchedCouponType === 'Previous Participant' ? 'Target Events (Applicable For)' : 'Applicable Events'}</FormLabel>
                          <FormDescription>
                              {watchedCouponType === 'Previous Participant' 
                                  ? "Select events where this coupon can be USED."
                                  : "Select events where this coupon is valid. Select none for all events."}
                          </FormDescription>
                          <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                              {events.map(event => (
                                <FormItem key={`target-item-${event.id}`} className="flex flex-row items-start space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={(field.value || []).includes(event.id)}
                                      onCheckedChange={checked => {
                                        return checked
                                          ? field.onChange([...(field.value || []), event.id])
                                          : field.onChange((field.value || []).filter((value: string) => value !== event.id));
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal">{event.eventName}</FormLabel>
                                </FormItem>
                              ))}
                          </div>
                      </FormItem>
                    )}
                  />

                  {availableTicketsForSelection.length > 0 && (
                    <FormField
                      control={form.control}
                      name="applicableTicketIds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Applicable Tickets (Optional)</FormLabel>
                          <FormDescription>
                            {watchedCouponType === 'Access Code'
                              ? 'Select the hidden tickets this access code should unlock. Access codes do not unlock all hidden tickets by default.'
                              : 'Select specific tickets this coupon applies to. If none are selected, it applies to all tickets in the selected events.'}
                          </FormDescription>
                          <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                            {availableTicketsForSelection.map((ticket) => (
                                <FormItem key={`ticket-item-${ticket.id}`} className="flex flex-row items-start space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={(field.value || []).includes(ticket.id)}
                                      onCheckedChange={checked => {
                                        return checked
                                          ? field.onChange([...(field.value || []), ticket.id])
                                          : field.onChange((field.value || []).filter((value: string) => value !== ticket.id));
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal">{ticket.ticketName}</FormLabel>
                                </FormItem>
                            ))}
                          </div>
                        </FormItem>
                      )}
                    />
                  )}


                 <FormField control={form.control} name="isActive" render={({field})=>(<FormItem className="flex items-center space-x-2"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange}/></FormControl><FormLabel>Is Active</FormLabel></FormItem>)}/>
                <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin h-4 w-4"/> : 'Save'}</Button></DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </Card>
    </>
  );
}
