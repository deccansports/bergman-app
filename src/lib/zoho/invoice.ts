// src/lib/zoho/invoice.ts
import { zohoFetch } from "./fetch";

/**
 * CREATE ZOHO INVOICE
 */
export async function createInvoice(payload: any): Promise<any> {
  if (!payload.customer_id) throw new Error("Zoho Invoice Error: customer_id is missing.");
  if (!payload.reference_number) throw new Error("Zoho Invoice Error: reference_number is missing.");
  if (!Array.isArray(payload.line_items) || payload.line_items.length === 0) {
    throw new Error("Zoho Invoice Error: line_items must be a non-empty array.");
  }

  // Validate each line item
  payload.line_items.forEach((item: any, index: number) => {
    if (!item.name) throw new Error(`Zoho Invoice Error: line_item[${index}] missing name.`);
    if (item.rate === undefined || item.rate === null) throw new Error(`Zoho Invoice Error: line_item[${index}] missing rate.`);
    if (item.quantity === undefined || item.quantity === null) throw new Error(`Zoho Invoice Error: line_item[${index}] missing quantity.`);
  });

  const existing = await findInvoiceByReference(payload.reference_number);
  if (existing) {
    console.log(`[Zoho Invoice] Reference number ${payload.reference_number} already exists, returning existing invoice.`);
    return existing;
  }

  const finalPayload = {
      ...payload,
      discount_type: payload.discount ? (payload.discount_type || "entity_level") : undefined,
  };

  console.log(`[Zoho Invoice] Sending payload:`, JSON.stringify(finalPayload, null, 2));
  
  const data = await zohoFetch(`/invoices`, { method: "POST", body: finalPayload });
  console.log(`[Zoho Invoice] Created successfully: ${data.invoice?.invoice_id}`);
  return data.invoice;
}

/**
 * MARK INVOICE AS SENT
 */
export async function markInvoiceAsSent(invoiceId: string): Promise<any> {
  try {
    return await zohoFetch(`/invoices/${invoiceId}/status/sent`, { method: "POST", body: {} });
  } catch { return null; }
}

/**
 * EMAIL INVOICE
 */
export async function emailZohoInvoice(invoiceId: string): Promise<void> {
  try {
    await zohoFetch(`/invoices/${invoiceId}/email`, { method: "POST", body: { send_from_org_email_id: true } });
  } catch { /* silence non-critical */ }
}

/**
 * FIND INVOICE BY REFERENCE
 */
export async function findInvoiceByReference(referenceNumber: string): Promise<any | null> {
  if (!referenceNumber) return null;
  const ref = String(referenceNumber).trim().toUpperCase();
  try {
    const data = await zohoFetch('/invoices', { params: { reference_number: ref } });
    if (!data.invoices || !Array.isArray(data.invoices)) return null;
    
    // Exact match filter to avoid prefix matches
    return data.invoices.find((inv: any) => 
        String(inv.reference_number).trim().toUpperCase() === ref
    ) || null;
  } catch { return null; }
}

/**
 * GET INVOICE BY ID
 */
export async function getZohoInvoiceById(invoiceId: string): Promise<any | null> {
  if (!invoiceId) return null;
  try {
    const data = await zohoFetch(`/invoices/${invoiceId}`);
    return data.invoice || null;
  } catch { return null; }
}

/**
 * FETCH INVOICE PDF
 */
export async function getInvoicePdf(invoiceId: string): Promise<Buffer | null> {
  if (!invoiceId) return null;
  try {
    return await zohoFetch(`/invoices/${invoiceId}`, { params: { accept: 'pdf' } });
  } catch { return null; }
}

/**
 * DELETE INVOICE
 */
export async function deleteZohoInvoice(invoiceId: string): Promise<any> {
  return zohoFetch(`/invoices/${invoiceId}`, { method: "DELETE" });
}
