
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
    // 1️⃣ Fetch token
    const tokenRes = await axios.post(
      "https://accounts.zoho.in/oauth/v2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.ZOHO_CLIENT_ID!,
        client_secret: process.env.ZOHO_CLIENT_SECRET!,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

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
    return NextResponse.json({
      status: "FAILED",
      envDump,
      error: err.response?.data || err.message,
    }, { status: 500 });
  }
}
