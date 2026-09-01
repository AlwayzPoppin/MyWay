import { db } from './firebase';
import {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    limit,
    Timestamp
} from 'firebase/firestore';
import { encryptMessage, decryptMessage } from './cryptoService';
import {
    bufferMessage,
    getBufferedMessages,
    setupMessageAutoFlush,
    BufferedMessage
} from './offlineMessageBuffer';

export interface ChatMessage {
    id: string;
    senderId: string;
    recipientId?: string; // Optional recipient for 1-on-1 direct messages; undefined/null for Circle group broadcast
    circleId?: string;    // Circle this message belongs to
    circleName?: string;  // Name of the circle
    circleColor?: string; // Theme color of the circle
    content: string;
    type: 'text' | 'emoji' | 'location' | 'checkin' | 'geofence';
    timestamp: Date;
    status?: 'sent' | 'queued' | 'syncing';
}

// Convert Firestore timestamp to JS Date
const convertTimestamp = (timestamp: any): Date => {
    if (!timestamp) return new Date(); // Optimistic UI updates might have null timestamp initially
    if (timestamp instanceof Timestamp) return timestamp.toDate();
    if (typeof timestamp === 'number') return new Date(timestamp);
    if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
    return new Date();
};

export const subscribeToMessages = (circleId: string, callback: (messages: ChatMessage[]) => void) => {
    if (!circleId) return () => { };

    const messagesRef = collection(db, 'familyCircles', circleId, 'messages');
    const q = query(
        messagesRef,
        orderBy('timestamp', 'desc'),
        limit(100)
    );

    return onSnapshot(q, async (snapshot) => {
        const decryptedPromises = snapshot.docs.map(async (doc) => {
            const data = doc.data();
            let content = data.content;

            try {
                // Attempt to decrypt content
                if (content && typeof content === 'string') {
                    const decrypted = await decryptMessage(content);
                    if (decrypted) content = decrypted;
                }
            } catch (e) {
                // UX FIX: Show friendly message instead of looking like an error
                content = "🔒 Waiting for key exchange...";
                console.warn("Decryption failed for message:", doc.id);
            }

            return {
                id: doc.id,
                senderId: data.senderId,
                recipientId: data.recipientId || undefined,
                circleId: data.circleId || circleId,
                content: content,
                type: data.type || 'text',
                timestamp: convertTimestamp(data.timestamp),
                status: 'sent' as const
            };
        });

        const messages = await Promise.all(decryptedPromises);
        // Reverse to maintain chronological order (Oldest -> Newest)
        messages.reverse();

        callback(messages as ChatMessage[]);
    });
};

/**
 * Multi-Circle Live Chat Subscriber
 * Subscribes to multiple circles concurrently and merges all messages chronologically
 */
export const subscribeToMultipleCirclesMessages = (
    circleIds: string[],
    callback: (messages: ChatMessage[]) => void
): (() => void) => {
    const validIds = Array.from(new Set(circleIds.filter(id => !!id)));
    if (validIds.length === 0) return () => { };

    const circleMessagesMap: Record<string, ChatMessage[]> = {};

    const unsubscribers = validIds.map(cId => {
        return subscribeToMessages(cId, (msgs) => {
            circleMessagesMap[cId] = msgs.map(m => ({
                ...m,
                circleId: m.circleId || cId
            }));

            // Merge all circles' messages and sort chronologically
            const merged: ChatMessage[] = [];
            const seenIds = new Set<string>();

            Object.values(circleMessagesMap).forEach(list => {
                list.forEach(m => {
                    if (!seenIds.has(m.id)) {
                        seenIds.add(m.id);
                        merged.push(m);
                    }
                });
            });

            merged.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            callback(merged);
        });
    });

    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
};

/**
 * Sync a single offline buffered message to Firestore
 */
export const syncBufferedMessage = async (msg: BufferedMessage): Promise<void> => {
    const messagesRef = collection(db, 'familyCircles', msg.circleId, 'messages');

    let secureContent = msg.content;
    try {
        secureContent = await encryptMessage(msg.content);
    } catch (e) {
        console.error('Encryption failed during sync, sending plaintext:', e);
    }

    const payload: any = {
        senderId: msg.senderId,
        circleId: msg.circleId,
        content: secureContent,
        type: msg.type,
        timestamp: Timestamp.fromMillis(msg.timestamp)
    };
    if (msg.recipientId) {
        payload.recipientId = msg.recipientId;
    }

    await addDoc(messagesRef, payload);
};

// Initialize automatic background sync when network reconnects
if (typeof window !== 'undefined') {
    setupMessageAutoFlush(syncBufferedMessage);
}

/**
 * Send message with automatic offline buffering fallback
 */
export const sendMessage = async (
    circleId: string,
    senderId: string,
    content: string,
    type: ChatMessage['type'] = 'text',
    recipientId?: string
): Promise<ChatMessage | void> => {
    if (!circleId || !senderId || !content.trim()) return;

    // Instant offline bypass: Buffer directly if disconnected
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
        console.warn('📶 Offline: Buffering chat message to IndexedDB...');
        const buffered = await bufferMessage({
            clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            circleId,
            senderId,
            recipientId,
            content,
            type,
            timestamp: Date.now(),
            status: 'queued'
        });

        return {
            id: `buffered-${buffered.id || Date.now()}`,
            senderId,
            recipientId,
            circleId,
            content,
            type,
            timestamp: new Date(buffered.timestamp),
            status: 'queued'
        };
    }

    const messagesRef = collection(db, 'familyCircles', circleId, 'messages');

    let secureContent = content;
    try {
        secureContent = await encryptMessage(content);
    } catch (e) {
        console.error('Encryption failed, sending plaintext:', e);
    }

    const payload: any = {
        senderId,
        circleId,
        content: secureContent,
        type,
        timestamp: serverTimestamp()
    };
    if (recipientId) {
        payload.recipientId = recipientId;
    }

    try {
        await addDoc(messagesRef, payload);
    } catch (error) {
        console.warn('📶 Firestore send failed (network dropped), buffering to IndexedDB...', error);
        const buffered = await bufferMessage({
            clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            circleId,
            senderId,
            recipientId,
            content,
            type,
            timestamp: Date.now(),
            status: 'queued'
        });

        return {
            id: `buffered-${buffered.id || Date.now()}`,
            senderId,
            recipientId,
            circleId,
            content,
            type,
            timestamp: new Date(buffered.timestamp),
            status: 'queued'
        };
    }
};
