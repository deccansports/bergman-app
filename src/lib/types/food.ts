// src/lib/types/food.ts
export interface PaidFoodItem {
  id: string;
  name: string;
  description: string | null;
  price: number; 
  isVeg: boolean;
  taxPercentage: number;
  maxPerOrder: number;
  inventory: number | null; 
  isActive: boolean;
  applicableEventIds: string[]; 
  order: number;
}

export interface PaidFoodOrder {
  id: string;
  orderId: string; 
  paymentId: string; 
  buyerName: string;
  buyerMobile: string;
  buyerEmail: string;
  eventId: string | null; 
  items: {
    itemId: string;
    itemName: string;
    quantity: number;
    pricePerItem: number; 
  }[];
  totalAmountPaisa: number;
  createdAt: string;
  status?: 'pending-payment' | 'Paid' | 'Refunded' | 'Cancelled';
}

export interface PaidFoodCoupon {
  id: string; 
  orderId: string;
  itemId: string;
  itemName: string;
  status: 'ISSUED' | 'REDEEMED' | 'REFUNDED' | 'VOID';
  issuedAt: string;
  redeemedAt?: string;
  redeemedBy?: string; 
}

export interface PaidFoodStats {
  totalRevenue: number;
  totalOrders: number;
  totalItemsSold: number;
  totalItemsRedeemed: number;
}
