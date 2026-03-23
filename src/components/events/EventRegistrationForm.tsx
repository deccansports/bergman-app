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
  Award as AwardIcon, Flag, Globe
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
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE, KID_TSHIRT_SIZES, ADULT_TSHIRT_SIZES, NO_CLUB_SELECTED_VALUE, GENDERS, BLOOD_GROUPS, INDIAN_STATES } from '@/lib/constants';
import { calculateAgeGroup as calculateAgeGroupUtil, isDuathlonEvent, cn, isValidImageUrl } from '@/lib/utils';
import { createEventTicketOrderAction, submitPublicEventRegistrationAction } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { calculatePricing } from '@/lib/pricingEngine';
import { countriesByContinent } from '@/lib/countries';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';
import { Label } from '@/components/ui/label';

import { waiverTextTemplate } from '@/lib/constants/waiver';
import { rulesAndRegulationsText } from '@/lib/constants/rules';

const formatCurrency = (paisa: number | null | undefined) => {
  if (paisa === null || paisa === undefined) return '₹0.00';
  return `₹${(paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const PricingTiersList = ({ tiers, basePrice, participantsCount = 0, isSelected, showSummaryCard = true }: { tiers?: PricingTier[], basePrice: number | null | undefined, participantsCount: number, isSelected: boolean, showSummaryCard?: boolean }) => {
  const now = startOfDay(new Date());
  let activeTier: PricingTier | null = null;

  if (tiers && tiers.length > 0) {
    for (const tier of tiers) {
      const expiredDate = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
      const expiredSlots = tier.slotLimit ? participantsCount >= tier.slotLimit : false;
      if (!expiredDate && !expiredSlots) {
        activeTier = tier;
        break;
      }
    }
  }

  const currentPrice = activeTier?.pricePaisa ?? basePrice;

  return (
    <div className="space-y-4 mt-4 text-left">
      {(showSummaryCard && !isSelected) && (
        <div className="border rounded-xl p-4 text-center bg-orange-600/5 border-orange-600/10 text-left">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
            Current Price
            </p>
            <p className="text-3xl font-black italic my-1 text-orange-600 text-left">
            {formatCurrency(currentPrice)}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-tighter text-orange-600 text-left">
            {activeTier ? `${activeTier.name} ACTIVE` : "Standard Pricing"}
            </p>
        </div>
      )}

      <div className="space-y-2 text-left">
        <p className={cn("text-[10px] font-black uppercase tracking-widest text-left", isSelected ? "text-white/70" : "text-muted-foreground")}>
          Pricing Progress
        </p>
        {(tiers || []).map((tier, idx) => {
          const expiredDate = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
          const expiredSlots = tier.slotLimit ? participantsCount >= tier.slotLimit : false;
          const isClosed = expiredDate || expiredSlots;
          const isActive = activeTier?.name === tier.name;
          
          const slotsRemaining = (tier.slotLimit || 0) - participantsCount;
          const isFillingFast = isActive && slotsRemaining > 0 && slotsRemaining <= 5;

          return (
            <div
              key={idx}
              className={cn(
                "flex justify-between items-center p-3 rounded-xl border font-bold transition-all duration-300 text-sm text-left",
                (isActive ? (isSelected ? "bg-white/30 border-white/50 text-white" : "bg-orange-600/10 border-orange-600 text-orange-600") : (isSelected ? "bg-transparent border-white/10 text-white/60" : "bg-background border-transparent text-muted-foreground")),
                isClosed && "opacity-40 line-through"
              )}
            >
              <div className="text-left">
                <div className="flex items-center gap-2 font-bold text-left">
                  {isClosed ? <XCircle className="h-3.5 w-3.5" /> : isActive ? <CheckCircle2 className={cn("h-3.5 w-3.5 animate-pulse", isSelected ? "text-white" : "text-orange-600")} /> : <Clock className="h-3.5 w-3.5 opacity-50" />}
                  <span>{tier.name}</span>
                </div>
                <p className="text-[10px] uppercase mt-0.5 tracking-tighter text-left">
                  {isClosed ? "Closed" : (isActive ? (isFillingFast ? "OPEN - FILLING FAST!" : "Active — Join Now") : "")}
                </p>
              </div>
              <span className="text-sm font-black italic ml-auto">
                {formatCurrency(tier.pricePaisa)}
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
}

const EventRegistrationForm: React.FC<EventRegistrationFormProps> = ({
  eventDetails, availableTickets, onSubmitRegistrationCallback, isLoading, idProofFile, onIdProofFileChange,
  currentUserForForm, formMode = 'public', editingParticipant, deferralDetails, appliedCoupon, setAppliedCoupon,
  setSelectedTicketId: setSelectedTicketIdProp,
  registeredDates = [],
}) => {
  const { toast } = useToast();
  const autoCouponCheckRef = useRef<string | null>(null);
  const [hasShownAutoCouponToast, setHasShownAutoCouponToast] = useState(false);
  
  const [performanceReward, setPerformanceReward] = useState<{ discountPercent: number; unlockedTier?: string; pointsEarnedLastYear?: number } | null>(null);
  const [isLoadingReward, setIsLoadingReward] = useState(false);

  // Split mobile into country code and number for UI
  const [dialCode, setDialCode] = useState('+91');

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
        ticketId: editingParticipant?.ticketId || "",
        clubId: prefillData?.clubId || NO_CLUB_SELECTED_VALUE,
        billingType: 'personal' as const,
        businessName: '',
        gstin: '',
        businessAddress: '',
        businessEmail: '',
        businessMobile: '',
        businessPrimaryContactName: '',
        businessPrimaryContactEmail: '',
        businessPrimaryContactMobile: '',
        confirmGstDetails: false,
        selectedSubCategory: null as string | null,
    };
  }, [editingParticipant, currentUserForForm]);

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

  const dobValue = form.watch("dob");
  const selectedTicketId = form.watch("ticketId");
  const selectedSubCategoryId = form.watch("selectedSubCategory");
  const billingType = form.watch("billingType");
  const countryValue = form.watch("country");
  const agreedRules = form.watch("agreedRules");
  const agreedWaiver = form.watch("agreedWaiver");
  const agreedCutoff = form.watch("agreedCutoff");

  // Update dial code when country changes
  useEffect(() => {
    if (countryValue) {
        const country = COUNTRY_CODES.find(c => c.name.toLowerCase() === countryValue.toLowerCase());
        if (country) {
            setDialCode(country.dial_code);
        }
    }
  }, [countryValue]);
  
  const validAvailableTickets = useMemo(() => 
    (availableTickets || []).filter(ticket => ticket && typeof ticket.id === 'string' && ticket.id.trim() !== ''),
  [availableTickets]);

  const activeTicket = useMemo(() => 
    validAvailableTickets.find(t => t.id === selectedTicketId),
  [validAvailableTickets, selectedTicketId]);

  const hasSubCategories = useMemo(() => 
    !!(activeTicket?.subCategories && activeTicket.subCategories.length > 0),
  [activeTicket]);

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
      taxEnabled: !isUsd,
      gstRate: isUsd ? 0 : (GST_PERCENTAGE / 100),
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
  }, [eventDetails.currency]);

  useEffect(() => {
    if (currentUserForForm?.uid && eventDetails.eventDate) {
        setIsLoadingReward(true);
        const year = new Date(eventDetails.eventDate).getFullYear();
        getPerformanceRewardAction(currentUserForForm.uid, year).then(res => {
            if (res.success && res.discountPercent > 0) {
                setPerformanceReward({
                    discountPercent: res.discountPercent,
                    unlockedTier: res.unlockedTier,
                    pointsEarnedLastYear: res.pointsEarnedLastYear
                });
            }
        }).finally(() => setIsLoadingReward(false));
    }
  }, [currentUserForForm?.uid, eventDetails.eventDate]);

  const handleTicketSelectionChange = useCallback((ticketId: string | null) => {
    if (!ticketId) {
        form.setValue('ticketId', "", { shouldValidate: true });
        setFeeDetails(null);
        return;
    }
    form.setValue('ticketId', ticketId, { shouldValidate: true });
    form.setValue('selectedSubCategory', null);
    setSelectedTicketIdProp(ticketId);
    
    const ticket = validAvailableTickets?.find(t => t.id === ticketId);
    const subCategories = ticket?.subCategories || [];
    
    if (ticket && subCategories.length === 0) {
      const priceInfo = resolveActivePrice(ticket);
      calculateFees(priceInfo.pricePaisa, deferralDetails?.estimatedOriginalBasePricePaisa || 0, appliedCoupon, performanceReward?.discountPercent || 0);
    } else { 
      setFeeDetails(null); 
    }
  }, [form, setSelectedTicketIdProp, validAvailableTickets, deferralDetails, appliedCoupon, calculateFees, resolveActivePrice, performanceReward]);

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
    if (selectedTicketId && currentUserForForm?.uid && !isAutoApplying && autoCouponCheckRef.current !== selectedTicketId) {
        autoCouponCheckRef.current = selectedTicketId;
        setIsAutoApplying(true);
        getAutoApplyCouponForUserAction(eventDetails.id, selectedTicketId, currentUserForForm.uid)
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
  }, [selectedTicketId, selectedSubCategoryId, eventDetails.id, currentUserForForm?.uid, setAppliedCoupon, toast, validAvailableTickets, deferralDetails, calculateFees, isAutoApplying, hasShownAutoCouponToast, resolveActivePrice, performanceReward]);

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
      toast({ variant: "destructive", title: "File Too Large" });
      onIdProofFileChange(null);
    } else {
      onIdProofFileChange(file);
    }
  };

  const onInvalidSubmit = (errors: FieldErrors<PublicEventRegistrationFormInputClient>) => {
    const errorFields = Object.keys(errors).map(key => {
        const fieldName = key.replace(/([A-Z])/g, ' $1').toLowerCase();
        return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
    });
    toast({ variant: "destructive", title: "Missing Information", description: `Please check: ${errorFields.join(', ')}` });
  };

  const onSubmitWrapper = async (data: any) => {
    if (calculatedAgeGroup === 'Unknown' || !calculatedAgeGroup) {
        toast({ variant: 'destructive', title: 'Eligibility Error', description: 'Your age does not meet category requirements.' });
        return;
    }
    // Combine dial code and mobile for final submission
    const finalData = {
        ...data,
        mobile: `${dialCode}${data.mobile.replace(/\D/g, '')}`
    };
    await onSubmitRegistrationCallback(finalData, feeDetails, appliedCoupon);
  };

  const getPopulatedWaiverText = () => {
    const formData = form.getValues();
    const eventDateStr = eventDetails.eventDate ? format(parseISO(eventDetails.eventDate), 'MMMM dd, yyyy') : 'TBD';
    const registrationDate = new Date();
    const eventCategory = activeTicket?.ticketName || 'Selected Category';

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

  const isSubmitDisabled = useMemo(() => {
    return (
        isLoading || 
        !selectedTicketId || 
        (hasSubCategories && !selectedSubCategoryId) ||
        (calculatedAgeGroup === 'Unknown' || !calculatedAgeGroup) ||
        !agreedRules || !agreedWaiver || !agreedCutoff
    );
  }, [isLoading, selectedTicketId, hasSubCategories, selectedSubCategoryId, calculatedAgeGroup, agreedRules, agreedWaiver, agreedCutoff]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmitWrapper, onInvalidSubmit)} className="space-y-6 text-left">
        
        {performanceReward && performanceReward.discountPercent > 0 && (
            <div className={cn(
                "p-4 border-2 rounded-2xl animate-in zoom-in-95 duration-500 text-left",
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
                            Season {performanceReward.unlockedTier} Discount: {performanceReward.discountPercent}%
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

        <FormField control={form.control} name="ticketId" render={({ field }) => (
            <FormItem className="text-left">
              <FormLabel className="text-lg font-semibold flex items-center gap-2 text-left"><TicketIcon className="h-5 w-5 text-accent" /> Select Your Ticket*</FormLabel>
              <FormControl>
                <RadioGroup onValueChange={handleTicketSelectionChange} value={field.value || ""} className="grid grid-cols-1 gap-4 text-left">
                  {validAvailableTickets.map(ticket => {
                    const isSelected = field.value === ticket.id;
                    const count = (eventDetails.participants || []).filter((p: any) => p.ticketId === ticket.id).length;
                    const ticketDateStr = ticket.eventDate || eventDetails.eventDate;
                    const formattedTicketDate = ticketDateStr ? format(parseISO(ticketDateStr), 'PPP') : 'Date TBD';
                    const isRegisteredForDate = ticketDateStr && registeredDates.includes(ticketDateStr);

                    const priceDisplay = (() => {
                        if (ticket.ticketType === 'Free') return 'FREE';
                        if (ticket.subCategories && ticket.subCategories.length > 0) {
                            const prices = ticket.subCategories.map(s => s.pricePaisa).filter((p): p is number => typeof p === 'number');
                            if (prices.length > 0) {
                                const min = Math.min(...prices);
                                const max = Math.max(...prices);
                                if (min === max) return formatCurrency(min);
                                return `${formatCurrency(min)} - ${formatCurrency(max)}`;
                            }
                        }
                        return formatCurrency(ticket.price);
                    })();

                    return (
                      <Label key={ticket.id} className={cn(
                        "flex flex-col p-6 rounded-2xl border-2 cursor-pointer transition-all duration-300 group shadow-md text-left", 
                        isSelected ? "bg-orange-600 text-white border-orange-600 ring-2 ring-orange-600 ring-offset-2" : "bg-background border-muted hover:border-primary/30",
                        isRegisteredForDate ? "opacity-50 grayscale pointer-events-none" : ""
                      )}>
                        <div className="flex flex-col md:flex-row items-start justify-between w-full gap-4 text-left">
                          <div className="flex flex-col text-left flex-grow">
                            <div className="flex items-center gap-2 text-left">
                                <span className="font-extrabold text-xl uppercase tracking-tight text-left leading-tight">{ticket.ticketName}</span>
                                {isRegisteredForDate && <Badge variant="destructive" className="text-[10px] h-5 font-black uppercase">Registered</Badge>}
                            </div>
                            <div className={cn("flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest mt-1.5", isSelected ? "text-white/80" : "text-orange-600")}>
                                <CalendarDays className="h-3" /> {formattedTicketDate}
                            </div>
                            <div className={cn("flex items-center gap-3 text-sm font-bold uppercase tracking-widest mt-3", isSelected ? "text-white" : "text-[#64748b]")}>
                                {isDuathlonEvent(ticket.ticketName) ? (
                                    <div className="flex items-center gap-1 shrink-0 text-left">
                                        <Footprints className="h-4 w-4"/>
                                        <Bike className="h-4 w-4"/>
                                        <Footprints className="h-4 w-4"/>
                                        <span className="ml-1">{ticket.courseMaps?.run1Distance || '—'}K • {ticket.courseMaps?.bikeDistance || '—'}K • {ticket.courseMaps?.run2Distance || '—'}K</span>
                                    </div>
                                ) : (ticket.ticketCategory === 'Swimming') ? (
                                    <div className="flex items-center gap-1 shrink-0 text-left">
                                        <Waves className="h-4 w-4"/>
                                        <span className="ml-1">Multi-Distance Swim</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1 shrink-0 text-left">
                                        <Waves className="h-4 w-4"/>
                                        <Bike className="h-4 w-4"/>
                                        <Footprints className="h-4 w-4"/>
                                        <span className="ml-1">{ticket.courseMaps?.swimDistance || '—'}K • {ticket.courseMaps?.bikeDistance || '—'}K • {ticket.courseMaps?.runDistance || '—'}K</span>
                                    </div>
                                )}
                            </div>
                          </div>
                          <div className={cn("text-left md:text-right font-black text-2xl italic leading-none", isSelected ? "text-white" : "text-orange-600")}>
                            {priceDisplay}
                          </div>
                        </div>
                        <PricingTiersList tiers={ticket.tiers} basePrice={ticket.price} participantsCount={count} isSelected={isSelected} showSummaryCard={false} />
                        <RadioGroupItem value={ticket.id} id={`ticket-${ticket.id}`} className="sr-only" />
                      </Label>
                    )
                  })}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

        {hasSubCategories && (
            <FormField control={form.control} name="selectedSubCategory" render={({ field }) => (
                    <FormItem className="animate-in slide-in-from-top-2 duration-300 space-y-4 p-6 border-2 border-orange-600/20 bg-orange-600/5 rounded-2xl text-left">
                        <FormLabel className="text-sm font-black uppercase tracking-widest text-orange-600 flex items-center gap-2 text-left"><Waves className="h-4 w-4" /> Select Distance Category*</FormLabel>
                        <FormControl>
                            <RadioGroup onValueChange={handleSubCategoryChange} value={field.value || ""} className="grid grid-cols-1 gap-4 text-left">
                                {activeTicket?.subCategories?.map(sub => {
                                    const priceInfo = resolveActivePrice(sub);
                                    const isSubSelected = field.value === sub.id;
                                    const count = (eventDetails.participants || []).filter((p: any) => p.selectedSubCategory === sub.id).length;
                                    return (
                                        <Label key={sub.id} className={cn("flex flex-col p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 group shadow-sm text-left", isSubSelected ? "bg-orange-600 text-white border-orange-600 ring-2 ring-orange-600 ring-offset-2" : "bg-background border-muted hover:border-primary/30")}>
                                            <div className="flex flex-col md:flex-row items-center justify-between w-full gap-2 text-left">
                                              <div className="flex flex-col text-left w-full">
                                                  <span className="font-black uppercase text-lg italic tracking-tight text-left">{sub.name}</span>
                                                  <span className={cn("text-[10px] font-bold uppercase mt-1 tracking-widest text-left", isSubSelected ? "text-white/80" : "text-muted-foreground")}>Eligible: {Array.isArray(sub.applicableAgeGroups) ? sub.applicableAgeGroups.join(', ') : sub.applicableAgeGroups}</span>
                                              </div>
                                              <div className={cn("text-left md:text-right w-full font-black text-2xl italic leading-none", isSubSelected ? "text-white" : "text-orange-600")}>{formatCurrency(priceInfo.pricePaisa)}</div>
                                            </div>
                                            <PricingTiersList tiers={sub.tiers} basePrice={sub.pricePaisa} participantsCount={count} isSelected={isSubSelected} showSummaryCard={false} />
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

        {selectedTicketId && (
          <div className="animate-in fade-in-0 zoom-in-95 duration-500 space-y-8 text-left">
            
            <div className="space-y-3 text-left">
              <Label className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                <CreditCard className="h-4 w-4 text-orange-600" /> Invoice Billing Type*
              </Label>
              <div className="grid grid-cols-2 gap-4 text-left">
                <div 
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border-2 p-4 cursor-pointer hover:bg-muted/50 transition-all",
                    billingType === 'personal' ? "border-orange-600 bg-orange-600/5 ring-1 ring-orange-600" : "border-muted"
                  )}
                  onClick={() => form.setValue('billingType', 'personal')}
                >
                  <UserCircle className={cn("h-6 w-6 mb-2", billingType === 'personal' ? "text-orange-600" : "text-muted-foreground")} />
                  <span className="font-bold uppercase text-[10px] tracking-widest text-center">Primary Customer</span>
                </div>
                <div 
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border-2 p-4 cursor-pointer hover:bg-muted/50 transition-all",
                    billingType === 'business' ? "border-orange-600 bg-orange-600/5 ring-1 ring-orange-600" : "border-muted"
                  )}
                  onClick={() => form.setValue('billingType', 'business')}
                >
                  <Building className={cn("h-6 w-6 mb-2", billingType === 'business' ? "text-orange-600" : "text-muted-foreground")} />
                  <span className="font-bold uppercase text-[10px] tracking-widest text-center">Business (B2B)</span>
                </div>
              </div>
            </div>

            {billingType === 'business' && (
              <div className="space-y-6 p-6 border-2 border-orange-600/20 bg-orange-600/5 rounded-2xl animate-in slide-in-from-top-2 duration-300 text-left">
                <h3 className="text-sm font-black uppercase tracking-widest text-orange-600 flex items-center gap-2 border-b border-orange-600/10 pb-2 text-left">
                  <ShieldAlert className="h-4 w-4" /> Registered Business Details
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                  <FormField control={form.control} name="gstin" render={({ field }) => (
                    <FormItem className="text-left">
                      <FormLabel className="text-[10px] font-black uppercase text-orange-600 text-left">GSTIN Number*</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="15-digit GSTIN" className="rounded-xl h-11 font-mono font-bold uppercase text-left" disabled={isLoading}/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="businessName" render={({ field }) => (
                    <FormItem className="text-left">
                      <FormLabel className="text-[10px] font-black uppercase text-orange-600 text-left">Registered Company Name*</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="As per GST records" className="rounded-xl h-11 font-bold text-left" disabled={isLoading}/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="businessAddress" render={({ field }) => (
                  <FormItem className="text-left">
                    <FormLabel className="text-[10px] font-black uppercase text-orange-600 text-left">Business Registered Address*</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="Full address for invoice" className="rounded-xl h-11 text-left" disabled={isLoading}/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                
                <Separator className="bg-orange-600/10" />
                <h4 className="text-[10px] font-black uppercase tracking-widest text-orange-600 flex items-center gap-2 text-left"><Contact className="h-3 w-3"/> Business Primary Contact</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
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
                        </div>
                    </FormItem>
                )} />
              </div>
            )}

            <ScrollArea className="h-[60vh] pr-4 -mr-4 custom-scrollbar">
              <div className="space-y-4 py-4 pr-4 text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6 text-left">
                  <div className="space-y-5 text-left">
                    <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 pb-2 border-b text-left text-orange-600"><UserCircle className="h-4 w-4" /> Participant Profile</h3>
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Full Name*</FormLabel>
                        <FormControl><Input {...field} value={field.value || ""} placeholder="As per ID" className="rounded-xl h-11 font-semibold text-left" disabled={isLoading}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Email Address*</FormLabel>
                        <FormControl><Input type="email" {...field} value={field.value || ""} placeholder="you@email.com" className="rounded-xl h-11 lowercase font-semibold text-left" disabled={isLoading}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="space-y-1 text-left">
                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Mobile Number (WhatsApp)*</FormLabel>
                        <div className="flex gap-2 text-left">
                            <Select value={dialCode} onValueChange={setDialCode} disabled={isLoading}>
                                <SelectTrigger className="w-20 h-11 rounded-xl font-bold text-left bg-background px-2">
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
                                <FormItem className="flex-grow text-left">
                                    <FormControl><Input {...field} value={field.value || ""} placeholder="8390288857" className="rounded-xl h-11 font-semibold text-left" disabled={isLoading}/></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </div>
                    <FormField control={form.control} name="emergencyContactNumber" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Emergency Contact Mobile*</FormLabel>
                          <FormControl><Input type="tel" {...field} value={field.value || ''} placeholder="Emergency mobile with country code" className="rounded-xl h-11 font-semibold text-left" disabled={isLoading}/></FormControl>
                          <FormMessage />
                        </FormItem>
                    )} />
                    <div className="space-y-2 p-4 bg-muted/20 rounded-xl border border-dashed text-left">
                        <FormField control={form.control} name="dob" render={({ field }) => (
                          <FormItem className="text-left">
                            <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Date of Birth*</FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value || ""} className="rounded-xl h-11 text-left" disabled={isLoading}/></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        {calculatedAge !== null && (
                          <div className="flex items-center justify-between mt-3 px-1 text-left">
                            <div className="text-[10px] font-black uppercase text-muted-foreground text-left">Status:</div>
                            <div className="flex gap-2 text-left">
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
                    <div className="grid grid-cols-2 gap-4 text-left">
                      <FormField control={form.control} name="gender" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Gender*</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""} disabled={isLoading}>
                            <FormControl>
                              <SelectTrigger className="rounded-xl h-11 font-semibold text-left">
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
                              <SelectTrigger className="rounded-xl h-11 font-semibold text-left">
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
                              <SelectTrigger className="rounded-xl h-11 font-semibold text-left">
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
                      <Input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleIdFileChange} disabled={isLoading} className="rounded-xl h-11 font-semibold pt-2 text-left" />
                    </div>
                  </div>
                  
                  <div className="space-y-5 text-left">
                    <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 pb-2 border-b text-left text-orange-600"><MapPin className="h-4 w-4" /> Location</h3>
                    <FormField control={form.control} name="address" render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Full Address*</FormLabel><FormControl><Input {...field} value={field.value || ""} className="rounded-xl h-11 text-left" disabled={isLoading}/></FormControl><FormMessage /></FormItem>)} />
                    <div className="grid grid-cols-2 gap-4 text-left">
                      <FormField control={form.control} name="city" render={({ field }) => (<FormItem className="text-left"><FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">City*</FormLabel><FormControl><Input {...field} value={field.value || ""} className="rounded-xl h-11 text-left" disabled={isLoading}/></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="pincode" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Pincode*</FormLabel>
                          <FormControl><Input {...field} value={field.value || ""} className="rounded-xl h-11 text-left" disabled={isLoading}/></FormControl><FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-left">
                      <FormField control={form.control} name="country" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Country*</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "India"} disabled={isLoading}>
                            <FormControl>
                              <SelectTrigger className="rounded-xl h-11 font-semibold text-left">
                                <SelectValue/>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="text-left">
                              {Object.entries(countriesByContinent).map(([continent, countries]) => (
                                <SelectGroup key={continent}>
                                  <SelectLabel>{continent}</SelectLabel>
                                  {(countries as any[]).map((c: any) => (
                                    <SelectItem key={c.code} value={c.name}>{c.name}</SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      {form.watch("country") === 'India' && (
                        <FormField control={form.control} name="state" render={({ field }) => (
                          <FormItem className="text-left">
                            <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">State*</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''} disabled={isLoading}>
                              <FormControl><SelectTrigger className="rounded-xl h-11 font-semibold text-left"><SelectValue placeholder="Select"/></SelectTrigger></FormControl>
                              <SelectContent className="text-left">
                                {INDIAN_STATES.map(state => <SelectItem key={state.value} value={state.value} className="font-bold">{state.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                    </div>
                    <div className="text-left">
                        <Label className="text-[10px] font-black uppercase text-muted-foreground text-left">Affiliated Club</Label>
                        <div className="p-3 border rounded-xl bg-orange-600/5 text-sm font-black uppercase tracking-tight flex items-center justify-between border-orange-600/20 mt-2 text-left">
                          <span>{currentUserForForm?.clubName || "Unaffiliated"}</span>
                          <CheckCircle2 className="h-4 w-4 text-orange-600" />
                        </div>
                    </div>
                    <FormField control={form.control} name="previousTimingCertificateUrl" render={({ field }) => (
                      <FormItem className="text-left">
                        <FormLabel className="text-[10px] font-black uppercase text-muted-foreground text-left">Previous Timing URL (Optional)</FormLabel>
                        <FormControl><Input type="url" {...field} value={field.value || ''} className="rounded-xl h-11 font-semibold text-left" disabled={isLoading}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                {formMode === 'public' && feeDetails && (
                  <div className="space-y-4 pt-8 border-t border-dashed text-left">
                      <h3 className="text-xl font-black uppercase italic tracking-tighter text-orange-600 text-left">Fee Summary</h3>
                       <div className="text-xs space-y-2 p-6 border rounded-2xl bg-muted/20 shadow-inner text-left">
                          <div className="flex justify-between font-bold text-slate-500 uppercase tracking-widest text-left"><span>Base Price</span><span>{formatCurrency(feeDetails.basePricePaisa)}</span></div>
                          
                          {/* PERFORMANCE REWARD LINE - Mutually exclusive with coupon/deferral */}
                          {performanceReward && performanceReward.discountPercent > 0 && !appliedCoupon && !deferralDetails && (
                              <div className="flex justify-between text-primary font-black uppercase tracking-widest text-left">
                                  <span>Performance Reward ({performanceReward.unlockedTier})</span>
                                  <span>- {formatCurrency(Math.round(((feeDetails.basePricePaisa - feeDetails.deferralCreditPaisa) * performanceReward.discountPercent) / 100))}</span>
                              </div>
                          )}

                          {appliedCoupon && (feeDetails.couponDiscountPaisa > 0) && <div className="flex justify-between text-green-600 font-black uppercase tracking-widest text-left"><span>Coupon ({appliedCoupon.code})</span><span>- {formatCurrency(feeDetails.couponDiscountPaisa)}</span></div>}
                          {feeDetails.deferralCreditPaisa > 0 && <div className="flex justify-between text-green-600 font-black uppercase tracking-widest text-left"><span>Deferral Credit</span><span>- {formatCurrency(feeDetails.deferralCreditPaisa)}</span></div>}
                          
                          <Separator className="bg-border/50 my-3" />
                          <div className="flex justify-between font-black text-foreground uppercase tracking-widest text-sm text-left"><span>Subtotal</span><span>{formatCurrency(feeDetails.eventBasePaisa)}</span></div>
                          <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pl-4 text-left"><span>+ GST ({GST_PERCENTAGE}%)</span><span>{formatCurrency(feeDetails.eventGstPaisa)}</span></div>
                          <div className="flex justify-between pt-2 font-black uppercase tracking-widest text-xs text-left"><span>Platform Fee</span><span>{formatCurrency(feeDetails.platformFeeBasePaisa)}</span></div>
                          <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pl-4 text-left"><span>+ GST ({GST_PERCENTAGE}%)</span><span>{formatCurrency(feeDetails.platformGST)}</span></div>
                          <div className="flex justify-between pt-2 font-black uppercase tracking-widest text-xs text-left"><span>Processing Fee ({PAYMENT_GATEWAY_FEE_PERCENTAGE}%)</span><span>{formatCurrency(feeDetails.processingFeeBasePaisa)}</span></div>
                          <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pl-4 text-left"><span>+ GST ({GST_PERCENTAGE}%)</span><span>{formatCurrency(feeDetails.processingGST)}</span></div>
                          
                          {/* ROUNDING ADJUSTMENT LINE */}
                          {feeDetails.roundingAdjustmentPaisa !== 0 && (
                              <div className="flex justify-between text-muted-foreground font-bold uppercase tracking-widest text-[10px] pt-2 text-left">
                                  <span>Rounding Adjustment</span>
                                  <span>{feeDetails.roundingAdjustmentPaisa > 0 ? '+' : ''}{formatCurrency(feeDetails.roundingAdjustmentPaisa)}</span>
                              </div>
                          )}

                          <div className="flex justify-between font-black text-2xl text-orange-600 border-t-2 border-orange-600/20 pt-4 mt-4 italic tracking-tighter text-left"><span>TOTAL PAYABLE</span><span>{formatCurrency(feeDetails.totalPayablePaisa)}</span></div>
                      </div>
                      <div className="flex gap-2 text-left">
                          <Input placeholder="COUPON CODE" value={couponCode} onChange={e => setCouponCode(e.target.value.toUpperCase())} className="rounded-xl h-12 font-black tracking-widest text-left" />
                          <Button type="button" variant="secondary" onClick={handleApplyCoupon} disabled={isApplyingCoupon} className="rounded-xl h-12 px-8 font-black uppercase tracking-widest">Apply</Button>
                      </div>
                      {appliedCoupon && <Button type="button" variant="link" size="sm" className="p-0 h-auto text-xs text-destructive uppercase font-black tracking-widest text-left" onClick={handleRemoveCoupon}>Remove Coupon</Button>}
                  </div>
                )}
                
                <div className="space-y-4 pt-8 border-t text-left">
                  <h3 className="text-xl font-black uppercase italic tracking-tighter text-orange-600 text-left">Waiver & Undertaking</h3>
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
                          <label htmlFor="agreedRules" className="text-xs font-medium text-slate-600 leading-tight cursor-pointer text-left">
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
                              <label htmlFor="agreedWaiver" className="text-xs font-medium text-slate-600 leading-tight cursor-pointer text-left">
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
                          <label htmlFor="agreedCutoff" className="text-xs font-medium text-slate-600 leading-tight cursor-pointer text-left">
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
                    <FormField control={form.control} name="consentPromotions" render={({ field }) => (
                      <FormItem className="flex items-start space-x-3 text-left">
                        <FormControl><Checkbox id="consentPromotions" checked={!!field.value} onCheckedChange={field.onChange} disabled={isLoading} /></FormControl>
                        <div className="leading-none text-left">
                          <label htmlFor="consentPromotions" className="text-xs font-medium text-slate-600 leading-tight cursor-pointer text-left">
                            I would like to receive updates, notifications & promotions from this event organizer via Email and WhatsApp*
                          </label>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )} />
                  </div>
                </div>
                <Button type="submit" className="w-full text-xl py-8 rounded-3xl bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest shadow-xl shadow-orange-600/20 text-left" disabled={isSubmitDisabled}>
                  {isLoading ? <><Loader2 className="animate-spin mr-3 h-6 w-6"/> Processing...</> : <><ShieldCheck className="mr-3 h-6 w-6"/> Proceed to Register</>}
                </Button>
                {hasSubCategories && !selectedSubCategoryId && selectedTicketId && (
                    <p className="text-[10px] text-destructive text-center font-bold uppercase tracking-widest">Please select a specific distance category above to continue.</p>
                )}
                <p className="text-[10px] text-muted-foreground text-center font-bold uppercase tracking-widest">Event specific policies can be found on the event&apos;s main page.</p>
              </div>
            </ScrollArea>
          </div>
        )}
      </form>
    </Form>
  );
};
export default EventRegistrationForm;
