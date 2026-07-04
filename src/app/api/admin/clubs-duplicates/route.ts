import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

// Mark as dynamic to prevent prerendering during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    
    console.log(`[Clubs Duplicates API] Found ${clubsSnapshot.size} clubs in Firestore`);

    // Map clubs by normalized name (lowercase, trimmed)
    const clubsByNormalizedName = new Map<string, any[]>();
    const clubsByCoach = new Map<string, any[]>();
    const allClubs: any[] = [];
    
    for (const doc of clubsSnapshot.docs) {
      const club = { id: doc.id, ...doc.data() } as any;
      allClubs.push(club);
      
      console.log(`[Clubs Duplicates API] Processing club: ${club.id} - ${club.name}`);
      
      // Index by normalized name
      const normalizedName = (club.name || '').toLowerCase().trim();
      if (!clubsByNormalizedName.has(normalizedName)) {
        clubsByNormalizedName.set(normalizedName, []);
      }
      clubsByNormalizedName.get(normalizedName)!.push(club);
      
      // Index by coach name
      const coachName = (club.coach_name || club.coachName || '').toLowerCase().trim();
      if (coachName) {
        if (!clubsByCoach.has(coachName)) {
          clubsByCoach.set(coachName, []);
        }
        clubsByCoach.get(coachName)!.push(club);
      }
    }
    
    // Find duplicates
    const duplicatesByName: Record<string, any[]> = {};
    const duplicatesByCoach: Record<string, any[]> = {};
    
    clubsByNormalizedName.forEach((clubs, name) => {
      if (clubs.length > 1) {
        duplicatesByName[name] = clubs;
        console.log(`[Clubs Duplicates API] Found duplicate name: "${name}" with ${clubs.length} clubs`);
      }
    });
    
    clubsByCoach.forEach((clubs, coach) => {
      if (clubs.length > 1) {
        duplicatesByCoach[coach] = clubs;
        console.log(`[Clubs Duplicates API] Found duplicate coach: "${coach}" managing ${clubs.length} clubs`);
      }
    });
    
    // Also find similar names (fuzzy match)
    const similarClubs: Record<string, any[]> = {};
    const processedNames = new Set<string>();
    
    for (const name1 of clubsByNormalizedName.keys()) {
      if (processedNames.has(name1)) continue;
      
      for (const name2 of clubsByNormalizedName.keys()) {
        if (name1 === name2 || processedNames.has(name2)) continue;
        
        // Check if names are similar (Levenshtein-like, simple version)
        if (isSimilarName(name1, name2)) {
          const key = [name1, name2].sort().join(' <-> ');
          if (!similarClubs[key]) {
            similarClubs[key] = [
              ...(clubsByNormalizedName.get(name1) || []),
              ...(clubsByNormalizedName.get(name2) || [])
            ];
            console.log(`[Clubs Duplicates API] Found similar names: "${name1}" <-> "${name2}"`);
          }
          processedNames.add(name1);
          processedNames.add(name2);
        }
      }
    }
    
    const response = {
      success: true,
      totalClubs: allClubs.length,
      duplicatesByNameCount: Object.keys(duplicatesByName).length,
      duplicatesByCoachCount: Object.keys(duplicatesByCoach).length,
      details: {
        byName: duplicatesByName,
        byCoach: duplicatesByCoach,
        similarNames: similarClubs
      },
      allClubs: allClubs.map(c => ({ 
        id: c.id, 
        name: c.name, 
        coach: c.coach_name || c.coachName,
        email: c.email || c.ownerEmail,
        city: c.city
      }))
    };
    
    console.log(`[Clubs Duplicates API] Response: ${JSON.stringify({
      totalClubs: response.totalClubs,
      duplicatesByNameCount: response.duplicatesByNameCount,
      duplicatesByCoachCount: response.duplicatesByCoachCount
    })}`);
    
    return Response.json(response);
  } catch (error) {
    console.error('[Clubs Duplicates API]', error);
    return Response.json({ 
      success: false,
      error: String(error),
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

function isSimilarName(name1: string, name2: string): boolean {
  // Simple similarity check - if they share most characters or are very close in length
  if (Math.abs(name1.length - name2.length) > 3) return false;
  
  // Check if one contains the other (with whitespace variations)
  const n1 = name1.replace(/\s+/g, '');
  const n2 = name2.replace(/\s+/g, '');
  
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Levenshtein distance simple check
  if (levenshteinDistance(n1, n2) <= 2) return true;
  
  return false;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}
