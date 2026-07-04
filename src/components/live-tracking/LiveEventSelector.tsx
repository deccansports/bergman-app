"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { Loader2, Calendar } from "lucide-react";

interface LiveEvent {
  id: string;
  name: string;
  date: string | null;
  customSlug: string | null;
  isUpcoming: boolean;
  status: "upcoming" | "live" | "completed";
}

interface LiveEventSelectorProps {
  currentEventId?: string;
  onEventChange?: (eventId: string) => void;
}

export function LiveEventSelector({
  currentEventId,
  onEventChange,
}: LiveEventSelectorProps) {
  const router = useRouter();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/live/events");

        if (!res.ok) {
          throw new Error(`Failed to fetch events: ${res.status}`);
        }

        const data = await res.json();

        if (data.success && Array.isArray(data.events)) {
          setEvents(data.events);
          console.log(
            `[LiveEventSelector] Loaded ${data.events.length} events (upcoming first)`
          );
        } else {
          throw new Error(data.error || "Failed to load events");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        console.error("[LiveEventSelector] Error fetching events:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const handleEventChange = (eventId: string) => {
    if (onEventChange) {
      onEventChange(eventId);
    } else {
      router.push(`/live-tracking/${eventId}`);
    }
  };

  const getEventLabel = (event: LiveEvent): string => {
    const dateStr = event.date
      ? format(parseISO(event.date), "MMM d, yyyy")
      : "TBD";
    const statusBadge =
      event.status === "live"
        ? " 🔴 LIVE"
        : event.status === "upcoming"
          ? " 📅 UPCOMING"
          : "";

    return `${event.name} (${dateStr})${statusBadge}`;
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading events...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600">
        Error: {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No events available
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-gray-500" />
      <Select value={currentEventId || ""} onValueChange={handleEventChange}>
        <SelectTrigger className="w-full max-w-sm">
          <SelectValue placeholder="Select an event..." />
        </SelectTrigger>
        <SelectContent>
          {/* Group upcoming events */}
          {events.some((e) => e.isUpcoming) && (
            <>
              <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase">
                Upcoming Events
              </div>
              {events
                .filter((e) => e.isUpcoming)
                .map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {getEventLabel(event)}
                  </SelectItem>
                ))}
            </>
          )}

          {/* Divider if both groups exist */}
          {events.some((e) => e.isUpcoming) &&
            events.some((e) => !e.isUpcoming) && (
              <div className="my-1 border-t border-gray-200" />
            )}

          {/* Group past events */}
          {events.some((e) => !e.isUpcoming) && (
            <>
              <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase">
                Past Events
              </div>
              {events
                .filter((e) => !e.isUpcoming)
                .map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {getEventLabel(event)}
                  </SelectItem>
                ))}
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
