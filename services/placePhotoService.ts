// Place Photo Service - Secure Camera Contributions, Firestore & Firebase Storage Sync
import { withDeadline } from '../utils/withDeadline';
import { db, storage } from './firebase';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import {
    collection,
    setDoc,
    getDocs,
    query,
    where,
    onSnapshot,
    deleteDoc,
    doc,
    updateDoc
} from 'firebase/firestore';
import {
    ref as storageRef,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { compressImageFile } from './placeCorrectionService';
import { Place } from '../types';

export interface PlacePhotoContribution {
    id: string;
    placeId: string;
    placeName?: string;
    /** The human-readable address supplied with the report for Operations review. */
    reportedAddress?: string;
    placeLocation?: { lat: number; lng: number } | null;
    url: string;
    storagePath?: string;
    userId: string;
    userName?: string;
    userAvatar?: string;
    caption?: string;
    createdAt: number;
    /** Pending photos are visible only to their contributor until Operations approves them. */
    reviewStatus?: 'pending' | 'approved' | 'rejected';
    /** False when the photo is retained locally and still needs a server retry. */
    isSynced?: boolean;
}

const LOCAL_STORAGE_PREFIX = 'myway_place_photos_';

/**
 * Search providers do not all return the same id for a building.  Use a
 * repeatable, location-based key for public place photos so a photo added from
 * one result is found when another circle member opens the same building.
 * A saved place can be opened from a different search provider later, so its
 * app-local id must not become the photo's lookup key.
 */
export const getPlacePhotoKey = (place: Pick<Place, 'id' | 'name' | 'location' | 'isSaved'>): string => {
    if (place.id.startsWith('demo-place-')) return place.id;
    const name = (place.name || 'place')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 70) || 'place';
    // Three decimals keep equivalent provider pins for one storefront together
    // (roughly a city block), while the normalized name prevents nearby places
    // from being merged into one gallery.
    return `community_${name}_${place.location.lat.toFixed(3)}_${place.location.lng.toFixed(3)}`;
};

class PlacePhotoService {
    private memoryCache = new Map<string, PlacePhotoContribution[]>();

    /**
     * Fetch photos for a place from Firestore with local cache fallback
     */
    public async getPhotosForPlace(placeId: string): Promise<PlacePhotoContribution[]> {
        if (!placeId) return [];

        // Check memory cache first
        if (this.memoryCache.has(placeId)) {
            return this.memoryCache.get(placeId)!;
        }

        // Check localStorage cache
        const cached = this.loadLocalCache(placeId);

        try {
            const q = query(
                collection(db, 'photos'),
                where('placeId', '==', placeId)
            );
            const snapshot = await getDocs(q);

            const photos: PlacePhotoContribution[] = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                photos.push({
                    id: docSnap.id,
                    placeId: data.placeId,
                    placeName: data.placeName || '',
                    reportedAddress: data.reportedAddress || data.placeName || '',
                    placeLocation: data.placeLocation || null,
                    url: data.url,
                    storagePath: data.storagePath,
                    userId: data.userId || 'anonymous',
                    userName: data.userName || 'Contributor',
                    userAvatar: data.userAvatar,
                    caption: data.caption || '',
                    createdAt: data.createdAt || Date.now(),
                isSynced: true,
                reviewStatus: data.reviewStatus || 'approved'
                });
            });

            // Sort newest first
            photos.sort((a, b) => b.createdAt - a.createdAt);

            // Merge with any offline-saved local contributions not yet on Firestore
            const merged = this.mergeWithLocal(placeId, photos.filter(photo => photo.reviewStatus !== 'pending' && photo.reviewStatus !== 'rejected'), cached);
            this.memoryCache.set(placeId, merged);
            this.saveLocalCache(placeId, merged);
            return merged;
        } catch (err) {
            console.warn('[PlacePhotoService] Firestore fetch failed, returning cached photos:', err);
            this.memoryCache.set(placeId, cached);
            return cached;
        }
    }

    /** Used by contribution history so pending photo submissions are visible to their author. */
    public async getPhotosForUser(userId?: string): Promise<PlacePhotoContribution[]> {
        if (!userId) return [];
        try {
            const snapshot = await getDocs(query(collection(db, 'photos'), where('userId', '==', userId)));
            return snapshot.docs.map(photo => {
                const data = photo.data();
                return {
                    id: photo.id,
                    placeId: data.placeId,
                    placeName: data.placeName || '',
                    reportedAddress: data.reportedAddress || data.placeName || '',
                    placeLocation: data.placeLocation || null,
                    url: data.url,
                    storagePath: data.storagePath,
                    userId: data.userId,
                    userName: data.userName,
                    userAvatar: data.userAvatar,
                    caption: data.caption || '',
                    createdAt: data.createdAt || Date.now(),
                    reviewStatus: data.reviewStatus || 'approved',
                    isSynced: true
                };
            }).sort((a, b) => b.createdAt - a.createdAt);
        } catch (error) {
            console.warn('[PlacePhotoService] Could not load contributor photos:', error);
            return [];
        }
    }

    /**
     * Keep an open place panel current when another Circle/community member
     * contributes a photo. The local cache remains the fallback when Firestore
     * is unavailable, so opening a place never depends on a push arriving.
     */
    public subscribeToPhotosForPlace(
        placeId: string,
        callback: (photos: PlacePhotoContribution[]) => void
    ): () => void {
        if (!placeId) {
            callback([]);
            return () => undefined;
        }

        const cached = this.memoryCache.get(placeId) || this.loadLocalCache(placeId);
        if (cached.length > 0) callback(cached);

        const photoQuery = query(collection(db, 'photos'), where('placeId', '==', placeId));
        return onSnapshot(photoQuery, (snapshot) => {
            const serverPhotos: PlacePhotoContribution[] = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                serverPhotos.push({
                    id: docSnap.id,
                    placeId: data.placeId,
                    placeName: data.placeName || '',
                    reportedAddress: data.reportedAddress || data.placeName || '',
                    placeLocation: data.placeLocation || null,
                    url: data.url,
                    storagePath: data.storagePath,
                    userId: data.userId || 'anonymous',
                    userName: data.userName || 'Contributor',
                    userAvatar: data.userAvatar,
                    caption: data.caption || '',
                    createdAt: data.createdAt || Date.now(),
                    isSynced: true,
                    reviewStatus: data.reviewStatus || 'approved'
                });
            });
            const merged = this.mergeWithLocal(placeId, serverPhotos.filter(photo => photo.reviewStatus !== 'pending' && photo.reviewStatus !== 'rejected'), this.loadLocalCache(placeId));
            this.memoryCache.set(placeId, merged);
            this.saveLocalCache(placeId, merged);
            callback(merged);
        }, (error) => {
            console.warn('[PlacePhotoService] Realtime photo subscription unavailable:', error);
            callback(cached);
        });
    }

    /**
     * Upload captured camera image to Firebase Storage and save record to Firestore
     */
    public async uploadPhotoContribution(params: {
        placeId: string;
        placeName?: string;
        reportedAddress?: string;
        placeLocation?: { lat: number; lng: number };
        file: File;
        userId: string;
        userName?: string;
        userAvatar?: string;
        caption?: string;
    }): Promise<PlacePhotoContribution> {
        const { placeId, placeName, reportedAddress, placeLocation, file, userId, userName, userAvatar, caption } = params;

        // 1. Compress image via canvas to maximum 1200px and 0.82 JPEG quality
        let compressedDataUrl: string;
        try {
            compressedDataUrl = await compressImageFile(file, 1200, 0.82);
        } catch (compErr) {
            console.warn('[PlacePhotoService] Image compression failed, reading original:', compErr);
            compressedDataUrl = await this.readFileAsDataUrl(file);
        }

        const timestamp = Date.now();
        // A UUID prevents same-millisecond photo submissions from ever sharing
        // a Firestore document ID. Keep a compact fallback for older browsers.
        const randId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).substring(2, 14);
        const fileName = `${placeId}_${timestamp}_${randId}.jpg`;
        const storagePath = `place_photos/${fileName}`;

        let downloadUrl = compressedDataUrl;

        // 2. Upload to Firebase Storage
        try {
            const fileReference = storageRef(storage, storagePath);
            const response = await fetch(compressedDataUrl);
            const blob = await response.blob();
            const uploadResult = await uploadBytes(fileReference, blob, {
                contentType: 'image/jpeg',
                customMetadata: {
                    placeId,
                    userId,
                    uploadedAt: String(timestamp)
                }
            });
            downloadUrl = await getDownloadURL(uploadResult.ref);
        } catch (storageErr) {
            console.warn('[PlacePhotoService] Firebase Storage upload failed, utilizing compressed Data URI:', storageErr);
        }

        // 3. Save metadata record to Firestore 'photos' collection
        let firestoreDocId = `photo_${timestamp}_${randId}`;
        let isSynced = false;
        let reviewStatus: 'pending' | 'approved' | 'rejected' = 'pending';
        try {
            const docRef = doc(db, 'photos', firestoreDocId);
            await withDeadline(setDoc(docRef, {
                placeId,
                placeName: placeName || '',
                reportedAddress: reportedAddress || placeName || '',
                placeLocation: placeLocation || null,
                url: downloadUrl,
                storagePath,
                userId: userId || 'anonymous',
                userName: userName || 'Contributor',
                userAvatar: userAvatar || '',
                caption: caption || '',
                createdAt: timestamp,
                reviewStatus: 'pending'
            }));
            firestoreDocId = docRef.id;
            isSynced = true;
            if (userId && userId !== 'anonymous') {
                const result = await httpsCallable<{ photoId: string }, { reviewStatus: 'pending' | 'approved' | 'rejected' }>(
                    functions,
                    'finalizeAdminCommunityPhoto'
                )({ photoId: firestoreDocId });
                reviewStatus = result.data.reviewStatus || 'pending';
            }
        } catch (firestoreErr) {
            console.warn('[PlacePhotoService] Firestore save failed, storing locally:', firestoreErr);
        }

        const newContribution: PlacePhotoContribution = {
            id: firestoreDocId,
            placeId,
            placeName,
            reportedAddress: reportedAddress || placeName,
            placeLocation,
            url: downloadUrl,
            storagePath,
            userId: userId || 'anonymous',
            userName: userName || 'Contributor',
            userAvatar,
            caption: caption || '',
            createdAt: timestamp,
            reviewStatus,
            isSynced
        };

        // 4. Update memory & local caches immediately
        const existing = this.memoryCache.get(placeId) || this.loadLocalCache(placeId);
        const updated = [newContribution, ...existing.filter(p => p.id !== newContribution.id)];
        this.memoryCache.set(placeId, updated);
        this.saveLocalCache(placeId, updated);

        return newContribution;
    }

    /** Replays locally retained photo contributions once the device is online. */
    public async retryPendingContributions(): Promise<number> {
        if (typeof window === 'undefined' || navigator.onLine === false) return 0;
        const placeIds = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
            .filter((key): key is string => Boolean(key?.startsWith(LOCAL_STORAGE_PREFIX)))
            .map(key => key.slice(LOCAL_STORAGE_PREFIX.length));
        let syncedCount = 0;

        for (const placeId of placeIds) {
            const photos = this.loadLocalCache(placeId);
            let changed = false;
            const updated = await Promise.all(photos.map(async photo => {
                if (photo.isSynced !== false) return photo;
                try {
                    let url = photo.url;
                    if (url.startsWith('data:')) {
                        const fileReference = storageRef(storage, photo.storagePath || `place_photos/${photo.id}.jpg`);
                        const response = await fetch(url);
                        const blob = await response.blob();
                        const result = await uploadBytes(fileReference, blob, { contentType: 'image/jpeg' });
                        url = await getDownloadURL(result.ref);
                    }
                    await withDeadline(setDoc(doc(db, 'photos', photo.id), {
                        placeId: photo.placeId,
                        placeName: photo.placeName || '',
                        reportedAddress: photo.reportedAddress || photo.placeName || '',
                        placeLocation: (photo as any).placeLocation || null,
                        url,
                        storagePath: photo.storagePath || '',
                        userId: photo.userId,
                        userName: photo.userName || 'Contributor',
                        userAvatar: photo.userAvatar || '',
                        caption: photo.caption || '',
                        createdAt: photo.createdAt,
                        reviewStatus: photo.reviewStatus || 'pending'
                    }));
                    changed = true;
                    syncedCount += 1;
                    return { ...photo, url, isSynced: true, reviewStatus: photo.reviewStatus || 'pending' };
                } catch (error) {
                    console.warn('[PlacePhotoService] Pending photo retry failed:', error);
                    return photo;
                }
            }));
            if (changed) {
                this.memoryCache.set(placeId, updated);
                this.saveLocalCache(placeId, updated);
            }
        }
        return syncedCount;
    }

    /**
     * Update caption for an existing photo contribution in Firestore
     */
    public async updatePhotoCaption(photoId: string, placeId: string, caption: string): Promise<void> {
        // Update in Firestore
        if (!photoId.startsWith('local_')) {
            try {
                const photoRef = doc(db, 'photos', photoId);
                await updateDoc(photoRef, { caption, updatedAt: Date.now() });
            } catch (err) {
                console.warn('[PlacePhotoService] Firestore caption update failed:', err);
            }
        }

        // Update in memory and local caches
        const list = this.memoryCache.get(placeId) || this.loadLocalCache(placeId);
        const updated = list.map(item => item.id === photoId ? { ...item, caption } : item);
        this.memoryCache.set(placeId, updated);
        this.saveLocalCache(placeId, updated);
    }

    /**
     * Contributor identity is displayed alongside every photo, so it must keep
     * pace with profile edits instead of preserving the upload-time name.
     */
    public async refreshContributorIdentity(userId: string, userName: string, userAvatar?: string): Promise<number> {
        const name = userName.trim().slice(0, 80) || 'Contributor';
        const identity = { userName: name, userAvatar: userAvatar || '', contributorUpdatedAt: Date.now() };
        let updatedCount = 0;

        try {
            const authoredPhotos = await getDocs(query(collection(db, 'photos'), where('userId', '==', userId)));
            const results = await Promise.allSettled(authoredPhotos.docs.map(photo => updateDoc(photo.ref, identity)));
            updatedCount = results.filter(result => result.status === 'fulfilled').length;
            results.forEach(result => {
                if (result.status === 'rejected') console.warn('[PlacePhotoService] Contributor identity update failed:', result.reason);
            });
        } catch (error) {
            // Profile updates remain valid if the user is offline; loaded and
            // locally cached cards are still updated below.
            console.warn('[PlacePhotoService] Could not refresh contributor identity in Firestore:', error);
        }

        this.memoryCache.forEach((photos, placeId) => {
            const refreshed = photos.map(photo => photo.userId === userId ? { ...photo, userName: name, userAvatar: userAvatar || '' } : photo);
            this.memoryCache.set(placeId, refreshed);
        });
        if (typeof window !== 'undefined') {
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (!key?.startsWith(LOCAL_STORAGE_PREFIX)) continue;
                const placeId = key.slice(LOCAL_STORAGE_PREFIX.length);
                const photos = this.loadLocalCache(placeId);
                if (photos.some(photo => photo.userId === userId)) {
                    this.saveLocalCache(placeId, photos.map(photo => photo.userId === userId ? { ...photo, userName: name, userAvatar: userAvatar || '' } : photo));
                }
            }
        }
        return updatedCount;
    }

    /**
     * Delete a photo document from Firestore and delete image file from Firebase Storage
     */
    public async deletePhotoContribution(photo: PlacePhotoContribution): Promise<void> {
        const { id, placeId, storagePath } = photo;

        // 1. Delete from Firestore
        if (!id.startsWith('local_')) {
            try {
                const photoRef = doc(db, 'photos', id);
                await deleteDoc(photoRef);
            } catch (firestoreErr) {
                console.warn('[PlacePhotoService] Firestore photo document delete failed:', firestoreErr);
                // Do not pretend a withdrawal succeeded while Operations can
                // still review or publish the photo.
                throw firestoreErr;
            }
        }

        // 2. Delete from Firebase Storage if storagePath exists
        if (storagePath) {
            try {
                const fileRef = storageRef(storage, storagePath);
                await deleteObject(fileRef);
            } catch (storageErr) {
                console.warn('[PlacePhotoService] Firebase Storage object delete failed or already removed:', storageErr);
            }
        }

        // 3. Update memory & local caches immediately
        const list = this.memoryCache.get(placeId) || this.loadLocalCache(placeId);
        const updated = list.filter(item => item.id !== id);
        this.memoryCache.set(placeId, updated);
        this.saveLocalCache(placeId, updated);
    }

    /**
     * Withdraw an authored photo through the server so Firebase Storage cleanup
     * does not depend on browser CORS. The callable also removes its linked
     * contribution-history record.
     */
    public async withdrawPhotoContribution(photo: PlacePhotoContribution): Promise<void> {
        if (!photo.id.startsWith('local_')) {
            await httpsCallable<{ photoId: string }, void>(functions, 'withdrawCommunityPhoto')({ photoId: photo.id });
        }

        const list = this.memoryCache.get(photo.placeId) || this.loadLocalCache(photo.placeId);
        const updated = list.filter(item => item.id !== photo.id);
        this.memoryCache.set(photo.placeId, updated);
        this.saveLocalCache(photo.placeId, updated);
    }

    private readFileAsDataUrl(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    private loadLocalCache(placeId: string): PlacePhotoContribution[] {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + placeId);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    private saveLocalCache(placeId: string, photos: PlacePhotoContribution[]): void {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(LOCAL_STORAGE_PREFIX + placeId, JSON.stringify(photos));
        } catch (e) {
            console.warn('[PlacePhotoService] Local storage save failed:', e);
        }
    }

    private mergeWithLocal(
        placeId: string,
        serverPhotos: PlacePhotoContribution[],
        cachedPhotos: PlacePhotoContribution[]
    ): PlacePhotoContribution[] {
        const map = new Map<string, PlacePhotoContribution>();
        // Add server photos first
        serverPhotos.forEach(p => map.set(p.id, p));
        // Add any local photos that might be pending or offline
        cachedPhotos.forEach(p => {
            if (!map.has(p.id)) {
                map.set(p.id, p);
            }
        });
        return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
}

export const placePhotoService = new PlacePhotoService();
