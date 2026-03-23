
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coffee, Sun, Moon, Sparkles } from "lucide-react";

export function WelcomeDisplay() {
  const [greeting, setGreeting] = useState<{ text: string; icon: React.ReactNode }>({
    text: "Welcome",
    icon: <Sparkles className="w-5 h-5" />,
  });

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      setGreeting({ text: "Good Morning", icon: <Coffee className="w-5 h-5" /> });
    } else if (hour < 18) {
      setGreeting({ text: "Good Afternoon", icon: <Sun className="w-5 h-5" /> });
    } else {
      setGreeting({ text: "Good Evening", icon: <Moon className="w-5 h-5" /> });
    }
  }, []);

  return (
    <div className="space-y-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div className="inline-flex items-center justify-center p-2 px-4 rounded-full bg-accent/20 text-primary border border-accent/30 gap-2 mb-2">
        {greeting.icon}
        <span className="text-xs font-bold uppercase tracking-wider">{greeting.text}</span>
      </div>
      
      <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground font-headline">
        A Warm Welcome to <span className="text-primary italic">WelcomeNote</span>
      </h1>
      
      <p className="max-w-2xl mx-auto text-lg text-muted-foreground leading-relaxed px-4">
        Discover a peaceful space designed to help you start your day with intention. 
        Personalized notes and a warm atmosphere await you.
      </p>

      <div className="flex flex-wrap justify-center gap-4 pt-4">
        <Badge variant="outline" className="px-4 py-1 text-sm bg-card shadow-sm border-accent/20">
          Personalized
        </Badge>
        <Badge variant="outline" className="px-4 py-1 text-sm bg-card shadow-sm border-accent/20">
          Inviting
        </Badge>
        <Badge variant="outline" className="px-4 py-1 text-sm bg-card shadow-sm border-accent/20">
          Accessible
        </Badge>
      </div>
    </div>
  );
}
