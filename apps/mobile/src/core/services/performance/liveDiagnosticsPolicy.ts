import { Platform } from "react-native";

import { isDevelopment } from "@/core/constants/env";

/** Web keeps its normal development diagnostics. Physical native devices only
 * enable the high-volume stream when an engineer explicitly requests it. */
export const isLiveDiagnosticsEnabled =
  isDevelopment &&
  (Platform.OS === "web" ||
    process.env.EXPO_PUBLIC_NATIVE_LIVE_DIAGNOSTICS === "true");
