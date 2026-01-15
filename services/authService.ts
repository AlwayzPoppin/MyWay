// Authentication Service
import {
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    User,
    updateProfile
} from 'firebase/auth';
import { ref, set, get, onValue, off } from 'firebase/database';
import { auth, googleProvider, database } from './firebase';

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

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    const userRef = ref(database, `users/${uid}`);
    const snapshot = await get(userRef);
    return snapshot.exists() ? snapshot.val() : null;
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
