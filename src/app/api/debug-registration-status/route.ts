
// src/app/api/debug-registration-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRegistrationStatusAction } from '@/lib/actions';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    if (!orderId) {
      return NextResponse.json({ success: false, message: "orderId is required" }, { status: 400 });
    }

    const result = await getRegistrationStatusAction(orderId);
    return NextResponse.json(result);

  } catch (error: any) {
    return NextResponse.json({ success: false, message: `Server Error: ${error.message}` }, { status: 500 });
  }
}
