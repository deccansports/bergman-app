// src/lib/zoho/creditNote.ts
import { zohoFetch } from './fetch';

export async function createCreditNote(payload: {
  customer_id: string;
  reference_number: string;
  date: string;
  line_items: Array<{ name: string; rate: number; quantity: number; tax_id?: string }>;
  is_inclusive_tax?: boolean;
  invoice_id?: string;
  invoice_number?: string;
  invoice_type?: string;
  notes?: string;
}) {
  if (!payload.customer_id) throw new Error('Zoho Credit Note Error: customer_id is missing.');
  if (!payload.reference_number) throw new Error('Zoho Credit Note Error: reference_number is missing.');
  if (!Array.isArray(payload.line_items) || payload.line_items.length === 0) {
    throw new Error('Zoho Credit Note Error: line_items must be a non-empty array.');
  }

  const data = await zohoFetch('/creditnotes', { method: 'POST', body: payload });
  return data?.creditnote || null;
}
