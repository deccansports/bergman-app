import type { User as FirebaseAuthUser } from 'firebase/auth';

export type AuthenticatedFetchError = {
  code: string;
  message: string;
  status: number;
};

function mapStatusToMessage(status: number, fallback: string) {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to manage broadcasts.';
  return fallback;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}, firebaseUserFromAuth?: FirebaseAuthUser | null): Promise<Response> {
  if (!firebaseUserFromAuth) {
    throw { code: 'unauthenticated', message: 'Authentication failed.', status: 401 } satisfies AuthenticatedFetchError;
  }

  const token = await firebaseUserFromAuth.getIdToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, { ...init, headers });
  if (response.status !== 401 && response.status !== 403) return response;

  const refreshedToken = await firebaseUserFromAuth.getIdToken(true);
  headers.set('Authorization', `Bearer ${refreshedToken}`);
  const retried = await fetch(input, { ...init, headers });
  if (retried.status === 401 || retried.status === 403) {
    throw { code: 'auth_failed', message: mapStatusToMessage(retried.status, 'Authentication failed.'), status: retried.status } satisfies AuthenticatedFetchError;
  }

  return retried;
}
