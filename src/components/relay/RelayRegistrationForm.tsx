'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { createRelayTeamRegistrationAction } from '@/lib/actions/relayRegistrationActions';
import { createRelayRegistrationOrderAction, verifyRelayRegistrationPaymentAndCreateAction } from '@/lib/actions/paymentActions';
import { getParticipantsForEventAction } from '@/lib/actions';
import { waiverTextTemplate } from '@/lib/constants/waiver';
import { format } from 'date-fns';
import type {
  RelayTeamRegistrationFormInput,
  RelayTeamParticipant,
  RelayRole,
  RelaySharedLegs,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { BLOOD_GROUPS, INDIAN_STATES, USA_STATES, PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE } from '@/lib/constants';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';
import { sortedCountries } from '@/lib/countries';
import { calculatePricing } from '@/lib/pricingEngine';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Users,
  User,
  Loader2,
  Upload,
  FileText,
  Tag,
  X,
} from 'lucide-react';
import { validateCouponAction } from '@/lib/actions/couponActions';
import { useToast } from '@/hooks/use-toast';

interface RelayRegistrationFormProps {
  eventId: string;
  ticketId: string;
  eventName: string;
  ticketName: string;
  ticketPrice?: number;
  ticketGstPercent?: number | null;
  eventCurrency?: 'INR' | 'USD';
  onSuccess?: (teamBib: string, relayTeamId: string) => void;
}

const SHARED_ROLES_BY_COMBO: Record<RelaySharedLegs, [RelayRole, RelayRole]> = {
  SB: ['swim', 'bike'],
  SR: ['swim', 'run'],
  BR: ['bike', 'run'],
};

const ROLE_INDEX_MAP: Record<RelayRole, number> = {
  swim: 0,
  bike: 1,
  run: 2,
};

export function RelayRegistrationForm({
  eventId,
  ticketId,
  eventName,
  ticketName,
  ticketPrice = 0,
  ticketGstPercent = null,
  eventCurrency = 'INR',
  onSuccess,
}: RelayRegistrationFormProps) {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsType, setTermsType] = useState<'rules' | 'waiver' | 'cutoff'>('rules');

  const [currentStep, setCurrentStep] = useState<'teamdetails' | 'participants'>(
    'teamdetails'
  );
  const [teamName, setTeamName] = useState('');
  const [relayComposition, setRelayComposition] = useState<'three_athletes' | 'two_athletes_one_double_leg'>('three_athletes');
  const [sharedLegs, setSharedLegs] = useState<RelaySharedLegs>('SR');
  const [participants, setParticipants] = useState<
    [RelayTeamParticipant, RelayTeamParticipant, RelayTeamParticipant]
  >([
    { role: 'swim', name: '', email: '', mobile: '' },
    { role: 'bike', name: '', email: '', mobile: '' },
    { role: 'run', name: '', email: '', mobile: '' },
  ]);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreedRules, setAgreedRules] = useState(false);
  const [agreedWaiver, setAgreedWaiver] = useState(false);
  const [agreedCutoff, setAgreedCutoff] = useState(false);
  const [consentPromotions, setConsentPromotions] = useState(false);
  const [idProofFiles, setIdProofFiles] = useState<[File | null, File | null, File | null]>([
    null,
    null,
    null,
  ]);
  const [activeParticipantIndex, setActiveParticipantIndex] = useState(0);
  // Per-participant dial codes (index 0=swim,1=bike,2=run)
  const [dialCodes, setDialCodes] = useState<[string, string, string]>(['+91', '+91', '+91']);
  const [mobileInputs, setMobileInputs] = useState<[string, string, string]>(['', '', '']);
  const [couponCode, setCouponCode] = useState('');
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountAmountPaisa?: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).Razorpay) return;

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  const formatRelayCurrency = useCallback((amountInMinorUnits: number | null | undefined) => {
    const amount = (amountInMinorUnits ?? 0) / 100;
    return new Intl.NumberFormat(eventCurrency === 'USD' ? 'en-US' : 'en-IN', {
      style: 'currency',
      currency: eventCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }, [eventCurrency]);

  const relayFeeBreakdown = React.useMemo(() => {
    const isUsd = eventCurrency === 'USD';
    const effectiveTaxPercent = isUsd ? 0 : (Number.isFinite(Number(ticketGstPercent)) && Number(ticketGstPercent) > 0 ? Number(ticketGstPercent) : GST_PERCENTAGE);
    const breakdown = calculatePricing({
      basePrice: ticketPrice || 0,
      discount: appliedCoupon?.discountAmountPaisa || 0,
      gatewayRate: isUsd ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
      platformFeeBase: isUsd ? 0 : PLATFORM_FEE_PAISA,
      taxEnabled: effectiveTaxPercent > 0,
      gstRate: effectiveTaxPercent > 0 ? (effectiveTaxPercent / 100) : 0,
      currency: isUsd ? 'USD' : 'INR',
    });

    return {
      effectiveTaxPercent,
      couponDiscountPaisa: appliedCoupon?.discountAmountPaisa || 0,
      eventBasePaisa: Math.max(0, (breakdown.base || 0) - (breakdown.discount || 0)),
      eventGstPaisa: breakdown.eventGST || 0,
      platformFeeBasePaisa: breakdown.platformFeeBase || 0,
      platformGSTPaisa: breakdown.platformGST || 0,
      processingFeeBasePaisa: breakdown.processingFeeBase || 0,
      processingGSTPaisa: breakdown.processingGST || 0,
      roundingAdjustmentPaisa: breakdown.roundingAdjustment || 0,
      totalPayablePaisa: breakdown.totalPayable || 0,
    };
  }, [ticketPrice, appliedCoupon, eventCurrency, ticketGstPercent]);

  const activeSharedRoles = relayComposition === 'two_athletes_one_double_leg'
    ? SHARED_ROLES_BY_COMBO[sharedLegs]
    : null;

  // Helper: set dial code for a participant index
  const setDialCode = useCallback((idx: number, code: string) => {
    setDialCodes((prev) => {
      const next = [...prev] as [string, string, string];
      next[idx] = code;
      // Mirror for shared-leg pair
      if (activeSharedRoles) {
        const [roleA, roleB] = activeSharedRoles;
        const idxA = ROLE_INDEX_MAP[roleA];
        const idxB = ROLE_INDEX_MAP[roleB];
        if (idx === idxA) next[idxB] = code;
        if (idx === idxB) next[idxA] = code;
      }
      return next;
    });
  }, [activeSharedRoles]);

  const getLocalPhoneNumber = useCallback((fullPhone: string | undefined, dialCode: string) => {
    const normalizedPhone = String(fullPhone || '').trim();
    const normalizedDialCode = String(dialCode || '').trim();

    if (!normalizedPhone) return '';
    if (normalizedDialCode && normalizedPhone.startsWith(normalizedDialCode)) {
      return normalizedPhone.slice(normalizedDialCode.length).replace(/\D/g, '');
    }

    const matchedCode = COUNTRY_CODES
      .slice()
      .sort((a, b) => b.dial_code.length - a.dial_code.length)
      .find((country) => normalizedPhone.startsWith(country.dial_code));

    if (matchedCode) {
      return normalizedPhone.slice(matchedCode.dial_code.length).replace(/\D/g, '');
    }

    return normalizedPhone.replace(/\D/g, '');
  }, []);

  useEffect(() => {
    setMobileInputs([
      getLocalPhoneNumber(participants[0]?.mobile, dialCodes[0]),
      getLocalPhoneNumber(participants[1]?.mobile, dialCodes[1]),
      getLocalPhoneNumber(participants[2]?.mobile, dialCodes[2]),
    ]);
  }, [participants, dialCodes, getLocalPhoneNumber]);

  const soloRole = activeSharedRoles
    ? (['swim', 'bike', 'run'] as RelayRole[]).find((role) => !activeSharedRoles.includes(role)) || 'bike'
    : null;

  // Pre-fill first participant with logged-in user details
  const handlePrefillFromCurrentUser = useCallback(() => {
    if (!currentUser) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'User not logged in',
      });
      return;
    }

    const payload = {
      name: currentUser.name || '',
      email: currentUser.email || '',
      mobile: currentUser.mobile || '',
      dob: currentUser.dob || '',
      gender: (currentUser.gender as 'Male' | 'Female' | 'Other') || undefined,
      bloodGroup: currentUser.bloodGroup || '',
      tshirtSize: currentUser.tshirtSize || '',
      emergencyContactNumber: currentUser.emergencyContactNumber || '',
      address: currentUser.address || '',
      city: currentUser.city || '',
      state: currentUser.state || '',
      country: currentUser.country || '',
      pincode: currentUser.pincode || '',
      idProofUrl: currentUser.idProofUrl || null,
    };

    setParticipants((prev) => {
      const next = [...prev] as [RelayTeamParticipant, RelayTeamParticipant, RelayTeamParticipant];
      const targetIndex = relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles
        ? ROLE_INDEX_MAP[activeSharedRoles[0]]
        : 0;

      next[targetIndex] = {
        ...next[targetIndex],
        ...payload,
      };

      if (relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles) {
        const mirrorIndex = ROLE_INDEX_MAP[activeSharedRoles[1]];
        next[mirrorIndex] = {
          ...next[mirrorIndex],
          ...payload,
        };
      }

      return next;
    });
    toast({
      title: 'Success',
      description: relayComposition === 'two_athletes_one_double_leg'
        ? 'Shared-legs athlete pre-filled with your profile'
        : 'Swim participant pre-filled with your profile',
    });
  }, [currentUser, toast, relayComposition, activeSharedRoles]);

  // Copy participant 1 details to participant 2
  const handleCopyToOthers = useCallback((fromIndex: number, toIndex: number) => {
    setParticipants((prev) => {
      const next = [...prev] as [RelayTeamParticipant, RelayTeamParticipant, RelayTeamParticipant];
      const source = prev[fromIndex];
      next[toIndex] = {
        ...source,
        role: prev[toIndex].role,
        email: prev[toIndex].email || '',
        mobile: prev[toIndex].mobile || '',
      };
      return next;
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    toast({
      title: 'Success',
      description: `Details copied to ${['Swim', 'Bike', 'Run'][toIndex]} participant. Email and mobile were not copied.`,
    });
  }, [toast]);

  const handleParticipantChange = useCallback(
    (index: number, field: keyof RelayTeamParticipant, value: any) => {
      setParticipants((prev) => {
        const next = [...prev] as [RelayTeamParticipant, RelayTeamParticipant, RelayTeamParticipant];
        next[index] = {
          ...next[index],
          [field]: value,
        };

        if (relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles) {
          const [roleA, roleB] = activeSharedRoles;
          const idxA = ROLE_INDEX_MAP[roleA];
          const idxB = ROLE_INDEX_MAP[roleB];
          if (index === idxA || index === idxB) {
            const source = next[index];
            const targetIdx = index === idxA ? idxB : idxA;
            next[targetIdx] = {
              ...next[targetIdx],
              name: source.name,
              email: source.email,
              mobile: source.mobile,
              dob: source.dob,
              gender: source.gender,
              bloodGroup: source.bloodGroup,
              tshirtSize: source.tshirtSize,
              emergencyContactNumber: source.emergencyContactNumber,
              address: source.address,
              city: source.city,
              state: source.state,
              country: source.country,
              pincode: source.pincode,
              idProofUrl: source.idProofUrl,
            };
          }
        }

        return next;
      });
    },
    [relayComposition, activeSharedRoles]
  );

  const handleApplyCoupon = useCallback(async () => {
    if (!couponCode.trim()) return;
    setIsApplyingCoupon(true);
    try {
      const result = await validateCouponAction(
        couponCode.trim().toUpperCase(),
        eventId,
        ticketId,
        currentUser?.uid
      );
      if (result.success && result.coupon) {
        setAppliedCoupon({ code: result.coupon.code, discountAmountPaisa: result.discountAmountPaisa });
        setCouponCode('');
        toast({ title: 'Coupon Applied!', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'Invalid Coupon', description: result.message });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'Failed to apply coupon' });
    } finally {
      setIsApplyingCoupon(false);
    }
  }, [couponCode, eventId, ticketId, currentUser?.uid, toast]);

  const handleRemoveCoupon = useCallback(() => {
    setAppliedCoupon(null);
    setCouponCode('');
    toast({ title: 'Coupon Removed' });
  }, [toast]);

  const handleSubmit = useCallback(async () => {
    if (!teamName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Team name is required',
      });
      return;
    }

    const loggedInEmail = (currentUser?.email || '').trim().toLowerCase();
    const primaryTypedEmail = (participants[0]?.email || '').trim().toLowerCase();
    if (loggedInEmail && primaryTypedEmail && loggedInEmail !== primaryTypedEmail) {
      toast({
        variant: 'destructive',
        title: 'Email mismatch',
        description: 'Logged in email and typed email did not match.',
      });
      return;
    }

    // Basic validation
    const allFilled = participants.every((p) => p.name && p.email && p.dob && p.gender);
    if (!allFilled) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'All participant fields are required',
      });
      return;
    }

    const normalizedEmails = participants.map((p) => (p.email || '').trim().toLowerCase());
    if (relayComposition === 'three_athletes' && new Set(normalizedEmails).size !== normalizedEmails.length) {
      toast({
        variant: 'destructive',
        title: 'Duplicate Email',
        description: 'Each relay participant must have a different email address.',
      });
      return;
    }

    if (relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles) {
      const [roleA, roleB] = activeSharedRoles;
      const a = participants[ROLE_INDEX_MAP[roleA]];
      const b = participants[ROLE_INDEX_MAP[roleB]];
      const sameEmail = (a.email || '').trim().toLowerCase() === (b.email || '').trim().toLowerCase();
      if (!sameEmail) {
        toast({
          variant: 'destructive',
          title: 'Shared athlete mismatch',
          description: `For ${sharedLegs}, both legs must use the same athlete email.`,
        });
        return;
      }
    }

    try {
      const existing = await getParticipantsForEventAction(eventId);
      if (existing.success && Array.isArray(existing.participants)) {
        const normalizedCurrentEmails = new Set(
          participants
            .map((participant) => (participant.email || '').trim().toLowerCase())
            .filter(Boolean)
        );

        const registeredEmails = new Set<string>();
        for (const record of existing.participants as any[]) {
          const status = String(record?.ticketStatus || '').toLowerCase();
          if (!['active', 'confirmed', 'pending'].includes(status)) continue;

          const directEmail = String(record?.email || '').trim().toLowerCase();
          if (directEmail) registeredEmails.add(directEmail);

          const relayAthletes = Array.isArray(record?.relayParticipants) ? record.relayParticipants : [];
          for (const athlete of relayAthletes) {
            const relayEmail = String(athlete?.email || '').trim().toLowerCase();
            if (relayEmail) registeredEmails.add(relayEmail);
          }
        }

        const alreadyRegistered = Array.from(normalizedCurrentEmails).find((email) => registeredEmails.has(email));
        if (alreadyRegistered) {
          toast({
            variant: 'destructive',
            title: 'Already registered',
            description: `Athlete with email ${alreadyRegistered} is already registered for this event.`,
          });
          return;
        }
      }
    } catch {
      // Non-blocking: if lookup fails, continue with normal validation path
    }

    if (!agreedRules || !agreedWaiver || !agreedCutoff) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'You must agree to rules, waiver and cut-off timings',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const participantsWithIdProof = [...participants] as [
        RelayTeamParticipant,
        RelayTeamParticipant,
        RelayTeamParticipant
      ];

      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('@/lib/firebase');

      for (let idx = 0; idx < idProofFiles.length; idx++) {
        const file = idProofFiles[idx];
        if (!file) continue;

        const role = participantsWithIdProof[idx].role;
        const ext = file.name.split('.').pop() || 'jpg';
        const safeTeamName = (teamName || 'relay-team').replace(/[^a-zA-Z0-9_-]/g, '-');
        const fileName = `relay-id-${safeTeamName}-${role}-${Date.now()}.${ext}`;
        const fileRef = ref(storage, `eventRegistrations/${eventId}/relayIdProofs/${fileName}`);

        await uploadBytes(fileRef, file);
        const uploadedUrl = await getDownloadURL(fileRef);

        participantsWithIdProof[idx] = {
          ...participantsWithIdProof[idx],
          idProofUrl: uploadedUrl,
        };
      }

      const formData: RelayTeamRegistrationFormInput = {
        eventId,
        ticketId,
        teamName,
        participants: participantsWithIdProof,
        relayConfiguration:
          relayComposition === 'two_athletes_one_double_leg'
            ? { type: relayComposition, sharedLegs }
            : { type: relayComposition },
        agreedRules,
        agreedWaiver,
        agreedCutoff,
        consentPromotions,
        couponCode: appliedCoupon?.code || null,
      };

      if (relayFeeBreakdown.totalPayablePaisa <= 0) {
        const result = await createRelayTeamRegistrationAction(
          formData,
          currentUser?.email || '',
          currentUser?.uid || '',
          currentUser?.name || '',
          {
            amountPaidPaisa: 0,
            paymentMethod: 'Free',
          }
        );

        if (!result.success) {
          toast({ variant: 'destructive', title: 'Error', description: result.message });
          return;
        }

        toast({ title: 'Success', description: 'Relay team registration created successfully.' });
        if (onSuccess && result.teamBib && result.relayTeamId) {
          onSuccess(result.teamBib, result.relayTeamId);
        }
        return;
      }

      const orderResult = await createRelayRegistrationOrderAction({
        eventId,
        ticketId,
        teamName,
        amountPaidPaisa: relayFeeBreakdown.totalPayablePaisa,
        couponCode: appliedCoupon?.code || null,
        userId: currentUser?.uid || null,
        userEmail: currentUser?.email || null,
        userName: currentUser?.name || null,
      });

      if (!orderResult.success || !orderResult.orderId) {
        toast({ variant: 'destructive', title: 'Payment Error', description: orderResult.message || 'Could not create payment order.' });
        return;
      }

      if (!(window as any).Razorpay) {
        toast({ variant: 'destructive', title: 'Gateway Error', description: 'Payment gateway not loaded. Please refresh and try again.' });
        return;
      }

      const rzp = new (window as any).Razorpay({
        key: orderResult.keyId,
        amount: orderResult.amount,
        currency: orderResult.currency,
        name: eventName,
        description: `Relay Ticket: ${ticketName}`,
        order_id: orderResult.orderId,
        notes: orderResult.notes,
        prefill: {
          name: participantsWithIdProof[0]?.name || currentUser?.name || '',
          email: participantsWithIdProof[0]?.email || currentUser?.email || '',
          contact: participantsWithIdProof[0]?.mobile || '',
        },
        theme: { color: '#2962FF' },
        handler: async (response: any) => {
          try {
            toast({ title: 'Payment Received', description: 'Processing your relay registration...' });
            const verifyResult = await verifyRelayRegistrationPaymentAndCreateAction({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              firestoreDocId: orderResult.notes?.firestoreDocId,
              formData,
              userEmail: currentUser?.email || '',
              userId: currentUser?.uid || '',
              userName: currentUser?.name || '',
            });

            if (!verifyResult.success) {
              throw new Error(verifyResult.message || 'Relay registration failed after payment.');
            }

            toast({ title: 'Registration Complete', description: verifyResult.message || 'Relay team registered successfully.' });
            if (onSuccess && verifyResult.teamBib && verifyResult.relayTeamId) {
              onSuccess(verifyResult.teamBib, verifyResult.relayTeamId);
            }
          } catch (error: any) {
            toast({ variant: 'destructive', title: 'Registration Error', description: error?.message || 'Failed to finalize relay registration after payment.' });
          } finally {
            setIsSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => {
            toast({ title: 'Payment Cancelled', description: 'Relay payment was cancelled.' });
            setIsSubmitting(false);
          },
        },
      });

      rzp.on('payment.failed', (response: any) => {
        toast({ variant: 'destructive', title: 'Payment Failed', description: response?.error?.description || 'Payment failed.' });
        setIsSubmitting(false);
      });
      rzp.open();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create relay team',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    teamName,
    participants,
    agreedRules,
    agreedWaiver,
    agreedCutoff,
    consentPromotions,
    eventId,
    ticketId,
    currentUser,
    idProofFiles,
    onSuccess,
    toast,
    relayComposition,
    sharedLegs,
    activeSharedRoles,
    appliedCoupon,
    relayFeeBreakdown.totalPayablePaisa,
    eventName,
    ticketName,
  ]);

  const roleLabels = {
    swim: '🏊 Swim',
    bike: '🚴 Bike',
    run: '🏃 Run',
  };
  const participantDisplayIndexes = useMemo(
    () =>
    relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles && soloRole
      ? [ROLE_INDEX_MAP[activeSharedRoles[0]], ROLE_INDEX_MAP[soloRole]]
      : [0, 1, 2],
    [relayComposition, activeSharedRoles, soloRole]
  );

  useEffect(() => {
    if (!participantDisplayIndexes.includes(activeParticipantIndex)) {
      setActiveParticipantIndex(participantDisplayIndexes[0] ?? 0);
    }
  }, [participantDisplayIndexes, activeParticipantIndex]);

  const activeParticipantPosition = participantDisplayIndexes.indexOf(activeParticipantIndex);

  const getPopulatedWaiverText = useCallback(() => {
    const participantNames = participantDisplayIndexes
      .map(idx => participants[idx]?.name || `Participant ${idx + 1}`)
      .filter(Boolean)
      .join(', ');
    
    let eventDateStr = 'Date not available';
    const registrationDate = new Date();
    
    return waiverTextTemplate
      .replace(/{{name}}/g, participantNames)
      .replace(/{{eventname}}/g, eventName || 'the event')
      .replace(/{{category}}/g, ticketName || 'Relay')
      .replace(/{{eventdate}}/g, eventDateStr)
      .replace(/{{address}}/g, 'N/A')
      .replace(/{{phone}}/g, 'N/A')
      .replace(/{{email}}/g, 'N/A')
      .replace(/{{emergency_number}}/g, 'N/A')
      .replace(/{{signature}}/g, participantNames)
      .replace(/{{day}}/g, format(registrationDate, 'do'))
      .replace(/{{date}}/g, format(registrationDate, 'MMMM, yyyy'))
      .replace(/{{organizer_name}}/g, 'Deccan Sports Club')
      .replace(/{{company_description}}/g, '')
      .replace(/{{organizer_address}}/g, '')
      .replace(/{{country}}/g, 'India');
  }, [participantDisplayIndexes, participants, eventName, ticketName]);

  const getParticipantHeading = (idx: number) => {
    const role = participants[idx]?.role as RelayRole;
    if (relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles && activeSharedRoles.includes(role)) {
      return `👤 Shared Athlete (${activeSharedRoles.map((r) => roleLabels[r]).join(' + ')})`;
    }
    return roleLabels[role] || 'Participant';
  };

  const bloodGroupOptions = BLOOD_GROUPS;
  const getStateOptionsForCountry = (country?: string) => {
    const normalizedCountry = (country || '').trim().toLowerCase();
    if (normalizedCountry === 'india') return INDIAN_STATES;
    if (['united states', 'united states of america', 'usa', 'us'].includes(normalizedCountry)) {
      return USA_STATES;
    }
    return null;
  };

  return (
    <Card className="shadow-lg rounded-lg overflow-hidden">
      <CardHeader className="bg-primary/5 p-6">
        <CardTitle className="text-2xl font-bold text-primary flex items-center gap-2">
          <Users className="h-7 w-7" /> Relay Team Registration
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          {eventName} • {ticketName}
        </p>
      </CardHeader>

      <CardContent className="p-6">
        <Tabs
          value={currentStep}
          onValueChange={(v) => setCurrentStep(v as any)}
          className="space-y-6"
        >
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="teamdetails">Team Details</TabsTrigger>
            <TabsTrigger value="participants">Participants</TabsTrigger>
          </TabsList>

          {/* Step 1: Team Details */}
          <TabsContent value="teamdetails" className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="teamName" className="text-base font-semibold">
                  Team Name
                </Label>
                <Input
                  id="teamName"
                  placeholder="e.g., Bergman Warriors"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="mt-2 h-10"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 flex items-center gap-2">
                  <Users className="h-4 w-4" /> How Relay Teams Work
                </h3>
                <ul className="mt-2 text-sm text-blue-800 space-y-1">
                  <li>✓ 1 Ticket = 1 Team (relay format selected below)</li>
                  <li>✓ Swim → Bike → Run sequence remains mandatory</li>
                  <li>✓ Swimmer → Transition → Cyclist → Transition → Runner</li>
                  <li>✓ Team result = combined time of all 3 legs</li>
                  <li>✓ 1 timing chip per team (passed between athletes at transitions) + 3 bibs</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-semibold">Relay Team Structure</Label>
                  <Select
                    value={relayComposition}
                    onValueChange={(v) => setRelayComposition(v as 'three_athletes' | 'two_athletes_one_double_leg')}
                  >
                    <SelectTrigger className="mt-2 h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="three_athletes">All 3 athletes are different</SelectItem>
                      <SelectItem value="two_athletes_one_double_leg">One athlete does 2 legs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-semibold">2-Leg Combination</Label>
                  <Select
                    value={sharedLegs}
                    onValueChange={(v) => setSharedLegs(v as RelaySharedLegs)}
                    disabled={relayComposition !== 'two_athletes_one_double_leg'}
                  >
                    <SelectTrigger className="mt-2 h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SR">Swim + Run (SR)</SelectItem>
                      <SelectItem value="SB">Swim + Bike (SB)</SelectItem>
                      <SelectItem value="BR">Bike + Run (BR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                {relayComposition === 'three_athletes' ? (
                  <p>🏅 Kit & medal allocation: 3 athletes = 3 kits + 3 medals.</p>
                ) : (
                  <div className="space-y-1">
                    <p>🏅 Kit & medal allocation: same athlete on 2 legs = 2 kits + 2 medals.</p>
                    <p>🔢 Bib format: shared athlete gets combined suffix (e.g. 101{sharedLegs}).</p>
                  </div>
                )}
              </div>

              <Button
                onClick={() => setCurrentStep('participants')}
                className="w-full h-11"
              >
                Next: Add Participants <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </TabsContent>

          {/* Step 2: Participants */}
          <TabsContent value="participants" className="space-y-6">
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">Participant Details</h3>
                    <p className="text-sm text-muted-foreground">Fill one participant at a time using the dropdown below.</p>
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">
                    Participant {Math.max(1, activeParticipantPosition + 1)} of {participantDisplayIndexes.length}
                  </div>
                </div>
                <Select
                  value={String(activeParticipantIndex)}
                  onValueChange={(value) => setActiveParticipantIndex(Number(value))}
                >
                  <SelectTrigger className="h-10 w-full text-left">
                    <SelectValue placeholder="Select participant" />
                  </SelectTrigger>
                  <SelectContent>
                    {participantDisplayIndexes.map((idx) => (
                      <SelectItem key={`participant-selector-${idx}`} value={String(idx)}>
                        {getParticipantHeading(idx)}
                        {participants[idx]?.name ? ` — ${participants[idx].name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {[activeParticipantIndex].map((idx) => {
                const participant = participants[idx];
                return (
                <div
                  key={idx}
                  className="border rounded-lg p-4 bg-card space-y-4"
                >
                  <div className="flex items-center justify-between border-b pb-3">
                    <h3 className="font-bold text-lg">
                      {getParticipantHeading(idx)}
                    </h3>
                    {relayComposition === 'three_athletes' && idx > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyToOthers(0, idx)}
                        className="text-xs"
                      >
                        {copied && idx === 1 ? (
                          <>
                            <Check className="h-3 w-3 mr-1" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" /> Copy from Swim
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor={`name-${idx}`} className="text-sm font-medium">
                        Name
                      </Label>
                      <Input
                        id={`name-${idx}`}
                        placeholder="Full name"
                        value={participant.name}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'name', e.target.value)
                        }
                        className="mt-1 h-9"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`email-${idx}`} className="text-sm font-medium">
                        Email
                      </Label>
                      <Input
                        id={`email-${idx}`}
                        type="email"
                        placeholder="email@example.com"
                        value={participant.email}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'email', e.target.value)
                        }
                        className="mt-1 h-9"
                      />
                        {idx === 0 && !!currentUser?.email && (
                          <p className="text-[11px] text-muted-foreground mt-1">Primary email must match your logged-in email ({currentUser.email}).</p>
                        )}
                      {relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles?.includes(participant.role) && (
                        <p className="text-[11px] text-muted-foreground mt-1">This email will be used for both shared legs.</p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm font-medium">Mobile (WhatsApp)</Label>
                      <div className="mt-1 flex gap-2">
                        <Select
                          value={dialCodes[idx]}
                          onValueChange={(v) => {
                            setDialCode(idx, v);
                            handleParticipantChange(idx, 'mobile', `${v}${mobileInputs[idx] || ''}`);
                          }}
                        >
                          <SelectTrigger className="h-9 w-[90px] shrink-0 rounded-md px-2 text-sm font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-60">
                            {COUNTRY_CODES.map((c) => (
                              <SelectItem key={c.code} value={c.dial_code}>
                                {c.dial_code} {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          id={`mobile-${idx}`}
                          type="tel"
                          placeholder="98765 43210"
                          value={mobileInputs[idx] || ''}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '');
                            setMobileInputs((prev) => {
                              const next = [...prev] as [string, string, string];
                              next[idx] = digits;
                              if (relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles?.includes(participant.role)) {
                                const mirrorRole = activeSharedRoles[0] === participant.role ? activeSharedRoles[1] : activeSharedRoles[0];
                                next[ROLE_INDEX_MAP[mirrorRole]] = digits;
                              }
                              return next;
                            });
                            handleParticipantChange(
                              idx,
                              'mobile',
                              `${dialCodes[idx]}${digits}`
                            );
                          }}
                          className="h-9 flex-1 min-w-0"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor={`dob-${idx}`} className="text-sm font-medium">
                        Date of Birth
                      </Label>
                      <Input
                        id={`dob-${idx}`}
                        type="date"
                        value={participant.dob || ''}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'dob', e.target.value)
                        }
                        className="mt-1 h-9"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`gender-${idx}`} className="text-sm font-medium">
                        Gender
                      </Label>
                      <Select
                        value={participant.gender || ''}
                        onValueChange={(v) =>
                          handleParticipantChange(
                            idx,
                            'gender',
                            v as 'Male' | 'Female' | 'Other'
                          )
                        }
                      >
                        <SelectTrigger id={`gender-${idx}`} className="mt-1 h-9">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label
                        htmlFor={`bloodgroup-${idx}`}
                        className="text-sm font-medium"
                      >
                        Blood Group
                      </Label>
                      <Select
                        value={participant.bloodGroup || ''}
                        onValueChange={(v) =>
                          handleParticipantChange(idx, 'bloodGroup', v)
                        }
                      >
                        <SelectTrigger id={`bloodgroup-${idx}`} className="mt-1 h-9">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {bloodGroupOptions.map((group) => (
                            <SelectItem key={group} value={group}>
                              {group}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor={`tshirt-${idx}`} className="text-sm font-medium">
                        T-Shirt Size (Inches)
                      </Label>
                      <Select
                        value={participant.tshirtSize || ''}
                        onValueChange={(v) =>
                          handleParticipantChange(idx, 'tshirtSize', v)
                        }
                      >
                        <SelectTrigger id={`tshirt-${idx}`} className="mt-1 h-9">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="34">34</SelectItem>
                          <SelectItem value="36">36</SelectItem>
                          <SelectItem value="38">38</SelectItem>
                          <SelectItem value="40">40</SelectItem>
                          <SelectItem value="42">42</SelectItem>
                          <SelectItem value="44">44</SelectItem>
                          <SelectItem value="46">46</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor={`emergency-${idx}`} className="text-sm font-medium">
                        Emergency Contact Number
                      </Label>
                      <Input
                        id={`emergency-${idx}`}
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={participant.emergencyContactNumber || ''}
                        onChange={(e) =>
                          handleParticipantChange(
                            idx,
                            'emergencyContactNumber',
                            e.target.value
                          )
                        }
                        className="mt-1 h-9"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <Label htmlFor={`address-${idx}`} className="text-sm font-medium">
                        Address
                      </Label>
                      <Input
                        id={`address-${idx}`}
                        placeholder="Full address"
                        value={participant.address || ''}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'address', e.target.value)
                        }
                        className="mt-1 h-9"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`city-${idx}`} className="text-sm font-medium">
                        City
                      </Label>
                      <Input
                        id={`city-${idx}`}
                        placeholder="City"
                        value={participant.city || ''}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'city', e.target.value)
                        }
                        className="mt-1 h-9"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`country-${idx}`} className="text-sm font-medium">
                        Country
                      </Label>
                      <Select
                        value={participant.country || ''}
                        onValueChange={(v) => {
                          handleParticipantChange(idx, 'country', v);
                          handleParticipantChange(idx, 'state', '');
                          // Auto-update dial code to match selected country
                          const matched = COUNTRY_CODES.find(
                            (c) => c.name.toLowerCase() === v.toLowerCase()
                          );
                          if (matched) {
                            setDialCode(idx, matched.dial_code);
                            handleParticipantChange(idx, 'mobile', `${matched.dial_code}${mobileInputs[idx] || ''}`);
                          }
                        }}
                      >
                        <SelectTrigger id={`country-${idx}`} className="mt-1 h-9">
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedCountries.map((country) => (
                            <SelectItem key={`${country.code}-${idx}`} value={country.name}>
                              {country.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor={`state-${idx}`} className="text-sm font-medium">
                        State
                      </Label>
                      {getStateOptionsForCountry(participant.country) ? (
                        <Select
                          value={participant.state || ''}
                          onValueChange={(v) => handleParticipantChange(idx, 'state', v)}
                        >
                          <SelectTrigger id={`state-${idx}`} className="mt-1 h-9">
                            <SelectValue placeholder="Select state" />
                          </SelectTrigger>
                          <SelectContent>
                            {getStateOptionsForCountry(participant.country)?.map((stateItem) => (
                              <SelectItem key={`${stateItem.value}-${idx}`} value={stateItem.name}>
                                {stateItem.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`state-${idx}`}
                          placeholder="State"
                          value={participant.state || ''}
                          onChange={(e) =>
                            handleParticipantChange(idx, 'state', e.target.value)
                          }
                          className="mt-1 h-9"
                        />
                      )}
                    </div>

                    <div>
                      <Label htmlFor={`pincode-${idx}`} className="text-sm font-medium">
                        Pincode
                      </Label>
                      <Input
                        id={`pincode-${idx}`}
                        placeholder="Pincode"
                        value={participant.pincode || ''}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'pincode', e.target.value)
                        }
                        className="mt-1 h-9"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <Label htmlFor={`idproof-${idx}`} className="text-sm font-medium">
                        ID Card / Identity Proof (JPG, PNG, PDF)
                      </Label>
                      <Input
                        id={`idproof-${idx}`}
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setIdProofFiles((prev) => {
                            const next = [...prev] as [File | null, File | null, File | null];
                            next[idx] = file;
                            if (relayComposition === 'two_athletes_one_double_leg' && activeSharedRoles?.includes(participant.role)) {
                              const mirrorRole = activeSharedRoles[0] === participant.role ? activeSharedRoles[1] : activeSharedRoles[0];
                              next[ROLE_INDEX_MAP[mirrorRole]] = file;
                            }
                            return next;
                          });
                        }}
                        className="mt-1 h-9"
                      />
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        {idProofFiles[idx] ? (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <Upload className="h-3 w-3" /> {idProofFiles[idx]?.name}
                          </span>
                        ) : participant.idProofUrl ? (
                          <a
                            href={participant.idProofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline"
                          >
                            <FileText className="h-3 w-3" /> View existing ID
                          </a>
                        ) : (
                          <span>No ID uploaded yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {idx === participantDisplayIndexes[0] && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrefillFromCurrentUser}
                      className="w-full text-xs"
                    >
                      <User className="h-3 w-3 mr-2" /> Pre-fill from my profile
                    </Button>
                  )}

                  <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setActiveParticipantIndex(participantDisplayIndexes[Math.max(0, activeParticipantPosition - 1)])}
                      disabled={activeParticipantPosition <= 0}
                      className="w-full sm:w-auto"
                    >
                      <ChevronLeft className="mr-2 h-4 w-4" /> Previous Participant
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setActiveParticipantIndex(participantDisplayIndexes[Math.min(participantDisplayIndexes.length - 1, activeParticipantPosition + 1)])}
                      disabled={activeParticipantPosition >= participantDisplayIndexes.length - 1}
                      className="w-full sm:w-auto"
                    >
                      Next Participant <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
                );
              })}

              {/* Fee Breakdown Section */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-semibold text-foreground mb-3">Amount to Pay</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Relay Team Registration ({participantDisplayIndexes.length} participants)</span>
                    <span className="font-medium">{ticketPrice > 0 ? formatRelayCurrency(ticketPrice) : 'FREE'}</span>
                  </div>
                  {relayFeeBreakdown.couponDiscountPaisa > 0 && (
                    <div className="flex justify-between text-green-600 font-medium">
                      <span>Coupon ({appliedCoupon?.code})</span>
                      <span>- {formatRelayCurrency(relayFeeBreakdown.couponDiscountPaisa)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-foreground pt-2 border-t border-slate-200">
                    <span>Subtotal</span>
                    <span>{formatRelayCurrency(relayFeeBreakdown.eventBasePaisa)}</span>
                  </div>
                  {relayFeeBreakdown.effectiveTaxPercent > 0 && (
                    <div className="flex justify-between text-muted-foreground text-xs pl-4">
                      <span>+ GST ({relayFeeBreakdown.effectiveTaxPercent}%)</span>
                      <span>{formatRelayCurrency(relayFeeBreakdown.eventGstPaisa)}</span>
                    </div>
                  )}
                  {(relayFeeBreakdown.platformFeeBasePaisa > 0 || relayFeeBreakdown.platformGSTPaisa > 0) && (
                    <>
                      <div className="flex justify-between pt-2 font-semibold text-foreground">
                        <span>Platform Fee</span>
                        <span>{formatRelayCurrency(relayFeeBreakdown.platformFeeBasePaisa)}</span>
                      </div>
                      {relayFeeBreakdown.effectiveTaxPercent > 0 && (
                        <div className="flex justify-between text-muted-foreground text-xs pl-4">
                          <span>+ GST ({relayFeeBreakdown.effectiveTaxPercent}%)</span>
                          <span>{formatRelayCurrency(relayFeeBreakdown.platformGSTPaisa)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between pt-2 font-semibold text-foreground">
                    <span>Processing Fee ({eventCurrency === 'USD' ? '3' : PAYMENT_GATEWAY_FEE_PERCENTAGE}%)</span>
                    <span>{formatRelayCurrency(relayFeeBreakdown.processingFeeBasePaisa)}</span>
                  </div>
                  {relayFeeBreakdown.effectiveTaxPercent > 0 && (
                    <div className="flex justify-between text-muted-foreground text-xs pl-4">
                      <span>+ GST ({relayFeeBreakdown.effectiveTaxPercent}%)</span>
                      <span>{formatRelayCurrency(relayFeeBreakdown.processingGSTPaisa)}</span>
                    </div>
                  )}
                  {relayFeeBreakdown.roundingAdjustmentPaisa !== 0 && (
                    <div className="flex justify-between text-muted-foreground text-xs pt-2">
                      <span>Rounding Adjustment</span>
                      <span>{relayFeeBreakdown.roundingAdjustmentPaisa > 0 ? '+' : ''}{formatRelayCurrency(relayFeeBreakdown.roundingAdjustmentPaisa)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-3 border-t-2 border-orange-600/20 font-bold text-base text-foreground">
                    <span>Total Fee:</span>
                    <span className="text-orange-600">{ticketPrice > 0 ? formatRelayCurrency(relayFeeBreakdown.totalPayablePaisa) : 'FREE'}</span>
                  </div>
                </div>
              </div>

              {/* Coupon & Payment Section */}
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Tag className="h-5 w-5 text-orange-600" />
                  <h3 className="font-semibold text-foreground">Apply Coupon Code (Optional)</h3>
                </div>
                {appliedCoupon ? (
                  <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
                      <Check className="h-4 w-4" />
                      Coupon <span className="font-black tracking-widest">{appliedCoupon.code}</span> applied
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="text-green-600 hover:text-destructive transition-colors"
                      aria-label="Remove coupon"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter coupon code"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      className="flex-1 h-10 font-semibold tracking-wider uppercase rounded-lg"
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                    />
                    <Button
                      type="button"
                      variant="default"
                      onClick={handleApplyCoupon}
                      disabled={isApplyingCoupon || !couponCode.trim()}
                      className="h-10 px-6 font-semibold uppercase rounded-lg bg-orange-600 hover:bg-orange-700"
                    >
                      {isApplyingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Agreements */}
              <div className="border-t pt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="rules"
                    checked={agreedRules}
                    onCheckedChange={(v) => setAgreedRules(v as boolean)}
                  />
                  <Label htmlFor="rules" className="text-sm font-medium cursor-pointer leading-relaxed">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => { setTermsType('rules'); setTermsModalOpen(true); }}
                      className="text-primary underline hover:no-underline"
                    >
                      Rules & Regulations
                    </button>
                  </Label>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="waiver"
                    checked={agreedWaiver}
                    onCheckedChange={(v) => setAgreedWaiver(v as boolean)}
                  />
                  <Label htmlFor="waiver" className="text-sm font-medium cursor-pointer leading-relaxed">
                    I acknowledge and agree to the{' '}
                    <button
                      type="button"
                      onClick={() => { setTermsType('waiver'); setTermsModalOpen(true); }}
                      className="text-primary underline hover:no-underline"
                    >
                      Event Waiver
                    </button>
                    {' '}on behalf of all participants:{' '}
                    <span className="font-semibold">
                      {participantDisplayIndexes
                        .map(idx => participants[idx]?.name || `Participant ${idx + 1}`)
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </Label>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="cutoff"
                    checked={agreedCutoff}
                    onCheckedChange={(v) => setAgreedCutoff(v as boolean)}
                  />
                  <Label htmlFor="cutoff" className="text-sm font-medium cursor-pointer leading-relaxed">
                    I accept the{' '}
                    <button
                      type="button"
                      onClick={() => { setTermsType('cutoff'); setTermsModalOpen(true); }}
                      className="text-primary underline hover:no-underline"
                    >
                      Cut-off Timings
                    </button>
                  </Label>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="promotions"
                    checked={consentPromotions}
                    onCheckedChange={(v) => setConsentPromotions(v as boolean)}
                  />
                  <Label
                    htmlFor="promotions"
                    className="text-sm font-medium cursor-pointer"
                  >
                    I want to receive promotional emails and updates
                  </Label>
                </div>
              </div>

              {(!agreedRules || !agreedWaiver || !agreedCutoff) && (
                <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-yellow-700">
                    You must agree to Rules, Waiver and Cut-off Timings to continue
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      <CardFooter className="p-6 bg-muted/30 border-t flex flex-col gap-4">
        <div className="flex w-full gap-3">
        <Button
          variant="outline"
          onClick={() =>
            setCurrentStep(currentStep === 'participants' ? 'teamdetails' : 'participants')
          }
          disabled={isSubmitting}
        >
          {currentStep === 'participants' ? '← Back' : 'Skip'}
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            isSubmitting || !agreedRules || !agreedWaiver || !agreedCutoff || currentStep !== 'participants'
          }
          className="flex-1"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
            </>
          ) : (
            <>
              {currentStep === 'teamdetails'
                ? 'Next: Add Participants'
                : 'Create Team & Proceed to Payment'}
            </>
          )}
        </Button>
        </div>
      </CardFooter>

      {/* Terms Modal */}
      {termsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="relative w-full max-w-2xl max-h-[80vh] bg-white rounded-lg shadow-lg overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b p-6 sticky top-0 bg-white">
              <h2 className="text-2xl font-bold text-foreground capitalize">
                {termsType === 'rules' ? 'Rules & Regulations' : termsType === 'waiver' ? 'Event Waiver' : 'Cut-off Timings'}
              </h2>
              <button
                onClick={() => setTermsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-6">
              {termsType === 'rules' && (
                <div className="prose prose-sm max-w-none text-sm text-muted-foreground space-y-3">
                  <p>Please refer to the event&apos;s official terms and conditions for complete Rules &amp; Regulations.</p>
                  <p>By agreeing, you confirm that you have read and accept all rules governing this relay event.</p>
                </div>
              )}
              {termsType === 'waiver' && (
                <div className="text-sm text-muted-foreground text-left prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: getPopulatedWaiverText().replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
              )}
              {termsType === 'cutoff' && (
                <div className="prose prose-sm max-w-none text-sm text-muted-foreground space-y-3">
                  <p>Participants must complete their respective segments within the designated cut-off times.</p>
                  <p>Failure to meet cut-off times may result in disqualification from the event.</p>
                  <p>Please check the event details for specific cut-off times for each segment.</p>
                </div>
              )}
            </div>
            <div className="border-t p-6 bg-muted/30">
              <Button
                onClick={() => setTermsModalOpen(false)}
                className="w-full rounded-lg"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
