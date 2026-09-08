import { useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/core/theme";
import { useEvents } from "@/features/events/hooks/useEvents";
import { useAthleteSearch } from "@/features/tracking/hooks";
import {
  Avatar,
  Card,
  EmptyState,
  Icon,
  ListItem,
  SearchBar,
  Skeleton,
  Text,
} from "@/shared/components";
import { useDebouncedValue, useResponsive } from "@/shared/hooks";
import { recordLivePerformance } from "../../livePerformanceDiagnostics";

import { useWatchlist } from "../hooks/useWatchlist";

type WatchlistDisplayAthlete = {
  id: string;
  bib: string;
  name: string;
  eventId?: string;
  category?: string;
  club?: string;
  participantUuid?: string;
  providerEventUuid?: string;
  providerUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  athleteUid?: string;
  bookingId?: string;
};

const WatchlistAthleteRow = memo(function WatchlistAthleteRow({
  athlete,
  onPress,
}: {
  athlete: WatchlistDisplayAthlete;
  onPress: (athlete: WatchlistDisplayAthlete) => void;
}) {
  recordLivePerformance("cardRenders");
  return (
    <Card padded={false} style={{ overflow: "hidden" }}>
      <ListItem
        title={athlete.name}
        subtitle={`Bib ${athlete.bib}${athlete.club ? ` · ${athlete.club}` : ""}${athlete.category ? ` · ${athlete.category}` : ""}`}
        trailing={<Icon name="heartFilled" color="accent" />}
        onPress={() => onPress(athlete)}
      />
    </Card>
  );
});

export function WatchlistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { events } = useEvents();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 200);
  const searchEvent = useMemo(
    () =>
      events.find((e) => e.status === "live") ??
      events.find((e) => e.status !== "finished"),
    [events],
  );
  // Account watchlist rows are already lightweight, cached summaries. Do not
  // download the event-wide canonical/legacy participant roster just to draw
  // these cards; full athlete timing belongs to the explicitly opened detail.
  const { ids, athletes, hydrated, addAthlete, isWatched } = useWatchlist(
    searchEvent?.id,
  );
  const athleteSearch = useAthleteSearch(
    searchEvent?.id ?? "",
    debounced,
    "name",
    Boolean(searchEvent),
    "live",
  );

  const openAthlete = useCallback(
    (athlete: WatchlistDisplayAthlete) =>
      router.push({
        pathname: "/athletes/[bib]",
        params: {
          bib: athlete.bib,
          eventId: athlete.eventId ?? searchEvent?.id ?? "",
          participantUuid: athlete.participantUuid,
          providerEventUuid: athlete.providerEventUuid,
          providerUuid: athlete.providerUuid,
          providerTimingUuid: athlete.providerTimingUuid,
          providerRecordId: athlete.providerRecordId,
          athleteUid: athlete.athleteUid,
          bookingId: athlete.bookingId,
        },
      }),
    [router, searchEvent?.id],
  );
  const renderTrackedAthlete = useCallback(
    ({ item }: { item: WatchlistDisplayAthlete }) => (
      <WatchlistAthleteRow athlete={item} onPress={openAthlete} />
    ),
    [openAthlete],
  );
  const performanceStartedAtRef = useRef(Date.now());
  const renderCountRef = useRef(0);
  const reportedTrackedCountRef = useRef<number | null>(null);
  renderCountRef.current += 1;
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" ||
      !hydrated ||
      reportedTrackedCountRef.current === athletes.length
    ) {
      return;
    }
    reportedTrackedCountRef.current = athletes.length;
    console.info("[tracking-performance]", {
      action: "WATCHLIST_VISIBLE",
      elapsedMs: Date.now() - performanceStartedAtRef.current,
      trackedCount: athletes.length,
      screenRenderCount: renderCountRef.current,
      ownedEventRosterQueries: 0,
      ownedAthleteDetailQueries: 0,
      ownedSockets: 0,
      ownedMapMounts: 0,
    });
  }, [athletes.length, hydrated]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <FlatList
        data={athletes as WatchlistDisplayAthlete[]}
        keyExtractor={(athlete) =>
          athlete.participantUuid ||
          `${athlete.eventId ?? "event"}:${athlete.id}`
        }
        renderItem={renderTrackedAthlete}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== "web"}
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.md,
          maxWidth: isTablet ? theme.maxContentWidth : undefined,
          alignSelf: "center",
          width: "100%",
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ gap: 2, paddingBottom: theme.spacing.sm }}>
              <Text variant="display">Track Athletes</Text>
              <Text variant="body" color="textMuted">
                {ids.length} athlete{ids.length === 1 ? "" : "s"} followed
              </Text>
            </View>

            <Card style={{ gap: theme.spacing.md }}>
              <Text variant="label" color="textMuted">
                SEARCH ATHLETE
              </Text>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder="Name, bib, club, or country"
              />
              {debounced.trim().length > 0 ? (
                <View style={{ gap: theme.spacing.sm }}>
                  {athleteSearch.isFetching ? (
                    <View style={{ gap: theme.spacing.sm }}>
                      <Skeleton height={76} radius={theme.radius.large} />
                      <Text variant="bodySmall" color="textMuted">
                        Syncing live data...
                      </Text>
                    </View>
                  ) : (athleteSearch.data ?? []).length > 0 ? (
                    (athleteSearch.data ?? []).map((athlete) => (
                      <Card
                        key={athlete.id}
                        onPress={() => {
                          addAthlete({
                            id: athlete.id,
                            bib: athlete.bib,
                            name: athlete.name,
                            eventId: searchEvent?.id,
                            category: athlete.category,
                            club: athlete.club,
                            photoUrl: athlete.photoUrl,
                            participantUuid: athlete.participantUuid,
                            providerUuid: athlete.providerUuid,
                            providerTimingUuid: athlete.providerTimingUuid,
                            providerRecordId: athlete.providerRecordId,
                            athleteUid: athlete.athleteUid,
                            bookingId: athlete.bookingId,
                          });
                        }}
                        style={{
                          borderColor: isWatched(athlete.id)
                            ? theme.colors.accent
                            : theme.colors.border,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: theme.spacing.md,
                          }}
                        >
                          <Avatar
                            name={athlete.name}
                            uri={athlete.photoUrl}
                            colorSeed={athlete.id}
                          />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="headline" numberOfLines={1}>
                              {athlete.name}
                            </Text>
                            <Text
                              variant="bodySmall"
                              color="textMuted"
                              numberOfLines={2}
                            >
                              Bib {athlete.bib}
                              {athlete.club ? ` · ${athlete.club}` : ""}
                              {athlete.category ? ` · ${athlete.category}` : ""}
                            </Text>
                          </View>
                          <Text
                            variant="label"
                            color={
                              isWatched(athlete.id) ? "accent" : "textMuted"
                            }
                          >
                            {isWatched(athlete.id) ? "ADDED" : "ADD"}
                          </Text>
                        </View>
                      </Card>
                    ))
                  ) : (
                    <Text variant="bodySmall" color="textMuted">
                      No athletes found for “{debounced}”.
                    </Text>
                  )}
                </View>
              ) : (
                <Text variant="bodySmall" color="textMuted">
                  Search the current event start list; tap a result to add it to
                  Tracking.
                </Text>
              )}
            </Card>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Your watchlist is empty"
            description="Follow athletes from a live event to track their progress and get alerts."
            icon={<Icon name="heart" size={40} color="textMuted" />}
            actionLabel="Explore events"
            onAction={() => router.push("/events")}
          />
        }
      />
    </SafeAreaView>
  );
}
