// API route to check AI service health
import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  const orgId = process.env.ZOHO_ORG_ID;
  const apiDomain = process.env.ZOHO_API_DOMAIN;
  
  const health = {
    timestamp: new Date().toISOString(),
    status: 'ok',
    ai: {
      configured: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'NOT_SET'
    },
    environment: process.env.NODE_ENV,
    checks: {
      googleAiApiKey: apiKey ? '✓ Configured' : '✗ Missing - AI features will not work',
      zohoOrgId: orgId ? '✓ Configured' : '⚠ Warning - Zoho features may not work',
      zohoApiDomain: apiDomain ? '✓ Configured' : '⚠ Warning - Zoho features may not work'
    }
  };

  return NextResponse.json(health);
}
