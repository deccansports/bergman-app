// src/components/admin/PagesTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { FileText, PlusCircle, ArrowUp, ArrowDown, Trash2, Save, ExternalLink, Video, Home, Link as LinkIcon, Loader2, Edit, LogIn } from 'lucide-react';
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
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { isValidImageUrl } from '@/lib/utils';


interface PagesTabProps {
  events: EventCalendarEntry[];
  isLoadingEvents: boolean;
  onDataRefresh: () => void;
}

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
            showInHeader: true,
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
        const isNewPage = !pages.some(p => p.id === selectedPage.id);
        const newPagesArray = isNewPage ? [...pages, selectedPage] : pages.map(p => p.id === selectedPage.id ? selectedPage : p);
        
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
                </div>
                <div className="flex items-center space-x-4 pt-2">
                  <div className="flex items-center space-x-2">
                    <Switch id="pagePublished" checked={selectedPage.published} onCheckedChange={(checked) => handleUpdatePageDetails('published', checked)} disabled={isSaving}/>
                    <label htmlFor="pagePublished">{selectedPage.published ? 'Published' : 'Draft'}</label>
                  </div>
                   <div className="flex items-center space-x-2">
                    <Switch id="showInHeader" checked={selectedPage.showInHeader} onCheckedChange={(checked) => handleUpdatePageDetails('showInHeader', checked)} disabled={isSaving}/>
                    <label htmlFor="showInHeader">Show in Header</label>
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
                    <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Path</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {isLoadingPages ? (
                           <TableRow><TableCell colSpan={4} className="text-center"><Loader2 className="animate-spin my-4" /></TableCell></TableRow>
                        ) : pages.map((page, index) => (
                            <TableRow key={page.id}>
                                <TableCell className="font-medium flex items-center gap-2">{page.title}{page.url && page.url.startsWith('http') && <ExternalLink className="h-4 w-4 text-muted-foreground" />}</TableCell>
                                <TableCell className="text-muted-foreground font-mono text-xs">{page.url || `/content/${page.slug}`}</TableCell>
                                <TableCell>
                                    <Badge variant={page.published ? 'default' : 'secondary'}>{page.published ? 'Published' : 'Draft'}</Badge>
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
        setEditingItem({ id: `item${Date.now()}`, type: 'image', src: '', alt: '', showOnHomepage: true });
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
                                            {item.eventId ? (
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
    }, [item]);

    const handleSave = () => {
        onSave(currentItem);
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader><DialogTitle>{item.id.startsWith('item') ? 'Add' : 'Edit'} Media Item</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1"><Label>Type</Label><Select value={currentItem.type} onValueChange={(v) => setCurrentItem(c => ({ ...c, type: v as 'image'|'video' }))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="image">Image</SelectItem><SelectItem value="video">Video</SelectItem></SelectContent></Select></div>
                      <div className="space-y-1">
                          <Label>Link To Page / Event</Label>
                          <Select
                              value={currentItem.eventId ? `event-${currentItem.eventId}` : currentItem.pageSlug ? `page-${currentItem.pageSlug}` : 'none'}
                              onValueChange={(v) => {
                                  if (v.startsWith('event-')) {
                                      setCurrentItem(c => ({...c, eventId: v.replace('event-', ''), pageSlug: null}));
                                  } else if (v.startsWith('page-')) {
                                      setCurrentItem(c => ({...c, eventId: null, pageSlug: v.replace('page-', '')}));
                                  } else {
                                      setCurrentItem(c => ({...c, eventId: null, pageSlug: null}));
                                  }
                              }}
                          >
                              <SelectTrigger><SelectValue placeholder="Link to..."/></SelectTrigger>
                              <SelectContent>
                                  <SelectItem value="none">None (Homepage)</SelectItem>
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
                    <div className="space-y-1"><Label>Source URL</Label><Input value={currentItem.src} onChange={e => setCurrentItem(c => ({...c, src: e.target.value }))} placeholder="https://..."/></div>
                    <div className="space-y-1"><Label>Alt Text</Label><Input value={currentItem.alt} onChange={e => setCurrentItem(c => ({...c, alt: e.target.value }))} placeholder="Description for screen readers"/></div>
                    <div className="space-y-1"><Label>AI Hint</Label><Input value={currentItem.dataAiHint || ''} onChange={e => setCurrentItem(c => ({...c, dataAiHint: e.target.value }))} placeholder="e.g., 'triathlon finish line'"/></div>
                    <div className="flex items-center space-x-2"><Switch id="show-on-homepage" checked={currentItem.showOnHomepage !== false} onCheckedChange={checked => setCurrentItem(c => ({ ...c, showOnHomepage: checked }))} /><Label htmlFor="show-on-homepage">Show on Homepage Slider</Label></div>
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
