// src/lib/types/admin.ts

// This type can be used as a marker for server actions
// that should only be callable by an authenticated admin.
export type AdminOnly = {
  adminContext?: {
    isAdmin: true;
  };
};

export interface MergeLogEntry {
    id: string;
    email: string;
    mergedInto: string;
    duplicateData: any;
    timestamp: string;
    source: 'auto-login' | 'manual-admin';
}
