// src/app/media/[eventId]/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { LiveAthlete, Sponsor } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

const MediaLeaderboard = ({ title, athletes }: { title: string; athletes: LiveAthlete[] }) => (
  <div className="p-4 bg-black/30 rounded-lg">
    <h2 className="text-2xl font-bold text-yellow-400 mb-2">{title}</h2>
    <div className="space-y-1">
      {athletes.slice(0, 10).map((athlete, index) => (
        <div key={athlete.id} className="flex items-center justify-between text-xl p-1 bg-black/20 rounded">
          <span className="font-semibold text-slate-300">{index + 1}. {athlete.name}</span>
          <span className="font-mono text-yellow-300">{athlete.bib}</span>
        </div>
      ))}
    </div>
  </div>
);

const FinishersFeed = ({ athletes }: { athletes: LiveAthlete[] }) => (
  <div className="p-4 bg-black/30 rounded-lg">
    <h2 className="text-2xl font-bold text-yellow-400 mb-2">Recent Finishers</h2>
    <AnimatePresence>
      <div className="space-y-2">
        {athletes.slice(0, 5).map((athlete) => (
          <motion.div
            key={athlete.id}
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="p-2 bg-green-900/50 border-l-4 border-green-400 rounded"
          >
            <p className="text-2xl font-bold text-white">{athlete.name} has finished!</p>
            <p className="text-lg text-slate-300">BIB: {athlete.bib}</p>
          </motion.div>
        ))}
      </div>
    </AnimatePresence>
  </div>
);


export default function MediaDashboardPage({ params }: { params: { eventId: string } }) {
  const { eventId } = params;
  const [liveData, setLiveData] = useState<LiveAthlete[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    
    // Fetch Live Athletes
    const liveAthletesQuery = query(collection(db, "events", eventId, "liveAthletes"));
    const unsubscribeAthletes = onSnapshot(liveAthletesQuery, (snapshot) => {
      const athletes: LiveAthlete[] = [];
      snapshot.forEach(doc => athletes.push({ id: doc.id, ...doc.data() } as LiveAthlete));
      setLiveData(athletes);
      setIsLoading(false);
    });

    // Fetch Sponsors
    const sponsorsQuery = query(collection(db, "events", eventId, "sponsors"), orderBy("order", "asc"));
    const unsubscribeSponsors = onSnapshot(sponsorsQuery, (snapshot) => {
      const fetchedSponsors: Sponsor[] = [];
      snapshot.forEach(doc => fetchedSponsors.push({ id: doc.id, ...doc.data() } as Sponsor));
      setSponsors(fetchedSponsors);
    });

    return () => {
      unsubscribeAthletes();
      unsubscribeSponsors();
    };
  }, [eventId]);

  const { overallLeaders, femaleLeaders, finishers } = useMemo(() => {
    const sorted = [...liveData].sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
    return {
      overallLeaders: sorted,
      femaleLeaders: sorted.filter(a => a.gender === 'Female'),
      finishers: sorted.filter(a => a.status === 'Finished').sort((a,b) => (b.lastUpdateTime || 0) - (a.lastUpdateTime || 0)),
    };
  }, [liveData]);
  
  const views = useMemo(() => [
      { id: 'overall', component: <MediaLeaderboard title="Overall Top 10" athletes={overallLeaders} />, hasData: overallLeaders.length > 0 },
      { id: 'female', component: <MediaLeaderboard title="Women's Race Top 10" athletes={femaleLeaders} />, hasData: femaleLeaders.length > 0 },
      { id: 'finishers', component: <FinishersFeed athletes={finishers} />, hasData: finishers.length > 0 },
  ].filter(v => v.hasData), [overallLeaders, femaleLeaders, finishers]);

  useEffect(() => {
    if (views.length === 0) return;
    const timer = setInterval(() => {
      setCurrentViewIndex(prev => (prev + 1) % views.length);
    }, 15000); // Rotate every 15 seconds
    return () => clearInterval(timer);
  }, [views.length]);


  if (isLoading) {
    return <div className="flex h-screen w-screen items-center justify-center bg-black"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
  }

  return (
    <div className="w-screen h-screen bg-black text-white p-6 flex flex-col font-sans">
      <header className="flex justify-between items-center pb-4">
        <h1 className="text-5xl font-extrabold text-yellow-400">Bergman Race Live</h1>
        {/* Placeholder for event name if needed */}
      </header>

      <main className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentViewIndex}
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ duration: 0.7 }}
                >
                    {views[currentViewIndex]?.component || <div className="p-4 bg-black/30 rounded-lg text-center"><p>No data to display for this view.</p></div>}
                </motion.div>
            </AnimatePresence>
        </div>

        <div className="space-y-6">
            <MediaLeaderboard title="Male Leaders" athletes={overallLeaders.filter((a: LiveAthlete) => a.gender === 'Male')} />
        </div>
      </main>

      <footer className="pt-4 mt-auto">
        <div className="bg-black/30 rounded-lg p-2 flex justify-around items-center h-20">
          {sponsors.map(sponsor => (
             <div key={sponsor.id} className="relative h-16 w-32">
                <Image src={sponsor.logoUrl} alt={sponsor.name} fill className="object-contain" />
             </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
