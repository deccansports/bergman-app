import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ComponentProps } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { queryClient } from "@/core/services/query/queryClient";
import { invalidateActiveLiveTimingQueries } from "@/core/services/query/queryInvalidation";
import {
  recordReactQueryDiagnostic,
  startJsEventLoopStallMonitor,
} from "@/core/services/performance/iosLiveDiagnostics";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";

type QueryProviderProps = {
  children: ComponentProps<typeof QueryClientProvider>["children"];
};

/**
 * Provides the shared React Query client and bridges React Native AppState to
 * React Query's focus manager, so background apps pause polling/refetching
 * (refetchIntervalInBackground is off by default).
 */
export function QueryProvider({ children }: QueryProviderProps) {
  useEffect(() => {
    let previousState = AppState.currentState;
    const sub = AppState.addEventListener(
      "change",
      (status: AppStateStatus) => {
        focusManager.setFocused(status === "active");
        const resumed = status === "active" && previousState !== "active";
        previousState = status;
        if (resumed) void invalidateActiveLiveTimingQueries(queryClient);
      },
    );
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isLiveDiagnosticsEnabled) return;
    const observedState = new Map<string, string>();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const query = event.query;
      if (!query) return;
      const fingerprint = [
        query.state.status,
        query.state.fetchStatus,
        query.state.isInvalidated ? "invalidated" : "current",
        query.state.dataUpdatedAt,
      ].join(":");
      if (observedState.get(query.queryHash) === fingerprint) return;
      observedState.set(query.queryHash, fingerprint);
      recordReactQueryDiagnostic({
        type: event.type,
        queryHash: query.queryHash,
        queryKey: query.queryKey,
        fetchStatus: query.state.fetchStatus,
        status: query.state.status,
        invalidated: query.state.isInvalidated,
      });
    });
    const stopStallMonitor = startJsEventLoopStallMonitor();
    return () => {
      unsubscribe();
      stopStallMonitor();
      observedState.clear();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
