
// src/app/api/debug-create-order/route.ts
import { NextResponse } from 'next/server';
import { createEventTicketOrderAction } from '@/lib/actions';
import type { RegistrationAttempt } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const registrationPayload = await request.json();

    // Basic validation
    if (!registrationPayload.eventId || !registrationPayload.email) {
      return NextResponse.json({ success: false, message: "Missing eventId or email in payload" }, { status: 400 });
    }

    const result = await createEventTicketOrderAction(registrationPayload as Partial<RegistrationAttempt>);

    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(result, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, message: `Server Error: ${error.message}` }, { status: 500 });
  }
}
