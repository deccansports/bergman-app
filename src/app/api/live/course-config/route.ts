import { NextRequest, NextResponse } from "next/server";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import type { CustomSplitPoint } from "@/lib/types";

export const dynamic = "force-dynamic";

type CourseMapsPayload = {
  swimGpxUrl?: string | null;
  bikeGpxUrl?: string | null;
  runGpxUrl?: string | null;
  run1GpxUrl?: string | null;
  run2GpxUrl?: string | null;
  swimDistance?: number | null;
  bikeDistance?: number | null;
  runDistance?: number | null;
  run1Distance?: number | null;
  run2Distance?: number | null;
  swimDescription?: string | null;
  bikeDescription?: string | null;
  runDescription?: string | null;
  run1Description?: string | null;
  run2Description?: string | null;
  swimSplits?: CustomSplitPoint[];
  bikeSplits?: CustomSplitPoint[];
  runSplits?: CustomSplitPoint[];
  run1Splits?: CustomSplitPoint[];
  run2Splits?: CustomSplitPoint[];
  generatedPdfUrl?: string | null;
  generatedPdfName?: string | null;
  generatedPdfUpdatedAt?: string | null;
  generatedSportType?: string | null;
};

type CourseTicket = {
  id: string;
  ticketName: string;
  ticketCategory?: string | null;
  description?: string | null;
  order?: number | null;
  cutoffs?: {
    mode?: 'overall' | 'segment';
    overall?: string | null;
    swim?: string | null;
    bike?: string | null;
    run?: string | null;
    run1?: string | null;
    run2?: string | null;
  } | null;
  courseMaps?: CourseMapsPayload | null;
};

function normalizeTicketDefinition(raw: any, fallbackId: string, index: number): CourseTicket | null {
  const id = String(raw?.id || fallbackId || '').trim();
  if (!id) return null;

  return {
    id,
    ticketName: String(raw?.ticketName || raw?.name || raw?.title || `Category ${index + 1}`).trim(),
    ticketCategory: raw?.ticketCategory || null,
    description: raw?.description || null,
    order: typeof raw?.order === 'number' ? raw.order : index,
    cutoffs: raw?.cutoffs || null,
    courseMaps: raw?.courseMaps || null,
  };
}

function mergeTicketDefinitions(ticketGroups: CourseTicket[][]): CourseTicket[] {
  const merged = new Map<string, CourseTicket>();

  for (const group of ticketGroups) {
    for (const ticket of group) {
      const existing = merged.get(ticket.id);
      merged.set(ticket.id, {
        ...(existing || {}),
        ...ticket,
        cutoffs: {
          ...(existing?.cutoffs || {}),
          ...(ticket.cutoffs || {}),
        },
        courseMaps: {
          ...(existing?.courseMaps || {}),
          ...(ticket.courseMaps || {}),
        },
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    const aOrder = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const bOrder = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.ticketName.localeCompare(b.ticketName);
  });
}

/**
 * GET /api/live/course-config
 * Fetches course maps and custom splits for an event
 * 
 * Query Params:
 * - eventId: string (required) - The event ID
 * 
 * Returns:
 * {
 *   success: boolean,
 *   eventId: string,
 *   courseMaps: {
 *     swimSplits: CustomSplitPoint[],
 *     bikeSplits: CustomSplitPoint[],
 *     runSplits: CustomSplitPoint[]
 *   },
 *   ticketDefinitions: TicketDefinition[]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json(
        { error: "eventId is required" },
        { status: 400 }
      );
    }

    const db = getFirestoreInstance();

    // Fetch event metadata plus the canonical ticketDefinitions subcollections.
    const [eventDocPrimary, eventDocLegacy, primaryTicketSnap, legacyTicketSnap] = await Promise.all([
      db.collection("events").doc(eventId).get(),
      db.collection("eventCalendar").doc(eventId).get(),
      db.collection("events").doc(eventId).collection("ticketDefinitions").get(),
      db.collection("eventCalendar").doc(eventId).collection("ticketDefinitions").get(),
    ]);
    const eventDoc = eventDocPrimary.exists ? eventDocPrimary : eventDocLegacy;

    const rootPrimaryTickets = Array.isArray(eventDocPrimary.data()?.ticketDefinitions)
      ? eventDocPrimary.data()?.ticketDefinitions
      : [];
    const rootLegacyTickets = Array.isArray(eventDocLegacy.data()?.ticketDefinitions)
      ? eventDocLegacy.data()?.ticketDefinitions
      : [];
    const subcollectionPrimaryTickets = primaryTicketSnap.docs
      .map((doc, index) => normalizeTicketDefinition({ id: doc.id, ...doc.data() }, doc.id, index))
      .filter((ticket): ticket is CourseTicket => Boolean(ticket));
    const subcollectionLegacyTickets = legacyTicketSnap.docs
      .map((doc, index) => normalizeTicketDefinition({ id: doc.id, ...doc.data() }, doc.id, index))
      .filter((ticket): ticket is CourseTicket => Boolean(ticket));
    const rootPrimaryNormalized = rootPrimaryTickets
      .map((ticket: any, index: number) => normalizeTicketDefinition(ticket, ticket?.id || `root-primary-${index}`, index))
      .filter((ticket: CourseTicket | null): ticket is CourseTicket => Boolean(ticket));
    const rootLegacyNormalized = rootLegacyTickets
      .map((ticket: any, index: number) => normalizeTicketDefinition(ticket, ticket?.id || `root-legacy-${index}`, index))
      .filter((ticket: CourseTicket | null): ticket is CourseTicket => Boolean(ticket));

    const ticketDefinitions = mergeTicketDefinitions([
      rootLegacyNormalized,
      rootPrimaryNormalized,
      subcollectionLegacyTickets,
      subcollectionPrimaryTickets,
    ]);

    if (!eventDoc.exists && ticketDefinitions.length === 0) {
      return NextResponse.json(
        {
          success: true,
          eventId,
          courseMaps: {
            swimSplits: [],
            bikeSplits: [],
            runSplits: [],
          },
          ticketDefinitions: [],
          empty: true,
          message: "No course configuration found for this event.",
        },
        { status: 200 }
      );
    }

    // Extract course maps from ticket definitions
    const courseMaps: {
      swimSplits: CustomSplitPoint[];
      bikeSplits: CustomSplitPoint[];
      runSplits: CustomSplitPoint[];
    } = {
      swimSplits: [],
      bikeSplits: [],
      runSplits: [],
    };

    // Aggregate splits from all ticket definitions (use first non-empty as primary)
    for (const ticket of ticketDefinitions) {
      if (ticket.courseMaps) {
        if (!courseMaps.swimSplits.length && ticket.courseMaps.swimSplits?.length) {
          courseMaps.swimSplits = ticket.courseMaps.swimSplits;
        }
        if (!courseMaps.bikeSplits.length && ticket.courseMaps.bikeSplits?.length) {
          courseMaps.bikeSplits = ticket.courseMaps.bikeSplits;
        }
        if (!courseMaps.runSplits.length && ticket.courseMaps.runSplits?.length) {
          courseMaps.runSplits = ticket.courseMaps.runSplits;
        }
      }
    }

    return NextResponse.json({
      success: true,
      eventId,
      courseMaps,
      ticketDefinitions: ticketDefinitions.map((ticket) => ({
        id: ticket.id,
        ticketName: ticket.ticketName,
        ticketCategory: ticket.ticketCategory || null,
        description: ticket.description || null,
        order: typeof ticket.order === 'number' ? ticket.order : null,
        cutoffs: ticket.cutoffs || null,
        courseMaps: ticket.courseMaps || null,
      })),
    });
  } catch (error) {
    console.error("[LIVE] Error fetching course config:", error);
    return NextResponse.json(
      { error: "Failed to fetch course config", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/live/course-config
 * Updates course maps for an event (admin operation)
 * 
 * Body:
 * {
 *   eventId: string,
 *   ticketId: string,
 *   courseMaps: {
 *     swimSplits: CustomSplitPoint[],
 *     bikeSplits: CustomSplitPoint[],
 *     runSplits: CustomSplitPoint[]
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { eventId, ticketId, courseMaps } = await req.json();

    if (!eventId || !ticketId || !courseMaps) {
      return NextResponse.json(
        { error: "eventId, ticketId, and courseMaps are required" },
        { status: 400 }
      );
    }

    const db = getFirestoreInstance();

    // Validate courseMaps structure
    if (
      !Array.isArray(courseMaps.swimSplits) ||
      !Array.isArray(courseMaps.bikeSplits) ||
      !Array.isArray(courseMaps.runSplits)
    ) {
      return NextResponse.json(
        { error: "courseMaps must have arrays for swimSplits, bikeSplits, and runSplits" },
        { status: 400 }
      );
    }

    // Validate split structure
    const validateSplits = (splits: any[]) => {
      return splits.every(
        (s) =>
          s.id &&
          typeof s.name === "string" &&
          typeof s.distance === "number" &&
          s.distance > 0
      );
    };

    if (
      !validateSplits(courseMaps.swimSplits) ||
      !validateSplits(courseMaps.bikeSplits) ||
      !validateSplits(courseMaps.runSplits)
    ) {
      return NextResponse.json(
        { error: "Each split must have id (string), name (string), and distance (number > 0)" },
        { status: 400 }
      );
    }

    const [eventDoc, ticketDoc] = await Promise.all([
      db.collection("events").doc(eventId).get(),
      db.collection("events").doc(eventId).collection("ticketDefinitions").doc(ticketId).get(),
    ]);

    if (!eventDoc.exists && !ticketDoc.exists) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    await db.collection("events").doc(eventId).collection("ticketDefinitions").doc(ticketId).set(
      {
        courseMaps,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    console.log(
      `[LIVE] Updated course maps for event ${eventId}, ticket ${ticketId}`
    );

    return NextResponse.json({
      success: true,
      message: "Course maps updated",
      eventId,
      ticketId,
      courseMaps,
    });
  } catch (error) {
    console.error("[LIVE] Error updating course config:", error);
    return NextResponse.json(
      { error: "Failed to update course config", details: String(error) },
      { status: 500 }
    );
  }
}
