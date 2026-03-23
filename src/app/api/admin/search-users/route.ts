// src/app/api/admin/search-users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { User } from '@/lib/types';
import { Timestamp } from 'firebase-admin/firestore';

const toIsoStringSafe = (dateField: any): string | null => {
  if (!dateField) return null;
  if (dateField instanceof Timestamp) return dateField.toDate().toISOString();
  if (dateField instanceof Date) return dateField.toISOString();
  if (typeof dateField === 'string') {
    try {
      return new Date(dateField).toISOString();
    } catch (e) {
      return null;
    }
  }
  return null;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const searchTerm = searchParams.get('term');
  const actionName = '[API /admin/search-users]';
  
  if (!searchTerm || searchTerm.length < 3) {
    return NextResponse.json({ success: true, users: [] });
  }

  try {
    const adminDb = getFirestoreInstance();
    const lowerSearchTerm = searchTerm.toLowerCase();
    
    // Create two separate queries
    const nameQuery = adminDb.collection('users')
        .where('nameLower', '>=', lowerSearchTerm)
        .where('nameLower', '<=', lowerSearchTerm + '\uf8ff')
        .limit(5)
        .get();
        
    const emailQuery = adminDb.collection('users')
        .where('email', '>=', lowerSearchTerm)
        .where('email', '<=', lowerSearchTerm + '\uf8ff')
        .limit(5)
        .get();

    const [nameSnapshot, emailSnapshot] = await Promise.all([nameQuery, emailQuery]);

    const usersMap = new Map<string, User>();
    
    const processDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = doc.data();
        if (!usersMap.has(doc.id)) {
            // Serialize the user data to make it a plain object
            const plainData: any = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    const value = data[key];
                    // Convert Timestamps, but handle other types as they are
                    if (value instanceof Timestamp) {
                        plainData[key] = value.toDate().toISOString();
                    } else if (value !== undefined) {
                        plainData[key] = value;
                    }
                }
            }
            usersMap.set(doc.id, { uid: doc.id, ...plainData } as User);
        }
    };
    
    nameSnapshot.forEach(processDoc);
    emailSnapshot.forEach(processDoc);
    
    return NextResponse.json({ success: true, message: "Users found.", users: Array.from(usersMap.values()) });

  } catch (e: any) {
    console.error(`[${actionName}] Error: ${e.message}`, e);
    if ((e as any).code === 'FAILED_PRECONDITION') {
        return NextResponse.json({ success: false, message: `A database index is required for this query. Please check your Firestore indexes configuration.` }, { status: 500 });
    }
    return NextResponse.json({ success: false, message: `Server error: ${e.message}` }, { status: 500 });
  }
}
