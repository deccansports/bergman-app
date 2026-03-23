
"use client";

import Link from "next/link";
import { MessageSquareText } from "lucide-react";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <MessageSquareText className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold tracking-tight text-primary font-headline">WelcomeNote</span>
          </Link>
          <div className="hidden md:flex gap-6">
            <Link href="#" className="text-sm font-medium hover:text-primary transition-colors">Features</Link>
            <Link href="#" className="text-sm font-medium hover:text-primary transition-colors">About</Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
