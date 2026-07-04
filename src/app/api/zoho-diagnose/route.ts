
// app/api/zoho-diagnose/route.ts
import { NextResponse } from "next/server";
import axios from "axios";

export async function GET() {
  const envDump = {
    ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID,
    ZOHO_ORG_ID: process.env.ZOHO_ORG_ID,
    ZOHO_API_DOMAIN: process.env.ZOHO_API_DOMAIN,
    REFRESH_TOKEN_START: process.env.ZOHO_REFRESH_TOKEN?.slice(0, 15),
    ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID: process.env.ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID,
    ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID: process.env.ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID,
  };

  try {
    // 0️⃣ Validate all required env vars exist
    const missingEnvVars = [];
    if (!process.env.ZOHO_CLIENT_ID) missingEnvVars.push('ZOHO_CLIENT_ID');
    if (!process.env.ZOHO_CLIENT_SECRET) missingEnvVars.push('ZOHO_CLIENT_SECRET');
    if (!process.env.ZOHO_REFRESH_TOKEN) missingEnvVars.push('ZOHO_REFRESH_TOKEN');
    if (!process.env.ZOHO_API_DOMAIN) missingEnvVars.push('ZOHO_API_DOMAIN');
    if (!process.env.ZOHO_ORG_ID) missingEnvVars.push('ZOHO_ORG_ID');
    
    if (missingEnvVars.length > 0) {
      return NextResponse.json({
        status: "ERROR",
        reason: "Missing environment variables",
        missingEnvVars,
        envDump,
      }, { status: 400 });
    }

    // 1️⃣ Fetch token
    console.log('[Zoho Diagnose] Attempting token refresh...');
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
    const tokenRes = await axios.post(
      "https://accounts.zoho.in/oauth/v2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.ZOHO_CLIENT_ID!,
        client_secret: process.env.ZOHO_CLIENT_SECRET!,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
      }).toString(),
      { 
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000 
      }
    );
    
    console.log('[Zoho Diagnose] Token refresh successful');

    const accessToken = tokenRes.data.access_token;

    // 2️⃣ Call Zoho with that token
    const orgRes = await axios.get(
      `${process.env.ZOHO_API_DOMAIN}/books/v3/organizations`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "X-Com-Zoho-Organization-Id": "60013782026",
        },
        params: {
            organization_id: "60013782026",
        }
      }
    );

    return NextResponse.json({
      status: "SUCCESS",
      envDump,
      tokenScope: tokenRes.data.scope,
      orgResponse: orgRes.data.organizations.map((o: any) => ({
        id: o.organization_id,
        name: o.name,
      })),
    });

  } catch (err: any) {
    console.error('[Zoho Diagnose Error]', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });

    // Parse Zoho-specific error details
    const zohoError = err.response?.data || {};
    let diagnosis = "Unknown error";
    let suggestedAction = "Check Zoho OAuth configuration";

    if (err.response?.status === 400) {
      if (zohoError.error === 'invalid_grant') {
        diagnosis = "Refresh token expired or invalid";
        suggestedAction = "Re-authorize the Zoho app at https://accounts.zoho.in/";
      } else if (zohoError.error === 'invalid_client') {
        diagnosis = "Client ID or Secret is invalid";
        suggestedAction = "Verify ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in environment variables";
      } else {
        diagnosis = `OAuth Error: ${zohoError.error || 'Unknown'}`;
        suggestedAction = `Server returned: ${JSON.stringify(zohoError)}`;
      }
    } else if (err.response?.status === 401) {
      diagnosis = "Authentication failed";
      suggestedAction = "Access token is invalid or expired";
    } else if (err.response?.status === 429) {
      diagnosis = "Rate limit exceeded";
      suggestedAction = "Wait before retrying the request";
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      diagnosis = "Cannot connect to Zoho API";
      suggestedAction = "Check internet connection and ZOHO_API_DOMAIN";
    } else if (err.code === 'ECONNABORTED') {
      diagnosis = "Request timeout";
      suggestedAction = "Zoho API is slow or unavailable";
    }

    return NextResponse.json({
      status: "FAILED",
      envDump,
      httpStatus: err.response?.status || 'N/A',
      zohoError,
      diagnosis,
      suggestedAction,
      errorMessage: err.message,
    }, { status: 500 });
  }
}
