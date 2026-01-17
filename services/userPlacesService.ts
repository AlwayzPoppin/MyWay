// User Places Service - Firebase-backed user-defined places (Home, Work, etc.)
import { ref, set, get, push, remove, onValue, off } from 'firebase/database';
import { database } from './firebase';
import { Place } from '../types';

export interface UserPlace extends Place {
    createdAt: number;
    createdBy: string;
}

// Subscribe to user places for a family circle
export const subscribeToUserPlaces = (
    circleId: string,
    callback: (places: UserPlace[]) => void
): (() => void) => {
    const placesRef = ref(database, `places/${circleId}`);

    onValue(placesRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            const places: UserPlace[] = Object.entries(data).map(([id, place]: [string, any]) => ({
                ...place,
                id
            }));
            callback(places);
        } else {
            callback([]);
        }
    });

    return () => off(placesRef);
};

// Get user places once (non-realtime)
export const getUserPlaces = async (circleId: string): Promise<UserPlace[]> => {
    const placesRef = ref(database, `places/${circleId}`);
    const snapshot = await get(placesRef);

    if (!snapshot.exists()) return [];

    const data = snapshot.val();
    return Object.entries(data).map(([id, place]: [string, any]) => ({
        ...place,
        id
    }));
};

// Add a new user place
export const addUserPlace = async (
    circleId: string,
    place: Omit<UserPlace, 'id' | 'createdAt'>,
    userId: string
): Promise<string> => {
    const placesRef = ref(database, `places/${circleId}`);
    const newPlaceRef = push(placesRef);
    const id = newPlaceRef.key as string;

    const placeWithMeta: UserPlace = {
        ...place,
        id,
        createdAt: Date.now(),
        createdBy: userId
    };

    await set(ref(database, `places/${circleId}/${id}`), placeWithMeta);
    return id;
};

// Update an existing user place
export const updateUserPlace = async (
    circleId: string,
    placeId: string,
    updates: Partial<Omit<UserPlace, 'id' | 'createdAt' | 'createdBy'>>
): Promise<void> => {
    const placeRef = ref(database, `places/${circleId}/${placeId}`);
    const snapshot = await get(placeRef);

    if (!snapshot.exists()) {
        throw new Error('Place not found');
    }

    const existing = snapshot.val();
    await set(placeRef, { ...existing, ...updates });
};

// Delete a user place
export const deleteUserPlace = async (
    circleId: string,
    placeId: string
): Promise<void> => {
    await remove(ref(database, `places/${circleId}/${placeId}`));
};

// Seed default places for a new circle (called once when circle is created)
export const seedDefaultPlaces = async (
    circleId: string,
    userId: string,
    userLocation?: { lat: number; lng: number }
): Promise<void> => {
    const existingPlaces = await getUserPlaces(circleId);
    if (existingPlaces.length > 0) return; // Already has places

    const defaultLocation = userLocation || { lat: 35.2271, lng: -80.8431 };

    const defaultPlaces: Omit<UserPlace, 'id' | 'createdAt'>[] = [
        {
            name: 'Home',
            location: defaultLocation,
            radius: 0.003,
            type: 'home',
            icon: '🏠',
            createdBy: userId
        }
    ];

    for (const place of defaultPlaces) {
        await addUserPlace(circleId, place, userId);
    }
};
