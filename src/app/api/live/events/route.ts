import { NextRequest, NextResponse } from "next/server";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import { format, parseISO, isBefore, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/events
 * Fetches list of events available for live tracking
 * Sorted by: Upcoming events first (by date), then past events (newest first)
 * 
 * Returns:
 * {
 *   success: boolean,
 *   events: [
 *     {
 *       id: string,
 *       name: string,
 *       date: string | null,
 *       customSlug: string | null,
 *       isUpcoming: boolean,
 *       status: 'upcoming' | 'live' | 'completed'
 *     }
 *   ]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const db = getFirestoreInstance();

    // Prefer primary events collection; fallback to legacy eventCalendar.
    let eventsSnapshot = await db.collection("events").get();
    if (eventsSnapshot.empty) {
      eventsSnapshot = await db.collection("eventCalendar").get();
    }

    if (eventsSnapshot.empty) {
      return NextResponse.json({
        success: true,
        events: [],
      });
    }

    const today = startOfDay(new Date());

    // Map and categorize events
    const events = eventsSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        const eventName = String(data.eventName || data.name || "Unnamed Event").trim() || "Unnamed Event";
        const eventDateValue = String(data.eventDate || data.date || "").trim();
        const eventDate = data.eventDate
          ? parseISO(data.eventDate)
          : null;

        const hidden = Boolean(data.isHidden || data.hidden);
        const liveDataSource = typeof data?.liveDataSource === 'string' ? data.liveDataSource : null;
        const liveTrackingEnabled =
          data?.liveTrackingHub?.trackingConfig?.enabled ??
          data?.showLiveTrackingOnHomepage ??
          (liveDataSource ? liveDataSource !== 'none' : null) ??
          true;

        let status: "upcoming" | "live" | "completed" = "completed";
        let isUpcoming = false;

        if (eventDate) {
          if (isBefore(eventDate, today)) {
            status = "completed";
            isUpcoming = false;
          } else {
            // Check if event is today (live) or in future (upcoming)
            const eventStartStr = data.eventDate || "";
            const todayStr = format(today, "yyyy-MM-dd");
            if (eventStartStr === todayStr) {
              status = "live";
              isUpcoming = true;
            } else {
              status = "upcoming";
              isUpcoming = true;
            }
          }
        }

        return {
          id: doc.id,
          name: eventName,
          date: eventDateValue || null,
          customSlug: data.customSlug || null,
          isUpcoming,
          status,
          hidden,
          liveTrackingEnabled,
          sortDate: eventDate?.getTime() || 0,
        };
      })
      .filter((event) => !event.hidden && event.liveTrackingEnabled)
      .sort((a, b) => {
        // Sort 1: Upcoming/Live events first (true comes before false)
        if (a.isUpcoming !== b.isUpcoming) {
          return b.isUpcoming ? 1 : -1; // true (upcoming) first
        }

        // Sort 2: Within same category, by date
        if (a.isUpcoming && b.isUpcoming) {
          // For upcoming events, sort by nearest date (ascending)
          return a.sortDate - b.sortDate;
        } else {
          // For completed events, sort by newest first (descending)
          return b.sortDate - a.sortDate;
        }
      })
      .map(({ sortDate, hidden, liveTrackingEnabled, ...rest }) => rest); // Remove internal fields from response

    console.log(
      `[LIVE] Fetched ${events.length} events, sorted (upcoming first)`
    );

    return NextResponse.json({
      success: true,
      events,
    });
  } catch (error) {
    console.error("[LIVE] Error fetching events list:", error);
    return NextResponse.json(
      { error: "Failed to fetch events list", details: String(error) },
      { status: 500 }
    );
  }
}
