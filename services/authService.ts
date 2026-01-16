// Authentication Service
import {
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    User,
    updateProfile,
    ActionCodeSettings
} from 'firebase/auth';
import { ref, set, get, onValue, off, push } from 'firebase/database';
import { auth, googleProvider, database } from './firebase';
import { Geofence } from './geofenceService';

// Types
export interface UserProfile {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    phoneNumber: string | null;
    familyCircleId: string | null;
    createdAt: number;
    lastSeen: number;
    settings: {
        theme: 'light' | 'dark' | 'auto';
        notifications: boolean;
        locationSharing: boolean;
    };
}

export interface FamilyCircle {
    id: string;
    name: string;
    ownerId: string;
    members: string[];
    inviteCode: string;
    createdAt: number;
}

// Auth Functions
export const signInWithGoogle = async (): Promise<User> => {
    const result = await signInWithPopup(auth, googleProvider);
    await createUserProfileIfNotExists(result.user);
    return result.user;
};

export const signInWithEmail = async (email: string, password: string): Promise<User> => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
};

export const signUpWithEmail = async (email: string, password: string, displayName: string): Promise<User> => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });
    await createUserProfileIfNotExists(result.user);
    return result.user;
};

// Email Link (Passwordless) Authentication
const EMAIL_LINK_STORAGE_KEY = 'emailForSignIn';
const GOOGLE_MAPS_API_KEY = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY || '';

export const sendEmailLink = async (email: string): Promise<void> => {
    const actionCodeSettings: ActionCodeSettings = {
        // URL to redirect to after email link is clicked
        url: window.location.origin + '/auth/email-link',
        handleCodeInApp: true,
    };

    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    // Save the email to localStorage to complete sign-in later
    window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
};

export const isEmailLinkSignIn = (): boolean => {
    return isSignInWithEmailLink(auth, window.location.href);
};

export const completeEmailLinkSignIn = async (email?: string): Promise<User> => {
    // Get email from localStorage if not provided
    const emailToUse = email || window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY);

    if (!emailToUse) {
        throw new Error('Email is required to complete sign-in. Please enter your email.');
    }

    const result = await signInWithEmailLink(auth, emailToUse, window.location.href);

    // Clear the saved email
    window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);

    // Create user profile if first time
    await createUserProfileIfNotExists(result.user);

    return result.user;
};

export const signOut = async (): Promise<void> => {
    await firebaseSignOut(auth);
};

export const getCurrentUser = (): User | null => {
    return auth.currentUser;
};

export const onAuthChange = (callback: (user: User | null) => void): (() => void) => {
    return onAuthStateChanged(auth, callback);
};

// User Profile Functions
export const createUserProfileIfNotExists = async (user: User): Promise<void> => {
    const userRef = ref(database, `users/${user.uid}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
        const profile: UserProfile = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            phoneNumber: user.phoneNumber,
            familyCircleId: null,
            createdAt: Date.now(),
            lastSeen: Date.now(),
            settings: {
                theme: 'dark',
                notifications: true,
                locationSharing: true
            }
        };
        await set(userRef, profile);
    }
};

export const getUserProfile = async (uid: string, retries = 2): Promise<UserProfile | null> => {
    for (let i = 0; i <= retries; i++) {
        try {
            const userRef = ref(database, `users/${uid}`);
            const snapshotPromise = get(userRef);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Profile fetch timeout')), 4000)
            );

            const snapshot = await Promise.race([snapshotPromise, timeoutPromise]) as any;
            return snapshot.exists() ? snapshot.val() as UserProfile : null;
        } catch (error) {
            console.error(`Error fetching user profile (Attempt ${i + 1}/${retries + 1}):`, error);
            if (i === retries) return null;
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    return null;
};

export const updateUserProfile = async (uid: string, updates: Partial<UserProfile>): Promise<void> => {
    const userRef = ref(database, `users/${uid}`);
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
        await set(userRef, { ...snapshot.val(), ...updates, lastSeen: Date.now() });
    }
};

// Family Circle Functions
export const createFamilyCircle = async (name: string, ownerId: string): Promise<FamilyCircle> => {
    console.log('Creating family circle:', { name, ownerId });
    const circleId = `circle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const inviteCode = Math.random().toString(36).substr(2, 8).toUpperCase();

    const circle: FamilyCircle = {
        id: circleId,
        name,
        ownerId,
        members: [ownerId],
        inviteCode,
        createdAt: Date.now()
    };

    await set(ref(database, `circles/${circleId}`), circle);
    await updateUserProfile(ownerId, { familyCircleId: circleId });

    return circle;
};

export const joinFamilyCircle = async (inviteCode: string, userId: string): Promise<FamilyCircle | null> => {
    const circlesRef = ref(database, 'circles');
    const snapshot = await get(circlesRef);

    if (!snapshot.exists()) return null;

    const circles = snapshot.val();
    for (const circleId in circles) {
        if (circles[circleId].inviteCode === inviteCode) {
            const circle = circles[circleId];
            if (!circle.members.includes(userId)) {
                circle.members.push(userId);
                await set(ref(database, `circles/${circleId}`), circle);
                await updateUserProfile(userId, { familyCircleId: circleId });
            }
            return circle;
        }
    }
    return null;
};

export const getFamilyCircle = async (circleId: string): Promise<FamilyCircle | null> => {
    const circleRef = ref(database, `circles/${circleId}`);
    const snapshot = await get(circleRef);
    return snapshot.exists() ? snapshot.val() : null;
};

// Real-time Location Functions
export interface MemberLocation {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    timestamp: number;
    battery: number;
}

export const updateMemberLocation = async (
    circleId: string,
    userId: string,
    location: MemberLocation
): Promise<void> => {
    await set(ref(database, `locations/${circleId}/${userId}`), location);
};

export const subscribeToFamilyLocations = (
    circleId: string,
    callback: (locations: Record<string, MemberLocation>) => void
): (() => void) => {
    const locationsRef = ref(database, `locations/${circleId}`);

    onValue(locationsRef, (snapshot) => {
        callback(snapshot.exists() ? snapshot.val() : {});
    });

    return () => off(locationsRef);
};
export const getCircleMembers = async (circleId: string): Promise<UserProfile[]> => {
    const circle = await getFamilyCircle(circleId);
    if (!circle) return [];

    const members: UserProfile[] = [];
    for (const memberId of circle.members) {
        const profile = await getUserProfile(memberId);
        if (profile) members.push(profile);
    }
    return members;
};

// Geofence Management Functions
export const addGeofence = async (circleId: string, geofence: Omit<Geofence, 'id'>): Promise<string> => {
    const geofencesRef = ref(database, `geofences/${circleId}`);
    const newGeofenceRef = push(geofencesRef);
    const id = newGeofenceRef.key as string;

    const geofenceWithId: Geofence = { ...geofence, id };
    await set(ref(database, `geofences/${circleId}/${id}`), geofenceWithId);

    return id;
};

export const getGeofences = async (circleId: string): Promise<Geofence[]> => {
    const geofencesRef = ref(database, `geofences/${circleId}`);
    const snapshot = await get(geofencesRef);
    if (!snapshot.exists()) return [];

    return Object.values(snapshot.val());
};

export const subscribeToGeofences = (
    circleId: string,
    callback: (geofences: Geofence[]) => void
): (() => void) => {
    const geofencesRef = ref(database, `geofences/${circleId}`);

    onValue(geofencesRef, (snapshot) => {
        const data = snapshot.exists() ? snapshot.val() : {};
        callback(Object.values(data));
    });

    return () => off(geofencesRef);
};
