#!/usr/bin/env node

/**
 * Local Zoho OAuth Diagnostic Script
 * Run this locally to diagnose Zoho authentication issues
 * 
 * Usage: node zoho-diagnose.js
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

function checkmark(text) {
  console.log(`${colors.green}✓${colors.reset} ${text}`);
}

function error(text) {
  console.log(`${colors.red}✗${colors.reset} ${text}`);
}

function warn(text) {
  console.log(`${colors.yellow}⚠${colors.reset} ${text}`);
}

function info(text) {
  console.log(`${colors.blue}ℹ${colors.reset} ${text}`);
}

async function diagnose() {
  console.log('\n' + colors.cyan + '═══════════════════════════════════════' + colors.reset);
  console.log(colors.cyan + '  Zoho OAuth Configuration Diagnostic' + colors.reset);
  console.log(colors.cyan + '═══════════════════════════════════════' + colors.reset + '\n');

  // Step 1: Check environment variables
  console.log(colors.blue + '1️⃣  Checking Environment Variables...' + colors.reset);
  
  const requiredEnvVars = [
    'ZOHO_CLIENT_ID',
    'ZOHO_CLIENT_SECRET', 
    'ZOHO_REFRESH_TOKEN',
    'ZOHO_API_DOMAIN',
    'ZOHO_ORG_ID',
  ];

  const missing = [];
  for (const varName of requiredEnvVars) {
    if (process.env[varName]) {
      const value = varName === 'ZOHO_REFRESH_TOKEN' 
        ? process.env[varName]?.slice(0, 10) + '...'
        : process.env[varName];
      checkmark(`${varName}: ${value}`);
    } else {
      error(`${varName}: NOT SET`);
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.log();
    error(`Missing ${missing.length} environment variable(s): ${missing.join(', ')}`);
    console.log('\nPlease set these variables in your .env file or apphosting.yaml');
    return;
  }

  console.log();

  // Step 2: Test token refresh
  console.log(colors.blue + '2️⃣  Testing Token Refresh...' + colors.reset);

  try {
    const tokenRes = await axios.post(
      'https://accounts.zoho.in/oauth/v2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );

    if (!tokenRes.data?.access_token) {
      error('Token response missing access_token');
      console.log('Response:', JSON.stringify(tokenRes.data, null, 2));
      return;
    }

    checkmark('Successfully obtained access token');
    info(`Token expires in: ${tokenRes.data.expires_in} seconds`);
    if (tokenRes.data.scope) {
      info(`Scope: ${tokenRes.data.scope}`);
    }

    console.log();

    // Step 3: Test API call
    console.log(colors.blue + '3️⃣  Testing API Call...' + colors.reset);

    const accessToken = tokenRes.data.access_token;
    const orgId = process.env.ZOHO_ORG_ID || '60013782026';

    try {
      const apiRes = await axios.get(
        `${process.env.ZOHO_API_DOMAIN}/books/v3/organizations`,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'X-Com-Zoho-Organization-Id': orgId,
          },
          params: { organization_id: orgId },
          timeout: 10000,
        }
      );

      if (apiRes.data?.organizations?.length > 0) {
        checkmark('Successfully called Zoho API');
        apiRes.data.organizations.slice(0, 3).forEach((org) => {
          info(`Organization: ${org.name} (ID: ${org.organization_id})`);
        });
      } else {
        warn('API call succeeded but no organizations found');
      }

      console.log();
      log(colors.green, '\n✅ All checks passed! Zoho OAuth is configured correctly.\n');
    } catch (apiError) {
      error('API call failed');
      console.log('Status:', apiError.response?.status);
      console.log('Error:', apiError.response?.data || apiError.message);
    }
  } catch (err) {
    console.log();
    error('Token refresh failed');
    
    if (err.response?.status === 400) {
      const data = err.response.data;
      if (data.error === 'invalid_grant') {
        error('Refresh token expired or invalid');
        console.log();
        warn('Solution: Re-authorize the Zoho app');
        console.log('1. Visit: https://accounts.zoho.in/');
        console.log('2. Go to Connected Apps or OAuth settings');
        console.log('3. Re-authorize the Books application');
        console.log('4. Copy the new refresh token');
        console.log('5. Update ZOHO_REFRESH_TOKEN in your .env or apphosting.yaml');
      } else if (data.error === 'invalid_client') {
        error('Client ID or Secret is invalid');
        console.log();
        warn('Solution: Check your Zoho credentials');
        console.log('1. Visit: https://accounts.zoho.in/');
        console.log('2. Go to Developer Console → API Credentials');
        console.log('3. Verify your Client ID and Client Secret');
        console.log('4. Update ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET');
      } else {
        console.log('Zoho error:', data.error || data);
      }
    } else if (err.code === 'ECONNREFUSED') {
      error('Cannot connect to Zoho API');
      warn('Check your internet connection and ZOHO_API_DOMAIN');
    } else if (err.code === 'ECONNABORTED') {
      error('Request timeout - Zoho API is not responding');
      warn('Try again later or check your network');
    } else {
      console.log('Error:', err.message);
    }

    console.log();
  }

  console.log(colors.cyan + '═══════════════════════════════════════' + colors.reset + '\n');
}

diagnose().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
