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
import { doc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, googleProvider, database, storage, db } from './firebase';
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
    hasCompletedSetup?: boolean;
    dateOfBirth?: string;
    gender?: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | string;
    preciseHomeLocation?: {
        lat: number;
        lng: number;
        address?: string;
        label?: string;
        houseNumber?: string;
    };
}

export interface CircleColorInfo {
    id: string;
    name: string;
    hex: string;
    border: string;
    bg: string;
    text: string;
}

export const CIRCLE_COLORS: CircleColorInfo[] = [
    { id: 'blue', name: 'Ocean Blue', hex: '#3B82F6', border: '#60A5FA', bg: 'rgba(59, 130, 246, 0.2)', text: 'text-blue-400' },
    { id: 'purple', name: 'Neon Purple', hex: '#8B5CF6', border: '#A78BFA', bg: 'rgba(139, 92, 246, 0.2)', text: 'text-purple-400' },
    { id: 'emerald', name: 'Emerald Green', hex: '#10B981', border: '#34D399', bg: 'rgba(16, 185, 129, 0.2)', text: 'text-emerald-400' },
    { id: 'amber', name: 'Sunset Amber', hex: '#F59E0B', border: '#FBBF24', bg: 'rgba(245, 158, 11, 0.2)', text: 'text-amber-400' },
    { id: 'pink', name: 'Rose Pink', hex: '#EC4899', border: '#F472B6', bg: 'rgba(236, 72, 153, 0.2)', text: 'text-pink-400' },
    { id: 'cyan', name: 'Electric Cyan', hex: '#06B6D4', border: '#22D3EE', bg: 'rgba(6, 182, 212, 0.2)', text: 'text-cyan-400' },
    { id: 'orange', name: 'Blaze Orange', hex: '#F97316', border: '#FB923C', bg: 'rgba(249, 115, 22, 0.2)', text: 'text-orange-400' },
    { id: 'indigo', name: 'Royal Indigo', hex: '#6366F1', border: '#818CF8', bg: 'rgba(99, 102, 241, 0.2)', text: 'text-indigo-400' },
];

export const getCircleColor = (circleId?: string, explicitColor?: string): CircleColorInfo => {
    if (explicitColor) {
        const found = CIRCLE_COLORS.find(c => c.hex.toLowerCase() === explicitColor.toLowerCase() || c.id === explicitColor.toLowerCase());
        if (found) return found;
        return { id: 'custom', name: 'Custom', hex: explicitColor, border: explicitColor, bg: `${explicitColor}33`, text: 'text-indigo-400' };
    }
    if (!circleId) return CIRCLE_COLORS[0];
    let hash = 0;
    for (let i = 0; i < circleId.length; i++) {
        hash = (hash << 5) - hash + circleId.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % CIRCLE_COLORS.length;
    return CIRCLE_COLORS[idx];
};

export interface FamilyCircle {
    id: string;
    name: string;
    ownerId: string;
    members: string[];
    inviteCode: string;
    createdAt: number;
    color?: string;
}

const GOOGLE_WEB_CLIENT_ID = (import.meta as any).env.VITE_GOOGLE_WEB_CLIENT_ID || '740093147434-mdtorbehce0b5c1ia8cbhadapn4fna54.apps.googleusercontent.com';

let isSocialLoginInitialized = false;
export const ensureSocialLoginInitialized = async (): Promise<void> => {
    if (isSocialLoginInitialized) return;
    try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;

        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        await SocialLogin.initialize({
            google: {
                webClientId: GOOGLE_WEB_CLIENT_ID,
                mode: 'online'
            }
        });
        isSocialLoginInitialized = true;
        console.log('✅ SocialLogin initialized with Web Client ID');
    } catch (initErr) {
        console.warn('⚠️ SocialLogin.initialize notice:', initErr);
    }
};

// Auth Functions
export const signInWithGoogle = async (): Promise<User> => {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
        console.log('📱 Using Native Google Sign-In via Credential Manager');
        await ensureSocialLoginInitialized();
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        try {
            const loginRes = await SocialLogin.login({
                provider: 'google',
                options: {
                    scopes: ['email', 'profile']
                }
            });

            const idToken = (loginRes.result as any)?.idToken;
            if (!idToken) {
                throw new Error('Google Sign-In did not return an identity token.');
            }

            const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
            const credential = GoogleAuthProvider.credential(idToken);
            const userCredential = await signInWithCredential(auth, credential);
            await createUserProfileIfNotExists(userCredential.user);
            return userCredential.user;
        } catch (nativeErr: any) {
            console.warn('Native Google Sign-In error:', nativeErr);
            if (nativeErr.code === 'USER_CANCELLED' || nativeErr.message?.toLowerCase().includes('cancel')) {
                throw new Error('Google Sign-In was cancelled.');
            }
            throw nativeErr;
        }
    }

    // Web / desktop browser fallback
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
    try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
            const { SocialLogin } = await import('@capgo/capacitor-social-login');
            await SocialLogin.logout({ provider: 'google' });
        }
    } catch (logoutErr) {
        // Non-critical if user was not logged in via native Google
    }
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
 
/**
 * Recursively cleans any undefined values from an object or array to prevent
 * Firebase Realtime Database "set failed: value argument contains undefined" errors.
 */
function sanitizeForFirebase<T>(data: T): T {
    if (data === undefined) return null as any;
    if (data === null || typeof data !== 'object') return data;
    if (Array.isArray(data)) {
        return data.filter(x => x !== undefined).map(sanitizeForFirebase) as any;
    }
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            clean[key] = sanitizeForFirebase(value);
        }
    }
    return clean as T;
}

export const updateUserProfile = async (uid: string, updates: Partial<UserProfile>): Promise<void> => {
    const userRef = ref(database, `users/${uid}`);
    let existing = {};
    try {
        const snapshot = await get(userRef);
        if (snapshot.exists()) {
            existing = snapshot.val();
        }
    } catch (readErr) {
        console.warn('[AuthService] Could not read existing profile before update:', readErr);
    }
    
    const mergedProfile: Record<string, any> = { 
        uid,
        createdAt: Date.now(), // Fallback for new record
        ...existing, 
        ...updates, 
        lastSeen: Date.now() 
    };

    // Deep clean any undefined values recursively to prevent Firebase validation errors
    const cleaned = sanitizeForFirebase(mergedProfile);
    
    // 1. Write to Realtime Database
    await set(userRef, cleaned);

    // 2. Mirror to Firestore users document
    if (db) {
        try {
            await setDoc(doc(db, 'users', uid), cleaned, { merge: true });
            console.log(`👤 [AuthService] Updated Firestore user profile: users/${uid}`);
        } catch (fsErr: any) {
            console.debug('[AuthService] Firestore user profile sync skipped (RTDB is primary):', fsErr?.message || fsErr);
        }
    }
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
export const createFamilyCircle = async (name: string, ownerId: string, color?: string): Promise<FamilyCircle> => {
    console.log('Creating family circle:', { name, ownerId, color });
    const circleId = `circle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const inviteCode = Math.random().toString(36).substr(2, 8).toUpperCase();
    const assignedColor = color || getCircleColor(circleId).hex;

    const circle: FamilyCircle = {
        id: circleId,
        name,
        ownerId,
        members: [ownerId],
        inviteCode,
        createdAt: Date.now(),
        color: assignedColor
    };

    await set(ref(database, `circles/${circleId}`), circle);
    await updateUserProfile(ownerId, { familyCircleId: circleId });

    return circle;
};

export const updateCircleColor = async (circleId: string, color: string): Promise<void> => {
    const circleRef = ref(database, `circles/${circleId}`);
    const snapshot = await get(circleRef);
    if (snapshot.exists()) {
        const circle = snapshot.val();
        await set(circleRef, { ...circle, color });
    }
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
 * Fetches all circles that a user belongs to (Multi-Circle / Secondary Circles support).
 */
export const getUserCircles = async (userId: string): Promise<FamilyCircle[]> => {
    try {
        const circlesRef = ref(database, 'circles');
        const snapshot = await get(circlesRef);
        if (!snapshot.exists()) return [];

        const data = snapshot.val();
        const userCircles: FamilyCircle[] = [];
        for (const id in data) {
            const circle = data[id];
            if (circle.members && Array.isArray(circle.members) && circle.members.includes(userId)) {
                userCircles.push({ ...circle, id });
            }
        }
        return userCircles;
    } catch (e) {
        console.warn('⚠️ Error fetching user circles:', e);
        return [];
    }
};

/**
 * Switches the user's active family circle.
 */
export const switchActiveCircle = async (userId: string, circleId: string): Promise<void> => {
    await updateUserProfile(userId, { familyCircleId: circleId });
};

/**
 * Renames a family circle.
 */
export const renameFamilyCircle = async (circleId: string, name: string): Promise<void> => {
    const circleRef = ref(database, `circles/${circleId}`);
    const snapshot = await get(circleRef);
    if (snapshot.exists()) {
        const circle = snapshot.val();
        await set(circleRef, { ...circle, name });
    }
};

/**
 * Deletes a family circle completely (owner-only).
 */
export const deleteFamilyCircle = async (circleId: string): Promise<void> => {
    await set(ref(database, `circles/${circleId}`), null);
    await set(ref(database, `locations/${circleId}`), null);
    await set(ref(database, `keys/${circleId}`), null);
    await set(ref(database, `geofences/${circleId}`), null);
    await set(ref(database, `places/${circleId}`), null);
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

export const resetPassword = async (email: string): Promise<void> => {
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(auth, email);
};

/**
 * AUDIT FIX: Delete user account and all associated data.
 * Required for Apple App Store and GDPR compliance.
 */
export const deleteAccount = async (userId?: string, circleId?: string, password?: string): Promise<void> => {
    const user = auth.currentUser;
    const targetUid = user?.uid || userId;
    if (!targetUid) throw new Error('No active user session found to delete.');

    // 1. Firebase Auth user deletion MUST happen first.
    // This prevents "zombie accounts" where DB data is wiped but the email remains trapped in Auth.
    if (user) {
        // If password is provided, re-authenticate before deletion
        if (password && user.email) {
            try {
                const { EmailAuthProvider, reauthenticateWithCredential } = await import('firebase/auth');
                const cred = EmailAuthProvider.credential(user.email, password);
                await reauthenticateWithCredential(user, cred);
                console.log('🔑 Re-authenticated successfully with password');
            } catch (authErr: any) {
                if (authErr.code === 'auth/wrong-password' || authErr.code === 'auth/invalid-credential') {
                    throw new Error('Incorrect password. Please enter your valid password to confirm deletion.');
                }
                throw authErr;
            }
        }

        try {
            await user.delete();
            console.log('🗑️ Firebase Auth account deleted successfully');
        } catch (deleteErr: any) {
            console.warn('Initial user.delete() status:', deleteErr.code || deleteErr.message);

            const isRecentLoginReq =
                deleteErr.code === 'auth/requires-recent-login' ||
                deleteErr.message?.includes('CREDENTIAL_TOO_OLD') ||
                deleteErr.message?.includes('requires-recent-login') ||
                deleteErr.code === 'auth/user-token-expired';

            if (isRecentLoginReq) {
                const providers = user.providerData?.map(p => p.providerId) || [];

                if (providers.includes('google.com')) {
                    try {
                        const { Capacitor } = await import('@capacitor/core');
                        if (Capacitor.isNativePlatform()) {
                            await ensureSocialLoginInitialized();
                            const { SocialLogin } = await import('@capgo/capacitor-social-login');
                            const loginRes = await SocialLogin.login({
                                provider: 'google',
                                options: { scopes: ['email', 'profile'] }
                            });
                            const idToken = (loginRes.result as any)?.idToken;
                            if (!idToken) throw new Error('Google re-authentication was cancelled.');
                            const { GoogleAuthProvider, reauthenticateWithCredential } = await import('firebase/auth');
                            const cred = GoogleAuthProvider.credential(idToken);
                            await reauthenticateWithCredential(user, cred);
                        } else {
                            const { reauthenticateWithPopup } = await import('firebase/auth');
                            await reauthenticateWithPopup(user, googleProvider);
                        }
                        await user.delete();
                        console.log('🗑️ Account deleted successfully after Google re-auth');
                    } catch (gErr: any) {
                        throw new Error('Google re-authentication failed. Please sign in again and retry.');
                    }
                } else if (password && user.email) {
                    try {
                        const { EmailAuthProvider, reauthenticateWithCredential } = await import('firebase/auth');
                        const cred = EmailAuthProvider.credential(user.email, password);
                        await reauthenticateWithCredential(user, cred);
                        await user.delete();
                        console.log('🗑️ Account deleted successfully after password re-auth');
                    } catch (pErr: any) {
                        if (pErr.code === 'auth/wrong-password' || pErr.code === 'auth/invalid-credential') {
                            throw new Error('Incorrect password. Please enter your valid password to confirm deletion.');
                        }
                        throw pErr;
                    }
                } else {
                    // Do NOT silently delete database data!
                    throw new Error('Recent security verification required. Please confirm your password to delete your account.');
                }
            } else if (deleteErr.code !== 'auth/user-not-found') {
                throw deleteErr;
            }
        }
    }

    // 2. NOW that Firebase Auth user is deleted, clean up all database and circle data
    let targetCircleId = circleId;
    if (!targetCircleId) {
        try {
            const snap = await get(ref(database, `users/${targetUid}/familyCircleId`));
            if (snap.exists()) {
                targetCircleId = snap.val();
            }
        } catch { /* best effort */ }
    }

    if (targetCircleId) {
        try {
            await leaveCircle(targetCircleId, targetUid);
        } catch (circleErr) {
            console.warn('Circle cleanup warning during account deletion:', circleErr);
        }
    }

    // 3. Delete user data from Firebase RTDB
    try {
        await set(ref(database, `users/${targetUid}`), null);
        await set(ref(database, `keys/${targetUid}`), null);
        await set(ref(database, `locations/${targetUid}`), null);
        await set(ref(database, `user_places/${targetUid}`), null);
    } catch (rtdbErr) {
        console.warn('RTDB user cleanup warning:', rtdbErr);
    }

    // 4. Delete user document from Firestore (mirror cleanup)
    try {
        if (db) {
            const { deleteDoc, doc: fsDoc } = await import('firebase/firestore');
            await deleteDoc(fsDoc(db, 'users', targetUid));
        }
    } catch (fsErr) {
        console.debug('Firestore user cleanup warning:', fsErr);
    }

    // 5. Clear all local storage
    try {
        const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('myway_'));
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* best effort */ }

    // 6. Clear IndexedDB secure storage
    try {
        const dbReq = indexedDB.deleteDatabase('myway_secure_keys');
        dbReq.onsuccess = () => console.log('🗑️ Secure key storage cleared');
    } catch { /* best effort */ }

    try {
        await firebaseSignOut(auth);
    } catch { /* best effort */ }
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
    isCharging?: boolean;
    signalQuality?: string;
    encryptedData?: string;
    status?: string;
    sosActive?: boolean;
    impact?: CrashImpactMetadata | null;
    privacyMode?: PrivacyMode;
    blurredRadiusMeters?: number;
    currentTrip?: MemberTrip | null;
    displayName?: string;
    photoURL?: string;
    role?: string;
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
        isCharging: location.isCharging !== undefined ? location.isCharging : batteryService.getBatteryInfo().isCharging,
        signalQuality: location.signalQuality || 'medium',
        timestamp: location.timestamp || Date.now(),
        status: location.status || 'Moving',
        privacyMode: location.privacyMode || 'exact',
        blurredRadiusMeters: location.blurredRadiusMeters || 0,
    };
    if (location.encryptedData !== undefined) {
        payload.encryptedData = location.encryptedData;
    }
    if (location.displayName) {
        payload.displayName = location.displayName;
    }
    if (location.photoURL) {
        payload.photoURL = location.photoURL;
    }
    if (location.role) {
        payload.role = location.role;
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

/**
 * Update member's live status in Firebase Realtime Database and Firestore
 */
export const updateUserStatusInFirestore = async (
    circleId: string,
    userId: string,
    status: string
): Promise<void> => {
    if (!circleId || !userId) return;
    try {
        await update(ref(database, `locations/${circleId}/${userId}`), {
            status,
            timestamp: Date.now()
        });
    } catch (err) {
        console.warn('[authService] Failed to update member status in RTDB:', err);
    }
    try {
        await setDoc(doc(db, 'users', userId), { liveStatus: status, lastStatusUpdate: Date.now() }, { merge: true });
    } catch (e) {}
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

/**
 * Subscribes to multiple circles' live locations simultaneously.
 */
export const subscribeToMultipleCirclesLocations = (
    circleIds: string[],
    callback: (circleId: string, locations: Record<string, MemberLocation>) => void
): (() => void) => {
    const unsubs: (() => void)[] = [];
    circleIds.forEach(cId => {
        const locationsRef = ref(database, `locations/${cId}`);
        onValue(locationsRef, (snapshot) => {
            callback(cId, snapshot.exists() ? snapshot.val() : {});
        });
        unsubs.push(() => off(locationsRef));
    });

    return () => {
        unsubs.forEach(unsub => unsub());
    };
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

export const subscribeToCircleMembers = (
    circleId: string,
    callback: (memberIds: string[]) => void
): (() => void) => {
    const circleMembersRef = ref(database, `circles/${circleId}/members`);

    onValue(circleMembersRef, (snapshot) => {
        if (snapshot.exists()) {
            const val = snapshot.val();
            const members = Array.isArray(val) ? val : Object.values(val);
            callback(members as string[]);
        } else {
            callback([]);
        }
    });

    return () => off(circleMembersRef);
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
