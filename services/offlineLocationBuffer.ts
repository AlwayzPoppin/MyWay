/**
 * Offline Location Buffer Service
 * Queues location updates during signal loss and syncs them
 * chronologically once connectivity is restored.
 * 
 * Uses IndexedDB for persistence — survives app restarts.
 */

import { offlineMapService, computeRadiusBounds } from './offlineMapService';
import { getDistanceFromCoords } from '../utils/geo';

export interface BufferedLocation {
    id?: number;
    lat: number;
    lng: number;
    accuracy: number;
    speed: number | null;
    heading: number | null;
    timestamp: number;
    userId: string;
    circleId?: string;
    battery?: number;
    signalQuality?: string;
    status?: string;
    privacyMode?: string;
    encryptedData?: any;
}

const DB_NAME = 'myway-offline';
const STORE_NAME = 'location-buffer';
const DB_VERSION = 3;

let isFlushing = false;

/**
 * Open (or create) the IndexedDB database
 */
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('userId', 'userId', { unique: false });
            }
            if (!db.objectStoreNames.contains('message-buffer')) {
                const msgStore = db.createObjectStore('message-buffer', { keyPath: 'id', autoIncrement: true });
                msgStore.createIndex('timestamp', 'timestamp', { unique: false });
                msgStore.createIndex('circleId', 'circleId', { unique: false });
            }
            if (!db.objectStoreNames.contains('sos-buffer')) {
                const sosStore = db.createObjectStore('sos-buffer', { keyPath: 'id', autoIncrement: true });
                sosStore.createIndex('timestamp', 'timestamp', { unique: false });
                sosStore.createIndex('userId', 'userId', { unique: false });
                sosStore.createIndex('circleId', 'circleId', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const MAX_LOCATION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours TTL
const MAX_LOCATION_BUFFER_SIZE = 300; // 300 points max FIFO

/**
 * Evict locations older than 24 hours or exceeding the 300-point buffer limit
 */
export const evictStaleLocations = async (): Promise<number> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');

        const cutoffTime = Date.now() - MAX_LOCATION_AGE_MS;
        const range = IDBKeyRange.upperBound(cutoffTime);

        let evictedCount = 0;
        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                cursor.delete();
                evictedCount++;
                cursor.continue();
            }
        };

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });

        // Overflow FIFO eviction if count exceeds limit
        const currentCount = await getBufferCount();
        if (currentCount > MAX_LOCATION_BUFFER_SIZE) {
            const overflow = currentCount - MAX_LOCATION_BUFFER_SIZE;
            const tx2 = db.transaction(STORE_NAME, 'readwrite');
            const store2 = tx2.objectStore(STORE_NAME);
            const index2 = store2.index('timestamp');
            let deleted = 0;
            const curReq = index2.openCursor();
            curReq.onsuccess = (e) => {
                const cur = (e.target as IDBRequest).result as IDBCursorWithValue;
                if (cur && deleted < overflow) {
                    cur.delete();
                    deleted++;
                    cur.continue();
                }
            };
            await new Promise<void>((resolve, reject) => {
                tx2.oncomplete = () => resolve();
                tx2.onerror = () => reject(tx2.error);
            });
            evictedCount += deleted;
        }

        if (evictedCount > 0) {
            console.log(`📦 Evicted ${evictedCount} stale/overflow offline locations`);
        }
        return evictedCount;
    } catch (err) {
        console.error('📦 Failed to evict stale locations:', err);
        return 0;
    }
};

/**
 * Queue a location update for later sync
 * Call this when the Firebase write fails due to network issues
 */
export const bufferLocation = async (location: BufferedLocation): Promise<void> => {
    try {
        await evictStaleLocations();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).add(location);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        console.log(`📦 Buffered offline location (${new Date(location.timestamp).toLocaleTimeString()})`);
    } catch (err) {
        console.error('📦 Failed to buffer location:', err);
    }
};

/**
 * Get all buffered locations, ordered by timestamp
 */
export const getBufferedLocations = async (): Promise<BufferedLocation[]> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const index = tx.objectStore(STORE_NAME).index('timestamp');

        return new Promise((resolve, reject) => {
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('📦 Failed to read buffer:', err);
        return [];
    }
};

/**
 * Remove a single buffered location by its primary key ID
 */
export const removeBufferedLocation = async (id: number): Promise<void> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error(`📦 Failed to remove buffered location ${id}:`, err);
    }
};

/**
 * Remove multiple buffered locations by IDs in a single transaction
 */
export const removeBufferedLocationsBatch = async (ids: number[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const id of ids) {
            store.delete(id);
        }
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error('📦 Failed to remove buffered location batch:', err);
    }
};

/**
 * Clear all buffered locations after successful sync
 */
export const clearBuffer = async (): Promise<void> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        console.log('📦 Offline buffer cleared after sync');
    } catch (err) {
        console.error('📦 Failed to clear buffer:', err);
    }
};

/**
 * Get the number of buffered locations
 */
export const getBufferCount = async (): Promise<number> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');

        return new Promise((resolve, reject) => {
            const request = tx.objectStore(STORE_NAME).count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        return 0;
    }
};

/**
 * Flush buffer: sync all buffered locations to Firebase in batched chunks, then remove synced records
 * Call this when connectivity is restored
 */
export const flushBuffer = async (
    syncFn: (locations: BufferedLocation[]) => Promise<void>,
    batchSize: number = 50
): Promise<number> => {
    if (isFlushing) {
        console.log('📦 Location flush already in progress, skipping concurrent run');
        return 0;
    }
    isFlushing = true;

    try {
        await evictStaleLocations();
        const locations = await getBufferedLocations();

        if (locations.length === 0) return 0;

        console.log(`📦 Flushing ${locations.length} buffered locations to Firebase in batches of ${batchSize}...`);

        // Sort chronologically and sync in batches to avoid payload spikes
        locations.sort((a, b) => a.timestamp - b.timestamp);
        
        let syncedCount = 0;
        for (let i = 0; i < locations.length; i += batchSize) {
            const batch = locations.slice(i, i + batchSize);
            try {
                await syncFn(batch);
                const ids = batch.map(loc => loc.id).filter((id): id is number => typeof id === 'number');
                if (ids.length > 0) {
                    await removeBufferedLocationsBatch(ids);
                }
                syncedCount += batch.length;
            } catch (batchErr) {
                console.error('📦 Location batch sync failed, pausing flush:', batchErr);
                break;
            }
        }

        console.log(`📦 ✅ Synced ${syncedCount}/${locations.length} offline locations`);
        return syncedCount;
    } catch (err) {
        console.error('📦 Flush failed — will retry on next connection:', err);
        return 0;
    } finally {
        isFlushing = false;
    }
};

/**
 * Monitor online/offline status and auto-flush when back online
 */
export const setupAutoFlush = (
    syncFn: (locations: BufferedLocation[]) => Promise<void>
): (() => void) => {
    const handleOnline = async () => {
        console.log('📦 Network restored — auto-flushing offline location buffer...');
        const count = await flushBuffer(syncFn);
        if (count > 0) {
            console.log(`📦 Auto-flushed ${count} locations`);
        }
    };

    window.addEventListener('online', handleOnline);

    // Initial check on startup if online
    if (typeof navigator !== 'undefined' && navigator.onLine) {
        setTimeout(() => {
            flushBuffer(syncFn).catch(err => console.warn('📦 Initial location flush check failed:', err));
        }, 3000);
    }

    return () => window.removeEventListener('online', handleOnline);
};

// ==========================================
// PREDICTIVE GEOGRAPHIC CACHING & DEAD ZONE SPATIAL INDEX
// ==========================================

export interface DeadZoneRecord {
    id: string;
    center: { lat: number; lng: number };
    radiusKm: number; // default 10km
    firstObservedAt: number;
    lastObservedAt: number;
    durationSeconds: number;
    signalDropsCount: number;
    isCached: boolean;
}

const DEAD_ZONES_STORAGE_KEY = 'myway_known_dead_zones';

export const getKnownDeadZones = (): DeadZoneRecord[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(DEAD_ZONES_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.warn('📦 Failed to load known dead zones:', e);
        return [];
    }
};

const saveKnownDeadZones = (zones: DeadZoneRecord[]): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(DEAD_ZONES_STORAGE_KEY, JSON.stringify(zones));
    } catch (e) {
        console.warn('📦 Failed to save known dead zones:', e);
    }
};

/**
 * Preemptively download/delta-update MapLibre tiles for a 10km dead zone radius.
 */
export const syncDeadZoneTiles = async (deadZone: DeadZoneRecord): Promise<boolean> => {
    const isCovered = offlineMapService.isLocationCovered(deadZone.center, deadZone.radiusKm, 10, 14);
    if (isCovered) {
        console.log(`📦 [Predictive Cache] Dead zone ${deadZone.id} already covered in tile cache`);
        return true;
    }

    console.log(`📦 [Predictive Cache] Proactively downloading ${deadZone.radiusKm}km map tiles for dead zone [${deadZone.center.lat.toFixed(3)}, ${deadZone.center.lng.toFixed(3)}]...`);
    const bounds = computeRadiusBounds(deadZone.center, deadZone.radiusKm);

    try {
        const area = await offlineMapService.downloadArea(
            `Dead Zone (${deadZone.center.lat.toFixed(2)}, ${deadZone.center.lng.toFixed(2)})`,
            bounds,
            { min: 10, max: 14 }
        );

        if (area) {
            deadZone.isCached = true;
            const zones = getKnownDeadZones();
            const idx = zones.findIndex(z => z.id === deadZone.id);
            if (idx >= 0) {
                zones[idx].isCached = true;
                saveKnownDeadZones(zones);
            }
            console.log(`📦 [Predictive Cache] ✅ Successfully cached map tiles for dead zone ${deadZone.id}`);
            return true;
        }
    } catch (err) {
        console.warn(`📦 [Predictive Cache] Failed to sync tiles for dead zone ${deadZone.id}:`, err);
    }
    return false;
};

/**
 * Register a cellular dead zone or poor signal cluster.
 * Merges with existing dead zones if within 5km, updating drop count and duration.
 */
export const registerDeadZone = (
    center: { lat: number; lng: number },
    durationSeconds: number = 120,
    radiusKm: number = 10
): DeadZoneRecord => {
    const zones = getKnownDeadZones();
    const existingIndex = zones.findIndex(z => {
        const distKm = getDistanceFromCoords(z.center.lat, z.center.lng, center.lat, center.lng) / 1000;
        return distKm <= 5;
    });

    const now = Date.now();
    let updatedZone: DeadZoneRecord;

    if (existingIndex >= 0) {
        const existing = zones[existingIndex];
        updatedZone = {
            ...existing,
            lastObservedAt: now,
            durationSeconds: existing.durationSeconds + durationSeconds,
            signalDropsCount: existing.signalDropsCount + 1,
            isCached: offlineMapService.isLocationCovered(existing.center, existing.radiusKm)
        };
        zones[existingIndex] = updatedZone;
        console.log(`📦 [Dead Zone Registry] Updated existing dead zone ${updatedZone.id} (drops: ${updatedZone.signalDropsCount})`);
    } else {
        updatedZone = {
            id: `deadzone_${Math.round(center.lat * 100)}_${Math.round(center.lng * 100)}_${now}`,
            center,
            radiusKm,
            firstObservedAt: now,
            lastObservedAt: now,
            durationSeconds,
            signalDropsCount: 1,
            isCached: offlineMapService.isLocationCovered(center, radiusKm)
        };
        zones.push(updatedZone);
        console.log(`📦 [Dead Zone Registry] Registered new cellular dead zone at [${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}] (${radiusKm}km radius)`);
    }

    saveKnownDeadZones(zones);

    // If online, immediately initiate background delta tile cache for this dead zone
    if (typeof navigator !== 'undefined' && navigator.onLine && !updatedZone.isCached) {
        syncDeadZoneTiles(updatedZone).catch(err => console.warn('📦 Background dead zone sync error:', err));
    }

    return updatedZone;
};

/**
 * Find all known dead zones intersecting a navigation route polyline.
 */
export const findDeadZonesIntersectingRoute = (
    routeCoords: Array<{ lat: number; lng: number } | [number, number]> | undefined
): DeadZoneRecord[] => {
    if (!routeCoords || routeCoords.length === 0) return [];
    const zones = getKnownDeadZones();
    if (zones.length === 0) return [];

    const normalized: Array<{ lat: number; lng: number }> = routeCoords.map(pt => {
        if (Array.isArray(pt)) return { lng: pt[0], lat: pt[1] };
        return { lat: (pt as any).lat, lng: (pt as any).lng };
    });

    const matchingZones = new Set<DeadZoneRecord>();

    for (const zone of zones) {
        // Step sample points along the route
        for (let i = 0; i < normalized.length; i += Math.max(1, Math.floor(normalized.length / 20))) {
            const pt = normalized[i];
            const distKm = getDistanceFromCoords(pt.lat, pt.lng, zone.center.lat, zone.center.lng) / 1000;
            if (distKm <= zone.radiusKm) {
                matchingZones.add(zone);
                break;
            }
        }
    }

    return Array.from(matchingZones);
};
