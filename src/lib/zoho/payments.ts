// src/lib/zoho/payments.ts
import { zohoFetch } from "./fetch";

export async function applyPaymentToInvoice({
  invoice_id,
  customer_id,
  amount,
  payment_date,
  reference_number,
  payment_mode,
  currency = 'INR',
}: {
  invoice_id: string;
  customer_id: string;
  amount: number;
  payment_date: string;
  reference_number: string;
  payment_mode?: string;
  currency?: 'INR' | 'USD';
}) {
  const ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID = process.env.ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID;
  const STRIPE_CLEARING_ACCOUNT_ID = process.env.STRIPE_CLEARING_ACCOUNT_ID;
  
  let paidThroughAccountId = ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID;
  if (payment_mode === 'Stripe' && STRIPE_CLEARING_ACCOUNT_ID) {
    paidThroughAccountId = STRIPE_CLEARING_ACCOUNT_ID;
  }
  
  if (!paidThroughAccountId) {
    throw new Error("Zoho clearing account ID is missing from environment config.");
  }
  
  const payload = {
    customer_id: customer_id,
    payment_mode: payment_mode || 'bankremittance',
    amount: amount.toFixed(2),
    date: payment_date,
    reference_number: reference_number,
    account_id: paidThroughAccountId,
    currency_code: currency,
    invoices: [
      {
        invoice_id: invoice_id,
        amount_applied: amount.toFixed(2),
      },
    ],
  };

  const res = await zohoFetch("/customerpayments", {
    method: "POST",
    body: payload,
  });

  return res.payment;
}
