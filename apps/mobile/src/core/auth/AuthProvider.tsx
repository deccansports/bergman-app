import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { ensureFirebase } from "./firebase";
import {
  clearAccessToken,
  clearSessionMeta,
  getAccessToken,
  getSessionMeta,
} from "./secureStore";
import { useSession } from "./session";
import { beginAuthTimeline, logAuthTiming } from "./authDiagnostics";
import {
  activateFirebaseSession,
  resetFirebaseSessionBootstrap,
} from "./firebaseSessionBootstrap";
import { clearDashboardCache } from "@/core/repositories/mobile.repository";
import { ProductionTrackingSubscriptionRepository } from "@/core/repositories/trackingSubscription.repository";
import { useWatchlistStore } from "@/core/store";
import { resumePushRegistrationIfEnabled } from "@/core/services/notifications";
import { queryKeys } from "@/core/services/query/queryKeys";
import { trackedAthleteFromSubscription } from "@/features/tracking/watchlist/hooks/useWatchlist";

let authProviderMountSequence = 0;

function runBackground(task: Promise<unknown>, label: string) {
  void task.catch((error) => {
    // Background restore/notification work must never create an unhandled
    // rejection during login or app activation.
    console.warn(`[auth] ${label} failed`, error);
  });
}

/**
 * Bootstraps Firebase and mirrors the web's session restoration via the auth
 * state listener: on launch/reload `onAuthStateChanged` fires and sets the
 * session (authenticated/guest). Profile data is loaded separately via React
 * Query (useProfile), never stored here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const mountIdRef = useRef<number | null>(null);
  if (mountIdRef.current === null) {
    authProviderMountSequence += 1;
    mountIdRef.current = authProviderMountSequence;
  }
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.info("AUTH_PROVIDER_MOUNT", { mountId: mountIdRef.current });
    }
    return () => {
      if (process.env.NODE_ENV !== "production") {
        console.info("AUTH_PROVIDER_UNMOUNT", { mountId: mountIdRef.current });
      }
    };
  }, []);
  const setAuthenticated = useSession((s) => s.setAuthenticated);
  const setGuest = useSession((s) => s.setGuest);
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.uid);
  const accessToken = useSession((s) => s.accessToken);
  const previousUserId = useRef<string | null>(null);
  const watchlistReadReasonRef = useRef<
    "initial_restore" | "foreground_reconcile"
  >("initial_restore");
  const accountWatchlistQuery = useQuery({
    queryKey: queryKeys.accountWatchlist(userId ?? "disabled"),
    queryFn: () => {
      if (process.env.NODE_ENV !== "production") {
        console.info("[WATCHLIST_READ]", {
          owner: "auth_provider",
          reason: watchlistReadReasonRef.current,
          userIdPresent: Boolean(userId),
        });
      }
      return ProductionTrackingSubscriptionRepository.list();
    },
    enabled:
      status === "authenticated" && Boolean(userId) && Boolean(accessToken),
    gcTime: Infinity,
    // Account membership is authoritative on the backend. Always make an
    // enabled/restored session fetch before rendering cached device rows.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: (failureCount, error) => {
      const code = (error as { status?: number | null }).status ?? null;
      return ![400, 401, 403, 404].includes(code ?? -1) && failureCount < 1;
    },
  });

  useEffect(() => {
    const priorUserId = previousUserId.current;
    if (priorUserId && priorUserId !== userId) {
      runBackground(
        useWatchlistStore.getState().clearAccount(priorUserId),
        "previous watchlist cleanup",
      );
    }
    previousUserId.current = userId ?? null;
    if (status !== "loading")
      runBackground(resumePushRegistrationIfEnabled(), "push registration");
    if (status === "authenticated" && userId) {
      watchlistReadReasonRef.current = "initial_restore";
      useWatchlistStore.getState().prepareAccount(userId);
    }
    if (status === "guest") {
      // Public tracking remains usable for the current open app session, but a
      // guest has no account-owned watchlist. Never restore a previous guest or
      // signed-in user's tracked athletes after a cold launch/sign-out.
      runBackground(
        useWatchlistStore.getState().clearAccount(null),
        "guest watchlist reset",
      );
    }

    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        // APNs/FCM tokens and permissions can change while the app is in the
        // background (including after returning from system settings).
        runBackground(
          resumePushRegistrationIfEnabled(),
          "foreground push registration",
        );
        if (
          useSession.getState().status === "authenticated" &&
          useSession.getState().accessToken
        ) {
          watchlistReadReasonRef.current = "foreground_reconcile";
          runBackground(
            accountWatchlistQuery.refetch(),
            "foreground watchlist refresh",
          );
        }
      }
    };
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, [accountWatchlistQuery.refetch, status, userId]);

  useEffect(() => {
    if (!userId || accountWatchlistQuery.isFetching) return;
    if (useSession.getState().user?.uid !== userId) return;
    if (accountWatchlistQuery.isError) {
      runBackground(
        useWatchlistStore.getState().hydrate(userId),
        "offline watchlist fallback",
      );
      return;
    }
    if (
      !accountWatchlistQuery.isSuccess ||
      !Array.isArray(accountWatchlistQuery.data)
    )
      return;
    const rows = accountWatchlistQuery.data
      .map(trackedAthleteFromSubscription)
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    useWatchlistStore.getState().replaceAthletes(rows);
    if (rows.length > 0) {
      runBackground(resumePushRegistrationIfEnabled(), "push registration");
    }
  }, [
    accountWatchlistQuery.data,
    accountWatchlistQuery.isError,
    accountWatchlistQuery.isFetching,
    accountWatchlistQuery.isSuccess,
    userId,
  ]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;
    beginAuthTimeline("cold_start", { mountId: mountIdRef.current });
    // iOS can occasionally delay Firebase's first auth callback after an OTA
    // update or a restored Keychain session. Never leave every account screen
    // on its loading skeleton indefinitely while waiting for that callback.
    const authResolutionFallback = setTimeout(() => {
      void (async () => {
        if (!active || useSession.getState().status !== "loading") return;
        const [meta, token] = await Promise.all([
          getSessionMeta(),
          getAccessToken(),
        ]);
        if (!active || useSession.getState().status !== "loading") return;
        logAuthTiming("AUTH_RESTORE_COMPLETE", {
          mountId: mountIdRef.current,
          source: "cached_timeout",
        });
        if (meta && token) {
          logAuthTiming("TOKEN_READY", {
            mountId: mountIdRef.current,
            source: "cached_timeout",
            tokenPresent: true,
          });
          setAuthenticated(
            { uid: meta.uid, email: meta.email, displayName: meta.email },
            token,
          );
          logAuthTiming("AUTHENTICATED_STATE_SET", {
            mountId: mountIdRef.current,
            source: "cached_timeout",
          });
          console.warn(
            "AuthProvider used cached session after Firebase auth callback timed out",
          );
        } else {
          setGuest();
          console.warn(
            "AuthProvider continued as guest after Firebase auth callback timed out",
          );
        }
      })();
    }, 8_000);

    (async () => {
      try {
        const { auth } = await ensureFirebase();
        if (!active) return;
        unsub = onAuthStateChanged(auth, (fbUser) => {
          clearTimeout(authResolutionFallback);
          logAuthTiming("AUTH_RESTORE_COMPLETE", {
            mountId: mountIdRef.current,
            source: "firebase_callback",
            firebaseUserPresent: Boolean(fbUser),
          });
          if (fbUser) {
            void activateFirebaseSession(auth, fbUser)
              .then(() => {
                console.log("AuthProvider restored session", {
                  mountId: mountIdRef.current,
                });
              })
              .catch(async (error) => {
                console.error(
                  "AuthProvider failed to restore Firebase session",
                  error,
                );
                if (!active || auth.currentUser?.uid !== fbUser.uid) return;
                const cachedToken = await getAccessToken();
                if (!cachedToken) {
                  setGuest();
                  return;
                }
                setAuthenticated(
                  {
                    uid: fbUser.uid,
                    email: fbUser.email,
                    displayName: fbUser.displayName,
                  },
                  cachedToken,
                );
                logAuthTiming("AUTHENTICATED_STATE_SET", {
                  mountId: mountIdRef.current,
                  source: "cached_after_token_failure",
                });
                console.warn(
                  "AuthProvider retained Firebase session after a temporary restore failure",
                );
              });
          } else {
            console.log("AuthProvider received null Firebase user");
            resetFirebaseSessionBootstrap();
            setGuest();
            void clearSessionMeta();
            void clearAccessToken();
            void clearDashboardCache();
          }
        });
      } catch (error) {
        clearTimeout(authResolutionFallback);
        logAuthTiming("AUTH_RESTORE_COMPLETE", {
          mountId: mountIdRef.current,
          source: "firebase_initialization_failure",
        });
        // Preserve the last Firebase-derived identity during a temporary native
        // initialization failure. Explicit logout clears this metadata first.
        const [meta, token] = await Promise.all([
          getSessionMeta(),
          getAccessToken(),
        ]);
        if (!active) return;
        if (meta && token) {
          logAuthTiming("TOKEN_READY", {
            mountId: mountIdRef.current,
            source: "cached_initialization_failure",
            tokenPresent: true,
          });
          setAuthenticated(
            { uid: meta.uid, email: meta.email, displayName: meta.email },
            token,
          );
          logAuthTiming("AUTHENTICATED_STATE_SET", {
            mountId: mountIdRef.current,
            source: "cached_initialization_failure",
          });
          console.warn(
            "AuthProvider restored cached session metadata after Firebase initialization failed",
            error,
          );
        } else {
          setGuest();
        }
      }
    })();

    return () => {
      active = false;
      clearTimeout(authResolutionFallback);
      unsub?.();
    };
  }, [setAuthenticated, setGuest]);

  return <>{children}</>;
}
