import type { Firestore } from 'firebase-admin/firestore';
import { serializeValue } from '@/lib/utils';

export const LIVE_CAMERA_COLLECTION = 'liveCameras';
export const LEGACY_BROADCAST_CAMERA_COLLECTION = 'broadcastCameras';

export function getLiveCameraDocRef(db: Firestore, eventId: string, cameraId: string) {
  return db.collection('events').doc(eventId).collection(LIVE_CAMERA_COLLECTION).doc(cameraId);
}

export function getLegacyBroadcastCameraDocRef(db: Firestore, cameraId: string) {
  return db.collection(LEGACY_BROADCAST_CAMERA_COLLECTION).doc(cameraId);
}

export function getLiveCameraQuerySnapshotToList(snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>) {
  return snapshot.docs.map((doc) => ({ cameraId: doc.id, ...(serializeValue(doc.data() || {}) as Record<string, any>) }));
}

export async function loadEventLiveCameras(db: Firestore, eventId: string) {
  const [nestedSnap, legacySnap] = await Promise.all([
    db.collection('events').doc(eventId).collection(LIVE_CAMERA_COLLECTION).get().catch(() => null),
    db.collection(LEGACY_BROADCAST_CAMERA_COLLECTION).where('eventId', '==', eventId).get(),
  ]);

  const nested = nestedSnap ? getLiveCameraQuerySnapshotToList(nestedSnap as any) : [];
  const legacy = getLiveCameraQuerySnapshotToList(legacySnap as any);

  if (nested.length === 0) return legacy;

  const merged = new Map<string, Record<string, any>>();
  for (const camera of legacy) merged.set(String(camera.cameraId || '').trim(), camera);
  for (const camera of nested) merged.set(String(camera.cameraId || '').trim(), camera);
  return Array.from(merged.values());
}

export async function mirrorLiveCameraDocument(db: Firestore, eventId: string, cameraId: string, data: Record<string, any>) {
  const nestedRef = getLiveCameraDocRef(db, eventId, cameraId);
  const legacyRef = getLegacyBroadcastCameraDocRef(db, cameraId);
  await Promise.all([
    nestedRef.set(data, { merge: true }),
    legacyRef.set(data, { merge: true }),
  ]);
}

export async function deleteLiveCameraDocument(db: Firestore, eventId: string, cameraId: string) {
  const nestedRef = getLiveCameraDocRef(db, eventId, cameraId);
  const legacyRef = getLegacyBroadcastCameraDocRef(db, cameraId);
  await Promise.all([
    nestedRef.delete().catch(() => null),
    legacyRef.delete().catch(() => null),
  ]);
}
