// User Places Service - Firebase-backed user-defined places (Home, Work, etc.)
import { ref, set, get, push, remove, onValue, off } from 'firebase/database';
import { database } from './firebase';
import { Place } from '../types';

export interface UserPlace extends Place {
    createdAt: number;
    createdBy: string;
    circleId?: string;
}

/**
 * Subscribe to user places across multiple circles and user's personal store
 */
export const subscribeToUserPlacesMulti = (
    circleIds: string[],
    userId: string | undefined,
    callback: (places: UserPlace[]) => void
): (() => void) => {
    const validCircleIds = Array.from(new Set(circleIds.filter(id => !!id)));
    const placesMap: Record<string, UserPlace[]> = {};
    const unsubs: (() => void)[] = [];

    const notifyCombined = () => {
        const combinedMap = new Map<string, UserPlace>();

        Object.values(placesMap).forEach(list => {
            list.forEach(p => {
                // Deduplicate by place ID or exact name + lat/lng coordinate match
                const coordKey = `${p.name.toLowerCase().trim()}_${p.location.lat.toFixed(4)}_${p.location.lng.toFixed(4)}`;
                if (!combinedMap.has(p.id) && !combinedMap.has(coordKey)) {
                    combinedMap.set(p.id, p);
                    combinedMap.set(coordKey, p);
                }
            });
        });

        const uniquePlaces = Array.from(new Set(combinedMap.values()));
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
                    circleId: place.circleId || 'personal'
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
): Promise<string> => {
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

    // Save to primary circle
    await set(ref(database, `places/${targetCircleKey}/${id}`), placeWithMeta);

    // Also mirror to user personal places store so it persists regardless of circle switching
    if (userId && targetCircleKey !== `user_${userId}`) {
        try {
            await set(ref(database, `places/user_${userId}/${id}`), placeWithMeta);
        } catch (e) {
            console.warn('[UserPlaces] Personal mirror save skipped:', e);
        }
    }

    return id;
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
                await set(placeRef, { ...existing, ...sanitizedUpdates });
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
            await set(placeRef, { id: placeId, ...sanitizedUpdates });
        } catch (e) {
            console.warn(`[UserPlaces] Failed writing fallback to ${primaryTarget}:`, e);
        }

        if (userId && primaryTarget !== `user_${userId}`) {
            try {
                const userPlaceRef = ref(database, `places/user_${userId}/${placeId}`);
                await set(userPlaceRef, { id: placeId, ...sanitizedUpdates });
            } catch (e) {
                console.warn(`[UserPlaces] Failed writing fallback to personal store:`, e);
            }
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
};


