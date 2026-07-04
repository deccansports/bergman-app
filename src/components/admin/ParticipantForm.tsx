// src/components/admin/ParticipantForm.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { 
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription 
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label as CheckboxLabel } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Save, UserCircle, MapPin, CreditCard, ShieldCheck } from 'lucide-react';
import { AdminParticipantEditSchema, type AdminParticipantEditFormInput } from '@/lib/schemas';
import type { EventCalendarEntry, EventParticipant, Club } from '@/lib/types';
import { GENDERS, BLOOD_GROUPS, KID_TSHIRT_SIZES, ADULT_TSHIRT_SIZES, NO_CLUB_SELECTED_VALUE, INDIAN_STATES } from '@/lib/constants';
import { countriesByContinent } from '@/lib/countries';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';
import { toDateStringSafe, isValidImageUrl } from '@/lib/utils';
import { differenceInYears, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';

interface ParticipantFormProps {
  eventDetails: EventCalendarEntry;
  editingParticipant: EventParticipant;
  onSubmitCallback: (data: AdminParticipantEditFormInput) => Promise<void>;
  isLoading: boolean;
  allClubs: Club[];
  onIdProofFileChange: (file: File | null) => void;
}

const GST_STATUSES = ["Yes", "No"];

const getIdProofType = (url?: string | null): 'pdf' | 'image' | 'other' => {
  if (!url) return 'other';
  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)$/.test(cleanUrl)) return 'image';
  return isValidImageUrl(url) ? 'image' : 'other';
};

export default function ParticipantForm({ 
  eventDetails, 
  editingParticipant, 
  onSubmitCallback, 
  isLoading, 
  allClubs,
  onIdProofFileChange 
}: ParticipantFormProps) {
  const { toast } = useToast();
  const [dialCode, setDialCode] = useState('+91');
  const [isIdProofModalOpen, setIsIdProofModalOpen] = useState(false);
  
  const defaultFormValues = useMemo(() => {
    let mobileOnly = editingParticipant.mobile || '';
    if (mobileOnly.startsWith('+')) {
        const matched = COUNTRY_CODES.find(c => mobileOnly.startsWith(c.dial_code));
        if (matched) {
            mobileOnly = mobileOnly.replace(matched.dial_code, '');
            setDialCode(matched.dial_code);
        }
    }

    return {
      ticketId: editingParticipant.ticketId || "",
      name: editingParticipant.name,
      email: editingParticipant.email || "",
      mobile: mobileOnly,
      personalRaceEmail: editingParticipant.personalRaceEmail || "",
      emergencyContactNumber: editingParticipant.emergencyContactNumber || "",
      dob: toDateStringSafe(editingParticipant.dob) || "",
      gender: editingParticipant.gender as any,
      bloodGroup: editingParticipant.bloodGroup || "",
      tshirtSize: editingParticipant.tshirtSize || "",
      bibNumber: editingParticipant.bibNumber || "",
      ageCategory: editingParticipant.ageCategory || "",
      address: editingParticipant.address || "",
      city: editingParticipant.city || "",
      pincode: editingParticipant.pincode || "",
      state: editingParticipant.state || "",
      country: editingParticipant.country || "India",
      clubId: editingParticipant.clubId || NO_CLUB_SELECTED_VALUE,
      clubAffiliationDate: toDateStringSafe(editingParticipant.clubAffiliationDate) || "",
      ticketStatus: (editingParticipant.ticketStatus as any) || "Active",
      amountPaidPaisa: editingParticipant.amountPaidPaisa || 0,
      taxAmountPaidPaisa: editingParticipant.taxAmountPaidPaisa || 0,
      processingFeePaidPaisa: editingParticipant.processingFeePaidPaisa || 0,
      platformFeePaidPaisa: editingParticipant.platformFeePaidPaisa || 0,
      gstPaid: editingParticipant.gstPaid as any || "No",
      isDeferredFromPune: (editingParticipant as any).isDeferredFromPune || "No",
      sendConfirmation: false,
      billingType: editingParticipant.billingType || 'personal',
      businessName: editingParticipant.businessName || '',
      gstin: editingParticipant.gstin || '',
      businessAddress: editingParticipant.businessAddress || '',
      businessEmail: editingParticipant.businessEmail || '',
      businessMobile: editingParticipant.businessMobile || '',
      confirmGstDetails: editingParticipant.confirmGstDetails || false,
      selectedSubCategory: editingParticipant.selectedSubCategory || null,
      agreedRules: !!editingParticipant.agreedRules,
      agreedWaiver: !!editingParticipant.agreedWaiver,
      consentPromotions: !!editingParticipant.consentPromotions,
    };
  }, [editingParticipant]);

  const form = useForm<AdminParticipantEditFormInput>({
    resolver: zodResolver(AdminParticipantEditSchema),
    defaultValues: defaultFormValues
  });

  const dobValue = form.watch("dob");
  const billingType = form.watch("billingType");
  const countryValue = form.watch("country");

  useEffect(() => {
    if (countryValue) {
        const country = COUNTRY_CODES.find(c => c.name.toLowerCase() === countryValue.toLowerCase());
        if (country) setDialCode(country.dial_code);
    }
  }, [countryValue]);

  const tshirtSizeOptions = useMemo(() => {
    if (dobValue) {
      try {
        const age = differenceInYears(new Date(), parseISO(dobValue));
        if (age < 16) return KID_TSHIRT_SIZES;
      } catch (e) {}
    }
    return ADULT_TSHIRT_SIZES;
  }, [dobValue]);

  const handleLocalSubmit = async (data: AdminParticipantEditFormInput) => {
      const normalizedMobile = (data.mobile || '').replace(/\D/g, '');
      const finalData = {
          ...data,
        mobile: normalizedMobile ? `${dialCode}${normalizedMobile}` : ""
      };
      await onSubmitCallback(finalData);
  };

  const handleInvalidSubmit = () => {
    const firstError = Object.values(form.formState.errors)[0] as any;
    const message = firstError?.message || 'Please fix highlighted fields before saving.';
    toast({
      variant: 'destructive',
      title: 'Validation failed',
      description: String(message),
    });
  };

  const idProofType = getIdProofType(editingParticipant?.idProofUrl);
  const proxiedIdProofUrl = editingParticipant?.idProofUrl
    ? `/api/proxy-image?url=${encodeURIComponent(editingParticipant.idProofUrl)}`
    : null;

  return (
    <>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleLocalSubmit, handleInvalidSubmit)} className="space-y-6 flex flex-col flex-1 overflow-hidden">
        <ScrollArea className="flex-1 -mx-2 px-2">
          <div className="space-y-8 py-4 pb-10 text-left">
            <div className="space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 border-b pb-2 text-primary">
                <CreditCard className="h-4 w-4" /> Billing & Category
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="ticketId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ticket Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select ticket" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {eventDetails.ticketDefinitions?.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.ticketName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}/>
                <FormField control={form.control} name="billingType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Type</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} value={field.value || 'personal'} className="flex gap-4">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="personal" id="edit-personal" />
                          <CheckboxLabel htmlFor="edit-personal">Individual</CheckboxLabel>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="business" id="edit-business" />
                          <CheckboxLabel htmlFor="edit-business">Business (B2B)</CheckboxLabel>
                        </div>
                      </RadioGroup>
                    </FormControl>
                  </FormItem>
                )}/>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 border-b pb-2 text-primary">
                <UserCircle className="h-4 w-4" /> Athlete Profile
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>)}/>
                <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email Address</FormLabel><FormControl><Input type="email" {...field} value={field.value ?? ""} /></FormControl></FormItem>)}/>
                
                <div className="space-y-1">
                    <FormLabel>Mobile Number (WhatsApp)</FormLabel>
                    <div className="flex gap-2">
                        <Select value={dialCode} onValueChange={setDialCode}>
                            <SelectTrigger className="w-20 h-10 rounded-xl font-bold bg-muted/20 px-2">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                                {COUNTRY_CODES.map(c => <SelectItem key={c.code} value={c.dial_code}>{c.dial_code}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormField control={form.control} name="mobile" render={({ field }) => (
                            <FormItem className="flex-grow">
                                <FormControl><Input {...field} value={field.value ?? ""} placeholder="9876543210" /></FormControl>
                            </FormItem>
                        )}/>
                    </div>
                </div>

                <FormField control={form.control} name="dob" render={({ field }) => (<FormItem><FormLabel>Date of Birth</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl></FormItem>)}/>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="gender" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {GENDERS.map((g) => (<SelectItem key={g} value={g}>{g}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}/>
                <FormField control={form.control} name="bloodGroup" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blood Group</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select blood group" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {BLOOD_GROUPS.map((bg) => (<SelectItem key={bg} value={bg}>{bg}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="tshirtSize" render={({ field }) => (
                  <FormItem>
                    <FormLabel>T-Shirt Size</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {tshirtSizeOptions.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}/>
              </div>
              <FormField control={form.control} name="ageCategory" render={({ field }) => (
                <FormItem>
                  <FormLabel>Age Group/Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select age category" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(eventDetails.ageCategories || []).map((ac) => (<SelectItem key={ac} value={ac}>{ac}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <FormDescription>Override the automatically calculated age category</FormDescription>
                  <FormMessage />
                </FormItem>
              )}/>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 border-b pb-2 text-primary">
                <MapPin className="h-4 w-4" /> Location & Affiliation
              </h3>
              <FormField control={form.control} name="address" render={({ field }) => (<FormItem className="text-left"><FormLabel>Address</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>)} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="city" render={({ field }) => (<FormItem className="text-left"><FormLabel>City</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>)}/>
                <FormField control={form.control} name="country" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "India"}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
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
                {countryValue === 'India' && (
                  <FormField control={form.control} name="state" render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {INDIAN_STATES.map(s => (<SelectItem key={s.value} value={s.name}>{s.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}/>
                )}
              </div>
              <FormField control={form.control} name="clubId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Club Affiliation</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? NO_CLUB_SELECTED_VALUE}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CLUB_SELECTED_VALUE}>Unaffiliated</SelectItem>
                      {allClubs.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}/>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 border-b pb-2 text-primary">
                <ShieldCheck className="h-4 w-4" /> Admin Controls
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="bibNumber" render={({ field }) => (<FormItem><FormLabel>BIB Number</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>)}/>
                <FormField control={form.control} name="isDeferredFromPune" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deferred from Pune?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "No"}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}/>
                <FormField control={form.control} name="gstPaid" render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST Paid?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "No"}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {GST_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}/>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                <FormField control={form.control} name="agreedRules" render={({ field }) => (<FormItem className="flex items-center gap-2"><FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange}/></FormControl><CheckboxLabel>Agreed to Rules & Regulations</CheckboxLabel></FormItem>)}/>
                <FormField control={form.control} name="agreedWaiver" render={({ field }) => (<FormItem className="flex items-center gap-2"><FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange}/></FormControl><CheckboxLabel>Agreed to Event Waiver</CheckboxLabel></FormItem>)}/>
                <FormField control={form.control} name="consentPromotions" render={({ field }) => (<FormItem className="flex items-center gap-2"><FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange}/></FormControl><CheckboxLabel>Consent to Promotions</CheckboxLabel></FormItem>)}/>
                <FormField control={form.control} name="sendConfirmation" render={({ field }) => (<FormItem className="flex items-center gap-2 pt-2"><FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange}/></FormControl><CheckboxLabel>Send Confirmation Email/WhatsApp</CheckboxLabel></FormItem>)}/>
              </div>

              <div className="space-y-3 border rounded-xl p-3 bg-muted/20">
                <FormLabel>ID Proof</FormLabel>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => onIdProofFileChange(e.target.files?.[0] || null)}
                />
                {editingParticipant?.idProofUrl && (
                  <Button type="button" variant="outline" onClick={() => setIsIdProofModalOpen(true)}>
                    View Current ID Proof
                  </Button>
                )}
              </div>
              </div>
            </div>
          </ScrollArea>
  
            <DialogFooter className="border-t pt-4 flex-shrink-0">
                {form.formState.submitCount > 0 && !form.formState.isValid && (
                  <p className="w-full text-sm text-destructive text-left">
                    Please fix highlighted fields before saving.
                  </p>
                )}
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                  Save Changes
                </Button>
              </DialogFooter>
          </form>
        </Form>

        <Dialog open={isIdProofModalOpen} onOpenChange={setIsIdProofModalOpen}>
          <DialogContent className="max-w-3xl flex flex-col h-[90vh]">
            <DialogHeader>
              <DialogTitle className="text-left font-black uppercase tracking-tight italic">Identity Proof</DialogTitle>
              <DialogDescription className="text-left">
                Uploaded by {editingParticipant?.name}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 flex items-center justify-center p-4 pr-6 border rounded-xl bg-muted/30">
              {editingParticipant?.idProofUrl && (
                idProofType === 'pdf' ? (
                  <iframe
                    src={proxiedIdProofUrl || editingParticipant.idProofUrl}
                    title="Identity Proof PDF"
                    className="w-full h-[68vh] rounded-lg bg-white"
                  />
                ) : idProofType === 'image' ? (
                  <Image
                    src={proxiedIdProofUrl || editingParticipant.idProofUrl}
                    alt="Identity Proof"
                    width={1200}
                    height={1600}
                    unoptimized
                    className="max-w-full h-auto object-contain rounded-lg"
                  />
                ) : (
                  <div className="text-center text-sm text-muted-foreground space-y-2">
                    <p>Preview unavailable for this file type.</p>
                    <a href={editingParticipant.idProofUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                      Open document in new tab
                    </a>
                  </div>
                )
              )}
            </ScrollArea>
            <DialogFooter className="pt-4 border-t gap-2 sm:justify-end">
              {editingParticipant?.idProofUrl && (
                <Button asChild variant="outline" className="rounded-xl font-bold uppercase text-[10px] tracking-widest">
                  <a href={editingParticipant.idProofUrl} target="_blank" rel="noreferrer">Open in New Tab</a>
                </Button>
              )}
              <DialogClose asChild>
                <Button type="button" className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
}
