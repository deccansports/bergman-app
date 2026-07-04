import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';

type BroadcastRole = 'admin' | 'race_director' | 'broadcast_operator';

export type BroadcastAuthResult =
  | { ok: true; uid: string; role: BroadcastRole; requestId: string }
  | { ok: false; status: number; code: string; message: string; requestId: string };

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || randomUUID();
}

function getBearerToken(req: NextRequest) {
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  return token || '';
}

function normalizeRole(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function resolveAllowedRoleSet(userData: Record<string, any>, decoded: Record<string, any>) {
  const roleSet = new Set<string>();

  const docRoles = Array.isArray(userData?.roles) ? userData.roles : [];
  for (const role of docRoles) roleSet.add(normalizeRole(role));

  if (userData?.role) roleSet.add(normalizeRole(userData.role));

  const claimRoles = Array.isArray(decoded?.roles) ? decoded.roles : [];
  for (const role of claimRoles) roleSet.add(normalizeRole(role));

  if (decoded?.role) roleSet.add(normalizeRole(decoded.role));

  if (Boolean(userData?.isAdmin) || Boolean(decoded?.admin) || Boolean(decoded?.isAdmin)) {
    roleSet.add('admin');
  }

  return roleSet;
}

function deny(req: NextRequest, status: number, code: string, message: string): BroadcastAuthResult {
  const requestId = getRequestId(req);
  console.warn('[broadcast-auth]', {
    requestId,
    path: req.nextUrl.pathname,
    result: 'deny',
    status,
    code,
    message,
  });
  return { ok: false, status, code, message, requestId };
}

export async function requireBroadcastManager(req: NextRequest): Promise<BroadcastAuthResult> {
  const token = getBearerToken(req);
  const requestId = getRequestId(req);
  if (!token) {
    return deny(req, 401, 'missing_token', 'Authentication failed.');
  }

  let decoded: Record<string, any>;
  try {
    decoded = await getAuthInstance().verifyIdToken(token);
  } catch (error: any) {
    console.warn('[broadcast-auth]', {
      requestId,
      path: req.nextUrl.pathname,
      result: 'error',
      reason: error?.code || error?.message || 'verify_failed',
    });
    const code = String(error?.code || '').includes('expired') ? 'token_expired' : 'invalid_token';
    const message = code === 'token_expired' ? 'Your session has expired. Please sign in again.' : 'Unable to verify your identity.';
    return { ok: false, status: 401, code, message, requestId };
  }

  let userData: Record<string, any> = {};
  try {
    const db = getFirestoreInstance();
    const userSnap = await db.collection('users').doc(String(decoded.uid || '')).get();
    if (userSnap.exists) userData = (userSnap.data() || {}) as Record<string, any>;
  } catch (error: any) {
    console.warn('[broadcast-auth]', {
      requestId,
      path: req.nextUrl.pathname,
      result: 'user_lookup_error',
      uid: decoded.uid,
      reason: error?.code || error?.message || 'user_lookup_failed',
    });
  }

  const roles = resolveAllowedRoleSet(userData, decoded);
  const allowed = roles.has('admin') || roles.has('race_director') || roles.has('broadcast_operator');
  const resolvedRole = roles.has('admin')
    ? 'admin'
    : roles.has('race_director')
      ? 'race_director'
      : roles.has('broadcast_operator')
        ? 'broadcast_operator'
        : 'broadcast_operator';

  console.log('[broadcast-auth]', {
    requestId,
    path: req.nextUrl.pathname,
    result: allowed ? 'allow' : 'deny',
    uid: decoded.uid,
    role: resolvedRole,
  });

  if (!allowed) {
    return { ok: false, status: 403, code: 'insufficient_permissions', message: 'You do not have permission to manage broadcasts.', requestId };
  }

  return {
    ok: true,
    uid: String(decoded.uid || ''),
    role: resolvedRole,
    requestId,
  };
}
