// src/lib/types/coupon.ts
export interface Coupon {
  id: string;
  code: string;
  couponType: 'Discount Code' | 'Group Discount' | 'Access Code' | 'Early Bird / Sale' | 'Club Coupon' | 'Previous Participant' | 'Feedback Coupon';
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  startDate?: string | null;
  expiryDate?: string | null;
  usageLimit: number;
  usageCount: number;
  isActive: boolean;
  applicableEventIds?: string[];
  sourceEventIds?: string[];
  applicableTicketIds?: string[];
  minCartValue?: number | null;
  email?: string | null;
  used?: boolean;
}
