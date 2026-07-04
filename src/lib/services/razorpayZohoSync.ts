// src/lib/services/razorpayZohoSync.ts
// Syncs Razorpay processed settlements → Zoho Books bank transfers.
// Uses:
//   - Existing getZohoAccessToken from src/lib/zoho/token.ts
//   - Firestore to persist synced settlement IDs (survives restarts / deploys)

import axios from "axios";
import { zohoFetch } from "@/lib/zoho/fetch";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";

const SYNCED_COLLECTION = "razorpay_settlements_synced";
const LEGACY_SYNCED_COLLECTION = "razorpay_settlement_sync";
const SYNC_LOGS_COLLECTION = "razorpay_sync_logs";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RazorpaySettlement {
  id: string;
  entity: string;
  amount: number;          // paise
  status: string;
  fees: number;
  tax: number;
  created_at: number;      // unix seconds
  utm_source?: string;
}

export interface SyncResult {
  success: boolean;
  message: string;
  synced: number;
  merged: number;
  skipped: number;
  failed: number;
  errors: Array<{ settlementId: string; error: string }>;
  transfers: Array<{ settlementId: string; amount: number; date: string; zohoTransferId?: string }>;
}

export interface ZohoDashboardMetrics {
  totalSettlements: number;
  totalRevenue: number;
  totalFees: number;
  totalTax: number;
  net: number;
  matched: number;
  mismatched: number;
  unreconciled: number;
  recentErrors: Array<{
    settlementId: string;
    error: string;
    phase: string;
    time: string;
  }>;
}

// ─── Razorpay API ───────────────────────────────────────────────────────────

async function fetchRazorpaySettlements(count = 50, from?: number, to?: number, skip = 0): Promise<RazorpaySettlement[]> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not configured");
  }

  const params: Record<string, any> = { count };
  if (from) params.from = from;
  if (to) params.to = to;
  if (skip > 0) params.skip = skip;

  const res = await axios.get("https://api.razorpay.com/v1/settlements", {
    params,
    auth: { username: keyId, password: keySecret },
    timeout: 15000,
  });

  return res.data?.items ?? [];
}

// ─── Zoho Books bank transfer ────────────────────────────────────────────────

async function createZohoBankTransfer({
  settlementId,
  amount,
  date,
}: {
  settlementId: string;
  amount: number;       // rupees (settlement amount from Razorpay)
  date: string;         // YYYY-MM-DD
}): Promise<{ transferId: string; transferredAmount: number }> {
  const clearingAccountId = process.env.ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID;
  const bankAccountId = process.env.ZOHO_BANK_ACCOUNT_ID;

  if (!clearingAccountId || !bankAccountId) {
    throw new Error("Missing Zoho config: ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID and ZOHO_BANK_ACCOUNT_ID are required");
  }

  const isDeposit = amount > 0;
  const transactionTypeCandidates = isDeposit
    ? ["deposit", "transfer_fund"]
    : ["withdrawal", "transfer_fund"];

  let res: any = null;
  let lastErr: any = null;

  for (const transactionType of transactionTypeCandidates) {
    const payload = {
      date,
      amount: Math.abs(amount),
      transaction_type: transactionType,
      description: `Razorpay Settlement ${settlementId}`,
      from_account_id: isDeposit ? clearingAccountId : bankAccountId,
      to_account_id: isDeposit ? bankAccountId : clearingAccountId,
      reference_number: settlementId,
    };

    try {
      res = await zohoFetch("/banktransactions", {
        method: "POST",
        body: payload,
      });
      break;
    } catch (err: any) {
      lastErr = err;
      const errMsg = String(err?.message || "").toLowerCase();
      const isTxnTypeError = errMsg.includes("transaction type") || errMsg.includes("zoho error 4");
      if (!isTxnTypeError) throw err;
      console.warn(`[RazorpayZohoSync] banktransactions rejected transaction_type=${transactionType}, trying fallback...`);
    }
  }

  if (!res) {
    throw lastErr || new Error("Failed to create Zoho bank transaction");
  }

  const txn = res?.banktransaction || res?.transaction;
  const transferId = txn?.transaction_id || txn?.banktransaction_id || txn?.id;
  if (!transferId) {
    throw new Error(`Zoho response missing transaction id: ${JSON.stringify(res)}`);
  }

  const transferredAmount = Number(txn?.amount ?? Math.abs(amount));
  return { transferId, transferredAmount };
}

async function findZohoBankTransactionByReference(
  referenceNumber: string
): Promise<{ transferId: string; amount: number } | null> {
  if (!referenceNumber) return null;

  try {
    const res = await zohoFetch('/banktransactions', {
      params: { reference_number: referenceNumber },
    });

    const rows =
      res?.banktransactions ||
      res?.bank_transactions ||
      res?.transactions ||
      [];

    if (!Array.isArray(rows) || rows.length === 0) return null;

    const normalizedRef = String(referenceNumber).trim().toUpperCase();
    const exact = rows.find((r: any) => String(r?.reference_number || '').trim().toUpperCase() === normalizedRef) || rows[0];

    const transferId = String(
      exact?.transaction_id || exact?.banktransaction_id || exact?.id || ''
    );
    if (!transferId) return null;

    if (rows.length > 1) {
      console.warn(`[RazorpayZohoSync] Duplicate Zoho banktransactions found for ${referenceNumber}. Using ${transferId}`);
    }

    return {
      transferId,
      amount: Number(exact?.amount ?? 0),
    };
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('Invalid URL Passed')) {
      return null;
    }
    console.warn(`[RazorpayZohoSync] Existing transfer lookup failed for ${referenceNumber}: ${msg}`);
    return null;
  }
}

async function createZohoExpenseForCharges({
  settlementId,
  fees,
  tax,
  date,
}: {
  settlementId: string;
  fees: number; // rupees
  tax: number;  // rupees
  date: string; // YYYY-MM-DD
}): Promise<{ expenseId?: string; skipped: boolean; amount: number }> {
  const totalCharges = Math.max((fees ?? 0) + (tax ?? 0), 0);
  if (totalCharges <= 0) {
    return { skipped: true, amount: 0 };
  }

  const clearingAccountId = process.env.ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID;
  const expenseAccountId = process.env.ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID;
  const taxId = process.env.ZOHO_GST_INTRASTATE_ID || process.env.ZOHO_GST_INTERSTATE_ID;

  if (!clearingAccountId || !expenseAccountId) {
    throw new Error(
      "Missing Zoho config: ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID or ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID"
    );
  }

  const payload: Record<string, any> = {
    account_id: expenseAccountId,
    paid_through_account_id: clearingAccountId,
    date,
    amount: totalCharges,
    is_inclusive_tax: true,
    reference_number: `${settlementId}-fees`,
    description: `Razorpay charges for settlement ${settlementId} (fees + GST)`,
  };

  if (taxId) payload.tax_id = taxId;

  const res = await zohoFetch("/expenses", { method: "POST", body: payload });
  const expenseId = res?.expense?.expense_id;

  return { expenseId, skipped: false, amount: totalCharges };
}

// ─── Firestore dedup helpers ─────────────────────────────────────────────────

async function isSettlementSynced(settlementId: string): Promise<boolean> {
  const db = getFirestoreInstance();
  const [currentDoc, legacyDoc] = await Promise.all([
    db.collection(SYNCED_COLLECTION).doc(settlementId).get(),
    db.collection(LEGACY_SYNCED_COLLECTION).doc(settlementId).get(),
  ]);
  return currentDoc.exists || legacyDoc.exists;
}

async function markSettlementSynced(
  settlementId: string,
  metadata: {
    amount: number;
    date: string;
    fees: number;
    tax: number;
    bankExpected: number;
    status: "matched" | "mismatch" | "reconciled";
    zohoTransferId: string;
    zohoExpenseId?: string;
  }
): Promise<void> {
  const db = getFirestoreInstance();
  const nowIso = new Date().toISOString();
  await db.collection(SYNCED_COLLECTION).doc(settlementId).set({
    settlement_id: settlementId,
    zoho_transfer_id: metadata.zohoTransferId,
    zoho_expense_id: metadata.zohoExpenseId ?? null,
    synced_at: nowIso,
    amount: metadata.amount,
    fees: metadata.fees,
    tax: metadata.tax,
    bank_expected: metadata.bankExpected,
    status: metadata.status,

    // keep existing fields for backward compatibility with current UI/history rendering
    settlementId,
    date: metadata.date,
    zohoTransferId: metadata.zohoTransferId,
    zohoExpenseId: metadata.zohoExpenseId ?? null,
    syncedAt: nowIso,
  });
}

async function logSyncError(
  settlementId: string,
  error: string,
  phase: "expense" | "transfer" | "sync"
): Promise<void> {
  try {
    const db = getFirestoreInstance();
    await db.collection(SYNC_LOGS_COLLECTION).add({
      settlement_id: settlementId,
      error,
      phase,
      time: new Date().toISOString(),
    });
  } catch (logErr: any) {
    console.error(`[RazorpayZohoSync] Failed to write sync log for ${settlementId}: ${logErr.message}`);
  }
}

// ─── Main sync function ──────────────────────────────────────────────────────

export async function syncRazorpayToZoho(options?: {
  count?: number;
  from?: number;     // unix timestamp — filter settlements after this date
  to?: number;       // unix timestamp — filter settlements before this date
  syncAll?: boolean; // paginate through ALL historical settlements in batches of 100
  mergeOnly?: boolean; // clean/merge mode: map existing Zoho transactions by reference, do not create new transfers
}): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    message: "",
    synced: 0,
    merged: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    transfers: [],
  };

  const isAllMode = options?.syncAll === true;
  const isMergeOnly = options?.mergeOnly === true;
  console.log(`[RazorpayZohoSync] Starting sync... ${isAllMode ? "(ALL mode — paginating)" : ""}${isMergeOnly ? " (MERGE-ONLY mode)" : ""}`);

  let settlements: RazorpaySettlement[] = [];

  if (isAllMode) {
    // Paginate through ALL settlements — Razorpay max per call is 100, use skip offset
    const BATCH_SIZE = 100;
    let skip = 0;

    while (true) {
      let batch: RazorpaySettlement[];
      try {
        batch = await fetchRazorpaySettlements(BATCH_SIZE, options?.from, options?.to, skip);
        console.log(`[RazorpayZohoSync] Batch @ skip=${skip}: ${batch.length} settlements`);
      } catch (err: any) {
        return {
          ...result,
          success: false,
          message: `Failed to fetch settlements at offset ${skip}: ${err.message}`,
        };
      }

      if (batch.length === 0) break;
      settlements = settlements.concat(batch);
      skip += BATCH_SIZE;
      if (batch.length < BATCH_SIZE) break; // reached last page
    }

    console.log(`[RazorpayZohoSync] All mode: ${settlements.length} total settlements fetched`);
  } else {
    try {
      settlements = await fetchRazorpaySettlements(
        options?.count ?? 50,
        options?.from,
        options?.to
      );
      console.log(`[RazorpayZohoSync] Fetched ${settlements.length} settlements from Razorpay`);
    } catch (err: any) {
      return {
        ...result,
        success: false,
        message: `Failed to fetch settlements: ${err.message}`,
      };
    }
  }

  for (const settlement of settlements) {
    // Only sync "processed" settlements — these have actually been paid out
    if (settlement.status !== "processed") {
      console.log(`[RazorpayZohoSync] Skipping ${settlement.id} (status: ${settlement.status})`);
      result.skipped++;
      continue;
    }

    // Check Firestore dedup
    try {
      const alreadySynced = await isSettlementSynced(settlement.id);
      if (alreadySynced) {
        console.log(`[RazorpayZohoSync] Already synced: ${settlement.id}`);
        result.skipped++;
        continue;
      }
    } catch (err: any) {
      console.warn(`[RazorpayZohoSync] Dedup check failed for ${settlement.id}: ${err.message}`);
    }

    const settlementAmountRupees = settlement.amount / 100;
    const feesRupees = (settlement.fees ?? 0) / 100;
    const taxRupees = (settlement.tax ?? 0) / 100;
    const date = new Date(settlement.created_at * 1000).toISOString().split("T")[0];

    console.log(
      `[RazorpayZohoSync] Processing ${settlement.id} on ${date} | settlement ₹${settlementAmountRupees}, fees ₹${feesRupees}, tax ₹${taxRupees}`
    );

    try {
      const existingTransfer = await findZohoBankTransactionByReference(settlement.id);
      if (existingTransfer?.transferId) {
        const reconciliationStatus = Math.abs(existingTransfer.amount - settlementAmountRupees) < 0.01
          ? "matched"
          : "mismatch";

        await markSettlementSynced(settlement.id, {
          amount: settlementAmountRupees,
          date,
          fees: feesRupees,
          tax: taxRupees,
          bankExpected: settlementAmountRupees,
          status: reconciliationStatus,
          zohoTransferId: existingTransfer.transferId,
        });

        result.merged++;
        result.transfers.push({
          settlementId: settlement.id,
          amount: settlementAmountRupees,
          date,
          zohoTransferId: existingTransfer.transferId,
        });

        console.log(`[RazorpayZohoSync] ♻️ Merged existing Zoho transfer: ${settlement.id} → zoho:${existingTransfer.transferId}`);
        continue;
      }

      if (isMergeOnly) {
        console.log(`[RazorpayZohoSync] Merge-only mode: no existing Zoho transfer found for ${settlement.id}, skipping create.`);
        result.skipped++;
        continue;
      }

      const expense = await createZohoExpenseForCharges({
        settlementId: settlement.id,
        fees: feesRupees,
        tax: taxRupees,
        date,
      });

      if (expense.skipped) {
        console.log(`[RazorpayZohoSync] Expense skipped (no fees/tax): ${settlement.id}`);
      } else {
        console.log(
          `[RazorpayZohoSync] ✅ Expense created: ${settlement.id} ₹${expense.amount}${expense.expenseId ? ` → zoho:${expense.expenseId}` : ""}`
        );
      }

      const { transferId, transferredAmount } = await createZohoBankTransfer({
        settlementId: settlement.id,
        amount: settlementAmountRupees,
        date,
      });

      const reconciliationStatus = Math.abs(transferredAmount - settlementAmountRupees) < 0.01
        ? "matched"
        : "mismatch";

      await markSettlementSynced(settlement.id, {
        amount: settlementAmountRupees,
        date,
        fees: feesRupees,
        tax: taxRupees,
        bankExpected: settlementAmountRupees,
        status: reconciliationStatus,
        zohoTransferId: transferId,
        zohoExpenseId: expense.expenseId,
      });

      result.synced++;
      result.transfers.push({
        settlementId: settlement.id,
        amount: settlementAmountRupees,
        date,
        zohoTransferId: transferId,
      });

      console.log(`[RazorpayZohoSync] ✅ Transfer created: ${settlement.id} → zoho:${transferId}`);
    } catch (err: any) {
      const errMsg = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
      console.error(`[RazorpayZohoSync] ❌ Failed: ${settlement.id} — ${errMsg}`);
      await logSyncError(settlement.id, errMsg, "sync");
      result.failed++;
      result.errors.push({ settlementId: settlement.id, error: errMsg });
    }
  }

  result.success = result.failed === 0;
  result.message = `Synced ${result.synced}, merged ${result.merged}, skipped ${result.skipped}, failed ${result.failed}`;
  console.log(`[RazorpayZohoSync] Done. ${result.message}`);

  return result;
}

// ─── Status / history ────────────────────────────────────────────────────────

export async function getSyncHistory(limit = 50): Promise<Array<{
  settlementId: string;
  amount: number;
  date: string;
  zohoTransferId: string;
  syncedAt: string;
}>> {
  const db = getFirestoreInstance();
  const snap = await db
    .collection(SYNCED_COLLECTION)
    .orderBy("syncedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      settlementId: data.settlementId || data.settlement_id || d.id,
      amount: data.amount ?? 0,
      date: data.date ?? "",
      zohoTransferId: data.zohoTransferId || data.zoho_transfer_id || "",
      syncedAt: data.syncedAt || data.synced_at || "",
    };
  });
}

export async function getSyncLogs(limit = 100): Promise<Array<{
  settlementId: string;
  error: string;
  phase: string;
  time: string;
}>> {
  const db = getFirestoreInstance();
  const snap = await db
    .collection(SYNC_LOGS_COLLECTION)
    .orderBy("time", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      settlementId: data.settlement_id || "",
      error: data.error || "Unknown error",
      phase: data.phase || "sync",
      time: data.time || "",
    };
  });
}

export async function getZohoDashboardMetrics(limitLogs = 25): Promise<ZohoDashboardMetrics> {
  const db = getFirestoreInstance();
  const [syncedSnap, logs] = await Promise.all([
    db.collection(SYNCED_COLLECTION).get(),
    getSyncLogs(limitLogs),
  ]);

  let totalRevenue = 0;
  let totalFees = 0;
  let totalTax = 0;
  let matched = 0;
  let mismatched = 0;
  let unreconciled = 0;

  syncedSnap.docs.forEach((doc) => {
    const d = doc.data() as any;
    const amount = Number(d.amount ?? 0);
    const fees = Number(d.fees ?? 0);
    const tax = Number(d.tax ?? 0);
    const status = d.status as string | undefined;

    totalRevenue += amount;
    totalFees += fees;
    totalTax += tax;

    if (status === "matched" || status === "reconciled") matched++;
    else if (status === "mismatch") mismatched++;
    else unreconciled++;
  });

  return {
    totalSettlements: syncedSnap.size,
    totalRevenue,
    totalFees,
    totalTax,
    net: totalRevenue - totalFees - totalTax,
    matched,
    mismatched,
    unreconciled,
    recentErrors: logs,
  };
}
