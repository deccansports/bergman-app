import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { NextRequest } from 'next/server';

export type LiveTrackingPrivacy = 'PUBLIC' | 'PRIVATE';

export type LiveTrackingAccessContext = {
  isPublic: boolean;
  isAdmin: boolean;
  uid: string | null;
  email: string | null;
  emailLower: string | null;
  tokenValid: boolean;
  userData: Record<string, any> | null;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return normalize(value).toLowerCase();
}

export function normalizeLiveTrackingPrivacy(value: unknown): LiveTrackingPrivacy {
  return String(value ?? '').trim().toUpperCase() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
}

export function getParticipantLiveTrackingPrivacy(row: Record<string, any> | null | undefined): LiveTrackingPrivacy {
  if (!row || typeof row !== 'object') return 'PUBLIC';

  const candidates = [
    row?.privacy,
    row?.liveTrackingPrivacy,
    row?.registration?.liveTrackingPrivacy,
    row?.registration?.privacy,
    row?.userProfile?.liveTrackingPrivacy,
    row?.userProfile?.registration?.liveTrackingPrivacy,
    row?.profile?.liveTrackingPrivacy,
  ];

  for (const candidate of candidates) {
    const privacy = normalizeLiveTrackingPrivacy(candidate);
    if (privacy === 'PRIVATE') return 'PRIVATE';
  }

  return 'PUBLIC';
}

export function isPrivateLiveTracking(row: Record<string, any> | null | undefined) {
  return getParticipantLiveTrackingPrivacy(row) === 'PRIVATE';
}

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

export function isSelfViewingParticipant(row: Record<string, any> | null | undefined, access: Pick<LiveTrackingAccessContext, 'uid' | 'emailLower'>) {
  if (!row || typeof row !== 'object') return false;

  const uid = normalize(access.uid);
  const emailLower = normalize(access.emailLower).toLowerCase();

  const rowUidCandidates = [
    row?.athleteUid,
    row?.bergmanAthleteId,
    row?.bergmanAthleteUid,
    row?.userId,
    row?.participant?.athleteUid,
    row?.registration?.athleteUid,
  ].map((value) => normalize(value)).filter(Boolean);

  const rowEmailCandidates = [
    row?.email,
    row?.registration?.email,
    row?.buyerEmail,
    row?.userProfile?.email,
  ].map((value) => lower(value)).filter(Boolean);

  return Boolean(
    (uid && rowUidCandidates.includes(uid))
    || (emailLower && rowEmailCandidates.includes(emailLower))
  );
}

export function canAccessPrivateLiveTracking(row: Record<string, any> | null | undefined, access: LiveTrackingAccessContext) {
  if (access.isAdmin) return true;
  return isSelfViewingParticipant(row, access);
}

export function isPrivateVisibleToPublic(row: Record<string, any> | null | undefined, access: LiveTrackingAccessContext) {
  return isPrivateLiveTracking(row) && !canAccessPrivateLiveTracking(row, access);
}

export function maskPrivateAthlete(row: Record<string, any>) {
  const privacy = 'PRIVATE' as const;
  return {
    ...row,
    privacy,
    liveTrackingPrivacy: privacy,
    searchVisible: false,
    mapVisible: false,
    modalVisible: false,
    name: 'Anonymous Athlete',
    fullName: 'Anonymous Athlete',
    firstName: null,
    lastName: null,
    initials: 'AA',
    bib: '',
    bibNumber: '',
    email: null,
    mobile: null,
    clubName: null,
    country: null,
    city: null,
    state: null,
    athleteUid: null,
    participantUuid: null,
    participant_uuid: null,
    providerParticipantUuid: null,
    avatarUrl: null,
    photoURL: null,
    photoUrl: null,
    liveTracking: {
      ...(row?.liveTracking || {}),
      privacy,
    },
    registration: {
      ...(row?.registration || {}),
      liveTrackingPrivacy: privacy,
    },
  };
}
