
// src/app/triathlon-india/content.tsx
'use client';

import React from 'react';
import { Waves, Bike, Footprints, ShieldCheck, Globe, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export function TriathlonIndiaContent() {
  return (
    <div className="space-y-16">
      {/* TRIATHLON INDIA */}
      <section id="triathlon-india" className="text-left">
        <h2 className="text-3xl font-extrabold text-[#083A8C] mb-6 text-left">Triathlon in India</h2>
        <div className="space-y-4 text-slate-600 text-left">
          <p>
            Triathlon in India has grown significantly in recent years as athletes discover 
            the excitement of multisport endurance racing. A triathlon combines swimming, 
            cycling and running into a single race that tests strength, endurance and strategy.
          </p>
          <p>
            Across India, athletes now participate in sprint triathlons, Olympic triathlons 
            and long-distance endurance events. Bergman Triathlon is helping grow the 
            triathlon community by hosting professionally organised races across iconic 
            locations in the country. <Link href="/races" className="text-blue-600 font-semibold hover:underline">Explore Bergman races</Link>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
          <Card className="bg-[#F4F8FF] p-8 rounded-2xl border border-slate-200 text-left shadow-sm">
            <div className="h-12 w-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
              <Waves className="text-[#0B5ED7]" />
            </div>
            <h3 className="text-xl font-bold text-[#083A8C] mb-2 text-left">🏊 Swim</h3>
            <p className="text-sm text-slate-500 text-left">Open water swimming in lakes and reservoirs across the subcontinent.</p>
          </Card>

          <Card className="bg-[#F4F8FF] p-8 rounded-2xl border border-slate-200 text-left shadow-sm">
            <div className="h-12 w-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
              <Bike className="text-[#0B5ED7]" />
            </div>
            <h3 className="text-xl font-bold text-[#083A8C] mb-2 text-left">🚴 Bike</h3>
            <p className="text-sm text-slate-500 text-left">Fast, rolling cycling courses designed for peak performance.</p>
          </Card>

          <Card className="bg-[#F4F8FF] p-8 rounded-2xl border border-slate-200 text-left shadow-sm">
            <div className="h-12 w-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
              <Footprints className="text-[#0B5ED7]" />
            </div>
            <h3 className="text-xl font-bold text-[#083A8C] mb-2 text-left">🏃 Run</h3>
            <p className="text-sm text-slate-500 text-left">Flat and scenic running routes to finish your endurance journey strong.</p>
          </Card>
        </div>
      </section>

      {/* PUNE TRIATHLON */}
      <section id="pune-triathlon" className="text-left">
        <h2 className="text-3xl font-extrabold text-[#083A8C] mb-6 text-left">Pune Triathlon</h2>
        <p className="text-slate-600 mb-6 text-left">
          Pune has emerged as a major endurance sports hub in India with a strong 
          community of runners, cyclists and swimmers. The <Link href="/event-form/bergman-ozar-pune" className="text-blue-600 hover:underline">Bergman Ozar Pune Triathlon</Link> is one of the most exciting triathlon races organised near Pune.
        </p>
        <div className="bg-[#F4F8FF] border-l-4 border-[#0B5ED7] p-8 rounded-r-2xl text-left">
          <p className="text-slate-700 font-medium mb-4 text-left">
            Located near the sacred Ashtavinayak temple of Shri Vighnahar Ganpati in Ozar,
            this event combines endurance sport with cultural heritage and natural beauty.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            <li className="flex items-center justify-start gap-2 text-sm font-bold text-[#083A8C] text-left"><CheckCircle2 className="h-4 w-4 text-[#0B5ED7]"/> Open water lake swim</li>
            <li className="flex items-center justify-start gap-2 text-sm font-bold text-[#083A8C] text-left"><CheckCircle2 className="h-4 w-4 text-[#0B5ED7]"/> Fast rolling bike course</li>
            <li className="flex items-center justify-start gap-2 text-sm font-bold text-[#083A8C] text-left"><CheckCircle2 className="h-4 w-4 text-[#0B5ED7]"/> Completely flat run course</li>
          </ul>
        </div>
        <p className="mt-6 text-slate-600 text-left">
          The race is designed for athletes seeking both performance and a memorable 
          race-day experience in the heart of Maharashtra.
        </p>
      </section>

      {/* SWIMATHON INDIA */}
      <section id="swimathon-india" className="text-left">
        <h2 className="text-3xl font-extrabold text-[#083A8C] mb-6 text-left">Swimathon Events in India</h2>
        <p className="text-slate-600 mb-8 text-left">
          Swimathons are open water swimming events where athletes compete in natural 
          water bodies across multiple distances. These events have become popular among 
          triathletes and endurance swimmers preparing for larger competitions. <Link href="/results" className="text-blue-600 hover:underline">Check past swimathon results</Link>
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <Card className="border-none shadow-none bg-slate-50 p-6 rounded-2xl text-left">
            <h3 className="font-black text-2xl text-[#0B5ED7] mb-2 italic text-left">500m</h3>
            <p className="text-sm font-bold uppercase tracking-widest text-[#083A8C] mb-2 text-left">Beginner Swim</p>
            <p className="text-xs text-slate-500 text-left">Perfect for swimmers transitioning from pools to open water.</p>
          </Card>
          <Card className="border-none shadow-none bg-slate-50 p-6 rounded-2xl text-left">
            <h3 className="font-black text-2xl text-[#0B5ED7] mb-2 italic text-left">1km – 2km</h3>
            <p className="text-sm font-bold uppercase tracking-widest text-[#083A8C] mb-2 text-left">Intermediate</p>
            <p className="text-xs text-slate-500 text-left">Standard distance for developing endurance and navigation skills.</p>
          </Card>
          <Card className="border-none shadow-none bg-slate-50 p-6 rounded-2xl text-left">
            <h3 className="font-black text-2xl text-[#0B5ED7] mb-2 italic text-left">5km</h3>
            <p className="text-sm font-bold uppercase tracking-widest text-[#083A8C] mb-2 text-left">Endurance</p>
            <p className="text-xs text-slate-500 text-left">Long distance swim challenge for experienced endurance athletes.</p>
          </Card>
        </div>
      </section>

      {/* OPEN WATER SWIMMING */}
      <section id="open-water" className="text-left">
        <h2 className="text-3xl font-extrabold text-[#083A8C] mb-6 text-left">Open Water Swimming in India</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center text-left">
          <div className="space-y-4 text-left">
            <p className="text-slate-600 text-left">
              Open water swimming is a rapidly growing sport in India where athletes swim 
              in lakes, rivers or oceans rather than swimming pools. This form of swimming 
              requires navigation skills, endurance and mental focus.
            </p>
            <p className="text-slate-600 text-left">
              Many triathletes participate in swimathons to prepare for the swimming segment 
              of triathlon races. <Link href="/media" className="text-blue-600 hover:underline">View race gallery</Link>
            </p>
          </div>
          <div className="bg-[#083A8C] text-white p-8 rounded-3xl shadow-2xl text-left">
            <h3 className="text-xl font-bold mb-6 text-blue-300 text-left">Benefits of Open Water Swimming</h3>
            <ul className="space-y-4 text-left">
              <li className="flex gap-3 text-left"><Waves className="h-5 w-5 text-blue-400 shrink-0"/> <span className="text-sm font-medium text-left">Improves functional endurance and overall stamina</span></li>
              <li className="flex gap-3 text-left"><ShieldCheck className="h-5 w-5 text-blue-400 shrink-0"/> <span className="text-sm font-medium text-left">Builds mental resilience through navigation challenges</span></li>
              <li className="flex gap-3 text-left"><Footprints className="h-5 w-5 text-blue-400 shrink-0"/> <span className="text-sm font-medium text-left">Critical preparation for competitive triathlon swim legs</span></li>
              <li className="flex gap-3 text-left"><Globe className="h-5 w-5 text-blue-400 shrink-0"/> <span className="text-sm font-medium text-left">Unique outdoor experience connecting with nature</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* BERGMAN RACES */}
      <section id="bergman-series" className="pb-12 text-left">
        <h2 className="text-3xl font-extrabold text-[#083A8C] mb-6 text-left">Bergman Triathlon Race Series</h2>
        <p className="text-slate-600 max-w-3xl text-left">
          Bergman Triathlon hosts high-quality endurance sports events across multiple locations in India,
          bringing together athletes to celebrate the spirit of persistence and performance.
        </p>
        <div className="flex flex-wrap gap-3 mt-8 text-left">
          {['Bergman Ozar Pune', 'Bergman Kolhapur', 'Bergman Mysuru', 'Bergman Swimathons'].map(event => (
            <Badge key={event} className="bg-white text-[#0B5ED7] border-[#0B5ED7] px-4 py-2 text-sm font-bold rounded-xl shadow-sm text-left">
              {event}
            </Badge>
          ))}
        </div>
        <p className="mt-8 text-slate-500 italic text-sm border-t pt-6 text-left">
          Each race is organised with professional timing systems, athlete safety teams 
          and high quality race infrastructure to ensure an exceptional athlete experience.
        </p>
      </section>
    </div>
  );
}
