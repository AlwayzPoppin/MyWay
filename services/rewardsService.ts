// Rewards Service - Fetch rewards from Firebase
import { ref, get, onValue, DataSnapshot } from 'firebase/database';
import { database } from './firebase';
import { Reward } from '../types';

// Get all available rewards
export const getRewards = async (): Promise<Reward[]> => {
    try {
        const rewardsRef = ref(database, 'rewards');
        const snapshot = await get(rewardsRef);

        if (!snapshot.exists()) {
            return [];
        }

        const rewardsData = snapshot.val();
        return Object.entries(rewardsData).map(([id, data]: [string, any]) => ({
            id,
            brand: data.brand,
            title: data.title,
            code: data.code,
            expiry: data.expiry,
            icon: data.icon || '🎁'
        }));
    } catch (error) {
        console.error('Failed to fetch rewards:', error);
        return [];
    }
};

// Subscribe to rewards updates in real-time
export const subscribeToRewards = (callback: (rewards: Reward[]) => void): (() => void) => {
    const rewardsRef = ref(database, 'rewards');

    const unsubscribe = onValue(rewardsRef, (snapshot: DataSnapshot) => {
        if (!snapshot.exists()) {
            callback([]);
            return;
        }

        const rewardsData = snapshot.val();
        const rewards: Reward[] = Object.entries(rewardsData).map(([id, data]: [string, any]) => ({
            id,
            brand: data.brand,
            title: data.title,
            code: data.code,
            expiry: data.expiry,
            icon: data.icon || '🎁'
        }));

        callback(rewards);
    });

    return unsubscribe;
};

// Seed initial rewards to Firebase (run once to populate)
export const seedRewards = async (): Promise<void> => {
    const { set } = await import('firebase/database');

    const sampleRewards = {
        r1: {
            brand: 'Starbucks',
            title: 'Buy One Get One Free',
            code: 'FAMILYCOFFEE',
            expiry: '2026-12-31',
            icon: '☕'
        },
        r2: {
            brand: 'Shell',
            title: '10¢ off per Gallon',
            code: 'FAMILYGAS',
            expiry: '2026-06-30',
            icon: '⛽'
        },
        r3: {
            brand: 'Chipotle',
            title: 'Free Guac with Entrée',
            code: 'FAMILYGUAC',
            expiry: '2026-03-31',
            icon: '🌯'
        }
    };

    await set(ref(database, 'rewards'), sampleRewards);
    console.log('Rewards seeded to Firebase!');
};
