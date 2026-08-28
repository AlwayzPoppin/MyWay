/**
 * Offline Message Buffer Service
 * Queues chat messages in IndexedDB when offline and synchronizes them
 * chronologically once connectivity is restored.
 */

export interface BufferedMessage {
    id?: number;
    clientMessageId: string;
    circleId: string;
    senderId: string;
    recipientId?: string;
    content: string;
    type: 'text' | 'emoji' | 'location' | 'checkin' | 'geofence';
    timestamp: number;
    status: 'queued' | 'sending' | 'failed';
}

const DB_NAME = 'myway-offline';
const STORE_NAME = 'message-buffer';
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
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const msgStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
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

const MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL
const MAX_MESSAGE_BUFFER_SIZE = 100; // 100 messages max FIFO

/**
 * Evict messages older than 7 days or exceeding the 100-message buffer limit
 */
export const evictStaleMessages = async (): Promise<number> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');

        const cutoffTime = Date.now() - MAX_MESSAGE_AGE_MS;
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
        const all = await getBufferedMessages();
        if (all.length > MAX_MESSAGE_BUFFER_SIZE) {
            const overflow = all.length - MAX_MESSAGE_BUFFER_SIZE;
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
            console.log(`💬 Evicted ${evictedCount} stale/overflow offline messages`);
        }
        return evictedCount;
    } catch (err) {
        console.error('💬 Failed to evict stale messages:', err);
        return 0;
    }
};

/**
 * Queue a message for later sync
 */
export const bufferMessage = async (msg: Omit<BufferedMessage, 'id'>): Promise<BufferedMessage> => {
    try {
        await evictStaleMessages();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add(msg);

        return new Promise<BufferedMessage>((resolve, reject) => {
            request.onsuccess = () => {
                const generatedId = request.result as number;
                resolve({ ...msg, id: generatedId });
            };
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('💬 Failed to buffer offline message:', err);
        return { ...msg, id: Date.now() };
    }
};

/**
 * Get all buffered messages for a circle (or all circles)
 */
export const getBufferedMessages = async (circleId?: string): Promise<BufferedMessage[]> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        return new Promise<BufferedMessage[]>((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const all = (request.result || []) as BufferedMessage[];
                if (circleId) {
                    resolve(all.filter(m => m.circleId === circleId));
                } else {
                    resolve(all);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('💬 Failed to read offline message buffer:', err);
        return [];
    }
};

/**
 * Remove a specific buffered message after sync
 */
export const removeBufferedMessage = async (id: number): Promise<void> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error('💬 Failed to delete buffered message:', err);
    }
};

/**
 * Clear all buffered messages
 */
export const clearMessageBuffer = async (circleId?: string): Promise<void> => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        if (!circleId) {
            store.clear();
        } else {
            const messages = await getBufferedMessages(circleId);
            messages.forEach(m => {
                if (m.id) store.delete(m.id);
            });
        }
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error('💬 Failed to clear message buffer:', err);
    }
};

/**
 * Flush all buffered messages via a sync callback
 */
export const flushMessageBuffer = async (
    syncFn: (msg: BufferedMessage) => Promise<void>
): Promise<number> => {
    await evictStaleMessages();
    const messages = await getBufferedMessages();
    if (messages.length === 0) return 0;

    console.log(`💬 Flushing ${messages.length} buffered messages to Firestore...`);
    messages.sort((a, b) => a.timestamp - b.timestamp);

    let syncedCount = 0;
    for (const msg of messages) {
        try {
            await syncFn(msg);
            if (msg.id) {
                await removeBufferedMessage(msg.id);
            }
            syncedCount++;
        } catch (err) {
            console.error(`💬 Message sync failed for ${msg.clientMessageId}, pausing flush:`, err);
            break; // Stop on first network error to avoid out-of-order delivery
        }
    }

    console.log(`💬 ✅ Successfully synced ${syncedCount}/${messages.length} offline messages`);
    return syncedCount;
};

/**
 * Auto-flush messages when network reconnects
 */
export const setupMessageAutoFlush = (
    syncFn: (msg: BufferedMessage) => Promise<void>
): (() => void) => {
    const handleOnline = async () => {
        console.log('💬 Network restored — auto-flushing offline chat messages...');
        await flushMessageBuffer(syncFn);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
};
