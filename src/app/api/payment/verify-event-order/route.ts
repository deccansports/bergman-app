// src/app/api/payment/verify-event-order/route.ts
// THIS ROUTE IS DEPRECATED AND SHOULD NOT BE USED.
// All payment verification and registration finalization is now handled
// exclusively by the Razorpay webhook to ensure 100% reliability.

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  console.warn("DEPRECATED: The /api/payment/verify-event-order endpoint was called. This endpoint is no longer in use and should be removed from frontend code. Finalization is now handled by the webhook.");
  return NextResponse.json(
    { success: false, message: 'This endpoint is deprecated. Registration is handled via webhook.' },
    { status: 410 } // 410 Gone
  );
}

    