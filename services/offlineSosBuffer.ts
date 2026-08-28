/**
 * Offline SOS Buffer Service
 * Queues emergency SOS triggers and cancellations in IndexedDB when in cellular dead zones,
 * and auto-synchronizes them to Firebase Realtime Database once connectivity is restored.
 */

export interface BufferedSosAlert {
    id?: number;
    circleId: string;
    userId: string;
    action: 'trigger' | 'clear';
    location?: { lat: number; lng: number };
    timestamp: number;
}

const DB_NAME = 'myway-offline';
const STORE_NAME = 'sos-buffer';
const DB_VERSION = 3;

/**
 * Open (or upgrade) the IndexedDB database
 */
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('location-buffer')) {
                const locStore = db.createObjectStore('location-buffer', { keyPath: 'id', autoIncrement: true });
                locStore.createIndex('timestamp', 'timestamp', { unique: false });
                locStore.createIndex('userId', 'userId', { unique: false });
            }
            if (!db.objectStoreNames.contains('message-buffer')) {
                const msgStore = db.createObjectStore('message-buffer', { keyPath: 'id', autoIncrement: true });
                msgStore.createIndex('timestamp', 'timestamp', { unique: false });
                msgStore.createIndex('circleId', 'circleId', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const sosStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                sosStore.createIndex('timestamp', 'timestamp', { unique: false });
                sosStore.createIndex('userId', 'userId', { unique: false });
                sosStore.createIndex('circleId', 'circleId', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const MAX_SOS_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours TTL
const MAX_SOS_BUFFER_SIZE = 20; // 20 alerts max FIFO

/**
 * Evict SOS alerts older than 48 hours or exceeding the 20-alert buffer limit
 */
export const evictStaleSosAlerts = async (): Promise<number> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');

        const cutoffTime = Date.now() - MAX_SOS_AGE_MS;
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
        const all = await getBufferedSosAlerts();
        if (all.length > MAX_SOS_BUFFER_SIZE) {
            const overflow = all.length - MAX_SOS_BUFFER_SIZE;
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
            console.log(`🚨 Evicted ${evictedCount} stale/overflow offline SOS alerts`);
        }
        return evictedCount;
    } catch (err) {
        console.error('🚨 Failed to evict stale SOS alerts:', err);
        return 0;
    }
};

/**
 * Queue an SOS alert for later sync
 */
export const bufferSosAlert = async (alert: Omit<BufferedSosAlert, 'id'>): Promise<BufferedSosAlert> => {
    try {
        await evictStaleSosAlerts();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add(alert);

        return new Promise<BufferedSosAlert>((resolve, reject) => {
            request.onsuccess = () => {
                const generatedId = request.result as number;
                console.log(`🚨 Buffered offline SOS [${alert.action}] (${new Date(alert.timestamp).toLocaleTimeString()})`);
                resolve({ ...alert, id: generatedId });
            };
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('🚨 Failed to buffer offline SOS alert:', err);
        return { ...alert, id: Date.now() };
    }
};

/**
 * Get all buffered SOS alerts
 */
export const getBufferedSosAlerts = async (): Promise<BufferedSosAlert[]> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        return new Promise<BufferedSosAlert[]>((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve((request.result || []) as BufferedSosAlert[]);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('🚨 Failed to read offline SOS buffer:', err);
        return [];
    }
};

/**
 * Remove a specific buffered SOS alert after sync
 */
export const removeBufferedSosAlert = async (id: number): Promise<void> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error('🚨 Failed to delete buffered SOS alert:', err);
    }
};

/**
 * Clear all buffered SOS alerts
 */
export const clearSosBuffer = async (): Promise<void> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        console.log('🚨 Offline SOS buffer cleared');
    } catch (err) {
        console.error('🚨 Failed to clear SOS buffer:', err);
    }
};

/**
 * Flush all buffered SOS alerts via a sync callback
 */
export const flushSosBuffer = async (
    syncFn: (alert: BufferedSosAlert) => Promise<void>
): Promise<number> => {
    await evictStaleSosAlerts();
    const alerts = await getBufferedSosAlerts();
    if (alerts.length === 0) return 0;

    console.log(`🚨 Flushing ${alerts.length} buffered SOS alerts to Firebase...`);
    alerts.sort((a, b) => a.timestamp - b.timestamp);

    let syncedCount = 0;
    for (const alert of alerts) {
        try {
            await syncFn(alert);
            if (alert.id) {
                await removeBufferedSosAlert(alert.id);
            }
            syncedCount++;
        } catch (err) {
            console.error(`🚨 SOS sync failed for ${alert.circleId}/${alert.userId}, pausing flush:`, err);
            break;
        }
    }

    console.log(`🚨 ✅ Successfully synced ${syncedCount}/${alerts.length} offline SOS alerts`);
    return syncedCount;
};

/**
 * Auto-flush SOS alerts when network reconnects
 */
export const setupSosAutoFlush = (
    syncFn: (alert: BufferedSosAlert) => Promise<void>
): (() => void) => {
    const handleOnline = async () => {
        console.log('🚨 Network restored — auto-flushing offline SOS alerts...');
        await flushSosBuffer(syncFn);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
};
