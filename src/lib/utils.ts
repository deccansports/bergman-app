// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  differenceInDays,
  parseISO,
  isValid as isDateValid,
  isBefore,
  differenceInYears,
  startOfDay as startOfDayFns,
  format,
} from "date-fns";

import {
  REFUND_PERCENT_6_MONTHS_PLUS,
  REFUND_PERCENT_4_MONTHS_PLUS,
  REFUND_PERCENT_3_MONTHS_PLUS,
  REFUND_PERCENT_LESS_THAN_2_MONTHS,
  DAYS_FOR_6_MONTHS_REFUND,
  DAYS_FOR_4_MONTHS_REFUND,
  DAYS_FOR_3_MONTHS_REFUND,
  CANCELLATION_WITHIN_2_DAYS_REFUND_PERCENTAGE,
  INDIAN_STATES,
} from "@/lib/constants";

import countryFlags from "./countryFlagsEmoji.json";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const internationalMobileRegex = /^(?:\+91)?[6-9]\d{9}$|^\+\d{1,3}\d{6,14}$/;

/**
 * Normalizes a phone number to E.164 format (+91...)
 */
export function normalizeToE164(mobile?: string | null): string | undefined {
  if (!mobile) return undefined;
  
  const cleaned = mobile.trim().replace(/\D/g, '');
  
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return `+${cleaned}`;
  }

  if (cleaned.length >= 10 && !mobile.startsWith('+')) {
      return `+${cleaned}`;
  }

  return mobile.startsWith('+') ? mobile : `+${cleaned}`;
}

export const isValidImageUrl = (url: string | null | undefined): url is string => {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  if (["na", "n/a", "null", "undefined", ""].includes(trimmed)) return false;
  return (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/"));
};

/**
 * SANITIZE MONEY UTILITY
 * Ensures currency values are safe for calculation and API transmission.
 */
export function sanitizeMoney(value: any): number {
  const num = Number(value);
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num);
}

export function hmsToSeconds(timeString?: string | null): number {
  if (!timeString) return Infinity;
  const trimmed = timeString.trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A" || trimmed === "-") return Infinity;
  const parts = trimmed.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return Infinity;
  let hours = 0, minutes = 0, seconds = 0;
  if (parts.length === 3) [hours, minutes, seconds] = parts;
  else if (parts.length === 2) [minutes, seconds] = parts;
  else if (parts.length === 1) [seconds] = parts;
  else return Infinity;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return Infinity;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatSecondsToHMS(seconds: number | null | undefined): string {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds === Infinity || seconds < 0) return "--:--:--";
  if (seconds === 0) return "00:00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatOptionalTime(timeString?: string | null): string {
  if (!timeString) return "--:--:--";
  const seconds = hmsToSeconds(timeString);
  return seconds === Infinity ? "--:--:--" : formatSecondsToHMS(seconds);
}

export function getOrdinal(n?: number | null): string {
  if (!n || n <= 0) return "";
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  const s = ["th", "st", "nd", "rd"];
  return s[n % 10] || "th";
}

export function getInitials(name?: string | null) {
  if (!name) return 'A';
  const names = name.trim().split(' ');
  if (names.length > 1) return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

export function cleanText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

export function toTitleCase(str: string | null | undefined): string {
  if (!str) return '';
  return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function normalizeStatus(status?: string | null): string {
  if (!status) return "Unknown";
  const s = status.trim().toUpperCase();
  if (s.includes("FINISH")) return "Finished";
  if (s === "DNF") return "DNF";
  if (s === "DNS") return "DNS";
  if (s === "DNQ") return "DNQ";
  if (s === "ON COURSE" || s === "RACING" || s === "ACTIVE") return "On Course";
  if (s === "NOT STARTED") return "Not Started";
  return status;
}

export const isTriathlonEvent = (raceCategory?: string | null) => !!raceCategory && raceCategory.trim().toUpperCase().includes("TRIATHLON");
export const isDuathlonEvent = (raceCategory?: string | null) => !!raceCategory && raceCategory.trim().toUpperCase().includes("DUATHLON");

/**
 * Robust serialization helper for Next.js RSC boundaries.
 */
export const serializeValue = (value: any): any => {
  if (value === null || value === undefined) return null;
  
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  
  if (typeof value === "object") {
    // Handle BigInt
    if (typeof value === "bigint") return value.toString();
    
    // Handle Dates
    if (value instanceof Date) return value.toISOString();
    
    // Handle Firestore Timestamps
    if (typeof value.toDate === 'function') return value.toDate().toISOString();

    const obj: Record<string, any> = {};
    const keys = Object.keys(value);
    for (const key of keys) {
      obj[key] = serializeValue(value[key]);
    }
    return obj;
  }
  
  return value;
};

export const startOfDay = (date: Date) => startOfDayFns(date);

export function toDateStringSafe(dateField: any): string | null {
  if (!dateField) return null;
  if (dateField && typeof dateField.toDate === 'function') return format(dateField.toDate(), "yyyy-MM-dd");
  if (dateField instanceof Date) return format(dateField, "yyyy-MM-dd");
  if (typeof dateField === "string") return dateField.split("T")[0];
  return null;
}

export function toIsoStringSafe(dateField: any): string | null {
  if (!dateField) return null;
  if (dateField && typeof dateField.toDate === 'function') return dateField.toDate().toISOString();
  if (dateField instanceof Date) return dateField.toISOString();
  if (typeof dateField === "string") {
    try {
        return new Date(dateField).toISOString();
    } catch {
        return null;
    }
  }
  return null;
}

export function calculateAgeGroup(
  dob: string | null | undefined,
  eventName?: string | null,
  eventAgeCategories?: string[] | null,
  referenceDate?: string | null
) {
  if (!dob) return { age: null, ageCategory: null };
  try {
    const birthDate = parseISO(dob);
    if (!isDateValid(birthDate)) return { age: null, ageCategory: null };

    const refDate = referenceDate ? parseISO(referenceDate) : new Date();
    const age = differenceInYears(refDate, birthDate);

    if (age > 99) return { age, ageCategory: "Unknown" };

    const categories = eventAgeCategories || ["18-30", "31-40", "41-50", "Above 51"];
    let ageCategory: string | null = null;

    for (const cat of categories) {
      if (cat.includes("-")) {
        const [min, max] = cat.split("-").map(Number);
        if (age >= min && age <= max) {
          ageCategory = cat;
          break;
        }
      } else if (cat.toLowerCase().includes("above")) {
        const min = parseInt(cat.replace(/\D/g, ""), 10);
        if (!isNaN(min) && age >= min) {
          ageCategory = cat;
          break;
        }
      }
    }
    return { age, ageCategory: ageCategory || "Unknown" };
  } catch {
    return { age: null, ageCategory: "Unknown" };
  }
}

export function calculateRefundAmount(
  eventDateStr: string | null,
  originalAmountPaidPaisa: number | null,
  taxAmountPaisa: number | null,
  processingFeePaisa: number | null,
  platformFeePaisa: number | null,
  registeredAtStr?: string | null
) {
  if (!eventDateStr || !originalAmountPaidPaisa)
    return { refundAmountPaisa: 0, percentage: 0, policyApplied: "Not eligible", daysUntilEvent: Infinity, canCancel: false };

  try {
    const eventDate = parseISO(eventDateStr);
    const today = startOfDayFns(new Date());

    if (!isDateValid(eventDate) || isBefore(eventDate, today))
      return { refundAmountPaisa: 0, percentage: 0, policyApplied: "Event passed", daysUntilEvent: -1, canCancel: false };

    let percentage = 0;
    const daysUntilEvent = differenceInDays(eventDate, today);

    if (registeredAtStr) {
      const regDate = parseISO(registeredAtStr);
      if (isDateValid(regDate) && differenceInDays(today, regDate) <= 2) {
        percentage = CANCELLATION_WITHIN_2_DAYS_REFUND_PERCENTAGE;
      }
    }

    if (percentage === 0) {
      if (daysUntilEvent >= DAYS_FOR_6_MONTHS_REFUND) percentage = REFUND_PERCENT_6_MONTHS_PLUS;
      else if (daysUntilEvent >= DAYS_FOR_4_MONTHS_REFUND) percentage = REFUND_PERCENT_4_MONTHS_PLUS;
      else if (daysUntilEvent >= DAYS_FOR_3_MONTHS_REFUND) percentage = REFUND_PERCENT_3_MONTHS_PLUS;
      else percentage = REFUND_PERCENT_LESS_THAN_2_MONTHS;
    }

    const base = originalAmountPaidPaisa - (taxAmountPaisa ?? 0) - (processingFeePaisa ?? 0) - (platformFeePaisa ?? 0);
    return { refundAmountPaisa: Math.max(0, Math.round((base * percentage) / 100)), percentage, policyApplied: `${percentage}% refund`, daysUntilEvent, canCancel: daysUntilEvent >= 60 };
  } catch {
    return { refundAmountPaisa: 0, percentage: 0, policyApplied: "Error", daysUntilEvent: Infinity, canCancel: false };
  }
}

export function serializeParticipantData(doc: any): any {
  const data = doc.data();
  if (!data) throw new Error("Document data missing");
  const serialized = serializeValue(data);
  const eventId = doc.ref?.parent?.parent?.id;
  const { age, ageCategory } = calculateAgeGroup(serialized.dob, null, null, serialized.eventDate);
  return { ...serialized, id: doc.id, eventId, bookingId: serialized.bookingId || doc.id, name: serialized.name || "Unnamed", email: serialized.email || "", age, ageCategory: serialized.ageCategory || ageCategory };
}

export const serializeParticipantDataUtil = serializeParticipantData;

export const getCountryFlagEmoji = (countryName?: string | null): string => {
  if (!countryName) return "";
  const normalized = countryName.trim().toLowerCase();
  const flags = countryFlags as any;
  for (const code in flags) {
    if (flags[code].name.toLowerCase() === normalized) return flags[code].emoji;
  }
  return "";
};

export function getCountryCode(countryName?: string | null): string | null {
  if (!countryName) return null;
  const normalized = countryName.trim().toLowerCase();
  const flags = countryFlags as any;
  for (const code in flags) {
    if (flags[code].name.toLowerCase() === normalized) return code;
  }
  return null;
}

export function getStateCode(stateInput?: string | null): string | undefined {
  if (!stateInput) return undefined;
  const search = stateInput.trim().toUpperCase();
  const byCode = INDIAN_STATES.find(s => s.value.toUpperCase() === search);
  if (byCode) return byCode.value;
  const byName = INDIAN_STATES.find(s => s.name.toUpperCase() === search);
  return byName?.value;
}

export function getStateName(stateInput?: string | null): string | undefined {
  if (!stateInput) return undefined;
  const search = stateInput.trim().toUpperCase();
  const found = INDIAN_STATES.find(s => s.value.toUpperCase() === search || s.name.toUpperCase() === search);
  return found?.name;
}

export function getPace(seconds: number, distanceKm?: number | null, type: 'swim' | 'bike' | 'run' | 'transition' = 'run'): string {
  if (!distanceKm || distanceKm <= 0 || !seconds || seconds <= 0) return "-";
  if (type === 'swim') {
    const pacePer100m = seconds / (distanceKm * 10);
    return `${formatSecondsToHMS(pacePer100m)}/100m`;
  }
  if (type === 'bike') {
    const speed = distanceKm / (seconds / 3600);
    return `${speed.toFixed(1)} km/h`;
  }
  const pace = seconds / distanceKm;
  return `${formatSecondsToHMS(pace)} /km`;
}

export function interpolatePositionFromPaths(gpxPaths: { path: google.maps.LatLngLiteral[] }[], completedKm: number): google.maps.LatLngLiteral | null {
  if (!gpxPaths?.length) return null;
  let currentDist = 0;
  for (const gpx of gpxPaths) {
    const path = gpx.path;
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      if (typeof window === 'undefined' || !window.google?.maps?.geometry) return null;
      const segmentDist = window.google.maps.geometry.spherical.computeDistanceBetween(new window.google.maps.LatLng(p1), new window.google.maps.LatLng(p2)) / 1000;
      if (currentDist + segmentDist >= completedKm) {
        const ratio = (completedKm - currentDist) / segmentDist;
        return { lat: p1.lat + (p2.lat - p1.lat) * ratio, lng: p1.lng + (p2.lng - p1.lng) * ratio };
      }
      currentDist += segmentDist;
    }
  }
  const last = gpxPaths[gpxPaths.length - 1].path.slice(-1)[0];
  return last || null;
}
