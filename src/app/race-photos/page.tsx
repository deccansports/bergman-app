// src/app/race-photos/page.tsx
"use client";

import * as React from "react";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera, ExternalLink } from "lucide-react";
import AthleteRacePhotosCard from "@/components/dashboard/AthleteRacePhotosCard";
import RacePhotosCard from "@/components/dashboard/RacePhotosCard";

export const dynamic = "force-dynamic";

function PageSkeleton() {
  return (
    <div className="max-w-4xl mx-auto w-full space-y-4">
      <Skeleton className="h-10 w-64 rounded-lg" />
      <Skeleton className="h-6 w-80 rounded" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

function RacePhotosPageContent() {
  return (
    <div className="max-w-6xl mx-auto w-full space-y-8">
      {/* Page heading */}
      <div className="rounded-3xl border border-purple-500/20 bg-gradient-to-br from-purple-50 via-background to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 p-6 sm:p-8 shadow-lg">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shrink-0">
              <Camera className="h-6 w-6 text-white" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-purple-700 to-pink-600 dark:from-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
                Race Photos
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Your official race photos powered by Split Second Pix. Browse mapped Bergman events, open the partner gallery, and continue there for bib search or face search.
              </p>
              <p className="text-xs text-muted-foreground/80">
                Photos are fetched from our photos partner Split Second Pix.
              </p>
            </div>
          </div>
          <a
            href="https://new.splitsecondpix.com/contact-us"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Contact Split Second Pix <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      <AthleteRacePhotosCard />

      <RacePhotosCard />
    </div>
  );
}

export default function RacePhotosPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RacePhotosPageContent />
    </Suspense>
  );
}
