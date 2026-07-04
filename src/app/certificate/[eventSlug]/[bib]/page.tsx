"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  getDistinctEventsFromResultsAction,
  getEventDetailsWithTicketsAction,
  getPublicFinalResultsAction,
  getAthleteRankingData,
} from "@/lib/actions";
import FinisherCertificate from "@/components/results/FinisherCertificate";
import type { EventCalendarEntry, RaceResult, RankedAthlete } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CertificateSlugPage() {
  const router = useRouter();
  const params = useParams<{ eventSlug: string; bib: string }>();

  const eventSlugParam = useMemo(() => decodeURIComponent(params?.eventSlug || ""), [params?.eventSlug]);
  const bibParam = useMemo(() => decodeURIComponent(params?.bib || ""), [params?.bib]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [athlete, setAthlete] = useState<RaceResult | null>(null);
  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [totalYearlyPoints, setTotalYearlyPoints] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCertificate() {
      if (!eventSlugParam || !bibParam) {
        setError("Invalid certificate link.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const eventsRes = await getDistinctEventsFromResultsAction();
        if (!eventsRes.success || !eventsRes.events?.length) {
          throw new Error("Could not load event index.");
        }

        const targetEvent = eventsRes.events.find(
          (e) => e.customSlug === eventSlugParam || e.id === eventSlugParam
        );

        if (!targetEvent) {
          throw new Error("Event not found for this certificate link.");
        }

        const resultRes = await getPublicFinalResultsAction(targetEvent.id, [bibParam]);
        const athleteResult = resultRes.success && resultRes.participants?.length ? resultRes.participants[0] : null;

        if (!athleteResult) {
          throw new Error("Result not found for this bib number.");
        }

        const [detailsRes, rankingRes] = await Promise.all([
          getEventDetailsWithTicketsAction(targetEvent.id),
          athleteResult.raceDate
            ? getAthleteRankingData({ year: new Date(athleteResult.raceDate).getFullYear() })
            : Promise.resolve({ success: false, rankings: [] as RankedAthlete[] }),
        ]);

        if (cancelled) return;

        setAthlete(athleteResult);

        if (detailsRes.success && detailsRes.event) {
          setEventDetails(detailsRes.event);
        }

        if (rankingRes.success && rankingRes.rankings) {
          const ranking = rankingRes.rankings.find(
            (r) =>
              r.athleteId === athleteResult.athleteUid ||
              (r.email && athleteResult.email && r.email.toLowerCase() === athleteResult.email.toLowerCase())
          );
          setTotalYearlyPoints(ranking?.totalPoints || null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Unable to load certificate.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadCertificate();

    return () => {
      cancelled = true;
    };
  }, [eventSlugParam, bibParam]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16 flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading certificate...</span>
        </div>
      </div>
    );
  }

  if (error || !athlete) {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-xl mx-auto">
          <CardHeader>
            <CardTitle>Certificate unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{error || "This certificate could not be loaded."}</p>
            <Button onClick={() => router.push("/results")}>Go to Results</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ticketDef = eventDetails?.ticketDefinitions?.find((t) => t.id === athlete.ticketId);
  const effectiveSlug = eventDetails?.customSlug || eventDetails?.id || eventSlugParam;

  return (
    <FinisherCertificate
      athlete={athlete}
      eventName={eventDetails?.eventName || athlete.eventName || "Bergman Event"}
      eventSlug={effectiveSlug}
      ticketDef={ticketDef}
      totalYearlyPoints={totalYearlyPoints}
      onBack={() => router.push(`/results?eventSlug=${encodeURIComponent(effectiveSlug)}&bib=${encodeURIComponent(athlete.bibNumber)}`)}
    />
  );
}
