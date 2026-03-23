// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, type Functions as FirebaseFunctionsType } from 'firebase/functions';
import { firebaseConfig } from './firebaseConfig';

const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app, 'bmdatabase');
const storage: FirebaseStorage = getStorage(app);
const functions: FirebaseFunctionsType = getFunctions(app);

export { app, auth, db, storage, functions };
