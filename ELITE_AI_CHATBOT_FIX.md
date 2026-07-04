# Elite Bergman AI Chatbot - Fix & Diagnostics

## Issue: "Server Components Render Error"

When users click "Check my points" or ask questions, they get:
> "An error occurred in the Server Components render. The specific message is omitted in production builds..."

## Root Cause

The chatbot's AI flow (`askEliteAi`) is a `use server` function that calls Google's Gemini API. The error is likely:

1. **Missing/Invalid GOOGLE_GENAI_API_KEY** in production environment
2. **API Permission Issues** (403 Forbidden errors)
3. **Network connectivity** to generativelanguage.googleapis.com
4. **Genkit AI initialization** failing on server startup

## Fixes Applied

### 1. **Enhanced Error Logging** (`src/ai/flows/faq-flow.ts`)
- Added detailed console logging for all errors
- Captures error type, message, and stack trace
- Better distinction between API key issues, auth failures, and service unavailability

### 2. **Improved Error Handling** (`src/components/FaqChatbot.tsx`)
- Added `.catch()` for non-critical operations like `logAiInteractionAction`
- Better console logging with `[Chat]` prefix for debugging
- Graceful fallback to FAQ search when AI fails

### 3. **Health Check Endpoint** (`src/app/api/ai/health/route.ts`)
- New endpoint: `GET /api/ai/health`
- Returns JSON with configuration status for all services
- Shows which environment variables are configured

## How to Diagnose

### Step 1: Check Configuration
Open this in your browser:
```
https://yoursite.com/api/ai/health
```

Look for:
```json
{
  "ai": {
    "configured": true,  // Should be true
    "apiKeyPrefix": "AIzaSyAL..."
  },
  "checks": {
    "googleAiApiKey": "✓ Configured"  // Should show checkmark
  }
}
```

### Step 2: Check Console Logs
When a user sends a message, server logs should show:
```
[Chat] Calling AI with question: Check my points
[Elite AI] Calling flow with question: Check my points
[Elite AI] Flow completed successfully
```

Or if it fails:
```
[Elite AI] Flow Error: {
  "message": "Error details",
  "type": "Error",
  "stack": "Stack trace..."
}
[Chat] AI Error, attempting FAQ fallback...
```

### Step 3: Verify Environment Variable

In your Firebase App Hosting / Cloud Run / deployment environment:
```bash
# Check if GOOGLE_GENAI_API_KEY is set
echo $GOOGLE_GENAI_API_KEY  # Should show a value, not empty
```

If empty:
1. Go to Google Cloud Console
2. Get your Gemini API key from [AI Studio](https://aistudio.google.com/)
3. Add to environment variables in Firebase App Hosting or your deployment platform

### Step 4: Test the AI Directly

Create a temporary test endpoint (`/api/test-ai/route.ts`):
```typescript
import { askEliteAi } from '@/ai/flows/faq-flow';

export async function GET() {
  try {
    const result = await askEliteAi({
      question: 'What is Bergman?',
      context: [{ question: 'What are you?', answer: 'An AI assistant' }],
      userProfile: null,
      eventContext: []
    });
    return Response.json({ success: true, result });
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

## Common Fixes

### **🔴 Current Issue: 403 Forbidden - API Not Enabled**

You're seeing:
```
403 Forbidden - Requests to this API generativelanguage.googleapis.com method
google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent are blocked.
```

**This means:** Your API key exists, but the Google Cloud project hasn't enabled the Generative Language API.

**Fix (5 minutes):**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. **Select your project** at the top
3. **Search for "Generative Language API"**
4. Click on it and press **"ENABLE"**
5. Wait 30 seconds for it to enable
6. Restart your dev server: `npm run dev`
7. Try the chatbot again ✓

**Additional check - API Key Restrictions:**
1. Go to **Credentials** → **API Keys**
2. Find your `GOOGLE_GENAI_API_KEY`
3. Click to edit it
4. Under "API restrictions", ensure:
   - Either "Unrestricted" is selected, OR
   - "Generative Language API" is in the allowed list
5. Click "Save"

**Check Billing:**
- Go to **Billing** → Select your project
- Make sure billing is **ENABLED** and not past due

---

### Fix 1: Missing GOOGLE_GENAI_API_KEY
```bash
# In Firebase App Hosting
firebase apphosting:secrets:gcp:create GOOGLE_GENAI_API_KEY

# Enter your API key from https://aistudio.google.com/
# Then redeploy
firebase deploy --only apphosting
```

### Fix 2: Wrong API Key Format
- Keys should start with `AIzaSy...`
- Check you copied the entire key (no spaces)
- Regenerate key if unsure

### Fix 3: API Disabled in Google Cloud
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Search for "Generative Language API"
3. Click "Enable API"
4. Ensure billing is enabled on the project

### Fix 4: API Key Rate Limit
- Google Gemini has rate limits on free tier
- Wait 60 seconds and retry
- Consider upgrading to paid API if high volume

## Fallback Mechanism

If AI fails for any reason:
1. ✓ Chatbot automatically searches FAQs
2. ✓ Shows relevant FAQ answers to user
3. ✓ Directs user to Contact Us if no match

**Users will NOT see server errors** - they'll get helpful FAQ content instead.

## Testing the Fallback

To test that fallback works:
1. Temporarily rename `GOOGLE_GENAI_API_KEY` to something else
2. Reload the app
3. Try asking a question
4. Should show relevant FAQ answers instead of error

## Production Checklist

- [ ] `GOOGLE_GENAI_API_KEY` is set in App Hosting environment
- [ ] API key is from [AI Studio](https://aistudio.google.com/)
- [ ] Generative Language API is enabled in Google Cloud
- [ ] Billing is enabled on Google Cloud project
- [ ] FAQs are populated in Firestore
- [ ] User can send chat messages (even if AI fails, FAQs fallback works)

## Monitoring

Add this logging snippet to track AI health:
```typescript
// In faq-flow.ts askEliteAi function
if (Math.random() < 0.01) { // Log 1% of requests
  console.log('[Elite AI] Health check - API working');
}
```

---

**Note:** The chatbot is designed to gracefully degrade. If AI is unavailable, it falls back to FAQ search. No user should ever see a server error - they'll get helpful FAQ content instead.
