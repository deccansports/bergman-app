/**
 * Feibot Health Check Endpoint
 * 
 * GET /api/feibot/health/{connectionId}
 * Tests API connectivity and displays connection health
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getFeibotConnection,
  getDecryptedCredentials,
  markConnectionSuccessful,
  recordConnectionFailure,
} from '@/lib/feibot-integration/credentials';
import { testFeibotConnection } from '@/lib/feibot-integration/api-client';
import type { APIResponse, HealthCheckResponse } from '@/lib/feibot-integration/types';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  
  const token =
    req.headers.get('x-bergman-internal-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  
  return token === expectedToken;
}

/**
 * GET - Test Feibot connection health
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { connectionId: string } }
): Promise<NextResponse> {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const connectionId = String(params.connectionId || '').trim();
    
    if (!connectionId) {
      return NextResponse.json(
        { success: false, message: 'Connection ID is required' },
        { status: 400 }
      );
    }
    
    // Get connection
    const connection = await getFeibotConnection(connectionId);
    
    if (!connection) {
      return NextResponse.json(
        { success: false, message: 'Connection not found' },
        { status: 404 }
      );
    }
    
    // Get decrypted credentials
    let credentials;
    try {
      credentials = await getDecryptedCredentials(connectionId);
      
      if (!credentials) {
        return NextResponse.json(
          {
            success: false,
            message: 'Failed to decrypt credentials',
          },
          { status: 500 }
        );
      }
    } catch (error) {
      console.error('Error decrypting credentials:', error);
      
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to decrypt credentials',
        },
        { status: 500 }
      );
    }
    
    // Test connection
    const startTime = Date.now();
    const testResult = await testFeibotConnection(credentials);
    const responseTimeMs = Date.now() - startTime;
    
    // Update connection status
    if (testResult.success) {
      await markConnectionSuccessful(connectionId);
    } else {
      await recordConnectionFailure(connectionId, testResult.message);
    }
    
    const healthResponse: HealthCheckResponse = {
      connectionStatus: testResult.success ? 'connected' : 'failed',
      apiStatus: testResult.success ? 'reachable' : 'unreachable',
      credentialsValid: testResult.success,
      lastConnection: connection.lastSuccessfulConnection,
      diagnostics: {
        responseTimeMs,
        httpStatus: testResult.statusCode || 0,
        error: testResult.success ? undefined : testResult.message,
      },
    };
    
    return NextResponse.json({
      success: testResult.success,
      message: testResult.message,
      data: {
        connectionId,
        accountId: connection.accountId,
        accountName: connection.accountName,
        environment: connection.environment,
        status: connection.status,
        health: healthResponse,
        consecutiveFailures: connection.consecutiveFailures,
        failureCount: connection.failureCount,
        lastSuccessfulConnection: connection.lastSuccessfulConnection,
        lastSuccessfulSync: connection.lastSuccessfulSync,
        lastFailedAttempt: connection.lastFailedAttempt,
      },
    } as APIResponse<any>);
  } catch (error) {
    console.error('Error checking Feibot health:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Health check failed',
      },
      { status: 500 }
    );
  }
}
