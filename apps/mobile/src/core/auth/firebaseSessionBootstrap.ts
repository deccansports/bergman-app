import { signOut, type Auth, type User } from "firebase/auth";

import {
  AuthRepository,
  type AccountStatusCode,
} from "@/core/repositories/auth.repository";
import { clearDashboardCache } from "@/core/repositories/mobile.repository";
import { measureFirebaseToken } from "@/core/services/performance/iosLiveDiagnostics";

import { logAuthTiming } from "./authDiagnostics";
import { primeFirebaseIdTokenCache } from "./firebase";
import {
  clearAccessToken,
  clearSessionMeta,
  saveAccessToken,
  saveSessionMeta,
} from "./secureStore";
import { useSession } from "./session";

export type FirebaseSessionValidation = {
  active: boolean;
  code: AccountStatusCode;
};

export type FirebaseSessionActivation = {
  token: string;
  validation: Promise<FirebaseSessionValidation>;
};

let activationInFlight: {
  uid: string;
  promise: Promise<FirebaseSessionActivation>;
} | null = null;
let activeActivation: {
  uid: string;
  token: string;
  validation: Promise<FirebaseSessionValidation>;
} | null = null;

export function resetFirebaseSessionBootstrap() {
  activationInFlight = null;
  activeActivation = null;
}

function isAccountStatusUnavailable(error: unknown): boolean {
  return (error as { status?: number | null }).status === 404;
}

function isTerminalFirebaseSessionError(error: unknown): boolean {
  const code = String((error as { code?: unknown }).code ?? "").toLowerCase();
  return [
    "auth/user-disabled",
    "auth/user-token-expired",
    "auth/invalid-user-token",
  ].includes(code);
}

async function clearRejectedSession(auth: Auth) {
  resetFirebaseSessionBootstrap();
  await signOut(auth).catch(() => undefined);
  useSession.getState().setGuest();
  await Promise.allSettled([
    clearSessionMeta(),
    clearAccessToken(),
    clearDashboardCache(),
  ]);
}

async function validateAccount(
  auth: Auth,
  user: User,
  token: string,
): Promise<FirebaseSessionValidation> {
  try {
    const accountStatus = await AuthRepository.checkAccountStatus(token).catch(
      (error) => {
        if (!isAccountStatusUnavailable(error)) throw error;
        return {
          success: true,
          accountExists: true,
          uid: user.uid,
          profileComplete: true,
          code: "ACCOUNT_ACTIVE" as const,
        };
      },
    );
    const active =
      accountStatus.accountExists === true &&
      accountStatus.code !== "ACCOUNT_DISABLED" &&
      accountStatus.code !== "PROFILE_INCOMPLETE" &&
      accountStatus.code !== "ACCOUNT_NOT_CREATED";
    if (!active) await clearRejectedSession(auth);
    return {
      active,
      code:
        accountStatus.code ??
        (active ? "ACCOUNT_ACTIVE" : "ACCOUNT_NOT_CREATED"),
    };
  } catch (error) {
    if (isTerminalFirebaseSessionError(error)) {
      await clearRejectedSession(auth);
      return { active: false, code: "ACCOUNT_DISABLED" };
    }
    // Account-status availability is not an authentication loading gate.
    // Firebase remains authoritative while this secondary check retries later.
    console.warn("[auth] account validation deferred", error);
    return { active: true, code: "ACCOUNT_ACTIVE" };
  }
}

function persistSession(user: User, token: string) {
  void Promise.all([
    saveAccessToken(token),
    saveSessionMeta({
      uid: user.uid,
      email: user.email,
      lastLoginAt: Date.now(),
    }),
  ]).catch((error) => {
    console.warn("[auth] session persistence failed", error);
  });
}

/**
 * Single Firebase-session activation owner for cold restore and interactive
 * login. Token readiness updates Zustand immediately; persistence, account
 * validation, watchlist, dashboard, and every other query remain non-blocking.
 */
export function activateFirebaseSession(
  auth: Auth,
  user: User,
): Promise<FirebaseSessionActivation> {
  const existing = useSession.getState();
  if (
    existing.status === "authenticated" &&
    existing.user?.uid === user.uid &&
    existing.accessToken
  ) {
    if (
      activeActivation?.uid === user.uid &&
      activeActivation.token === existing.accessToken
    ) {
      return Promise.resolve({
        token: activeActivation.token,
        validation: activeActivation.validation,
      });
    }
    const validation = validateAccount(auth, user, existing.accessToken);
    activeActivation = {
      uid: user.uid,
      token: existing.accessToken,
      validation,
    };
    return Promise.resolve({
      token: existing.accessToken,
      validation,
    });
  }
  if (activationInFlight?.uid === user.uid) return activationInFlight.promise;

  const promise = (async () => {
    const token = await measureFirebaseToken(
      false,
      "firebaseSessionBootstrap",
      () => user.getIdToken(),
    );
    primeFirebaseIdTokenCache(user.uid, token);
    logAuthTiming("TOKEN_READY", { participantScope: "account" });
    useSession.getState().setAuthenticated(
      {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      },
      token,
    );
    logAuthTiming("AUTHENTICATED_STATE_SET", { uidPresent: Boolean(user.uid) });
    persistSession(user, token);
    const validation = validateAccount(auth, user, token);
    activeActivation = { uid: user.uid, token, validation };
    return {
      token,
      validation,
    };
  })().finally(() => {
    if (activationInFlight?.promise === promise) activationInFlight = null;
  });

  activationInFlight = { uid: user.uid, promise };
  return promise;
}
