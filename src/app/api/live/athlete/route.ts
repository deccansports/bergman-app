import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ============================================
// GET /api/live/athlete
// ============================================
// Fetch single athlete data from KV

export async function GET(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get("eventId");
    const bookingId = req.nextUrl.searchParams.get("bookingId");

    if (!eventId || !bookingId) {
      return NextResponse.json(
        { error: "eventId and bookingId are required" },
        { status: 400 }
      );
    }

    // ============================================
    // 🔥 FETCH FROM KV
    // ============================================
    const kvKey = `live:event:${eventId}:athletes`;

    // In production, you would fetch from Cloudflare KV
    // const allAthletes = await env.LIVE_TRACKING_KV.get(kvKey, "json");
    // const athlete = allAthletes?.find(a => a.bookingId === bookingId);

    // For development, return mock data
    const mockAthletesData: Record<string, any> = {
      "B001": {
        bookingId: "B001",
        bibNumber: "101",
        name: "Vaibhav Kumar",
        lat: 18.52,
        lng: 73.85,
        distance: 32.5,
        speed: 28.3,
        rank: 1,
        checkpoint: "Bike Leg",
        timestamp: new Date().toISOString(),
        splits: {
          swim: 1800,
          bike: 5400
        },
        history: [
          { lat: 18.50, lng: 73.80, timestamp: 1, distance: 2 },
          { lat: 18.505, lng: 73.815, timestamp: 2, distance: 5 },
          { lat: 18.51, lng: 73.83, timestamp: 3, distance: 10 },
          { lat: 18.515, lng: 73.84, timestamp: 4, distance: 18 },
          { lat: 18.52, lng: 73.85, timestamp: 5, distance: 25 },
          { lat: 18.525, lng: 73.855, timestamp: 6, distance: 32.5 }
        ]
      },
      "B002": {
        bookingId: "B002",
        bibNumber: "102",
        name: "Priya Singh",
        lat: 18.51,
        lng: 73.84,
        distance: 28.1,
        speed: 26.5,
        rank: 2,
        checkpoint: "Bike Leg",
        timestamp: new Date().toISOString(),
        splits: {
          swim: 1950,
          bike: 5200
        },
        history: [
          { lat: 18.50, lng: 73.80, timestamp: 1, distance: 2 },
          { lat: 18.505, lng: 73.815, timestamp: 2, distance: 5 },
          { lat: 18.51, lng: 73.83, timestamp: 3, distance: 10 },
          { lat: 18.51, lng: 73.84, timestamp: 4, distance: 28.1 }
        ]
      },
      "B003": {
        bookingId: "B003",
        bibNumber: "103",
        name: "Amit Patel",
        lat: 18.50,
        lng: 73.83,
        distance: 24.8,
        speed: 25.2,
        rank: 3,
        checkpoint: "Swim Finish",
        timestamp: new Date().toISOString(),
        splits: {
          swim: 1650
        },
        history: [
          { lat: 18.50, lng: 73.80, timestamp: 1, distance: 2 },
          { lat: 18.505, lng: 73.815, timestamp: 2, distance: 5 },
          { lat: 18.51, lng: 73.83, timestamp: 3, distance: 24.8 }
        ]
      }
    };

    const athlete = mockAthletesData[bookingId];

    if (!athlete) {
      return NextResponse.json(
        { error: "Athlete not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      ...athlete
    });

  } catch (error) {
    console.error("Error fetching athlete data:", error);
    return NextResponse.json(
      { error: "Failed to fetch athlete data" },
      { status: 500 }
    );
  }
}
