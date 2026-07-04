"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Payment } from '@/lib/types/workWithBergman';
import { getAllPaymentsAction } from '@/lib/actions/workBergmanActions';

export default function PaymentsTab() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');

  const loadPayments = async () => {
    setLoading(true);
    try {
      const records = await getAllPaymentsAction();
      setPayments(records);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, []);

  const summary = useMemo(() => {
    const totalHonorarium = payments.reduce((sum, payment) => sum + Number(payment.honorarium || 0), 0);
    const totalTravel = payments.reduce((sum, payment) => sum + Number(payment.travelReimbursement || 0), 0);
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.totalAmount || payment.amount || 0), 0);
    return { totalHonorarium, totalTravel, totalPaid };
  }, [payments]);

  const formatDate = (value?: string | Date | null) => {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Payments</h2>
        <p className="text-sm text-gray-600 mt-1">Manage worker payments and payment history</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Honorarium</p>
            <p className="text-3xl font-bold mt-2">₹{summary.totalHonorarium.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Travel Reimbursement</p>
            <p className="text-3xl font-bold mt-2">₹{summary.totalTravel.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-600">Total Paid</p>
            <p className="text-3xl font-bold mt-2">₹{summary.totalPaid.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
      </div>

      {statusMessage ? <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{statusMessage}</div> : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Payment Records</CardTitle>
            <Button variant="outline" onClick={loadPayments} disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Honorarium</TableHead>
                <TableHead>Travel</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-gray-500">
                    Loading payments…
                  </TableCell>
                </TableRow>
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-gray-500">
                    No payment records yet
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      <div className="font-medium">{payment.workerName}</div>
                      <div className="text-xs text-muted-foreground">{payment.workerEmail}</div>
                    </TableCell>
                    <TableCell>{payment.roleName}</TableCell>
                    <TableCell>{payment.eventName}</TableCell>
                    <TableCell>₹{Number(payment.honorarium || 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell>₹{Number(payment.travelReimbursement || 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="font-medium">₹{Number(payment.totalAmount || payment.amount || 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell>{payment.transactionId || '—'}</TableCell>
                    <TableCell>{formatDate(payment.paymentDate || payment.paidDate || payment.createdAt)}</TableCell>
                    <TableCell>{payment.paymentMethod}</TableCell>
                    <TableCell>
                      <Badge variant={payment.status === 'Paid' ? 'default' : 'secondary'}>{payment.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
