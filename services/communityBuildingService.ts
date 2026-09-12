/**
 * Community Building Service
 * Global Crowdsourced Residential & Commercial Rooftop Building Numbers
 * 
 * Bridges precision pin drops, user profile address verifications, and community edits
 * into a shared real-time map layer visible to all users without requiring a search.
 */

import { auth, database, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, set as setRtdb, onValue } from 'firebase/database';
import { doc, setDoc, collection, getDocs, query, where, limit } from 'firebase/firestore';
import { extractHouseNumber, extractStreetName } from '../utils/addressUtils';
import { encodeGeohash, isCoordinateInBounds, BoundingBox } from '../utils/geohash';

export interface CommunityBuilding {
    id: string;
    houseNumber: string;
    address: string;
    street?: string;
    coordinates: {
        lat: number;
        lng: number;
    };
    geohash?: string;
    verifiedAt: number;
    verifiedBy: string;
    source: 'pinpoint_verification' | 'user_profile' | 'place_correction' | 'saved_places';
    trustScore: number;
    isRooftop?: boolean;
    precision?: 'rooftop' | 'interpolated' | 'street' | 'intersection';
}

const STORAGE_KEY = 'myway_community_buildings_cache';

/**
 * Strips undefined properties recursively so Firebase RTDB does not reject payloads
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

class CommunityBuildingService {
    private buildingsMap = new Map<string, CommunityBuilding>();
    private listeners = new Set<(buildings: CommunityBuilding[]) => void>();

    constructor() {
        this.loadLocalCache();
        let stopRealtime: (() => void) | undefined;
        onAuthStateChanged(auth, user => {
            stopRealtime?.();
            stopRealtime = user ? this.subscribeToRealtimeDatabase() : undefined;
        });
    }

    private loadLocalCache(): void {
        if (typeof window === 'undefined') return;
        try {
            // 1. Primary community buildings cache
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed: CommunityBuilding[] = JSON.parse(raw);
                let hasStaleOrUnverified = false;
                parsed.forEach(b => {
                    const isStaleSeed = Boolean(b && b.id && b.id.startsWith('seed_'));
                    // Detect and purge unverified street/intersection labels (e.g. Carson Dr / Mesa Dr)
                    const isStreetOrIntersection = !b ||
                        b.isRooftop === false ||
                        b.precision === 'street' ||
                        b.precision === 'intersection' ||
                        /(\s&|\sand\s|\s\/\s|\sat\s)/i.test(b.address || '') ||
                        (b.source !== 'user_profile' && b.source !== 'pinpoint_verification' && !b.isRooftop && /(drive|dr|court|ct|road|rd|street|st|avenue|ave|lane|ln|way|blvd)\b/i.test(b.address || '') && !/building/i.test(b.address || ''));

                    if (b && b.id && !isStaleSeed && !isStreetOrIntersection && b.houseNumber && b.coordinates && typeof b.coordinates.lat === 'number' && typeof b.coordinates.lng === 'number') {
                        this.buildingsMap.set(b.id, b);
                    } else if (isStaleSeed || isStreetOrIntersection) {
                        hasStaleOrUnverified = true;
                    }
                });
                if (hasStaleOrUnverified) {
                    this.saveLocalCache();
                }
            }

            // 2. Hydrate user's verified precise home location if present
            const rawHome = localStorage.getItem('myway_precise_home_location');
            if (rawHome) {
                try {
                    const homeData = JSON.parse(rawHome);
                    const hn = homeData.houseNumber || extractHouseNumber(homeData.address || '');
                    const lat = homeData.coordinates?.lat ?? homeData.lat;
                    const lng = homeData.coordinates?.lng ?? homeData.lng;
                    if (hn && typeof lat === 'number' && typeof lng === 'number') {
                        const latFixed = Number(lat.toFixed(6));
                        const lngFixed = Number(lng.toFixed(6));
                        const geohash = encodeGeohash(latFixed, lngFixed, 8);
                        const id = `cb_${geohash.slice(0, 7)}_${hn.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                        if (!this.buildingsMap.has(id)) {
                            this.buildingsMap.set(id, {
                                id,
                                houseNumber: hn,
                                address: homeData.address || `${hn} Street`,
                                coordinates: { lat: latFixed, lng: lngFixed },
                                geohash,
                                verifiedAt: Date.now(),
                                verifiedBy: 'user_profile',
                                source: 'user_profile',
                                trustScore: 5,
                                isRooftop: true,
                                precision: 'rooftop'
                            });
                        }
                    }
                } catch (e) {
                    console.warn('[CommunityBuildingService] Error hydrating precise home location cache:', e);
                }
            }

            // 3. Hydrate saved user places with verified house numbers ONLY
            const rawPlaces = localStorage.getItem('myway_user_places');
            if (rawPlaces) {
                try {
                    const places = JSON.parse(rawPlaces);
                    if (Array.isArray(places)) {
                        places.forEach((p: any) => {
                            // ONLY hydrate if place is explicitly rooftop-verified or user-corrected
                            if (!p.isRooftop && !p.isCorrected) return;
                            if (p.geocodePrecision === 'street' || p.geocodePrecision === 'intersection') return;
                            const hn = p.houseNumber || extractHouseNumber(p.address || p.description || p.name || '');
                            const lat = p.location?.lat ?? p.coordinates?.lat ?? p.coordinates?.latitude ?? p.latitude ?? p.lat;
                            const lng = p.location?.lng ?? p.coordinates?.lng ?? p.coordinates?.longitude ?? p.longitude ?? p.lng;
                            if (hn && typeof lat === 'number' && typeof lng === 'number') {
                                const latFixed = Number(lat.toFixed(6));
                                const lngFixed = Number(lng.toFixed(6));
                                const geohash = encodeGeohash(latFixed, lngFixed, 8);
                                const id = `cb_${geohash.slice(0, 7)}_${hn.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                                if (!this.buildingsMap.has(id)) {
                                    this.buildingsMap.set(id, {
                                        id,
                                        houseNumber: hn,
                                        address: p.address || p.name || `${hn} Street`,
                                        coordinates: { lat: latFixed, lng: lngFixed },
                                        geohash,
                                        verifiedAt: Date.now(),
                                        verifiedBy: 'saved_places',
                                        source: 'place_correction',
                                        trustScore: 5,
                                        isRooftop: true,
                                        precision: 'rooftop'
                                    });
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[CommunityBuildingService] Error hydrating user places cache:', e);
                }
            }

            // Ensure merged cache is saved
            this.saveLocalCache();
        } catch (e) {
            console.warn('[CommunityBuildingService] Local storage load error:', e);
        }
    }

    private saveLocalCache(): void {
        if (typeof window === 'undefined') return;
        try {
            const list = Array.from(this.buildingsMap.values());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn('[CommunityBuildingService] Local storage save error:', e);
        }
    }

    private subscribeToRealtimeDatabase(): () => void {
        let active = true;
        let unsubscribe: (() => void) | undefined;
        try {
            if (database) {
                const bldRef = ref(database, 'community_buildings');
                unsubscribe = onValue(bldRef, snapshot => {
                    if (!active) return;
                    if (snapshot.exists()) {
                        const data = snapshot.val();
                        let hasNew = false;
                        Object.values(data).forEach((raw: any) => {
                            if (raw && raw.id && !raw.id.startsWith('seed_') && raw.houseNumber && raw.coordinates) {
                                this.buildingsMap.set(raw.id, raw);
                                hasNew = true;
                            }
                        });
                        if (hasNew) {
                            this.saveLocalCache();
                            this.notifyListeners();
                        }
                    }
                }, err => {
                    console.warn('[CommunityBuildingService] RTDB listener fallback:', err);
                });
            }
        } catch (err) {
            console.warn('[CommunityBuildingService] RTDB sync unavailable:', err);
        }

        // Resilient Firestore backup query
        if (db) {
            try {
                const q = query(
                    collection(db, 'public_map_reports'),
                    where('reportType', '==', 'verified_building'),
                    limit(100)
                );
                getDocs(q).then(snapshot => {
                    if (!active) return;
                    let hasNew = false;
                    snapshot.docs.forEach(docSnap => {
                        const data = docSnap.data();
                        const hn = data.houseNumber || extractHouseNumber(data.details || data.placeName || '');
                        if (hn && data.coordinates && typeof data.coordinates.lat === 'number' && typeof data.coordinates.lng === 'number') {
                            const latFixed = Number(data.coordinates.lat.toFixed(6));
                            const lngFixed = Number(data.coordinates.lng.toFixed(6));
                            const geohash = data.geohash || encodeGeohash(latFixed, lngFixed, 8);
                            const id = data.id || `cb_${geohash.slice(0, 7)}_${hn.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                            if (!this.buildingsMap.has(id)) {
                                this.buildingsMap.set(id, {
                                    id,
                                    houseNumber: hn,
                                    address: data.details || data.placeName || '',
                                    coordinates: { lat: latFixed, lng: lngFixed },
                                    geohash,
                                    verifiedAt: data.timestamp || Date.now(),
                                    verifiedBy: data.reportedBy || 'community',
                                    source: 'pinpoint_verification',
                                    trustScore: data.trustScore || 5
                                });
                                hasNew = true;
                            }
                        }
                    });
                    if (hasNew) {
                        this.saveLocalCache();
                        this.notifyListeners();
                    }
                }).catch(err => {
                    console.debug('[CommunityBuildingService] Firestore backup query notice:', err);
                });
            } catch (err) {
                console.debug('[CommunityBuildingService] Firestore fallback skipped:', err);
            }
        }
        return () => {
            active = false;
            unsubscribe?.();
        };
    }

    public subscribe(listener: (buildings: CommunityBuilding[]) => void): () => void {
        this.listeners.add(listener);
        listener(Array.from(this.buildingsMap.values()));
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(): void {
        const list = Array.from(this.buildingsMap.values());
        this.listeners.forEach(fn => {
            try {
                fn(list);
            } catch (err) {
                console.error('[CommunityBuildingService] Listener error:', err);
            }
        });
    }

    public getAllBuildings(): CommunityBuilding[] {
        return Array.from(this.buildingsMap.values());
    }

    public getBuildingsInViewport(bounds: BoundingBox): CommunityBuilding[] {
        return Array.from(this.buildingsMap.values()).filter(b =>
            isCoordinateInBounds(b.coordinates, bounds)
        );
    }

    /**
     * Synchronously register and cache a verified building number in memory and localStorage
     */
    public registerBuilding(params: {
        address: string;
        coordinates: { lat: number; lng: number };
        houseNumber?: string;
        street?: string;
        userId?: string;
        source?: 'pinpoint_verification' | 'user_profile' | 'place_correction';
        trustScore?: number;
        isRooftop?: boolean;
        precision?: 'rooftop' | 'interpolated' | 'street' | 'intersection';
    }): CommunityBuilding | null {
        // Reject unverified street-level or intersection matches
        if (params.isRooftop === false || params.precision === 'street' || params.precision === 'intersection') {
            return null;
        }
        if (/(\s&|\sand\s|\s\/\s|\sat\s)/i.test(params.address || '')) {
            return null;
        }

        const hn = params.houseNumber || extractHouseNumber(params.address);
        if (!hn || !params.coordinates || typeof params.coordinates.lat !== 'number' || typeof params.coordinates.lng !== 'number') {
            return null;
        }

        const latFixed = Number(params.coordinates.lat.toFixed(6));
        const lngFixed = Number(params.coordinates.lng.toFixed(6));
        const geohash = encodeGeohash(latFixed, lngFixed, 8);
        const id = `cb_${geohash.slice(0, 7)}_${hn.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        const existing = this.buildingsMap.get(id);
        if (existing && existing.houseNumber === hn) {
            return existing;
        }

        const streetName = params.street || extractStreetName(params.address) || '';
        const building: CommunityBuilding = {
            id,
            houseNumber: hn,
            address: params.address,
            ...(streetName ? { street: streetName } : {}),
            coordinates: { lat: latFixed, lng: lngFixed },
            geohash,
            verifiedAt: Date.now(),
            verifiedBy: params.userId || 'local_user',
            source: params.source || 'place_correction',
            trustScore: params.trustScore || 5,
            isRooftop: true,
            precision: 'rooftop'
        };

        this.buildingsMap.set(id, building);
        this.saveLocalCache();
        this.notifyListeners();
        return building;
    }

    /**
     * Publish or update a verified rooftop building number
     */
    public async publishVerifiedBuilding(params: {
        address: string;
        coordinates: { lat: number; lng: number };
        houseNumber?: string;
        street?: string;
        userId?: string;
        source?: 'pinpoint_verification' | 'user_profile' | 'place_correction';
        isRooftop?: boolean;
        precision?: 'rooftop' | 'interpolated' | 'street' | 'intersection';
    }): Promise<CommunityBuilding | null> {
        // Reject unverified street-level or intersection matches
        if (params.isRooftop === false || params.precision === 'street' || params.precision === 'intersection') {
            return null;
        }
        if (/(\s&|\sand\s|\s\/\s|\sat\s)/i.test(params.address || '')) {
            return null;
        }

        const hn = params.houseNumber || extractHouseNumber(params.address);
        if (!hn || !params.coordinates || typeof params.coordinates.lat !== 'number' || typeof params.coordinates.lng !== 'number') {
            console.warn('[CommunityBuildingService] Missing houseNumber or valid coordinates:', params);
            return null;
        }

        const latFixed = Number(params.coordinates.lat.toFixed(6));
        const lngFixed = Number(params.coordinates.lng.toFixed(6));
        const geohash = encodeGeohash(latFixed, lngFixed, 8);

        // Generate deterministic ID by coordinates to ensure one building per rooftop footprint
        const id = `cb_${geohash.slice(0, 7)}_${hn.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        const streetName = params.street || extractStreetName(params.address) || '';

        const building: CommunityBuilding = {
            id,
            houseNumber: hn,
            address: params.address,
            ...(streetName ? { street: streetName } : {}),
            coordinates: {
                lat: latFixed,
                lng: lngFixed
            },
            geohash,
            verifiedAt: Date.now(),
            verifiedBy: params.userId || 'community',
            source: params.source || 'pinpoint_verification',
            trustScore: 5,
            isRooftop: true,
            precision: 'rooftop'
        };

        // 1. Optimistic local cache update
        this.buildingsMap.set(id, building);
        this.saveLocalCache();
        this.notifyListeners();

        // 2. Persist to Firebase Realtime Database
        try {
            if (database) {
                const rtdbRef = ref(database, `community_buildings/${id}`);
                const sanitizedPayload = sanitizeForFirebase(building);
                await setRtdb(rtdbRef, sanitizedPayload);
                console.log(`🏠 [CommunityBuildingService] Published to RTDB: ${hn} at ${latFixed}, ${lngFixed}`);
            }
        } catch (err) {
            console.warn('[CommunityBuildingService] RTDB publish fallback:', err);
        }

        // 3. Mirror to Firestore public_map_reports for spatial indexing (best effort fallback)
        try {
            if (db) {
                const reportDocRef = doc(db, 'public_map_reports', id);
                await setDoc(reportDocRef, sanitizeForFirebase({
                    id,
                    reportType: 'verified_building',
                    coordinates: { lat: latFixed, lng: lngFixed },
                    geohash,
                    reportedBy: params.userId || 'community',
                    reporterName: 'MyWay Community',
                    timestamp: building.verifiedAt,
                    trustScore: building.trustScore,
                    upvoterIds: [params.userId || 'community'],
                    downvoterIds: [],
                    placeName: `Building ${hn}`,
                    details: params.address,
                    houseNumber: hn,
                    visibility: 'public'
                }));
            }
        } catch (err) {
            console.debug('[CommunityBuildingService] Firestore mirror skipped (RTDB is active):', err);
        }

        return building;
    }

    /**
     * Purges unverified street-level and intersection building labels from memory, localStorage, and listeners
     */
    public purgeStrayBuildings(
        validSavedPlaces?: Array<{ isRooftop?: boolean; isCorrected?: boolean; location?: { lat: number; lng: number } }>,
        preciseHomeLocation?: { lat: number; lng: number }
    ): void {
        let hasPurged = false;
        const validCoordsSet = new Set<string>();

        if (preciseHomeLocation && typeof preciseHomeLocation.lat === 'number' && typeof preciseHomeLocation.lng === 'number' && !(preciseHomeLocation.lat === 0 && preciseHomeLocation.lng === 0)) {
            validCoordsSet.add(`${preciseHomeLocation.lat.toFixed(4)}_${preciseHomeLocation.lng.toFixed(4)}`);
        }
        if (validSavedPlaces && Array.isArray(validSavedPlaces)) {
            validSavedPlaces.forEach(p => {
                if ((p.isRooftop || p.isCorrected) && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number') {
                    validCoordsSet.add(`${p.location.lat.toFixed(4)}_${p.location.lng.toFixed(4)}`);
                }
            });
        }

        for (const [id, b] of this.buildingsMap.entries()) {
            const isStaleSeed = id.startsWith('seed_');
            const isIntersection = /(\s&|\sand\s|\s\/\s|\sat\s)/i.test(b.address || '');
            const coordKey = b.coordinates ? `${b.coordinates.lat.toFixed(4)}_${b.coordinates.lng.toFixed(4)}` : '';
            const isExplicitUserHome = b.source === 'user_profile' && (validCoordsSet.size === 0 || validCoordsSet.has(coordKey));
            const isPinpointVerified = b.source === 'pinpoint_verification';
            const isSavedPlaceVerified = validCoordsSet.has(coordKey) && (b.isRooftop !== false);

            const isStray = isStaleSeed || 
                isIntersection || 
                b.isRooftop === false || 
                b.precision === 'street' || 
                b.precision === 'intersection' ||
                (!isExplicitUserHome && !isPinpointVerified && !isSavedPlaceVerified);

            if (isStray) {
                this.buildingsMap.delete(id);
                hasPurged = true;
            }
        }

        if (hasPurged) {
            this.saveLocalCache();
            this.notifyListeners();
        }
    }
}

export const communityBuildingService = new CommunityBuildingService();
export default communityBuildingService;
