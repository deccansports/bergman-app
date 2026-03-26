// src/components/admin/SponsorsTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Handshake, PlusCircle, Trash2, Loader2, Edit, Save, Upload } from 'lucide-react';
import type { Sponsor, EventCalendarEntry } from '@/lib/types';
import { addSponsorAction, getSponsorsAction, deleteSponsorAction, updateSponsorOrderAction, updateSponsorAction } from '@/lib/actions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/label';
import { isValidImageUrl } from '@/lib/utils';

interface SponsorsTabProps {
    events: EventCalendarEntry[];
    isLoadingEvents: boolean;
}

export default function SponsorsTab({ events, isLoadingEvents }: SponsorsTabProps) {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  const [newName, setNewName] = useState('');
  const [newWebsite, setNewWebsite] = useState('');
  const [newLogoUrl, setNewLogoUrl] = useState('');
  const [newLogoFile, setNewLogoFile] = useState<File | null>(null);
  const [newOrder, setNewOrder] = useState(0);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSponsors = useCallback(async (eventId: string) => {
    setIsLoading(true);
    const result = await getSponsorsAction(eventId);
    if (result.success && result.sponsors) {
      setSponsors(result.sponsors);
      setNewOrder(result.sponsors.length > 0 ? Math.max(...result.sponsors.map(s => s.order)) + 1 : 1);
    } else {
      setSponsors([]);
    }
    setIsLoading(false);
  }, []);
  
  useEffect(() => {
    if (selectedEventId) fetchSponsors(selectedEventId);
    else setSponsors([]);
  }, [selectedEventId, fetchSponsors]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { 
        toast({ variant: 'destructive', title: 'File too large' });
        return;
      }
      setNewLogoFile(file);
      setNewLogoUrl('');
    }
  };

  const handleAddSponsor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !firebaseUserFromAuth) return;
    
    setIsSubmitting(true);
    let finalLogoUrl = newLogoUrl;

    if (newLogoFile) {
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', newLogoFile);
        formData.append('eventId', selectedEventId);
        try {
            const token = await firebaseUserFromAuth.getIdToken();
            const response = await fetch('/api/admin/upload-sponsor-logo', { 
                method: 'POST', 
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData 
            });
            const result = await response.json();
            if (response.ok && result.success) finalLogoUrl = result.downloadURL;
        } catch (_uploadError: any) {
            toast({ variant: 'destructive', title: 'Upload Failed' });
            setIsSubmitting(false); setIsUploading(false); return;
        }
        setIsUploading(false);
    }

    const result = await addSponsorAction(selectedEventId, { name: newName, logoUrl: finalLogoUrl, order: newOrder, website: newWebsite, eventId: selectedEventId });
    if (result.success) {
        fetchSponsors(selectedEventId);
        setNewName(''); setNewLogoUrl(''); setNewLogoFile(null); setNewWebsite('');
    }
    setIsSubmitting(false);
  };
  
  const handleDeleteSponsor = async (id: string) => {
    if (!selectedEventId) return;
    setIsDeleting(id);
    const result = await deleteSponsorAction(selectedEventId, id);
    if(result.success) await fetchSponsors(selectedEventId);
    setIsDeleting(null);
  };

  const handleUpdateSponsor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSponsor || !selectedEventId) return;
    setIsSubmitting(true);
    const result = await updateSponsorAction(selectedEventId, editingSponsor.id, editingSponsor);
    if (result.success) {
      setEditingSponsor(null);
      fetchSponsors(selectedEventId);
    }
    setIsSubmitting(false);
  };
  
  const handleOrderChange = (id: string, order: number) => {
    setSponsors(sponsors.map(s => s.id === id ? { ...s, order } : s));
  };
  
  const handleSaveOrder = async () => {
    if (!selectedEventId) return;
    setIsSubmitting(true);
    const orderToSave = sponsors.map(s => ({ id: s.id, order: s.order }));
    const result = await updateSponsorOrderAction(selectedEventId, orderToSave);
    if (result.success) fetchSponsors(selectedEventId);
    setIsSubmitting(false);
  };


  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Handshake className="h-5 w-5 text-primary" /> Sponsor Management</CardTitle>
        <CardDescription>Add, reorder, and remove sponsors for an event.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-left">
        <div className="space-y-2">
          <Label>Select Event</Label>
          <Select onValueChange={setSelectedEventId} disabled={isLoadingEvents}>
              <SelectTrigger className="w-full md:w-1/2">
                  <SelectValue placeholder="Select an event..." />
              </SelectTrigger>
              <SelectContent>
                  {(events || []).map(e => <SelectItem key={e.id} value={e.id}>{e.eventName}</SelectItem>)}
              </SelectContent>
          </Select>
        </div>

        {selectedEventId && (
            <div className="space-y-4 pt-4 border-t">
              <form onSubmit={handleAddSponsor} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                  <div className="space-y-1"><Label className="text-xs uppercase font-bold text-muted-foreground">Sponsor Name</Label><Input placeholder="Sponsor Name" value={newName} onChange={e => setNewName(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs uppercase font-bold text-muted-foreground">Website URL</Label><Input placeholder="Sponsor Website URL" value={newWebsite} onChange={e => setNewWebsite(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs uppercase font-bold text-muted-foreground">Logo URL</Label><Input placeholder="Or Logo URL" value={newLogoUrl} onChange={e => { setNewLogoUrl(e.target.value); setNewLogoFile(null); }} /></div>
                  <div className="space-y-1"><Label className="text-xs uppercase font-bold text-muted-foreground">Upload Logo</Label><Input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" /></div>
                  <Button type="submit" disabled={isSubmitting}>
                    {isUploading ? <Loader2 className="animate-spin h-4 w-4"/> : isSubmitting ? <Loader2 className="animate-spin h-4 w-4"/> : <PlusCircle className="mr-2 h-4 w-4"/>} 
                    {isUploading ? 'Uploading...' : 'Add Sponsor'}
                  </Button>
              </form>

              <div className="rounded-md border max-h-[60vh] overflow-auto">
                  <Table>
                      <TableHeader><TableRow><TableHead>Logo</TableHead><TableHead>Name</TableHead><TableHead>Order</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                      <TableBody>
                      {isLoading ? (
                        <TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary"/></TableCell></TableRow>
                      ) : sponsors.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No sponsors found.</TableCell></TableRow>
                      ) : (
                        sponsors.map((sponsor) => (
                            <TableRow key={sponsor.id}>
                              <TableCell>{isValidImageUrl(sponsor.logoUrl) ? <div className="relative h-10 w-20"><Image src={sponsor.logoUrl} alt={sponsor.name} fill sizes="80px" className="object-contain bg-gray-200 p-1 rounded-md" /></div> : <div className="h-10 w-20 bg-gray-200 rounded-md flex items-center justify-center text-[10px]">No Logo</div>}</TableCell>
                              <TableCell className="font-medium">{sponsor.name}</TableCell>
                              <TableCell><Input type="number" value={sponsor.order} onChange={(e) => handleOrderChange(sponsor.id, Number(e.target.value))} className="w-20"/></TableCell>
                              <TableCell className="text-right space-x-1">
                                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setEditingSponsor(sponsor)}><Edit className="h-4 w-4"/></Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><Button variant="destructive" size="icon" className="h-8 w-8" disabled={isDeleting === sponsor.id}><Trash2 className="h-4 w-4"/></Button></AlertDialogTrigger>
                                    <AlertDialogContent className="text-left"><AlertDialogHeader className="text-left"><AlertDialogTitle className="text-left">Delete {sponsor.name}?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter className="text-left"><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteSponsor(sponsor.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
              </div>
              <div className="flex justify-end"><Button onClick={handleSaveOrder} disabled={isSubmitting}>Save Order</Button></div>
            </div>
        )}
      </CardContent>
    </Card>
      <Dialog open={!!editingSponsor} onOpenChange={(open) => !open && setEditingSponsor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Sponsor</DialogTitle></DialogHeader>
          {editingSponsor && (
            <form onSubmit={handleUpdateSponsor} className="space-y-4 py-4 text-left">
              <div className="space-y-2 text-left"><Label htmlFor="edit-name">Sponsor Name</Label><Input id="edit-name" value={editingSponsor.name} onChange={(e) => setEditingSponsor((s: Sponsor | null) => s ? ({...s, name: e.target.value}) : null)} /></div>
              <div className="space-y-2 text-left"><Label htmlFor="edit-type">Sponsor Type</Label><Input id="edit-type" value={editingSponsor.type || ''} onChange={(e) => setEditingSponsor((s: Sponsor | null) => s ? ({...s, type: e.target.value}) : null)} /></div>
              <div className="space-y-2 text-left"><Label htmlFor="edit-website">Website URL</Label><Input id="edit-website" value={editingSponsor.website || ''} onChange={(e) => setEditingSponsor((s: Sponsor | null) => s ? ({...s, website: e.target.value}) : null)} /></div>
              <div className="space-y-2 text-left"><Label htmlFor="edit-logo">Logo URL</Label><Input id="edit-logo" value={editingSponsor.logoUrl} onChange={(e) => setEditingSponsor((s: Sponsor | null) => s ? ({...s, logoUrl: e.target.value}) : null)} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setEditingSponsor(null)}>Cancel</Button><Button type="submit" disabled={isSubmitting}>Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
