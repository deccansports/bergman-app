import {
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";

import { APPLE_REVIEW_OTP, isAppleReviewLogin } from "@/core/auth/appleReview";
import {
  AuthRepository,
  type AccountStatusCode,
} from "@/core/repositories/auth.repository";
import { clearDashboardCache } from "@/core/repositories/mobile.repository";
import {
  resumePushRegistrationIfEnabled,
  teardownPushRegistration,
} from "@/core/services/notifications";
import { queryClient } from "@/core/services/query/queryClient";
import type { ApiError } from "@/core/types";

import { getFirebaseAuth, resetFirebaseIdTokenBroker } from "./firebase";
import {
  beginAuthTimeline,
  logAuthTiming,
  resetAuthDiagnosticsForLogout,
} from "./authDiagnostics";
import {
  activateFirebaseSession,
  resetFirebaseSessionBootstrap,
} from "./firebaseSessionBootstrap";
import { clearAccessToken, clearSessionMeta } from "./secureStore";
import { useSession } from "./session";

export type AuthStep = "request" | "verify";

export type AccountRequiredState = {
  code: Exclude<AccountStatusCode, "ACCOUNT_ACTIVE">;
  message: string;
} | null;

const OTP_FAILURE_MESSAGES: Record<string, string> = {
  "Incorrect OTP entered. Please check and try again.":
    "The OTP you entered is incorrect.\n\nPlease check the code sent to your email and try again.",
  "OTP expired":
    "This verification code has expired.\n\nPlease request a new OTP and try again.",
  "Too many incorrect attempts":
    "Too many incorrect attempts.\n\nPlease request a new OTP and try again.",
};

function friendlyOtpErrorMessage(error: unknown): string {
  const apiError = error as Partial<ApiError> & {
    message?: string;
    userMessage?: string;
  };
  const message = apiError.message ?? apiError.userMessage ?? "";
  for (const [needle, replacement] of Object.entries(OTP_FAILURE_MESSAGES)) {
    if (message.includes(needle)) return replacement;
  }
  return "We couldn't verify your OTP at the moment.\n\nPlease try again or request a new verification code.";
}

async function finalizeFirebaseSignIn(auth: Auth, firebaseUser: User) {
  return activateFirebaseSession(auth, firebaseUser);
}

/**
 * Authentication hook mirroring the web flow:
 *   send-email-otp → verify-email-otp → Firebase custom token →
 *   signInWithCustomToken → onAuthStateChanged (AuthProvider) sets the session.
 */
export function useAuth() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const setGuest = useSession((s) => s.setGuest);
  const setAccessToken = useSession((s) => s.setAccessToken);

  const [step, setStep] = useState<AuthStep>("request");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [accountRequired, setAccountRequired] =
    useState<AccountRequiredState>(null);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const loginAttemptActiveRef = useRef(false);
  const overlayHiddenLoggedRef = useRef(false);

  const startLoginTimeline = useCallback((method: "otp" | "password") => {
    loginAttemptActiveRef.current = true;
    overlayHiddenLoggedRef.current = false;
    beginAuthTimeline("login", { method });
  }, []);

  const markLoginOverlayHidden = useCallback((reason: string) => {
    if (!loginAttemptActiveRef.current || overlayHiddenLoggedRef.current)
      return;
    overlayHiddenLoggedRef.current = true;
    loginAttemptActiveRef.current = false;
    logAuthTiming("LOGIN_OVERLAY_HIDDEN", { reason });
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !pending) return;
    // Authentication is complete as soon as Firebase supplies a usable token.
    // Secure-store writes, account validation, and account queries continue in
    // the background and cannot retain the login button/overlay.
    setPending(false);
    markLoginOverlayHidden("authenticated_state");
  }, [markLoginOverlayHidden, pending, status]);

  useEffect(() => {
    if (!pending) return undefined;
    const failsafe = setTimeout(() => {
      if (useSession.getState().status !== "authenticated") return;
      setPending(false);
      markLoginOverlayHidden("authenticated_failsafe");
    }, 1_500);
    return () => clearTimeout(failsafe);
  }, [markLoginOverlayHidden, pending]);

  function accountStatusMessage(
    code: Exclude<AccountStatusCode, "ACCOUNT_ACTIVE">,
  ): string {
    if (code === "ACCOUNT_DISABLED")
      return "Your account is currently unavailable. Please contact Bergman support.";
    if (code === "PROFILE_INCOMPLETE")
      return "Please complete your athlete profile on the Bergman website before continuing.";
    return "Your Bergman athlete account has not been created yet.\n\nPlease visit bergmantri.com and create your account using email OTP login. Once your account is created, return to the Bergman mobile app and log in again.";
  }

  async function requestOtp(nextEmail: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setInfo(null);
    setAccountRequired(null);
    try {
      if (isAppleReviewLogin(nextEmail)) {
        console.log("[Apple Review Login]", {
          email: nextEmail.trim().toLowerCase(),
          timestamp: new Date().toISOString(),
          success: true,
          action: "skip-send-email-otp",
        });
        setEmail(nextEmail);
        setStep("verify");
        setInfo(`For Apple App Review, use OTP ${APPLE_REVIEW_OTP}.`);
        return true;
      }

      const res = await AuthRepository.sendEmailOtp(nextEmail);
      setEmail(nextEmail);
      setStep("verify");
      setInfo(
        res.whatsappSent
          ? "Code sent via email and WhatsApp."
          : "Code sent to your email.",
      );
      setResendCooldownSeconds(45);
      return true;
    } catch (e) {
      setError(
        (e as ApiError).userMessage ??
          "Could not send the code. Please try again.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(otp: string): Promise<boolean> {
    startLoginTimeline("otp");
    setPending(true);
    setError(null);
    setAccountRequired(null);
    let signedInFirebase = false;
    try {
      console.log("[auth] verifyOtp:start", { email, otpLength: otp.length });
      const response = await AuthRepository.verifyEmailOtp(email, otp);
      console.log("[auth] verify-email-otp response", response);

      console.log("[auth] verify-email-otp success", response.success);
      if (response.success !== true) {
        console.log("[auth] verify-email-otp reported failure");
        setError(friendlyOtpErrorMessage(response.message ?? ""));
        return false;
      }

      const firebaseToken = response.token ?? null;
      console.log(
        "[auth] firebase custom token received",
        Boolean(firebaseToken),
      );

      if (!firebaseToken) {
        console.error(
          "[auth] missing access token after verify-email-otp",
          response,
        );
        setError("Unable to sign in. Please try again.");
        return false;
      }

      let firebaseUser: User;
      let firebaseAuth: Auth;
      try {
        console.log("[auth] attempting Firebase sign-in");
        firebaseAuth = await getFirebaseAuth();
        const credential = await signInWithCustomToken(
          firebaseAuth,
          firebaseToken,
        );
        firebaseUser = credential.user;
        signedInFirebase = true;
        console.log("[auth] Firebase sign-in completed");
        logAuthTiming("AUTH_RESTORE_COMPLETE", {
          source: "interactive_firebase_sign_in",
          method: "otp",
        });
      } catch (firebaseError) {
        console.error("[auth] Firebase sign-in failed", firebaseError);
        if (firebaseError instanceof Error && firebaseError.stack)
          console.error(firebaseError.stack);
        setError("Unable to sign in. Please try again.");
        return false;
      }

      const activation = await finalizeFirebaseSignIn(
        firebaseAuth,
        firebaseUser,
      );
      void activation.validation.then((validation) => {
        if (validation.active) return;
        setAccountRequired({
          code: validation.code as Exclude<AccountStatusCode, "ACCOUNT_ACTIVE">,
          message: accountStatusMessage(
            validation.code as Exclude<AccountStatusCode, "ACCOUNT_ACTIVE">,
          ),
        });
      });
      return true;
    } catch (e) {
      console.error("[auth] verifyOtp fatal error", e);
      if (e instanceof Error && e.stack) console.error(e.stack);
      if (signedInFirebase) {
        try {
          const auth = await getFirebaseAuth();
          await signOut(auth);
          await clearSessionMeta();
          await clearAccessToken();
          setAccessToken(null);
          setGuest();
        } catch (signOutError) {
          console.error(
            "[auth] Firebase signOut failed after verifyOtp failure",
            signOutError,
          );
        }
      }
      setError(friendlyOtpErrorMessage(e));
      return false;
    } finally {
      setPending(false);
      if (useSession.getState().status === "authenticated") {
        markLoginOverlayHidden("login_promise_complete");
      }
    }
  }

  async function signInWithPassword(
    emailAddress: string,
    password: string,
  ): Promise<boolean> {
    startLoginTimeline("password");
    setPending(true);
    setError(null);
    setAccountRequired(null);
    try {
      const auth = await getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(
        auth,
        emailAddress,
        password,
      );
      logAuthTiming("AUTH_RESTORE_COMPLETE", {
        source: "interactive_firebase_sign_in",
        method: "password",
      });
      const activation = await finalizeFirebaseSignIn(auth, credential.user);
      void activation.validation.then((validation) => {
        if (validation.active) return;
        setAccountRequired({
          code: validation.code as Exclude<AccountStatusCode, "ACCOUNT_ACTIVE">,
          message: accountStatusMessage(
            validation.code as Exclude<AccountStatusCode, "ACCOUNT_ACTIVE">,
          ),
        });
      });
      return true;
    } catch (e) {
      console.error("[auth] password login fatal error", e);
      if (e instanceof Error && e.stack) console.error(e.stack);
      setError("Unable to sign in with password. Please try again.");
      return false;
    } finally {
      setPending(false);
      if (useSession.getState().status === "authenticated") {
        markLoginOverlayHidden("login_promise_complete");
      }
    }
  }

  function backToRequest() {
    setStep("request");
    setError(null);
    setAccountRequired(null);
  }

  function clearAccountRequired() {
    setAccountRequired(null);
    setError(null);
  }

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  async function logout(): Promise<void> {
    // Switch the app out of the authenticated state first. Firebase sign-out
    // can take a moment on a device, but it must not keep the signed-in UI (or
    // its cached data) visible while that native operation is in progress.
    setGuest();
    resetAuthDiagnosticsForLogout();
    resetFirebaseIdTokenBroker();
    resetFirebaseSessionBootstrap();
    teardownPushRegistration();
    queryClient.clear();

    try {
      await Promise.all([
        clearSessionMeta(),
        clearAccessToken(),
        clearDashboardCache(),
      ]);
    } catch (logoutError) {
      // The session state above is already cleared. Keep logout successful if
      // platform storage is temporarily unavailable.
      console.error("[auth] local logout cleanup failed", logoutError);
    }

    try {
      const auth = await getFirebaseAuth();
      await signOut(auth);
    } catch (logoutError) {
      console.error(
        "[auth] Firebase signOut failed during logout",
        logoutError,
      );
      if (logoutError instanceof Error && logoutError.stack)
        console.error(logoutError.stack);
    } finally {
      // Logout should never surface a rejected background notification task as
      // a native unhandled error.
      void resumePushRegistrationIfEnabled().catch((resumeError) => {
        console.warn(
          "[auth] push registration resume failed after logout",
          resumeError,
        );
      });
    }
  }

  return {
    status,
    user,
    step,
    email,
    pending,
    error,
    info,
    accountRequired,
    resendCooldownSeconds,
    requestOtp,
    verifyOtp,
    signInWithPassword,
    resendOtp: () => requestOtp(email),
    backToRequest,
    clearAccountRequired,
    logout,
  };
}
