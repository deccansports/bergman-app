import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useTheme } from "@/core/theme";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import { Text } from "@/shared/components";
import type { StartTimingPresentation } from "@/features/tracking/timing/startTimingPresentation";

function parseStart(value?: string): number | null {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isNaN(parsed) ? null : parsed;
}

function durationLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  const clock = [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}D ${clock}` : clock;
}

export function RaceStartCountdown({
  scheduledStart,
  startTiming,
  participantUuid,
  contestUuid,
}: {
  scheduledStart?: string;
  startTiming?: StartTimingPresentation;
  participantUuid?: string;
  contestUuid?: string;
}) {
  const theme = useTheme();
  const startAt = useMemo(
    () =>
      (startTiming?.officialTimingMode === "WAVE"
        ? startTiming.officialStartAt
        : startTiming?.gunStartAt) ?? parseStart(scheduledStart),
    [
      scheduledStart,
      startTiming?.gunStartAt,
      startTiming?.officialStartAt,
      startTiming?.officialTimingMode,
    ],
  );
  const serverTimeOffsetMs = Number(startTiming?.serverTimeOffsetMs ?? 0);
  const [now, setNow] = useState(() => Date.now() + serverTimeOffsetMs);

  useEffect(() => {
    if (!isLiveDiagnosticsEnabled) return;
    const correctedNow =
      Date.now() + Number(startTiming?.serverTimeOffsetMs ?? 0);
    console.info("[PRESTART_CLOCK_SOURCE]", {
      participantUuid: participantUuid ?? null,
      canonicalContestUuid: contestUuid ?? null,
      scheduledStartAt: parseStart(scheduledStart),
      waveStartAt:
        startTiming?.officialTimingMode === "WAVE"
          ? (startTiming.officialStartAt ?? null)
          : null,
      gunStartAt: startTiming?.gunStartAt ?? null,
      chipStartAt: startTiming?.chipStartAt ?? null,
      serverNow: startTiming?.serverTimeOffsetMs == null ? null : correctedNow,
      correctedNow,
      countdownSeconds: startAt
        ? Math.max(0, Math.floor((startAt - correctedNow) / 1_000))
        : null,
      source:
        startTiming?.officialTimingMode === "WAVE" &&
        startTiming.officialStartAt
          ? "PARTICIPANT_WAVE_START"
          : startTiming?.gunStartAt
            ? "CONTEST_GUN_START"
            : startAt
              ? "EVENT_SCHEDULE"
              : "MISSING",
    });
  }, [
    contestUuid,
    participantUuid,
    scheduledStart,
    startAt,
    startTiming?.chipStartAt,
    startTiming?.gunStartAt,
    startTiming?.officialStartAt,
    startTiming?.officialTimingMode,
    startTiming?.serverTimeOffsetMs,
  ]);

  useEffect(() => {
    if (!startAt) return undefined;
    const timer = setInterval(
      () => setNow(Date.now() + serverTimeOffsetMs),
      1_000,
    );
    return () => clearInterval(timer);
  }, [serverTimeOffsetMs, startAt]);

  const remainingSeconds = startAt ? Math.floor((startAt - now) / 1_000) : null;
  const isFuture = remainingSeconds != null && remainingSeconds > 0;
  const officialTime = startAt
    ? new Date(startAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : undefined;

  // Canonical state can become WAITING_CHIP_START before race day. Until the
  // scheduled gun start, spectators need the countdown; only after that point
  // should the card switch to waiting for the athlete's START-mat passage.
  if (startTiming?.waitingForChipStart && !isFuture) {
    return (
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 11,
          gap: 5,
          borderRadius: theme.radius.medium,
          borderWidth: 1,
          borderColor: "rgba(46,116,214,0.44)",
          backgroundColor: "rgba(46,116,214,0.16)",
        }}
      >
        <Text
          variant="caption"
          style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 0.5 }}
        >
          WAITING FOR CHIP START
        </Text>
        <Text
          variant="headline"
          style={{ color: "#FFFFFF", fontWeight: "900" }}
        >
          START · Waiting for timing mat
        </Text>
        {startTiming.gunStartLabel ? (
          <Text
            variant="bodySmall"
            style={{ color: "#D2D2D2", fontWeight: "800" }}
          >
            Gun Start · {startTiming.gunStartLabel}
          </Text>
        ) : null}
        <Text variant="caption" style={{ color: "#D2D2D2" }}>
          {startTiming.helperText ??
            "Your race time starts when you cross START."}
        </Text>
      </View>
    );
  }

  if (!startAt) {
    return (
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 9,
          gap: 3,
          borderRadius: theme.radius.medium,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.14)",
          backgroundColor: "rgba(255,255,255,0.07)",
        }}
      >
        <Text
          variant="caption"
          style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 0.5 }}
        >
          TIME TO START
        </Text>
        <Text
          variant="headline"
          style={{ color: "#FFFFFF", fontWeight: "900" }}
        >
          Awaiting start time
        </Text>
        <Text variant="caption" style={{ color: "#D2D2D2" }}>
          Official race timing will appear here.
        </Text>
      </View>
    );
  }
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 9,
        gap: 3,
        borderRadius: theme.radius.medium,
        borderWidth: 1,
        borderColor: isFuture
          ? "rgba(46,116,214,0.44)"
          : "rgba(255,255,255,0.14)",
        backgroundColor: isFuture
          ? "rgba(46,116,214,0.16)"
          : "rgba(255,255,255,0.07)",
      }}
    >
      <Text
        variant="caption"
        style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 0.5 }}
      >
        {isFuture ? "STARTS IN" : "OFFICIAL START PASSED"}
      </Text>
      <Text variant="headline" style={{ color: "#FFFFFF", fontWeight: "900" }}>
        {durationLabel(Math.abs(remainingSeconds ?? 0))}
      </Text>
      <Text variant="caption" style={{ color: "#D2D2D2" }}>
        {isFuture
          ? `Official start ${officialTime ?? "time pending"}`
          : `${officialTime} · awaiting the athlete’s first timing read`}
      </Text>
    </View>
  );
}
