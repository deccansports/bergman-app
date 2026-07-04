// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, type Functions as FirebaseFunctionsType } from 'firebase/functions';
import { firebaseConfig } from './firebaseConfig';

const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth: Auth = getAuth(app);

// NOTE:
// 1) Avoid initializeFirestore(...) here to prevent production-only SDK state collisions
//    (seen as: FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state).
// 2) Prefer explicit DB id via env, then legacy 'bmdatabase', then default DB fallback.
const configuredDbId = (process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || '').trim();
const preferredDbIds = [configuredDbId, 'bmdatabase', '(default)'].filter((v, i, arr) => v && arr.indexOf(v) === i);

function resolveFirestoreInstance(): Firestore {
	for (const dbId of preferredDbIds) {
		try {
			return dbId === '(default)' ? getFirestore(app) : getFirestore(app, dbId);
		} catch (err) {
			console.warn('[firebase] Firestore init failed for DB id:', dbId, err);
		}
	}

	// Final fallback – should almost never happen.
	return getFirestore(app);
}

const db: Firestore = resolveFirestoreInstance();
const storage: FirebaseStorage = getStorage(app);
const functions: FirebaseFunctionsType = getFunctions(app);

export { app, auth, db, storage, functions };
