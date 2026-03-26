import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getFirestoreInstance();
    const doc = await db.collection('storeSettings').doc('shipping').get();
    
    const settings = doc.exists 
      ? doc.data() 
      : { minAmountFreeShipping: 2499, standardShipping: 150 };

    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
