// app/api/zoho-test/route.ts
import { zohoFetch } from "@/lib/zoho/fetch";
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const data = await zohoFetch("/chartofaccounts");
    return NextResponse.json({
      success: true,
      count: data.chartofaccounts.length,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: "Zoho Test Failed",
      error: error.message
    }, { status: 500 });
  }
}
