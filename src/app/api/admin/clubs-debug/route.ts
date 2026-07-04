import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

// Mark as dynamic to prevent prerendering during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Debug endpoint - bypasses all caching and provides detailed output
 * for troubleshooting club sync and duplicate issues
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
    
    console.log('\n=== CLUBS DEBUG START ===');
    console.log(new Date().toISOString());
    
    // Step 1: Get all clubs
    console.log('\n[STEP 1] Fetching all clubs from Firestore...');
    const clubsSnapshot = await adminDb.collection('clubs').get();
    const allClubs = clubsSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.get('name'),
      coach_name: doc.get('coach_name'),
      coachName: doc.get('coachName'),
      city: doc.get('city'),
    })) as any[];
    
    console.log(`[STEP 1] Found ${allClubs.length} total documents in Firestore`);
    
    // Step 2: Find duplicates by name
    console.log('\n[STEP 2] Analyzing for duplicate names...');
    const nameMap = new Map<string, any[]>();
    allClubs.forEach(club => {
      const normalized = (club.name || '').toLowerCase().trim();
      if (!nameMap.has(normalized)) {
        nameMap.set(normalized, []);
      }
      nameMap.get(normalized)!.push(club);
    });
    
    const duplicatesByName = Array.from(nameMap.entries())
      .filter(([_, clubs]) => clubs.length > 1)
      .map(([name, clubs]) => ({ name, clubs }));
    
    console.log(`[STEP 2] Found ${duplicatesByName.length} duplicate name groups:`);
    duplicatesByName.forEach((dup, idx) => {
      console.log(`  Duplicate ${idx + 1}: "${dup.name}"`);
      dup.clubs.forEach((club, cidx) => {
        console.log(`    ${cidx + 1}. ID: ${club.id}, Coach: ${club.coach_name || club.coachName}, City: ${club.city}`);
      });
    });
    
    // Step 3: Find duplicates by coach
    console.log('\n[STEP 3] Analyzing for duplicate coaches...');
    const coachMap = new Map<string, any[]>();
    allClubs.forEach(club => {
      const coach = (club.coach_name || club.coachName || '').toLowerCase().trim();
      if (coach) {
        if (!coachMap.has(coach)) {
          coachMap.set(coach, []);
        }
        coachMap.get(coach)!.push(club);
      }
    });
    
    const duplicatesByCoach = Array.from(coachMap.entries())
      .filter(([_, clubs]) => clubs.length > 1)
      .map(([coach, clubs]) => ({ coach, clubs }));
    
    console.log(`[STEP 3] Found ${duplicatesByCoach.length} duplicate coach groups:`);
    duplicatesByCoach.forEach((dup, idx) => {
      console.log(`  Coach ${idx + 1}: "${dup.coach}"`);
      dup.clubs.forEach((club, cidx) => {
        console.log(`    ${cidx + 1}. ID: ${club.id}, Name: ${club.name}`);
      });
    });
    
    // Step 4: Build response
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_clubs: allClubs.length,
        duplicate_name_groups: duplicatesByName.length,
        duplicate_coach_groups: duplicatesByCoach.length,
      },
      duplicate_names: duplicatesByName,
      duplicate_coaches: duplicatesByCoach,
      all_clubs: allClubs.map(c => ({
        id: c.id,
        name: c.name,
        coach: c.coach_name || c.coachName || 'N/A',
        city: c.city || 'N/A',
      }))
    };
    
    console.log('\n=== CLUBS DEBUG COMPLETE ===\n');
    
    return Response.json(response);
  } catch (error) {
    console.error('[Clubs Debug API]', error);
    return Response.json(
      {
        success: false,
        error: String(error),
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
