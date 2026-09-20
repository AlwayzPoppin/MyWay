// Firebase Configuration
// Replace these values with your Firebase project settings from the Firebase Console
// Go to: Firebase Console > Project Settings > General > Your Apps > Web App

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { initializeFirestore, getFirestore, setLogLevel } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

// Silence Firestore internal offline/network-reachability logs in browser console
try {
    setLogLevel('silent');
} catch {}

// Gracefully demote Firestore offline backend reachability warnings to debug logs
if (typeof window !== 'undefined' && typeof console !== 'undefined' && console.error) {
    const origError = console.error.bind(console);
    console.error = (...args: any[]) => {
        const str = args.map(a => (typeof a === 'string' ? a : (a?.message || ''))).join(' ');
        if (
            str.includes('@firebase/firestore') ||
            str.includes('Could not reach Cloud Firestore backend') ||
            str.includes('code=unavailable')
        ) {
            console.debug('[Firestore:OfflineMode]', ...args);
            return;
        }
        origError(...args);
    };
}

const env = (import.meta as any).env || {};
const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
    appId: env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID",
    databaseURL: env.VITE_FIREBASE_DATABASE_URL || "https://YOUR_PROJECT.firebaseio.com"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Realtime Database (Legacy/Profile)
export const database = getDatabase(app);

// Firestore (Resilient long-polling transport prevents connection timeout errors behind proxies & iframes)
let firestoreDb;
try {
    firestoreDb = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        ignoreUndefinedProperties: true
    });
} catch {
    firestoreDb = getFirestore(app);
}
export const db = firestoreDb;

// Cloud Functions
export const functions = getFunctions(app);
// Storage
export const storage = getStorage(app);
storage.maxUploadRetryTime = 12000;
storage.maxOperationRetryTime = 12000;

// Connect to emulator in development
if (env.DEV && env.VITE_USE_FUNCTIONS_EMULATOR === 'true') {
    connectFunctionsEmulator(functions, 'localhost', 5001);
}


export default app;
