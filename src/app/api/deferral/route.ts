// src/app/api/deferral/route.ts
import { NextRequest, NextResponse } from "next/server";
import { handleDeferral } from "@/lib/actions/deferralActions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await handleDeferral(
      body.eventId,
      body.participantId
    );

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("DEFERRAL ERROR:", e);

    return NextResponse.json({
      success: false,
      message: e.message
    }, { status: 500 });
  }
}
