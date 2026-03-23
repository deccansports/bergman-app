// src/lib/types/payments.ts
import type { PricingBreakdown } from './common';

export interface PaymentRecord {
    id: string;
    entity: string;
    amount: number;
    currency: string;
    status: string;
    order_id: string;
    invoice_id: string | null;
    method: string;
    amount_refunded: number;
    refund_status: string | null;
    email: string;
    contact: string;
    notes: { [key: string]: any };
    created_at: number;
}

export interface Order {
  id: string; 
  eventId: string;
  ticketId: string;
  userId: string | null;
  bookingId: string; 
  paymentId?: string; 
  paymentGateway: 'razorpay' | 'stripe';
  status: string;
  amount: number; 
  currency: 'INR' | 'USD';
  pricingBreakdown: PricingBreakdown;
  createdAt: any; 
  updatedAt: any; 
}
