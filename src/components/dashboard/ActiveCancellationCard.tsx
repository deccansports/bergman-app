// src/components/dashboard/ActiveCancellationCard.tsx
"use client";

import React, { useState } from 'react';
import type { User } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CircleDollarSign, Clock3, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { clearActiveCancellationNoticeAction } from '@/lib/actions';
import { useAuth } from '@/context/AuthContext';

interface ActiveCancellationCardProps {
  user: User;
}

export default function ActiveCancellationCard({ user }: ActiveCancellationCardProps) {
  const { toast } = useToast();
  const { firebaseUserFromAuth, fetchUserProfile } = useAuth();
  const [isClosing, setIsClosing] = useState(false);

  const cancellation = user.activeCancellation;
  const hasAppliedCancellation = !!(
    cancellation?.cancellationId &&
    cancellation?.requestedAt &&
    cancellation?.status
  );

  if (!hasAppliedCancellation || !cancellation) return null;

  const statusColor = {
    Requested: 'outline',
    Processing: 'secondary',
    Refunded: 'default',
    Denied: 'destructive',
  } as const;

  const modeLabel = {
    manual: 'Manual Refund',
    razorpay_calculated: 'Razorpay (Calculated)',
    razorpay_custom: 'Razorpay (Custom)',
    stripe_calculated: 'Stripe (Calculated)',
    stripe_custom: 'Stripe (Custom)',
  } as const;

  const handleCloseCard = async () => {
    if (!user.uid) return;
    setIsClosing(true);
    try {
      const result = await clearActiveCancellationNoticeAction(user.uid);
      if (!result.success) {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
        return;
      }

      toast({ title: 'Dismissed', description: 'Cancellation status card hidden.' });
      if (firebaseUserFromAuth && fetchUserProfile) {
        await fetchUserProfile(firebaseUserFromAuth);
      }
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <Card className="shadow-lg border-destructive/30 bg-destructive/5">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitle className="text-xl font-bold flex items-center gap-2">
          <CircleDollarSign className="h-5 w-5 text-destructive" />
          Cancellation Refund Status
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={handleCloseCard} disabled={isClosing}>
          {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
          <span className="ml-1">Close</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Event</span>
          <span className="font-medium">{cancellation.eventName}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Status</span>
          <Badge variant={statusColor[cancellation.status] || 'outline'}>{cancellation.status}</Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Refund Amount</span>
          <span className="font-semibold">₹{((cancellation.refundedAmountPaisa ?? cancellation.expectedRefundAmountPaisa ?? 0) / 100).toFixed(2)}</span>
        </div>

        {cancellation.refundMode && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-medium">{modeLabel[cancellation.refundMode] || cancellation.refundMode}</span>
          </div>
        )}

        {cancellation.refundDestination && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Refunded To</span>
            <span className="font-medium text-right">{cancellation.refundDestination}</span>
          </div>
        )}

        {cancellation.refundInitiatedDate && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Initiated On</span>
            <span className="font-medium">{format(new Date(cancellation.refundInitiatedDate), 'dd MMM yyyy, hh:mm a')}</span>
          </div>
        )}

        {cancellation.refundTransactionId && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Refund Ref</span>
            <span className="font-mono text-xs text-right">{cancellation.refundTransactionId}</span>
          </div>
        )}

        {(cancellation.status === 'Processing' || cancellation.status === 'Refunded') && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Refunds may take 7 to 10 working days to reflect in your original payment source.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
