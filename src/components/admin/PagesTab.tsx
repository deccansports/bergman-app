// src/components/admin/PagesTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { FileText, PlusCircle, ArrowUp, ArrowDown, Trash2, Save, ExternalLink, Video, Home, Link as LinkIcon, Loader2, Edit, LogIn, Calendar } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { getPagesAction, savePagesAction, getHomepageSliderItemsAction, saveHomepageSliderItemsAction, getFooterConfigAction, saveFooterConfigAction } from '@/lib/actions/pageActions';
import { updateCalendarEventAction } from '@/lib/actions';
import type { Page, ContentBlock, HomepageSliderItem, EventCalendarEntry, FooterConfig } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Instagram, Facebook, Twitter, Youtube } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { format, isBefore, parseISO, startOfDay } from 'date-fns';
import { cn, isTicketHidden, isValidImageUrl } from '@/lib/utils';
import { storage as firebaseClientStorage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';


interface PagesTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

const FOOTER_CATEGORY_OPTIONS = [
    'Information',
    'Explore',
    'Races',
    'News',
    'Community',
    'Support',
];

function SitePagesManager({ onDataRefresh }: { onDataRefresh: () => void }) {
    const [pages, setPages] = useState<Page[]>([]);
    const [isLoadingPages, setIsLoadingPages] = useState(true);
    const [selectedPage, setSelectedPage] = useState<Page | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    const fetchPages = useCallback(async () => {
        setIsLoadingPages(true);
        const result = await getPagesAction();
        if (result.success && result.pages) {
            setPages(result.pages);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: "Could not load site pages." });
        }
        setIsLoadingPages(false);
    }, [toast]);

    useEffect(() => {
        fetchPages();
    }, [fetchPages]);

    const handlePageBlockChange = (blockId: string, html: string) => {
        if (!selectedPage) return;
        const updatedBlocks = selectedPage.blocks.map(b => b.id === blockId ? { ...b, html } : b);
        setSelectedPage(prev => prev ? { ...prev, blocks: updatedBlocks } : null);
    };

    const handleAddPageBlock = () => {
        if (!selectedPage) return;
        const newBlock = { id: `b${Date.now()}`, html: '<p>New content...</p>' };
        setSelectedPage(prev => prev ? { ...prev, blocks: [...(prev.blocks || []), newBlock] } : null);
    };

    const handleRemovePageBlock = (blockId: string) => {
        if (!selectedPage) return;
        setSelectedPage(prev => prev ? { ...prev, blocks: prev.blocks.filter(b => b.id !== blockId) } : null);
    };
    
    const handleMovePageBlock = (index: number, direction: 'up' | 'down') => {
        if (!selectedPage?.blocks) return;
        const currentBlocks = selectedPage.blocks;
        if ((direction === 'up' && index === 0) || (direction === 'down' && index === currentBlocks.length - 1)) return;
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        const newBlocks = [...currentBlocks];
        const temp = newBlocks[index];
        newBlocks[index] = newBlocks[newIndex];
        newBlocks[newIndex] = temp;
        setSelectedPage(prev => prev ? { ...prev, blocks: newBlocks } : null);
    };

    const handleSelectPage = (page: Page | null) => {
        setSelectedPage(page ? { ...page } : null);
    };

    const handleCreatePage = () => {
        const newPage: Page = {
            id: `p${Date.now()}`,
            title: "New Page",
            slug: "new-page",
            published: false,
            requiresLogin: false,
            showInHeader: true,
            showInFooter: false,
            footerCategory: 'Explore',
            blocks: [{ id: `b${Date.now()}`, html: "<p>Start writing here...</p>" }],
            url: null,
            eventId: null,
        };
        setSelectedPage(newPage);
    };

    const handleUpdatePageDetails = (field: keyof Page, value: string | boolean | null) => {
        if (!selectedPage) return;
        setSelectedPage(prev => prev ? { ...prev, [field]: value } : null);
    };
    
    const handlePathChange = (value: string) => {
        if (!selectedPage) return;
        const cleanedValue = value.trim();
        if (cleanedValue.startsWith('http') || cleanedValue.startsWith('/')) {
            handleUpdatePageDetails('url', cleanedValue);
            handleUpdatePageDetails('slug', ''); 
        } else {
            handleUpdatePageDetails('slug', cleanedValue.replace(/[^a-z0-9-]/g, ''));
            handleUpdatePageDetails('url', null);
        }
    };
    
    const handleSavePage = async () => {
        if (!selectedPage) return;
        setIsSaving(true);
        const normalizedPage: Page = {
            ...selectedPage,
            url:
                selectedPage.title.trim().toLowerCase() === 'work with team bergman' &&
                (!selectedPage.url || selectedPage.url === selectedPage.slug)
                    ? '/work-with-bergman'
                    : selectedPage.url,
        };

        const isNewPage = !pages.some(p => p.id === selectedPage.id);
        const newPagesArray = isNewPage ? [...pages, normalizedPage] : pages.map(p => p.id === selectedPage.id ? normalizedPage : p);
        
        const result = await savePagesAction(newPagesArray);
        if (result.success) {
            toast({ title: 'Page Saved', description: `Changes to "${selectedPage.title}" have been saved.` });
            setPages(newPagesArray);
            onDataRefresh();
            setSelectedPage(null);
        } else {
            toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
        }
        setIsSaving(false);
    };

    const handleDeletePage = async (pageId: string) => {
        const newPagesArray = pages.filter(p => p.id !== pageId);
        setIsSaving(true);
        const result = await savePagesAction(newPagesArray);
        if (result.success) {
            toast({ title: 'Page Deleted' });
            setPages(newPagesArray);
            onDataRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Delete Failed', description: result.message });
        }
        setIsSaving(false);
    };
    
    const handleMovePage = (index: number, direction: 'up' | 'down') => {
        const newPages = [...pages];
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= newPages.length) return;
        const temp = newPages[index];
        newPages[index] = newPages[newIndex];
        newPages[newIndex] = temp;
        setPages(newPages);
    };
    
    const handleSaveOrder = async () => {
        setIsSaving(true);
        const result = await savePagesAction(pages);
        if (result.success) {
            toast({ title: 'Order Saved', description: 'Page order has been updated.' });
            fetchPages();
            onDataRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Save Failed', description: result.message });
        }
        setIsSaving(false);
    };

    if (selectedPage) {
        return (
            <div className="space-y-4">
                <Button variant="outline" onClick={() => setSelectedPage(null)}>← Back to All Pages</Button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Page Title</label>
                    <Input value={selectedPage.title} onChange={e => handleUpdatePageDetails('title', e.target.value)} disabled={isSaving}/>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Page Path (e.g., &apos;about&apos; or &apos;/races&apos;)</label>
                    <Input 
                      value={selectedPage.url || selectedPage.slug} 
                      onChange={e => handlePathChange(e.target.value)}
                      disabled={isSaving}
                    />
                  </div>
                                    <div>
                                        <label className="text-sm font-medium">Footer Category</label>
                                        <Select value={selectedPage.footerCategory || 'Explore'} onValueChange={(value) => handleUpdatePageDetails('footerCategory', value)} disabled={isSaving}>
                                                <SelectTrigger>
                                                        <SelectValue placeholder="Select footer category" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                        {FOOTER_CATEGORY_OPTIONS.map((category) => (
                                                                <SelectItem key={category} value={category}>{category}</SelectItem>
                                                        ))}
                                                </SelectContent>
                                        </Select>
                                    </div>
                </div>
                <div className="flex items-center space-x-4 pt-2">
                  <div className="flex items-center space-x-2">
                    <Switch id="pagePublished" checked={selectedPage.published} onCheckedChange={(checked) => handleUpdatePageDetails('published', checked)} disabled={isSaving}/>
                    <label htmlFor="pagePublished">{selectedPage.published ? 'Published' : 'Draft'}</label>
                  </div>
                                    <div className="flex items-center space-x-2">
                                        <Switch id="requiresLogin" checked={!!selectedPage.requiresLogin} onCheckedChange={(checked) => handleUpdatePageDetails('requiresLogin', checked)} disabled={isSaving}/>
                                        <label htmlFor="requiresLogin" className="inline-flex items-center gap-1.5"><LogIn className="h-4 w-4" /> Requires Login</label>
                                    </div>
                   <div className="flex items-center space-x-2">
                    <Switch id="showInHeader" checked={selectedPage.showInHeader} onCheckedChange={(checked) => handleUpdatePageDetails('showInHeader', checked)} disabled={isSaving}/>
                    <label htmlFor="showInHeader">Show in Header</label>
                  </div>
                                    <div className="flex items-center space-x-2">
                                        <Switch id="showInFooter" checked={!!selectedPage.showInFooter} onCheckedChange={(checked) => handleUpdatePageDetails('showInFooter', checked)} disabled={isSaving}/>
                                        <label htmlFor="showInFooter">Show in Footer</label>
                                    </div>
                </div>

                <div className="space-y-3 pt-4 border-t">
                    <div className="flex justify-between items-center">
                        <h4 className="font-semibold">Page Content Blocks</h4>
                        <Button size="sm" variant="outline" onClick={handleAddPageBlock} disabled={isSaving}><PlusCircle className="h-4 w-4 mr-2"/>Add Block</Button>
                    </div>
                    {(selectedPage.blocks || []).map((block, index) => (
                      <div key={block.id} className="p-3 border rounded-lg bg-muted/50 space-y-2">
                         <Textarea
                           value={block.html}
                           onChange={(e) => handlePageBlockChange(block.id, e.target.value)}
                           rows={8}
                           className="bg-background font-mono text-xs"
                           disabled={isSaving}
                         />
                         <div className="flex justify-end gap-1">
                           <Button size="icon" variant="ghost" type="button" onClick={() => handleMovePageBlock(index, 'up')} disabled={index === 0 || isSaving}><ArrowUp className="h-4 w-4"/></Button>
                           <Button size="icon" variant="ghost" type="button" onClick={() => handleMovePageBlock(index, 'down')} disabled={index === (selectedPage.blocks?.length || 0) - 1 || isSaving}><ArrowDown className="h-4 w-4"/></Button>
                           <Button size="icon" variant="ghost" className="text-destructive" type="button" onClick={() => handleRemovePageBlock(block.id)} disabled={isSaving}><Trash2 className="h-4 w-4"/></Button>
                         </div>
                      </div>
                    ))}
                </div>
                
                <div className="flex justify-end mt-4">
                    <Button onClick={handleSavePage} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="h-4 w-4 mr-2"/>}
                        Save Page
                    </Button>
                </div>
            </div>
        );
    }
    
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <h3 className="text-lg font-semibold">Site Pages</h3>
                <div className="flex gap-2">
                    <Button onClick={handleSaveOrder} size="sm" variant="outline" disabled={isSaving || isLoadingPages}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                        Save Order
                    </Button>
                    <Button onClick={handleCreatePage} size="sm"><PlusCircle className="mr-2 h-4 w-4" /> Create Page</Button>
                </div>
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Path</TableHead><TableHead>Status</TableHead><TableHead>Access</TableHead><TableHead>Placement</TableHead><TableHead>Footer Category</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {isLoadingPages ? (
                           <TableRow><TableCell colSpan={7} className="text-center"><Loader2 className="animate-spin my-4" /></TableCell></TableRow>
                        ) : pages.map((page, index) => (
                            <TableRow key={page.id}>
                                <TableCell className="font-medium flex items-center gap-2">{page.title}{page.url && page.url.startsWith('http') && <ExternalLink className="h-4 w-4 text-muted-foreground" />}</TableCell>
                                <TableCell className="text-muted-foreground font-mono text-xs">{page.url || `/content/${page.slug}`}</TableCell>
                                <TableCell>
                                    <Badge variant={page.published ? 'default' : 'secondary'}>{page.published ? 'Published' : 'Draft'}</Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={page.requiresLogin ? 'secondary' : 'outline'}>{page.requiresLogin ? 'Login Required' : 'Public'}</Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {page.showInHeader && <Badge variant="outline">Header</Badge>}
                                        {!!page.showInFooter && <Badge variant="outline">Footer</Badge>}
                                        {!page.showInHeader && !page.showInFooter && <Badge variant="secondary">Hidden from nav</Badge>}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="secondary">{page.footerCategory || 'Explore'}</Badge>
                                </TableCell>
                                <td className="p-3 text-right space-x-1">
                                    <Button size="icon" variant="ghost" onClick={() => handleMovePage(index, 'up')} disabled={index === 0 || isSaving}>
                                        <ArrowUp className="h-4 w-4"/>
                                    </Button>
                                    <Button size="icon" variant="ghost" onClick={() => handleMovePage(index, 'down')} disabled={index === pages.length - 1 || isSaving}>
                                        <ArrowDown className="h-4 w-4"/>
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => handleSelectPage(page)}>Edit</Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSaving}>Delete</Button></AlertDialogTrigger>
                                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Page: {page.title}?</AlertDialogTitle><AlertDialogDescription>This action is permanent and cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeletePage(page.id)} className="bg-destructive hover:bg-destructive/90">Confirm Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                    </AlertDialog>
                                </td>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

function EventContentManager({ events, isLoadingEvents, onDataRefresh }: PagesTabProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const selectedEvent = useMemo(() => events.find(e => e.id === selectedEventId), [events, selectedEventId]);

  useEffect(() => {
    if (selectedEvent) {
      setBlocks(selectedEvent.blocks || []);
    } else {
      setBlocks([]);
    }
  }, [selectedEvent]);

  const handleBlockChange = (blockId: string, html: string) => {
    setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, html } : b)));
  };

  const handleAddBlock = () => {
    setBlocks(prev => [...prev, { id: `b${Date.now()}`, html: '<p>New event content...</p>' }]);
  };

  const handleRemoveBlock = (blockId: string) => {
    setBlocks(prev => prev.filter(b => b.id !== blockId));
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === blocks.length - 1)) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const newBlocks = [...blocks];
    [newBlocks[index], newBlocks[newIndex]] = [newBlocks[newIndex], newBlocks[index]]; // Swap
    setBlocks(newBlocks);
  };

  const handleSaveBlocks = async () => {
    if (!selectedEvent) return;
    setIsSaving(true);
    const result = await updateCalendarEventAction(selectedEvent.id, { blocks });
    if (result.success) {
      toast({ title: 'Success', description: 'Event content updated.' });
      onDataRefresh();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };

  return (
    <div className="space-y-4">
      <Select
        onValueChange={(eventId) => setSelectedEventId(eventId)}
        disabled={isLoadingEvents}
        value={selectedEventId || ''}
      >
        <SelectTrigger className="w-full md:w-1/2">
          <SelectValue placeholder="Select an event to edit its page content..." />
        </SelectTrigger>
        <SelectContent>
          {events.map(event => (
            <SelectItem key={event.id} value={event.id}>{event.eventName}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedEvent && (
        <div className="pt-4 border-t">
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-semibold">Content Blocks for {selectedEvent.eventName}</h4>
            <Button size="sm" variant="outline" onClick={handleAddBlock} disabled={isSaving}>
              <PlusCircle className="h-4 w-4 mr-2" />Add Block
            </Button>
          </div>
          <div className="space-y-3">
            {blocks.map((block, index) => (
              <div key={block.id} className="p-3 border rounded-lg bg-muted/50 space-y-2">
                <Textarea
                  value={block.html}
                  onChange={(e) => handleBlockChange(block.id, e.target.value)}
                  rows={8}
                  className="bg-background font-mono text-xs"
                  disabled={isSaving}
                />
                 <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" type="button" onClick={() => handleMoveBlock(index, 'up')} disabled={index === 0 || isSaving}><ArrowUp className="h-4 w-4"/></Button>
                  <Button size="icon" variant="ghost" type="button" onClick={() => handleMoveBlock(index, 'down')} disabled={index === blocks.length - 1 || isSaving}><ArrowDown className="h-4 w-4"/></Button>
                  <Button size="icon" variant="ghost" className="text-destructive" type="button" onClick={() => handleRemoveBlock(block.id)} disabled={isSaving}><Trash2 className="h-4 w-4"/></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleSaveBlocks} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Content for {selectedEvent.eventName}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HomepageSliderManager({ events, isLoadingEvents, onDataRefresh }: PagesTabProps) {
    const [allItems, setAllItems] = useState<HomepageSliderItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<HomepageSliderItem | null>(null);
    const { toast } = useToast();

    const fetchItems = useCallback(async () => {
        setIsLoading(true);
        const result = await getHomepageSliderItemsAction();
        if (result.success && result.items) {
            setAllItems(result.items);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const homepageItems = useMemo(() => 
        allItems.filter(item => item.pageSlug !== 'login' && item.showOnHomepage !== false), 
    [allItems]);

    const handleSave = async () => {
        setIsSaving(true);
        const result = await saveHomepageSliderItemsAction(allItems);
        if (result.success) {
            toast({ title: "Success", description: "Slider items saved." });
        } else {
            toast({ variant: "destructive", title: "Error", description: result.message });
        }
        setIsSaving(false);
    };

    const handleMoveItem = (indexInFiltered: number, direction: 'up' | 'down') => {
        const itemToMove = homepageItems[indexInFiltered];
        const newIndexInFiltered = direction === 'up' ? indexInFiltered - 1 : indexInFiltered + 1;
        if (newIndexInFiltered < 0 || newIndexInFiltered >= homepageItems.length) return;
        
        const otherItem = homepageItems[newIndexInFiltered];
        
        // Swap in full list
        const updatedAllItems = allItems.map(it => {
            if (it.id === itemToMove.id) return otherItem;
            if (it.id === otherItem.id) return itemToMove;
            return it;
        });
        
        setAllItems(updatedAllItems);
    };

    const handleDeleteItem = (id: string) => {
        setAllItems(prev => prev.filter(item => item.id !== id));
    };

    const handleEditItem = (item: HomepageSliderItem) => {
        setEditingItem(item);
        setIsModalOpen(true);
    };

    const handleAddItem = () => {
        setEditingItem({
            id: `item${Date.now()}`,
            type: 'image',
            src: '',
            alt: '',
            customUrl: null,
            header: null,
            description: null,
            customLinkText: null,
            showOnHomepage: true,
        });
        setIsModalOpen(true);
    };

    const handleSaveItem = (itemData: HomepageSliderItem) => {
        const existing = allItems.find(i => i.id === itemData.id);
        if (existing) {
            setAllItems(prev => prev.map(i => i.id === itemData.id ? itemData : i));
        } else {
            setAllItems(prev => [...prev, itemData]);
        }
        setIsModalOpen(false);
        setEditingItem(null);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Homepage Slider</CardTitle>
                    <CardDescription>Manage media for the homepage hero section.</CardDescription>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleSave} disabled={isSaving || isLoading} size="sm">{isSaving ? <Loader2 className="animate-spin mr-2"/> : <Save className="mr-2 h-4 w-4"/>}Save Changes</Button>
                    <Button onClick={handleAddItem} size="sm"><PlusCircle className="mr-2 h-4 w-4"/>Add Item</Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Preview</TableHead><TableHead>Type</TableHead><TableHead>Source (URL)</TableHead><TableHead>Linked To</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center"><Loader2 className="h-6 w-6 animate-spin"/></TableCell></TableRow>
                            : homepageItems.map((item, index) => {
                                const validSrc = isValidImageUrl(item.src) ? item.src : null;
                                return (
                                    <TableRow key={item.id}>
                                        <TableCell className="space-x-1">
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMoveItem(index, 'up')} disabled={index === 0}><ArrowUp className="h-4 w-4"/></Button>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMoveItem(index, 'down')} disabled={index === homepageItems.length - 1}><ArrowDown className="h-4 w-4"/></Button>
                                        </TableCell>
                                        <TableCell>{item.type === 'image' && validSrc ? <Image src={validSrc} alt={item.alt} width={80} height={45} className="object-cover rounded-md"/> : <Video className="h-8 w-8 text-muted-foreground"/>}</TableCell>
                                        <TableCell><Badge variant="secondary">{item.type}</Badge></TableCell>
                                        <TableCell className="text-xs font-mono max-w-xs truncate">{item.src}</TableCell>
                                        <TableCell className="text-xs">
                                            {item.customUrl ? (
                                                <Badge variant="outline" className="break-all">Custom URL</Badge>
                                            ) : item.eventId ? (
                                                <Badge variant="secondary">Event: {events.find(e => e.id === item.eventId)?.eventName || 'N/A'}</Badge>
                                            ) : item.pageSlug ? (
                                                <Badge variant="outline">{item.pageSlug}</Badge>
                                            ) : (
                                                <Badge>Homepage</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" onClick={() => handleEditItem(item)}><Edit className="h-4 w-4 mr-2"/>Edit</Button>
                                            <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4 mr-2"/>Delete</Button></AlertDialogTrigger>
                                                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Slider Item?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteItem(item.id)}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
                 {editingItem && (
                    <SliderItemModal
                        isOpen={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                        item={editingItem}
                        onSave={handleSaveItem}
                        events={events}
                    />
                )}
            </CardContent>
        </Card>
    );
}

interface SliderItemModalProps {
    isOpen: boolean; onClose: () => void; item: HomepageSliderItem; onSave: (item: HomepageSliderItem) => void; events: EventCalendarEntry[];
}

function SliderItemModal({ isOpen, onClose, item, onSave, events }: SliderItemModalProps) {
    const [currentItem, setCurrentItem] = useState(item);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isUploadingMobileImage, setIsUploadingMobileImage] = useState(false);
    const [isDraggingImage, setIsDraggingImage] = useState(false);
    const [isDraggingMobileImage, setIsDraggingMobileImage] = useState(false);
    const [activeGestureTarget, setActiveGestureTarget] = useState<'desktop' | 'mobile' | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const mobileFileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const { toast } = useToast();
    const gestureRef = useRef<{
        target: 'desktop' | 'mobile' | null;
        pointers: Map<number, { x: number; y: number }>;
        lastDistance: number | null;
    }>({ target: null, pointers: new Map(), lastDistance: null });

    const desktopFocusX = currentItem.desktopFocusX ?? 50;
    const desktopFocusY = currentItem.desktopFocusY ?? 50;
    const desktopZoom = currentItem.desktopZoom ?? 1;
    const mobileFocusX = currentItem.mobileFocusX ?? desktopFocusX;
    const mobileFocusY = currentItem.mobileFocusY ?? desktopFocusY;
    const mobileZoom = currentItem.mobileZoom ?? 1;
    const previewEvent = useMemo(
        () => (currentItem.eventId ? events.find((event) => event.id === currentItem.eventId) || null : null),
        [events, currentItem.eventId]
    );
    const previewTitle = previewEvent?.eventName || currentItem.header || 'Hero title';
    const previewDescription = previewEvent?.description || currentItem.description || 'Hero description text appears here.';
    const previewDateText = previewEvent?.eventDate && previewEvent.eventDate !== 'TBD'
        ? format(parseISO(previewEvent.eventDate), 'dd MMM yyyy')
        : 'Date TBD';
    const previewRegisterLink = previewEvent
        ? (previewEvent.customSlug ? `/event-form/${previewEvent.customSlug}` : previewEvent.registrationUrl || '#')
        : (currentItem.customUrl || '#');
    const previewDetailsLink = previewEvent
        ? `/races/${previewEvent.customSlug ? previewEvent.customSlug : previewEvent.id}`
        : (currentItem.customUrl || '#');
    const previewWaitlistLink = previewEvent
        ? `/waitlist/${previewEvent.customSlug || String(previewEvent.eventName || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`
        : (currentItem.customUrl || '#');
    const previewHasSoldOutTickets = !!previewEvent && (previewEvent.ticketDefinitions || []).some((ticket: any) => {
        const maybeDeleted = (ticket as any)?.isDeleted || !!(ticket as any)?.deletedAt;
        return !maybeDeleted && !isTicketHidden(ticket) && ticket.isSoldOut === true;
    });

    const upcomingEvents = useMemo(() => {
        const today = startOfDay(new Date());
        return events.filter(event => {
            if (!event.eventDate) return true; // Keep TBD
            try { return !isBefore(parseISO(event.eventDate), today); } 
            catch { return false; }
        });
    }, [events]);

    useEffect(() => {
        setCurrentItem(item);
        setUploadError(null);
        setIsDraggingImage(false);
    }, [item]);

    const uploadImageFile = useCallback(async (file: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setUploadError('Only image files are supported.');
            toast({ variant: 'destructive', title: 'Invalid file', description: 'Please upload an image file.' });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError('Image must be 5MB or less.');
            toast({ variant: 'destructive', title: 'File too large', description: 'Image must be 5MB or less.' });
            return;
        }
        if (!firebaseClientStorage) {
            setUploadError('Firebase Storage is not configured.');
            toast({ variant: 'destructive', title: 'Upload unavailable', description: 'Firebase Storage is not configured.' });
            return;
        }

        setIsUploadingImage(true);
        setUploadError(null);
        try {
            const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
            const path = `homepage-slider/${currentItem.id || 'item'}/${Date.now()}-${safeName}`;
            const storageRef = ref(firebaseClientStorage, path);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            setCurrentItem((prev) => ({ ...prev, type: 'image', src: downloadURL }));
            toast({ title: 'Image uploaded', description: 'The slider image has been uploaded successfully.' });
        } catch (error: any) {
            console.error('Homepage slider image upload failed:', error);
            setUploadError(error?.message || 'Failed to upload image.');
            toast({ variant: 'destructive', title: 'Upload failed', description: error?.message || 'Failed to upload image.' });
        } finally {
            setIsUploadingImage(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [currentItem.id, toast]);

    const uploadMobileImageFile = useCallback(async (file: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setUploadError('Only image files are supported.');
            toast({ variant: 'destructive', title: 'Invalid file', description: 'Please upload an image file.' });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError('Image must be 5MB or less.');
            toast({ variant: 'destructive', title: 'File too large', description: 'Image must be 5MB or less.' });
            return;
        }
        if (!firebaseClientStorage) {
            setUploadError('Firebase Storage is not configured.');
            toast({ variant: 'destructive', title: 'Upload unavailable', description: 'Firebase Storage is not configured.' });
            return;
        }

        setIsUploadingMobileImage(true);
        setUploadError(null);
        try {
            const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
            const path = `homepage-slider/${currentItem.id || 'item'}/mobile-${Date.now()}-${safeName}`;
            const storageRef = ref(firebaseClientStorage, path);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            setCurrentItem((prev) => ({ ...prev, mobileSrc: downloadURL }));
            toast({ title: 'Mobile image uploaded', description: 'The mobile banner image has been uploaded successfully.' });
        } catch (error: any) {
            console.error('Homepage slider mobile image upload failed:', error);
            setUploadError(error?.message || 'Failed to upload image.');
            toast({ variant: 'destructive', title: 'Upload failed', description: error?.message || 'Failed to upload image.' });
        } finally {
            setIsUploadingMobileImage(false);
            if (mobileFileInputRef.current) mobileFileInputRef.current.value = '';
        }
    }, [currentItem.id, toast]);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void uploadImageFile(file);
    };

    const handleMobileFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void uploadMobileImageFile(file);
    };

    const handleUploadDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingImage(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void uploadImageFile(file);
    };

    const handleMobileUploadDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingMobileImage(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void uploadMobileImageFile(file);
    };

        const updateFocus = (target: 'desktop' | 'mobile', clientX: number, clientY: number, rect: DOMRect) => {
                const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
                setCurrentItem(prev => target === 'desktop'
                    ? { ...prev, desktopFocusX: x, desktopFocusY: y }
                    : { ...prev, mobileFocusX: x, mobileFocusY: y }
                );
        };

        const updateZoom = (target: 'desktop' | 'mobile', value: number) => {
                setCurrentItem(prev => target === 'desktop'
                    ? { ...prev, desktopZoom: value }
                    : { ...prev, mobileZoom: value }
                );
        };

        const resetControls = (target: 'desktop' | 'mobile') => {
            setCurrentItem(prev => target === 'desktop'
              ? { ...prev, desktopFocusX: 50, desktopFocusY: 50, desktopZoom: 1 }
              : { ...prev, mobileFocusX: 50, mobileFocusY: 50, mobileZoom: 1 }
            );
        };

        const getZoomForTarget = (target: 'desktop' | 'mobile') =>
            target === 'desktop' ? (currentItem.desktopZoom ?? 1) : (currentItem.mobileZoom ?? 1);

        const getFocusForTarget = (target: 'desktop' | 'mobile') => ({
            x: target === 'desktop' ? (currentItem.desktopFocusX ?? 50) : (currentItem.mobileFocusX ?? 50),
            y: target === 'desktop' ? (currentItem.desktopFocusY ?? 50) : (currentItem.mobileFocusY ?? 50),
        });

        const updateFocusForTarget = (target: 'desktop' | 'mobile', x: number, y: number) => {
            setCurrentItem(prev => target === 'desktop'
                ? { ...prev, desktopFocusX: x, desktopFocusY: y }
                : { ...prev, mobileFocusX: x, mobileFocusY: y }
            );
        };

        const handlePreviewPointerDown = (
            target: 'desktop' | 'mobile',
            e: React.PointerEvent<HTMLDivElement>
        ) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            gestureRef.current.target = target;
            gestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            setActiveGestureTarget(target);

            if (gestureRef.current.pointers.size === 2) {
                const points = Array.from(gestureRef.current.pointers.values());
                gestureRef.current.lastDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            }
        };

        const handlePreviewPointerMove = (
            target: 'desktop' | 'mobile',
            e: React.PointerEvent<HTMLDivElement>
        ) => {
            if (gestureRef.current.target !== target) return;
            if (!gestureRef.current.pointers.has(e.pointerId)) return;

            gestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            const points = Array.from(gestureRef.current.pointers.values());
            const rect = e.currentTarget.getBoundingClientRect();

            if (gestureRef.current.pointers.size >= 2) {
                const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                const centerX = (points[0].x + points[1].x) / 2;
                const centerY = (points[0].y + points[1].y) / 2;

                if (gestureRef.current.lastDistance) {
                    const ratio = distance / gestureRef.current.lastDistance;
                    const nextZoom = Math.min(1.8, Math.max(1, getZoomForTarget(target) * ratio));
                    updateZoom(target, nextZoom);
                }

                gestureRef.current.lastDistance = distance;
                updateFocusForTarget(
                    target,
                    Math.max(0, Math.min(100, ((centerX - rect.left) / rect.width) * 100)),
                    Math.max(0, Math.min(100, ((centerY - rect.top) / rect.height) * 100))
                );
                return;
            }

            if (gestureRef.current.pointers.size === 1) {
                updateFocusForTarget(
                    target,
                    Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
                    Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
                );
            }
        };

        const handlePreviewPointerUp = (target: 'desktop' | 'mobile', e: React.PointerEvent<HTMLDivElement>) => {
            gestureRef.current.pointers.delete(e.pointerId);
            if (gestureRef.current.pointers.size < 2) {
                gestureRef.current.lastDistance = null;
            }
            if (gestureRef.current.pointers.size === 0) {
                gestureRef.current.target = null;
                setActiveGestureTarget(null);
            }
        };

        const handlePreviewWheel = (target: 'desktop' | 'mobile', e: React.WheelEvent<HTMLDivElement>) => {
            e.preventDefault();
            const currentZoom = getZoomForTarget(target);
            const nextZoom = Math.min(1.8, Math.max(1, currentZoom - (e.deltaY * 0.0015)));
            updateZoom(target, nextZoom);
        };

        const renderPreviewCtaRow = (compact = false) => {
            const buttonSizeClass = compact ? 'h-7 px-3 text-[10px]' : 'h-9 px-4 text-xs';
            return (
                <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" className={cn(buttonSizeClass, 'bg-orange-600 text-white hover:bg-orange-700')}>
                        <Link href={previewEvent ? previewRegisterLink : (currentItem.customUrl || '#')} target={previewRegisterLink.startsWith('http') ? '_blank' : '_self'} rel={previewRegisterLink.startsWith('http') ? 'noopener noreferrer' : undefined}>
                            {previewEvent ? 'Register Now' : (currentItem.customLinkText || 'Register Now')}
                        </Link>
                    </Button>
                    {(previewEvent ? previewHasSoldOutTickets || currentItem.showWaitlistButton : !!currentItem.showWaitlistButton) && (
                        <Button asChild size="sm" className={cn(buttonSizeClass, 'bg-sky-400 text-slate-950 hover:bg-sky-300')}>
                            <Link href={previewWaitlistLink}>Join Waitlist</Link>
                        </Button>
                    )}
                    <Button asChild size="sm" variant="outline" className={cn(buttonSizeClass, 'bg-white text-slate-900 hover:bg-slate-100')}>
                        <Link href={previewDetailsLink}>Details</Link>
                    </Button>
                </div>
            );
        };

        const renderPreviewOverlay = (compact = false) => (
            <div className={cn('absolute inset-0 flex items-end text-white', compact ? 'p-3' : 'p-4')}>
                <div className={cn('drop-shadow-lg', compact ? 'space-y-1.5' : 'max-w-md space-y-2')}>
                    <div className={cn('inline-flex items-center rounded-full border border-white/15 bg-black/35 font-black uppercase tracking-[0.2em]', compact ? 'px-2 py-1 text-[9px]' : 'px-3 py-1 text-[10px]')}>
                        {previewEvent ? 'Upcoming Event' : 'Homepage Hero'}
                    </div>
                    <h3 className={cn('font-black uppercase italic leading-none', compact ? 'text-xl' : 'text-2xl')}>
                        {previewTitle}
                    </h3>
                    <p className={cn('text-white/85', compact ? 'text-[10px]' : 'text-xs')}>
                        {previewDescription}
                    </p>
                    {previewEvent && (
                        <div className={cn('flex items-center gap-2 font-black uppercase tracking-widest text-white/90', compact ? 'text-[9px]' : 'text-[10px]')}>
                            <Calendar className={cn(compact ? 'h-3 w-3' : 'h-4 w-4', 'text-orange-400')} />
                            {previewDateText}
                        </div>
                    )}
                    {renderPreviewCtaRow(compact)}
                    <p className={cn('uppercase tracking-widest text-white/70', compact ? 'text-[9px]' : 'text-[10px]')}>
                        Drag • Scroll to zoom • Pinch to zoom
                    </p>
                </div>
            </div>
        );

    const handleSave = () => {
        onSave(currentItem);
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader><DialogTitle>{item.id.startsWith('item') ? 'Add' : 'Edit'} Media Item</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1"><Label>Type</Label><Select value={currentItem.type} onValueChange={(v) => setCurrentItem(c => ({ ...c, type: v as 'image'|'video' }))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="image">Image</SelectItem><SelectItem value="video">Video</SelectItem></SelectContent></Select></div>
                      <div className="space-y-1">
                          <Label>Link To</Label>
                          {/** customUrl is supported in the underlying data model */}
                          <Select
                              value={currentItem.eventId ? `event-${currentItem.eventId}` : currentItem.pageSlug ? `page-${currentItem.pageSlug}` : (currentItem.customUrl !== null && currentItem.customUrl !== undefined) ? 'custom' : 'none'}
                              onValueChange={(v) => {
                                  if (v === 'custom') {
                                      setCurrentItem(c => ({...c, customUrl: '', eventId: null, pageSlug: null}));
                                  } else if (v.startsWith('event-')) {
                                      setCurrentItem(c => ({...c, eventId: v.replace('event-', ''), pageSlug: null, customUrl: null}));
                                  } else if (v.startsWith('page-')) {
                                      setCurrentItem(c => ({...c, eventId: null, pageSlug: v.replace('page-', ''), customUrl: null}));
                                  } else {
                                      setCurrentItem(c => ({...c, eventId: null, pageSlug: null, customUrl: null}));
                                  }
                              }}
                          >
                              <SelectTrigger><SelectValue placeholder="Link to..."/></SelectTrigger>
                              <SelectContent>
                                  <SelectItem value="none">None (Homepage)</SelectItem>
                                  <SelectItem value="custom">Custom URL</SelectItem>
                                  <SelectGroup><SelectLabel>Special Pages</SelectLabel>
                                    <SelectItem value="page-media">Media Page</SelectItem>
                                    <SelectItem value="page-login">Login Page</SelectItem>
                                  </SelectGroup>
                                  <SelectGroup>
                                      <SelectLabel>Upcoming Events</SelectLabel>
                                      {upcomingEvents.map(e=>(<SelectItem key={e.id} value={`event-${e.id}`}>{e.eventName}</SelectItem>))}
                                  </SelectGroup>
                              </SelectContent>
                          </Select>
                      </div>
                    </div>
                                        {currentItem.type === 'image' && (
                                            <div className="space-y-6">
                                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                    <div
                                                        className={cn(
                                                            'rounded-xl border-2 border-dashed p-4 transition-colors',
                                                            isDraggingImage ? 'border-primary bg-primary/5' : 'border-slate-300 bg-slate-50/50'
                                                        )}
                                                        onDragOver={(e) => { e.preventDefault(); setIsDraggingImage(true); }}
                                                        onDragLeave={() => setIsDraggingImage(false)}
                                                        onDrop={handleUploadDrop}
                                                    >
                                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                            <div>
                                                                <Label className="text-sm font-semibold">Desktop Banner</Label>
                                                                <p className="text-xs text-muted-foreground">Recommended: 1920 × 1080 px. Drag and drop or upload.</p>
                                                            </div>
                                                            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploadingImage}>
                                                                {isUploadingImage ? 'Uploading...' : 'Upload Desktop Image'}
                                                            </Button>
                                                        </div>
                                                        <input
                                                            ref={fileInputRef}
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            onChange={handleFileInputChange}
                                                        />
                                                        <div className="mt-4 overflow-hidden rounded-lg border bg-white">
                                                            <div className="relative aspect-video w-full">
                                                                <Image src={currentItem.src} alt={currentItem.alt || 'Desktop slider preview'} fill className="object-cover" style={{ objectPosition: `${desktopFocusX}% ${desktopFocusY}%`, transform: `scale(${desktopZoom})` }} />
                                                            </div>
                                                        </div>
                                                        <div className="mt-3 space-y-2">
                                                            <Label className="text-[10px] uppercase tracking-widest text-slate-500">Desktop Zoom</Label>
                                                            <Input type="range" min="1" max="1.8" step="0.01" value={desktopZoom} onChange={(e) => updateZoom('desktop', Number(e.target.value))} />
                                                        </div>
                                                    </div>

                                                    <div
                                                        className={cn(
                                                            'rounded-xl border-2 border-dashed p-4 transition-colors',
                                                            isDraggingMobileImage ? 'border-primary bg-primary/5' : 'border-slate-300 bg-slate-50/50'
                                                        )}
                                                        onDragOver={(e) => { e.preventDefault(); setIsDraggingMobileImage(true); }}
                                                        onDragLeave={() => setIsDraggingMobileImage(false)}
                                                        onDrop={handleMobileUploadDrop}
                                                    >
                                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                            <div>
                                                                <Label className="text-sm font-semibold">Mobile Banner</Label>
                                                                <p className="text-xs text-muted-foreground">Recommended: 9:16 or mobile-safe crop. Drag and drop or upload.</p>
                                                            </div>
                                                            <Button type="button" variant="outline" onClick={() => mobileFileInputRef.current?.click()} disabled={isUploadingMobileImage}>
                                                                {isUploadingMobileImage ? 'Uploading...' : 'Upload Mobile Image'}
                                                            </Button>
                                                        </div>
                                                        <input
                                                            ref={mobileFileInputRef}
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            onChange={handleMobileFileInputChange}
                                                        />
                                                        <div className="mt-4 overflow-hidden rounded-lg border bg-white">
                                                            <div className="relative aspect-[9/16] w-full">
                                                                <Image src={currentItem.mobileSrc || currentItem.src} alt={currentItem.alt || 'Mobile slider preview'} fill className="object-cover" style={{ objectPosition: `${mobileFocusX}% ${mobileFocusY}%`, transform: `scale(${mobileZoom})` }} />
                                                            </div>
                                                        </div>
                                                        <div className="mt-3 space-y-2">
                                                            <Label className="text-[10px] uppercase tracking-widest text-slate-500">Mobile Zoom</Label>
                                                            <Input type="range" min="1" max="1.8" step="0.01" value={mobileZoom} onChange={(e) => updateZoom('mobile', Number(e.target.value))} />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-4 border-t pt-4">
                                                    <h4 className="font-semibold text-sm">Focal Point & Responsive Preview</h4>
                                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                                                        <div className="space-y-3 lg:col-span-2">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <Label className="text-xs uppercase tracking-widest text-slate-500">Desktop focal point</Label>
                                                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] font-black uppercase tracking-widest" onClick={() => resetControls('desktop')}>
                                                                    Reset
                                                                </Button>
                                                            </div>
                                                            <div
                                                                className={cn(
                                                                    'relative overflow-hidden rounded-xl border bg-slate-950 aspect-video select-none touch-none',
                                                                    activeGestureTarget === 'desktop' ? 'cursor-grabbing' : 'cursor-grab'
                                                                )}
                                                                onPointerDown={(e) => handlePreviewPointerDown('desktop', e)}
                                                                onPointerMove={(e) => handlePreviewPointerMove('desktop', e)}
                                                                onPointerUp={(e) => handlePreviewPointerUp('desktop', e)}
                                                                onPointerCancel={(e) => handlePreviewPointerUp('desktop', e)}
                                                                onWheel={(e) => handlePreviewWheel('desktop', e)}
                                                            >
                                                                <Image src={currentItem.src} alt="Desktop crop preview" fill className="object-cover will-change-transform" style={{ objectPosition: `${desktopFocusX}% ${desktopFocusY}%`, transform: `scale(${desktopZoom})`, transformOrigin: 'center center' }} />
                                                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
                                                                <div className="pointer-events-none absolute inset-4 border border-white/25 border-dashed rounded-lg">
                                                                  <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
                                                                  <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
                                                                  <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
                                                                  <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
                                                                </div>
                                                                {renderPreviewOverlay(false)}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <Input type="range" min="0" max="100" step="1" value={desktopFocusX} onChange={(e) => setCurrentItem(c => ({ ...c, desktopFocusX: Number(e.target.value) }))} />
                                                                <Input type="range" min="0" max="100" step="1" value={desktopFocusY} onChange={(e) => setCurrentItem(c => ({ ...c, desktopFocusY: Number(e.target.value) }))} />
                                                            </div>
                                                        </div>

                                                        <div className="space-y-3">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <Label className="text-xs uppercase tracking-widest text-slate-500">Mobile preview</Label>
                                                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] font-black uppercase tracking-widest" onClick={() => resetControls('mobile')}>
                                                                    Reset
                                                                </Button>
                                                            </div>
                                                            <div className="relative overflow-hidden rounded-xl border bg-slate-950 aspect-[9/16] max-w-[220px] mx-auto">
                                                                <div
                                                                    className={cn(
                                                                        'relative h-full w-full select-none touch-none',
                                                                        activeGestureTarget === 'mobile' ? 'cursor-grabbing' : 'cursor-grab'
                                                                    )}
                                                                    onPointerDown={(e) => handlePreviewPointerDown('mobile', e)}
                                                                    onPointerMove={(e) => handlePreviewPointerMove('mobile', e)}
                                                                    onPointerUp={(e) => handlePreviewPointerUp('mobile', e)}
                                                                    onPointerCancel={(e) => handlePreviewPointerUp('mobile', e)}
                                                                    onWheel={(e) => handlePreviewWheel('mobile', e)}
                                                                >
                                                                    <Image src={currentItem.mobileSrc || currentItem.src} alt="Mobile crop preview" fill className="object-cover will-change-transform" style={{ objectPosition: `${mobileFocusX}% ${mobileFocusY}%`, transform: `scale(${mobileZoom})`, transformOrigin: 'center center' }} />
                                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
                                                                    <div className="pointer-events-none absolute inset-3 border border-white/25 border-dashed rounded-lg">
                                                                      <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
                                                                      <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
                                                                      <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
                                                                      <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
                                                                    </div>
                                                                    {renderPreviewOverlay(true)}
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <Input type="range" min="0" max="100" step="1" value={mobileFocusX} onChange={(e) => setCurrentItem(c => ({ ...c, mobileFocusX: Number(e.target.value) }))} />
                                                                <Input type="range" min="0" max="100" step="1" value={mobileFocusY} onChange={(e) => setCurrentItem(c => ({ ...c, mobileFocusY: Number(e.target.value) }))} />
                                                            </div>
                                                        </div>

                                                        <div className="space-y-3 lg:col-span-3">
                                                            <Label className="text-xs uppercase tracking-widest text-slate-500">Tablet preview</Label>
                                                            <div className="relative overflow-hidden rounded-xl border bg-slate-950 aspect-[4/3]">
                                                                <Image src={currentItem.mobileSrc || currentItem.src} alt="Tablet crop preview" fill className="object-cover will-change-transform" style={{ objectPosition: `${mobileFocusX}% ${mobileFocusY}%`, transform: `scale(${mobileZoom})`, transformOrigin: 'center center' }} />
                                                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10" />
                                                                <div className="pointer-events-none absolute inset-4 border border-white/25 border-dashed rounded-lg" />
                                                                {renderPreviewOverlay(false)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="space-y-1"><Label>Source URL</Label><Input value={currentItem.src} onChange={e => setCurrentItem(c => ({ ...c, src: e.target.value }))} placeholder="https://..."/></div>
                                        <div className="space-y-1"><Label>Mobile Source URL</Label><Input value={currentItem.mobileSrc || ''} onChange={e => setCurrentItem(c => ({ ...c, mobileSrc: e.target.value }))} placeholder="https://..."/></div>
                    <div className="space-y-1"><Label>Alt Text</Label><Input value={currentItem.alt} onChange={e => setCurrentItem(c => ({...c, alt: e.target.value }))} placeholder="Description for screen readers"/></div>
                    <div className="space-y-1"><Label>AI Hint</Label><Input value={currentItem.dataAiHint || ''} onChange={e => setCurrentItem(c => ({...c, dataAiHint: e.target.value }))} placeholder="e.g., 'triathlon finish line'"/></div>
                                        <div className="space-y-1"><Label>Mobile AI Hint</Label><Input value={currentItem.mobileDataAiHint || ''} onChange={e => setCurrentItem(c => ({...c, mobileDataAiHint: e.target.value }))} placeholder="e.g., 'runner close up'"/></div>
                    {(currentItem.customUrl !== null && currentItem.customUrl !== undefined) && (
                        <div className="space-y-3 border-t pt-4">
                            <h4 className="font-semibold text-sm">Custom Link Settings</h4>
                            <div className="space-y-1"><Label>Custom URL</Label><Input value={currentItem.customUrl || ''} onChange={e => setCurrentItem(c => ({...c, customUrl: e.target.value }))} placeholder="https://example.com"/></div>
                        </div>
                    )}
                    <div className="space-y-3 border-t pt-4">
                        <h4 className="font-semibold text-sm">Header & Description (Optional)</h4>
                        <div className="space-y-1"><Label>Header/Title</Label><Input value={currentItem.header || ''} onChange={e => setCurrentItem(c => ({...c, header: e.target.value }))} placeholder="e.g., 'Join Our Championship'"/></div>
                        <div className="space-y-1"><Label>Description</Label><Textarea value={currentItem.description || ''} onChange={e => setCurrentItem(c => ({ ...c, description: e.target.value }))} placeholder="Brief description or tagline for this slide" rows={3}/></div>
                        <div className="space-y-1"><Label>Custom Link Button Text</Label><Input value={currentItem.customLinkText || ''} onChange={e => setCurrentItem(c => ({...c, customLinkText: e.target.value }))} placeholder="e.g., 'Register Now', 'Learn More'"/></div>
                    </div>
                    <div className="flex items-center space-x-2"><Switch id="show-on-homepage" checked={currentItem.showOnHomepage !== false} onCheckedChange={checked => setCurrentItem(c => ({ ...c, showOnHomepage: checked }))} /><Label htmlFor="show-on-homepage">Show on Homepage Slider</Label></div>
                    <div className="flex items-center space-x-2"><Switch id="show-waitlist-btn" checked={!!currentItem.showWaitlistButton} onCheckedChange={checked => setCurrentItem(c => ({ ...c, showWaitlistButton: checked }))} /><Label htmlFor="show-waitlist-btn">Show &ldquo;Join Waitlist&rdquo; button (for sold-out events)</Label></div>
                </div>
                <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={handleSave}>Save</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function FooterManager() {
    const [config, setConfig] = useState<FooterConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        getFooterConfigAction().then(result => {
            if (result.success && result.config) {
                setConfig(result.config);
            }
            setIsLoading(false);
        });
    }, []);

    const handleSave = async () => {
        if (!config) return;
        setIsSaving(true);
        const result = await saveFooterConfigAction(config);
        if (result.success) {
            toast({ title: "Success", description: "Footer content saved." });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setIsSaving(false);
    };

    const handleSocialChange = (platform: keyof FooterConfig['socials'], value: string) => {
        setConfig(prev => prev ? ({ ...prev, socials: { ...prev.socials, [platform]: value } }) : null);
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>;
    if (!config) return <p>Could not load footer configuration.</p>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Footer Content & Social Links</CardTitle>
                <CardDescription>Manage the content that appears in the global site footer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="tagline">Tagline</Label>
                    <Textarea
                        id="tagline"
                        value={config.tagline}
                        onChange={(e) => setConfig(prev => prev ? ({ ...prev, tagline: e.target.value }) : null)}
                        placeholder="Promoting sports and a healthy lifestyle through events."
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="instagram" className="flex items-center gap-2"><Instagram className="h-4 w-4"/>Instagram URL</Label>
                        <Input id="instagram" value={config.socials.instagram || ''} onChange={(e) => handleSocialChange('instagram', e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="facebook" className="flex items-center gap-2"><Facebook className="h-4 w-4"/>Facebook URL</Label>
                        <Input id="facebook" value={config.socials.facebook || ''} onChange={(e) => handleSocialChange('facebook', e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="x" className="flex items-center gap-2"><Twitter className="h-4 w-4"/>X (Twitter) URL</Label>
                        <Input id="x" value={config.socials.x || ''} onChange={(e) => handleSocialChange('x', e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="youtube" className="flex items-center gap-2"><Youtube className="h-4 w-4"/>YouTube URL</Label>
                        <Input id="youtube" value={config.socials.youtube || ''} onChange={(e) => handleSocialChange('youtube', e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="threads" className="flex items-center gap-2"><LinkIcon className="h-4 w-4"/>Threads URL</Label>
                        <Input id="threads" value={config.socials.threads || ''} onChange={(e) => handleSocialChange('threads', e.target.value)} />
                    </div>
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />}
                    Save Footer Content
                </Button>
            </CardFooter>
        </Card>
    );
}

// New Component for Login Page Media Management
function LoginPageMediaManager({ onDataRefresh }: { onDataRefresh: () => void }) {
    const [allItems, setAllItems] = useState<HomepageSliderItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<HomepageSliderItem | null>(null);
    const { toast } = useToast();

    const fetchAllItems = useCallback(async () => {
        setIsLoading(true);
        const result = await getHomepageSliderItemsAction();
        if (result.success && result.items) {
            setAllItems(result.items);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchAllItems();
    }, [fetchAllItems]);

    const loginMediaItems = useMemo(() => 
        allItems.filter(item => item.pageSlug === 'login'), 
    [allItems]);

    const handleSave = async (itemsToSaveInFullList: HomepageSliderItem[]) => {
        setIsSaving(true);
        const result = await saveHomepageSliderItemsAction(itemsToSaveInFullList);
        if (result.success) {
            toast({ title: "Success", description: "Login page media updated." });
            setAllItems(itemsToSaveInFullList);
            onDataRefresh();
        } else {
            toast({ variant: "destructive", title: "Error", description: result.message });
        }
        setIsSaving(false);
    };

    const handleDeleteItem = (id: string) => {
        const updatedFullItems = allItems.filter(item => item.id !== id);
        handleSave(updatedFullItems);
    };

    const handleSaveItem = (itemData: HomepageSliderItem) => {
        const existing = allItems.find(i => i.id === itemData.id);
        let newItems: HomepageSliderItem[];
        if (existing) {
            newItems = allItems.map(i => i.id === itemData.id ? itemData : i);
        } else {
            newItems = [...allItems, itemData];
        }
        handleSave(newItems);
        setIsModalOpen(false);
        setEditingItem(null);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Login Page Background Media</CardTitle>
                <CardDescription>Manage the background image or video for the login page. Only one item will be shown at a time.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex justify-end mb-4">
                    <Button size="sm" onClick={() => { setEditingItem({ id: `login-item-${Date.now()}`, type: 'image', src: '', alt: '', pageSlug: 'login', showOnHomepage: false }); setIsModalOpen(true); }}>
                        <PlusCircle className="mr-2 h-4 w-4"/>Add Media
                    </Button>
                </div>
                 <div className="rounded-md border">
                    <Table>
                        <TableHeader><TableRow><TableHead>Preview</TableHead><TableHead>Type</TableHead><TableHead>Source</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? <TableRow><TableCell colSpan={4} className="text-center"><Loader2 className="animate-spin"/></TableCell></TableRow>
                            : loginMediaItems.map(item => {
                                const validSrc = isValidImageUrl(item.src) ? item.src : null;
                                return (
                                    <TableRow key={item.id}>
                                        <TableCell>{item.type === 'image' && validSrc ? <Image src={validSrc} alt={item.alt} width={80} height={45} className="object-cover rounded-md"/> : <Video className="h-8 w-8"/>}</TableCell>
                                        <TableCell><Badge variant="secondary">{item.type}</Badge></TableCell>
                                        <TableCell className="text-xs font-mono max-w-xs truncate">{item.src}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" onClick={() => { setEditingItem(item); setIsModalOpen(true); }}><Edit className="h-4 w-4 mr-2"/>Edit</Button>
                                            <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4 mr-2"/>Delete</Button></AlertDialogTrigger>
                                                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Media Item?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteItem(item.id)}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
            {editingItem && (
                <LoginMediaModal 
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    item={editingItem}
                    onSave={handleSaveItem}
                />
            )}
        </Card>
    );
}

// Modal specifically for Login Page Media
function LoginMediaModal({ isOpen, onClose, item, onSave }: { isOpen: boolean; onClose: () => void; item: HomepageSliderItem; onSave: (item: HomepageSliderItem) => void }) {
    const [currentItem, setCurrentItem] = useState(item);

    useEffect(() => { setCurrentItem(item); }, [item]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader><DialogTitle>{item.id.startsWith('login-item') ? 'Add' : 'Edit'} Login Page Media</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-1"><Label>Type</Label><Select value={currentItem.type} onValueChange={(v) => setCurrentItem(c => ({ ...c, type: v as 'image'|'video' }))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="image">Image</SelectItem><SelectItem value="video">Video</SelectItem></SelectContent></Select></div>
                    <div className="space-y-1"><Label>Source URL</Label><Input value={currentItem.src} onChange={e => setCurrentItem(c => ({...c, src: e.target.value }))} placeholder="https://..."/></div>
                    <div className="space-y-1"><Label>Alt Text</Label><Input value={currentItem.alt} onChange={e => setCurrentItem(c => ({...c, alt: e.target.value }))} placeholder="Description for screen readers"/></div>
                    <div className="space-y-1"><Label>AI Hint</Label><Input value={currentItem.dataAiHint || ''} onChange={e => setCurrentItem(c => ({...c, dataAiHint: e.target.value }))} placeholder="e.g., 'athlete running'"/></div>
                </div>
                <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(currentItem)}>Save</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Main component combining all managers into tabs
export default function PagesTab({ events, isLoadingEvents, onDataRefresh }: PagesTabProps) {
  const [activeTab, setActiveTab] = useState('sitePages');
  const isMobile = useIsMobile();
  
  const pageNavItems = [
    { id: 'sitePages', label: 'Site Pages', icon: FileText },
    { id: 'eventPages', label: 'Event Pages', icon: FileText },
    { id: 'homepageSlider', label: 'Homepage Slider', icon: Home },
    { id: 'loginPage', label: 'Login Page Media', icon: LogIn },
    { id: 'footer', label: 'Footer', icon: LinkIcon },
  ];

  const renderNav = () => {
    if (isMobile) {
      return (
        <Select value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a section..." />
          </SelectTrigger>
          <SelectContent>
            {pageNavItems.map(item => (
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
        <TabsList className="grid w-full grid-cols-5">
            {pageNavItems.map(item => (
                 <TabsTrigger key={item.id} value={item.id}><item.icon className="mr-2"/>{item.label}</TabsTrigger>
            ))}
        </TabsList>
    );
  };
  
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {renderNav()}
        <TabsContent value="sitePages" className="mt-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FileText /> Site Pages</CardTitle>
                    <CardDescription>Manage static pages like &quot;About Us&quot; or page redirects.</CardDescription>
                </CardHeader>
                <CardContent>
                    <SitePagesManager onDataRefresh={onDataRefresh}/>
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="eventPages" className="mt-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FileText /> Event Page Content</CardTitle>
                    <CardDescription>Add and edit custom content for individual race pages.</CardDescription>
                </CardHeader>
                <CardContent>
                    <EventContentManager events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="homepageSlider" className="mt-4">
              <HomepageSliderManager events={events} isLoadingEvents={isLoadingEvents} onDataRefresh={onDataRefresh} />
        </TabsContent>
        <TabsContent value="loginPage" className="mt-4">
              <LoginPageMediaManager onDataRefresh={onDataRefresh} />
        </TabsContent>
        <TabsContent value="footer" className="mt-4">
              <FooterManager />
        </TabsContent>
    </Tabs>
  );
}
