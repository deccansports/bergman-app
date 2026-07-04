// src/lib/actions/razorpayZohoSyncActions.ts
'use server';

import { syncRazorpayToZoho, getSyncHistory, getZohoDashboardMetrics, getSyncLogs } from '@/lib/services/razorpayZohoSync';
import type { SyncResult } from '@/lib/services/razorpayZohoSync';

/**
 * Trigger a full Razorpay → Zoho settlement sync.
 * Optionally pass a date range (unix timestamps) to limit scope.
 */
export async function triggerRazorpayZohoSyncAction(options?: {
  count?: number;
  syncAll?: boolean;
  fromDate?: string;   // ISO date string e.g. "2026-03-01"
  toDate?: string;     // ISO date string e.g. "2026-03-31"
}): Promise<SyncResult> {
  const from = options?.fromDate
    ? Math.floor(new Date(options.fromDate).getTime() / 1000)
    : undefined;
  const to = options?.toDate
    ? Math.floor(new Date(options.toDate + 'T23:59:59').getTime() / 1000)
    : undefined;

  return syncRazorpayToZoho({
    count: options?.count ?? 50,
    from,
    to,
    syncAll: options?.syncAll === true,
  });
}

/**
 * Retrieve the history of settlements already synced to Zoho.
 */
export async function getRazorpayZohoSyncHistoryAction(limit = 50): Promise<{
  success: boolean;
  history?: Array<{
    settlementId: string;
    amount: number;
    date: string;
    zohoTransferId: string;
    syncedAt: string;
  }>;
  message?: string;
}> {
  try {
    const history = await getSyncHistory(limit);
    return { success: true, history };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getRazorpayZohoDashboardAction(logsLimit = 25): Promise<{
  success: boolean;
  data?: Awaited<ReturnType<typeof getZohoDashboardMetrics>>;
  message?: string;
}> {
  try {
    const data = await getZohoDashboardMetrics(logsLimit);
    return { success: true, data };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getRazorpayZohoSyncLogsAction(limit = 100): Promise<{
  success: boolean;
  logs?: Awaited<ReturnType<typeof getSyncLogs>>;
  message?: string;
}> {
  try {
    const logs = await getSyncLogs(limit);
    return { success: true, logs };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
