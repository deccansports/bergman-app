import { useEffect } from "react";
import { View } from "react-native";

import { useTheme } from "@/core/theme";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import { Text } from "@/shared/components";
import type {
  AthletePredictionStateView,
  NextSplitView,
  PredictedCheckpointView,
  ProjectedFinishView,
} from "@/features/tracking/mappers";

import { SectionCard, TileGrid } from "./primitives";

/**
 * Prediction card: the "Next Split Prediction (Robust)" checkpoint ETA and,
 * when available, the projected finish/rank. Renders formatted view-model data.
 */
export function PredictionCard({
  nextSplit,
  projected,
  checkpoints = [],
  predictionState,
  bib,
}: {
  nextSplit?: NextSplitView;
  projected?: ProjectedFinishView;
  checkpoints?: PredictedCheckpointView[];
  predictionState?: AthletePredictionStateView;
  bib?: string;
}) {
  const theme = useTheme();
  useEffect(() => {
    if (!isLiveDiagnosticsEnabled) return;
    console.debug("[prediction-runtime][PREDICTION_UI]", {
      bib,
      raceState: predictionState?.raceState,
      suppressed: predictionState?.suppressed,
      nextCheckpoint: predictionState?.nextCheckpoint?.checkpoint,
      checkpointCount: predictionState?.remainingCheckpoints.length,
    });
  }, [bib, predictionState]);
  if (
    predictionState?.suppressed ||
    predictionState?.raceState === "FINISHED"
  ) {
    return null;
  }
  if (!nextSplit && !projected && checkpoints.length === 0) return null;

  const nextItems = nextSplit
    ? [
        {
          key: "checkpoint",
          label: "Next Checkpoint",
          value: nextSplit.checkpoint,
        },
        nextSplit.estimatedTimeOfDay
          ? {
              key: "estimatedTimeOfDay",
              label: "EST. TIME OF DAY",
              value: nextSplit.estimatedTimeOfDay,
            }
          : null,
        nextSplit.estimatedRaceElapsed
          ? {
              key: "estimatedRaceElapsed",
              label: "EST. RACE ELAPSED",
              value: nextSplit.estimatedRaceElapsed,
            }
          : null,
        nextSplit.estimatedRemaining
          ? {
              key: "estimatedRemaining",
              label: "EST. REMAINING",
              value: nextSplit.estimatedRemaining,
            }
          : null,
        nextSplit.remaining
          ? { key: "remaining", label: "Remaining", value: nextSplit.remaining }
          : null,
      ].filter(
        (v): v is { key: string; label: string; value: string } => v !== null,
      )
    : [];

  const projectedItems = projected
    ? [
        projected.estimatedRaceElapsed
          ? {
              key: "estimatedRaceElapsed",
              label: "EST. RACE ELAPSED",
              value: projected.estimatedRaceElapsed,
            }
          : null,
        projected.estimatedTimeOfDay
          ? {
              key: "estimatedTimeOfDay",
              label: "EST. FINISH AT",
              value: projected.estimatedTimeOfDay,
            }
          : null,
        projected.position
          ? {
              key: "position",
              label: "Projected Rank",
              value: projected.position,
            }
          : null,
        projected.paceLabel
          ? { key: "pace", label: "Projected Pace", value: projected.paceLabel }
          : null,
        projected.confidenceLabel
          ? {
              key: "confidence",
              label: "Confidence",
              value: projected.confidenceLabel,
            }
          : null,
      ].filter(
        (v): v is { key: string; label: string; value: string } => v !== null,
      )
    : [];

  return (
    <SectionCard title="Prediction" titleColor="statusUpcoming">
      {nextItems.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            NEXT SPLIT
          </Text>
          <TileGrid items={nextItems} />
          {nextSplit?.pace ? (
            <Text variant="caption" color="textMuted">
              {`Model pace ${nextSplit.pace}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {projectedItems.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            PROJECTED FINISH
          </Text>
          <TileGrid items={projectedItems} />
        </View>
      ) : null}

      {checkpoints.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            ESTIMATED TIMES (PREDICTED)
          </Text>
          {checkpoints.map((checkpoint) => (
            <View
              key={`${checkpoint.checkpoint}-${checkpoint.estimatedRaceElapsed}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 9,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" style={{ fontWeight: "800" }}>
                  {checkpoint.checkpoint}
                </Text>
                <Text variant="caption" color="textMuted">
                  {checkpoint.remaining} from last official point
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text
                  variant="bodySmall"
                  color="statusUpcoming"
                  style={{ fontWeight: "900" }}
                >
                  {checkpoint.estimatedRaceElapsed}
                </Text>
                <Text variant="caption" color="textMuted">
                  EST. RACE ELAPSED
                </Text>
                <Text variant="bodySmall" color="statusUpcoming">
                  {checkpoint.estimatedTimeOfDay}
                </Text>
                <Text variant="caption" color="textMuted">
                  EST. TIME OF DAY
                </Text>
              </View>
            </View>
          ))}
          <Text variant="caption" color="textMuted">
            Estimated between official timing points. It updates after every
            official read.
          </Text>
        </View>
      ) : null}
    </SectionCard>
  );
}
