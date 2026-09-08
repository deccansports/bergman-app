export type TrackingSelectionAfterRemoval = {
  remainingKeys: string[];
  nextSelectedKey: string | null;
  nextSelectedIndex: number;
};

export function responseMatchesSelectedParticipant(
  responseParticipantUuid: string | null | undefined,
  selectedParticipantUuid: string | null | undefined,
): boolean {
  const response = String(responseParticipantUuid ?? "")
    .trim()
    .toLowerCase();
  const selected = String(selectedParticipantUuid ?? "")
    .trim()
    .toLowerCase();
  return Boolean(response && selected && response === selected);
}

/** Canonical participant identity is complete; only legacy BIB rows need recovery. */
export function requiresLegacyIdentityLookup(
  participantUuid: string | null | undefined,
): boolean {
  return !String(participantUuid ?? "").trim();
}

/**
 * Resolves membership and selection as one operation. Prefer the row that
 * followed the removed athlete, then the previous final row when removing the
 * tail. A non-selected removal preserves the current participant identity.
 */
export function selectionAfterTrackedAthleteRemoval(
  trackedKeys: string[],
  selectedKey: string | null,
  removedKey: string,
): TrackingSelectionAfterRemoval {
  const removedIndex = trackedKeys.indexOf(removedKey);
  const remainingKeys = trackedKeys.filter((key) => key !== removedKey);
  if (remainingKeys.length === 0) {
    return { remainingKeys, nextSelectedKey: null, nextSelectedIndex: -1 };
  }
  if (selectedKey && selectedKey !== removedKey) {
    const preservedIndex = remainingKeys.indexOf(selectedKey);
    if (preservedIndex >= 0) {
      return {
        remainingKeys,
        nextSelectedKey: selectedKey,
        nextSelectedIndex: preservedIndex,
      };
    }
  }
  const nextSelectedIndex = Math.min(
    Math.max(removedIndex, 0),
    remainingKeys.length - 1,
  );
  return {
    remainingKeys,
    nextSelectedKey: remainingKeys[nextSelectedIndex] ?? null,
    nextSelectedIndex,
  };
}
