'use server';

import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Sync or create a user profile in Firestore
 * Use this for users who signed up but their profile wasn't created
 */
export async function syncUserProfileAction(userId: string): Promise<{ success: boolean; message: string }> {
    try {
        const adminDb = getFirestoreInstance();
        const adminAuth = getAuthInstance();

        // Get user from Firebase Auth
        const firebaseUser = await adminAuth.getUser(userId);
        
        if (!firebaseUser) {
            return { success: false, message: `User ${userId} not found in Firebase Auth` };
        }

        // Check if user profile exists in Firestore
        const userDocRef = adminDb.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (userDoc && userDoc.data()) {
            return { success: true, message: `User profile already exists for ${userId}` };
        }

        // Create user profile with basic info from Firebase Auth
        const profileData = {
            uid: userId,
            email: firebaseUser.email || null,
            name: firebaseUser.displayName || 'Athlete',
            displayName: firebaseUser.displayName || null,
            photoURL: firebaseUser.photoURL || null,
            emailVerified: firebaseUser.emailVerified || false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            role: 'athlete',
            isAdmin: false,
            isVolunteer: false,
        };

        await userDocRef.set(profileData);

        console.log(`[SERVER] User profile created for ${userId} (${firebaseUser.email})`);
        return { 
            success: true, 
            message: `User profile created successfully for ${firebaseUser.email}` 
        };
    } catch (e: any) {
        console.error(`[SERVER] Error syncing user profile:`, e);
        return { success: false, message: e.message || 'Unknown error occurred' };
    }
}

/**
 * Batch sync multiple user profiles
 * Pass an array of user IDs to create profiles for users who are missing them
 */
export async function batchSyncUserProfilesAction(userIds: string[]): Promise<{ 
    success: boolean; 
    message: string; 
    created: number; 
    failed: number; 
    errors: { userId: string; error: string }[] 
}> {
    const created: string[] = [];
    const errors: { userId: string; error: string }[] = [];

    for (const userId of userIds) {
        const result = await syncUserProfileAction(userId);
        if (result.success && result.message.includes('created')) {
            created.push(userId);
        } else if (!result.success) {
            errors.push({ userId, error: result.message });
        }
    }

    return {
        success: errors.length === 0,
        message: `Synced ${created.length}/${userIds.length} user profiles`,
        created: created.length,
        failed: errors.length,
        errors
    };
}
