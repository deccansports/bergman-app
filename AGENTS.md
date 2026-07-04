# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
`Bergman Athlete Hub` — a **Next.js 14 (App Router)** web app for a triathlon/endurance-sports
platform. The root package (`nextn`) is the main product. Satellite services exist but are
**not required** to run/develop the app locally:
- `functions/` — Firebase Functions (background/scheduled jobs). Optional. Has its own `package.json`.
- `worker.js` + `wrangler.toml`, `cloudflare/live-tracking-worker/` — Cloudflare Workers (edge). Optional.
- `src/functions/` — secondary Firebase Functions set (its own `package.json` is empty `{}`).

### Node version
- The dev environment provides Node 22 at `/exec-daemon/node` (forced to the front of `PATH`, overrides nvm).
- `package.json` declares `engines.node: "20"`, but **the app runs cleanly on the provided Node 22**
  (install, `next lint`, `tsc --noEmit`, and `next dev` all pass). No node-version juggling is needed.

### Standard commands (see root `package.json`)
- Install: `npm install`
- Dev server: `npm run dev` → serves on `http://localhost:3000`
- Lint: `npm run lint` (passes with only warnings)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Combined: `npm run check` (lint + typecheck)
- Note: `next.config.mjs` sets `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds` = true,
  so `npm run build` can pass even with type/lint errors — use `npm run typecheck` to truly validate types.

### CRITICAL: `.env.local` is required for the app to render locally
- The app reads Firebase client config from `NEXT_PUBLIC_FIREBASE_*` env vars (`src/lib/firebaseConfig.ts`).
  If `NEXT_PUBLIC_FIREBASE_API_KEY` is **missing/empty**, server-side rendering of pages throws
  `FirebaseError: auth/invalid-api-key` and **every page returns HTTP 500** (the client Firebase SDK is
  imported during SSR via `AuthContext`).
- `.env.local` is **gitignored** (`.gitignore` ignores `.env`/`.env.*`), so it is intentionally not committed.
- To make the UI render **without real credentials**, create `/workspace/.env.local` with non-functional
  placeholder client values (this is enough to boot the UI; backend data stays empty):
  ```
  NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyDUMMY-placeholder-key-local-dev-000000
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-app.firebaseapp.com
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-app
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-app.appspot.com
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
  NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-0000000000
  ```
- Real environment variables (e.g. secrets injected via the Secrets panel) take precedence over `.env.local`
  in Next.js, so setting real secrets later will override these placeholders.

### Backends are PRODUCTION, not emulated
- `.idx/dev.nix` has Firebase emulators disabled (`detect = false`) — the app points at **live** Firebase
  and Cloudflare KV by default.
- Without real credentials you will see (non-fatal, caught) log noise like:
  - `[firebaseAdmin] Missing required environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY`
  - `[KV READ ERROR] ... Cloudflare API token is missing.`
  These are handled gracefully; pages still render with **empty** data (e.g. "No slider items configured",
  "No upcoming events", empty rankings).
- For **full end-to-end functionality** (login/OTP, real rankings, registration, shop, payments, invoicing)
  you need the real secrets defined in `apphosting.yaml`. The minimum set to get real data flowing:
  - Client: `NEXT_PUBLIC_FIREBASE_*`
  - Firebase Admin (server): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
  - Cloudflare KV: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_NAMESPACE_ID`, `CLOUDFLARE_API_TOKEN`
  Add these via the Secrets panel so they are injected as env vars for the dev server.

### Auth-guarded routes
- Many routes (e.g. `/about`, `/dashboard`, `/orders`, `/cart`, `/checkout`) are auth-guarded and redirect
  to `/login?redirect=...` when unauthenticated. This is expected behavior, not a bug.
- The `/login` page runs a client auth-state check; with placeholder (non-real) Firebase config the
  auth state never resolves, so it can sit on a full-screen loading spinner (`AthleteHubLoader`).
