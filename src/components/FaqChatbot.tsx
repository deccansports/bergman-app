// src/components/FaqChatbot.tsx
"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, User, Loader2, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { ScrollArea } from './ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import Link from 'next/link';

interface Message {
  id: number;
  text: string;
  from: 'user' | 'bot';
}

export default function FaqChatbot() {
  const { currentUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const initialGreetingSent = useRef(false);

  useEffect(() => {
    if (isOpen) {
        if (!initialGreetingSent.current) {
            const greeting = currentUser?.name 
                ? `Hello **${currentUser.name}**! Welcome to the Bergman Elite Assistant. How can I help you today?`
                : "Hello! I am the **Bergman Elite Assistant**. Ask me about race registration, upcoming events, or your rankings.";
            
            setMessages([{ id: Date.now(), text: greeting, from: 'bot' }]);
            initialGreetingSent.current = true;
        }
        setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, currentUser]);

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
        const userProfile = currentUser ? {
            name: currentUser.name,
            tier: currentUser.ownedClubId ? 'Club Owner' : (currentUser.isVolunteer ? 'Volunteer' : 'Athlete'),
            upcomingRaces: currentUser.upcomingEvents?.map(e => e.eventName) || [],
        } : null;

        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: userMessage, userProfile })
        });

        const data = await res.json();
        const reply = data.reply;

        setMessages(prev => [...prev, { id: Date.now() + 1, text: reply, from: 'bot' }]);

    } catch (error: any) {
        console.error("AI Error:", error);
        setMessages(prev => [...prev, { 
            id: Date.now() + 1, 
            text: "Please try again in a moment or contact info@bergmantri.com.", 
            from: 'bot' 
        }]);
    } finally {
        setIsLoading(false);
    }
  }, [isLoading, currentUser]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(input);
    }
  };

  const getInternalActions = (text: string) => {
      const actions: { label: string, url: string }[] = [];
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(text)) !== null) {
          actions.push({ label: match[1], url: match[2] });
      }
      return actions;
  };

  return (
    <>
      <div className={cn("fixed bottom-4 right-4 z-50 transition-all duration-300", {
        'opacity-0 translate-y-2 pointer-events-none': isOpen,
        'opacity-100 translate-y-0': !isOpen
      })}>
        <Button
          size="lg"
          className="rounded-full w-16 h-16 p-0 shadow-2xl bg-slate-950 border border-white/10 hover:scale-110 transition-transform"
          onClick={() => setIsOpen(true)}
        >
          <Bot className="h-8 w-8 text-orange-50" />
        </Button>
      </div>

      <div className={cn(
        "fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] sm:w-[450px] h-[75vh] sm:h-[650px] flex flex-col bg-slate-950 border border-white/10 rounded-[2.5rem] shadow-2xl transition-all duration-500 transform",
        {
          'opacity-100 translate-y-0 scale-100': isOpen,
          'opacity-0 translate-y-8 scale-95 pointer-events-none': !isOpen,
        }
      )}>
        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-slate-900/50 rounded-t-[2.5rem]">
          <div className="flex items-center gap-3 text-left">
            <div className="h-10 w-10 rounded-full bg-slate-800 flex items-center justify-center border border-white/10">
                <Bot className="h-6 w-6 text-orange-50" />
            </div>
            <div className="text-left">
                <h3 className="text-sm font-black uppercase italic tracking-tighter text-white flex items-center gap-2 text-left">
                    Bergman Elite AI <Sparkles className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                </h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-500/70 text-left">Virtual Race Official</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="rounded-full h-8 w-8 text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-5" ref={scrollAreaRef}>
          <div className="space-y-6 text-left">
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
                        <div className={cn("flex items-end gap-3 w-full", message.from === 'user' ? "justify-end" : "justify-start")}>
                            {message.from === 'bot' && (
                                <div className="h-8 w-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 mb-1">
                                    <Bot className="h-4 w-4 text-orange-50" />
                                </div>
                            )}
                            <div
                            className={cn("max-w-[85%] rounded-[2rem] px-5 py-3 text-sm leading-relaxed shadow-sm text-left", {
                                'bg-orange-600 text-white font-bold rounded-br-none': message.from === 'user',
                                'bg-slate-900 text-slate-200 border border-white/5 rounded-bl-none': message.from === 'bot',
                            })}
                            >
                                <ReactMarkdown 
                                    components={{
                                        p: ({node, ...props}) => <p className="mb-2 last:mb-0 text-left" {...props} />,
                                        strong: ({node, ...props}) => <strong className={cn("font-black", message.from === 'bot' ? "text-orange-500" : "text-white")} {...props} />,
                                        a: ({node, ...props}) => <span className="text-orange-500 font-bold">{props.children}</span>, 
                                    }}
                                >
                                    {message.text}
                                </ReactMarkdown>
                            </div>
                            {message.from === 'user' && (
                                <div className="h-8 w-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 mb-1">
                                    <User className="h-4 w-4 text-slate-400" />
                                </div>
                            )}
                        </div>
                        
                        {actions.length > 0 && (
                            <div className="pl-11 w-full flex flex-wrap gap-2 text-left">
                                {actions.map((action, i) => (
                                    <Button key={i} asChild size="sm" variant="outline" className="rounded-full bg-orange-600/10 border-orange-600/20 text-orange-500 hover:bg-orange-600 hover:text-white font-bold uppercase text-[10px] tracking-widest gap-2 h-9 px-5">
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
              <div className="flex items-end gap-3 justify-start text-left">
                  <div className="h-8 w-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 mb-1">
                      <Bot className="h-4 w-4 text-orange-50" />
                  </div>
                  <div className="bg-slate-900 border border-white/5 rounded-[2rem] px-5 py-3 rounded-bl-none">
                     <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                        <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce"></span>
                     </div>
                  </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-5 border-t border-white/5 bg-slate-900/50 rounded-b-[2.5rem]">
          <div className="relative text-left">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the Elite Assistant..."
              className="w-full pr-14 resize-none bg-slate-950 border-white/10 text-white rounded-2xl focus:ring-orange-500 min-h-[60px] text-left"
              rows={2}
              disabled={isLoading}
            />
            <Button
              type="button"
              size="icon"
              className="absolute right-2 bottom-2 h-10 w-10 rounded-xl bg-orange-600 hover:bg-orange-700"
              onClick={() => handleSendMessage(input)}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600 text-left">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3" /> Secure & Powered by Bergman AI
              </div>
              <Link href="/contact-us" className="text-orange-500 hover:text-white transition-colors" onClick={() => setIsOpen(false)}>
                Open Contact Form
              </Link>
          </div>
        </div>
      </div>
    </>
  );
}
