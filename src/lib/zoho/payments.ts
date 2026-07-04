// src/lib/zoho/payments.ts
import { zohoFetch } from "./fetch";

async function getLiveInvoiceBalance(invoiceId: string): Promise<number | null> {
  try {
    const data = await zohoFetch(`/invoices/${invoiceId}`);
    const invoice = data?.invoice || null;
    const candidates = [invoice?.balance_due, invoice?.balance, invoice?.due_amount];
    for (const value of candidates) {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  } catch {
    return null;
  }
}

function buildPaymentPayload({
  invoice_id,
  customer_id,
  amount,
  payment_date,
  reference_number,
  payment_mode,
  currency,
  account_id,
}: {
  invoice_id: string;
  customer_id: string;
  amount: number;
  payment_date: string;
  reference_number: string;
  payment_mode?: string;
  currency: 'INR' | 'USD';
  account_id: string;
}) {
  return {
    customer_id,
    payment_mode: payment_mode || 'bankremittance',
    amount: amount.toFixed(2),
    date: payment_date,
    reference_number,
    account_id,
    currency_code: currency,
    invoices: [
      {
        invoice_id,
        amount_applied: amount.toFixed(2),
      },
    ],
  };
}

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

  let paymentAmount = Number(Number(amount).toFixed(2));
  const liveDue = await getLiveInvoiceBalance(invoice_id);
  if (liveDue != null && liveDue > 0) {
    paymentAmount = Number(Math.min(paymentAmount, liveDue).toFixed(2));
  }

  if (!(paymentAmount > 0)) {
    return null;
  }

  const sendPayment = async (finalAmount: number) => {
    const payload = buildPaymentPayload({
      invoice_id,
      customer_id,
      amount: finalAmount,
      payment_date,
      reference_number,
      payment_mode,
      currency,
      account_id: paidThroughAccountId,
    });

    return zohoFetch("/customerpayments", {
      method: "POST",
      body: payload,
    });
  };

  try {
    const res = await sendPayment(paymentAmount);
    return res.payment;
  } catch (error: any) {
    const code = error?.zohoCode || error?.response?.status;
    if (code !== 24016) throw error;

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const retryLiveDue = await getLiveInvoiceBalance(invoice_id);
    const retryAmount = retryLiveDue != null && retryLiveDue > 0
      ? Number(Math.min(paymentAmount, retryLiveDue).toFixed(2))
      : paymentAmount;

    if (!(retryAmount > 0)) {
      return null;
    }

    const retryRes = await sendPayment(retryAmount);
    return retryRes.payment;
  }
}
