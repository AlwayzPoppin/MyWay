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

    const placeWithMeta: UserPlace = {
        ...place,
        id,
        circleId: targetCircleKey,
        createdAt: Date.now(),
        createdBy: userId
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

// Update an existing user place
export const updateUserPlace = async (
    circleId: string,
    placeId: string,
    updates: Partial<Omit<UserPlace, 'id' | 'createdAt' | 'createdBy'>>,
    userId?: string
): Promise<void> => {
    const targetCircleKey = circleId || (userId ? `user_${userId}` : 'default');
    const placeRef = ref(database, `places/${targetCircleKey}/${placeId}`);
    const snapshot = await get(placeRef);

    if (snapshot.exists()) {
        const existing = snapshot.val();
        await set(placeRef, { ...existing, ...updates });
    }

    if (userId) {
        const userPlaceRef = ref(database, `places/user_${userId}/${placeId}`);
        const userSnapshot = await get(userPlaceRef);
        if (userSnapshot.exists()) {
            const existingUser = userSnapshot.val();
            await set(userPlaceRef, { ...existingUser, ...updates });
        }
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


