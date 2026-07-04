import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { searchClubsFromKV } from '@/lib/chatMemory';

// Mark as dynamic to prevent prerendering during build
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * GET /api/admin/clubs-sync-debug
 * Debug endpoint to compare Firestore clubs vs KV clubs
 * Shows which clubs are missing from KV cache
 */
export async function GET() {
    // Safety check for build-time execution or misconfigured environment
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        return NextResponse.json(
            { error: 'Firebase not configured', status: 'unavailable' },
            { status: 503 }
        );
    }
    
    try {
        const adminDb = getFirestoreInstance();

        // Get all clubs from Firestore
        const firestoreSnapshot = await adminDb.collection('clubs').get();
        const firestoreclubs = firestoreSnapshot.docs.map((doc: any) => ({
            id: doc.id,
            name: doc.data().name,
            coach_name: doc.data().coach_name,
            has_logo: !!doc.data().logoUrl,
            has_email: !!doc.data().email,
        }));

        // Get all clubs from KV using searchClubsFromKV
        const kvClubs = await searchClubsFromKV();
        const kvClubIds = new Set(kvClubs.map(c => c.id));

        // Compare
        const missingInKV = firestoreclubs.filter((club: any) => !kvClubIds.has(club.id));
        const extraInKV = kvClubs.filter(kvClub => !firestoreclubs.find((c: any) => c.id === kvClub.id));

        // For missing clubs, get full details
        const missingWithDetails = await Promise.all(
            missingInKV.map(async (club: any) => {
                const doc = await adminDb.collection('clubs').doc(club.id).get();
                const data = doc.data() || {};
                return {
                    ...club,
                    fields: {
                        name: !!data.name,
                        email: !!data.email,
                        mobile: !!data.mobile,
                        coach_name: !!data.coach_name,
                        logoUrl: !!data.logoUrl,
                        city: !!data.city,
                        country: !!data.country,
                    }
                };
            })
        );

        return NextResponse.json(
            {
                stats: {
                    firestore_clubs: firestoreclubs.length,
                    kv_clubs: kvClubs.length,
                    difference: firestoreclubs.length - kvClubs.length,
                },
                missing_in_kv: missingWithDetails,
                extra_in_kv_details: extraInKV.map((c: any) => ({ id: c.id, name: c.name })),
                timestamp: new Date().toISOString()
            },
            { status: 200 }
        );
    } catch (error) {
        console.error('[clubs-sync-debug] Error:', error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            },
            { status: 500 }
        );
    }
}
