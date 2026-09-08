import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/core/theme";
import {
  useCourseGeometry,
  useCourseMap,
  useParticipants,
} from "@/features/tracking/hooks";
import { useWatchlist } from "@/features/tracking/watchlist";
import { Button, Card, Icon, Skeleton, Text } from "@/shared/components";

import {
  buildCumulativePath,
  distanceToFraction,
  positionAtFraction,
} from "../../engine";
import { mapCourseMap } from "../mappers";
import { CourseMapView } from "./CourseMapView";
import { CombinedElevationProfile } from "./ElevationProfilePanel";
import type { TrackAthlete } from "./CourseTrackCanvas";
import { useEvent } from "@/features/events/hooks/useEvents";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";

// The course view consumes lightweight watchlist/participant summaries only.
// Full canonical detail belongs exclusively to the selected athlete owner in
// LiveTrackScreen.
const MAX_MAP_TRACKED_ATHLETES = 8;

type CourseOption = { id: string; name: string };

function courseText(value: unknown): string {
  return String(value ?? "").trim();
}

export function CourseMapScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
  const id = safeRouteEventId(eventId) ?? "";
  const { event } = useEvent(id);
  const participantRoster = useParticipants(id, Boolean(id));
  const roster = useMemo(
    () =>
      Array.isArray(participantRoster.data)
        ? (participantRoster.data as Record<string, unknown>[])
        : [],
    [participantRoster.data],
  );
  const { athletes: trackedAthletes } = useWatchlist(id, roster);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [elevationOpen, setElevationOpen] = useState(false);
  // Course selection belongs to this explicit detail view. Watchlist and live
  // timing objects never participate in the geometry query identity.
  const courseScopeAthlete = trackedAthletes[0] ?? roster[0];
  const providerEventUuid = courseText(
    courseScopeAthlete?.providerEventUuid ??
      courseText(courseScopeAthlete?.participantUuid).match(
        /^race:([^:]+):/i,
      )?.[1] ??
      (event?.raw?.liveTracking as Record<string, unknown> | undefined)
        ?.providerEventUuid ??
      event?.raw?.providerEventUuid,
  );
  const query = useCourseMap(
    id,
    Boolean(providerEventUuid),
    providerEventUuid || undefined,
  );
  const courseOptions = useMemo<CourseOption[]>(() => {
    const tickets = Array.isArray(query.data?.courseMap?.ticketDefinitions)
      ? query.data.courseMap.ticketDefinitions
      : [];
    return tickets
      .map((ticket, index) => ({
        id:
          courseText(
            ticket.id ?? ticket.ticketId ?? ticket.ticketDefinitionId,
          ) || `course-${index + 1}`,
        name:
          courseText(ticket.ticketName ?? ticket.name ?? ticket.label) ||
          `Course ${index + 1}`,
      }))
      .filter(
        (option, index, rows) =>
          rows.findIndex((candidate) => candidate.id === option.id) === index,
      );
  }, [query.data?.courseMap?.ticketDefinitions]);
  const primaryCourseId = courseText(
    query.data?.courseMap?.primaryTicketId ??
      (query.data?.courseMap?.courseMaps as Record<string, unknown> | undefined)
        ?.primaryTicketId,
  );
  const activeCourse =
    courseOptions.find((option) => option.id === selectedCourseId) ??
    courseOptions.find((option) => option.id === primaryCourseId) ??
    courseOptions[0];
  const explicitCourseSelection = activeCourse
    ? {
        ticketId: activeCourse.id,
        contestId: activeCourse.id,
        contestName: activeCourse.name,
      }
    : undefined;
  const geometry = useCourseGeometry(
    id,
    event?.raw,
    Boolean(providerEventUuid),
    {
      ...explicitCourseSelection,
      providerEventUuid: providerEventUuid || undefined,
    },
  );
  const courseMap = useMemo(
    () =>
      mapCourseMap(
        query.data?.courseIndex,
        geometry.data ?? undefined,
        activeCourse
          ? {
              id: activeCourse.id,
              name: activeCourse.name,
            }
          : undefined,
        query.data?.timingConfiguration,
      ),
    [
      geometry.data,
      query.data?.courseIndex,
      query.data?.timingConfiguration,
      activeCourse,
    ],
  );
  const courseVersion = useMemo(
    () =>
      JSON.stringify(
        (geometry.data?.legs ?? []).map((leg) => ({
          segment: leg.segment,
          gpxUrl: leg.gpxUrl,
        })),
      ),
    [geometry.data?.legs],
  );
  const elevationCacheKey = `${id}:event-wide:${activeCourse?.id ?? "base"}:${courseVersion}`;
  const trackedForEvent = useMemo(
    () => trackedAthletes.filter((a) => !a.eventId || a.eventId === id),
    [id, trackedAthletes],
  );
  const visibleTrackedAthletes = useMemo(
    () => trackedForEvent.slice(0, MAX_MAP_TRACKED_ATHLETES),
    [trackedForEvent],
  );
  const mapAthletes = useMemo<TrackAthlete[]>(() => {
    if (
      !courseMap?.hasGeometry ||
      !courseMap.bounds ||
      courseMap.mergedPath.length < 2
    )
      return [];
    const cumPath = buildCumulativePath(courseMap.mergedPath);
    return visibleTrackedAthletes
      .map((athlete) => {
        const row = athlete as Record<string, unknown>;
        const progressKm = Number(
          row.distanceKm ?? row.progressKm ?? row.currentDistanceKm,
        );
        const totalKm = Number(row.totalKm ?? cumPath.totalMeters / 1_000);
        const hasProgress = Number.isFinite(progressKm) && progressKm >= 0;
        const position = hasProgress
          ? positionAtFraction(cumPath, distanceToFraction(progressKm, totalKm))
          : cumPath.points[0];
        const safePosition = position ?? cumPath.points[0];
        if (!safePosition) return undefined;
        const marker: TrackAthlete = {
          position: safePosition,
          name: athlete.name,
          bib: athlete.bib,
        };
        if (athlete.photoUrl) marker.photoUrl = athlete.photoUrl;
        if (!hasProgress) marker.isPending = true;
        return marker;
      })
      .filter((athlete): athlete is TrackAthlete => Boolean(athlete));
  }, [courseMap, visibleTrackedAthletes]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.md,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            onPress={() => {
              if (!id) {
                router.replace("/events");
                return;
              }
              router.replace({
                pathname: "/event/[eventId]",
                params: { eventId: id },
              });
            }}
          >
            <Icon name="chevronLeft" />
          </Pressable>
          <Text variant="display">Course Map</Text>
        </View>

        {courseOptions.length > 1 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="textMuted">
              SELECT COURSE
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {courseOptions.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${option.name} course`}
                  accessibilityState={{
                    selected: activeCourse?.id === option.id,
                  }}
                  onPress={() => {
                    setSelectedCourseId(option.id);
                    setElevationOpen(false);
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor:
                      activeCourse?.id === option.id
                        ? theme.colors.accent
                        : theme.colors.border,
                    backgroundColor:
                      activeCourse?.id === option.id
                        ? `${theme.colors.accent}16`
                        : theme.colors.surfaceSunken,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text variant="bodySmall" style={{ fontWeight: "800" }}>
                    {option.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {query.isLoading || geometry.isLoading ? (
          <Skeleton height={260} radius={theme.radius.large} />
        ) : (
          <>
            <CourseMapView
              map={courseMap}
              athletes={mapAthletes}
              cutoffMinutes={event?.cutoffMinutes}
              cutoffs={event?.cutoffs}
              refreshError={query.isRefetchError || geometry.isRefetchError}
              // Live marker updates must not take the viewport away from the
              // full course. This screen is an event overview, not follow mode.
              followSelectedAthlete={false}
            />
            <Button
              label={elevationOpen ? "Hide Elevation" : "Elevation"}
              size="sm"
              variant={elevationOpen ? "primary" : "secondary"}
              accessibilityLabel={
                elevationOpen
                  ? "Hide course elevation"
                  : "Load course elevation"
              }
              onPress={() => setElevationOpen((current) => !current)}
            />
            {elevationOpen ? (
              <Card>
                <CombinedElevationProfile
                  geometry={geometry.data}
                  cacheKey={elevationCacheKey}
                  loading={geometry.isLoading}
                  error={geometry.isError}
                />
              </Card>
            ) : null}
            {trackedForEvent.length > visibleTrackedAthletes.length ? (
              <Text variant="bodySmall" color="textMuted">
                Showing {visibleTrackedAthletes.length} of{" "}
                {trackedForEvent.length} tracked athletes on the map. Your full
                watchlist remains available in Track Athletes.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
