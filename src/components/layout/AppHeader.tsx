// src/components/layout/AppHeader.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/StoreCartContext';
import { useToast } from '@/hooks/use-toast';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useMemo, useState } from 'react';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { cn, isEventHidden } from "@/lib/utils";

import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  LogOut, 
  UserCircle, 
  LayoutDashboard, 
  ShieldCheck, 
  LogIn, 
  Home, 
  Trophy, 
  BarChart3, 
  UserSquare2, 
  ChevronDown, 
  Menu, 
  ExternalLink, 
  Loader2, 
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  X,
  History,
  Camera
} from 'lucide-react';
import type { EventCalendarEntry, Page } from '@/lib/types';
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";

interface AppHeaderProps {
  initialNavEvents?: EventCalendarEntry[];
  initialNavPages?: Page[];
}

export function AppHeader({
  initialNavEvents = [],
  initialNavPages = [],
}: AppHeaderProps) {
  const { currentUser, loading: authLoading } = useAuth();
  const { cart, totalCount, subtotal, removeFromCart, updateQty } = useCart();
  const { toast } = useToast();
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Logout Failed', description: error.message || 'Could not log out.' });
    }
  };

  const getInitials = (name?: string | null) => {
    if (!name || typeof name !== 'string') return '';
    const names = name.trim().split(' ') ?? [];
    if (names.length > 1) {
      return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
    }
    return name.trim().substring(0, 2).toUpperCase() ?? '';
  };
  
  const navEvents = useMemo(() => {
    if (!Array.isArray(initialNavEvents)) return [];
    const now = new Date();
    return initialNavEvents.filter(event => {
      if (isEventHidden(event)) return false;
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
        if (p.url && !p.eventId) { 
          if (p.url === '/content/about') href = '/about';
          else href = p.url;
        } else if (p.eventId) { // Linked event
          const event = navEvents.find(e => e.id === p.eventId);
          if (event) {
            href = event.customSlug ? `/races/${event.customSlug}` : `/races/${event.id}`;
          } else {
            href = `/races`; 
          }
        } else if (p.slug !== 'home') {
          if (p.slug === 'about') href = '/about';
          else if (p.slug === 'triathlon-india') href = '/triathlon-india';
          else href = `/content/${p.slug}`;
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
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div
      className="
        w-full
        backdrop-blur-md bg-background/70
        border-b
        supports-[backdrop-filter]:bg-background/60
        transition-all
      "
    >
      <div className="relative mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">

        {/* LEFT */}
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="Bergman Home">
            <Image
              src="/favicon.png"
              alt="Bergman Logo"
              width={44}
              height={44}
              priority
            />
          </Link>
          <nav className="hidden md:flex gap-4 items-center">
            {navLinks.map((link) => {
              if (link.dropdown.length > 0) {
                return (
                  <DropdownMenu key={link.title}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className={cn("text-sm font-medium text-muted-foreground transition-colors hover:text-primary", isActive(link.href) && "text-primary font-semibold")}>
                        {link.title} <ChevronDown className="ml-1 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem asChild>
                        <Link href="/races">All Races</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {link.dropdown.map(item => (
                        <DropdownMenuItem key={item.href} asChild>
                           <Link href={item.href}>{item.title}</Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }
              if (link.isExternal) {
                return (
                  <a key={link.title} href={link.href} target="_blank" rel="noopener noreferrer" className={cn("text-sm font-medium text-muted-foreground transition-colors hover:text-primary flex items-center gap-1", isActive(link.href) && "text-primary font-semibold")}>
                    {link.title} <ExternalLink className="h-3 w-3" />
                  </a>
                );
              }
              return (
                <Link key={link.title} href={link.href} className={cn("text-sm font-medium text-muted-foreground transition-colors hover:text-primary", isActive(link.href) && "text-primary font-semibold")}>
                  {link.title}
                </Link>
              );
            })}
          </nav>
        </div>
        
        {/* RIGHT */}
        <div className="flex items-center gap-3">
          <ThemeToggle />
          
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="relative hover:bg-primary/10 group transition-colors">
                <ShoppingBag className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                {totalCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-black rounded-full shadow-lg animate-in zoom-in duration-300">
                    {totalCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md flex flex-col p-0 border-none shadow-2xl bg-background overflow-hidden">
              <SheetHeader className="p-6 pb-4 border-b text-left">
                <SheetTitle className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                  Your Gear Bag
                </SheetTitle>
              </SheetHeader>
              
              <div className="flex-grow overflow-y-auto custom-scrollbar">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
                    <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center opacity-50">
                      <ShoppingBag className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">Your bag is empty</p>
                    <SheetClose asChild>
                      <Button variant="outline" className="rounded-xl font-bold uppercase text-xs" onClick={() => router.push('/shop')}>
                        Go To Shop
                      </Button>
                    </SheetClose>
                  </div>
                ) : (
                  <div className="divide-y">
                    {cart.map((item) => (
                      <div key={`${item.productId}-${item.size}`} className="p-6 flex gap-4 hover:bg-muted/30 transition-colors">
                        <div className="relative h-20 w-20 rounded-xl overflow-hidden bg-muted border shrink-0">
                          <Image src={item.image} alt={item.name} fill sizes="80px" className="object-cover" />
                        </div>
                        <div className="flex-grow space-y-1 text-left">
                          <h4 className="font-bold text-sm leading-tight line-clamp-2">{item.name}</h4>
                          <div className="flex items-center gap-2">
                            {item.size && <Badge variant="secondary" className="text-[10px] h-5 font-bold uppercase">{item.size}</Badge>}
                            <span className="text-[10px] text-muted-foreground font-bold uppercase">₹{item.salePrice}</span>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <div className="flex items-center border rounded-lg h-8 px-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateQty(item.productId, item.size, item.quantity - 1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center font-bold text-xs">{item.quantity}</span>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateQty(item.productId, item.size, item.quantity + 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full"
                              onClick={() => removeFromCart(item.productId, item.size)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <SheetFooter className="p-6 bg-slate-900 text-white flex-col sm:flex-col gap-4">
                  <div className="w-full space-y-2">
                    <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                      <span>Bag Subtotal</span>
                      <span className="text-white">₹{subtotal}</span>
                    </div>
                    <div className="flex justify-between items-end pt-2 border-t border-white/10">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-400">Estimated Total</span>
                      <span className="text-3xl font-black text-orange-500">₹{subtotal}</span>
                    </div>
                  </div>
                  <SheetClose asChild>
                    <Button 
                      className="w-full h-14 rounded-2xl bg-orange-600 hover:bg-orange-50 text-white font-black uppercase tracking-widest text-lg shadow-xl shadow-orange-600/20"
                      onClick={() => router.push('/checkout')}
                    >
                      Checkout <ArrowRight className="ml-2 h-6 w-6" />
                    </Button>
                  </SheetClose>
                </SheetFooter>
              )}
            </SheetContent>
          </Sheet>

          {(authLoading) ? (
            <div className="h-10 w-24 bg-muted rounded-md animate-pulse" />
          ) : currentUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                  <Avatar className="h-10 w-10 border-2 border-primary/50 hover:border-primary transition-colors duration-300">
                    <AvatarImage src={currentUser.photoURL || undefined} alt={currentUser.name || 'User profile picture'} className="object-cover" />
                    <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                      {getInitials(currentUser.name) || <UserCircle size={24}/>}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 mt-2 shadow-xl rounded-lg" align="end" forceMount>
                <DropdownMenuLabel className="font-normal px-3 py-2">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none text-foreground">{currentUser.name || (currentUser.ownedClubId ? "Club Owner" : (currentUser.isVolunteer ? "Volunteer" : "Athlete"))}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {currentUser.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer m-1 rounded">
                     <Link href="/dashboard">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        <span>Athlete Dashboard</span>
                     </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer m-1 rounded">
                     <Link href="/orders">
                        <History className="mr-2 h-4 w-4" />
                        <span>My Orders</span>
                     </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer m-1 rounded">
                     <Link href="/race-photos">
                        <Camera className="mr-2 h-4 w-4" />
                        <span>Race Photos</span>
                     </Link>
                  </DropdownMenuItem>
                {currentUser.ownedClubId && (
                  <DropdownMenuItem asChild className="cursor-pointer m-1 rounded">
                    <Link href="/club-dashboard">
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      <span>Club Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                {currentUser.isVolunteer && (
                  <DropdownMenuItem asChild className="cursor-pointer m-1 rounded">
                    <Link href="/volunteer/dashboard">
                      <UserSquare2 className="mr-2 h-4 w-4" />
                      <span>Volunteer Portal</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                 {currentUser.isAdmin && (
                  <DropdownMenuItem asChild className="cursor-pointer m-1 rounded">
                    <Link href="/admin/dashboard">
                      <Home className="mr-2 h-4 w-4" />
                      <span>Admin Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive m-1 rounded">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
             <Button variant="default" size="sm" asChild className="text-xs sm:text-sm">
              <Link href="/login">
                <LogIn className="mr-1.5 h-4 w-4" /> Login
              </Link>
            </Button>
          )}
          <MobileNav
            initialNavEvents={initialNavEvents}
            initialNavPages={initialNavPages}
          />
        </div>
      </div>
    </div>
  );
}
