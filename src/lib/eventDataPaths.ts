import type { CollectionReference, Firestore } from 'firebase-admin/firestore';

export const EVENT_COLLECTIONS = {
  registrations: 'participants',
  timingParticipants: 'timingParticipants',
  timingReads: 'timingReads',
  splits: 'splits',
  timingPoints: 'timingPoints',
  devices: 'devices',
  broadcast: 'broadcast',
  liveTracking: 'liveTracking',
  providerParticipants: 'providerParticipants',
} as const;

export const EVENT_KV_KEYS = {
  registrationIndex: (eventId: string) => `event:${eventId}:participants:index`,
  timingParticipantsIndex: (eventId: string) => `live:event:${eventId}:providerParticipants:index`,
  timingReads: (eventId: string) => `live:event:${eventId}:timingReads`,
  leaderboard: (eventId: string) => `live:event:${eventId}:leaderboard`,
  broadcastCamera: (eventId: string, cameraId: string) => `live:${eventId}:camera:${cameraId}`,
  providerParticipantsLegacy: (eventId: string) => `event:${eventId}:providerParticipants`,
} as const;

export function getEventCollectionRef(db: Firestore, eventId: string, collectionName: keyof typeof EVENT_COLLECTIONS): CollectionReference {
  return db.collection('events').doc(eventId).collection(EVENT_COLLECTIONS[collectionName]);
}

export function getRegistrationsCollectionRef(db: Firestore, eventId: string) {
  return getEventCollectionRef(db, eventId, 'registrations');
}

export function getTimingParticipantsCollectionRef(db: Firestore, eventId: string) {
  return getEventCollectionRef(db, eventId, 'timingParticipants');
}
