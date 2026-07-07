export type LiveTrackingPrivacy = 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE';

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
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'PRIVATE' || raw === 'OFFICIALS_ONLY' || raw === 'OFFICIALS ONLY') return 'PRIVATE';
  if (raw === 'ANONYMOUS' || raw === 'ANON') return 'ANONYMOUS';
  return 'PUBLIC';
}

export function getParticipantLiveTrackingPrivacy(row: Record<string, any> | null | undefined): LiveTrackingPrivacy {
  if (!row || typeof row !== 'object') return 'PUBLIC';

  const candidates = [
    row?.privacy,
    row?.trackingVisibility,
    row?.liveTrackingPrivacy,
    row?.registration?.liveTrackingPrivacy,
    row?.registration?.trackingVisibility,
    row?.registration?.privacy,
    row?.userProfile?.liveTrackingPrivacy,
    row?.userProfile?.trackingVisibility,
    row?.userProfile?.registration?.liveTrackingPrivacy,
    row?.profile?.liveTrackingPrivacy,
  ];

  for (const candidate of candidates) {
    const privacy = normalizeLiveTrackingPrivacy(candidate);
    if (privacy === 'PRIVATE') return 'PRIVATE';
    if (privacy === 'ANONYMOUS') return 'ANONYMOUS';
  }

  return 'PUBLIC';
}

export function isPrivateLiveTracking(row: Record<string, any> | null | undefined) {
  return getParticipantLiveTrackingPrivacy(row) === 'PRIVATE';
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
  const roleCandidates = [
    access?.userData?.role,
    access?.userData?.adminRole,
    ...(Array.isArray(access?.userData?.roles) ? access.userData.roles : []),
    ...(Array.isArray(access?.userData?.permissions) ? access.userData.permissions : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

  const officialAllowList = [
    'super admin',
    'super_admin',
    'timing director',
    'timing_director',
    'race director',
    'race_director',
    'live tracking volunteer',
    'live_tracking_volunteer',
    'timing volunteer',
    'timing_volunteer',
    'medical',
    'marshal',
  ];

  const isOfficialRole = roleCandidates.some((role) => officialAllowList.includes(role));
  if (isOfficialRole) return true;

  const volunteerTag = String(access?.userData?.volunteerRole || access?.userData?.volunteerType || '').trim().toLowerCase();
  if (officialAllowList.includes(volunteerTag)) return true;

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
    trackingVisibility: privacy,
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

export function maskAnonymousAthlete(row: Record<string, any>) {
  const privacy = 'ANONYMOUS' as const;
  const rawBib = String(row?.bib || row?.bibNumber || '').trim();
  const bibSuffix = rawBib
    ? (rawBib.replace(/\D/g, '').slice(-4) || rawBib.slice(-4))
    : '';
  const maskedBib = bibSuffix ? `****${bibSuffix}` : '****';
  return {
    ...row,
    privacy,
    trackingVisibility: privacy,
    liveTrackingPrivacy: privacy,
    searchVisible: false,
    mapVisible: true,
    modalVisible: true,
    name: 'Anonymous Athlete',
    fullName: 'Anonymous Athlete',
    firstName: null,
    lastName: null,
    initials: 'AA',
    bib: maskedBib,
    bibNumber: maskedBib,
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
      trackingVisibility: privacy,
      liveTrackingPrivacy: privacy,
    },
  };
}
