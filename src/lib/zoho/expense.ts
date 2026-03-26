// src/lib/zoho/expense.ts
import { zohoFetch } from "./fetch";

export async function createExpenseForRazorpayFee({
  paymentId,
  amount,
  date,
}: {
  paymentId: string;
  amount: number; // Amount in rupees
  date: string;
}): Promise<any> {
  const ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID = process.env.ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID;
  const ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID = process.env.ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID;
  
  if (!ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID || !ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID) {
    console.warn("Zoho expense or clearing account IDs are not set. Skipping expense creation for gateway fees.");
    return;
  }
  
  const payload = {
    account_id: ZOHO_PAYMENT_GATEWAY_EXPENSE_ACCOUNT_ID,
    amount: amount,
    paid_through_account_id: ZOHO_RAZORPAY_CLEARING_ACCOUNT_ID,
    date: date,
    reference_number: `Fee for ${paymentId}`,
    vendor_name: "Razorpay",
    is_inclusive_tax: false, 
    tax_treatment: "out_of_scope",
  };
  const data = await zohoFetch(`/expenses`, { method: "POST", body: payload });
  return data.expense;
}
