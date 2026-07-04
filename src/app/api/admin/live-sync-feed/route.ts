// src/app/api/admin/live-sync-feed/route.ts
/**
 * Server-Sent Events (SSE) endpoint for live sync feed
 * Streams real-time sync events from Firebase Functions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

// In-memory event queue (in production, use Redis)
const syncEventQueue: Array<{
  id: string;
  timestamp: string;
  type: 'participant' | 'event' | 'user' | 'registration';
  status: 'success' | 'error';
  message: string;
  data?: Record<string, any>;
}> = [];

const MAX_QUEUE_SIZE = 100;

/**
 * POST: Log a sync event (called by Firebase Functions via webhook)
 */
export async function POST(req: NextRequest) {
  try {
    const event = await req.json();

    // Validate event
    if (!event.type || !event.status) {
      return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
    }

    // Create sync event
    const syncEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: event.type,
      status: event.status,
      message: event.message || (event.status === 'success' ? 'Synced to KV' : 'Sync failed'),
      data: event.data,
    };

    // Add to queue
    syncEventQueue.unshift(syncEvent);
    if (syncEventQueue.length > MAX_QUEUE_SIZE) {
      syncEventQueue.pop();
    }

    // Broadcast to all connected clients
    broadcastToClients(syncEvent);

    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('[LiveSyncFeed] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to log event' },
      { status: 500 }
    );
  }
}

/**
 * GET: Server-Sent Events stream
 */
export async function GET(req: NextRequest) {
  // Create encoder for SSE
  const encoder = new TextEncoder();
  
  let isConnected = true;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial event
      const initialEvent = {
        type: 'connection',
        message: 'Connected to live sync feed',
        timestamp: new Date().toISOString(),
      };
      
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`)
      );

      // Send recent events
      syncEventQueue.forEach(event => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch (err) {
          console.error('Failed to send event:', err);
        }
      });

      // Register client listener
      const listener = (event: any) => {
        if (isConnected) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          } catch (err) {
            console.error('Failed to broadcast event:', err);
            isConnected = false;
            controller.close();
          }
        }
      };

      // Add to listeners
      clientListeners.add(listener);

      // Handle disconnection
      const cleanup = () => {
        isConnected = false;
        clientListeners.delete(listener);
        controller.close();
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Global client listener set
const clientListeners = new Set<(event: any) => void>();

/**
 * Broadcast sync event to all connected SSE clients
 */
function broadcastToClients(event: any) {
  clientListeners.forEach(listener => {
    try {
      listener(event);
    } catch (err) {
      console.error('Failed to broadcast to client:', err);
      clientListeners.delete(listener);
    }
  });
}

/**
 * Heartbeat to keep connection alive
 */
setInterval(() => {
  const heartbeat = {
    type: 'heartbeat',
    timestamp: new Date().toISOString(),
  };
  
  clientListeners.forEach(listener => {
    try {
      listener(heartbeat);
    } catch (err) {
      clientListeners.delete(listener);
    }
  });
}, 30000); // Every 30 seconds
