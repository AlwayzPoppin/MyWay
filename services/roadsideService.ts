import { db } from './firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { Location } from '../types';

export interface RoadsideRequest {
    id?: string;
    userId: string;
    location: Location;
    issue: 'tow' | 'tire' | 'battery' | 'fuel' | 'lockout' | 'other';
    status: 'pending' | 'dispatched' | 'completed' | 'cancelled';
    timestamp: any;
    provider?: {
        name: string;
        eta: string;
        phone?: string;
    };
}

const COLLECTION = 'roadside_requests';

/**
 * Request Roadside Assistance (Platinum Feature)
 */
export const requestRoadsideAssistance = async (
    userId: string,
    location: Location,
    issue: RoadsideRequest['issue']
): Promise<string> => {
    try {
        const docRef = await addDoc(collection(db, COLLECTION), {
            userId,
            location,
            issue,
            status: 'pending',
            timestamp: serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error('Roadside Assistance Error:', error);
        throw error;
    }
};

/**
 * Get active request status
 */
export const getActiveRoadsideRequest = async (userId: string): Promise<RoadsideRequest | null> => {
    try {
        const q = query(
            collection(db, COLLECTION),
            where('userId', '==', userId),
            where('status', 'in', ['pending', 'dispatched']),
            orderBy('timestamp', 'desc'),
            limit(1)
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;

        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as any;
    } catch (error) {
        console.error('Error fetching roadside request:', error);
        return null;
    }
};
