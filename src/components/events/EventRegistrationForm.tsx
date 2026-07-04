// src/components/events/EventRegistrationForm.tsx
"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { 
  EventCalendarEntry, 
  TicketDefinition, 
  PublicUserProfileData, 
  DeferralEntry, 
  Coupon, 
  FeeDetails, 
  RegistrationAttempt, 
  PricingBreakdown, 
  PricingTier, 
  SwimDistanceCategory,
  EventParticipant,
  PublicEventRegistrationFormInputClient,
  PricingInput
} from '@/lib/types';
import { PublicEventRegistrationSchema } from '@/lib/schemas';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { 
  Loader2, Ticket as TicketIcon, UserCircle, Mail, Smartphone, ShieldCheck, MapPin, CheckCircle2, 
  Waves, Bike, Footprints, Info, Hourglass, CalendarDays, XCircle, Contact, CreditCard, ShieldAlert, Clock, Building, AlertTriangle, Zap, Star,
  Award as AwardIcon, Flag, Globe, Eye, RefreshCw, X
} from 'lucide-react';
import { 
  Alert, 
  AlertTitle, 
  AlertDescription 
} from '@/components/ui/alert';
import { format, parseISO, startOfDay, isBefore, isValid } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { validateCouponAction, getAutoApplyCouponForUserAction } from '@/lib/actions/couponActions';
import { getPerformanceRewardAction } from '@/lib/actions/userActions';
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE, KID_TSHIRT_SIZES, ADULT_TSHIRT_SIZES, NO_CLUB_SELECTED_VALUE, GENDERS, BLOOD_GROUPS, INDIAN_STATES, USA_STATES } from '@/lib/constants';
import { calculateAgeGroup as calculateAgeGroupUtil, isDuathlonEvent, cn, isValidImageUrl, isTicketSaleOpen } from '@/lib/utils';
import { createEventTicketOrderAction, submitPublicEventRegistrationAction, getCancellationCategoryDeferralPolicyAction } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { calculatePricing } from '@/lib/pricingEngine';
import { countriesByContinent } from '@/lib/countries';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';
import { Label } from '@/components/ui/label';
import Image from 'next/image';

import { waiverTextTemplate } from '@/lib/constants/waiver';
import { rulesAndRegulationsText } from '@/lib/constants/rules';

const formatCurrency = (amountInMinorUnits: number | null | undefined, currency: 'INR' | 'USD' = 'INR') => {
  // If price is missing, return empty string to avoid showing misleading ₹0.00
  if (amountInMinorUnits === null || amountInMinorUnits === undefined) return '';
  const amount = amountInMinorUnits / 100;
  return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const FORM_TIME_LIMIT_SECONDS = 10 * 60;

const getIdProofType = (url?: string | null): 'pdf' | 'image' | 'other' => {
  if (!url) return 'other';
  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)$/.test(cleanUrl)) return 'image';
  return isValidImageUrl(url) ? 'image' : 'other';
};

const PricingTiersList = ({ tiers, basePrice, participantsCount = 0, isSelected, showSummaryCard = true, currency = 'INR' }: { tiers?: PricingTier[], basePrice: number | null | undefined, participantsCount: number, isSelected: boolean, showSummaryCard?: boolean, currency?: 'INR' | 'USD' }) => {
  const now = startOfDay(new Date());
  let activeTier: PricingTier | null = null;
  let cumulativeSoldCap = 0;

  if (tiers && tiers.length > 0) {
    for (const tier of tiers) {
      const tierLimit = tier.slotLimit !== null && tier.slotLimit !== undefined ? Math.max(Number(tier.slotLimit || 0), 0) : null;
      const tierCapEnd = tierLimit !== null ? cumulativeSoldCap + tierLimit : null;
      const expiredDate = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
      const expiredSlots = tierCapEnd !== null ? participantsCount >= tierCapEnd : false;
      if (!expiredDate && !expiredSlots && !activeTier) {
        activeTier = tier;
      }
      if (tierLimit !== null) {
        cumulativeSoldCap += tierLimit;
      }
    }
  }

  const currentPrice = activeTier?.pricePaisa ?? basePrice;
  // If currentPrice is zero or falsy, prefer the minimum positive tier price when tiers exist
  const derivedPrice = (() => {
    if (currentPrice && currentPrice > 0) return currentPrice;
    if (tiers && tiers.length > 0) {
      const prices = tiers.map(t => t.pricePaisa).filter(p => p !== null && p !== undefined && Number(p) > 0).map(Number);
      if (prices.length > 0) return Math.min(...prices);
    }
    return currentPrice;
  })();

  return (
    <div className="space-y-4 mt-4 text-left min-w-0">
      {(showSummaryCard && !isSelected) && (
        <div className="border rounded-xl p-4 text-center bg-orange-600/5 border-orange-600/10 text-left">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
            Current Price
            </p>
            <p className="text-3xl font-black italic my-1 text-orange-600 text-left">
            {formatCurrency(derivedPrice, currency)}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-tighter text-orange-600 text-left">
            {activeTier ? `${activeTier.name} ACTIVE` : "Standard Pricing"}
            </p>
        </div>
      )}

      <div className="space-y-2 text-left">
        <p className={cn("text-[10px] font-black uppercase tracking-widest text-left", isSelected ? "text-white/70" : "text-muted-foreground")}>Pricing Progress</p>
        {(tiers || []).map((tier, idx) => {
          const tierLimit = tier.slotLimit !== null && tier.slotLimit !== undefined ? Math.max(Number(tier.slotLimit || 0), 0) : null;
          const previousCap = (tiers || []).slice(0, idx).reduce((sum, t) => {
            const limit = t.slotLimit !== null && t.slotLimit !== undefined ? Math.max(Number(t.slotLimit || 0), 0) : null;
            return sum + (limit || 0);
          }, 0);
          const tierSold = tierLimit !== null ? Math.max(0, Math.min(participantsCount - previousCap, tierLimit)) : participantsCount;
          const tierCapEnd = tierLimit !== null ? previousCap + tierLimit : null;
          const expiredDate = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
          const expiredSlots = tierCapEnd !== null ? participantsCount >= tierCapEnd : false;
          const isClosed = expiredDate || expiredSlots;
          const isActive = activeTier?.name === tier.name;
          
          const slotsRemaining = tierLimit !== null ? Math.max(0, tierLimit - tierSold) : Infinity;
          const isFillingFast = isActive && slotsRemaining > 0 && slotsRemaining <= 5;

          return (
            <div
              key={idx}
              className={cn(
                "flex min-w-0 flex-wrap items-start justify-between gap-3 p-3 rounded-xl border font-bold transition-all duration-300 text-sm text-left sm:flex-nowrap sm:items-center",
                (isActive ? (isSelected ? "bg-white/30 border-white/50 text-white" : "bg-orange-600/10 border-orange-600 text-orange-600") : (isSelected ? "bg-transparent border-white/10 text-white/60" : "bg-background border-transparent text-muted-foreground")),
                isClosed && "opacity-40 line-through"
              )}
            >
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2 font-bold text-left">
                  {isClosed ? <XCircle className="h-3.5 w-3.5" /> : isActive ? <CheckCircle2 className={cn("h-3.5 w-3.5 animate-pulse", isSelected ? "text-white" : "text-orange-600")} /> : <Clock className="h-3.5 w-3.5 opacity-50" />}
                  <span className="break-words">{tier.name}</span>
                </div>
                <p className="text-[10px] uppercase mt-0.5 tracking-tighter text-left">
                  {isClosed ? "Closed" : (isActive ? (isFillingFast ? "OPEN - FILLING FAST!" : "Active — Join Now") : "")}
                </p>
              </div>
              <span className="text-sm font-black italic ml-auto shrink-0">
                {formatCurrency(tier.pricePaisa, currency)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface EventRegistrationFormProps {
  eventDetails: EventCalendarEntry;
  availableTickets: TicketDefinition[];
  onSubmitRegistrationCallback: (data: any, feeDetails: FeeDetails | null, appliedCoupon: Coupon | null) => Promise<void>;
  isLoading: boolean;
  waitlistFormUrl?: string | null;
  idProofFile: File | null;
  onIdProofFileChange: (file: File | null) => void;
  currentUserForForm?: PublicUserProfileData | null;
  formMode?: 'public' | 'adminManualAdd';
  editingParticipant?: EventParticipant | null;
  deferralDetails?: DeferralEntry | null;
  appliedCoupon: Coupon | null;
  setAppliedCoupon: (coupon: Coupon | null) => void;
  setSelectedTicketId: (ticketId: string | null) => void;
  registeredDates?: string[];
  preSelectedTicketId?: string | null;
  waitlistOverrideTicketId?: string | null;
}

const EventRegistrationForm: React.FC<EventRegistrationFormProps> = ({
  eventDetails, availableTickets, onSubmitRegistrationCallback, isLoading, waitlistFormUrl, idProofFile, onIdProofFileChange,
  currentUserForForm, formMode = 'public', editingParticipant, deferralDetails, appliedCoupon, setAppliedCoupon,
  setSelectedTicketId: setSelectedTicketIdProp,
  registeredDates = [],
  preSelectedTicketId,
  waitlistOverrideTicketId,
}) => {
  const { toast } = useToast();
  const eventCurrency: 'INR' | 'USD' = eventDetails.currency === 'USD' ? 'USD' : 'INR';
  const formatEventCurrency = useCallback(
    (amountInMinorUnits: number | null | undefined) => formatCurrency(amountInMinorUnits, eventCurrency),
    [eventCurrency]
  );
  const autoCouponCheckRef = useRef<string | null>(null);
  const [hasShownAutoCouponToast, setHasShownAutoCouponToast] = useState(false);
  
  const [performanceReward, setPerformanceReward] = useState<{ discountPercent: number; unlockedTier?: string; pointsEarnedLastYear?: number } | null>(null);
  const [isLoadingReward, setIsLoadingReward] = useState(false);

  // Split mobile into country code and number for UI
  const [dialCode, setDialCode] = useState('+91');
  
  // ID proof state management
  const [isReplacingId, setIsReplacingId] = useState(false);
  const [existingIdUrl, setExistingIdUrl] = useState<string | null>(null);
  const [isIdProofModalOpen, setIsIdProofModalOpen] = useState(false);
  const isWaitlistUnlockedTicket = !!waitlistOverrideTicketId && preSelectedTicketId === waitlistOverrideTicketId;

  const defaultFormValues = useMemo(() => {
    const prefillData = editingParticipant || currentUserForForm;
    let mobileOnly = prefillData?.mobile || '';
    
    // Extract dial code if possible
    if (mobileOnly.startsWith('+')) {
        const matched = COUNTRY_CODES.find(c => mobileOnly.startsWith(c.dial_code));
        if (matched) {
            mobileOnly = mobileOnly.replace(matched.dial_code, '');
            setDialCode(matched.dial_code);
        }
    }

    return {
        name: prefillData?.name || '',
        email: prefillData?.email || '',
        mobile: mobileOnly,
        address: prefillData?.address || '',
        city: prefillData?.city || '',
        pincode: prefillData?.pincode || '',
        state: prefillData?.state || '',
        country: prefillData?.country || 'India',
        tshirtSize: prefillData?.tshirtSize || '',
        dob: prefillData?.dob || '',
        gender: (prefillData?.gender as "Other" | "Male" | "Female") || 'Male',
        bloodGroup: prefillData?.bloodGroup || '',
        emergencyContactNumber: prefillData?.emergencyContactNumber || '',
        digitalSignatureName: prefillData?.name || '',
        previousTimingCertificateUrl: (editingParticipant as any)?.previousTimingCertificateUrl || '',
        consentPromotions: true,
        agreedRules: false,
        agreedWaiver: false,
        agreedCutoff: false,
        ticketId: editingParticipant?.ticketId || preSelectedTicketId || "",
        clubId: prefillData?.clubId || NO_CLUB_SELECTED_VALUE,
        billingType: 'personal' as const,
        businessName: (prefillData as any)?.businessName || '',
        gstin: (prefillData as any)?.gstin || '',
        businessAddress: (prefillData as any)?.businessAddress || '',
        businessEmail: '',
        businessMobile: '',
        businessPrimaryContactName: '',
        businessPrimaryContactEmail: '',
        businessPrimaryContactMobile: '',
        confirmGstDetails: false,
        selectedSubCategory: null as string | null,
    };
  }, [editingParticipant, currentUserForForm, preSelectedTicketId]);

  const form = useForm<PublicEventRegistrationFormInputClient>({
    resolver: zodResolver(PublicEventRegistrationSchema),
    defaultValues: defaultFormValues,
  });

  const [feeDetails, setFeeDetails] = useState<FeeDetails | null>(null);
  const [calculatedAge, setCalculatedAge] = useState<number | null>(null);
  const [calculatedAgeGroup, setCalculatedAgeGroup] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isAutoApplying, setIsAutoApplying] = useState(false);
  const [tshirtSizeOptions, setTshirtSizeOptions] = useState<string[]>([]);
  const [isWaiverOpen, setIsWaiverOpen] = useState(false);
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [agreedPolicyChangeFlow, setAgreedPolicyChangeFlow] = useState(false);
  const [policyContentHtml, setPolicyContentHtml] = useState<string>(
    '<p>Loading policy...</p>'
  );
  const [mobileStep, setMobileStep] = useState<'ticket' | 'details'>(preSelectedTicketId ? 'details' : 'ticket');
  const [formDeadlineMs, setFormDeadlineMs] = useState<number | null>(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(FORM_TIME_LIMIT_SECONDS);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<boolean>(false);
  
  // Initialize existing ID from user profile
  useEffect(() => {
    if (currentUserForForm?.idProofUrl && currentUserForForm.idProofUrl !== 'na' && currentUserForForm.idProofUrl !== null) {
      setExistingIdUrl(currentUserForForm.idProofUrl);
      setIsReplacingId(false);
    } else {
      setExistingIdUrl(null);
      setIsReplacingId(false);
    }
  }, [currentUserForForm?.idProofUrl]);

  const dobValue = form.watch("dob");
  const emailValue = form.watch("email");
  const selectedTicketId = form.watch("ticketId");
  const selectedSubCategoryId = form.watch("selectedSubCategory");
  const billingType = form.watch("billingType");
  const gstinValue = form.watch("gstin");
  const businessNameValue = form.watch("businessName");
  const businessAddressValue = form.watch("businessAddress");
  const businessPrimaryContactNameValue = form.watch("businessPrimaryContactName");
  const businessPrimaryContactEmailValue = form.watch("businessPrimaryContactEmail");
  const businessPrimaryContactMobileValue = form.watch("businessPrimaryContactMobile");
  const confirmGstDetailsValue = form.watch("confirmGstDetails");
  const countryValue = form.watch("country");
  const selectedClubIdValue = form.watch("clubId");
  const activeClubFromHistory = Array.isArray((currentUserForForm as any)?.clubHistory)
    ? (((currentUserForForm as any).clubHistory.find((entry: any) => entry?.isActive)) || (currentUserForForm as any).clubHistory[(currentUserForForm as any).clubHistory.length - 1])
    : null;
  const profileClubId = currentUserForForm?.clubId || activeClubFromHistory?.clubId || null;
  const effectiveClubId =
    selectedClubIdValue && selectedClubIdValue !== NO_CLUB_SELECTED_VALUE
      ? selectedClubIdValue
      : (profileClubId || null);
  const isIndiaSelected = (countryValue || '').trim().toLowerCase() === 'india';
  const isUSASelected = (countryValue || '').trim().toLowerCase() === 'united states';
  const isStateRequired = isIndiaSelected || isUSASelected;
  const uniqueIndianStates = useMemo(() => {
    const seen = new Set<string>();
    return INDIAN_STATES.filter((stateItem) => {
      const key = (stateItem.value || stateItem.label || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);
  const uniqueUSAStates = useMemo(() => {
    const seen = new Set<string>();
    return USA_STATES.filter((stateItem) => {
      const key = (stateItem.value || stateItem.label || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);
  const agreedRules = form.watch("agreedRules");
  const agreedWaiver = form.watch("agreedWaiver");
  const agreedCutoff = form.watch("agreedCutoff");
  const loggedInEmail = String(currentUserForForm?.email || '').trim().toLowerCase();
  const enteredEmail = String(emailValue || '').trim().toLowerCase();
  const isEmailDifferentFromLogin = !!loggedInEmail && !!enteredEmail && loggedInEmail !== enteredEmail;
  const idProofType = getIdProofType(existingIdUrl);
  const proxiedIdProofUrl = existingIdUrl ? `/api/proxy-image?url=${encodeURIComponent(existingIdUrl)}` : null;
  const isInrEvent = eventCurrency === 'INR';
  const normalizedEventCountry = (eventDetails.country || '').trim().toLowerCase();
  const isUsdOrUsaEvent =
    eventCurrency === 'USD' ||
    normalizedEventCountry === 'united states' ||
    normalizedEventCountry === 'usa' ||
    normalizedEventCountry === 'us' ||
    normalizedEventCountry === 'united states of america';
  const internationalTaxExplicitlyEnabled =
    (eventDetails as any)?.enableInternationalTax === true ||
    (eventDetails as any)?.collectTax === true ||
    (eventDetails as any)?.taxEnabled === true;

  const handleBillingTypeChange = useCallback((nextBillingType: 'personal' | 'business') => {
    form.setValue('billingType', nextBillingType, { shouldValidate: true, shouldDirty: true });

    if (nextBillingType === 'personal') {
      form.clearErrors([
        'gstin',
        'businessName',
        'businessAddress',
        'businessPrimaryContactName',
        'businessPrimaryContactEmail',
        'businessPrimaryContactMobile',
        'confirmGstDetails',
      ]);
    }
  }, [form]);

  useEffect(() => {
    if (isInrEvent) return;

    // USD/USA flow: enforce personal billing and clear B2B/GST fields
    form.setValue('billingType', 'personal', { shouldValidate: true, shouldDirty: false });
    form.setValue('gstin', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessName', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessAddress', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessEmail', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessMobile', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessPrimaryContactName', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessPrimaryContactEmail', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('businessPrimaryContactMobile', '', { shouldValidate: false, shouldDirty: false });
    form.setValue('confirmGstDetails', false, { shouldValidate: false, shouldDirty: false });
  }, [form, isInrEvent]);

  useEffect(() => {
    let isMounted = true;
    getCancellationCategoryDeferralPolicyAction()
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.html) {
          setPolicyContentHtml(res.html);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setPolicyContentHtml('<p>Policy is temporarily unavailable.</p><p>For full details, visit:</p><p><a href="/refund-policy" target="_blank" rel="noopener noreferrer">Visit Refund Policy</a></p>');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Update dial code when country changes
  useEffect(() => {
    if (countryValue) {
      const matchedCountry = COUNTRY_CODES.find(c => c.name.toLowerCase() === countryValue.toLowerCase());
      if (matchedCountry) {
        setDialCode(matchedCountry.dial_code);
      }

      // Clear state if country is neither India nor USA
      if (matchedCountry && matchedCountry.name.toLowerCase() !== 'india' && matchedCountry.name.toLowerCase() !== 'united states') {
          form.setValue('state', '', { shouldValidate: false, shouldDirty: true });
          form.clearErrors('state');
        }
    }
  }, [countryValue, form]);
  
  const validAvailableTickets = useMemo(() => 
    (availableTickets || []).filter(ticket => 
      ticket && 
      typeof ticket.id === 'string' && 
      ticket.id.trim() !== ''
    ),
  [availableTickets]);

  const isTicketSelectable = useCallback((ticket?: TicketDefinition | null) => {
    if (!ticket) return false;
    if (ticket.isSoldOut) return false;
    return isTicketSaleOpen(ticket.openDate, ticket.startTime, ticket.closeDate, ticket.endTime);
  }, []);

  const activeTicket = useMemo(() => 
    validAvailableTickets.find(t => t.id === selectedTicketId),
  [validAvailableTickets, selectedTicketId]);

  const configuredTaxPercentRaw = Number(activeTicket?.gstPercent);
  const hasConfiguredTaxPercent = Number.isFinite(configuredTaxPercentRaw) && configuredTaxPercentRaw > 0;
  const effectiveTaxPercent = hasConfiguredTaxPercent
    ? (isUsdOrUsaEvent ? (internationalTaxExplicitlyEnabled ? configuredTaxPercentRaw : 0) : configuredTaxPercentRaw)
    : (isUsdOrUsaEvent ? 0 : GST_PERCENTAGE);
  const taxEnabledForSelection = effectiveTaxPercent > 0;
  const taxLabel = isUsdOrUsaEvent ? 'Tax' : 'GST';

  const hasSubCategories = useMemo(() => 
    !!(activeTicket?.subCategories && activeTicket.subCategories.length > 0),
  [activeTicket]);

  const rewardRaceYear = useMemo(() => {
    const candidate = String(activeTicket?.eventDate || eventDetails.eventDate || '').trim();
    if (!candidate) return new Date().getFullYear();

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getFullYear();
    }

    // Fallback for non-ISO/range-like strings: extract first 4-digit year.
    const yearMatch = candidate.match(/\b(20\d{2})\b/);
    return yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  }, [activeTicket?.eventDate, eventDetails.eventDate]);

  const targetRules = useMemo(() => {
    return (hasSubCategories && selectedSubCategoryId) 
      ? activeTicket?.subCategories?.find(s => s.id === selectedSubCategoryId)
      : activeTicket;
  }, [activeTicket, selectedSubCategoryId, hasSubCategories]);

  const normalizedAgeGroups = useMemo(() => {
    const raw = (targetRules as any)?.applicableAgeGroups;
    if (!raw) return eventDetails.ageCategories || [];
    if (Array.isArray(raw)) return raw;
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }, [targetRules, eventDetails.ageCategories]);

  const resolveActivePrice = useCallback((target: TicketDefinition | SwimDistanceCategory): { pricePaisa: number, tier?: PricingTier } => {
    const basePrice = ('pricePaisa' in target ? target.pricePaisa : (target as any).price) || 0;
    
    const layers = (target as any).tiers || [];
    if (layers.length === 0) return { pricePaisa: basePrice };

    const now = startOfDay(new Date());
    const targetParticipants = (eventDetails.participants || []).filter((p: any) => {
        if ('ticketCategory' in target) return p.ticketId === target.id;
        else return p.selectedSubCategory === target.id;
    });
    const currentCount = targetParticipants.length;

    for (const tier of layers) {
        const isDateExpired = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
        const isSlotExpired = tier.slotLimit ? currentCount >= tier.slotLimit : false;
        if (!isDateExpired && !isSlotExpired) {
            return { pricePaisa: tier.pricePaisa, tier };
        }
    }
    return { pricePaisa: basePrice };
  }, [eventDetails.participants]);

  const calculateFees = useCallback((basePricePaisa: number, deferralCreditPaisa: number = 0, coupon?: Coupon | null, perfDiscountPercent: number = 0) => {
    const isUsd = eventDetails.currency === 'USD';
    
    const isDeferredRegistration = deferralCreditPaisa > 0;
    const hasCouponApplied = !!coupon;
    
    let effectivePerfDiscountPercent = perfDiscountPercent;
    if (isDeferredRegistration || hasCouponApplied) {
        effectivePerfDiscountPercent = 0;
    }

    const perfDiscountAmount = Math.round(basePricePaisa * (effectivePerfDiscountPercent / 100));
    const netBeforeCoupon = Math.max(0, basePricePaisa - perfDiscountAmount);
    const couponDiscount = coupon ? (coupon.discountType === 'fixed' ? (coupon.discountValue || 0) * 100 : Math.round(netBeforeCoupon * (coupon.discountValue || 0) / 100)) : 0;

    const totalDiscountPaisa = deferralCreditPaisa + perfDiscountAmount + couponDiscount;

    const pricingInput: PricingInput = {
      basePrice: basePricePaisa,
      discount: totalDiscountPaisa,
      gatewayRate: isUsd ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
      platformFeeBase: isUsd ? 0 : PLATFORM_FEE_PAISA,
      taxEnabled: taxEnabledForSelection,
      gstRate: taxEnabledForSelection ? (effectiveTaxPercent / 100) : 0,
      currency: isUsd ? 'USD' : 'INR',
    };
    const breakdown = calculatePricing(pricingInput);
    setFeeDetails({
        basePricePaisa, deferralCreditPaisa,
        couponDiscountPaisa: totalDiscountPaisa - deferralCreditPaisa,
        eventBasePaisa: (breakdown.base || 0) - (breakdown.discount || 0),
        eventGstPaisa: breakdown.eventGST || 0,
        processingFeeBasePaisa: breakdown.processingFeeBase || 0,
        processingGST: breakdown.processingGST || 0,
        platformFeeBasePaisa: breakdown.platformFeeBase || 0,
        platformGST: breakdown.platformGST || 0, 
        roundingAdjustmentPaisa: breakdown.roundingAdjustment,
        totalPayablePaisa: breakdown.totalPayable || 0,
    });
  }, [eventDetails.currency, taxEnabledForSelection, effectiveTaxPercent]);

  useEffect(() => {
    if (!currentUserForForm?.uid) {
      setPerformanceReward(null);
      return;
    }

    setIsLoadingReward(true);
    getPerformanceRewardAction(currentUserForForm.uid, rewardRaceYear)
      .then((res) => {
        if (res.success && res.discountPercent > 0) {
          setPerformanceReward({
            discountPercent: res.discountPercent,
            unlockedTier: res.unlockedTier,
            pointsEarnedLastYear: res.pointsEarnedLastYear,
          });
        } else {
          setPerformanceReward(null);
        }
      })
      .catch(() => {
        setPerformanceReward(null);
      })
      .finally(() => setIsLoadingReward(false));
  }, [currentUserForForm?.uid, rewardRaceYear]);

  useEffect(() => {
    if (!selectedTicketId || !activeTicket) return;

    const selectedSub = activeTicket.subCategories?.find(s => s.id === (selectedSubCategoryId || ''));
    const canPriceNow = !activeTicket.subCategories?.length || !!selectedSubCategoryId;
    if (!canPriceNow) return;

    const basePrice = activeTicket.subCategories?.length
      ? (selectedSub?.pricePaisa || 0)
      : resolveActivePrice(activeTicket).pricePaisa;

    calculateFees(
      basePrice,
      deferralDetails?.estimatedOriginalBasePricePaisa || 0,
      appliedCoupon,
      performanceReward?.discountPercent || 0
    );
  }, [
    selectedTicketId,
    selectedSubCategoryId,
    activeTicket,
    appliedCoupon,
    deferralDetails,
    performanceReward,
    calculateFees,
    resolveActivePrice,
  ]);

  const handleTicketSelectionChange = useCallback((ticketId: string | null) => {
    if (!ticketId) {
        form.setValue('ticketId', "", { shouldValidate: true });
        setFeeDetails(null);
        return;
    }
    
    // Prevent selection of unavailable tickets
    const ticket = validAvailableTickets?.find(t => t.id === ticketId);
    if (!isTicketSelectable(ticket)) {
      return;
    }
    
    setSessionExpiredNotice(false);
    form.setValue('ticketId', ticketId, { shouldValidate: true });
    form.setValue('selectedSubCategory', null);
    setSelectedTicketIdProp(ticketId);
    
    const subCategories = ticket?.subCategories || [];
    
    if (ticket && subCategories.length === 0) {
      const priceInfo = resolveActivePrice(ticket);
      calculateFees(priceInfo.pricePaisa, deferralDetails?.estimatedOriginalBasePricePaisa || 0, appliedCoupon, performanceReward?.discountPercent || 0);
    } else { 
      setFeeDetails(null); 
    }
  }, [form, setSelectedTicketIdProp, validAvailableTickets, isTicketSelectable, deferralDetails, appliedCoupon, calculateFees, resolveActivePrice, performanceReward]);

  const handleSubCategoryChange = useCallback((subId: string) => {
    form.setValue('selectedSubCategory', subId, { shouldValidate: true });
    const ticket = validAvailableTickets.find(t => t.id === selectedTicketId);
    if (ticket && ticket.subCategories) {
        const sub = ticket.subCategories.find(s => s.id === subId);
        if (sub) {
            const priceInfo = resolveActivePrice(sub);
            calculateFees(priceInfo.pricePaisa, deferralDetails?.estimatedOriginalBasePricePaisa || 0, appliedCoupon, performanceReward?.discountPercent || 0);
        }
    }
  }, [form, validAvailableTickets, selectedTicketId, deferralDetails, appliedCoupon, calculateFees, resolveActivePrice, performanceReward]);

  useEffect(() => {
    const autoApplyKey = `${selectedTicketId || ''}|${currentUserForForm?.uid || ''}|${effectiveClubId || 'no-club'}`;
    if (selectedTicketId && currentUserForForm?.uid && !isAutoApplying && autoCouponCheckRef.current !== autoApplyKey) {
        autoCouponCheckRef.current = autoApplyKey;
        setIsAutoApplying(true);
        getAutoApplyCouponForUserAction(eventDetails.id, selectedTicketId, currentUserForForm.uid, effectiveClubId)
            .then(result => {
                if (result.success && result.coupon) {
                    setAppliedCoupon(result.coupon);
                    setCouponCode(result.coupon.code);
                    if (!hasShownAutoCouponToast) {
                        toast({ title: 'Coupon Auto-Applied!', description: result.message });
                        setHasShownAutoCouponToast(true);
                    }
                    const ticket = validAvailableTickets?.find(t => t.id === selectedTicketId);
                    if (ticket) {
                        const activeSub = ticket.subCategories?.find(s => s.id === (selectedSubCategoryId || ''));
                        if (!ticket.subCategories?.length || selectedSubCategoryId) {
                            const bp = ticket.subCategories?.length 
                                ? (activeSub?.pricePaisa || 0) 
                                : resolveActivePrice(ticket).pricePaisa;
                            calculateFees(bp, deferralDetails?.estimatedOriginalBasePricePaisa || 0, result.coupon, performanceReward?.discountPercent || 0);
                        }
                    }
                }
            })
            .finally(() => setIsAutoApplying(false));
    }
  }, [selectedTicketId, selectedSubCategoryId, eventDetails.id, currentUserForForm?.uid, effectiveClubId, setAppliedCoupon, toast, validAvailableTickets, deferralDetails, calculateFees, isAutoApplying, hasShownAutoCouponToast, resolveActivePrice, performanceReward]);

  useEffect(() => {
    if (dobValue) {
      const refDate = (activeTicket as any)?.eventDate || eventDetails.eventDate || format(new Date(), 'yyyy-MM-dd');
      const { age, ageCategory } = calculateAgeGroupUtil(dobValue, eventDetails.eventName, normalizedAgeGroups, refDate);
      setCalculatedAge(age);
      setCalculatedAgeGroup(ageCategory);
      setTshirtSizeOptions(age !== null && (age < 16) ? KID_TSHIRT_SIZES : ADULT_TSHIRT_SIZES);
    }
  }, [dobValue, normalizedAgeGroups, eventDetails.eventName, activeTicket, eventDetails.eventDate]);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim() || !selectedTicketId || !eventDetails) return;
    setIsApplyingCoupon(true);
    const result = await validateCouponAction(couponCode, eventDetails.id, selectedTicketId, currentUserForForm?.uid);
    if (result.success && result.coupon) {
      setAppliedCoupon(result.coupon);
      if (activeTicket) {
        const activeSub = activeTicket.subCategories?.find(s => s.id === (selectedSubCategoryId || ''));
        const bp = (activeTicket.subCategories?.length) ? (activeSub?.pricePaisa || 0) : resolveActivePrice(activeTicket).pricePaisa;
        calculateFees(bp, deferralDetails?.estimatedOriginalBasePricePaisa || 0, result.coupon, performanceReward?.discountPercent || 0);
      }
    } else { toast({ variant: 'destructive', title: 'Coupon Rejected', description: result.message }); }
    setIsApplyingCoupon(false);
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    if (activeTicket) {
        const activeSub = activeTicket.subCategories?.find(s => s.id === (selectedSubCategoryId || ''));
        const bp = (activeTicket.subCategories?.length) ? (activeSub?.pricePaisa || 0) : resolveActivePrice(activeTicket).pricePaisa;
        calculateFees(bp, deferralDetails?.estimatedOriginalBasePricePaisa || 0, null, performanceReward?.discountPercent || 0);
    }
  };

  const handleIdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file && file.size > 1 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File Too Large", description: "ID proof must be under 1MB" });
      onIdProofFileChange(null);
    } else if (file) {
      toast({ title: "File Selected", description: `${file.name} will replace existing ID proof` });
      onIdProofFileChange(file);
    } else {
      onIdProofFileChange(null);
    }
  };
  
  const handleCancelReplaceId = () => {
    setIsReplacingId(false);
    onIdProofFileChange(null);
    // Reset file input
    const fileInput = document.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const onInvalidSubmit = (errors: FieldErrors<PublicEventRegistrationFormInputClient>) => {
    const errorFields = Object.keys(errors).map(key => {
        const fieldName = key.replace(/([A-Z])/g, ' $1').toLowerCase();
        return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
    });
    toast({ variant: "destructive", title: "Missing Information", description: `Please check: ${errorFields.join(', ')}` });
  };

  const onSubmitWrapper = async (data: any) => {
    if (isEmailDifferentFromLogin) {
      toast({ variant: 'destructive', title: 'Email Mismatch', description: 'Logged-in email and registration email are not the same.' });
      return;
    }
    if (calculatedAgeGroup === 'Unknown' || !calculatedAgeGroup) {
        toast({ variant: 'destructive', title: 'Eligibility Error', description: 'Your age does not meet category requirements.' });
        return;
    }
    // Combine dial code and mobile for final submission
    const finalData = {
        ...data,
      agreedPolicyChangeFlow: agreedPolicyChangeFlow === true,
      billingType: isInrEvent ? data.billingType : 'personal',
      gstin: isInrEvent ? (data.gstin || '') : '',
      businessName: isInrEvent ? (data.businessName || '') : '',
      businessAddress: isInrEvent ? (data.businessAddress || '') : '',
      businessEmail: isInrEvent ? (data.businessEmail || '') : '',
      businessMobile: isInrEvent ? (data.businessMobile || '') : '',
      businessPrimaryContactName: isInrEvent ? (data.businessPrimaryContactName || '') : '',
      businessPrimaryContactEmail: isInrEvent ? (data.businessPrimaryContactEmail || '') : '',
      businessPrimaryContactMobile: isInrEvent ? (data.businessPrimaryContactMobile || '') : '',
      confirmGstDetails: isInrEvent ? !!data.confirmGstDetails : false,
      state: ((data.country || '').trim().toLowerCase() === 'india' || (data.country || '').trim().toLowerCase() === 'united states') ? (data.state || '') : '',
        mobile: `${dialCode}${data.mobile.replace(/\D/g, '')}`,
    };
    await onSubmitRegistrationCallback(finalData, feeDetails, appliedCoupon);
  };

  const getPopulatedWaiverText = () => {
    const formData = form.getValues();
    let eventDateStr = 'Date not available';
    if (activeTicket?.eventDate) {
      eventDateStr = format(parseISO(activeTicket.eventDate), 'MMMM dd, yyyy');
    } else if (eventDetails.eventDate) {
      eventDateStr = format(parseISO(eventDetails.eventDate), 'MMMM dd, yyyy');
    }
    const registrationDate = new Date();
    const eventCategory = activeTicket?.ticketName || validAvailableTickets.find((t: TicketDefinition) => t.id === selectedTicketId)?.ticketName || 'Category not available';

    return waiverTextTemplate
      .replace(/{{name}}/g, formData.name || 'Participant')
      .replace(/{{eventname}}/g, eventDetails.eventName || 'the event')
      .replace(/{{category}}/g, eventCategory)
      .replace(/{{eventdate}}/g, eventDateStr)
      .replace(/{{address}}/g, formData.address || 'N/A')
      .replace(/{{phone}}/g, `${dialCode}${formData.mobile}` || 'N/A')
      .replace(/{{email}}/g, formData.email || 'N/A')
      .replace(/{{emergency_number}}/g, formData.emergencyContactNumber || 'N/A')
      .replace(/{{signature}}/g, formData.digitalSignatureName || formData.name || 'Participant')
      .replace(/{{day}}/g, format(registrationDate, 'do'))
      .replace(/{{date}}/g, format(registrationDate, 'MMMM, yyyy'))
      .replace(/{{organizer_name}}/g, eventDetails.organizerName || 'Deccan Sports Club')
      .replace(/{{company_description}}/g, eventDetails.organizerCompanyDescription || '')
      .replace(/{{organizer_address}}/g, eventDetails.organizerAddress || '')
      .replace(/{{country}}/g, formData.country || 'India');
  };

  const submitBlockers = useMemo(() => {
    const blockers: string[] = [];

    if (!selectedTicketId) blockers.push('Select a ticket to continue.');
    if (hasSubCategories && !selectedSubCategoryId) blockers.push('Select a distance/sub-category to continue.');
    if (isEmailDifferentFromLogin) blockers.push('Logged-in email and registration email must match.');
    if (calculatedAgeGroup === 'Unknown' || !calculatedAgeGroup) blockers.push('Your age does not match the selected category.');
    if (!agreedRules) blockers.push('Accept the rules and regulations.');
    if (!agreedWaiver) blockers.push('Accept the event waiver.');
    if (!agreedCutoff) blockers.push('Accept the cut-off timings.');
    if (!agreedPolicyChangeFlow) blockers.push('Accept Cancellation / Category change / Deferral policy.');
    if (timeLeftSeconds <= 0) blockers.push('Session expired. Re-select your ticket to continue.');

    if (billingType === 'business') {
      if (!String(gstinValue || '').trim()) blockers.push('Enter GSTIN or switch to Primary Customer.');
      if (!String(businessNameValue || '').trim()) blockers.push('Enter registered company name or switch to Primary Customer.');
      if (!String(businessAddressValue || '').trim()) blockers.push('Enter business registered address or switch to Primary Customer.');
      if (!String(businessPrimaryContactNameValue || '').trim()) blockers.push('Enter business primary contact name or switch to Primary Customer.');
      if (!String(businessPrimaryContactEmailValue || '').trim()) blockers.push('Enter business primary contact email or switch to Primary Customer.');
      if (!String(businessPrimaryContactMobileValue || '').trim()) blockers.push('Enter business primary contact mobile or switch to Primary Customer.');
      if (!confirmGstDetailsValue) blockers.push('Confirm GST details or switch to Primary Customer.');
    }

    return blockers;
  }, [
    selectedTicketId,
    hasSubCategories,
    selectedSubCategoryId,
    isEmailDifferentFromLogin,
    calculatedAgeGroup,
    agreedRules,
    agreedWaiver,
    agreedCutoff,
    agreedPolicyChangeFlow,
    timeLeftSeconds,
    billingType,
    gstinValue,
    businessNameValue,
    businessAddressValue,
    businessPrimaryContactNameValue,
    businessPrimaryContactEmailValue,
    businessPrimaryContactMobileValue,
    confirmGstDetailsValue,
  ]);

  const isSubmitDisabled = useMemo(() => {
    return isLoading || submitBlockers.length > 0;
  }, [isLoading, submitBlockers]);

  const canProceedToDetails = useMemo(() => {
    return !!selectedTicketId && isTicketSelectable(activeTicket) && (!hasSubCategories || !!selectedSubCategoryId);
  }, [selectedTicketId, isTicketSelectable, activeTicket, hasSubCategories, selectedSubCategoryId]);

  const renderSubmitBlockers = useCallback(() => {
    if (submitBlockers.length === 0) return null;

    return (
      <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-950/30">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
          Why you cannot proceed yet
        </p>
        <ul className="mt-2 space-y-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
          {submitBlockers.map((reason, index) => (
            <li key={`${reason}-${index}`} className="flex items-start gap-2">
              <span className="mt-[2px]">•</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }, [submitBlockers]);

  const isFormExpired = timeLeftSeconds <= 0;

  useEffect(() => {
    if (!isFormExpired || !selectedTicketId) return;

    setSessionExpiredNotice(true);
    setMobileStep('ticket');
    setFormDeadlineMs(null);
    setFeeDetails(null);
    form.setValue('ticketId', '', { shouldValidate: true, shouldDirty: true });
    form.setValue('selectedSubCategory', null, { shouldValidate: true, shouldDirty: true });
    setSelectedTicketIdProp(null);
  }, [isFormExpired, selectedTicketId, form, setSelectedTicketIdProp]);

  const formatCountdown = useCallback((seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (!selectedTicketId || (hasSubCategories && !selectedSubCategoryId)) {
      setMobileStep('ticket');
    }
  }, [selectedTicketId, hasSubCategories, selectedSubCategoryId]);

  useEffect(() => {
    if (!selectedTicketId) {
      setFormDeadlineMs(null);
      setTimeLeftSeconds(sessionExpiredNotice ? 0 : FORM_TIME_LIMIT_SECONDS);
      return;
    }

    setFormDeadlineMs(Date.now() + FORM_TIME_LIMIT_SECONDS * 1000);
    setTimeLeftSeconds(FORM_TIME_LIMIT_SECONDS);
  }, [selectedTicketId, sessionExpiredNotice]);

  useEffect(() => {
    if (!formDeadlineMs) return;

    const tick = () => {
      const remaining = Math.ceil((formDeadlineMs - Date.now()) / 1000);
      setTimeLeftSeconds(Math.max(0, remaining));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [formDeadlineMs]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmitWrapper, onInvalidSubmit)} className="mx-auto w-full max-w-[480px] px-3 pb-4 space-y-4 text-left md:max-w-4xl md:px-4 md:pb-0 md:space-y-6 lg:px-6">

        <div className="mx-auto w-full max-w-4xl flex items-center gap-2 rounded-2xl border border-orange-600/10 bg-orange-50/50 p-2">
          <button
            type="button"
            onClick={() => setMobileStep('ticket')}
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-[0.22em] transition-all",
              mobileStep === 'ticket' ? "bg-orange-600 text-white shadow-sm" : "text-orange-600"
            )}
          >
            1. Ticket
          </button>
          <button
            type="button"
            onClick={() => canProceedToDetails && setMobileStep('details')}
            disabled={!canProceedToDetails}
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-[0.22em] transition-all",
              mobileStep === 'details' ? "bg-orange-600 text-white shadow-sm" : "text-orange-600",
              !canProceedToDetails && "cursor-not-allowed opacity-40"
            )}
          >
            2. Form
          </button>
        </div>

        {(selectedTicketId || sessionExpiredNotice) && (
          <div className={cn(
            "mx-auto w-full max-w-4xl rounded-2xl border px-3 py-2.5 text-left",
            !sessionExpiredNotice && "md:hidden",
            isFormExpired
              ? "border-destructive/40 bg-destructive/10"
              : timeLeftSeconds <= 120
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-orange-600/20 bg-orange-50 dark:bg-orange-950/30"
          )}>
            <div className="flex items-center justify-between gap-3">
              <p className={cn(
                "text-[10px] font-black uppercase tracking-[0.18em]",
                isFormExpired ? "text-destructive" : "text-orange-600 dark:text-orange-400"
              )}>
                Registration Session Timer
              </p>
              <span className={cn(
                "font-mono text-sm font-black",
                isFormExpired ? "text-destructive" : "text-foreground"
              )}>
                {formatCountdown(timeLeftSeconds)}
              </span>
            </div>
            {isFormExpired ? (
              <p className="mt-1 text-xs font-bold text-destructive">
                Time expired. Please reselect your ticket to start a new 10-minute session.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                You have 10 minutes to complete this form after selecting your ticket.
              </p>
            )}
          </div>
        )}
        
        {performanceReward && performanceReward.discountPercent > 0 && (
            <div className={cn(
              "mx-auto w-full max-w-4xl p-4 sm:p-5 border-2 rounded-2xl animate-in zoom-in-95 duration-500 text-left shadow-sm",
                mobileStep === 'details' ? 'hidden md:block' : 'block',
                (appliedCoupon || deferralDetails) ? "bg-muted/50 border-muted opacity-60" : "bg-primary/10 border-primary"
            )}>
                <div className="flex items-center gap-3 text-left">
                    <div className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-lg",
                        (appliedCoupon || deferralDetails) ? "bg-slate-400" : "bg-primary"
                    )}>
                        <AwardIcon className="h-6 w-6" />
                    </div>
                    <div className="text-left">
                        <h4 className={cn("font-black uppercase tracking-tight leading-tight", (appliedCoupon || deferralDetails) ? "text-muted-foreground" : "text-primary")}>
                            { (appliedCoupon || deferralDetails) ? "Reward Paused (Rules Apply)" : "Performance Reward Unlocked!" }
                        </h4>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                          Auto-Applied Discount ({performanceReward.unlockedTier}): {performanceReward.discountPercent}%
                        </p>
                    </div>
                </div>
                {(appliedCoupon || deferralDetails) ? (
                    <p className="mt-3 text-[10px] font-bold text-muted-foreground uppercase tracking-tighter text-left">
                        Reward points cannot be combined with coupons or deferrals. You are currently using a higher priority discount.
                    </p>
                ) : (
                    <p className="mt-3 text-xs text-muted-foreground font-medium text-left">
                        Based on your <strong>{performanceReward.pointsEarnedLastYear} points</strong> from the previous season, a <strong>{performanceReward.discountPercent}% discount</strong> will be automatically applied to your base registration fee.
                    </p>
                )}
            </div>
        )}

        <div className={cn("mx-auto w-full max-w-4xl space-y-4", mobileStep === 'ticket' ? 'block' : 'hidden')}>
        {waitlistFormUrl && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left">
            <p className="text-sm text-amber-900">
              Some categories are now sold out, but don’t worry — join our waitlist for a chance to secure your spot if cancellations become available.
            </p>
            <p className="mt-2 text-xs text-amber-800">
              Entries from the waitlist will be offered on a first come, first serve basis.
            </p>
            <div className="mt-3">
              <Button asChild type="button" variant="outline" className="border-amber-600 text-amber-800 hover:bg-amber-100">
                <a href={waitlistFormUrl} target="_blank" rel="noreferrer">Join Waitlist</a>
              </Button>
            </div>
          </div>
        )}

        <FormField control={form.control} name="ticketId" render={({ field }) => (
            <FormItem className="text-left">
              <FormLabel className="text-base sm:text-lg font-semibold flex items-center gap-2 text-left"><TicketIcon className="h-5 w-5 text-accent" /> Select Your Ticket*</FormLabel>
              <FormControl>
                <div className="max-w-full overflow-hidden rounded-3xl">
                  <div className="min-w-0 space-y-3 md:space-y-4">
                    <RadioGroup onValueChange={handleTicketSelectionChange} value={field.value || ""} className="grid w-full grid-cols-1 gap-3 md:gap-4 text-left">
                        {validAvailableTickets.map(ticket => {
                          const isSelected = field.value === ticket.id;
                          const activePriceInfo = resolveActivePrice(ticket);
                          const count = (eventDetails.participants || []).filter((p: any) => p.ticketId === ticket.id).length;
                          const ticketDateStr = ticket.eventDate || eventDetails.eventDate;
                          const formattedTicketDate = ticketDateStr ? format(parseISO(ticketDateStr), 'PPP') : 'Date TBD';
                          const isRegisteredForDate = ticketDateStr && registeredDates.includes(ticketDateStr);
                          const isRegistrationOpen = isTicketSaleOpen(ticket.openDate, ticket.startTime, ticket.closeDate, ticket.endTime);
                          const isWaitlistOverrideForTicket = isWaitlistUnlockedTicket && ticket.id === waitlistOverrideTicketId;
                          const isUnavailable = !!isRegisteredForDate || (!isWaitlistOverrideForTicket && (ticket.isSoldOut || !isRegistrationOpen));

                          const priceDisplay = (() => {
                              if (ticket.ticketType === 'Free') return 'FREE';
                              if (ticket.subCategories && ticket.subCategories.length > 0) {
                                  const prices = ticket.subCategories.map(s => s.pricePaisa).filter((p): p is number => typeof p === 'number');
                                  if (prices.length > 0) {
                                      const min = Math.min(...prices);
                                      const max = Math.max(...prices);
                                        if (min === max) return formatEventCurrency(min);
                                        return `${formatEventCurrency(min)} - ${formatEventCurrency(max)}`;
                                  }
                              }
                                    return formatEventCurrency(ticket.price);
                          })();

                          return (
                            <Label key={ticket.id} className={cn(
                              "flex w-full max-w-full min-w-0 flex-col overflow-hidden p-3 sm:p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 group shadow-sm text-left",
                              isSelected && !isUnavailable ? "bg-orange-600 text-white border-orange-600 ring-2 ring-orange-600 ring-offset-0 sm:ring-offset-2" : "bg-background border-muted",
                              !isUnavailable && !isSelected ? "hover:border-primary/30" : "",
                              isUnavailable ? "opacity-75 cursor-not-allowed" : ""
                            )}>
                              <div className="flex w-full min-w-0 items-start justify-between gap-2 text-left">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2 text-left">
                                    <span className="min-w-0 max-w-full break-words font-extrabold text-base sm:text-xl uppercase tracking-tight leading-tight">{ticket.ticketName}</span>
                                    {ticket.isSoldOut && !isWaitlistOverrideForTicket && <Badge variant="destructive" className="text-[10px] h-5 font-black uppercase">Sold Out</Badge>}
                                    {!isRegistrationOpen && !isWaitlistOverrideForTicket && <Badge variant="secondary" className="text-[10px] h-5 font-black uppercase">Date Ended</Badge>}
                                    {isRegisteredForDate && <Badge variant="destructive" className="text-[10px] h-5 font-black uppercase">Registered</Badge>}
                                  </div>
                                  <div className={cn("mt-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em]", isSelected ? "text-white/80" : "text-orange-600")}>
                                    <CalendarDays className="h-3" /> {formattedTicketDate}
                                  </div>
                                </div>
                                <div className={cn("shrink-0 text-right font-black text-lg sm:text-2xl italic leading-none", isSelected ? "text-white" : "text-orange-600")}>
                                  {formatEventCurrency(activePriceInfo.pricePaisa)}
                                  {priceDisplay !== formatEventCurrency(activePriceInfo.pricePaisa) && (
                                    <div className={cn("mt-1 text-[9px] font-bold uppercase tracking-[0.14em]", isSelected ? "text-white/70" : "text-slate-500")}>{priceDisplay} range</div>
                                  )}
                                </div>
                              </div>

                              <div className={cn("mt-2 flex max-w-full flex-wrap items-center gap-2 text-[11px] sm:text-sm font-bold uppercase", isSelected ? "text-white" : "text-[#64748b]")}>
                                {isDuathlonEvent(ticket.ticketName) ? (
                                  <div className="flex max-w-full flex-wrap items-center gap-1 text-left">
                                    <Footprints className="h-4 w-4"/>
                                    <Bike className="h-4 w-4"/>
                                    <Footprints className="h-4 w-4"/>
                                    <span className="ml-1 break-words">{ticket.courseMaps?.run1Distance || '—'}K • {ticket.courseMaps?.bikeDistance || '—'}K • {ticket.courseMaps?.run2Distance || '—'}K</span>
                                  </div>
                                ) : (ticket.ticketCategory === 'Swimming') ? (
                                  <div className="flex max-w-full flex-wrap items-center gap-1 text-left">
                                    <Waves className="h-4 w-4"/>
                                    <span className="ml-1 break-words">Multi-Distance Swim</span>
                                  </div>
                                ) : (
                                  <div className="flex max-w-full flex-wrap items-center gap-1 text-left">
                                    <Waves className="h-4 w-4"/>
                                    <Bike className="h-4 w-4"/>
                                    <Footprints className="h-4 w-4"/>
                                    <span className="ml-1 break-words">{ticket.courseMaps?.swimDistance || '—'}K • {ticket.courseMaps?.bikeDistance || '—'}K • {ticket.courseMaps?.runDistance || '—'}K</span>
                                  </div>
                                )}
                              </div>

                              <div className={cn("mt-2 inline-flex max-w-full flex-wrap items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]", isSelected ? "bg-white/15 text-white" : "bg-orange-600/10 text-orange-600") }>
                                <Star className="h-3 w-3" />
                                Tier: {activePriceInfo.tier?.name || 'Standard'}
                              </div>

                              {ticket.description && (
                                <p className={cn("mt-2 text-xs leading-relaxed", isSelected ? "text-white/80" : "text-muted-foreground")}>
                                  {ticket.description}
                                </p>
                              )}

                              {isUnavailable && (ticket.isSoldOut || !isRegistrationOpen) && waitlistFormUrl && !isWaitlistOverrideForTicket && (
                                <div className="mt-2 text-xs">
                                  <a
                                    href={`${waitlistFormUrl}?ticketId=${encodeURIComponent(ticket.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded-md border border-white/30 bg-sky-400 px-3 py-1.5 font-extrabold text-slate-950 no-underline shadow-md shadow-sky-500/40 transition-all hover:bg-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    Join Waitlist for this ticket
                                  </a>
                                </div>
                              )}

                              <div className="hidden md:block">
                                <PricingTiersList tiers={ticket.tiers} basePrice={ticket.price} participantsCount={count} isSelected={isSelected} showSummaryCard={false} currency={eventCurrency} />
                              </div>
                              <RadioGroupItem value={ticket.id} id={`ticket-${ticket.id}`} className="sr-only" />
                            </Label>
                          )
                        })}
                    </RadioGroup>
                  </div>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

        {hasSubCategories && (
            <FormField control={form.control} name="selectedSubCategory" render={({ field }) => (
                    <FormItem className="animate-in slide-in-from-top-2 duration-300 space-y-4 p-4 sm:p-6 border-2 border-orange-600/20 bg-orange-600/5 rounded-2xl text-left shadow-sm">
                        <FormLabel className="text-sm font-black uppercase tracking-widest text-orange-600 flex items-center gap-2 text-left"><Waves className="h-4 w-4" /> Select Distance Category*</FormLabel>
                        <FormControl>
                            <RadioGroup onValueChange={handleSubCategoryChange} value={field.value || ""} className="grid w-full grid-cols-1 gap-4 text-left">
                                {activeTicket?.subCategories?.map(sub => {
                                    const priceInfo = resolveActivePrice(sub);
                                    const isSubSelected = field.value === sub.id;
                                    const count = (eventDetails.participants || []).filter((p: any) => p.selectedSubCategory === sub.id).length;
                                    return (
                                        <Label key={sub.id} className={cn("flex w-full max-w-full min-w-0 flex-col overflow-hidden p-4 sm:p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 group shadow-sm text-left", isSubSelected ? "bg-orange-600 text-white border-orange-600 ring-2 ring-orange-600 ring-offset-0 sm:ring-offset-2" : "bg-background border-muted hover:border-primary/30")}>
                                          <div className="flex w-full min-w-0 flex-col items-start justify-between gap-2 text-left sm:flex-row sm:items-center">
                                              <div className="flex min-w-0 flex-col text-left w-full">
                                              <span className="break-words font-black uppercase text-base sm:text-lg italic tracking-tight text-left">{sub.name}</span>
                                                  <span className={cn("text-[10px] font-bold uppercase mt-1 tracking-widest text-left", isSubSelected ? "text-white/80" : "text-muted-foreground")}>Eligible: {Array.isArray(sub.applicableAgeGroups) ? sub.applicableAgeGroups.join(', ') : sub.applicableAgeGroups}</span>
                                              </div>
                                            <div className={cn("w-full shrink-0 text-left font-black text-xl sm:w-auto sm:text-right sm:text-2xl italic leading-none", isSubSelected ? "text-white" : "text-orange-600")}>{formatEventCurrency(priceInfo.pricePaisa)}</div>
                                            </div>
                                            <div className="hidden md:block">
                                              <PricingTiersList tiers={sub.tiers} basePrice={sub.pricePaisa} participantsCount={count} isSelected={isSubSelected} showSummaryCard={false} currency={eventCurrency} />
                                            </div>
                                            <RadioGroupItem value={sub.id} id={`subcat-${sub.id}`} className="sr-only" />
                                        </Label>
                                    );
                                })}
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
        )}

        <div>
          <Button
            type="button"
            onClick={() => setMobileStep('details')}
            disabled={!canProceedToDetails || isFormExpired}
            className="w-full rounded-2xl bg-orange-600 py-6 text-sm font-black uppercase tracking-[0.22em] text-white shadow-lg shadow-orange-600/20 disabled:opacity-50"
          >
            Next: Registration Form
          </Button>
          {hasSubCategories && !selectedSubCategoryId && selectedTicketId && (
            <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-destructive">
              Please select a specific distance category to continue.
            </p>
          )}
        </div>
        </div>

        {selectedTicketId && (
          <div className="animate-in fade-in-0 zoom-in-95 duration-500 mx-auto w-full max-w-[480px] md:max-w-4xl space-y-4 overflow-visible rounded-2xl bg-transparent p-0 text-left md:space-y-6">

            <div className={cn(mobileStep === 'details' ? 'block' : 'hidden')}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMobileStep('ticket')}
                className="w-full rounded-2xl border-orange-200 py-6 text-sm font-black uppercase tracking-[0.22em] text-orange-600"
              >
                Back to Tickets
              </Button>
            </div>

            <div className={cn("mx-auto w-full max-w-4xl", mobileStep === 'details' ? 'block' : 'hidden')}>

            {selectedTicketId && (
              <div className={cn(
                "mb-4 hidden rounded-2xl border px-4 py-3 text-left md:block",
                isFormExpired
                  ? "border-destructive/40 bg-destructive/10"
                  : timeLeftSeconds <= 120
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-orange-600/20 bg-orange-50 dark:bg-orange-950/30"
              )}>
                <div className="flex items-center justify-between gap-3">
                  <p className={cn(
                    "text-[11px] font-black uppercase tracking-[0.18em]",
                    isFormExpired ? "text-destructive" : "text-orange-600 dark:text-orange-400"
                  )}>
                    Registration Session Timer
                  </p>
                  <span className={cn(
                    "font-mono text-base font-black",
                    isFormExpired ? "text-destructive" : "text-foreground"
                  )}>
                    {formatCountdown(timeLeftSeconds)}
                  </span>
                </div>
                {isFormExpired ? (
                  <p className="mt-1 text-sm font-bold text-destructive">
                    Time expired. Please reselect your ticket to start a new 10-minute session.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    You have 10 minutes to complete this form after selecting your ticket.
                  </p>
                )}
              </div>
            )}

            <div className="hidden w-full max-w-full overflow-visible rounded-2xl border border-slate-200 bg-white p-4 shadow-md">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold tracking-wide text-orange-600">Registration Summary</p>
                  <h3 className="text-base sm:text-xl font-semibold tracking-tight text-foreground">
                    {activeTicket?.ticketName || validAvailableTickets.find((t: TicketDefinition) => t.id === selectedTicketId)?.ticketName || 'Category not available'}
                  </h3>
                  <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    {selectedSubCategoryId && (
                      <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                        {activeTicket?.subCategories?.find(s => s.id === selectedSubCategoryId)?.name || 'Sub-category selected'}
                      </Badge>
                    )}
                    {calculatedAgeGroup && calculatedAgeGroup !== 'Unknown' && (
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                        {calculatedAgeGroup}
                      </Badge>
                    )}
                  </div>
                </div>
                {feeDetails && (
                  <div className="rounded-xl bg-orange-600 px-4 py-3 text-left text-white shadow-md">
                    <p className="text-[11px] font-semibold tracking-wide text-white/80">Payable</p>
                    <p className="text-xl font-bold tracking-tight">{formatEventCurrency(feeDetails.totalPayablePaisa)}</p>
                  </div>
                )}
              </div>
            </div>
            
            {isInrEvent && (
            <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-md text-left">
              <Label className="text-sm font-semibold tracking-wide text-muted-foreground flex items-center gap-2 text-left">
                <CreditCard className="h-4 w-4 text-orange-600" /> Invoice Billing Type*
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-left">
                <div 
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border-2 p-4 cursor-pointer hover:bg-muted/50 transition-all min-h-[72px]",
                    billingType === 'personal' ? "border-orange-600 bg-orange-600/5 ring-1 ring-orange-600" : "border-muted"
                  )}
                  onClick={() => handleBillingTypeChange('personal')}
                >
                  <UserCircle className={cn("h-6 w-6 mb-2", billingType === 'personal' ? "text-orange-600" : "text-muted-foreground")} />
                  <span className="font-semibold text-[12px] text-center">Primary Customer</span>
                  <span className="mt-1 text-[10px] text-muted-foreground text-center">Use this if you do not need a business invoice.</span>
                </div>
                <div 
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border-2 p-4 cursor-pointer hover:bg-muted/50 transition-all min-h-[72px]",
                    billingType === 'business' ? "border-orange-600 bg-orange-600/5 ring-1 ring-orange-600" : "border-muted"
                  )}
                  onClick={() => handleBillingTypeChange('business')}
                >
                  <Building className={cn("h-6 w-6 mb-2", billingType === 'business' ? "text-orange-600" : "text-muted-foreground")} />
                  <span className="font-semibold text-[12px] text-center">Business (B2B)</span>
                  <span className="mt-1 text-[10px] text-muted-foreground text-center">Choose this only if you want a GST/business invoice.</span>
                </div>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-left">
                You can switch back to Primary Customer anytime and continue without business invoice details.
              </p>
            </div>
            )}

            {isInrEvent && billingType === 'business' && (
              <div className="space-y-5 rounded-2xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 p-4 animate-in slide-in-from-top-2 duration-300 text-left overflow-visible shadow-md">
                <h3 className="text-sm font-semibold tracking-wide text-orange-600 dark:text-orange-400 flex items-center gap-2 border-b border-orange-100 dark:border-orange-800 pb-2 text-left">
                  <ShieldAlert className="h-4 w-4" /> Registered Business Details
                </h3>
                
                {(currentUserForForm as any)?.gstin && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl">
                    <p className="text-sm font-bold text-green-700 dark:text-green-400">
                      ✓ You have a GST number on file, so you can request a GST-compliant invoice for your business.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 text-left">
                  <FormField control={form.control} name="gstin" render={({ field }) => (
                    <FormItem className="text-left">
                      <FormLabel className="text-[10px] font-black uppercase text-orange-600 text-left">GSTIN Number*</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="15-digit GSTIN" className="rounded-xl h-10 font-mono font-bold uppercase text-left" disabled={isLoading}/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="businessName" render={({ field }) => (
                    <FormItem className="text-left">
                      <FormLabel className="text-[10px] font-black uppercase text-orange-600 text-left">Registered Company Name*</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="As per GST records" className="rounded-xl h-10 font-bold text-left" disabled={isLoading}/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="businessAddress" render={({ field }) => (
                  <FormItem className="text-left">
                    <FormLabel className="text-[10px] font-black uppercase text-orange-600 text-left">Business Registered Address*</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="Full address for invoice" className="rounded-xl h-10 text-left" disabled={isLoading}/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                
                <Separator className="bg-orange-600/10" />
                <h4 className="text-[10px] font-black uppercase tracking-widest text-orange-600 flex items-center gap-2 text-left"><Contact className="h-3 w-3"/> Business Primary Contact</h4>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-left">
                    <FormField control={form.control} name="businessPrimaryContactName" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-left">Full Name*</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Contact Person" className="rounded-xl h-10 text-left" disabled={isLoading}/>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="businessPrimaryContactEmail" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-left">Email Address*</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} value={field.value || ""} placeholder="billing@company.com" className="rounded-xl h-10 text-left" disabled={isLoading}/>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="businessPrimaryContactMobile" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-left">Mobile No.*</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Contact Number" className="rounded-xl h-10 text-left" disabled={isLoading}/>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                </div>

                <FormField control={form.control} name="confirmGstDetails" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-background text-left">
                        <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} disabled={isLoading}/></FormControl>
                        <div className="space-y-1 leading-none text-left">
                            <FormLabel className="text-xs font-bold uppercase text-orange-600 text-left">I confirm these GST details are accurate</FormLabel>
                            <FormDescription className="text-[10px] text-left">Tax invoices once issued with these details cannot be modified.</FormDescription>
                      <FormMessage />
                        </div>
                    </FormItem>
                )} />
              </div>
            )}

            <div className="w-full overflow-visible">
            <ScrollArea className="h-auto w-full overflow-visible custom-scrollbar">
              <div className="min-w-0 w-full flex flex-col gap-3 py-1 sm:py-2 text-left">
                <div className="order-1 grid grid-cols-1 gap-6 text-left">
                  <div className="w-full min-w-0 space-y-2 overflow-visible rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 shadow-md text-left sm:space-y-3 sm:p-3">
                    <h3 className="text-sm font-semibold tracking-wide flex items-center gap-2 border-b pb-2 text-orange-600 dark:text-orange-400"><UserCircle className="h-4 w-4" /> Participant Profile</h3>
                    <div className="space-y-3">
                    <Alert className="bg-blue-600/10 dark:bg-blue-900/30 border-blue-600/20 dark:border-blue-600/40 rounded-xl">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <AlertTitle className="text-blue-600 dark:text-blue-400 font-bold">Check Your Name</AlertTitle>
                      <AlertDescription className="text-blue-600/90 dark:text-blue-400/90 text-xs mt-1">
                        Please verify your full name carefully. If your ID doesn&apos;t have your full name and only has initials, make sure your name field matches your ID exactly. Your invoice will be generated using the name you enter here.
                      </AlertDescription>
                    </Alert>
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Full Name*</FormLabel>
                        <FormControl><Input {...field} value={field.value || ""} placeholder="As per ID" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm font-semibold" disabled={isLoading}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Email Address*</FormLabel>
                        <FormControl><Input type="email" {...field} value={field.value || ""} placeholder="you@email.com" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm lowercase font-semibold" disabled={isLoading}/></FormControl>
                        <FormMessage />
                        {isEmailDifferentFromLogin && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 text-left">
                            Logged-in email and registration email are not the same.
                          </p>
                        )}
                      </FormItem>
                    )} />
                    <div className="space-y-1 text-left">
                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Mobile Number (WhatsApp)*</FormLabel>
                        <div className="flex flex-wrap gap-2 text-left sm:flex-nowrap">
                            <Select value={dialCode} onValueChange={setDialCode} disabled={isLoading}>
                            <SelectTrigger className="h-10 w-[78px] shrink-0 rounded-xl bg-background px-2 text-left text-sm font-bold sm:w-[88px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="text-left">
                                    {COUNTRY_CODES.map(c => (
                                        <SelectItem key={c.code} value={c.dial_code} className="text-left">
                                            {c.dial_code}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormField control={form.control} name="mobile" render={({ field }) => (
                                <FormItem className="min-w-0 flex-grow text-left">
                                    <FormControl><Input {...field} value={field.value || ""} placeholder="8390288857" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm font-semibold" disabled={isLoading}/></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </div>
                    <FormField control={form.control} name="emergencyContactNumber" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Emergency Contact Mobile*</FormLabel>
                          <FormControl><Input type="tel" {...field} value={field.value || ''} placeholder="Emergency mobile with country code" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm font-semibold" disabled={isLoading}/></FormControl>
                          <FormMessage />
                        </FormItem>
                    )} />
                    <div className="space-y-2.5 rounded-xl border border-dashed bg-muted/20 p-3 text-left sm:p-4">
                        <FormField control={form.control} name="dob" render={({ field }) => (
                          <FormItem className="w-full min-w-0 text-left">
                            <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Date of Birth*</FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value || ""} className="h-10 w-full min-w-0 rounded-xl px-2.5 text-left text-[13px] sm:px-3 sm:text-sm" disabled={isLoading}/></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        {calculatedAge !== null && (
                          <div className="mt-3 flex flex-col gap-2 px-1 text-left sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-[10px] font-black uppercase text-muted-foreground text-left">Status:</div>
                            <div className="flex flex-wrap gap-2 text-left">
                              <Badge variant="secondary" className="text-[10px] uppercase font-black">{calculatedAge} Years</Badge>
                              <Badge variant="outline" className={cn("text-[10px] uppercase font-black", (calculatedAgeGroup === 'Unknown' || !calculatedAgeGroup) ? "text-destructive border-destructive" : "text-orange-600 border-orange-600")}>{calculatedAgeGroup || 'Checking...'}</Badge>
                            </div>
                          </div>
                        )}
                        {(calculatedAgeGroup === 'Unknown' || !calculatedAgeGroup) && dobValue && (
                            <Alert variant="destructive" className="mt-3 p-2 bg-destructive/10 text-[10px] border-destructive/20 text-left">
                                <AlertTriangle className="h-3 w-3" />
                                <AlertTitle className="font-black uppercase tracking-tighter text-left">Age Ineligibility</AlertTitle>
                                <AlertDescription className="text-left">Your age ({calculatedAge} years) does not fit within the required age brackets for the selected category. Please double check your Date of Birth or choose another category.</AlertDescription>
                            </Alert>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                      <FormField control={form.control} name="gender" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Gender*</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""} disabled={isLoading}>
                            <FormControl>
                              <SelectTrigger className="h-10 w-full min-w-0 rounded-xl text-left text-sm font-semibold">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="text-left">
                              {GENDERS.map(g => <SelectItem key={g} value={g as any}>{g}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="bloodGroup" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Blood Group*</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""} disabled={isLoading}>
                            <FormControl>
                              <SelectTrigger className="h-10 w-full min-w-0 rounded-xl text-left text-sm font-semibold">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="text-left">
                              {BLOOD_GROUPS.map(bg => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="space-y-2 text-left">
                      <Label className="text-[10px] font-black uppercase text-muted-foreground text-left">T-Shirt Size*</Label>
                      <FormField control={form.control} name="tshirtSize" render={({ field }) => (
                        <FormItem className="text-left">
                          <Select onValueChange={field.onChange} value={field.value || ""} disabled={isLoading}>
                            <FormControl>
                              <SelectTrigger className="h-10 w-full min-w-0 rounded-xl text-left text-sm font-semibold">
                                <SelectValue placeholder="Size"/>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="text-left">
                              {tshirtSizeOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="space-y-2 text-left">
                      <Label className="text-[10px] font-black uppercase text-muted-foreground text-left">Identity Proof (JPG, PNG, PDF)*</Label>
                      
                      {/* Case 1: User has existing ID and not replacing */}
                      {existingIdUrl && !isReplacingId ? (
                        <div className="space-y-3">
                          <div className="border-2 border-primary/20 rounded-xl p-4 bg-primary/5">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-green-600" />
                                <span className="font-semibold text-sm text-foreground">ID Proof Saved</span>
                              </div>
                              <Badge variant="outline" className="bg-green-600/10 text-green-700 border-green-200">Active</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-4">Your saved ID proof from your profile will be used for this registration.</p>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                onClick={() => setIsIdProofModalOpen(true)}
                                className="flex-1"
                              >
                                <Eye className="h-4 w-4 mr-2" /> View ID
                              </Button>
                              <Button 
                                type="button" 
                                variant="secondary" 
                                size="sm" 
                                onClick={() => setIsReplacingId(true)}
                                className="flex-1"
                              >
                                <RefreshCw className="h-4 w-4 mr-2" /> Replace ID
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : isReplacingId && existingIdUrl ? (
                        /* Case 2: User is replacing existing ID */
                        <div className="space-y-3">
                          <div className="border-2 border-amber-600/20 rounded-xl p-4 bg-amber-600/5">
                            <div className="flex items-center gap-2 mb-3">
                              <AlertTriangle className="h-5 w-5 text-amber-600" />
                              <span className="font-semibold text-sm text-amber-700">Upload New ID</span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-4">Select a new ID proof to replace the existing one. It will be saved to your profile.</p>
                            <Input 
                              type="file" 
                              accept=".jpg,.jpeg,.png,.pdf" 
                              onChange={handleIdFileChange} 
                              disabled={isLoading} 
                              className="h-10 w-full min-w-0 rounded-xl pt-2 text-left text-sm font-semibold" 
                            />
                            {idProofFile && (
                              <p className="text-xs text-green-600 mt-2 font-medium">✓ New file selected: {idProofFile.name}</p>
                            )}
                            <div className="flex flex-col sm:flex-row gap-2 mt-4">
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                onClick={handleCancelReplaceId}
                                className="flex-1"
                              >
                                <X className="h-4 w-4 mr-2" /> Cancel
                              </Button>
                              <Button 
                                type="button" 
                                variant="secondary" 
                                size="sm" 
                                onClick={() => {
                                  if (idProofFile) {
                                    setIsReplacingId(false);
                                  } else {
                                    toast({ variant: "destructive", title: "No file selected", description: "Please select a file first" });
                                  }
                                }}
                                disabled={!idProofFile}
                                className="flex-1"
                              >
                                <CheckCircle2 className="h-4 w-4 mr-2" /> Confirm
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Case 3: No existing ID - upload required */
                        <div className="space-y-3">
                          <div className="border-2 border-red-600/20 rounded-xl p-4 bg-red-600/5">
                            <div className="flex items-center gap-2 mb-3">
                              <ShieldAlert className="h-5 w-5 text-red-600" />
                              <span className="font-semibold text-sm text-red-700">ID Proof Required</span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-4">Please upload your ID proof. It will be saved to your profile for future registrations.</p>
                            <Input 
                              type="file" 
                              accept=".jpg,.jpeg,.png,.pdf" 
                              onChange={handleIdFileChange} 
                              disabled={isLoading} 
                              className="h-10 w-full min-w-0 rounded-xl pt-2 text-left text-sm font-semibold" 
                            />
                            {idProofFile && (
                              <p className="text-xs text-green-600 mt-2 font-medium">✓ File selected: {idProofFile.name}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="w-full min-w-0 space-y-2 overflow-visible rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 shadow-md text-left sm:space-y-3 sm:p-3">
                    <h3 className="text-sm font-semibold tracking-wide flex items-center gap-2 border-b pb-2 text-orange-600 dark:text-orange-400"><MapPin className="h-4 w-4" /> Location</h3>
                    <div className="space-y-3">
                      <FormField control={form.control} name="address" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Address*</FormLabel>
                          <FormControl><Input {...field} value={field.value || ''} placeholder="House no, street, area" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm" disabled={isLoading}/></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormField control={form.control} name="city" render={({ field }) => (
                          <FormItem className="text-left">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">City*</FormLabel>
                            <FormControl><Input {...field} value={field.value || ''} placeholder="City" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm" disabled={isLoading}/></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="pincode" render={({ field }) => (
                          <FormItem className="text-left">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Pincode*</FormLabel>
                            <FormControl><Input {...field} value={field.value || ''} placeholder="Pincode" className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm" disabled={isLoading}/></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormField control={form.control} name="state" render={({ field }) => (
                          <FormItem className="text-left">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">{isStateRequired ? 'State*' : 'State'}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''} disabled={isLoading || !isStateRequired}>
                              <FormControl>
                                <SelectTrigger className="h-10 w-full min-w-0 rounded-xl text-left text-sm">
                                  <SelectValue placeholder={isStateRequired ? 'Select state' : 'Not required outside India/USA'} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="text-left">
                                {isIndiaSelected && uniqueIndianStates.map((stateItem) => (
                                  <SelectItem key={stateItem.value} value={stateItem.value}>{stateItem.label}</SelectItem>
                                ))}
                                {isUSASelected && uniqueUSAStates.map((stateItem) => (
                                  <SelectItem key={stateItem.value} value={stateItem.value}>{stateItem.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!isStateRequired && (
                              <p className="text-[10px] font-medium text-muted-foreground">State is only required when the country is India or USA.</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="country" render={({ field }) => (
                          <FormItem className="text-left">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Country*</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''} disabled={isLoading}>
                              <FormControl>
                                <SelectTrigger className="h-10 w-full min-w-0 rounded-xl text-left text-sm">
                                  <SelectValue placeholder="Select country" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="text-left">
                                {COUNTRY_CODES.map((country) => (
                                  <SelectItem key={country.code} value={country.name}>{country.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  </div>
                    </div>

                {/* Club Management Card - Optional Affiliation */}
                <div className="w-full min-w-0 space-y-2 overflow-visible rounded-2xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 p-2.5 shadow-md text-left sm:space-y-3 sm:p-3">
                  <h3 className="text-sm font-semibold tracking-wide flex items-center gap-2 border-b pb-2 text-orange-600 dark:text-orange-400">
                    <Building className="h-4 w-4" /> Club Management (Optional)
                  </h3>
                  <div className="space-y-2">
                    <FormField control={form.control} name="clubId" render={function ClubFieldRender({ field }) {
                      const activeClubFromHistory = Array.isArray((currentUserForForm as any)?.clubHistory)
                        ? (((currentUserForForm as any).clubHistory.find((entry: any) => entry?.isActive)) || (currentUserForForm as any).clubHistory[(currentUserForForm as any).clubHistory.length - 1])
                        : null;
                      const resolvedClubId = currentUserForForm?.clubId || activeClubFromHistory?.clubId || null;
                      const clubName = currentUserForForm?.clubName || activeClubFromHistory?.clubName || '';
                      const isAffiliated = !!(resolvedClubId && resolvedClubId !== NO_CLUB_SELECTED_VALUE);
                      const [clubOptions, setClubOptions] = React.useState<{ id: string; name: string }[]>([]);
                      const [isLoadingClubs, setIsLoadingClubs] = React.useState(false);
                      const [search, setSearch] = React.useState('');
                      const [dropdownOpen, setDropdownOpen] = React.useState(false);
                      const inputRef = React.useRef<HTMLInputElement>(null);
                      const dropdownRef = React.useRef<HTMLDivElement>(null);
                      React.useEffect(() => {
                        setIsLoadingClubs(true);
                        import('@/lib/actions/clubActions').then(mod => {
                          mod.getClubListAction().then(res => {
                            if (res.success) setClubOptions(res.clubs);
                            setIsLoadingClubs(false);
                          });
                        });
                      }, []);
                      React.useEffect(() => {
                        // Auto-close dropdown if search is cleared and input is not focused
                        if (search === '' && dropdownOpen && document.activeElement !== inputRef.current) {
                          setDropdownOpen(false);
                        }
                      }, [search, dropdownOpen]);
                      React.useEffect(() => {
                        if (!dropdownOpen) return;
                        function handleClick(e: MouseEvent) {
                          if (
                            inputRef.current && !inputRef.current.contains(e.target as Node) &&
                            dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
                          ) {
                            setDropdownOpen(false);
                          }
                        }
                        document.addEventListener('mousedown', handleClick);
                        return () => document.removeEventListener('mousedown', handleClick);
                      }, [dropdownOpen]);
                      const filteredClubs = search
                        ? clubOptions.filter(club => club.name.toLowerCase().includes(search.toLowerCase()))
                        : clubOptions;
                      return (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
                            Club Affiliation (Optional)
                          </FormLabel>
                          {isAffiliated ? (
                            <div className="flex items-center gap-2">
                              <Input value={clubName} disabled className="h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm font-semibold bg-muted/50" />
                              <Badge variant="outline" className="bg-green-600/10 text-green-700 border-green-200">Affiliated</Badge>
                            </div>
                          ) : (
                            <div>
                              <Input
                                ref={inputRef}
                                placeholder="Search club..."
                                value={search}
                                onChange={e => {
                                  setSearch(e.target.value);
                                  setDropdownOpen(true);
                                }}
                                className="mb-2 h-10 w-full min-w-0 rounded-xl px-3 text-left text-sm"
                                disabled={isLoading || isLoadingClubs}
                                onFocus={() => setDropdownOpen(true)}
                                autoComplete="off"
                              />
                              {dropdownOpen && (
                                <div ref={dropdownRef} className="absolute z-50 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-60 overflow-y-auto mt-1">
                                  <div className="px-3 py-2 text-xs text-muted-foreground cursor-pointer" onClick={() => { field.onChange(NO_CLUB_SELECTED_VALUE); setDropdownOpen(false); setSearch(''); }}>No Club / Not Affiliated</div>
                                  {filteredClubs.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-muted-foreground">No clubs found</div>
                                  )}
                                  {filteredClubs.map(club => (
                                    <div
                                      key={club.id}
                                      className="px-3 py-2 hover:bg-orange-100 dark:hover:bg-orange-900/50 cursor-pointer text-sm dark:text-slate-200"
                                      onClick={() => { field.onChange(club.id); setDropdownOpen(false); setSearch(club.name); }}
                                    >
                                      {club.name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <FormDescription className="text-xs text-muted-foreground mt-1">
                            {isAffiliated
                              ? 'You are already affiliated with a club. To change your club, please visit your Athlete Dashboard.'
                              : 'You may optionally affiliate with a club. This can be changed later from your Athlete Dashboard.'}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      );
                    }} />
                  </div>
                </div>

                <div className="order-2 w-full space-y-3 pt-3 border-t text-left rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-md">
                      <h3 className="text-base font-semibold tracking-wide text-orange-600 dark:text-orange-400">Waiver & Undertaking</h3>
                      <div className="space-y-3">
                      <FormField control={form.control} name="digitalSignatureName" render={({ field }) => (
                        <FormItem className="max-w-md text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Digital Signature (Type Full Name)*</FormLabel>
                          <FormControl><Input {...field} value={field.value || ''} placeholder="Type your name to sign" className="rounded-xl h-12 font-bold text-lg text-left" disabled={isLoading}/></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="space-y-3 pt-2 text-left">
                        <FormField control={form.control} name="agreedRules" render={({ field }) => (
                          <FormItem className="flex items-start space-x-3 text-left">
                            <FormControl><Checkbox id="agreedRules" checked={!!field.value} onCheckedChange={field.onChange} disabled={isLoading} /></FormControl>
                            <div className="leading-none text-left">
                              <label htmlFor="agreedRules" className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-tight cursor-pointer text-left">
                                I agree to the 
                                <Dialog>
                                  <DialogTrigger asChild><span className="text-orange-600 underline font-bold ml-1">Rules & Regulations*</span></DialogTrigger>
                                  <DialogContent className="max-w-2xl flex flex-col h-[80vh] p-0 overflow-hidden text-left">
                                    <DialogHeader className="p-6 border-b text-left"><DialogTitle className="text-2xl font-black uppercase tracking-tighter italic text-left">Rules & Regulations</DialogTitle></DialogHeader>
                                    <ScrollArea className="flex-1 p-6 text-left">
                                      <div className="text-sm text-muted-foreground text-left" dangerouslySetInnerHTML={{ __html: rulesAndRegulationsText }} />
                                    </ScrollArea>
                                    <DialogFooter className="p-4 border-t text-left">
                                        <DialogClose asChild><Button className="w-full h-12 rounded-xl font-black uppercase tracking-widest">I Understand</Button></DialogClose>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              </label>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="agreedWaiver" render={({ field }) => (
                          <FormItem className="flex items-start space-x-3 text-left">
                              <FormControl><Checkbox id="agreedWaiver" checked={!!field.value} onCheckedChange={field.onChange} disabled={isLoading} /></FormControl>
                              <div className="leading-none text-left">
                                  <label htmlFor="agreedWaiver" className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-tight cursor-pointer text-left">
                                    I agree to the 
                                    <Dialog open={isWaiverOpen} onOpenChange={setIsWaiverOpen}>
                                      <DialogTrigger asChild><span className="text-orange-600 underline font-bold ml-1">Event Waiver*</span></DialogTrigger>
                                      <DialogContent className="max-w-2xl flex flex-col h-[80vh] p-0 overflow-hidden text-left">
                                        <DialogHeader className="p-6 border-b text-left">
                                          <DialogTitle className="text-2xl font-black uppercase tracking-tighter italic text-left">Indemnity Cum Waiver</DialogTitle>
                                        </DialogHeader>
                                        <ScrollArea className="flex-1 p-6 text-left leading-relaxed">
                                          <div className="text-sm text-muted-foreground text-left" dangerouslySetInnerHTML={{ __html: getPopulatedWaiverText().replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                                        </ScrollArea>
                                        <DialogFooter className="p-4 border-t text-left">
                                          <DialogClose asChild><Button className="w-full h-12 rounded-xl font-black uppercase tracking-widest">I Solemnly Agree</Button></DialogClose>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>
                                  </label>
                                  <FormMessage />
                              </div>
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="agreedCutoff" render={({ field }) => (
                          <FormItem className="flex items-start space-x-3 text-left">
                            <FormControl><Checkbox id="agreedCutoff" checked={!!field.value} onCheckedChange={field.onChange} disabled={isLoading} /></FormControl>
                            <div className="leading-none text-left">
                              <label htmlFor="agreedCutoff" className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-tight cursor-pointer text-left">
                                I accept the 
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <span className="text-orange-600 underline font-bold ml-1">Cut-off Timings*</span>
                                  </DialogTrigger>
                                  <DialogContent className="sm:max-w-xl text-center flex flex-col h-[80vh] p-0 overflow-hidden text-left">
                                    <DialogHeader className="p-6 pb-2 text-center flex-shrink-0 text-left">
                                      <DialogTitle className="text-2xl md:text-3xl text-center text-foreground font-black uppercase italic tracking-tighter text-left">RACE CUT-OFF TIMINGS</DialogTitle>
                                      <DialogDescription className="pt-2 text-center mx-auto max-w-sm text-left">
                                        Official cut-offs for {activeTicket?.ticketName || 'the selected category'}.
                                      </DialogDescription>
                                    </DialogHeader>
                                    <ScrollArea className="flex-1 px-6 overflow-y-auto text-left">
                                      <div className="py-6 text-left">
                                        {activeTicket ? (
                                          <div className="space-y-4 text-left">
                                            {activeTicket.ticketCategory === 'Swimming' ? (
                                              <div className="space-y-3">
                                                {activeTicket.subCategories?.map(sub => (
                                                  <div key={sub.id} className="flex justify-between items-center p-4 border rounded-xl bg-sky-50/50">
                                                    <span className="font-black uppercase text-sky-800">{sub.name}</span>
                                                    <Badge variant="outline" className="font-mono text-base h-8 rounded-full px-4 border-sky-200 text-sky-700 bg-white shadow-sm">
                                                      {sub.cutoff || 'No Cut-off'}
                                                    </Badge>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="space-y-4">
                                                {activeTicket.cutoffs?.mode === 'overall' && activeTicket.cutoffs.overall ? (
                                                  <div className="flex justify-between items-center p-5 border rounded-2xl bg-primary/5 border-primary/20">
                                                    <span className="font-black uppercase text-primary flex items-center gap-2">
                                                      <Flag className="h-4 w-4" /> Final Race Finish
                                                    </span>
                                                    <Badge className="font-mono text-xl h-10 bg-primary px-6 rounded-full shadow-lg">
                                                      {activeTicket.cutoffs.overall}
                                                    </Badge>
                                                  </div>
                                                ) : activeTicket.cutoffs?.mode === 'segment' ? (
                                                  <div className="space-y-3">
                                                    {isDuathlonEvent(activeTicket.ticketName) ? (
                                                      <>
                                                        <div className="flex justify-between items-center p-4 border rounded-xl bg-muted/20">
                                                          <span className="font-bold text-muted-foreground uppercase text-xs">Run 1 Cut-off</span>
                                                          <Badge variant="outline" className="font-mono text-base h-9 bg-background px-4">{activeTicket.cutoffs.run1 || 'N/A'}</Badge>
                                                        </div>
                                                        <div className="flex justify-between items-center p-4 border rounded-xl bg-muted/20">
                                                          <span className="font-bold text-muted-foreground uppercase text-xs">Bike Finish (cum.)</span>
                                                          <Badge variant="outline" className="font-mono text-base h-9 bg-background px-4">{activeTicket.cutoffs.bike || 'N/A'}</Badge>
                                                        </div>
                                                        <div className="flex justify-between items-center p-5 border-2 rounded-2xl bg-primary/5 border-primary/20">
                                                          <span className="font-black uppercase text-primary flex items-center gap-2">
                                                            <Flag className="h-4 w-4" /> Final Race Finish
                                                          </span>
                                                          <Badge className="font-mono text-xl h-10 bg-primary px-6 rounded-full shadow-lg">{activeTicket.cutoffs.run2 || 'N/A'}</Badge>
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <div className="flex justify-between items-center p-4 border rounded-xl bg-muted/20">
                                                          <span className="font-bold text-muted-foreground uppercase text-xs">Swim Finish</span>
                                                          <Badge variant="outline" className="font-mono text-base h-9 bg-background px-4">{activeTicket.cutoffs.swim || 'N/A'}</Badge>
                                                        </div>
                                                        <div className="flex justify-between items-center p-4 border rounded-xl bg-muted/20">
                                                          <span className="font-bold text-muted-foreground uppercase text-xs">Bike Finish (cum.)</span>
                                                          <Badge variant="outline" className="font-mono text-base h-9 bg-background px-4">{activeTicket.cutoffs.bike || 'N/A'}</Badge>
                                                        </div>
                                                        <div className="flex justify-between items-center p-5 border-2 rounded-2xl bg-primary/5 border-primary/20">
                                                          <span className="font-black uppercase text-primary flex items-center gap-2">
                                                            <Flag className="h-4 w-4" /> Overall Finish
                                                          </span>
                                                          <Badge className="font-mono text-xl h-10 bg-primary px-6 rounded-full shadow-lg">{activeTicket.cutoffs.run || 'N/A'}</Badge>
                                                        </div>
                                                      </>
                                                    )}
                                                  </div>
                                                ) : (
                                                  <p className="text-center italic text-muted-foreground">Standard race rules apply. No specific intermediate cut-offs defined.</p>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="text-center py-10 space-y-4">
                                            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto" />
                                            <p className="font-bold text-left">Please select a race category first to view its specific cut-off timings.</p>
                                          </div>
                                        )}
                                      </div>
                                    </ScrollArea>
                                    <DialogFooter className="p-4 border-t flex-shrink-0">
                                      <DialogClose asChild><Button className="w-full h-12 rounded-xl font-black uppercase tracking-widest">I Understand & Accept</Button></DialogClose>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              </label>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )} />
                        <FormItem className="flex items-start space-x-3 text-left">
                          <FormControl>
                            <Checkbox
                              id="agreedPolicyChangeFlow"
                              checked={agreedPolicyChangeFlow}
                              onCheckedChange={(v) => setAgreedPolicyChangeFlow(v === true)}
                              disabled={isLoading}
                            />
                          </FormControl>
                          <div className="leading-none text-left">
                            <label htmlFor="agreedPolicyChangeFlow" className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-tight cursor-pointer text-left">
                              I agree to
                              <Dialog open={isPolicyOpen} onOpenChange={setIsPolicyOpen}>
                                <DialogTrigger asChild>
                                  <span className="text-orange-600 underline font-bold ml-1">Cancellation / Category change / Deferral policy*</span>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl flex flex-col h-[80vh] p-0 overflow-hidden text-left">
                                  <DialogHeader className="p-6 border-b text-left">
                                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter italic text-left">Cancellation / Category Change / Deferral Policy</DialogTitle>
                                  </DialogHeader>
                                  <ScrollArea className="flex-1 p-6 text-left">
                                    <div
                                      className="text-sm text-muted-foreground text-left [&_a]:inline-flex [&_a]:items-center [&_a]:justify-center [&_a]:rounded-xl [&_a]:bg-gradient-to-r [&_a]:from-orange-500 [&_a]:to-red-500 [&_a]:px-4 [&_a]:py-2.5 [&_a]:font-black [&_a]:uppercase [&_a]:tracking-wider [&_a]:text-white [&_a]:no-underline [&_a]:shadow-md [&_a]:transition-all hover:[&_a]:-translate-y-0.5 hover:[&_a]:shadow-lg"
                                      dangerouslySetInnerHTML={{ __html: policyContentHtml }}
                                    />
                                  </ScrollArea>
                                  <DialogFooter className="p-4 border-t text-left">
                                    <DialogClose asChild>
                                      <Button className="w-full h-12 rounded-xl font-black uppercase tracking-widest">I Understand</Button>
                                    </DialogClose>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </label>
                          </div>
                        </FormItem>
                        <FormField control={form.control} name="consentPromotions" render={({ field }) => (
                          <FormItem className="flex items-start space-x-3 text-left">
                            <FormControl><Checkbox id="consentPromotions" checked={!!field.value} onCheckedChange={field.onChange} disabled={isLoading} /></FormControl>
                            <div className="leading-none text-left">
                              <label htmlFor="consentPromotions" className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-tight cursor-pointer text-left">
                                I would like to receive updates, notifications & promotions from this event organizer via Email and WhatsApp*
                              </label>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )} />
                      </div>
                      </div>
                    </div>

                    {formMode === 'public' && feeDetails && (
                        <div className="order-3 w-full space-y-3 pt-3 border-t border-dashed text-left rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-md overflow-visible">
                          <h3 className="text-base font-semibold tracking-wide text-orange-600 dark:text-orange-400">Fee Summary</h3>
                          <div className="space-y-3">
                           <div className="max-w-full overflow-x-auto">
                             <div className="min-w-[320px] space-y-2 rounded-2xl border bg-muted/20 p-4 sm:p-6 text-left text-xs shadow-inner">
                                <div className="flex justify-between font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-left"><span>Base Price</span><span>{formatEventCurrency(feeDetails.basePricePaisa)}</span></div>
                              {performanceReward && performanceReward.discountPercent > 0 && !appliedCoupon && !deferralDetails && (
                                  <div className="flex justify-between text-primary font-black uppercase tracking-widest text-left">
                                      <span>Performance Reward ({performanceReward.unlockedTier})</span>
                                    <span>- {formatEventCurrency(Math.round(((feeDetails.basePricePaisa - feeDetails.deferralCreditPaisa) * performanceReward.discountPercent) / 100))}</span>
                                  </div>
                              )}
                                {appliedCoupon && (feeDetails.couponDiscountPaisa > 0) && <div className="flex justify-between text-green-600 font-black uppercase tracking-widest text-left"><span>Coupon ({appliedCoupon.code})</span><span>- {formatEventCurrency(feeDetails.couponDiscountPaisa)}</span></div>}
                                {feeDetails.deferralCreditPaisa > 0 && <div className="flex justify-between text-green-600 font-black uppercase tracking-widest text-left"><span>Deferral Credit</span><span>- {formatEventCurrency(feeDetails.deferralCreditPaisa)}</span></div>}
                              <Separator className="bg-border/50 my-3" />
                                <div className="flex justify-between font-black text-foreground uppercase tracking-widest text-sm text-left"><span>Subtotal</span><span>{formatEventCurrency(feeDetails.eventBasePaisa)}</span></div>
                                {taxEnabledForSelection && (
                                  <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pl-4 text-left"><span>+ {taxLabel} ({effectiveTaxPercent}%)</span><span>{formatEventCurrency(feeDetails.eventGstPaisa)}</span></div>
                                )}
                                {(feeDetails.platformFeeBasePaisa > 0 || feeDetails.platformGST > 0) && (
                                  <>
                                    <div className="flex justify-between pt-2 font-black uppercase tracking-widest text-xs text-left"><span>Platform Fee</span><span>{formatEventCurrency(feeDetails.platformFeeBasePaisa)}</span></div>
                                    {taxEnabledForSelection && (
                                      <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pl-4 text-left"><span>+ {taxLabel} ({effectiveTaxPercent}%)</span><span>{formatEventCurrency(feeDetails.platformGST)}</span></div>
                                    )}
                                  </>
                                )}
                                <div className="flex justify-between pt-2 font-black uppercase tracking-widest text-xs text-left"><span>Processing Fee ({PAYMENT_GATEWAY_FEE_PERCENTAGE}%)</span><span>{formatEventCurrency(feeDetails.processingFeeBasePaisa)}</span></div>
                                {taxEnabledForSelection && (
                                  <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pl-4 text-left"><span>+ {taxLabel} ({effectiveTaxPercent}%)</span><span>{formatEventCurrency(feeDetails.processingGST)}</span></div>
                                )}
                              {feeDetails.roundingAdjustmentPaisa !== 0 && (
                                  <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pt-2 text-left">
                                      <span>Rounding Adjustment</span>
                                    <span>{feeDetails.roundingAdjustmentPaisa > 0 ? '+' : ''}{formatEventCurrency(feeDetails.roundingAdjustmentPaisa)}</span>
                                  </div>
                              )}
                                <div className="mt-4 flex justify-between border-t-2 border-orange-600/20 pt-4 font-black text-2xl italic tracking-tighter text-left text-orange-600"><span>TOTAL PAYABLE</span><span>{formatEventCurrency(feeDetails.totalPayablePaisa)}</span></div>
                            </div>
                          </div>
                            <div className="flex flex-col sm:flex-row gap-2 text-left">
                              <Input placeholder="COUPON CODE" value={couponCode} onChange={e => setCouponCode(e.target.value.toUpperCase())} className="w-full rounded-xl h-12 font-black tracking-widest text-left" />
                              <Button type="button" variant="secondary" onClick={handleApplyCoupon} disabled={isApplyingCoupon} className="w-full sm:w-auto rounded-xl h-12 px-8 font-black uppercase tracking-widest">Apply</Button>
                          </div>
                          {appliedCoupon && <Button type="button" variant="link" size="sm" className="p-0 h-auto text-xs text-destructive uppercase font-black tracking-widest text-left" onClick={handleRemoveCoupon}>Remove Coupon</Button>}
                          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-2 shadow-sm md:mt-8 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
                            <Button type="submit" className="w-full h-12 text-base py-0 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold tracking-wide shadow-md text-center" disabled={isSubmitDisabled}>
                              {isLoading ? <><Loader2 className="animate-spin mr-3 h-5 w-5 sm:h-6 sm:w-6"/> Processing...</> : <><ShieldCheck className="mr-3 h-5 w-5 sm:h-6 sm:w-6"/> Proceed to Register</>}
                            </Button>
                            {renderSubmitBlockers()}
                            <p className="mt-2 text-[10px] text-muted-foreground text-center font-bold uppercase tracking-widest">Event specific policies can be found on the event&apos;s main page.</p>
                          </div>
                          </div>
                      </div>
                    )}

                {!(formMode === 'public' && feeDetails) && (
                <div className="mt-6 rounded-xl border border-slate-200 bg-white p-2 shadow-sm md:mt-8 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
                  <Button type="submit" className="w-full h-12 text-base py-0 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold tracking-wide shadow-md text-center" disabled={isSubmitDisabled}>
                    {isLoading ? <><Loader2 className="animate-spin mr-3 h-5 w-5 sm:h-6 sm:w-6"/> Processing...</> : <><ShieldCheck className="mr-3 h-5 w-5 sm:h-6 sm:w-6"/> Proceed to Register</>}
                  </Button>
                  {renderSubmitBlockers()}
                  <p className="mt-2 text-[10px] text-muted-foreground text-center font-bold uppercase tracking-widest">Event specific policies can be found on the event&apos;s main page.</p>
                </div>
                )}
              </div>
            </div>
            </ScrollArea>
            </div>
            </div>
          </div>
        )}
      </form>

      {/* ID Proof Preview Modal */}
      <Dialog open={isIdProofModalOpen} onOpenChange={setIsIdProofModalOpen}>
        <DialogContent className="max-w-2xl flex flex-col h-[85vh] p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b flex-shrink-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter">Identity Proof</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/30">
            {existingIdUrl ? (
              idProofType === 'pdf' ? (
                <iframe
                  src={proxiedIdProofUrl || existingIdUrl}
                  className="w-full h-full rounded-lg border"
                  title="ID Proof PDF"
                />
              ) : (
                <div className="relative w-full h-full">
                  <Image
                    src={proxiedIdProofUrl || existingIdUrl}
                    alt="ID Proof"
                    fill
                    sizes="100vw"
                    className="object-contain rounded-lg shadow-md"
                  />
                </div>
              )
            ) : (
              <p className="text-muted-foreground">No ID proof available.</p>
            )}
          </div>
          <DialogFooter className="p-4 border-t flex-shrink-0 flex gap-2 justify-between">
            {existingIdUrl && (
              <Button variant="outline" asChild>
                <a href={existingIdUrl} target="_blank" rel="noopener noreferrer">Open in New Tab</a>
              </Button>
            )}
            <DialogClose asChild>
              <Button className="font-bold uppercase tracking-widest">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
};
export default EventRegistrationForm;
