import type { CourseGeometry } from "@/core/types";

export type ImmutableCourseIdentityInput = {
  eventId: string;
  providerEventUuid?: string;
  contestId?: string;
  contestName?: string;
  courseVersion?: unknown;
  geometry?: CourseGeometry | null;
  timingDisplayConfig?: unknown;
};

/** Excludes all athlete/live/canonical-state values by construction. */
export function immutableCourseIdentity(
  input: ImmutableCourseIdentityInput,
): string {
  return JSON.stringify({
    eventId: input.eventId,
    providerEventUuid: input.providerEventUuid ?? "event-wide",
    contestId: input.contestId ?? "unmapped-contest",
    contestName: input.contestName ?? "unnamed-contest",
    courseVersion: input.courseVersion ?? null,
    geometry: (input.geometry?.legs ?? []).map((leg) => ({
      segment: leg.segment,
      gpxUrl: leg.gpxUrl,
      pointCount: leg.path.length,
      first: leg.path[0],
      last: leg.path.at(-1),
    })),
    timingDisplayConfig: input.timingDisplayConfig ?? {},
  });
}
