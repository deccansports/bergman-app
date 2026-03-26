// src/lib/zoho/token.ts
import axios from "axios";

export async function getZohoAccessToken(): Promise<string> {
  const res = await axios.post(
    "https://accounts.zoho.in/oauth/v2/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  if (!res.data?.access_token) {
    throw new Error("Zoho access token missing");
  }

  return res.data.access_token;
}
