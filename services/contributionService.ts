// Contribution Service - Crowdsourced Reviews, Place Categories & Community Pins
import { db } from './firebase';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    getDocs,
    query,
    orderBy,
    limit,
    onSnapshot
} from 'firebase/firestore';
import { Place, Location, EntranceType } from '../types';

export type ContributionType = 'trip_review' | 'pin_correction' | 'place_category';

export interface TripContributionPayload {
    id?: string;
    tripId: string;
    destinationAddress: string;
    destinationName?: string;
    placeId?: string;
    rating: number;
    tags: string[];
    placeType: 'residential' | 'business' | null;
    isAccurate: boolean;
    correctedCoordinates?: [number, number]; // [longitude, latitude] as required for global map
    correctedLocation?: Location; // { lat, lng } helper
    type: ContributionType;
    timestamp: number;
    userId?: string;
    userName?: string;
    userAvatar?: string;
    entranceType?: EntranceType | string;
    imageUrl?: string;
}

export interface CommunityPinRecord {
    id: string;
    address: string;
    coordinates: [number, number]; // [longitude, latitude]
    lat: number;
    lng: number;
    name?: string;
    placeType?: 'residential' | 'business' | null;
    entranceType?: string;
    rating?: number;
    tags?: string[];
    imageUrl?: string;
    updatedAt: number;
    updatedBy: string;
    updaterName?: string;
}

const LOCAL_STORAGE_KEY_PREFIX = 'myway_user_contributions_';
const LOCAL_COMMUNITY_PINS_KEY = 'myway_community_pins_cache';

/**
 * Sanitizes an address string for use as a Firestore document ID.
 * Replaces slashes with dashes and normalizes whitespace while trimming length.
 */
export function sanitizeAddressDocId(address: string): string {
    if (!address || typeof address !== 'string') {
        return `unknown_addr_${Date.now()}`;
    }
    const clean = address
        .trim()
        .replace(/\//g, '-')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 1200);
    return clean || `addr_${Date.now()}`;
}

class ContributionService {
    private localCache = new Map<string, TripContributionPayload[]>();
    private communityPinsCache = new Map<string, CommunityPinRecord>();

    constructor() {
        this.loadCommunityPinsCache();
    }

    private getStorageKey(userId?: string): string {
        const uid = userId || 'anonymous_user';
        return `${LOCAL_STORAGE_KEY_PREFIX}${uid}`;
    }

    private loadLocalCache(userId?: string): TripContributionPayload[] {
        if (typeof window === 'undefined') return [];
        const key = this.getStorageKey(userId);
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.localCache.set(key, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn('[ContributionService] Local cache load error:', e);
        }
        return [];
    }

    private saveLocalCache(userId: string | undefined, list: TripContributionPayload[]): void {
        if (typeof window === 'undefined') return;
        const key = this.getStorageKey(userId);
        try {
            this.localCache.set(key, list);
            localStorage.setItem(key, JSON.stringify(list.slice(0, 100)));
        } catch (e) {
            console.warn('[ContributionService] Local cache save error:', e);
        }
    }

    private loadCommunityPinsCache(): void {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(LOCAL_COMMUNITY_PINS_KEY);
            if (raw) {
                const list: CommunityPinRecord[] = JSON.parse(raw);
                list.forEach(pin => {
                    if (pin.id) this.communityPinsCache.set(pin.id, pin);
                    if (pin.address) this.communityPinsCache.set(pin.address.toLowerCase(), pin);
                });
            }
        } catch (e) {
            console.warn('[ContributionService] Community pins cache load error:', e);
        }
    }

    private saveCommunityPinLocal(record: CommunityPinRecord): void {
        if (typeof window === 'undefined') return;
        try {
            this.communityPinsCache.set(record.id, record);
            if (record.address) this.communityPinsCache.set(record.address.toLowerCase(), record);
            const list = Array.from(new Set(this.communityPinsCache.values()));
            localStorage.setItem(LOCAL_COMMUNITY_PINS_KEY, JSON.stringify(list.slice(0, 200)));
        } catch (e) {
            console.warn('[ContributionService] Community pin local save error:', e);
        }
    }

    /**
     * Record a completed wizard contribution:
     * 1. Save to users/{userId}/contributions subcollection in Firestore.
     * 2. If corrected coordinates exist (Step 4), save to global community_pins collection.
     * 3. Always maintain offline localStorage fallback.
     */
    public async recordTripContribution(payload: TripContributionPayload): Promise<{
        contributionId: string;
        communityPinId?: string;
    }> {
        const timestamp = payload.timestamp || Date.now();
        const contributionId = payload.id || `contrib_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
        const userId = payload.userId || 'anonymous_user';

        const enrichedPayload: TripContributionPayload = {
            ...payload,
            id: contributionId,
            timestamp,
            userId,
            userName: payload.userName || 'Driver'
        };

        // 1. Update local cache immediately (0ms UI latency)
        const currentList = this.loadLocalCache(userId);
        const updatedList = [enrichedPayload, ...currentList.filter(c => c.id !== contributionId)];
        this.saveLocalCache(userId, updatedList);

        // 2. Write to Firestore subcollection: users/{userId}/contributions
        try {
            const userContribDocRef = doc(db, 'users', userId, 'contributions', contributionId);
            await setDoc(userContribDocRef, {
                id: contributionId,
                tripId: payload.tripId || `trip_${timestamp}`,
                destinationAddress: payload.destinationAddress,
                destinationName: payload.destinationName || payload.destinationAddress,
                placeId: payload.placeId || null,
                rating: payload.rating || 0,
                tags: payload.tags || [],
                placeType: payload.placeType || null,
                isAccurate: payload.isAccurate,
                type: payload.type,
                timestamp,
                userId,
                userName: payload.userName || 'Driver',
                userAvatar: payload.userAvatar || null,
                entranceType: payload.entranceType || null,
                imageUrl: payload.imageUrl || null,
                ...(payload.correctedCoordinates ? {
                    correctedCoordinates: payload.correctedCoordinates,
                    correctedLocation: payload.correctedLocation || {
                        lat: payload.correctedCoordinates[1],
                        lng: payload.correctedCoordinates[0]
                    }
                } : {})
            });
            console.log(`✅ [ContributionService] Saved contribution to users/${userId}/contributions/${contributionId}`);
        } catch (err) {
            console.warn(`⚠️ [ContributionService] Firestore user contribution write deferred/failed (using local cache):`, err);
        }

        // 3. Update global community_pins Firestore collection if pin was corrected (Step 4)
        let communityPinId: string | undefined;
        if (payload.correctedCoordinates && payload.correctedCoordinates.length === 2) {
            const [lng, lat] = payload.correctedCoordinates;
            const docId = sanitizeAddressDocId(payload.destinationAddress);
            communityPinId = docId;

            const pinRecord: CommunityPinRecord = {
                id: docId,
                address: payload.destinationAddress,
                coordinates: [lng, lat], // [longitude, latitude] as requested
                lat,
                lng,
                name: payload.destinationName || payload.destinationAddress,
                placeType: payload.placeType || null,
                entranceType: payload.entranceType || undefined,
                rating: payload.rating || undefined,
                tags: payload.tags || [],
                imageUrl: payload.imageUrl || undefined,
                updatedAt: timestamp,
                updatedBy: userId,
                updaterName: payload.userName || 'Driver'
            };

            this.saveCommunityPinLocal(pinRecord);

            try {
                const communityPinRef = doc(db, 'community_pins', docId);
                await setDoc(communityPinRef, {
                    id: docId,
                    address: payload.destinationAddress,
                    coordinates: [lng, lat], // [longitude, latitude]
                    lat,
                    lng,
                    name: payload.destinationName || payload.destinationAddress,
                    placeType: payload.placeType || null,
                    entranceType: payload.entranceType || null,
                    rating: payload.rating || null,
                    tags: payload.tags || [],
                    imageUrl: payload.imageUrl || null,
                    updatedAt: timestamp,
                    updatedBy: userId,
                    updaterName: payload.userName || 'Driver'
                }, { merge: true });
                console.log(`📍 [ContributionService] Saved global community pin to community_pins/${docId}: [${lng}, ${lat}]`);
            } catch (err) {
                console.warn(`⚠️ [ContributionService] Firestore community pin write skipped (offline/permission):`, err);
            }
        }

        return { contributionId, communityPinId };
    }

    /**
     * Retrieve contributions for a user from Firestore with local cache fallback
     */
    public async getUserContributions(userId?: string): Promise<TripContributionPayload[]> {
        const uid = userId || 'anonymous_user';
        const cached = this.loadLocalCache(uid);

        try {
            const collRef = collection(db, 'users', uid, 'contributions');
            const q = query(collRef, orderBy('timestamp', 'desc'), limit(50));
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                const remoteList: TripContributionPayload[] = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data() as TripContributionPayload;
                    remoteList.push({
                        ...data,
                        id: docSnap.id
                    });
                });

                // Merge remote with any un-synced local items
                const seen = new Set(remoteList.map(r => r.id));
                cached.forEach(localItem => {
                    if (localItem.id && !seen.has(localItem.id)) {
                        remoteList.push(localItem);
                    }
                });

                remoteList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                this.saveLocalCache(uid, remoteList);
                return remoteList;
            }
        } catch (err) {
            console.warn('[ContributionService] Failed to fetch remote contributions, using local cache:', err);
        }

        return cached;
    }

    /**
     * Real-time subscription to a user's contributions
     */
    public subscribeUserContributions(
        userId: string | undefined,
        callback: (items: TripContributionPayload[]) => void
    ): () => void {
        const uid = userId || 'anonymous_user';
        const cached = this.loadLocalCache(uid);
        callback(cached);

        try {
            const collRef = collection(db, 'users', uid, 'contributions');
            const q = query(collRef, orderBy('timestamp', 'desc'), limit(50));

            return onSnapshot(q, (snapshot) => {
                const items: TripContributionPayload[] = [];
                snapshot.forEach(docSnap => {
                    items.push({
                        ...(docSnap.data() as TripContributionPayload),
                        id: docSnap.id
                    });
                });
                if (items.length > 0) {
                    this.saveLocalCache(uid, items);
                    callback(items);
                }
            }, (error) => {
                console.warn('[ContributionService] Snapshot subscription error:', error);
            });
        } catch (err) {
            console.warn('[ContributionService] Subscribe error, using static local:', err);
            return () => {};
        }
    }

    /**
     * Look up community pin for an address from cache or Firestore.
     * Checks memory cache first, then Firestore community_pins collection using sanitizeAddressDocId(address).
     */
    public async getCommunityPin(address: string): Promise<CommunityPinRecord | null> {
        if (!address || typeof address !== 'string') return null;
        const trimmed = address.trim();
        if (!trimmed) return null;

        const normalized = trimmed.toLowerCase();
        if (this.communityPinsCache.has(normalized)) {
            return this.communityPinsCache.get(normalized)!;
        }

        const docId = sanitizeAddressDocId(trimmed);
        if (this.communityPinsCache.has(docId)) {
            return this.communityPinsCache.get(docId)!;
        }

        // Also check if stripped street name matches (e.g. "5604 Carson Dr" from "5604 Carson Dr, Fayetteville, NC")
        const streetPart = normalized.split(',')[0].trim();
        if (streetPart && this.communityPinsCache.has(streetPart)) {
            return this.communityPinsCache.get(streetPart)!;
        }

        // Query Firestore community_pins document directly
        try {
            const pinDocRef = doc(db, 'community_pins', docId);
            const docSnap = await getDoc(pinDocRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                const coords: [number, number] = Array.isArray(data.coordinates) && data.coordinates.length === 2
                    ? [data.coordinates[0], data.coordinates[1]]
                    : [data.lng ?? 0, data.lat ?? 0];

                const record: CommunityPinRecord = {
                    id: docSnap.id,
                    address: data.address || trimmed,
                    coordinates: coords, // [longitude, latitude]
                    lat: data.lat !== undefined ? data.lat : coords[1],
                    lng: data.lng !== undefined ? data.lng : coords[0],
                    name: data.name,
                    placeType: data.placeType,
                    entranceType: data.entranceType,
                    rating: data.rating,
                    tags: data.tags,
                    imageUrl: data.imageUrl,
                    updatedAt: data.updatedAt || Date.now(),
                    updatedBy: data.updatedBy || 'community',
                    updaterName: data.updaterName || 'Community'
                };
                this.saveCommunityPinLocal(record);
                return record;
            }

            // Fallback: If address had comma and city, try querying by base street address if docId was full address
            if (streetPart && streetPart !== normalized) {
                const baseDocId = sanitizeAddressDocId(streetPart);
                const baseDocRef = doc(db, 'community_pins', baseDocId);
                const baseSnap = await getDoc(baseDocRef);
                if (baseSnap.exists()) {
                    const data = baseSnap.data();
                    const coords: [number, number] = Array.isArray(data.coordinates) && data.coordinates.length === 2
                        ? [data.coordinates[0], data.coordinates[1]]
                        : [data.lng ?? 0, data.lat ?? 0];

                    const record: CommunityPinRecord = {
                        id: baseSnap.id,
                        address: data.address || streetPart,
                        coordinates: coords,
                        lat: data.lat !== undefined ? data.lat : coords[1],
                        lng: data.lng !== undefined ? data.lng : coords[0],
                        name: data.name,
                        placeType: data.placeType,
                        entranceType: data.entranceType,
                        rating: data.rating,
                        tags: data.tags,
                        imageUrl: data.imageUrl,
                        updatedAt: data.updatedAt || Date.now(),
                        updatedBy: data.updatedBy || 'community',
                        updaterName: data.updaterName || 'Community'
                    };
                    this.saveCommunityPinLocal(record);
                    return record;
                }
            }
        } catch (err) {
            console.debug('[ContributionService] Firestore community pin query skipped/failed:', err);
        }

        return null;
    }

    /**
     * Intercepts search results and overrides destination coordinates with community-verified data
     * from the community_pins collection.
     * Replaces standard lat/lng with community coordinates [lng, lat] and injects isCommunityVerified: true.
     */
    public async applyCommunityPinsToPlaces(places: Place[]): Promise<Place[]> {
        if (!places || places.length === 0) return places;

        return Promise.all(
            places.map(async (place) => {
                // Try address string first, then description, then place name
                const searchKeys = [
                    place.address,
                    place.description,
                    place.name
                ].filter((k): k is string => Boolean(k && typeof k === 'string' && k.trim().length > 0));

                let matchedPin: CommunityPinRecord | null = null;
                for (const key of searchKeys) {
                    matchedPin = await this.getCommunityPin(key);
                    if (matchedPin) break;
                }

                if (!matchedPin) {
                    return place;
                }

                const [lng, lat] = matchedPin.coordinates && matchedPin.coordinates.length === 2
                    ? matchedPin.coordinates
                    : [matchedPin.lng, matchedPin.lat];

                console.log(`📍 [CommunityOverride] Overriding "${place.name}" with community verified entrance pin: [${lat.toFixed(5)}, ${lng.toFixed(5)}]`);

                return {
                    ...place,
                    originalLocation: place.location,
                    location: { lat, lng },
                    isCommunityVerified: true,
                    isCorrected: true,
                    entranceType: (matchedPin.entranceType as any) || place.entranceType,
                    imageUrl: matchedPin.imageUrl || place.imageUrl,
                    rating: matchedPin.rating || place.rating
                };
            })
        );
    }
}

export const contributionService = new ContributionService();
export const applyCommunityPinsToPlaces = (places: Place[]) => contributionService.applyCommunityPinsToPlaces(places);
export default contributionService;
