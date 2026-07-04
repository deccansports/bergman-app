// src/lib/types/store.ts
export interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  images: string[];
  hsnCode: string;
  gstPercent: number;
  isActive: boolean;
  order: number;
  isBestseller?: boolean;
  variants: ProductVariant[];
}

export interface ProductVariant {
  size: string;
  mrp: number;
  salePrice: number;
  stock: number;
  sku: string;
}

export interface StoreCartItem {
  productId: string;
  name: string;
  salePrice: number;
  mrp: number;
  image: string;
  size: string;
  quantity: number;
  sku: string;
  hsnCode: string;
  gstPercent: number;
  isBestseller?: boolean;
  discount?: number;
  baseAmount?: number;
  gstAmount?: number;
}

export interface StoreOrder {
  id: string;
  orderId: string | null;
  userId: string | null;
  customerName: string;
  email: string;
  mobile: string;
  shippingAddress: string;
  city: string;
  state: string;
  pincode: string;
  items: StoreCartItem[];
  subtotal: number;
  discount: number;
  discountedSubtotal: number;
  itemBase: number;
  itemGst: number;
  shipping: number;
  shippingBase: number;
  shippingGst: number;
  totalAmount: number;
  totalGst?: number;
  gstAmount: number;
  status: 'Pending' | 'Paid' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Refunded';
  razorpayOrderId: string;
  paymentId?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  createdAt: string;
  updatedAt: string;
  zohoSynced?: boolean;
  zohoSyncError?: string | null;
  couponCode?: string | null;
  trackingId?: string | null;
  courierPartner?: string | null;
  trackingUrl?: string | null;
  refundedAt?: any;
}

export interface StoreCoupon {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  usageLimit: number;
  usedCount: number;
  isActive: boolean;
  minCartValue?: number | null;
}

export interface StoreSettings {
  minAmountFreeShipping: number;
  standardShipping: number;
}
