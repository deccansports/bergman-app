/**
 * Feibot Connection Management Endpoint
 * 
 * POST /api/feibot/connections - Create/update connection
 * GET /api/feibot/connections - List connections
 * GET /api/feibot/connections/{id} - Get connection details
 * DELETE /api/feibot/connections/{id} - Delete connection
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  saveFeibotConnection,
  getFeibotConnection,
  getAccountConnections,
  deleteFeibotConnection,
  getDecryptedCredentials,
  markConnectionSuccessful,
  recordConnectionFailure,
} from '@/lib/feibot-integration/credentials';
import { testFeibotConnection } from '@/lib/feibot-integration/api-client';
import type { APIResponse } from '@/lib/feibot-integration/types';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  
  const token =
    req.headers.get('x-bergman-internal-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  
  return token === expectedToken;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, message: 'Unauthorized' },
    { status: 401 }
  );
}

/**
 * POST - Create or update a Feibot connection
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!isAuthorized(req)) {
      return unauthorized();
    }
    
    const body = await req.json().catch(() => ({}));
    const {
      accountId,
      accessKey,
      secretKey,
      accountName,
      apiBaseUrl = 'https://apicn.feibot.com',
      environment = 'production',
      testConnection = true,
    } = body;
    
    // Validate required fields
    if (!accountId || !accessKey || !secretKey) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required fields: accountId, accessKey, secretKey',
        },
        { status: 400 }
      );
    }
    
    const userId = 'system'; // In production, get from auth context
    
    // Test connection before saving (if requested)
    if (testConnection) {
      const testResult = await testFeibotConnection({
        accountId,
        accessKey,
        secretKey,
        apiBaseUrl,
      });
      
      if (!testResult.success) {
        return NextResponse.json(
          {
            success: false,
            message: `Connection test failed: ${testResult.message}`,
            data: { testResult },
          },
          { status: 400 }
        );
      }
    }
    
    // Save connection (credentials are encrypted)
    const { connectionId, connection } = await saveFeibotConnection(
      accountId,
      accessKey,
      secretKey,
      userId,
      {
        accountName,
        apiBaseUrl,
        environment: environment as any,
      }
    );
    
    // Mark as successful if test passed
    if (testConnection) {
      await markConnectionSuccessful(connectionId);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Feibot connection created successfully',
      data: {
        connectionId,
        accountId: connection.accountId,
        accountName: connection.accountName,
        environment: connection.environment,
        status: connection.status,
        createdAt: connection.createdAt,
      },
    } as APIResponse<any>);
  } catch (error) {
    console.error('Error creating Feibot connection:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create connection',
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Retrieve connections
 * Query: ?accountId=xxx (optional)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    if (!isAuthorized(req)) {
      return unauthorized();
    }
    
    const accountId = req.nextUrl.searchParams.get('accountId');
    
    if (accountId) {
      const connections = await getAccountConnections(accountId);
      
      return NextResponse.json({
        success: true,
        message: `Found ${connections.length} connections`,
        data: connections.map((conn) => ({
          connectionId: conn.connectionId,
          accountId: conn.accountId,
          accountName: conn.accountName,
          status: conn.status,
          environment: conn.environment,
          lastSuccessfulConnection: conn.lastSuccessfulConnection,
          lastSuccessfulSync: conn.lastSuccessfulSync,
          consecutiveFailures: conn.consecutiveFailures,
          createdAt: conn.createdAt,
        })),
      } as APIResponse<any>);
    }
    
    return NextResponse.json(
      {
        success: false,
        message: 'accountId query parameter is required',
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error retrieving Feibot connections:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to retrieve connections',
      },
      { status: 500 }
    );
  }
}
