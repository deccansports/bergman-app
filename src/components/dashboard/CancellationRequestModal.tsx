
// src/components/dashboard/CancellationRequestModal.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from "@/components/ui/checkbox";
import { Label as CheckboxLabel } from "@/components/ui/label"; // Aliasing Label to avoid conflict with FormLabel
import { Loader2, AlertTriangle, XCircle as XCircleIcon, Info, Banknote, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AthleteRegisteredEventDetail, BankDetails } from '@/lib/types';
import { processCancellationRequestAction } from '@/lib/actions/cancellationActions';
import { BankDetailsSchema } from '@/lib/schemas'; 
import { calculateRefundAmount } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';
import { subDays, format } from 'date-fns';
import { DAYS_FOR_NO_REFUND_WINDOW } from '@/lib/constants';

const cancellationPolicyText = `
**Cancellation Policy & Refund Rules (Effective October 2023):**

1.  All cancellation requests must be made via this form on the dashboard, at least 60 days (2 months) before the event date.
2.  The refund amount is based on the time remaining until the event date, calculated from the *original event registration fee paid*, excluding any GST and original processing fees.
    *   **6 Months or More Before Event:** 70% refund of the base fee.
    *   **4 to 6 Months Before Event:** 50% refund of the base fee.
    *   **3 to 4 Months Before Event:** 20% refund of the base fee.
    *   **Less than 2 Months Before Event:** No refund, and cancellation requests cannot be submitted.
3.  GST and any original internet handling/processing fees are non-refundable.
4.  Refunds, if applicable, will be processed manually to the bank account details provided by the participant. This may take 7-14 working days after approval.
5.  Cancellation Refunds can take upto 7 to 10 working days to reflect into your account.
6.  If your registration was made using a deferral/credit from a previous event, or if it's a complimentary/free entry, it is not eligible for a monetary refund through this cancellation process.
7.  For medical emergencies preventing participation within the non-refundable window, please contact info@bergmantri.com directly with supporting medical documentation.
`;

interface CancellationRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventDetail: AthleteRegisteredEventDetail | null;
  athleteUid: string | null;
  athleteEmail: string | null;
  onCancellationSuccess: () => void;
}

const CancellationRequestModal: React.FC<CancellationRequestModalProps> = ({
  isOpen,
  onClose,
  eventDetail,
  athleteUid,
  athleteEmail,
  onCancellationSuccess,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const { toast } = useToast();
  
  const deadlineDate = useMemo(() => {
    if (!eventDetail?.eventDate) return null;
    return subDays(new Date(eventDetail.eventDate), DAYS_FOR_NO_REFUND_WINDOW);
  }, [eventDetail]);

  const countdown = useCountdown(deadlineDate ? format(deadlineDate, 'yyyy-MM-dd') : '');

  const bankDetailsForm = useForm<BankDetails>({
    resolver: zodResolver(BankDetailsSchema),
    defaultValues: {
      accountHolderName: '',
      accountNumber: '',
      ifscCode: '',
      bankName: '',
      registeredMobileNumber: '',
    },
  });

  const refundDetails = useMemo(() => {
    if (!eventDetail || !eventDetail.eventDate) {
      return {
        refundAmountPaisa: 0,
        percentage: 0,
        policyApplied: 'Event details missing.',
        daysUntilEvent: Infinity,
        canCancel: false
      };
    }

    const originalBaseAmount = (() => {
      if (eventDetail.originalAmountPaidAtFirstRegistrationPaisa) {
        return eventDetail.originalAmountPaidAtFirstRegistrationPaisa;
      }

      if (!eventDetail.pricingBreakdown) return null;

      const { base = 0, discount = 0 } = eventDetail.pricingBreakdown;

      const credit = base - discount;

      return credit > 0 ? credit : null;
    })();

    return calculateRefundAmount(
      eventDetail.eventDate,
      originalBaseAmount,
      eventDetail.taxAmountPaidPaisa ?? null,
      eventDetail.processingFeePaidPaisa ?? null,
      eventDetail.platformFeePaidPaisa ?? null,
      eventDetail.registeredAt
    );
  }, [eventDetail]);

  useEffect(() => {
    if (isOpen && eventDetail) {
      bankDetailsForm.reset(); 
      setAgreedToTerms(false); // Reset checkbox on modal open
    }
  }, [isOpen, eventDetail, bankDetailsForm]);


  if (!isOpen || !eventDetail || !athleteUid || !athleteEmail) {
    return null;
  }

  const handleSubmitCancellation = async (bankData?: BankDetails) => {
    if (!eventDetail || !athleteUid || !athleteEmail) {
      toast({ variant: "destructive", title: "Error", description: "Missing critical data to process cancellation." });
      return;
    }
    if (!agreedToTerms) {
      toast({ variant: "destructive", title: "Agreement Required", description: "You must agree to the cancellation policy to proceed." });
      return;
    }

    setIsLoading(true);
    try {
      const result = await processCancellationRequestAction(
        eventDetail.id,
        eventDetail.participantId || 'unknown_participant_id', 
        athleteUid,
        athleteEmail,
        eventDetail.eventName,
        eventDetail.eventDate!, 
        eventDetail.amountPaidPaisa || 0, // Use amountPaidPaisa for the record
        bankData || null, 
        refundDetails.refundAmountPaisa,
        refundDetails.policyApplied,
        eventDetail.gstPaid || null,
        eventDetail.processingFeePaidPaisa ?? null
      );

      if (result.success) {
        toast({ title: "Cancellation Request Submitted", description: result.message, duration: 8000 });
        onCancellationSuccess();
        onClose();
      } else {
        toast({ variant: "destructive", title: "Cancellation Failed", description: result.message, duration: 8000 });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Could not submit cancellation request." });
    } finally {
      setIsLoading(false);
    }
  };

  const onFormSubmit = (data: BankDetails) => {
    handleSubmitCancellation(data);
  };

  const onConfirmNoRefund = () => {
    handleSubmitCancellation(); 
  };
  
  const renderCountdown = () => {
    if(!countdown || countdown.isPast) return null;
    return (
      <div className="mt-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
        <p className="text-xs text-center font-medium text-destructive mb-2">Time remaining to cancel:</p>
        <div className="flex justify-around items-center gap-1.5 text-center text-destructive">
          <CountdownTimeUnit value={countdown.days} label="Days" />
          <CountdownTimeUnit value={countdown.hours} label="Hours" />
          <CountdownTimeUnit value={countdown.minutes} label="Mins" />
          <CountdownTimeUnit value={countdown.seconds} label="Secs" />
        </div>
      </div>
    )
  }

  if (!refundDetails.canCancel) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> Cancellation Window Closed
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              The cancellation window for <strong>{eventDetail.eventName}</strong> is currently closed.
            </p>
            <p className="text-xs text-muted-foreground">
              Policy applied: {refundDetails.policyApplied} (Days until event: {refundDetails.daysUntilEvent}).
              Cancellations are typically allowed up to 60 days before the event.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { setAgreedToTerms(false); onClose(); } else { onClose(); } }}>
      <DialogContent className="sm:max-w-lg md:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircleIcon className="h-6 w-6" /> Request Registration Cancellation
          </DialogTitle>
          <DialogDescription>
            You are requesting to cancel your registration for: <br/>
            <strong>{eventDetail.eventName}</strong> on {eventDetail.eventDate ? new Date(eventDetail.eventDate + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Date TBD'}.
            <br />Ticket: {eventDetail.ticketName || 'N/A'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4 max-h-[65vh] overflow-y-auto pr-2 custom-scrollbar">
          {renderCountdown()}
          <Alert variant="default" className="bg-yellow-50 border-yellow-200 text-yellow-700 text-xs">
            <AlertTriangle className="h-4 w-4 !text-yellow-600" />
            <AlertTitle className="text-yellow-700 font-semibold">Please Review Carefully</AlertTitle>
            <p>Ensure all details are correct before submitting. Cancellation is final once processed.</p>
            <p className="mt-1">Original amount paid (incl. GST & fees if any): <strong>₹{((eventDetail.amountPaidPaisa || 0) / 100).toFixed(2)}</strong></p>
            <p className="font-semibold mt-1">Policy: {refundDetails.policyApplied}</p>
            <p className="font-bold text-base mt-1">Calculated Refund (Excl. GST/Fees): ₹{((refundDetails.refundAmountPaisa || 0) / 100).toFixed(2)} ({refundDetails.percentage}%)</p>
          </Alert>

          {refundDetails.refundAmountPaisa > 0 && (
            <Form {...bankDetailsForm}>
              <form onSubmit={bankDetailsForm.handleSubmit(onFormSubmit)} className="space-y-3 p-3 border rounded-md bg-muted/20">
                <h4 className="text-sm font-semibold text-foreground">Bank Account Details for Refund:</h4>
                <FormField
                  control={bankDetailsForm.control}
                  name="accountHolderName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Account Holder Name</FormLabel>
                      <Input {...field} placeholder="Full Name as per Bank Account" disabled={isLoading} className="text-xs h-9"/>
                      <FormMessage className="text-xs"/>
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankDetailsForm.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Bank Account Number</FormLabel>
                      <Input {...field} placeholder="Your Bank Account Number" disabled={isLoading} className="text-xs h-9"/>
                      <FormMessage className="text-xs"/>
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankDetailsForm.control}
                  name="ifscCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">IFSC Code</FormLabel>
                      <Input {...field} placeholder="Bank's IFSC Code" disabled={isLoading} className="text-xs h-9"/>
                      <FormMessage className="text-xs"/>
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankDetailsForm.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Bank Name</FormLabel>
                      <Input {...field} placeholder="Name of your Bank" disabled={isLoading} className="text-xs h-9"/>
                      <FormMessage className="text-xs"/>
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankDetailsForm.control}
                  name="registeredMobileNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Registered Mobile (UPI, optional)</FormLabel>
                      <Input {...field} value={field.value || ""} placeholder="Mobile linked to UPI (if any)" disabled={isLoading} className="text-xs h-9"/>
                      <FormMessage className="text-xs"/>
                    </FormItem>
                  )}
                />
                 <div className="flex items-center space-x-2 pt-2">
                    <Checkbox id="cancellation-terms-bank" checked={agreedToTerms} onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)} disabled={isLoading} />
                    <CheckboxLabel htmlFor="cancellation-terms-bank" className="text-xs cursor-pointer text-muted-foreground leading-tight">
                        I have read and agree to the Cancellation Policy & Refund Rules.
                    </CheckboxLabel>
                </div>
                <Button type="submit" className="w-full mt-3 bg-destructive hover:bg-destructive/90 text-destructive-foreground" disabled={isLoading || !agreedToTerms}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                  Confirm Cancellation & Submit Bank Details for Refund
                </Button>
              </form>
            </Form>
          )}

          {refundDetails.refundAmountPaisa <= 0 && (
            <div className="mt-4 p-3 border border-destructive/30 bg-destructive/5 rounded-md">
              <p className="text-sm text-destructive">
                Based on the cancellation policy, no monetary refund is applicable for this event at this time.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Days until event: {refundDetails.daysUntilEvent}. Policy applied: {refundDetails.policyApplied}.
              </p>
              <div className="flex items-center space-x-2 pt-3">
                <Checkbox id="cancellation-terms-no-refund" checked={agreedToTerms} onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)} disabled={isLoading} />
                <CheckboxLabel htmlFor="cancellation-terms-no-refund" className="text-xs cursor-pointer text-muted-foreground leading-tight">
                    I have read and agree to the Cancellation Policy & Refund Rules, and understand no monetary refund is due.
                </CheckboxLabel>
              </div>
              <Button type="button" className="w-full mt-3" variant="destructive" onClick={onConfirmNoRefund} disabled={isLoading || !agreedToTerms}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm Cancellation (No Refund)
              </Button>
            </div>
          )}

          <div className="p-3 bg-muted/50 border border-border rounded-md mt-3">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5 text-foreground"><ShieldAlert className="h-4 w-4 text-amber-600"/>Policy Summary:</h4>
            <div className="space-y-1 text-xs text-muted-foreground whitespace-pre-line max-h-40 overflow-y-auto pr-1 custom-scrollbar">
               {cancellationPolicyText.trim().split('\n').map((line, index) => (<p key={index}>{line}</p>))}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-end gap-2 pt-4 border-t">
          <DialogClose asChild><Button type="button" variant="outline" disabled={isLoading}>Back</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CancellationRequestModal;
