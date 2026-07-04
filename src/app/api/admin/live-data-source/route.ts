// src/app/api/admin/live-data-source/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

// Initialize admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type DataSource = 'registrations' | 'volunteer' | 'timing_partner' | 'final_results' | 'disabled' | null;

interface DataSourceConfig {
  source: DataSource;
  eventId: string | null;
  lastUpdated: string;
}

/**
 * GET: Retrieve current data source configuration
 * GET with ?eventId=xxx&source=registrations: Fetch participants from KV
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const source = searchParams.get('source');

    // If fetching participants for registrations
    if (source === 'registrations' && eventId) {
      return getParticipantsFromKV(eventId);
    }

    // Otherwise, get current configuration
    return getCurrentConfiguration();
  } catch (error) {
    console.error('Error in GET /api/admin/live-data-source:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

/**
 * POST: Save data source configuration
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { source, eventId } = body;

    if (!source) {
      return NextResponse.json(
        { error: 'Data source is required' },
        { status: 400 }
      );
    }

/**
 * Save to Firestore
 */
async function saveConfiguration(source: string, eventId: string | null) {
  const config = {
    source,
    eventId,
    lastUpdated: new Date().toISOString(),
  };

  await db.collection('admin').doc('live_data_source_config').set(config);
  return config;
}
  } catch (error) {
    console.error('Error in POST /api/admin/live-data-source:', error);
    return NextResponse.json(
      { error: 'Failed to save configuration' },
      { status: 500 }
    );
  }
}

/**
 * Get current configuration from Firestore
 */
async function getCurrentConfiguration(): Promise<NextResponse> {
  try {
    const snap = await db.collection('admin').doc('live_data_source_config').get();

    if (!snap.exists) {
      return NextResponse.json({
        source: null,
        eventId: null,
        lastUpdated: null,
      });
    }

    return NextResponse.json(snap.data());
  } catch (error) {
    console.error('Error getting configuration:', error);
    return NextResponse.json(
      {
        source: null,
        eventId: null,
        lastUpdated: null,
      },
      { status: 200 }
    );
  }
}

/**
 * Fetch participants from Firestore (similar to existing registration data)
 * In production, this would fetch from KV via Cloudflare Worker
 */
async function getParticipantsFromKV(eventId: string): Promise<NextResponse> {
  try {
    // For now, fetch from Firestore
    // In production, call KV endpoint: GET /api/admin/kv?prefix=event:${eventId}:participant:
    const snap = await db.collection('events').doc(eventId).get();

    if (!snap.exists) {
      return NextResponse.json({
        participants: [],
        count: 0,
      });
    }

    // Transform Firestore data to match expected format
    const eventData = snap.data();
    const participants = eventData?.participants?.map((p: any) => ({
      bookingId: p.bookingId || p.id,
      name: p.name || '',
      email: p.email || '',
      bibNumber: p.bibNumber,
      club: p.clubName || p.club,
      category: p.category,
    })) || [];

    return NextResponse.json({
      participants,
      count: participants.length,
    });
  } catch (error) {
    console.error('Error fetching participants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch participants' },
      { status: 500 }
    );
  }
}
