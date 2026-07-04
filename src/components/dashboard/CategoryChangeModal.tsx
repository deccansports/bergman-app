"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label"; 
import { Loader2, RepeatIcon, CreditCard, Info, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AthleteRegisteredEventDetail, TicketDefinition, GlobalServiceFees, PricingInput } from '@/lib/types';
import { createCategoryChangeRazorpayOrderAction, verifyCategoryChangePaymentAndProcessAction } from '@/lib/actions';
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE, CATEGORY_CHANGE_WINDOW_DAYS } from '@/lib/constants';
import { getServiceFeesAction } from '@/lib/actions/systemActions';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/card';
import { getTicketDefinitionsForEventAction } from '@/lib/actions/ticketActions';
import { calculatePricing } from '@/lib/pricingEngine';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useCountdown, CountdownTimeUnit } from '@/hooks/useCountdown';
import { subDays, format } from 'date-fns';
import { calculateAgeGroup, isTicketHidden, sanitizeMoney } from '@/lib/utils';

const isSubCategoryHidden = (subCategory: any): boolean => {
    const raw = subCategory?.isHidden ?? subCategory?.hidden ?? subCategory?.visibility ?? subCategory?.status;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw === 1;
    const normalized = String(raw ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'hidden' || normalized === 'inactive' || normalized === 'archived';
};

const formatCurrencyLocal = (paisa: number | null | undefined, currency: 'INR' | 'USD' = 'INR') => {
    if (paisa === null || paisa === undefined) return currency === 'USD' ? '$0.00' : '₹0.00';
    const locale = currency === 'USD' ? 'en-US' : 'en-IN';
    const symbol = currency === 'USD' ? '$' : '₹';
    return `${symbol}${(paisa / 100).toLocaleString(locale, { minimumFractionDigits: 2 })}`;
};

export default function CategoryChangeModal({ isOpen, onClose, eventDetail, onSuccess }: { isOpen: boolean; onClose: () => void; eventDetail: AthleteRegisteredEventDetail | null; onSuccess: () => void }) {
    const { currentUser } = useAuth();
    const { toast } = useToast();
    const [availableTickets, setAvailableTickets] = useState<TicketDefinition[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [calculationError, setCalculationError] = useState<string | null>(null);
    
    const [selectedNewTicketId, setSelectedNewTicketId] = useState<string | null>(null);
    const [selectedNewSubCategoryId, setSelectedNewSubCategoryId] = useState<string | null>(null);
    
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [calculatedFees, setCalculatedFees] = useState<any>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const eventCurrency: 'INR' | 'USD' = eventDetail?.currency === 'USD' ? 'USD' : 'INR';

    const deadlineDate = useMemo(() => {
        if (!eventDetail?.eventDate) return null;
        return subDays(new Date(eventDetail.eventDate), CATEGORY_CHANGE_WINDOW_DAYS);
    }, [eventDetail]);

    const countdown = useCountdown(deadlineDate ? format(deadlineDate, 'yyyy-MM-dd') : '');

    const activeTicket = useMemo(() => 
        availableTickets.find(t => t.id === selectedNewTicketId),
    [availableTickets, selectedNewTicketId]);

    const visibleSubCategories = useMemo(() => {
        if (!activeTicket?.subCategories?.length) return [];
        return activeTicket.subCategories.filter((s: any) => !isSubCategoryHidden(s));
    }, [activeTicket]);

    const hasSubCategories = useMemo(() => 
        visibleSubCategories.length > 0,
    [visibleSubCategories]);

    useEffect(() => {
        if (isOpen && eventDetail?.id && eventDetail.dob) {
            setIsLoading(true);
            setCalculationError(null);
            setSelectedNewTicketId(null);
            setSelectedNewSubCategoryId(null);
            setCalculatedFees(null);
            
            getTicketDefinitionsForEventAction(eventDetail.id, null)
                .then(res => {
                    if (res.success && res.ticketDefinitions) {
                        const originalTicket = eventDetail.ticketDefinitions?.find(t => t.id === eventDetail.ticketId);
                        const originalCategory = originalTicket?.ticketCategory;
                        
                        // Age filtering logic: Only show tickets the athlete is eligible for
                        const allowed = res.ticketDefinitions.filter(t => {
                            if (isTicketHidden(t)) return false;

                            // Rule 1: Must match the same discipline (Triathlon, Duathlon, etc)
                            if (t.ticketCategory !== originalCategory) return false;
                            
                            const ticketDate = t.eventDate || eventDetail.eventDate;
                            
                            // Rule 2: Check age eligibility for the main ticket
                            if (t.subCategories && t.subCategories.length > 0) {
                                const hasEligibleDistance = t.subCategories.some(sub => {
                                    if (isSubCategoryHidden(sub)) return false;
                                    const subAgeGroups = Array.isArray(sub.applicableAgeGroups) 
                                        ? sub.applicableAgeGroups 
                                        : (typeof sub.applicableAgeGroups === 'string' ? sub.applicableAgeGroups.split(',').map((ss: string) => ss.trim()) : []);
                                    
                                    const { ageCategory } = calculateAgeGroup(eventDetail.dob, eventDetail.eventName, subAgeGroups, ticketDate);
                                    return ageCategory !== 'Unknown' && !!ageCategory;
                                });
                                if (!hasEligibleDistance) return false;
                            } else {
                                const ticketAgeGroups = Array.isArray(t.applicableAgeGroups) 
                                    ? t.applicableAgeGroups 
                                    : (typeof t.applicableAgeGroups === 'string' ? t.applicableAgeGroups.split(',').map((ss: string) => ss.trim()) : []);
                                
                                const { ageCategory } = calculateAgeGroup(eventDetail.dob, eventDetail.eventName, ticketAgeGroups, ticketDate);
                                if (ageCategory === 'Unknown' || !ageCategory) return false;
                            }

                            // Rule 3: Don't exclude the current ticket IF it has multiple distances (sub-categories)
                            if (t.id === eventDetail.ticketId) {
                                return !!(t.subCategories && t.subCategories.length > 0);
                            }
                            return true;
                        });
                        setAvailableTickets(allowed);
                    } else throw new Error(res.message);
                })
                .catch(err => setCalculationError(err.message))
                .finally(() => setIsLoading(false));
        }
    }, [isOpen, eventDetail]);

    useEffect(() => {
        const ticket = activeTicket;
        if (!ticket || !eventDetail) {
            setCalculatedFees(null);
            return;
        }

        if (hasSubCategories && !selectedNewSubCategoryId) {
            setCalculatedFees(null);
            return;
        }

        if (selectedNewTicketId === eventDetail.ticketId && selectedNewSubCategoryId === eventDetail.selectedSubCategory) {
            setCalculatedFees(null);
            return;
        }

        getServiceFeesAction().then(res => {
            if (!res.success) {
                setCalculationError("Could not retrieve pricing configuration.");
                return;
            }
            const globalFees = (res.fees as GlobalServiceFees) || ({} as GlobalServiceFees);
            const categoryName = (eventDetail.ticketName || '').toUpperCase();
            const typeKey = categoryName.includes('SWIM') ? 'Swimming' : (categoryName.includes('DUATHLON') ? 'Duathlon' : 'Triathlon');
            const isUsd = eventDetail.currency === 'USD';
            const baseServiceFee = isUsd
              ? sanitizeMoney((globalFees as any)[typeKey]?.categoryChangeFeeUsdCents ?? (globalFees as any)?.categoryChangeFeeUsdCents ?? 5000)
              : sanitizeMoney((globalFees as any)[typeKey]?.categoryChangeFeePaisa ?? 200000);

                        // Use actual amount paid as the credit against the new ticket
                        const originalCredit = eventDetail.amountPaidPaisa || 0;

            let newPrice = 0;
            if (selectedNewSubCategoryId) {
                const sub = ticket.subCategories?.find(s => s.id === selectedNewSubCategoryId);
                if (sub) newPrice = sub.pricePaisa;
            } else {
                newPrice = ticket.price || 0;
            }

            const priceDiff = Math.max(0, newPrice - originalCredit);

            const pricingInput: PricingInput = {
                basePrice: baseServiceFee + priceDiff,
                gatewayRate: isUsd ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
                platformFeeBase: isUsd ? 0 : PLATFORM_FEE_PAISA,
                taxEnabled: !isUsd,
                gstRate: isUsd ? 0 : GST_PERCENTAGE / 100,
                currency: isUsd ? 'USD' : 'INR',
            };
            setCalculatedFees({ ...calculatePricing(pricingInput), serviceBase: baseServiceFee, priceDiff });
        }).catch(err => setCalculationError(err.message));
    }, [selectedNewTicketId, selectedNewSubCategoryId, hasSubCategories, activeTicket, eventDetail]);

    const handlePay = async () => {
        if (!currentUser || !eventDetail || !calculatedFees || !agreedToTerms) return;
        setIsProcessing(true);
        try {
            const ticket = activeTicket!;
            const sub = ticket.subCategories?.find(s => s.id === selectedNewSubCategoryId);
            const finalTicketName = sub ? `${ticket.ticketName} - ${sub.name}` : ticket.ticketName;

            const orderRes = await createCategoryChangeRazorpayOrderAction({
                originalEventId: eventDetail.id,
                originalParticipantId: eventDetail.participantId!,
                newTicketId: selectedNewTicketId,
                newSubCategoryId: selectedNewSubCategoryId,
                newTicketName: finalTicketName,
                totalAmountToChargePaisa: calculatedFees.totalPayable,
                athleteUid: currentUser.uid,
                athleteEmail: currentUser.email!,
                athleteName: currentUser.name!,
                originUrl: window.location.origin,
            });

            if (!orderRes.success) throw new Error(orderRes.message);

            if (orderRes.isFree) {
                toast({ title: "Category Updated", description: "Your category change has been processed successfully." });
                onSuccess();
                setIsProcessing(false);
                return;
            }

            if (orderRes.paymentGateway === 'stripe') {
                if (!orderRes.checkoutUrl) throw new Error('Stripe checkout URL is missing.');
                window.location.assign(orderRes.checkoutUrl);
                return;
            }

            const rzp = new (window as any).Razorpay({
                key: orderRes.keyId, amount: orderRes.amount, currency: orderRes.currency,
                order_id: orderRes.orderId, name: 'Bergman - Change Category',
                handler: async (resp: any) => {
                    setIsProcessing(true);
                    const verRes = await verifyCategoryChangePaymentAndProcessAction({ ...resp, ...(orderRes.notes || {}) });
                    if (verRes.success) onSuccess();
                    else toast({ variant: 'destructive', description: verRes.message });
                    setIsProcessing(false);
                },
                modal: { 
                    ondismiss: () => setIsProcessing(false),
                    escape: true,
                    backdropclose: true
                }
            });
            rzp.open();
        } catch (e: any) { toast({ variant: 'destructive', description: e.message }); setIsProcessing(false); }
    };

    if (!eventDetail) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()} modal={!isProcessing}>
            <DialogContent 
                className="sm:max-w-md text-left rounded-2xl border-none shadow-2xl p-0 overflow-hidden"
                onPointerDownOutside={(e) => { if (isProcessing) e.preventDefault(); }}
                onInteractOutside={(e) => { if (isProcessing) e.preventDefault(); }}
            >
                <DialogHeader className="px-6 pt-6 pb-2 border-b">
                    <DialogTitle className="flex items-center gap-2 text-left text-lg font-black uppercase italic tracking-tighter"><RepeatIcon className="h-5 w-5 text-purple-600"/>Change Race Category</DialogTitle>
                    <DialogDescription className="text-left text-xs font-medium">Select a new category for <strong>{eventDetail.eventName}</strong>.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] px-6 text-left">
                    <div className="space-y-4 py-4 text-left">
                        
                        {deadlineDate && countdown && !countdown.isPast && (
                            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-center">
                                <p className="text-[10px] font-black uppercase text-destructive tracking-widest mb-2 text-center leading-none">Time remaining to change:</p>
                                <div className="flex justify-center gap-3 text-destructive">
                                    <CountdownTimeUnit value={countdown.days} label="Days"/>
                                    <CountdownTimeUnit value={countdown.hours} label="Hrs"/>
                                    <CountdownTimeUnit value={countdown.minutes} label="Min"/>
                                    <CountdownTimeUnit value={countdown.seconds} label="Sec"/>
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">1. Select Main Category</Label>
                            <Select onValueChange={(v) => { setSelectedNewTicketId(v); setSelectedNewSubCategoryId(null); }} value={selectedNewTicketId || ""}>
                                <SelectTrigger className="h-10 rounded-xl font-bold text-left"><SelectValue placeholder="Choose category..."/></SelectTrigger>
                                <SelectContent className="text-left">
                                    {availableTickets.length === 0 ? (
                                        <SelectItem value="none" disabled>No age-eligible categories available</SelectItem>
                                    ) : availableTickets.map(t => (
                                        <SelectItem key={t.id} value={t.id}>
                                            {t.ticketName} {t.id === eventDetail.ticketId ? "(Current)" : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {hasSubCategories && (
                            <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">2. Select Distance/Category</Label>
                                <Select onValueChange={setSelectedNewSubCategoryId} value={selectedNewSubCategoryId || ""}>
                                    <SelectTrigger className="h-10 rounded-xl font-bold text-left"><SelectValue placeholder="Select distance..."/></SelectTrigger>
                                    <SelectContent className="text-left">
                                        {visibleSubCategories.filter(s => {
                                            if (selectedNewTicketId === eventDetail.ticketId && s.id === eventDetail.selectedSubCategory) return false;
                                            
                                            const subAgeGroups = Array.isArray(s.applicableAgeGroups) 
                                                ? s.applicableAgeGroups 
                                                : (typeof s.applicableAgeGroups === 'string' ? s.applicableAgeGroups.split(',').map((ss: string) => ss.trim()) : []);
                                            
                                            const { ageCategory } = calculateAgeGroup(eventDetail.dob, eventDetail.eventName, subAgeGroups, activeTicket?.eventDate || eventDetail.eventDate);
                                            return ageCategory !== 'Unknown' && !!ageCategory;
                                        }).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {calculatedFees ? (
                            <Card className="bg-muted/30 p-4 space-y-1 border border-border/50 shadow-inner rounded-2xl text-left">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1 text-left">Change Fee Summary</h4>
                                <div className="flex justify-between text-xs font-bold uppercase tracking-tight text-left">
                                    <span>Processing Base</span>
                                    <span>{formatCurrencyLocal(calculatedFees.serviceBase, eventCurrency)}</span>
                                </div>
                                {calculatedFees.priceDiff > 0 && (
                                    <div className="flex justify-between text-xs font-bold uppercase tracking-tight text-orange-600 text-left">
                                        <span>Ticket Upgrade</span>
                                        <span>{formatCurrencyLocal(calculatedFees.priceDiff, eventCurrency)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-[10px] text-muted-foreground text-left">
                                    <span>GST & Platform</span>
                                    <span>{formatCurrencyLocal(calculatedFees.totalPayable - calculatedFees.serviceBase - calculatedFees.priceDiff, eventCurrency)}</span>
                                </div>
                                <Separator className="my-1.5" />
                                <div className="flex justify-between font-black text-primary text-lg italic tracking-tighter pt-0.5 text-left">
                                    <span>Total Payable</span>
                                    <span>{formatCurrencyLocal(calculatedFees.totalPayable, eventCurrency)}</span>
                                </div>
                            </Card>
                        ) : (selectedNewTicketId && (!hasSubCategories || selectedNewSubCategoryId)) ? (
                            <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground text-left">
                                <Loader2 className="h-4 w-4 animate-spin text-primary"/>
                                <span className="text-[10px] font-black uppercase tracking-widest text-left">Calculating fees...</span>
                            </div>
                        ) : null}

                        <div className="p-3 bg-muted/20 border rounded-xl text-[10px] text-muted-foreground leading-relaxed text-left">
                            <ul className="list-disc pl-4 space-y-0.5 text-left font-medium">
                                <li>Lower-priced categories do not result in refunds.</li>
                                <li>A new BIB number will be assigned.</li>
                                <li>Changes are final once paid.</li>
                            </ul>
                        </div>

                        <div className="flex items-start space-x-3 pt-1 text-left">
                            <Checkbox id="cat-chg-terms" onCheckedChange={v => setAgreedToTerms(!!v)}/>
                            <label htmlFor="cat-chg-terms" className="text-[10px] text-muted-foreground font-black uppercase tracking-tight leading-tight cursor-pointer text-left">
                                I confirm the new category selection and agree to the processing fee.
                            </label>
                        </div>
                    </div>
                </ScrollArea>
                <DialogFooter className="px-6 py-4 border-t text-left">
                    <Button onClick={handlePay} disabled={!agreedToTerms || isProcessing || !calculatedFees} className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest shadow-xl shadow-primary/20 text-left">
                        {isProcessing ? <Loader2 className="animate-spin mr-3 h-5 w-5"/> : <RepeatIcon className="mr-3 h-5 w-5"/>}
                        {isProcessing ? "Awaiting Payment..." : "Process Change"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}