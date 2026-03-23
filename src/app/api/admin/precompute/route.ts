// src/app/api/admin/precompute/route.ts
import { NextResponse } from 'next/server';

/**
 * Server-side proxy for admin precompute tasks.
 * Protects the SYNC_SECRET from being exposed to the client.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const SYNC_SECRET = process.env.SYNC_SECRET;
    if (!SYNC_SECRET) {
      return NextResponse.json({ success: false, message: "Server configuration error: SYNC_SECRET missing." }, { status: 500 });
    }

    const res = await fetch(
      "https://api.bergmantri.com/admin/precompute/rankings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SYNC_SECRET}`
        },
        body: JSON.stringify(body)
      }
    );

    const data = await res.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("[API Precompute Proxy] Error:", error.message);
    return NextResponse.json({ success: false, message: `Proxy failed: ${error.message}` }, { status: 500 });
  }
}
