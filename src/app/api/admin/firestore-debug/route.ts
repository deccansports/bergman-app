// src/app/api/admin/firestore-debug/route.ts
import { NextResponse } from 'next/server';

// This file exists to satisfy the Next.js build process, which expects a route file
// based on the directory structure. The actual debug functionality is handled by
// linking to Google Cloud Logging from the FirestoreDebugTab component.

export async function GET(request: Request) {
  return NextResponse.json({
    message: "This endpoint is a placeholder. See the Firestore Debug tab in the admin dashboard for a link to Google Cloud Logging.",
  });
}
