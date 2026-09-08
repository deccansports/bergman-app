import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const provider = read("./AuthProvider.tsx");
const bootstrap = read("./firebaseSessionBootstrap.ts");
const diagnostics = read("./authDiagnostics.ts");
const authHook = read("./useAuth.ts");
const dashboard = read(
  "../../features/dashboard/components/AthleteDashboardScreen.tsx",
);
const mobileRepository = read("../repositories/mobile.repository.ts");
const appProviders = read("../providers/AppProviders.tsx");
const firebase = read("./firebase.ts");
const authenticatedFetch = read("./authenticatedFetch.ts");

test("cold and warm restore share one Firebase session activation owner", () => {
  assert.match(provider, /onAuthStateChanged\(auth/);
  assert.match(provider, /activateFirebaseSession\(auth, fbUser\)/);
  assert.match(bootstrap, /activationInFlight\?\.uid === user\.uid/);
  assert.match(bootstrap, /activeActivation\?\.uid === user\.uid/);
  assert.doesNotMatch(provider, /AuthRepository\.checkAccountStatus/);
  assert.doesNotMatch(provider, /saveAccessToken\(token\)/);
});

test("Expo web has one structural AuthProvider ownership path", () => {
  assert.equal((appProviders.match(/<AuthProvider>/g) ?? []).length, 1);
  assert.match(provider, /AUTH_PROVIDER_MOUNT/);
  assert.match(provider, /AUTH_PROVIDER_UNMOUNT/);
  assert.match(provider, /return \(\) => \{[\s\S]*unsub\?\.\(\)/);
});

test("cold-start cached fallback cannot authenticate without a token", () => {
  assert.match(provider, /if \(meta && token\)/);
  assert.match(provider, /}, 8_000\)/);
});

test("token readiness publishes authentication before secondary work", () => {
  const tokenReady = bootstrap.indexOf("() => user.getIdToken()");
  const authenticated = bootstrap.indexOf("setAuthenticated(");
  const persistence = bootstrap.indexOf("persistSession(user, token)");
  const validation = bootstrap.indexOf("validateAccount(auth, user, token)");
  assert(tokenReady >= 0);
  assert(authenticated > tokenReady);
  assert(persistence > authenticated);
  assert(validation > authenticated);
});

test("login overlay follows authenticated state and has a bounded failsafe", () => {
  assert.match(
    authHook,
    /status !== "authenticated" \|\| !pending[\s\S]*setPending\(false\)/,
  );
  assert.match(authHook, /"authenticated_failsafe"/);
  assert.match(authHook, /}, 1_500\)/);
  assert.match(authHook, /LOGIN_OVERLAY_HIDDEN/);
});

test("dashboard and secondary failures cannot retain authentication loading", () => {
  assert.match(bootstrap, /account validation deferred/);
  assert.match(dashboard, /const dashboardInitialLoading =/);
  assert.match(
    dashboard,
    /\{dashboardInitialLoading \? \([\s\S]*<LoadingStack/,
  );
  assert.doesNotMatch(
    dashboard,
    /if \(dashboardQuery\.isLoading && !dashboard\) \{\s*return/,
  );
  assert.match(bootstrap, /void Promise\.all\(/);
  assert.match(bootstrap, /\.catch\(\(error\) => \{/);
});

test("logout resets bootstrap ownership before a new login", () => {
  assert.match(authHook, /resetFirebaseSessionBootstrap\(\)/);
  assert.match(authHook, /resetAuthDiagnosticsForLogout\(\)/);
  assert.match(authHook, /resetFirebaseIdTokenBroker\(\)/);
  assert.match(bootstrap, /export function resetFirebaseSessionBootstrap/);
});

test("authenticated requests share a bounded in-memory Firebase token broker", () => {
  assert.match(firebase, /const ID_TOKEN_REUSE_MS = 5 \* 60_000/);
  assert.match(firebase, /cachedIdToken\?\.uid === user\.uid/);
  assert.match(firebase, /idTokenInFlight\?\.uid === user\.uid/);
  assert.match(firebase, /user\.getIdToken\(forceRefresh\)/);
  assert.match(bootstrap, /primeFirebaseIdTokenCache\(user\.uid, token\)/);
  assert.doesNotMatch(authenticatedFetch, /\.getIdToken\(/);
  assert.doesNotMatch(authenticatedFetch, /SecureStore/);
});

test("development timing events include elapsed stage deltas", () => {
  for (const stage of [
    "AUTH_RESTORE_START",
    "AUTH_RESTORE_COMPLETE",
    "TOKEN_READY",
    "AUTHENTICATED_STATE_SET",
    "LOGIN_OVERLAY_HIDDEN",
  ]) {
    assert.match(diagnostics, new RegExp(stage));
  }
  assert.match(diagnostics, /elapsedMs/);
  assert.match(diagnostics, /sincePreviousStageMs/);
  assert.match(mobileRepository, /DASHBOARD_FETCH_START/);
  assert.match(mobileRepository, /DASHBOARD_FETCH_COMPLETE/);
});
