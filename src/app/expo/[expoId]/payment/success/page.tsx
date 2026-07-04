"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function ExpoPaymentSuccessPage() {
  const params = useParams<{ expoId: string }>();
  const expoId = String(params?.expoId || '').trim();
  const searchParams = useSearchParams();
  const router = useRouter();

  const bookingId = String(searchParams?.get('bookingId') || '').trim();
  const token = String(searchParams?.get('token') || '').trim();
  const sessionId = String(searchParams?.get('session_id') || '').trim();

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Confirming your payment...');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!expoId || !bookingId || !token) {
      setMessage('Missing payment reference details.');
      setLoading(false);
      return;
    }

    let active = true;
    const confirm = async () => {
      try {
        const response = await fetch(`/api/expo/${encodeURIComponent(expoId)}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId,
            reservationToken: token,
            paymentStatus: 'paid',
            invoiceStatus: 'generated',
            paymentGateway: 'stripe',
            stripeSessionId: sessionId || null,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Booking confirmation failed');

        if (!active) return;
        setSuccess(true);
        setMessage('Payment successful. Your stall booking is confirmed.');
      } catch (error) {
        if (!active) return;
        setSuccess(false);
        setMessage(error instanceof Error ? error.message : 'Unable to confirm payment.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void confirm();
    return () => {
      active = false;
    };
  }, [expoId, bookingId, token, sessionId]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{success ? 'Booking Confirmed' : 'Payment Status'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {message}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/expo/${expoId}`)}>Back to Expo</Button>
            <Button variant="outline" onClick={() => router.push('/')}>Go Home</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
