export function isAcceptedStageFinishBoundary(
  stage: string,
  splitIdentity: string,
): boolean {
  const label = stage.trim().toUpperCase();
  const identity = splitIdentity.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (label === "T1") return identity.includes("BIKESTART");
  if (label === "T2") return identity.includes("RUNSTART");
  return identity.includes("FINISH") || identity.includes("END");
}
