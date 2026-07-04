
// src/components/admin/EnquiriesTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Enquiry, EnquiryReply } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageCircleQuestion, RefreshCw, Send, User, Bot, MessageSquarePlus, AlertTriangle, ShieldCheck, Filter } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getEnquiriesAction, replyToEnquiryAction, updateEnquiryStatusAction, logUserReplyAction } from '@/lib/actions/contactActions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const statusVariantMap: { [key in Enquiry['status']]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
  Open: 'destructive',
  Replied: 'default',
  Closed: 'secondary',
  Spam: 'outline'
};

const ConversationBubble = ({ message, from, timestamp }: { message: string, from: 'user' | 'admin', timestamp: string }) => {
    const isAdmin = from === 'admin';
    
    return (
        <div className={`flex items-end gap-2 ${isAdmin ? 'justify-end' : 'justify-start'}`}>
            {isAdmin && <Bot className="h-6 w-6 text-primary shrink-0 mb-1" />}
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-line ${isAdmin ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted rounded-bl-none'}`}>
                <p>{message}</p>
                <p className={`text-[10px] mt-2 text-right ${isAdmin ? 'text-primary-foreground/70' : 'text-muted-foreground/70'}`}>
                    {timestamp ? format(parseISO(timestamp), 'MMM dd, p') : 'Just now'}
                </p>
            </div>
            {!isAdmin && <User className="h-6 w-6 text-muted-foreground shrink-0 mb-1" />}
        </div>
    );
};

export default function EnquiriesTab() {
  const { toast } = useToast();
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEnquiry, setSelectedEnquiry] = useState<Enquiry | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<'all' | 'valid' | 'spam'>('valid');
  
  const [isLogReplyModalOpen, setIsLogReplyModalOpen] = useState(false);
  const [userReplyMessage, setUserReplyMessage] = useState('');
  const [isLoggingReply, setIsLoggingReply] = useState(false);
  
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const fetchEnquiries = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getEnquiriesAction();
      if (result.success && result.enquiries) {
        setEnquiries(result.enquiries);
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch enquiries.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchEnquiries();
  }, [fetchEnquiries]);
  
  useEffect(() => {
    if (scrollAreaRef.current) {
       const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
       if (viewport) viewport.scrollTo({ top: viewport.scrollHeight });
    }
  }, [selectedEnquiry]);

  const filteredEnquiries = useMemo(() => {
      return enquiries.filter(e => {
          if (viewFilter === 'spam') return e.isSpam === true;
          if (viewFilter === 'valid') return e.isSpam !== true;
          return true;
      });
  }, [enquiries, viewFilter]);

  const handleReply = async () => {
    if (!selectedEnquiry || !replyMessage) return;
    setIsReplying(true);
    const result = await replyToEnquiryAction(selectedEnquiry.id, replyMessage);
    if (result.success) {
        toast({ title: "Reply Sent" });
        setReplyMessage('');
        await fetchEnquiries();
        setSelectedEnquiry(null);
    } else {
        toast({ variant: "destructive", title: "Reply Failed", description: result.message });
    }
    setIsReplying(false);
  };

  const handleStatusChange = async (id: string, status: Enquiry['status']) => {
    setIsUpdatingStatus(id);
    const result = await updateEnquiryStatusAction(id, status);
    if (result.success) {
        toast({ title: 'Status Updated' });
        fetchEnquiries();
        if(selectedEnquiry?.id === id) setSelectedEnquiry(prev => prev ? { ...prev, status } : null);
    }
    setIsUpdatingStatus(null);
  };

  return (
    <div className="space-y-6 text-left">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary/5 border-b pb-6 text-left">
          <div className="flex justify-between items-center text-left">
              <div className="text-left">
                  <CardTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Athlete Enquiry Management</CardTitle>
                  <CardDescription className="text-left">Verify, respond to, and filter support tickets.</CardDescription>
              </div>
              <div className="flex gap-2 text-left">
                  <Select value={viewFilter} onValueChange={(v: any) => setViewFilter(v)}>
                      <SelectTrigger className="w-40 h-10 rounded-xl font-bold bg-background text-left">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="text-left">
                          <SelectItem value="all">All Enquiries</SelectItem>
                          <SelectItem value="valid">Valid Leads</SelectItem>
                          <SelectItem value="spam">Spam Buffer</SelectItem>
                      </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={fetchEnquiries} disabled={isLoading} className="rounded-xl h-10 w-10">
                      <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                  </Button>
              </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-none border-t overflow-x-auto text-left">
            <div className="hidden md:block">
              <Table>
              <TableHeader className="bg-muted/30 hidden md:table-header-group">
                <TableRow className="h-10 text-[10px] font-black uppercase tracking-widest border-b">
                  <TableHead className="pl-6">ID / Contact</TableHead>
                  <TableHead className="w-[35%]">Message Content</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Spam Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-6">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-48"><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary"/></TableCell></TableRow>
                ) : filteredEnquiries.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">No entries found in this category.</TableCell></TableRow>
                ) : (
                  // Desktop/table view
                  filteredEnquiries.map(enq => (
                    <TableRow key={enq.id} className={cn("h-16 hover:bg-muted/10 transition-colors text-xs border-border/50", enq.isSpam && "opacity-60")}>
                      <TableCell className="pl-6 text-left">
                        <div className="font-mono text-[9px] text-muted-foreground leading-none mb-1">#{enq.ticketId}</div>
                        <div className="font-black uppercase tracking-tight text-left">{enq.name}</div>
                        <div className="text-[10px] lowercase text-muted-foreground text-left">{enq.email}</div>
                      </TableCell>
                      <TableCell className="text-left">
                        <p className="line-clamp-2 leading-relaxed text-left">{enq.message}</p>
                        <div className="text-[9px] font-bold text-slate-400 mt-1 uppercase text-left">{format(parseISO(enq.createdAt), 'MMM dd, yyyy · p')}</div>
                      </TableCell>
                      <TableCell className="text-left">{(enq as any).selectedEventName || '—'}</TableCell>
                      <TableCell className="text-left">{enq.ticketId || '—'}</TableCell>
                      <TableCell className="text-left">
                          {enq.isSpam ? (
                              <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 gap-1.5 font-black uppercase text-[9px]">
                                  <AlertTriangle className="h-3 w-3" /> Suspected Spam ({enq.spamScore})
                              </Badge>
                          ) : (
                              <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200 gap-1.5 font-black uppercase text-[9px]">
                                  <ShieldCheck className="h-3 w-3" /> Valid ({enq.spamScore || 0})
                              </Badge>
                          )}
                      </TableCell>
                      <TableCell className="text-left">
                         <Badge variant={statusVariantMap[enq.status]} className="text-[9px] font-black uppercase">{enq.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="outline" size="xs" onClick={() => setSelectedEnquiry(enq)} className="rounded-lg h-8 font-black uppercase text-[9px] tracking-widest">Process</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              </Table>
            </div>
            {/* Mobile stacked list */}
            <div className="md:hidden space-y-3 p-3">
              {filteredEnquiries.map((enq) => (
                <div
                  key={enq.id}
                  onClick={() => setSelectedEnquiry(enq)}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'rounded-lg border p-3 focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer',
                    enq.isSpam && 'opacity-60',
                    'aspect-square flex flex-col justify-between'
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="font-mono text-xs text-muted-foreground">#{enq.ticketId}</div>
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedEnquiry(enq); }}
                        className="font-black text-left text-base leading-tight"
                      >
                        {enq.name}
                      </button>
                      <div className="text-xs text-muted-foreground mt-1">{enq.email} · {enq.mobile}</div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <div className="text-[11px] px-2 py-0.5 rounded bg-muted/20 text-muted-foreground">{(enq as any).selectedEventName || 'No event'}</div>
                      <div className="text-[11px] px-2 py-0.5 rounded bg-muted/20 text-muted-foreground">{enq.ticketId || 'Any category'}</div>
                    </div>

                    <div className="mt-3 text-sm overflow-hidden line-clamp-5">{enq.message}</div>
                  </div>

                  <div className="mt-3">
                    <div className="mb-2">
                      {enq.isSpam ? (
                        <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">Spam</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">Valid</Badge>
                      )}
                    </div>
                    <Button size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); setSelectedEnquiry(enq); }}>
                      Open Enquiry
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedEnquiry} onOpenChange={(isOpen) => !isOpen && setSelectedEnquiry(null)}>
        <DialogContent className="max-w-2xl h-[90vh] flex flex-col p-0 overflow-hidden text-left rounded-3xl border-none shadow-2xl">
          <DialogHeader className="p-6 border-b bg-muted/30 flex-shrink-0 text-left">
          <DialogTitle className="text-xl font-black uppercase italic tracking-tighter text-left">Enquiry #{selectedEnquiry?.ticketId}</DialogTitle>
           <div className="flex justify-between items-center mt-4 text-left">
            <div className="text-left">
              <p className="text-xs font-black uppercase text-left">{selectedEnquiry?.name}</p>
              <p className="text-[10px] text-muted-foreground lowercase text-left">{selectedEnquiry?.email}</p>
              <p className="text-[11px] text-muted-foreground mt-2">{(selectedEnquiry as any)?.selectedEventName || '—'}{selectedEnquiry?.ticketId ? ` · ${selectedEnquiry?.ticketId}` : ''}</p>
            </div>
                 <Select
                    value={selectedEnquiry?.status}
                    onValueChange={(newStatus) => handleStatusChange(selectedEnquiry!.id, newStatus as any)}
                    disabled={isUpdatingStatus === selectedEnquiry?.id}
                >
                    <SelectTrigger className="text-[10px] h-8 w-[120px] font-black uppercase tracking-widest rounded-xl">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="text-left">
                        <SelectItem value="Open">Open</SelectItem>
                        <SelectItem value="Replied">Replied</SelectItem>
                        <SelectItem value="Closed">Closed</SelectItem>
                        <SelectItem value="Spam">Spam</SelectItem>
                    </SelectContent>
                </Select>
             </div>
          </DialogHeader>
          <ScrollArea className="flex-grow p-6 bg-muted/5" ref={scrollAreaRef}>
            <div className="space-y-6 text-left">
              <ConversationBubble message={selectedEnquiry?.message || ''} from="user" timestamp={selectedEnquiry?.createdAt || ''} />
              {(selectedEnquiry?.replies || []).map((reply, index) => (
                <ConversationBubble key={index} message={reply.message} from={(reply.sentBy.toLowerCase() as any)} timestamp={reply.sentAt} />
              ))}
            </div>
          </ScrollArea>
          <div className="p-6 border-t bg-background flex-shrink-0 text-left">
            <Textarea
              placeholder="Type your response to the athlete..."
              value={replyMessage}
              onChange={e => setReplyMessage(e.target.value)}
              rows={4}
              className="rounded-2xl border-muted mb-4 text-sm"
              disabled={isReplying}
            />
            <div className="flex justify-between items-center text-left">
                <Button variant="ghost" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground" onClick={() => setIsLogReplyModalOpen(true)}>
                    <MessageSquarePlus className="h-4 w-4 mr-2" /> Log User Reply
                </Button>
                <Button onClick={handleReply} disabled={!replyMessage.trim() || isReplying} className="rounded-xl h-11 px-8 font-black uppercase tracking-widest shadow-xl">
                  {isReplying ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Send className="h-4 w-4 mr-2" />}
                  Send Reply
                </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isLogReplyModalOpen} onOpenChange={setIsLogReplyModalOpen}>
        <DialogContent className="text-left">
            <DialogHeader className="text-left">
                <DialogTitle className="text-left">Log User Response</DialogTitle>
                <DialogDescription className="text-left">Copy/paste the user&apos;s email reply into the box below to maintain the conversation thread.</DialogDescription>
            </DialogHeader>
            <Textarea 
                value={userReplyMessage}
                onChange={(e) => setUserReplyMessage(e.target.value)}
                placeholder="Paste response content..."
                rows={10}
                className="rounded-xl font-mono text-xs text-left"
                disabled={isLoggingReply}
            />
            <DialogFooter className="text-left">
                <Button variant="ghost" onClick={() => setIsLogReplyModalOpen(false)}>Cancel</Button>
                <Button onClick={async () => {
                    if (!selectedEnquiry || !userReplyMessage) return;
                    setIsLoggingReply(true);
                    const res = await logUserReplyAction(selectedEnquiry.id, userReplyMessage);
                    if(res.success) {
                        toast({ title: 'Response Logged' });
                        setIsLogReplyModalOpen(false);
                        setUserReplyMessage('');
                        fetchEnquiries();
                        setSelectedEnquiry(null);
                    }
                    setIsLoggingReply(false);
                }} disabled={isLoggingReply || !userReplyMessage.trim()}>
                    Log Interaction
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
