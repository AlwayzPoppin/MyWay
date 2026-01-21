// Sponsored Places Service - Firebase-backed admin-managed sponsored locations
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { Place } from '../types';

export interface SponsoredPlace extends Place {
    brandColor: string;
    deal?: string;
    expiresAt?: Timestamp;
    isActive: boolean;
}

// Subscribe to active sponsored places
export const subscribeSponsoredPlaces = (
    callback: (places: SponsoredPlace[]) => void
): (() => void) => {
    const sponsoredRef = collection(db, 'sponsoredPlaces');
    const q = query(sponsoredRef, where('isActive', '==', true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const places: SponsoredPlace[] = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as SponsoredPlace));

        // Filter out expired places
        const now = Timestamp.now();
        const activePlaces = places.filter(p =>
            !p.expiresAt || p.expiresAt.toMillis() > now.toMillis()
        );

        callback(activePlaces);
    });

    return unsubscribe;
};

// Seed initial sponsored place (run once for demo purposes)
// In production, this would be managed via admin dashboard
export const seedSponsoredPlaces = async (): Promise<void> => {
    const { doc, setDoc, getDocs } = await import('firebase/firestore');

    const sponsoredRef = collection(db, 'sponsoredPlaces');
    const snapshot = await getDocs(sponsoredRef);

    if (!snapshot.empty) return; // Already seeded

    const defaultSponsored: Omit<SponsoredPlace, 'id'>[] = [
        {
            name: 'Shell Premium',
            location: { lat: 0, lng: 0 }, // To be updated via admin dashboard
            radius: 0.005,
            type: 'sponsored',
            icon: '⛽',
            brandColor: '#fbbf24',
            deal: '10¢ off/gal for Circle members',
            isActive: true
        }
    ];

    for (const place of defaultSponsored) {
        const docRef = doc(sponsoredRef);
        await setDoc(docRef, place);
    }
};
