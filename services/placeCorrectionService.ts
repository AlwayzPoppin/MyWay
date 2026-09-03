// Place Correction Service - High-Precision Pin Relocation & Storefront Photo Crowdsourcing
import { Place, Location, EntranceType } from '../types';
import { database, storage } from './firebase';
import { ref, set, get, onValue, off } from 'firebase/database';
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
    imageUrl?: string;
    entranceType?: EntranceType;
    entranceNotes?: string;
    timestamp: number;
    submittedBy?: string;
    submitterName?: string;
    submitterAvatar?: string;
    helpfulCount?: number;
    helpfulUserIds?: string[];
    normalizedKey: string;
}

const STORAGE_KEY = 'myway_place_corrections';

/**
 * Normalizes a place name, description, and coordinate into a reliable lookup key
 */
export function normalizePlaceKey(name: string, description?: string, loc?: Location): string {
    const cleanName = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanDesc = (description || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    const latStr = loc ? loc.lat.toFixed(3) : '';
    const lngStr = loc ? loc.lng.toFixed(3) : '';
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
    private isInitialized = false;
    private listeners = new Set<(corrections: Map<string, PlaceCorrection>) => void>();

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
    }

    private saveLocalCache(): void {
        if (typeof window === 'undefined') return;
        try {
            const list = Array.from(new Set(this.correctionsMap.values()));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn('[PlaceCorrectionService] Local cache save failed:', e);
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
        imageUrl?: string;
        entranceType?: EntranceType;
        entranceNotes?: string;
        userId?: string;
        submitterName?: string;
        submitterAvatar?: string;
    }): Promise<PlaceCorrection> {
        const { place, correctedLocation, correctedName, correctedAddress, imageUrl, entranceType, entranceNotes, userId, submitterName, submitterAvatar } = params;
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
            imageUrl: imageUrl || place.imageUrl,
            entranceType: entranceType || place.entranceType,
            entranceNotes: entranceNotes || place.entranceNotes,
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
            await set(recordRef, correction);
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
     * Augments a list of places (search results or POIs) with any recorded user corrections.
     * Swaps in the corrected coordinates, photo, entrance notes, and verified status.
     */
    public applyCorrectionsToPlaces(places: Place[]): Place[] {
        if (!places || places.length === 0) return places;

        return places.map(p => {
            const correction = this.getCorrection(p);
            if (!correction) return p;

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
            await set(recordRef, correction);
        } catch (err) {
            console.warn('[PlaceCorrectionService] Failed to sync helpful upvote:', err);
        }

        return correction.helpfulCount;
    }
}

export const placeCorrectionService = new PlaceCorrectionService();
export default placeCorrectionService;
