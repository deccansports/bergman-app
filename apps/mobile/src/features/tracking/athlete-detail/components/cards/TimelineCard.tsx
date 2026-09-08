import { useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  UIManager,
  View,
} from "react-native";

import { useTheme } from "@/core/theme";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import { Badge, Card, Divider, ProgressBar, Text } from "@/shared/components";
import type { TimelineSplit, TimelineState } from "@/features/tracking/mappers";
import { resolveCourseKind } from "@/features/tracking/courseKind";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";

import { SectionCard } from "./primitives";
import {
  buildLiveSplitTableDiagnostic,
  selectProgressiveSplitTableRows,
} from "./progressiveSplitTable";

type LegKey = "swim" | "t1" | "bike" | "t2" | "run" | "other";

type LegSection = {
  key: LegKey;
  title: string;
  icon: string;
  tint: string;
  rows: TimelineSplit[];
};

const LEG_ORDER: LegKey[] = ["swim", "t1", "bike", "t2", "run", "other"];

const LEG_META: Record<LegKey, Omit<LegSection, "rows">> = {
  swim: { key: "swim", title: "Swim Leg", icon: "SW", tint: "#2E9AFE" },
  t1: { key: "t1", title: "T1 Transition", icon: "T1", tint: "#8B95A5" },
  bike: { key: "bike", title: "Bike Leg", icon: "BK", tint: "#22C55E" },
  t2: { key: "t2", title: "T2 Transition", icon: "T2", tint: "#8B95A5" },
  run: { key: "run", title: "Run Leg", icon: "RN", tint: "#F97316" },
  // Never expose the internal "timing point" abbreviation to athletes. This
  // neutral row is visible only while canonical sport metadata is resolving;
  // once the configured contest arrives it is replaced by SW/BK/RN.
  other: {
    key: "other",
    title: "Race Progress",
    icon: "RACE",
    tint: "#A3AAB7",
  },
};

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function dash(value: string | undefined): string {
  const candidate = String(value ?? "").trim();
  return candidate || "—";
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function splitLabel(split: TimelineSplit): string {
  return normalize(split.splitLabel || split.name);
}

function classifyLeg(split: TimelineSplit): LegKey {
  const label = splitLabel(split);
  const segment = normalize(split.segment);
  const haystack = `${label} ${segment}`;
  if (
    haystack.includes("T1") ||
    (haystack.includes("SWIM") && haystack.includes("BIKE START"))
  )
    return "t1";
  if (
    haystack.includes("T2") ||
    (haystack.includes("BIKE FINISH") && haystack.includes("RUN START"))
  )
    return "t2";
  if (haystack.includes("BIKE")) return "bike";
  if (haystack.includes("RUN")) return "run";
  if (haystack.includes("SWIM")) return "swim";
  return "other";
}

function stateCounts(rows: TimelineSplit[]) {
  const completed = rows.filter((row) => row.state === "completed").length;
  const current = rows.some((row) => row.state === "current");
  const progress =
    rows.length > 0
      ? Math.min(1, (completed + (current ? 0.5 : 0)) / rows.length)
      : 0;
  return { completed, current, progress };
}

function groupSections(
  splits: TimelineSplit[],
  raceCategory?: string,
  contest?: string,
  legLabel?: string,
): LegSection[] {
  const courseKind = resolveCourseKind(raceCategory, contest, legLabel);
  const activeLegKind = resolveCourseKind(legLabel);
  const firstConfiguredLeg: LegKey =
    activeLegKind === "swim" ||
    activeLegKind === "bike" ||
    activeLegKind === "run"
      ? activeLegKind
      : courseKind === "swim" || courseKind === "bike" || courseKind === "run"
        ? courseKind
        : courseKind === "triathlon"
          ? "swim"
          : courseKind === "duathlon"
            ? "run"
            : "other";
  const grouped = new Map<LegKey, TimelineSplit[]>();
  splits.forEach((split) => {
    const identity = normalize(
      `${split.segment} ${split.splitLabel ?? split.name}`,
    );
    if (
      identity.includes("TRANSITION") &&
      !identity.includes("T1") &&
      !identity.includes("T2")
    )
      return;
    const classified = classifyLeg(split);
    // A mapped single-discipline Bergman ticket is authoritative. Feibot can
    // retain stale TypeOfSport/leg labels after the ticket changes discipline.
    const configuredLeg =
      courseKind === "run" || courseKind === "bike" || courseKind === "swim"
        ? courseKind
        : classified;
    // Canonical pre-start rows may intentionally be labelled only START. The
    // row still belongs to the first configured sport leg; never expose the
    // neutral internal RACE bucket when contest configuration identifies that
    // leg authoritatively.
    const leg = configuredLeg === "other" ? firstConfiguredLeg : configuredLeg;
    grouped.set(leg, [...(grouped.get(leg) ?? []), split]);
  });
  return LEG_ORDER.map((key) => {
    const rows = grouped.get(key) ?? [];
    return {
      ...LEG_META[key],
      rows,
    };
  }).filter((section) => section.rows.length > 0);
}

function SplitStateBadge({
  state,
  expected,
}: {
  state: TimelineState;
  expected?: boolean;
}) {
  if (expected) return <Badge label="Expected" variant="upcoming" />;
  if (state === "current") return <Badge label="Current" variant="live" />;
  if (state === "completed") return <Badge label="Done" variant="finished" />;
  return <Badge label="Waiting" variant="neutral" />;
}

function SectionHeader({
  section,
  expanded,
  onToggle,
}: {
  section: LegSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  recordLivePerformance("splitTableRenders");
  const theme = useTheme();
  const { completed, current, progress } = stateCounts(section.rows);

  return (
    <Pressable accessibilityRole="button" onPress={onToggle}>
      <View
        style={[
          {
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            backgroundColor: "#10151D",
            borderRadius: theme.radius.large,
            borderWidth: 1,
            borderColor: current ? section.tint : "#26303B",
          },
          Platform.OS === "web"
            ? ({
                position: "sticky",
                top: 0,
                zIndex: 2,
              } as any)
            : null,
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${section.tint}22`,
              borderWidth: 1,
              borderColor: `${section.tint}88`,
            }}
          >
            <Text
              variant="label"
              style={{ color: section.tint, fontWeight: "900" }}
            >
              {section.icon}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              variant="headline"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {section.title}
            </Text>
            <Text variant="caption" style={{ color: "#9AA3AF" }}>
              {completed}/{section.rows.length} complete
            </Text>
          </View>
          {current ? <Badge label="Active" variant="live" /> : null}
          <Text variant="headline" style={{ color: "#9AA3AF" }}>
            {expanded ? "-" : "+"}
          </Text>
        </View>
        <ProgressBar
          progress={progress}
          height={5}
          accessibilityLabel={`${section.title} progress`}
        />
      </View>
    </Pressable>
  );
}

const TIMING_COLUMN_LABELS = [
  "TIME\nOF DAY",
  "SPLIT\nTIME",
  "PACE / SPEED",
  "RANK",
];

const WEB_TIMING_COLUMN_FLEX = [1.85, 1.1, 1.25, 1, 0.65] as const;

function TimingColumnsHeader() {
  return (
    <View
      style={{
        flexDirection: "row",
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: "#111821",
        borderWidth: 1,
        borderColor: "#26303B",
      }}
    >
      {TIMING_COLUMN_LABELS.map((label, index) => (
        <View
          key={label}
          style={{
            flex: 1,
            minWidth: 0,
            alignItems: "center",
            paddingHorizontal: 2,
            borderLeftWidth: index === 0 ? 0 : 1,
            borderLeftColor: "#26303B",
          }}
        >
          <Text
            variant="caption"
            style={{
              color: "#8F98A6",
              fontWeight: "900",
              fontSize: 9,
              lineHeight: 11,
              textAlign: "center",
            }}
            numberOfLines={2}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TimingValuesRow({ values, tint }: { values: string[]; tint: string }) {
  return (
    <View style={{ flexDirection: "row" }}>
      {values.map((value, index) => (
        <View
          key={`${index}:${value}`}
          style={{
            flex: 1,
            minWidth: 0,
            alignItems: "center",
            paddingHorizontal: 2,
            borderLeftWidth: index === 0 ? 0 : 1,
            borderLeftColor: "#26303B",
          }}
        >
          <Text
            variant="caption"
            style={{
              color:
                value === "—"
                  ? "#687280"
                  : index === values.length - 1
                    ? tint
                    : "#E7EAF0",
              fontWeight: "800",
              textAlign: "center",
            }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MobileSplitRow({
  split,
  section,
}: {
  split: TimelineSplit;
  section: LegSection;
}) {
  const theme = useTheme();
  const current = split.state === "current";
  const completed = split.state === "completed";

  return (
    <Card
      elevated={false}
      style={{
        gap: theme.spacing.sm,
        borderColor: current
          ? section.tint
          : completed
            ? `${section.tint}66`
            : "#2A323E",
        backgroundColor: current
          ? `${section.tint}16`
          : completed
            ? "#121820"
            : "#0D1117",
      }}
    >
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              variant="body"
              style={{
                color: current ? "#FFFFFF" : "#E7EAF0",
                fontWeight: "900",
              }}
            >
              {split.expected
                ? `Next: ${split.splitLabel || split.name}`
                : split.splitLabel || split.name}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {split.distanceLabel ? (
                <Badge
                  label={`${split.distanceLabel} total`}
                  variant="neutral"
                />
              ) : null}
              {split.cutoffLabel ? (
                <Badge
                  label={`Cutoff ${split.cutoffLabel}`}
                  variant="upcoming"
                />
              ) : null}
            </View>
          </View>
          <SplitStateBadge state={split.state} expected={split.expected} />
        </View>

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: "#26303B",
            paddingTop: theme.spacing.sm,
          }}
        >
          <TimingValuesRow
            tint={section.tint}
            values={[
              dash(split.timeOfDayLabel),
              dash(split.elapsedTimeLabel),
              dash(split.paceSpeedLabel),
              dash(split.positionLabel) === "—"
                ? "—"
                : `#${dash(split.positionLabel).replace(/^#/, "")}`,
            ]}
          />
        </View>
      </View>
    </Card>
  );
}

function WebLegTable({ section }: { section: LegSection }) {
  return (
    <Card
      padded={false}
      elevated={false}
      style={{
        overflow: "hidden",
        borderColor: "#26303B",
        backgroundColor: "#0B1016",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          backgroundColor: "#111821",
          borderBottomWidth: 1,
          borderBottomColor: "#26303B",
        }}
      >
        {[
          ["Checkpoint", WEB_TIMING_COLUMN_FLEX[0]],
          ["Time of Day", WEB_TIMING_COLUMN_FLEX[1]],
          ["Split Time", WEB_TIMING_COLUMN_FLEX[2]],
          ["Pace / Speed", WEB_TIMING_COLUMN_FLEX[3]],
          ["Rank", WEB_TIMING_COLUMN_FLEX[4]],
        ].map(([label, flex]) => {
          const headerLabel =
            label === "Time of Day"
              ? "TIME\nOF DAY"
              : String(label).toUpperCase();
          return (
            <View
              key={label}
              style={{
                flex: Number(flex),
                paddingVertical: 9,
                paddingHorizontal: 5,
                minWidth: 0,
              }}
            >
              <Text
                variant="caption"
                style={{ color: "#8F98A6", fontWeight: "900", lineHeight: 13 }}
                numberOfLines={2}
              >
                {headerLabel}
              </Text>
            </View>
          );
        })}
      </View>

      {section.rows.map((split, index) => {
        const current = split.state === "current";
        const values = [
          split.splitLabel || split.name,
          dash(split.timeOfDayLabel),
          dash(split.elapsedTimeLabel),
          dash(split.paceSpeedLabel),
          dash(split.positionLabel) === "—"
            ? "—"
            : `#${dash(split.positionLabel).replace(/^#/, "")}`,
        ];
        return (
          <View key={split.key}>
            {index > 0 ? <Divider /> : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: current ? `${section.tint}12` : "transparent",
              }}
            >
              {values.map((value, valueIndex) => {
                const flex = WEB_TIMING_COLUMN_FLEX[valueIndex];
                return (
                  <View
                    key={`${split.key}-${valueIndex}`}
                    style={{
                      flex,
                      paddingVertical: 11,
                      paddingHorizontal: 5,
                      minWidth: 0,
                    }}
                  >
                    {valueIndex === 0 ? (
                      <View style={{ gap: 5 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <View
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 4,
                              backgroundColor:
                                split.state === "upcoming"
                                  ? "#5F6876"
                                  : section.tint,
                            }}
                          />
                          <Text
                            variant="bodySmall"
                            style={{
                              color:
                                split.state === "upcoming"
                                  ? "#99A2AF"
                                  : "#FFFFFF",
                              fontWeight: "900",
                              flex: 1,
                            }}
                            numberOfLines={2}
                          >
                            {split.expected ? `Next: ${value}` : value}
                          </Text>
                        </View>
                        {split.distanceLabel || split.cutoffLabel ? (
                          <Text
                            variant="caption"
                            style={{ color: "#8F98A6", fontWeight: "700" }}
                            numberOfLines={2}
                          >
                            {[
                              split.distanceLabel
                                ? `${split.distanceLabel} total`
                                : "",
                              split.cutoffLabel
                                ? `Cutoff ${split.cutoffLabel}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        ) : null}
                        {current ? (
                          <SplitStateBadge
                            state={split.state}
                            expected={split.expected}
                          />
                        ) : null}
                      </View>
                    ) : (
                      <Text
                        variant="caption"
                        style={{
                          color: value === "—" ? "#697381" : "#E7EAF0",
                          fontWeight: "800",
                          fontVariant: ["tabular-nums"],
                          letterSpacing: 0,
                        }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}
                      >
                        {value}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function LegSectionCard({ section }: { section: LegSection }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((value) => !value);
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader section={section} expanded={expanded} onToggle={toggle} />
      {expanded ? (
        Platform.OS === "web" ? (
          <WebLegTable section={section} />
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <TimingColumnsHeader />
            {section.rows.map((split) => (
              <MobileSplitRow key={split.key} split={split} section={section} />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function ProvisionalNotice() {
  return (
    <Text
      variant="caption"
      style={{
        color: "#8F98A6",
        alignSelf: "center",
        maxWidth: 300,
        textAlign: "center",
        lineHeight: 17,
      }}
    >
      <Text variant="caption" style={{ color: "#C7CDD6", fontWeight: "900" }}>
        Provisional:
      </Text>{" "}
      Event times and places may be updated.
    </Text>
  );
}

/**
 * Premium leg-grouped race timing view. Its input is the mapper's progressive
 * timeline; a final presentation guard prevents configured future rows from
 * leaking into the visible table.
 */
export function TimelineCard({
  splits,
  contest,
  raceCategory,
  legLabel,
  notStarted = false,
  finished = false,
  participantUuid,
  canonicalVersion,
  status,
}: {
  splits: TimelineSplit[];
  contest?: string;
  raceCategory?: string;
  legLabel?: string;
  notStarted?: boolean;
  finished?: boolean;
  participantUuid?: string;
  canonicalVersion?: string;
  status?: string;
}) {
  const theme = useTheme();
  const visibleSplits = useMemo(
    () => selectProgressiveSplitTableRows(splits, { notStarted, finished }),
    [finished, notStarted, splits],
  );
  const sections = useMemo(
    () => groupSections(visibleSplits, raceCategory, contest, legLabel),
    [contest, legLabel, raceCategory, visibleSplits],
  );

  useEffect(() => {
    if (!isLiveDiagnosticsEnabled) return;
    console.debug(
      "LIVE_SPLIT_TABLE_RENDER",
      buildLiveSplitTableDiagnostic(visibleSplits, {
        participantUuid,
        canonicalVersion,
        status:
          status ||
          (finished ? "finished" : notStarted ? "notStarted" : "live"),
      }),
    );
  }, [
    canonicalVersion,
    finished,
    notStarted,
    participantUuid,
    status,
    visibleSplits,
  ]);

  if (sections.length === 0) {
    return (
      <SectionCard title="LIVE SPLIT FLOW">
        <Text variant="body" color="textMuted">
          The official split configuration for this contest has not been
          published yet.
        </Text>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="LIVE SPLIT FLOW">
      <View
        style={{
          marginHorizontal: -theme.spacing.base,
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.base,
          gap: theme.spacing.md,
          backgroundColor: "#070A0F",
          borderRadius: theme.radius.xl,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text
            variant="headline"
            style={{ color: "#FFFFFF", fontWeight: "900" }}
          >
            Live Split Flow
          </Text>
          <Text variant="bodySmall" style={{ color: "#8F98A6" }}>
            Follow each race leg with time of day, elapsed time, pace, and rank.
          </Text>
        </View>
        {sections.map((section) => (
          <LegSectionCard key={section.key} section={section} />
        ))}
        <ProvisionalNotice />
      </View>
    </SectionCard>
  );
}
