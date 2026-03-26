// src/lib/constants.ts

// Deferral Fee in paisa. This is the PRE-TAX base amount.
export const DEFERRAL_FEE_PAISA = 200000; // ₹2000.00 (previously 249900)

// Deferral window in days (e.g., athlete can request deferral up to X days before the event)
export const DEFERRAL_WINDOW_DAYS = 45;

// Cancellation Policy Constants
export const CANCELLATION_GST_PERCENTAGE = 18; // Assuming 18% GST
export const PLATFORM_FEE_PAISA = 2000; // ₹20 pre-tax
export const CANCELLATION_WITHIN_2_DAYS_REFUND_PERCENTAGE = 90; // NEW: 90% refund within 2 days

// Refund percentages (of amount excluding GST and original processing fees)
export const REFUND_PERCENT_6_MONTHS_PLUS = 70;
export const REFUND_PERCENT_4_MONTHS_PLUS = 50;
export const REFUND_PERCENT_3_MONTHS_PLUS = 20;
export const REFUND_PERCENT_LESS_THAN_2_MONTHS = 0; // No refund if less than 2 months

// Timeframes in days for cancellation refund eligibility
export const DAYS_FOR_6_MONTHS_REFUND = 180; // 6 months or more
export const DAYS_FOR_4_MONTHS_REFUND = 120; // 4 months or more (but less than 6)
export const DAYS_FOR_3_MONTHS_REFUND = 90;  // 3 months or more (but less than 4)
export const DAYS_FOR_NO_REFUND_WINDOW = 60; // Less than 2 months (less than 60 days) for cancellation refund eligibility

// Category Change Constants
export const CATEGORY_CHANGE_WINDOW_DAYS = 45;
export const CATEGORY_CHANGE_FEE_PAISA = 200000; // ₹2000 PRE-TAX (previously 249900)
export const CATEGORY_CHANGE_GST_PERCENTAGE = 18; // GST percentage for ticket price difference component
export const PAYMENT_GATEWAY_FEE_PERCENTAGE = 5; // 5%
export const GST_PERCENTAGE = 18;

// Other change fees (as per new rules, all ₹2499)
export const TICKET_TRANSFER_FEE_PAISA = 249900;

export const KID_TSHIRT_SIZES = ["22", "24", "26", "28", "30", "32"];
export const ADULT_TSHIRT_SIZES = ["34", "36", "38", "40", "42", "44", "46"];
export const GENDERS = ["Male", "Female", "Other"];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export const NO_CLUB_SELECTED_VALUE = "--no-club--";

export const INDIAN_STATES = [
  { "label": "Andaman and Nicobar Islands", "value": "AN", "name": "Andaman and Nicobar Islands" },
  { "label": "Andhra Pradesh", "value": "AP", "name": "Andhra Pradesh" },
  { "label": "Arunachal Pradesh", "value": "AR", "name": "Arunachal Pradesh" },
  { "label": "Assam", "value": "AS", "name": "Assam" },
  { "label": "Bihar", "value": "BR", "name": "Bihar" },
  { "label": "Chandigarh", "value": "CH", "name": "Chandigarh" },
  { "label": "Chhattisgarh", "value": "CG", "name": "Chhattisgarh" },
  { "label": "Dadra and Nagar Haveli and Daman and Diu", "value": "DN", "name": "Dadra and Nagar Haveli and Daman and Diu" },
  { "label": "Delhi", "value": "DL", "name": "Delhi" },
  { "label": "Goa", "value": "GA", "name": "Goa" },
  { "label": "Gujarat", "value": "GJ", "name": "Gujarat" },
  { "label": "Haryana", "value": "HR", "name": "Haryana" },
  { "label": "Himachal Pradesh", "value": "HP", "name": "Himachal Pradesh" },
  { "label": "Jammu and Kashmir", "value": "JK", "name": "Jammu and Kashmir" },
  { "label": "Jharkhand", "value": "JH", "name": "Jharkhand" },
  { "label": "Karnataka", "value": "KA", "name": "Karnataka" },
  { "label": "Kerala", "value": "KL", "name": "Kerala" },
  { "label": "Ladakh", "value": "LA", "name": "Ladakh" },
  { "label": "Lakshadweep", "value": "LD", "name": "Lakshadweep" },
  { "label": "Madhya Pradesh", "value": "MP", "name": "Madhya Pradesh" },
  { "label": "Maharashtra", "value": "MH", "name": "Maharashtra" },
  { "label": "Manipur", "value": "MN", "name": "Manipur" },
  { "label": "Meghalaya", "value": "ML", "name": "Meghalaya" },
  { "label": "Mizoram", "value": "MZ", "name": "Mizoram" },
  { "label": "Nagaland", "value": "NL", "name": "Nagaland" },
  { "label": "Odisha", "value": "OD", "name": "Odisha" },
  { "label": "Puducherry", "value": "PY", "name": "Puducherry" },
  { "label": "Punjab", "value": "PB", "name": "Punjab" },
  { "label": "Rajasthan", "value": "RJ", "name": "Rajasthan" },
  { "label": "Sikkim", "value": "SK", "name": "Sikkim" },
  { "label": "Tamil Nadu", "value": "TN", "name": "Tamil Nadu" },
  { "label": "Telangana", "value": "TS", "name": "Telangana" },
  { "label": "Tripura", "value": "TR", "name": "Tripura" },
  { "label": "Uttar Pradesh", "value": "UP", "name": "Uttar Pradesh" },
  { "label": "Uttarakhand", "value": "UK", "name": "Uttarakhand" },
  { "label": "West Bengal", "value": "WB", "name": "West Bengal" }
];
