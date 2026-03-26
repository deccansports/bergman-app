// src/app/api/admin/zoho/retry-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { syncPaymentToZohoAction } from '@/lib/actions/invoiceActions';
import { FieldPath } from 'firebase-admin/firestore';

export async function POST(request: NextRequest) {
  const actionName = '[API /admin/zoho/retry-sync]';
  
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Missing token.' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const adminAuth = getAuthInstance();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const adminDb = getFirestoreInstance();
    const adminUserDoc = await adminDb.collection('users').doc(decodedToken.uid).get();
    if (!adminUserDoc.exists || !adminUserDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Not an admin.' }, { status: 403 });
    }

    const { registrationId, eventId } = await request.json();

    if (!registrationId || !eventId) {
      return NextResponse.json({ success: false, message: 'registrationId and eventId are required.' }, { status: 400 });
    }

    const participantsSnap = await adminDb.collection('events').doc(eventId).collection('participants').where('bookingId', '==', registrationId).limit(1).get();

    if (participantsSnap.empty) {
        return NextResponse.json({ success: false, message: `Registration with Booking ID "${registrationId}" not found in event ${eventId}.` }, { status: 404 });
    }
    
    const participantDoc = participantsSnap.docs[0];

    console.log(`[${actionName}] Received request to retry Zoho sync for participant ${participantDoc.id} (Booking ID: ${registrationId}) in event ${eventId}.`);

    // Call the existing server action to perform the sync logic
    const result = await syncPaymentToZohoAction(eventId, participantDoc.id);

    if (result.success) {
      return NextResponse.json({ success: true, message: result.message || 'Sync successful.' });
    } else {
      // The action itself will log the detailed error, here we just return the failure message.
      return NextResponse.json({ success: false, message: result.message || 'Sync failed.' }, { status: 500 });
    }

  } catch (error: any) {
    console.error(`[${actionName}] Critical error in API route:`, error);
     if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        return NextResponse.json({ success: false, message: 'Authentication error. Please log in again.' }, { status: 401 });
    }
    return NextResponse.json({ success: false, message: `An unexpected server error occurred: ${error.message}` }, { status: 500 });
  }
}
