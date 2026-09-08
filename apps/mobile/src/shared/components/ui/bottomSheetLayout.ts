export function resolveBottomSheetWindowHeight(
  screenHeight: number,
  stableScreenHeight: number,
  freezeWindowShrink: boolean,
) {
  return freezeWindowShrink && screenHeight < stableScreenHeight
    ? stableScreenHeight
    : screenHeight;
}
