"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from 'next/navigation'
import { Menu, ExternalLink } from 'lucide-react'

import type { EventCalendarEntry, Page } from '@/lib/types';
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "@/components/ui/sheet"
import { useMemo } from 'react';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Separator } from "@/components/ui/separator"


interface MobileNavProps {
    initialNavEvents?: EventCalendarEntry[];
    initialNavPages?: Page[];
}

export function MobileNav({ initialNavEvents = [], initialNavPages = [] }: MobileNavProps) {
  const pathname = usePathname()

  const navEvents = useMemo(() => {
    if (!Array.isArray(initialNavEvents)) return [];
    const now = new Date();
    return initialNavEvents.filter(event => {
      if (event.isHidden) return false;
      if (!event.eventDate) return true; // Keep TBD events
      try {
        const eventDate = parseISO(event.eventDate);
        return !isBefore(eventDate, startOfDay(now));
      } catch {
        return false;
      }
    });
  }, [initialNavEvents]);

  const navPages = useMemo(() => {
      return Array.isArray(initialNavPages) ? initialNavPages : [];
  }, [initialNavPages]);

  const navLinks = useMemo(() => {
    return navPages
      .filter(p => p.showInHeader && p.published)
      .map(p => {
        let href = '/';
        if (p.url && !p.eventId) { // External or absolute internal URL
          href = p.url;
        } else if (p.eventId) { // Linked event
          const event = navEvents.find(e => e.id === p.eventId);
          if (event) {
            href = event.customSlug ? `/races/${event.customSlug}` : `/races/${event.id}`;
          } else {
            href = `/races`; // Fallback if event not found/not upcoming
          }
        } else if (p.slug !== 'home') {
          href = p.slug === 'triathlon-india' ? '/triathlon-india' : `/content/${p.slug}`;
        }
        
        const link = {
            title: p.title,
            href: href,
            isExternal: !!p.url && p.url.startsWith('http'),
            dropdown: [] as { title: string; href: string }[]
        };

        if (p.slug === 'races' && navEvents.length > 0) {
            link.dropdown = navEvents.map(e => ({
                title: e.eventName,
                href: `/races/${e.customSlug || e.id}`
            }));
        }
        return link;
    });
  }, [navPages, navEvents]);

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    // More specific check for nested routes
    return pathname.startsWith(href);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle Menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <nav className="flex flex-col gap-2 text-lg font-medium mt-8">
            {navLinks.map(link => {
              if (link.dropdown.length > 0) {
                return (
                  <Accordion key={link.title} type="single" collapsible className="w-full">
                    <AccordionItem value={link.title} className="border-b-0">
                      <AccordionTrigger className="px-2.5 py-2 text-lg">
                        {link.title}
                      </AccordionTrigger>
                      <AccordionContent className="pl-4">
                        <div className="flex flex-col gap-2">
                          <SheetClose asChild>
                             <Link href="/races" className="text-base py-2 hover:text-primary transition-colors">All Races</Link>
                          </SheetClose>
                          <Separator />
                          {link.dropdown.map(item => (
                            <SheetClose key={item.href} asChild>
                              <Link href={item.href} className="text-base py-2 hover:text-primary transition-colors">{item.title}</Link>
                            </SheetClose>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )
              }
              
              if (link.isExternal) {
                return (
                  <a key={link.title} href={link.href} target="_blank" rel="noopener noreferrer" className={cn("flex items-center gap-4 px-2.5 py-2 text-foreground hover:text-primary transition-colors", isActive(link.href) && "font-semibold text-primary")}>
                    {link.title} <ExternalLink className="h-4 w-4" />
                  </a>
                )
              }

              return (
                <SheetClose key={link.title} asChild>
                   <Link href={link.href} className={cn("flex items-center gap-4 px-2.5 py-2 text-foreground hover:text-primary transition-colors", isActive(link.href) && "font-semibold text-primary")}>
                    {link.title}
                  </Link>
                </SheetClose>
              )
            })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
