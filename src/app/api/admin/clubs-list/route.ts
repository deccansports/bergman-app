import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

// Mark as dynamic to prevent prerendering during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Direct inspection endpoint to list all clubs from Firestore
 * Useful for debugging sync and duplicate issues
 */
export async function GET() {
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    const adminDb = getFirestoreInstance();
    const clubsSnapshot = await adminDb.collection('clubs').get();
    
    console.log(`[Clubs List API] Total docs in Firestore: ${clubsSnapshot.size}`);
    
    const clubs = clubsSnapshot.docs.map((doc: any) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        name: data.name,
        coach_name: data.coach_name,
        coachName: data.coachName,
        email: data.email,
        ownerEmail: data.ownerEmail,
        city: data.city,
        state: data.state,
        members_count: Array.isArray(data.members) ? data.members.length : 0,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
    });
    
    // Sort by name to see duplicates together
    clubs.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
    
    // Find exact name duplicates
    const nameMap = new Map<string, any[]>();
    clubs.forEach((club: any) => {
      const normalized = (club.name || '').toLowerCase().trim();
      if (!nameMap.has(normalized)) {
        nameMap.set(normalized, []);
      }
      nameMap.get(normalized)!.push(club);
    });
    
    const duplicates = Array.from(nameMap.entries())
      .filter(([_, clubs]) => clubs.length > 1)
      .map(([name, clubs]) => ({ name, clubs }));
    
    console.log(`[Clubs List API] Found ${duplicates.length} duplicate name groups`);
    duplicates.forEach(dup => {
      console.log(`  - "${dup.name}": ${dup.clubs.map((c: any) => c.id).join(', ')}`);
    });
    
    return Response.json({
      success: true,
      total_clubs: clubs.length,
      duplicate_name_groups: duplicates.length,
      duplicates: duplicates,
      clubs: clubs
    });
  } catch (error) {
    console.error('[Clubs List API]', error);
    return Response.json({ 
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
