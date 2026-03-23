// src/app/api/zoho-invoice-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { syncMissingZohoInvoicesAction } from '@/lib/actions';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';

export async function POST(request: NextRequest) {
  const actionName = '[API /zoho-invoice-sync]';
  
  // Basic auth check for admin user
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Missing token.' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const adminAuth = getAuthInstance();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const adminUserDoc = await getFirestoreInstance().collection('users').doc(decodedToken.uid).get();
    if (!adminUserDoc.exists || !adminUserDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Not an admin.' }, { status: 403 });
    }
  } catch (authError: any) {
    return NextResponse.json({ success: false, message: `Authentication error: ${authError.message}` }, { status: 401 });
  }

  try {
    const { startDate, endDate, newInvoiceDate } = await request.json();
    if (!startDate || !endDate || !newInvoiceDate) {
      return NextResponse.json({ success: false, message: 'startDate, endDate, and newInvoiceDate are required.' }, { status: 400 });
    }

    const result = await syncMissingZohoInvoicesAction(startDate, endDate, newInvoiceDate);

    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(result, { status: 500 });
    }

  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
    return NextResponse.json({ 
        success: false, 
        message: `Server error: ${error.message}`, 
    }, { status: 500 });
  }
}
