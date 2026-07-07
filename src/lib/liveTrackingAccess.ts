import type { NextRequest } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { canAccessPrivateLiveTracking, isPrivateVisibleToPublic, type LiveTrackingAccessContext } from '@/lib/liveTrackingPrivacy';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return normalize(value).toLowerCase();
}

export type { LiveTrackingAccessContext };
export { canAccessPrivateLiveTracking, isPrivateVisibleToPublic };

export async function resolveLiveTrackingAccess(req: NextRequest): Promise<LiveTrackingAccessContext> {
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return {
      isPublic: true,
      isAdmin: false,
      uid: null,
      email: null,
      emailLower: null,
      tokenValid: false,
      userData: null,
    };
  }

  try {
    const decoded = await getAuthInstance().verifyIdToken(token);
    const uid = normalize(decoded?.uid);
    let userData: Record<string, any> | null = null;

    if (uid) {
      try {
        const userSnap = await getFirestoreInstance().collection('users').doc(uid).get();
        userData = userSnap.exists ? (userSnap.data() || {}) : null;
      } catch {
        userData = null;
      }
    }

    const isAdmin = Boolean(userData?.isAdmin || decoded?.admin || decoded?.isAdmin || userData?.role === 'admin' || decoded?.role === 'admin');
    const email = normalize(userData?.email || decoded?.email || null) || null;

    return {
      isPublic: false,
      isAdmin,
      uid: uid || null,
      email,
      emailLower: email ? lower(email) : null,
      tokenValid: true,
      userData,
    };
  } catch {
    return {
      isPublic: true,
      isAdmin: false,
      uid: null,
      email: null,
      emailLower: null,
      tokenValid: false,
      userData: null,
    };
  }
}
