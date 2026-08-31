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
import { ref, set, get, onValue, off, push, update } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, googleProvider, database, storage } from './firebase';
import { Geofence } from './geofenceService';
import { batteryService } from './batteryService';
import { bufferSosAlert, setupSosAutoFlush, BufferedSosAlert } from './offlineSosBuffer';
import { bufferLocation, setupAutoFlush, BufferedLocation } from './offlineLocationBuffer';
import {
    loadKeyPairFromSecureStorage,
    importKeyPairJWK,
    generateFamilyKey,
    setFamilyKey,
    deriveSharedSecretKey,
    importPublicKey,
    wrapCircleKey
} from './cryptoService';
import { PrivacyMode, CrashImpactMetadata } from '../types';

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
    ecdhPublicKey?: string;
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
 
/**
 * Real-time subscription to a user's profile.
 */
export const subscribeToUserProfile = (uid: string, callback: (profile: UserProfile | null) => void): (() => void) => {
    const userRef = ref(database, `users/${uid}`);
    onValue(userRef, (snapshot) => {
        callback(snapshot.exists() ? snapshot.val() as UserProfile : null);
    });
    return () => off(userRef);
};
 
export const updateUserProfile = async (uid: string, updates: Partial<UserProfile>): Promise<void> => {
    const userRef = ref(database, `users/${uid}`);
    const snapshot = await get(userRef);
    const existing = snapshot.exists() ? snapshot.val() : {};
    
    await set(userRef, { 
        uid,
        createdAt: Date.now(), // Fallback for new record
        ...existing, 
        ...updates, 
        lastSeen: Date.now() 
    });
};
 
/**
 * Upload a profile image to Firebase Storage and return the public URL (with Data URI fallback for CORS).
 */
export const uploadProfileImage = async (uid: string, file: File): Promise<string> => {
    try {
        const fileRef = storageRef(storage, `avatars/${uid}/${Date.now()}_${file.name}`);
        const result = await uploadBytes(fileRef, file);
        return await getDownloadURL(result.ref);
    } catch (storageErr) {
        console.warn('[uploadProfileImage] Cloud Storage unavailable or CORS-blocked, using compressed Data URI fallback:', storageErr);
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                if (dataUrl) resolve(dataUrl);
                else reject(new Error('Failed to read image file'));
            };
            reader.onerror = () => reject(new Error('FileReader error'));
            reader.readAsDataURL(file);
        });
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

// --- CIRCLE MANAGEMENT (Audit 2: Leave/Remove/Transfer) ---

/**
 * Leave a family circle. If the user is the owner and there are other members,
 * ownership transfers to the next member automatically.
 */
export const leaveCircle = async (circleId: string, userId: string): Promise<void> => {
    const circle = await getFamilyCircle(circleId);
    if (!circle) throw new Error('Circle not found');

    const updatedMembers = circle.members.filter(m => m !== userId);

    if (updatedMembers.length === 0) {
        // Last member — delete the circle entirely
        await set(ref(database, `circles/${circleId}`), null);
        await set(ref(database, `locations/${circleId}/${userId}`), null);
        await set(ref(database, `keys/${circleId}`), null);
        await set(ref(database, `geofences/${circleId}`), null);
    } else {
        // Transfer ownership if leaving user is the owner
        const newOwnerId = circle.ownerId === userId ? updatedMembers[0] : circle.ownerId;
        await set(ref(database, `circles/${circleId}`), {
            ...circle,
            members: updatedMembers,
            ownerId: newOwnerId,
        });
        // Clean up user's location data and key from this circle
        await set(ref(database, `locations/${circleId}/${userId}`), null);
        await set(ref(database, `keys/${circleId}/${userId}`), null);
    }

    // Clear the user's circle reference
    await updateUserProfile(userId, { familyCircleId: null });
};

/**
 * Remove a member from the circle (owner-only action).
 * Implements E2EE Forward Secrecy: Deletes member data and regenerates/distributes
 * a brand new AES-GCM 256-bit symmetric circle key to remaining members.
 */
export const removeMember = async (circleId: string, ownerId: string, targetUserId: string): Promise<void> => {
    const circle = await getFamilyCircle(circleId);
    if (!circle) throw new Error('Circle not found');
    if (circle.ownerId !== ownerId) throw new Error('Only the circle owner can remove members');
    if (targetUserId === ownerId) throw new Error('Owner cannot remove themselves — use leaveCircle instead');

    const updatedMembers = circle.members.filter(m => m !== targetUserId);
    await set(ref(database, `circles/${circleId}`), { ...circle, members: updatedMembers });

    // Clean up removed member's data & revoke wrapped key access
    await set(ref(database, `locations/${circleId}/${targetUserId}`), null);
    await set(ref(database, `keys/${circleId}/${targetUserId}`), null);
    await updateUserProfile(targetUserId, { familyCircleId: null });

    // --- E2EE FORWARD SECRECY (KEY ROTATION) ---
    try {
        const savedKeys = await loadKeyPairFromSecureStorage(ownerId);
        if (savedKeys) {
            const ownerKeyPair = await importKeyPairJWK(savedKeys);
            const newFamilyKey = await generateFamilyKey();
            setFamilyKey(newFamilyKey);

            // 1. Re-wrap and set for owner
            const ownerSecret = await deriveSharedSecretKey(ownerKeyPair.privateKey, ownerKeyPair.publicKey);
            const ownerWrapped = await wrapCircleKey(newFamilyKey, ownerSecret);
            await deliverWrappedKey(circleId, ownerId, ownerWrapped);

            // 2. Re-wrap and distribute to all remaining circle members
            for (const remainingMemberId of updatedMembers) {
                if (remainingMemberId === ownerId) continue;
                const memberProfile = await getUserProfile(remainingMemberId);
                if (memberProfile?.ecdhPublicKey) {
                    const memberPubKey = await importPublicKey(memberProfile.ecdhPublicKey);
                    const sharedSecret = await deriveSharedSecretKey(ownerKeyPair.privateKey, memberPubKey);
                    const wrapped = await wrapCircleKey(newFamilyKey, sharedSecret);
                    await deliverWrappedKey(circleId, remainingMemberId, wrapped);
                    console.log(`🔐 Forward Secrecy: Rotated key delivered to ${memberProfile.displayName || remainingMemberId}`);
                }
            }
            console.log(`🔐 Forward Secrecy: Successfully rotated circle key after member removal.`);
        }
    } catch (keyRotationError) {
        console.warn('⚠️ Forward Secrecy key rotation encountered an error:', keyRotationError);
    }
};

/**
 * Transfer circle ownership to another member.
 */
export const transferOwnership = async (circleId: string, currentOwnerId: string, newOwnerId: string): Promise<void> => {
    const circle = await getFamilyCircle(circleId);
    if (!circle) throw new Error('Circle not found');
    if (circle.ownerId !== currentOwnerId) throw new Error('Only the current owner can transfer ownership');
    if (!circle.members.includes(newOwnerId)) throw new Error('New owner must be a circle member');

    await set(ref(database, `circles/${circleId}`), { ...circle, ownerId: newOwnerId });
};

/**
 * AUDIT FIX: Delete user account and all associated data.
 * Required for Apple App Store and GDPR compliance.
 */
export const deleteAccount = async (userId: string, circleId?: string): Promise<void> => {
    // 1. Leave circle (auto-transfers ownership or deletes empty circle)
    if (circleId) {
        try {
            await leaveCircle(circleId, userId);
        } catch {
            // Circle may already be deleted — continue cleanup
        }
    }

    // 2. Delete user data from Firebase RTDB
    await set(ref(database, `users/${userId}`), null);
    await set(ref(database, `keys/${userId}`), null);

    // 3. Clear all local storage
    const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('myway_'));
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // 4. Clear IndexedDB secure storage
    try {
        const dbReq = indexedDB.deleteDatabase('myway_secure_keys');
        dbReq.onsuccess = () => console.log('🗑️ Secure key storage cleared');
    } catch { /* best effort */ }

    // 5. Delete Firebase Auth account
    const { auth } = await import('./firebase');
    if (auth.currentUser) {
        await auth.currentUser.delete();
        console.log('🗑️ Account deleted successfully');
    }
};

// --- KEY DISTRIBUTION ENGINE ---

export const getWrappedKeyForUser = (circleId: string, uid: string, callback: (wrappedKey: string) => void): (() => void) => {
    const keyRef = ref(database, `keys/${circleId}/${uid}`);
    onValue(keyRef, (snapshot) => {
        if (snapshot.exists()) callback(snapshot.val());
    });
    return () => off(keyRef);
};

export const deliverWrappedKey = async (circleId: string, targetUid: string, wrappedKey: string): Promise<void> => {
    await set(ref(database, `keys/${circleId}/${targetUid}`), wrappedKey);
};


// Real-time Location & Trip ETA Functions
export interface MemberTrip {
    destinationName: string;
    totalTime: string;
    totalDistance: string;
    etaTimestamp?: number;
    destinationCoords?: { lat: number; lng: number };
}

export interface MemberLocation {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    timestamp: number;
    battery: number;
    signalQuality?: string;
    encryptedData?: string;
    status?: string;
    sosActive?: boolean;
    impact?: CrashImpactMetadata | null;
    privacyMode?: PrivacyMode;
    blurredRadiusMeters?: number;
    currentTrip?: MemberTrip | null;
}

export const updateMemberLocation = async (
    circleId: string,
    userId: string,
    location: MemberLocation
): Promise<void> => {
    const payload: any = {
        lat: location.lat,
        lng: location.lng,
        speed: location.speed ?? 0,
        heading: location.heading ?? 0,
        accuracy: location.accuracy || 10,
        battery: location.battery ?? batteryService.getBatteryLevel(),
        signalQuality: location.signalQuality || 'medium',
        timestamp: location.timestamp || Date.now(),
        status: location.status || 'Moving',
        privacyMode: location.privacyMode || 'exact',
        blurredRadiusMeters: location.blurredRadiusMeters || 0,
    };
    if (location.encryptedData !== undefined) {
        payload.encryptedData = location.encryptedData;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.warn('📶 Offline: Queuing location update in IndexedDB buffer');
        await bufferLocation({
            userId,
            circleId,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy || 10,
            speed: location.speed ?? null,
            heading: location.heading ?? null,
            battery: location.battery ?? batteryService.getBatteryLevel(),
            signalQuality: location.signalQuality || 'medium',
            timestamp: location.timestamp || Date.now(),
            encryptedData: location.encryptedData ?? null
        });
        return;
    }

    try {
        await set(ref(database, `locations/${circleId}/${userId}`), payload);
    } catch (err) {
        console.error('Failed to update member location in Firebase, buffering locally:', err);
        await bufferLocation({
            userId,
            circleId,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy || 10,
            speed: location.speed ?? null,
            heading: location.heading ?? null,
            battery: location.battery ?? batteryService.getBatteryLevel(),
            signalQuality: location.signalQuality || 'medium',
            timestamp: location.timestamp || Date.now(),
            encryptedData: location.encryptedData ?? null
        });
    }
};

export const updateMemberTrip = async (
    circleId: string,
    userId: string,
    trip: MemberTrip | null
): Promise<void> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
        await set(ref(database, `locations/${circleId}/${userId}/currentTrip`), trip);
    } catch (err) {
        console.error('Failed to update member trip in Firebase:', err);
    }
};

export const triggerSOS = async (
    circleId: string,
    userId: string,
    location?: { lat: number; lng: number },
    impact?: CrashImpactMetadata
): Promise<void> => {
    if (!navigator.onLine) {
        console.warn('📶 Offline: Queuing SOS alert in IndexedDB buffer');
        await bufferSosAlert({ circleId, userId, action: 'trigger', location, impact, timestamp: Date.now() });
        return;
    }

    try {
        const locRef = ref(database, `locations/${circleId}/${userId}`);
        const snapshot = await get(locRef);
        if (snapshot.exists()) {
            const currentLoc = snapshot.val();
            await set(locRef, {
                ...currentLoc,
                sosActive: true,
                impact: impact || null,
                timestamp: Date.now()
            });
        } else if (location) {
            await set(locRef, {
                lat: location.lat,
                lng: location.lng,
                speed: impact?.speed || 0,
                heading: 0,
                accuracy: 10,
                battery: batteryService.getBatteryLevel(),
                timestamp: Date.now(),
                sosActive: true,
                impact: impact || null
            });
        }
    } catch (err) {
        console.error('❌ Failed to trigger SOS over network, queuing in IndexedDB:', err);
        await bufferSosAlert({ circleId, userId, action: 'trigger', location, impact, timestamp: Date.now() });
    }
};

export const clearSOS = async (circleId: string, userId: string): Promise<void> => {
    if (!navigator.onLine) {
        console.warn('📶 Offline: Queuing SOS clear in IndexedDB buffer');
        await bufferSosAlert({ circleId, userId, action: 'clear', timestamp: Date.now() });
        return;
    }

    try {
        const locRef = ref(database, `locations/${circleId}/${userId}`);
        const snapshot = await get(locRef);
        if (snapshot.exists()) {
            const currentLoc = snapshot.val();
            await set(locRef, {
                ...currentLoc,
                sosActive: false,
                impact: null,
                timestamp: Date.now()
            });
        }
    } catch (err) {
        console.error('❌ Failed to clear SOS over network, queuing in IndexedDB:', err);
        await bufferSosAlert({ circleId, userId, action: 'clear', timestamp: Date.now() });
    }
};

// Auto-flush queued offline SOS alerts when back online
setupSosAutoFlush(async (alert: BufferedSosAlert) => {
    const locRef = ref(database, `locations/${alert.circleId}/${alert.userId}`);
    const snapshot = await get(locRef);
    if (snapshot.exists()) {
        const currentLoc = snapshot.val();
        await set(locRef, {
            ...currentLoc,
            sosActive: alert.action === 'trigger',
            impact: alert.action === 'trigger' ? (alert.impact || null) : null,
            timestamp: alert.timestamp
        });
    } else if (alert.location) {
        await set(locRef, {
            lat: alert.location.lat,
            lng: alert.location.lng,
            speed: alert.impact?.speed || 0,
            heading: 0,
            accuracy: 10,
            battery: batteryService.getBatteryLevel(),
            timestamp: alert.timestamp,
            sosActive: alert.action === 'trigger',
            impact: alert.action === 'trigger' ? (alert.impact || null) : null
        });
    }
});

/**
 * Syncs a batch of buffered offline locations to Firebase Realtime Database
 */
export const syncBufferedLocations = async (locations: BufferedLocation[]): Promise<void> => {
    for (const loc of locations) {
        const circleId = loc.circleId;
        if (!circleId || !loc.userId) continue;

        const locRef = ref(database, `locations/${circleId}/${loc.userId}`);
        const updatePayload: Record<string, any> = {
            lat: loc.lat,
            lng: loc.lng,
            accuracy: loc.accuracy,
            speed: loc.speed ?? 0,
            heading: loc.heading ?? 0,
            timestamp: loc.timestamp,
            battery: loc.battery ?? batteryService.getBatteryLevel(),
            signalQuality: loc.signalQuality ?? '4G',
            status: loc.status || 'Online'
        };

        if (loc.encryptedData) {
            updatePayload.encryptedData = loc.encryptedData;
        }
        if (loc.privacyMode) {
            updatePayload.privacyMode = loc.privacyMode;
        }

        await update(locRef, updatePayload);
    }
};

// Auto-flush queued offline locations when back online
setupAutoFlush(syncBufferedLocations);

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
