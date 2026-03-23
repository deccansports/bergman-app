// src/app/live/page.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Tv, Trophy } from 'lucide-react';
import Image from 'next/image';

interface LiveControl {
    embedUrl: string;
    location: string;
    updatedAt: string;
}

interface Sponsor {
    logoUrl: string;
    name: string;
}

interface Leaderboard {
    [rank: string]: string;
}

export default function LiveDisplayPage() {
    const [liveControl, setLiveControl] = useState<LiveControl | null>(null);
    const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
    const [sponsor, setSponsor] = useState<Sponsor | null>({name: "Bergman Triathlon", logoUrl: "/bmlogo.png"});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const controlDocRef = doc(db, 'liveControl', 'current');
        const unsubscribeControl = onSnapshot(controlDocRef, (doc) => {
            if (doc.exists()) {
                setLiveControl(doc.data() as LiveControl);
            } else {
                setLiveControl(null);
            }
            setIsLoading(false);
        });

        // Placeholder for leaderboard and sponsor listeners
        const leaderboardDocRef = doc(db, 'leaderboard', 'current');
        const unsubscribeLeaderboard = onSnapshot(leaderboardDocRef, (doc) => {
            if (doc.exists()) {
                setLeaderboard(doc.data() as Leaderboard);
            }
        });
        
        const sponsorDocRef = doc(db, 'sponsor', 'bannerText');
        const unsubscribeSponsor = onSnapshot(sponsorDocRef, (doc) => {
             if (doc.exists()) {
                setSponsor(doc.data() as Sponsor);
            }
        });


        return () => {
            unsubscribeControl();
            unsubscribeLeaderboard();
            unsubscribeSponsor();
        };
    }, []);

    const isBlackScreen = liveControl?.location === 'BLACK SCREEN' || !liveControl?.embedUrl;
    
    return (
        <div className="w-screen h-screen bg-black text-white font-sans overflow-hidden">
            {isLoading ? (
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                </div>
            ) : isBlackScreen ? (
                 <div className="w-full h-full flex flex-col items-center justify-center bg-black p-4 text-center">
                    <Image src="/Bmlogowhite.png" alt="Bergman Logo" width={300} height={100} className="object-contain" />
                    <p className="text-slate-400 mt-6 text-xl">We will be back shortly for live streaming</p>
                 </div>
            ) : (
                <iframe
                    id="liveFrame"
                    src={`${liveControl.embedUrl}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0`}
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    className="w-full h-full border-none"
                ></iframe>
            )}
            
            <div className="absolute inset-0 pointer-events-none">
                {/* Leaderboard Overlay */}
                <div className="absolute top-5 right-5 w-80 bg-slate-900/80 backdrop-blur-sm p-4 rounded-xl border border-slate-700/50">
                    <h3 className="text-lg font-bold text-blue-400 mb-2 flex items-center gap-2"><Trophy className="h-5 w-5"/>Live Leaderboard</h3>
                    <div className="space-y-1 text-sm">
                        {leaderboard ? Object.entries(leaderboard).map(([rank, text]) => (
                            <div key={rank} className="flex items-center gap-2">
                                <span className="font-bold w-6 text-slate-400">{rank}.</span>
                                <span className="text-slate-200">{text}</span>
                            </div>
                        )) : <p className="text-xs text-slate-400">Leaderboard data is currently unavailable.</p>}
                    </div>
                </div>

                {/* Sponsor Overlay */}
                <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-center p-4">
                    {sponsor && (
                        <div className="flex items-center gap-4">
                           <p className="text-slate-300 text-lg font-semibold">{sponsor.name}</p>
                           <Image src={sponsor.logoUrl} alt={sponsor.name} width={120} height={40} className="object-contain" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
