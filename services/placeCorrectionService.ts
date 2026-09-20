import { withDeadline } from '../utils/withDeadline';
// Place Correction Service - High-Precision Pin Relocation & Storefront Photo Crowdsourcing
import { Place, Location, EntranceType, EntrancePrecision, DestinationAccessPoint, AccessPointType } from '../types';
import { database, storage } from './firebase';
import { functions } from './firebase';
import { ref, set, get, onValue, off } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getDistanceMeters } from '../utils/geo';

export interface PlaceCorrection {
    placeId: string;
    placeName: string;
    description?: string;
    originalLocation: Location;
    correctedLocation: Location;
    correctedName?: string;
    correctedAddress?: string;
    category?: string;
    imageUrl?: string;
    entranceType?: EntranceType;
    entranceNotes?: string;
    entrancePrecision?: EntrancePrecision;
    timestamp: number;
    submittedBy?: string;
    submitterName?: string;
    submitterAvatar?: string;
    helpfulCount?: number;
    helpfulUserIds?: string[];
    normalizedKey: string;
}

const STORAGE_KEY = 'myway_place_corrections';
const STORAGE_KEY_ACCESS_POINTS = 'myway_destination_access_points';

/**
 * Normalizes a place name, description, and coordinate into a reliable lookup key
 */
export function normalizePlaceKey(name: string, description?: string, loc?: Location): string {
    const cleanName = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanDesc = (description || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    // Realtime Database path segments cannot contain dots. Keep the coordinate
    // precision used for stable matching while encoding decimal separators as
    // underscores so correction and access-point keys are valid everywhere.
    // Encode negative coordinates as `m` too. Realtime Database accepts the
    // old form, but the callable API deliberately only accepts safe path-key
    // characters, so a literal minus sign prevented western/southern places
    // from ever reaching Operations.
    const coordinateKey = (coordinate: number) => coordinate.toFixed(3)
        .replace('-', 'm')
        .replace('.', '_');
    const latStr = loc ? coordinateKey(loc.lat) : '';
    const lngStr = loc ? coordinateKey(loc.lng) : '';
    return `${cleanName}_${cleanDesc}_${latStr}_${lngStr}`;
}

/**
 * High-performance client-side image compressor.
 * Downscales images proportionally (maxDimension x maxDimension) and outputs compact JPEG/WebP.
 * Produces crisp ~80-140KB output that is ideal for Realtime DB or Cloud Storage.
 */
export async function compressImageFile(file: File, maxDimension: number = 1200, quality: number = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(readerEvent.target?.result as string);
                    return;
                }

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const mimeType = 'image/jpeg';
                const dataUrl = canvas.toDataURL(mimeType, quality);
                resolve(dataUrl);
            };
            img.onerror = () => reject(new Error('Failed to load image for compression'));
            img.src = readerEvent.target?.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
    });
}

class PlaceCorrectionService {
    private correctionsMap = new Map<string, PlaceCorrection>();
    private accessPointsMap = new Map<string, DestinationAccessPoint[]>();
    private isInitialized = false;
    private listeners = new Set<(corrections: Map<string, PlaceCorrection>) => void>();

    private getAccessPointKey(place: Place): string {
        const anchor = place.originalLocation || place.location;
        return normalizePlaceKey(place.name, place.description, anchor);
    }

    private accessPointId(type: AccessPointType, location: Location): string {
        const lat = location.lat.toFixed(5).replace('-', 'm').replace('.', '_');
        const lng = location.lng.toFixed(5).replace('-', 'm').replace('.', '_');
        return `ap_${type}_${lat}_${lng}`;
    }

    private dedupeAccessPoints(points: DestinationAccessPoint[]): DestinationAccessPoint[] {
        const sorted = [...points].sort((a, b) => {
            const confidenceRank = { high: 3, medium: 2, low: 1 };
            const confidenceDelta = confidenceRank[b.confidence] - confidenceRank[a.confidence];
            if (confidenceDelta !== 0) return confidenceDelta;
            const verificationDelta = (b.verifiedCount || 0) - (a.verifiedCount || 0);
            if (verificationDelta !== 0) return verificationDelta;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        return sorted.reduce<DestinationAccessPoint[]>((unique, point) => {
            const duplicate = unique.some(existing =>
                existing.type === point.type && getDistanceMeters(existing.location, point.location) < 12
            );
            if (!duplicate) unique.push(point);
            return unique;
        }, []);
    }

    constructor() {
        this.loadLocalCache();
        this.subscribeToFirebase();
    }

    public subscribe(listener: (corrections: Map<string, PlaceCorrection>) => void): () => void {
        this.listeners.add(listener);
        listener(this.correctionsMap);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(): void {
        this.listeners.forEach(fn => {
            try {
                fn(this.correctionsMap);
            } catch (err) {
                console.error('[PlaceCorrectionService] Listener notification error:', err);
            }
        });
    }

    private loadLocalCache(): void {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed: PlaceCorrection[] = JSON.parse(raw);
                parsed.forEach(c => {
                    this.correctionsMap.set(c.normalizedKey, c);
                    if (c.placeId) this.correctionsMap.set(c.placeId, c);
                });
            }
        } catch (e) {
            console.warn('[PlaceCorrectionService] Local cache load failed:', e);
        }

        try {
            const rawAp = localStorage.getItem(STORAGE_KEY_ACCESS_POINTS);
            if (rawAp) {
                const parsedAp: Record<string, DestinationAccessPoint[]> = JSON.parse(rawAp);
                Object.entries(parsedAp).forEach(([k, list]) => {
                    if (Array.isArray(list)) {
                        this.accessPointsMap.set(k, list);
                    }
                });
            }
        } catch (e) {
            console.warn('[PlaceCorrectionService] Local access points cache load failed:', e);
        }
    }

    private saveLocalCache(): void {
        if (typeof window === 'undefined') return;
        try {
            const list = Array.from(new Set(this.correctionsMap.values()));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn('[PlaceCorrectionService] Local cache save failed:', e);
        }

        try {
            const apObj: Record<string, DestinationAccessPoint[]> = {};
            this.accessPointsMap.forEach((list, k) => {
                apObj[k] = list;
            });
            localStorage.setItem(STORAGE_KEY_ACCESS_POINTS, JSON.stringify(apObj));
        } catch (e) {
            console.warn('[PlaceCorrectionService] Local access points cache save failed:', e);
        }
    }

    private subscribeToFirebase(): void {
        try {
            const correctionsRef = ref(database, 'place_corrections');
            onValue(correctionsRef, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    Object.values(data).forEach((raw: any) => {
                        if (raw && raw.normalizedKey && raw.correctedLocation) {
                            this.correctionsMap.set(raw.normalizedKey, raw);
                            if (raw.placeId) this.correctionsMap.set(raw.placeId, raw);
                        }
                    });
                    this.saveLocalCache();
                    this.notifyListeners();
                }
                this.isInitialized = true;
            });
        } catch (err) {
            console.warn('[PlaceCorrectionService] Realtime DB sync unavailable, using local store:', err);
            this.isInitialized = true;
        }

    }

    /**
     * Upload an image to Firebase Storage with automatic data URL fallback
     */
    public async uploadPlacePhoto(placeId: string, imageFileOrDataUrl: File | string): Promise<string> {
        if (typeof imageFileOrDataUrl === 'string') {
            return imageFileOrDataUrl;
        }

        try {
            const compressedDataUrl = await compressImageFile(imageFileOrDataUrl);
            // Attempt Firebase Storage upload
            const fileRef = storageRef(storage, `place_photos/${placeId}_${Date.now()}.jpg`);
            // Convert data url to blob
            const res = await fetch(compressedDataUrl);
            const blob = await res.blob();
            const uploadResult = await uploadBytes(fileRef, blob);
            return await getDownloadURL(uploadResult.ref);
        } catch (err) {
            console.warn('[PlaceCorrectionService] Cloud Storage upload failed, storing compressed Data URI fallback:', err);
            return typeof imageFileOrDataUrl === 'string'
                ? imageFileOrDataUrl
                : await compressImageFile(imageFileOrDataUrl);
        }
    }

    /**
     * Record a precision community user correction for an address or place pin
     */
    public async saveCorrection(params: {
        place: Place;
        correctedLocation: Location;
        correctedName?: string;
        correctedAddress?: string;
        category?: string;
        imageUrl?: string;
        entranceType?: EntranceType;
        entranceNotes?: string;
        entrancePrecision?: EntrancePrecision;
        userId?: string;
        submitterName?: string;
        submitterAvatar?: string;
    }): Promise<PlaceCorrection> {
        const { place, correctedLocation, correctedName, correctedAddress, category, imageUrl, entranceType, entranceNotes, entrancePrecision, userId, submitterName, submitterAvatar } = params;
        const anchorLocation = place.originalLocation || place.location;
        const normalizedKey = normalizePlaceKey(place.name, place.description, anchorLocation);

        // Check if existing correction exists to preserve helpful count & voters
        const existing = this.getCorrection(place);
        const helpfulCount = existing?.helpfulCount || 0;
        const helpfulUserIds = existing?.helpfulUserIds || [];

        const correction: PlaceCorrection = {
            placeId: place.id,
            placeName: place.name,
            description: place.description,
            originalLocation: anchorLocation,
            correctedLocation,
            correctedName,
            correctedAddress,
            category: category || place.type,
            imageUrl: imageUrl || place.imageUrl,
            entranceType: entranceType || place.entranceType,
            entranceNotes: entranceNotes || place.entranceNotes,
            entrancePrecision: entrancePrecision || place.entrancePrecision,
            timestamp: Date.now(),
            submittedBy: userId || 'community',
            submitterName: submitterName || 'MyWay Community',
            submitterAvatar: submitterAvatar || undefined,
            helpfulCount,
            helpfulUserIds,
            normalizedKey
        };

        // 1. Update in-memory Map
        this.correctionsMap.set(normalizedKey, correction);
        if (place.id) this.correctionsMap.set(place.id, correction);

        // 2. Persist locally
        this.saveLocalCache();
        this.notifyListeners();

        // 3. Persist to Firebase Realtime Database for all circle members / community
        try {
            const recordRef = ref(database, `place_corrections/${normalizedKey}`);
            await withDeadline(set(recordRef, correction));
        } catch (err) {
            console.warn('[PlaceCorrectionService] Firebase save skipped (offline/unreachable):', err);
        }

        return correction;
    }

    /**
     * Look up a correction for a given place
     */
    public getCorrection(place: Place): PlaceCorrection | null {
        // Direct ID lookup
        if (place.id && this.correctionsMap.has(place.id)) {
            return this.correctionsMap.get(place.id)!;
        }

        // Key lookup
        const key = normalizePlaceKey(place.name, place.description, place.location);
        if (this.correctionsMap.has(key)) {
            return this.correctionsMap.get(key)!;
        }

        // Proximity name match within 300m
        for (const correction of this.correctionsMap.values()) {
            if (correction.placeName.toLowerCase().trim() === place.name.toLowerCase().trim()) {
                const dist = getDistanceMeters(
                    place.location,
                    correction.originalLocation
                );
                if (dist < 300) {
                    return correction;
                }
            }
        }

        return null;
    }

    /**
     * Get verified access points for a place.
     * Guaranteed to never return simulated or guessed coordinates.
     */
    public getAccessPoints(place: Place): DestinationAccessPoint[] {
        const key = this.getAccessPointKey(place);
        
        let storedPoints: DestinationAccessPoint[] = [];

        if (this.accessPointsMap.has(key)) {
            storedPoints = [...this.accessPointsMap.get(key)!];
        } else if (place.id && this.accessPointsMap.has(place.id)) {
            storedPoints = [...this.accessPointsMap.get(place.id)!];
        } else {
            // Proximity lookup within 400m for matching place name
            const cleanTarget = (place.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const [k, list] of this.accessPointsMap.entries()) {
                const parts = k.split('_');
                if (parts[0] === cleanTarget && list.length > 0) {
                    const dist = getDistanceMeters(place.location, list[0].location);
                    if (dist < 400) {
                        storedPoints = [...list];
                        break;
                    }
                }
            }
        }

        // Also incorporate any verified entrance from single-pin PlaceCorrection
        const correction = this.getCorrection(place);
        if (correction && correction.correctedLocation) {
            const cType = correction.entranceType || place.entranceType || 'main_door';
            const apType: AccessPointType = 
                cType === 'curbside' ? 'curbside' :
                cType === 'drive_thru' ? (place.category === 'Pharmacy' ? 'pharmacy_drive_thru' : 'drive_thru') :
                (correction.entranceNotes?.toLowerCase().includes('auto') || correction.entranceNotes?.toLowerCase().includes('tire')) ? 'auto_care' :
                (correction.entranceNotes?.toLowerCase().includes('emergency') || correction.entranceNotes?.toLowerCase().includes('er')) ? 'emergency_dropoff' :
                (cType === 'parking' && (place.name.toLowerCase().includes('walmart') || place.name.toLowerCase().includes('hospital'))) ? 'parking' :
                'main_entrance';

            const apName = 
                apType === 'curbside' ? 'Curbside pickup' :
                apType === 'auto_care' ? 'Auto care' :
                apType === 'pharmacy_drive_thru' ? 'Pharmacy drive-thru' :
                apType === 'emergency_dropoff' ? 'Emergency drop-off' :
                apType === 'drive_thru' ? 'Drive-thru' :
                'Main entrance';

            const alreadyExists = storedPoints.some(p => p.type === apType || (Math.abs(p.location.lat - correction.correctedLocation.lat) < 0.0001 && Math.abs(p.location.lng - correction.correctedLocation.lng) < 0.0001));
            if (!alreadyExists) {
                storedPoints.push({
                    id: `ap_corr_${correction.normalizedKey}_${apType}`,
                    placeId: place.id,
                    name: apName,
                    type: apType,
                    location: correction.correctedLocation,
                    entranceType: cType,
                    notes: correction.entranceNotes,
                    imageUrl: correction.imageUrl,
                    source: 'community',
                    confidence: 'high',
                    verifiedCount: correction.helpfulCount || 1,
                    updatedAt: correction.timestamp
                });
            }
        }

        // A place-center pin is useful for routing, but must never be presented
        // as a verified entrance unless we have an explicit corrected entrance.
        const hasMain = storedPoints.some(p => p.type === 'main_entrance');
        if (!hasMain) {
            const hasVerifiedMainEntrance = Boolean(
                place.isCorrected && (place.entranceLocation || place.entrancePin || place.entrancePrecision?.location)
            );
            const mainLoc = hasVerifiedMainEntrance
                ? (place.entranceLocation || place.entrancePin || place.entrancePrecision!.location)
                : place.location;
            storedPoints.unshift({
                id: `ap_main_${place.id || 'default'}`,
                placeId: place.id,
                name: hasVerifiedMainEntrance ? 'Main entrance' : 'Main place pin',
                type: 'main_entrance',
                location: mainLoc,
                entranceType: 'main_door',
                notes: place.entranceNotes,
                source: hasVerifiedMainEntrance ? 'community' : 'osm',
                confidence: hasVerifiedMainEntrance ? 'high' : 'low'
            });
        }

        return this.dedupeAccessPoints(storedPoints);
    }

    /** Subscribe only to the current place's access points instead of the full community dataset. */
    public subscribeAccessPoints(place: Place, listener: (points: DestinationAccessPoint[]) => void): () => void {
        const key = this.getAccessPointKey(place);
        listener(this.getAccessPoints(place));

        try {
            const accessPointsRef = ref(database, `destination_access_points/${key}`);
            return onValue(accessPointsRef, (snapshot) => {
                const raw = snapshot.val();
                const approvedPoints = raw && typeof raw === 'object'
                    ? this.dedupeAccessPoints(Object.values(raw) as DestinationAccessPoint[])
                    : [];
                const localPendingPoints = (this.accessPointsMap.get(key) || []).filter(point => point.status === 'pending');
                const points = this.dedupeAccessPoints([...approvedPoints, ...localPendingPoints]);
                this.accessPointsMap.set(key, points);
                if (place.id) this.accessPointsMap.set(place.id, points);
                this.saveLocalCache();
                listener(this.getAccessPoints(place));
            }, (error) => {
                console.warn('[PlaceCorrectionService] Access point sync unavailable:', error);
                listener(this.getAccessPoints(place));
            });
        } catch (error) {
            console.warn('[PlaceCorrectionService] Access point subscription failed:', error);
            return () => undefined;
        }
    }

    /**
     * Save a verified Destination Access Point
     */
    public async saveAccessPoint(place: Place, ap: Omit<DestinationAccessPoint, 'id'>): Promise<DestinationAccessPoint> {
        const key = this.getAccessPointKey(place);

        const newPoint: DestinationAccessPoint = {
            ...ap,
            id: this.accessPointId(ap.type, ap.location),
            placeId: place.id,
            status: 'pending',
            updatedAt: Date.now()
        };

        const existingList = this.accessPointsMap.get(key) || [];
        const filtered = existingList.filter(p => p.id !== newPoint.id);
        filtered.push(newPoint);

        const merged = this.dedupeAccessPoints(filtered);
        this.accessPointsMap.set(key, merged);
        if (place.id) this.accessPointsMap.set(place.id, merged);

        this.saveLocalCache();
        this.notifyListeners();

        try {
            const result = await httpsCallable<
                { normalizedKey: string; accessPoint: DestinationAccessPoint & { placeName?: string; placeLocation?: Location } },
                { id: string; status: 'pending' | 'approved'; autoApproved?: boolean; verifiedCount?: number }
            >(functions, 'submitDestinationAccessPoint')({
                normalizedKey: key,
                accessPoint: {
                    ...newPoint,
                    placeName: place.name,
                    placeLocation: place.location
                }
            });
            if (result.data.status === 'approved') {
                newPoint.status = 'approved';
                newPoint.confidence = 'high';
                newPoint.verifiedCount = result.data.verifiedCount || newPoint.verifiedCount;
                this.saveLocalCache();
                this.notifyListeners();
            }
        } catch (err) {
            // Do not present a locally cached marker as a submitted shared
            // change. The caller needs a real failure so it can preserve the
            // form and tell the driver that Operations did not receive it.
            console.error('[PlaceCorrectionService] Access point submission failed:', err);
            this.accessPointsMap.set(key, existingList);
            if (place.id) this.accessPointsMap.set(place.id, existingList);
            this.saveLocalCache();
            this.notifyListeners();
            const message = err instanceof Error ? err.message : 'Could not submit this place update.';
            throw new Error(message);
        }

        return newPoint;
    }

    /**
     * Augments a list of places (search results or POIs) with any recorded user corrections.
     * Swaps in the corrected coordinates, photo, entrance notes, and verified status.
     */
    public applyCorrectionsToPlaces(places: Place[]): Place[] {
        if (!places || places.length === 0) return places;

        return places.map(p => {
            const correction = this.getCorrection(p);
            const accessPoints = this.getAccessPoints(p);

            if (!correction) {
                return {
                    ...p,
                    accessPoints
                };
            }

            return {
                ...p,
                name: correction.correctedName || p.name,
                description: correction.correctedAddress || p.description,
                address: correction.correctedAddress || p.address || p.description,
                originalLocation: p.location,
                location: correction.correctedLocation,
                imageUrl: correction.imageUrl || p.imageUrl,
                isCorrected: true,
                entranceType: correction.entranceType || p.entranceType,
                entranceNotes: correction.entranceNotes || p.entranceNotes,
                entranceLocation: correction.entrancePrecision?.location || p.entranceLocation,
                entrancePrecision: correction.entrancePrecision || p.entrancePrecision,
                accessPoints,
                correctedAt: correction.timestamp,
                submitterId: correction.submittedBy,
                submitterName: correction.submitterName,
                submitterAvatar: correction.submitterAvatar,
                helpfulCount: correction.helpfulCount || 0,
                helpfulUserIds: correction.helpfulUserIds || []
            };
        });
    }

    /**
     * Toggle "👍 Helpful" upvote on a place correction
     */
    public async toggleHelpful(place: Place, userId: string): Promise<number> {
        const correction = this.getCorrection(place);
        if (!correction) return 0;

        const userIds = Array.isArray(correction.helpfulUserIds) ? [...correction.helpfulUserIds] : [];
        const existingIndex = userIds.indexOf(userId);

        if (existingIndex >= 0) {
            userIds.splice(existingIndex, 1);
        } else {
            userIds.push(userId);
        }

        correction.helpfulUserIds = userIds;
        correction.helpfulCount = userIds.length;

        // Save to in-memory maps
        this.correctionsMap.set(correction.normalizedKey, correction);
        if (correction.placeId) this.correctionsMap.set(correction.placeId, correction);

        this.saveLocalCache();
        this.notifyListeners();

        // Persist to Firebase Realtime Database
        try {
            const recordRef = ref(database, `place_corrections/${correction.normalizedKey}`);
            await withDeadline(set(recordRef, correction));
        } catch (err) {
            console.warn('[PlaceCorrectionService] Failed to sync helpful upvote:', err);
        }

        return correction.helpfulCount;
    }
}

export const placeCorrectionService = new PlaceCorrectionService();
export default placeCorrectionService;
