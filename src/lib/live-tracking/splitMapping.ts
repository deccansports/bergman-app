import { getKV, putKV } from '@/lib/cloudflare/kv';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { normalizeSplitMapping, type SplitMapping } from '@/lib/live-tracking/splitMappingShared';

export type { SplitMapping, SplitMappingContestEntry } from '@/lib/live-tracking/splitMappingShared';
export {
  normalize,
  normalizeSplitKey,
  extractSplitUuid,
  extractContestUuid,
  getEnabledSplitSet,
  applySplitMappingToCourseIndex,
  filterTimingConfigurationSplits,
} from '@/lib/live-tracking/splitMappingShared';

const KV_TAG = 'split-mapping';

export function splitMappingKvKey(eventId: string) {
  return `live:event:${eventId}:split:mapping`;
}

/**
 * Loads the persisted split → athlete-dashboard visibility mapping for an event.
 * Reads from Cloudflare KV first, falling back to the Firestore mirror.
 */
export async function loadSplitMapping(eventId: string): Promise<SplitMapping | null> {
  const kvMapping = await getKV<SplitMapping>(splitMappingKvKey(eventId), KV_TAG).catch(() => null);
  if (kvMapping && typeof kvMapping === 'object') return normalizeSplitMapping(eventId, kvMapping);

  const firestore = await getFirestoreInstance()
    .collection('events')
    .doc(eventId)
    .collection('liveTracking')
    .doc('splitMapping')
    .get()
    .catch(() => null);
  const firestoreMapping = firestore?.exists ? (firestore.data() as SplitMapping) : null;
  return firestoreMapping ? normalizeSplitMapping(eventId, firestoreMapping) : null;
}

export async function saveSplitMapping(eventId: string, mapping: SplitMapping): Promise<SplitMapping> {
  const payload: SplitMapping = {
    ...mapping,
    eventId,
    version: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'split-mapping',
  };
  await putKV(splitMappingKvKey(eventId), payload, KV_TAG);
  await getFirestoreInstance()
    .collection('events')
    .doc(eventId)
    .collection('liveTracking')
    .doc('splitMapping')
    .set(payload, { merge: false });
  return payload;
}
