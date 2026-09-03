// Place Photo Service - Secure Camera Contributions, Firestore & Firebase Storage Sync
import { db, storage } from './firebase';
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
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

export interface PlacePhotoContribution {
    id: string;
    placeId: string;
    placeName?: string;
    url: string;
    storagePath?: string;
    userId: string;
    userName?: string;
    userAvatar?: string;
    caption?: string;
    createdAt: number;
}

const LOCAL_STORAGE_PREFIX = 'myway_place_photos_';

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
                    url: data.url,
                    storagePath: data.storagePath,
                    userId: data.userId || 'anonymous',
                    userName: data.userName || 'Contributor',
                    userAvatar: data.userAvatar,
                    caption: data.caption || '',
                    createdAt: data.createdAt || Date.now()
                });
            });

            // Sort newest first
            photos.sort((a, b) => b.createdAt - a.createdAt);

            // Merge with any offline-saved local contributions not yet on Firestore
            const merged = this.mergeWithLocal(placeId, photos, cached);
            this.memoryCache.set(placeId, merged);
            this.saveLocalCache(placeId, merged);
            return merged;
        } catch (err) {
            console.warn('[PlacePhotoService] Firestore fetch failed, returning cached photos:', err);
            this.memoryCache.set(placeId, cached);
            return cached;
        }
    }

    /**
     * Upload captured camera image to Firebase Storage and save record to Firestore
     */
    public async uploadPhotoContribution(params: {
        placeId: string;
        placeName?: string;
        file: File;
        userId: string;
        userName?: string;
        userAvatar?: string;
        caption?: string;
    }): Promise<PlacePhotoContribution> {
        const { placeId, placeName, file, userId, userName, userAvatar, caption } = params;

        // 1. Compress image via canvas to maximum 1200px and 0.82 JPEG quality
        let compressedDataUrl: string;
        try {
            compressedDataUrl = await compressImageFile(file, 1200, 0.82);
        } catch (compErr) {
            console.warn('[PlacePhotoService] Image compression failed, reading original:', compErr);
            compressedDataUrl = await this.readFileAsDataUrl(file);
        }

        const timestamp = Date.now();
        const randId = Math.random().toString(36).substring(2, 8);
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
        let firestoreDocId = `local_${timestamp}_${randId}`;
        try {
            const docRef = await addDoc(collection(db, 'photos'), {
                placeId,
                placeName: placeName || '',
                url: downloadUrl,
                storagePath,
                userId: userId || 'anonymous',
                userName: userName || 'Contributor',
                userAvatar: userAvatar || '',
                caption: caption || '',
                createdAt: timestamp
            });
            firestoreDocId = docRef.id;
        } catch (firestoreErr) {
            console.warn('[PlacePhotoService] Firestore save failed, storing locally:', firestoreErr);
        }

        const newContribution: PlacePhotoContribution = {
            id: firestoreDocId,
            placeId,
            placeName,
            url: downloadUrl,
            storagePath,
            userId: userId || 'anonymous',
            userName: userName || 'Contributor',
            userAvatar,
            caption: caption || '',
            createdAt: timestamp
        };

        // 4. Update memory & local caches immediately
        const existing = this.memoryCache.get(placeId) || this.loadLocalCache(placeId);
        const updated = [newContribution, ...existing.filter(p => p.id !== newContribution.id)];
        this.memoryCache.set(placeId, updated);
        this.saveLocalCache(placeId, updated);

        return newContribution;
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
