// src/lib/services/zohoCleanup.ts
// Detect and clean up duplicate Zoho bank transactions from failed historical syncs

import { zohoFetch } from "@/lib/zoho/fetch";

export interface DuplicateEntry {
  reference_number: string;
  count: number;
  transactions: Array<{
    transaction_id: string;
    banktransaction_id: string;
    date: string;
    amount: number;
    description: string;
    status: string;
  }>;
}

export interface CleanupResult {
  duplicatesFound: number;
  cleaned: number;
  failed: number;
  errors: Array<{ reference: string; error: string }>;
  details: DuplicateEntry[];
}

export async function findDuplicateBankTransactions(): Promise<DuplicateEntry[]> {
  try {
    const res = await zohoFetch("/banktransactions", {
      params: { sort_column: "reference_number" },
    });

    const rows = res?.banktransactions || res?.bank_transactions || res?.transactions || [];
    if (!Array.isArray(rows)) return [];

    // Group by reference_number
    const grouped = new Map<string, any[]>();
    rows.forEach((txn: any) => {
      const ref = String(txn?.reference_number || "").trim();
      if (!ref) return;
      if (!grouped.has(ref)) grouped.set(ref, []);
      grouped.get(ref)!.push(txn);
    });

    // Filter to only those with duplicates
    return Array.from(grouped.entries())
      .filter(([_, txns]) => txns.length > 1)
      .map(([ref, txns]) => ({
        reference_number: ref,
        count: txns.length,
        transactions: txns.map((t) => ({
          transaction_id: String(t?.transaction_id || t?.banktransaction_id || t?.id || ""),
          banktransaction_id: String(t?.banktransaction_id || t?.id || ""),
          date: t?.date || "",
          amount: Number(t?.amount ?? 0),
          description: t?.description || "",
          status: t?.status || "unknown",
        })),
      }));
  } catch (err: any) {
    console.error("[ZohoCleanup] Failed to fetch bank transactions:", err.message);
    return [];
  }
}

export async function cleanupDuplicateBankTransactions(
  options?: {
    dryRun?: boolean;
  }
): Promise<CleanupResult> {
  const result: CleanupResult = {
    duplicatesFound: 0,
    cleaned: 0,
    failed: 0,
    errors: [],
    details: [],
  };

  const isDryRun = options?.dryRun === true;

  try {
    const duplicates = await findDuplicateBankTransactions();
    result.duplicatesFound = duplicates.length;
    result.details = duplicates;

    console.log(
      `[ZohoCleanup] Found ${duplicates.length} duplicate reference_number entries${isDryRun ? " (DRY RUN)" : ""}`
    );

    if (duplicates.length === 0) {
      console.log("[ZohoCleanup] No duplicates found.");
      return result;
    }

    // For each duplicate group, keep the newest (by date) and reverse/delete the others
    for (const dup of duplicates) {
      const sortedByDate = [...dup.transactions].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA; // newest first
      });

      const keep = sortedByDate[0];
      const toDelete = sortedByDate.slice(1);

      console.log(
        `[ZohoCleanup] Reference ${dup.reference_number}: keeping ${keep.transaction_id}, deleting ${toDelete.length} duplicate(s)`
      );

      for (const txn of toDelete) {
        if (isDryRun) {
          console.log(`[ZohoCleanup] [DRY RUN] Would reverse transaction ${txn.transaction_id} (₹${txn.amount})`);
          result.cleaned++;
          continue;
        }

        try {
          // Attempt to delete/reverse via PUT (mark as void or delete)
          // Zoho API: DELETE /banktransactions/{txn_id} or PUT to mark as deleted
          await zohoFetch(`/banktransactions/${txn.transaction_id}`, {
            method: "DELETE",
          });

          console.log(`[ZohoCleanup] ✅ Deleted duplicate transaction ${txn.transaction_id}`);
          result.cleaned++;
        } catch (delErr: any) {
          // If DELETE fails, try PUT to reverse it
          try {
            await zohoFetch(`/banktransactions/${txn.transaction_id}`, {
              method: "PUT",
              body: { status: "deleted" },
            });
            console.log(`[ZohoCleanup] ✅ Marked transaction ${txn.transaction_id} as deleted`);
            result.cleaned++;
          } catch (reverseErr: any) {
            const msg = String(reverseErr?.message || "Unknown error");
            console.error(`[ZohoCleanup] ❌ Failed to delete ${txn.transaction_id}: ${msg}`);
            result.failed++;
            result.errors.push({
              reference: dup.reference_number,
              error: `Failed to delete ${txn.transaction_id}: ${msg}`,
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[ZohoCleanup] Cleanup failed:", err.message);
    result.errors.push({
      reference: "GENERAL",
      error: err.message,
    });
  }

  console.log(`[ZohoCleanup] Done. Duplicates found: ${result.duplicatesFound}, cleaned: ${result.cleaned}`);

  return result;
}
