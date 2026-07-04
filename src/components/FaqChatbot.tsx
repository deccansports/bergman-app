"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, User, Loader2, Sparkles, ShieldCheck, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn, isDuathlonEvent } from '@/lib/utils';
import { getFaqsAction, logAiInteractionAction } from '@/lib/actions/faqActions';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { getAthleteRankingData } from '@/lib/actions/athleteRankingActions';
import { getClubRankingData } from '@/lib/actions/clubActions';
import type { FaqEntry, EventCalendarEntry } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { askEliteAi } from '@/ai/flows/faq-flow';
import { getUpcomingRacesFromKV } from '@/lib/chatMemory';
import { ScrollArea } from './ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { createPortal } from 'react-dom';

interface Message {
  id: number;
  text: string;
  from: 'user' | 'bot';
  isSuggestion?: boolean;
}

const AI_TIMEOUT_MS = 7000;

const isCutoffQuestion = (text: string) => {
    const q = text.toLowerCase();
    return q.includes('cutoff') || q.includes('cut off') || q.includes('time limit') || q.includes('time-limit');
};

const getCutoffAnswer = (events: EventCalendarEntry[]) => {
    const rows: string[] = [];

    for (const event of events) {
        for (const ticket of event.ticketDefinitions || []) {
            const c = ticket.cutoffs;
            if (!c) continue;

            if (c.mode === 'segment') {
                const segment = [
                    c.swim ? `Swim: ${c.swim}` : null,
                    c.bike ? `Bike: ${c.bike}` : null,
                    c.run ? `Run: ${c.run}` : null,
                    c.run1 ? `Run1: ${c.run1}` : null,
                    c.run2 ? `Run2: ${c.run2}` : null,
                ].filter(Boolean).join(', ');

                if (segment) {
                    rows.push(`- **${event.eventName}** → **${ticket.ticketName}**: ${segment}`);
                }
            } else if (c.overall) {
                rows.push(`- **${event.eventName}** → **${ticket.ticketName}**: Overall ${c.overall}`);
            }
        }
    }

    if (rows.length === 0) {
        return "I couldn't find published cutoff data in the current schedule. Please check [Contact Us](/contact-us) for official confirmation.";
    }

    return `Here are the latest published cutoff timings:\n\n${rows.slice(0, 20).join('\n')}\n\nFor full rules, please verify on the race page or [Contact Us](/contact-us).`;
};

const getQuickIntentReply = (text: string, upcomingRaceNames: string[], isLoggedIn: boolean) => {
    const q = text.toLowerCase();

        if (
            q.includes('policy') ||
            q.includes('deferral') ||
            q.includes('cancellation') ||
            q.includes('cancel') ||
            q.includes('refund') ||
            q.includes('transfer') ||
            q.includes('category change') ||
            q.includes('explore the website')
        ) {
            return [
                'Here are the best pages for detailed policy information:',
                '',
                '- **Deferral / cancellation / refund / transfer rules:** [Refund Policy](/refund-policy)',
                '- **Full race legal terms & conditions:** [Terms & Conditions](/terms-and-conditions)',
                '- **Athlete standings:** [Athlete Rankings](/athlete-rankings)',
                '- **Club standings:** [Club Rankings](/club-rankings)',
                '',
                'If you want, I can also summarize the key policy points here in 5 bullets.'
            ].join('\n');
        }

    if (q.includes('next race') || q.includes('upcoming race') || q.includes('my race')) {
        if (!isLoggedIn) {
            return 'Please **[log in](/login)** to view your registered and upcoming races.';
        }
        if (upcomingRaceNames.length === 0) {
            return "I couldn't find an upcoming race in your profile right now. You can verify from [Dashboard](/dashboard).";
        }
        return `Your upcoming races:\n\n${upcomingRaceNames.slice(0, 5).map((r, i) => `${i + 1}. **${r}**`).join('\n')}\n\nSee full details in [Dashboard](/dashboard).`;
    }

    if (q.includes('points') || q.includes('my points') || q.includes('check my points')) {
        if (!isLoggedIn) {
            return 'Please **[log in](/login)** to view your points and performance stats.';
        }
        return 'You can check your latest points and performance stats in [Dashboard](/dashboard).';
    }

    if (q.includes('club ranking') || q.includes('club rankings') || q.includes('rankings')) {
        return 'You can view the latest club leaderboard on [Club Rankings](/club-rankings) and athlete standings on [Athlete Rankings](/athlete-rankings).';
    }

    return null;
};

export default function FaqChatbot() {
    const pathname = usePathname();
  const { currentUser } = useAuth();
    const [isClientMounted, setIsClientMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [allFaqs, setAllFaqs] = useState<FaqEntry[]>([]);
  const [allEvents, setAllEvents] = useState<EventCalendarEntry[]>([]);
    const [upcomingRaceNames, setUpcomingRaceNames] = useState<string[]>([]);
    const responseCacheRef = useRef<Map<string, string>>(new Map());

  const initialGreetingSent = useRef(false);

    const isLedCleanRoute = pathname?.startsWith('/athlete-journey');

  const fetchAppData = useCallback(async () => {
    try {
        const [faqResult, eventResult] = await Promise.all([
            getFaqsAction(),
            getCalendarEventsAction()
        ]);
        
        if (faqResult.success && faqResult.faqs) {
            setAllFaqs(faqResult.faqs);
        } else {
            console.warn("FAQ fetch warning:", faqResult.message);
        }
        
        if (eventResult.success && eventResult.events) {
            setAllEvents(eventResult.events);
        } else {
            console.warn("Event fetch warning:", eventResult.message);
        }
    } catch (error) {
        console.error("Failed to fetch AI knowledge base:", error);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
        fetchAppData();
        if (!initialGreetingSent.current) {
            const greeting = currentUser?.name 
                ? `Hello **${currentUser.name}**! I am the **Bergman Elite AI**. How can I assist you with your performance journey today?`
                : "Hello! I am the **Bergman Elite AI**. Ask me anything about our races, rules, or your performance.";
            
            setMessages([{
                id: Date.now(),
                text: greeting,
                from: 'bot'
            }]);
            initialGreetingSent.current = true;
        }
        setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, fetchAppData, currentUser]);

    useEffect(() => {
        setIsClientMounted(true);
    }, []);

    useEffect(() => {
        let active = true;

        const fetchUpcomingRaces = async () => {
            if (!isOpen || !currentUser?.email) {
                setUpcomingRaceNames([]);
                return;
            }

            try {
                const races = await getUpcomingRacesFromKV(currentUser.email);
                if (!active) return;
                setUpcomingRaceNames((races || []).map(r => r.eventName).filter(Boolean));
            } catch (error) {
                if (!active) return;
                console.warn('Upcoming races prefetch failed:', error);
            }
        };

        fetchUpcomingRaces();
        return () => {
            active = false;
        };
    }, [isOpen, currentUser?.email]);

  const scrollToBottom = useCallback(() => {
      if (scrollAreaRef.current) {
         const scrollableViewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
         if (scrollableViewport) {
            scrollableViewport.scrollTo({ top: scrollableViewport.scrollHeight, behavior: 'smooth' });
         }
      }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);
  
  const handleSendMessage = useCallback(async (messageText: string) => {
    const userMessage = messageText.trim();
    if (!userMessage || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), text: userMessage, from: 'user' }]);
    setIsLoading(true);

    try {
        const cacheKey = userMessage.toLowerCase().trim();
        const cachedReply = responseCacheRef.current.get(cacheKey);
        if (cachedReply) {
            setMessages(prev => [...prev, { id: Date.now() + 1, text: cachedReply, from: 'bot' }]);
            return;
        }

        // Ensure we have context data, fetch if empty
        let faqs = allFaqs;
        let events = allEvents;
        
        if (faqs.length === 0 || events.length === 0) {
            const [faqResult, eventResult] = await Promise.all([
                getFaqsAction(),
                getCalendarEventsAction()
            ]);
            
            if (faqResult.success && faqResult.faqs) faqs = faqResult.faqs;
            if (eventResult.success && eventResult.events) events = eventResult.events;
        }
        
                const queryTerms = userMessage
                    .toLowerCase()
                    .split(/[^a-z0-9]+/)
                    .filter(t => t.length > 2);

                const rankedFaqs = [...faqs]
                    .map(f => {
                        const hay = `${f.question} ${f.answer}`.toLowerCase();
                        const score = queryTerms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
                        return { faq: f, score };
                    })
                    .sort((a, b) => b.score - a.score);

                const selectedFaqs = rankedFaqs.some(r => r.score > 0)
                    ? rankedFaqs.filter(r => r.score > 0).slice(0, 25).map(r => r.faq)
                    : rankedFaqs.slice(0, 15).map(r => r.faq);

                const context = selectedFaqs.map(f => ({ question: f.question, answer: f.answer }));
        
        // FILTER: Only include UPCOMING events in the context
        const today = startOfDay(new Date());
        const upcomingEvents = events.filter(e => {
            if (!e.eventDate || e.eventDate === 'TBD') return true;
            try {
                return !isBefore(parseISO(e.eventDate), today);
            } catch {
                return false;
            }
        });

                if (isCutoffQuestion(userMessage)) {
                        const fastCutoffReply = getCutoffAnswer(upcomingEvents);
                    responseCacheRef.current.set(cacheKey, fastCutoffReply);
                        setMessages(prev => [...prev, { id: Date.now() + 1, text: fastCutoffReply, from: 'bot' }]);
                        return;
                }

                const quickIntentReply = getQuickIntentReply(userMessage, upcomingRaceNames, !!currentUser?.uid);
                if (quickIntentReply) {
                    responseCacheRef.current.set(cacheKey, quickIntentReply);
                    setMessages(prev => [...prev, { id: Date.now() + 1, text: quickIntentReply, from: 'bot' }]);
                    return;
                }

                                const lowerMessage = userMessage.toLowerCase();
                                const asksTopAthlete =
                                    lowerMessage.includes('rank number one') ||
                                    lowerMessage.includes('number one') ||
                                    lowerMessage.includes('top athlete') ||
                                    lowerMessage.includes('who is ranked') ||
                                    lowerMessage.includes('athlete ranking');
                                const asksTopClub =
                                    lowerMessage.includes('top club') ||
                                    lowerMessage.includes('club holds the top') ||
                                    lowerMessage.includes('club ranking') ||
                                    lowerMessage.includes('club rankings');

                                if (asksTopAthlete || asksTopClub) {
                                    try {
                                        const [athleteRes, clubRes] = await Promise.all([
                                            asksTopAthlete ? getAthleteRankingData({}) : Promise.resolve(null as any),
                                            asksTopClub ? getClubRankingData({}) : Promise.resolve(null as any),
                                        ]);

                                        const topAthlete = asksTopAthlete
                                            ? (athleteRes?.rankings || []).find((a: any) => a.overallRank === 1) || (athleteRes?.rankings || [])[0]
                                            : null;
                                        const topClub = asksTopClub
                                            ? (clubRes?.rankings || []).find((c: any) => c.overallRank === 1) || (clubRes?.rankings || [])[0]
                                            : null;

                                        const rankingLines: string[] = [];
                                        if (asksTopAthlete) {
                                            rankingLines.push(
                                                topAthlete
                                                    ? `- **Current #1 Athlete:** ${topAthlete.name} (${topAthlete.totalPoints || 0} pts)`
                                                    : '- **Current #1 Athlete:** Not available right now.'
                                            );
                                        }
                                        if (asksTopClub) {
                                            rankingLines.push(
                                                topClub
                                                    ? `- **Current #1 Club:** ${topClub.clubName} (${topClub.totalPoints || 0} pts)`
                                                    : '- **Current #1 Club:** Not available right now.'
                                            );
                                        }

                                        rankingLines.push('', '- Full tables: [Athlete Rankings](/athlete-rankings) | [Club Rankings](/club-rankings)');
                                        const rankingReply = rankingLines.join('\n');

                                        responseCacheRef.current.set(cacheKey, rankingReply);
                                        setMessages(prev => [...prev, { id: Date.now() + 1, text: rankingReply, from: 'bot' }]);
                                        return;
                                    } catch (rankingError) {
                                        console.warn('Ranking quick lookup failed:', rankingError);
                                        const fallbackRankingReply = 'You can view the latest leaderboard here: [Athlete Rankings](/athlete-rankings) and [Club Rankings](/club-rankings).';
                                        responseCacheRef.current.set(cacheKey, fallbackRankingReply);
                                        setMessages(prev => [...prev, { id: Date.now() + 1, text: fallbackRankingReply, from: 'bot' }]);
                                        return;
                                    }
                                }

                const selectedEvents = queryTerms.length > 0
                    ? upcomingEvents
                            .map(e => {
                                const hay = `${e.eventName} ${e.description || ''} ${e.customRules || ''}`.toLowerCase();
                                const score = queryTerms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
                                return { event: e, score };
                            })
                            .sort((a, b) => b.score - a.score)
                    : upcomingEvents.map(e => ({ event: e, score: 0 }));

                const eventContext = selectedEvents
                    .filter((e, idx) => e.score > 0 || idx < 8)
                    .slice(0, 8)
                    .map(({ event: e }) => {
            const cutoffs = e.ticketDefinitions?.map(t => {
                const c = t.cutoffs;
                const mode = c?.mode || 'overall';
                const base = mode === 'overall' ? `Overall: ${c?.overall || 'N/A'}` : `Swim: ${c?.swim || 'N/A'}, Bike: ${c?.bike || 'N/A'}, Run: ${c?.run || 'N/A'}`;
                return `${t.ticketName}: ${base}`;
            }).join(' | ');

            return {
                eventName: e.eventName,
                description: e.description,
                customRules: e.customRules,
                venue: e.venueName,
                cutoffInfo: cutoffs
            };
        });

        const userProfile = currentUser ? {
            name: currentUser.name,
            tier: currentUser.role || 'Athlete',
            points: 0,
            uid: currentUser.uid,
            upcomingRaces: upcomingRaceNames,
        } : null;
        
        try {
            const reply = await Promise.race<string>([
                askEliteAi({
                    question: userMessage,
                    context,
                    userProfile,
                    eventContext
                }),
                new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error('AI response timed out')), AI_TIMEOUT_MS)
                )
            ]);

            responseCacheRef.current.set(cacheKey, reply);
            setMessages(prev => [...prev, { id: Date.now() + 1, text: reply, from: 'bot' }]);
            
            logAiInteractionAction({
                userUid: currentUser?.uid || null,
                userName: currentUser?.name || 'Guest',
                question: userMessage,
                answer: reply
            }).catch(err => console.warn('Log interaction failed:', err));
        } catch (aiError) {
            // Fallback: Search FAQs manually if AI fails
            console.error("AI Error, attempting FAQ fallback:", aiError);

            const relevantFaqs = rankedFaqs
                .filter(r => r.score > 0)
                .slice(0, 2)
                .map(r => r.faq);
            
            if (relevantFaqs.length > 0) {
                const fallbackResponse = `**Based on our knowledge base:**\n\n${relevantFaqs.map(f => `**Q: ${f.question}**\n${f.answer}`).join('\n\n')}\n\n---\n*If you need more help, please visit [Contact Us](/contact-us).*`;
                responseCacheRef.current.set(cacheKey, fallbackResponse);
                setMessages(prev => [...prev, { id: Date.now() + 1, text: fallbackResponse, from: 'bot' }]);
            } else {
                const errorMsg = aiError instanceof Error ? aiError.message : 'Unknown error';
                setMessages(prev => [...prev, { id: Date.now() + 1, text: `I encountered a technical issue: ${errorMsg}. Please visit [Contact Us](/contact-us) for support.`, from: 'bot' }]);
            }
        }

    } catch (error) {
        console.error("Message Handler Error:", error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
        setMessages(prev => [...prev, { id: Date.now() + 1, text: `System error: ${errorMsg}. Please [contact support](/contact-us).`, from: 'bot' }]);
    } finally {
        setIsLoading(false);
    }
    }, [isLoading, allFaqs, allEvents, currentUser, upcomingRaceNames]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(input);
    }
  };

  const getInternalActions = (text: string | undefined) => {
      if (!text) return [];
      const actions: { label: string, url: string }[] = [];
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(text)) !== null) {
          actions.push({ label: match[1], url: match[2] });
      }
      if (actions.length === 0) {
          const supportKeywords = ['contact', 'support', 'reach out', 'info@bergmantri.com'];
          if (supportKeywords.some(k => text.toLowerCase().includes(k.toLowerCase()))) {
              actions.push({ label: 'Open Contact Form', url: '/contact-us' });
          }
      }
      return actions;
  };

    if (isLedCleanRoute) {
        return null;
    }

    if (!isClientMounted) {
        return null;
    }

    return createPortal(
    <>
      <div className={cn("fixed bottom-4 right-4 z-50 transition-all duration-300", {
        'opacity-0 translate-y-2 pointer-events-none': isOpen,
        'opacity-100 translate-y-0': !isOpen
      })}>
        <Button
          size="lg"
          className="rounded-full w-16 h-16 p-0 shadow-2xl bg-orange-500 border-2 border-orange-600 hover:scale-110 transition-transform flex items-center justify-center overflow-hidden hover:bg-orange-600"
          onClick={() => setIsOpen(true)}
        >
          <Bot className="h-8 w-8 text-white relative z-10" />
        </Button>
      </div>

      <div className={cn(
        "fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] sm:w-[450px] h-[75vh] sm:h-[650px] flex flex-col bg-slate-950 border border-orange-500/20 rounded-3xl shadow-[0_0_50px_rgba(249,115,22,0.2)] transition-all duration-500 transform",
        {
          'opacity-100 translate-y-0 scale-100': isOpen,
          'opacity-0 translate-y-8 scale-95 pointer-events-none': !isOpen,
        }
      )}>
        <div className="flex items-center justify-between p-5 border-b border-orange-500/10 bg-orange-500/5 rounded-t-3xl">
          <div className="flex items-center gap-3 text-left">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center">
                <Bot className="h-6 w-6 text-orange-500" />
            </div>
            <div className="text-left">
                <h3 className="text-sm font-black uppercase italic tracking-tighter text-white flex items-center gap-2">
                    Elite Bergman AI <Sparkles className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                </h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">Context Aware Assistant</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="rounded-full h-8 w-8 text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-5" ref={scrollAreaRef}>
          <div className="space-y-6">
            {messages.map((message) => {
                const actions = message.from === 'bot' ? getInternalActions(message.text) : [];
                
                return (
                    <div
                        key={message.id}
                        className={cn("flex flex-col gap-3", {
                        'items-end': message.from === 'user',
                        'items-start': message.from === 'bot',
                        })}
                    >
                        <div
                            className={cn(
                                "min-w-0 w-full",
                                message.from === 'user'
                                    ? "flex items-end gap-3 justify-end"
                                    : "grid grid-cols-[2rem_minmax(0,1fr)] items-end gap-3"
                            )}
                        >
                            {message.from === 'bot' && (
                                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mb-1">
                                    <Bot className="h-4 w-4 text-primary" />
                                </div>
                            )}
                            <div
                            className={cn("rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm min-w-0 max-w-full", message.from === 'user' ? "bg-primary text-white font-bold rounded-br-none" : "w-full bg-slate-900 text-slate-200 border border-white/5 rounded-bl-none")}
                            style={{ maxWidth: message.from === 'user' ? '80%' : '100%' }}
                            >
                                <ReactMarkdown 
                                    className="markdown-container block w-full max-w-full min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                                    components={{
                                        p: ({node, ...props}) => <p className="mb-2 last:mb-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]" {...props} />,
                                        ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2 space-y-1" {...props} />,
                                        ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2 space-y-1" {...props} />,
                                        li: ({node, ...props}) => <li className="mb-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]" {...props} />,
                                        strong: ({node, ...props}) => <strong className={cn("font-black break-words", message.from === 'bot' ? "text-primary" : "text-white")} {...props} />,
                                        h1: ({node, ...props}) => <h1 className="text-lg font-black uppercase italic mb-2 break-words" {...props} />,
                                        h2: ({node, ...props}) => <h2 className="text-base font-black uppercase italic mb-2 break-words" {...props} />,
                                        h3: ({node, ...props}) => <h3 className="text-sm font-black uppercase italic mb-1 break-words" {...props} />,
                                        a: ({node, ...props}) => <span className="text-primary font-bold break-words">{props.children}</span>, 
                                    }}
                                >
                                    {message.text}
                                </ReactMarkdown>
                            </div>
                            {message.from === 'user' && (
                                <div className="h-8 w-8 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 mb-1">
                                    <User className="h-4 w-4 text-slate-400" />
                                </div>
                            )}
                        </div>
                        
                        {actions.length > 0 && (
                            <div className="pl-11 w-full flex flex-wrap gap-2 animate-in fade-in slide-in-from-left-2 duration-700">
                                {actions.map((action, i) => (
                                    <Button key={i} asChild size="sm" variant="outline" className="rounded-xl bg-primary/10 border-primary/20 text-primary hover:bg-primary hover:text-white font-bold uppercase text-[10px] tracking-widest gap-2 h-9 px-4">
                                        <Link href={action.url} onClick={() => { if (!action.url.startsWith('http')) setIsOpen(false); }}>
                                            {action.label} <ArrowRight className="h-3 w-3" />
                                        </Link>
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
             {isLoading && (
              <div className="flex items-end gap-3 justify-start animate-in fade-in slide-in-from-bottom-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mb-1">
                      <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-slate-900 border border-white/5 rounded-2xl px-4 py-3 rounded-bl-none">
                     <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></span>
                     </div>
                  </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {!isLoading && messages.length === 1 && (
            <div className="px-5 pb-2 flex flex-wrap gap-2 animate-in fade-in duration-1000">
                {['When is my next race?', 'What are the cutoffs?', 'Check my points', 'View Club Rankings'].map(q => (
                    <button 
                        key={q}
                        onClick={() => handleSendMessage(q)}
                        className="text-[10px] font-black uppercase tracking-tight px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-primary/50 transition-all"
                    >
                        {q}
                    </button>
                ))}
            </div>
        )}

        <div className="p-5 border-t border-white/5 bg-slate-900/50 rounded-b-3xl">
          <div className="relative group">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Elite AI..."
              className="w-full pr-14 resize-none bg-slate-950 border-white/10 text-white rounded-2xl focus:ring-primary focus:border-primary transition-all min-h-[60px]"
              rows={2}
              disabled={isLoading}
            />
            <Button
              type="button"
              size="icon"
              className="absolute right-2 bottom-2 h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-transform active:scale-95"
              onClick={() => handleSendMessage(input)}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">
              <ShieldCheck className="h-3 w-3" /> Encrypted & Secure • Powered by Bergman Intelligence
          </div>
        </div>
      </div>
    </>
        , document.body
  );
}
