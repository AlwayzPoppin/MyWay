// User Places Service - Firebase-backed user-defined places (Home, Work, etc.)
import { ref, set, get, push, remove, onValue, off } from 'firebase/database';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { database, db } from './firebase';
import { Place } from '../types';

export interface UserPlace extends Place {
    createdAt: number;
    createdBy: string;
    circleId?: string;
}

/**
 * Strips undefined properties recursively so Firebase RTDB and Firestore do not reject payloads
 */
function sanitizeForFirebase<T>(data: T): T {
    if (data === undefined) return null as any;
    if (data === null || typeof data !== 'object') return data;
    if (Array.isArray(data)) {
        return data.map(sanitizeForFirebase).filter(x => x !== undefined) as any;
    }
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            clean[key] = sanitizeForFirebase(value);
        }
    }
    return clean as T;
}

const normalizePlaceText = (value?: string): string =>
    (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const isSamePlaceLocation = (a: UserPlace, b: UserPlace): boolean => {
    if (!a.location || !b.location) return false;
    // About 35 m. Older releases sometimes saved a slightly different
    // rooftop/driveway coordinate into each mirrored copy.
    return Math.hypot(a.location.lat - b.location.lat, a.location.lng - b.location.lng) < 0.00032;
};

const isSameOwnerMirror = (a: UserPlace, b: UserPlace, userId?: string): boolean => {
    if (!userId || a.createdBy !== userId || b.createdBy !== userId || !isSamePlaceLocation(a, b)) return false;
    const aAddress = normalizePlaceText(a.address || a.description || a.location?.label);
    const bAddress = normalizePlaceText(b.address || b.description || b.location?.label);
    const aName = normalizePlaceText(a.name);
    const bName = normalizePlaceText(b.name);
    return Boolean((aAddress && aAddress === bAddress) || (aName && aName === bName));
};

const preferPlaceRecord = (current: UserPlace, candidate: UserPlace, personalKey: string): UserPlace => {
    const score = (place: UserPlace) =>
        (place.circleId === personalKey ? 4 : 0) +
        (place.address ? 2 : 0) +
        (place.radius ? 1 : 0) +
        (place.createdAt ? 1 : 0) +
        (place.createdBy ? 1 : 0);
    return score(candidate) > score(current) ? candidate : current;
};

/**
 * Subscribe to user places across multiple circles and the owner's personal
 * store. New saves are mirrored to both locations, so reconcile mirror copies
 * for display without deleting any existing user data.
 */
export const subscribeToUserPlacesMulti = (
    circleIds: string[],
    userId: string | undefined,
    callback: (places: UserPlace[]) => void
): (() => void) => {
    const validCircleIds = Array.from(new Set(circleIds.filter(id => !!id)));
    const placesMap: Record<string, UserPlace[]> = {};
    const unsubs: (() => void)[] = [];
    const personalKey = userId ? `user_${userId}` : '';

    const notifyCombined = () => {
        const uniquePlaces: UserPlace[] = [];

        Object.values(placesMap).flat().forEach(place => {
            const existingIndex = uniquePlaces.findIndex(existing =>
                // Same generated ID is a definite mirror copy.
                existing.id === place.id ||
                // Legacy different-ID mirrors require both ownership and a
                // matching saved-place identity. Other members' Homes remain
                // distinct even if they share the same address.
                isSameOwnerMirror(existing, place, userId)
            );
            if (existingIndex < 0) {
                uniquePlaces.push(place);
            } else {
                uniquePlaces[existingIndex] = preferPlaceRecord(uniquePlaces[existingIndex], place, personalKey);
            }
        });
        callback(uniquePlaces);
    };

    // 1. Subscribe to each circle's places
    validCircleIds.forEach(cId => {
        const placesRef = ref(database, `places/${cId}`);
        const listener = onValue(placesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const places: UserPlace[] = Object.entries(data).map(([id, place]: [string, any]) => ({
                    ...place,
                    id,
                    circleId: place.circleId || cId
                }));
                placesMap[cId] = places;
            } else {
                placesMap[cId] = [];
            }
            notifyCombined();
        });
        unsubs.push(() => off(placesRef, 'value', listener));
    });

    // 2. Also subscribe to personal user places store (places/user_${userId})
    if (userId) {
        const userPlacesKey = `user_${userId}`;
        const userPlacesRef = ref(database, `places/${userPlacesKey}`);
        const userListener = onValue(userPlacesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const places: UserPlace[] = Object.entries(data).map(([id, place]: [string, any]) => ({
                    ...place,
                    id,
                    circleId: place.circleId || 'personal',
                    // Early mobile releases did not persist createdBy in the
                    // personal mirror. This is in-memory metadata only.
                    createdBy: place.createdBy || userId
                }));
                placesMap[userPlacesKey] = places;
            } else {
                placesMap[userPlacesKey] = [];
            }
            notifyCombined();
        });
        unsubs.push(() => off(userPlacesRef, 'value', userListener));
    }

    return () => {
        unsubs.forEach(unsub => unsub());
    };
};

// Subscribe to user places for a single family circle (backward compatibility)
export const subscribeToUserPlaces = (
    circleId: string,
    callback: (places: UserPlace[]) => void
): (() => void) => {
    return subscribeToUserPlacesMulti([circleId], undefined, callback);
};

// Get user places once (non-realtime)
export const getUserPlaces = async (circleId: string): Promise<UserPlace[]> => {
    const placesRef = ref(database, `places/${circleId}`);
    const snapshot = await get(placesRef);

    if (!snapshot.exists()) return [];

    const data = snapshot.val();
    return Object.entries(data).map(([id, place]: [string, any]) => ({
        ...place,
        id,
        circleId: place.circleId || circleId
    }));
};

/**
 * Validates and sanitizes geofence radius.
 * Minimum allowed micro-geofence radius is 15 meters (0.015 km).
 * Keeps 50m (0.05 km) as the safe default if undefined or zero.
 */
export const sanitizeGeofenceRadius = (radius?: number | null): number => {
    if (radius === undefined || radius === null || isNaN(radius) || radius <= 0) {
        return 0.05; // 50m safe default
    }
    // If value is stored in meters (> 5)
    if (radius > 5) {
        return Math.max(15, Math.min(5000, radius));
    }
    // Stored in kilometers (<= 5)
    return Math.max(0.015, Math.min(5.0, radius));
};

// Add a new user place
export const addUserPlace = async (
    circleId: string,
    place: Omit<UserPlace, 'id' | 'createdAt'>,
    userId: string
): Promise<UserPlace> => {
    const targetCircleKey = circleId || (userId ? `user_${userId}` : 'default');
    const placesRef = ref(database, `places/${targetCircleKey}`);
    const newPlaceRef = push(placesRef);
    const id = newPlaceRef.key as string;

    const sanitizedRadius = sanitizeGeofenceRadius(place.radius);

    const placeWithMeta: UserPlace = {
        ...place,
        radius: sanitizedRadius,
        id,
        circleId: targetCircleKey,
        createdAt: Date.now(),
        createdBy: userId || 'local-user'
    };

    const cleanPayload = sanitizeForFirebase(placeWithMeta);

    // 1. Save to primary circle in Realtime Database
    await set(ref(database, `places/${targetCircleKey}/${id}`), cleanPayload);

    // 2. Also mirror to user personal places store so it persists regardless of circle switching
    if (userId && targetCircleKey !== `user_${userId}`) {
        try {
            await set(ref(database, `places/user_${userId}/${id}`), cleanPayload);
        } catch (e) {
            console.warn('[UserPlaces] Personal mirror save skipped:', e);
        }
    }

    // 3. Save to Firestore root 'places' collection and user subcollection
    if (db) {
        try {
            await setDoc(doc(db, 'places', id), cleanPayload);
            if (userId) {
                await setDoc(doc(db, 'users', userId, 'places', id), cleanPayload);
            }
            console.log(`📍 [UserPlaces] Successfully created Firestore place doc: places/${id}`);
        } catch (fsErr) {
            console.warn('[UserPlaces] Firestore place write fallback:', fsErr);
        }
    }

    return placeWithMeta;
};

// Update an existing user place across all associated circles and personal store
export const updateUserPlace = async (
    circleId: string,
    placeId: string,
    updates: Partial<Omit<UserPlace, 'id' | 'createdAt' | 'createdBy'>>,
    userId?: string,
    allCircleIds: string[] = []
): Promise<void> => {
    const sanitizedUpdates: typeof updates = { ...updates };
    if (updates.radius !== undefined) {
        sanitizedUpdates.radius = sanitizeGeofenceRadius(updates.radius);
    }
    const cleanUpdates = sanitizeForFirebase(sanitizedUpdates);

    const candidateTargets = Array.from(new Set([
        circleId,
        ...(userId ? [`user_${userId}`] : []),
        ...allCircleIds,
        'default'
    ].filter(Boolean)));

    let updatedAny = false;

    // 1. Search and update across all known targets where this place exists
    for (const targetKey of candidateTargets) {
        try {
            const placeRef = ref(database, `places/${targetKey}/${placeId}`);
            const snapshot = await get(placeRef);
            if (snapshot.exists()) {
                const existing = snapshot.val();
                await set(placeRef, { ...existing, ...cleanUpdates });
                updatedAny = true;
            }
        } catch (e) {
            console.warn(`[UserPlaces] Failed updating in ${targetKey}:`, e);
        }
    }

    // 2. Fallback: If not found in any existing snapshot, write directly to primary target and personal store
    if (!updatedAny && candidateTargets.length > 0) {
        const primaryTarget = candidateTargets[0];
        try {
            const placeRef = ref(database, `places/${primaryTarget}/${placeId}`);
            await set(placeRef, { id: placeId, ...cleanUpdates });
        } catch (e) {
            console.warn(`[UserPlaces] Failed writing fallback to ${primaryTarget}:`, e);
        }

        if (userId && primaryTarget !== `user_${userId}`) {
            try {
                const userPlaceRef = ref(database, `places/user_${userId}/${placeId}`);
                await set(userPlaceRef, { id: placeId, ...cleanUpdates });
            } catch (e) {
                console.warn(`[UserPlaces] Failed writing fallback to personal store:`, e);
            }
        }
    }

    // 3. Mirror updates to Firestore places collection
    if (db) {
        try {
            await setDoc(doc(db, 'places', placeId), cleanUpdates, { merge: true });
            if (userId) {
                await setDoc(doc(db, 'users', userId, 'places', placeId), cleanUpdates, { merge: true });
            }
        } catch (fsErr) {
            console.warn('[UserPlaces] Firestore update fallback:', fsErr);
        }
    }
};

/**
 * Broadcast place radius update across active circle WebSockets
 */
export const broadcastPlaceGeofenceUpdate = async (
    circleId: string,
    placeId: string,
    placeName: string,
    radiusMeters: number,
    updatedBy: string
): Promise<void> => {
    if (!circleId) return;
    try {
        const eventsRef = ref(database, `circle_events/${circleId}`);
        await push(eventsRef, {
            type: 'geofence_updated',
            placeId,
            placeName,
            radiusMeters,
            updatedBy,
            timestamp: Date.now()
        });
    } catch (e) {
        console.warn('[UserPlaces] Failed broadcasting geofence event:', e);
    }
};

// Delete a user place
export const deleteUserPlace = async (
    circleId: string,
    placeId: string,
    userId?: string,
    allCircleIds: string[] = []
): Promise<void> => {
    const targets = Array.from(new Set([
        circleId,
        'default',
        ...(userId ? [`user_${userId}`] : []),
        ...allCircleIds
    ].filter(Boolean)));

    for (const targetKey of targets) {
        try {
            await remove(ref(database, `places/${targetKey}/${placeId}`));
        } catch (e) {
            // Ignore if key didn't exist
        }
    }

    // Mirror deletion to Firestore places collection
    if (db) {
        try {
            await deleteDoc(doc(db, 'places', placeId));
            if (userId) {
                await deleteDoc(doc(db, 'users', userId, 'places', placeId));
            }
        } catch (fsErr) {
            console.warn('[UserPlaces] Firestore place delete fallback:', fsErr);
        }
    }
};


