export type CourseKind =
  "swim" | "bike" | "run" | "duathlon" | "triathlon" | "unknown";

export type ConfiguredCourseSection = {
  type?: unknown;
  legType?: unknown;
  id?: unknown;
  title?: unknown;
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

export function resolveCourseKind(...values: unknown[]): CourseKind {
  const sources = values.map(normalized).filter(Boolean);
  for (const source of sources) {
    if (/\bduathlon\b/.test(source)) return "duathlon";
    if (/\btriathlon\b/.test(source)) return "triathlon";
    if (/\b(swimathon|swimming)\b/.test(source)) return "swim";
    if (/\b(marathon|half marathon|ultra marathon|running)\b/.test(source))
      return "run";
    if (/\b(cycling|cycling race|bike race)\b/.test(source)) return "bike";
  }
  const source = sources.join(" ");
  if (/\bduathlon\b/.test(source)) return "duathlon";
  if (/\btriathlon\b/.test(source)) return "triathlon";
  if (
    /\b(swimathon|swimming|swim)\b/.test(source) &&
    !/\b(bike|cycle|run)\b/.test(source)
  ) {
    return "swim";
  }
  if (
    /\b(cycling|cycling race|bike race|bike)\b/.test(source) &&
    !/\b(swim|run)\b/.test(source)
  ) {
    return "bike";
  }
  if (
    /\b(marathon|half marathon|ultra marathon|running|run)\b/.test(source) &&
    !/\b(swim|bike|cycle)\b/.test(source)
  ) {
    return "run";
  }
  // Missing metadata is not evidence of a triathlon. Callers render a neutral
  // race flow until the mapped ticket or canonical contest is available.
  return "unknown";
}

/**
 * Resolve the race format from canonical configured legs before consulting
 * display names. Generic category names such as "Test 1" do not identify a
 * triathlon, while Swim/Bike/Run canonical sections do.
 */
export function resolveCourseKindFromSections(
  sections: ConfiguredCourseSection[] | null | undefined,
  ...fallbackValues: unknown[]
): CourseKind {
  const configuredLegs = (sections ?? [])
    .filter((section) => normalized(section?.type) === "leg")
    .map((section) =>
      normalized(
        `${section?.legType ?? ""} ${section?.id ?? ""} ${section?.title ?? ""}`,
      ),
    )
    .filter(Boolean);
  const hasSwim = configuredLegs.some((leg) => /\bswim\b/.test(leg));
  const hasBike = configuredLegs.some((leg) =>
    /\b(?:bike|cycle|cycling)\b/.test(leg),
  );
  const runLegCount = configuredLegs.filter((leg) =>
    /\brun\d*\b|\brunning\b/.test(leg),
  ).length;

  if (hasSwim && hasBike && runLegCount > 0) return "triathlon";
  if (!hasSwim && hasBike && runLegCount >= 2) return "duathlon";

  return resolveCourseKind(...fallbackValues, configuredLegs.join(" "));
}

export function courseStageLabels(kind: CourseKind): string[] {
  if (kind === "swim") return ["SWIM", "FINISH"];
  if (kind === "bike") return ["BIKE", "FINISH"];
  if (kind === "run") return ["RUN", "FINISH"];
  if (kind === "duathlon") return ["RUN1", "BIKE", "RUN2", "FINISH"];
  if (kind === "triathlon")
    return ["SWIM", "T1", "BIKE", "T2", "RUN", "FINISH"];
  return ["RACE", "FINISH"];
}
