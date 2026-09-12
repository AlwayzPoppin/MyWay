import { db, auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
    collection,
    doc,
    setDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    limit,
    Timestamp,
    writeBatch
} from 'firebase/firestore';
import { encryptMessage, decryptMessage } from './cryptoService';
import { syncVerifiedCircleMembership } from './circleMembershipService';
import {
    bufferMessage,
    getBufferedMessages,
    removeBufferedMessage,
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
    deliveryReceipts?: Record<string, number>;
    readReceipts?: Record<string, number>;
}

// Convert Firestore timestamp to JS Date
const convertTimestamp = (timestamp: any): Date => {
    if (!timestamp) return new Date(); // Optimistic UI updates might have null timestamp initially
    if (timestamp instanceof Timestamp) return timestamp.toDate();
    if (typeof timestamp === 'number') return new Date(timestamp);
    if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
    return new Date();
};

const acknowledgeReceipt = async (
    circleId: string,
    viewerId: string,
    messages: ChatMessage[],
    type: 'delivered' | 'read'
): Promise<void> => {
    const candidates = messages.filter(message =>
        message.senderId !== viewerId &&
        !(type === 'delivered' ? message.deliveryReceipts : message.readReceipts)?.[viewerId]
    );
    if (!candidates.length) return;
    const batch = writeBatch(db);
    const now = Date.now();
    candidates.slice(0, 100).forEach(message => {
        batch.set(doc(db, 'familyCircles', circleId, 'messages', message.id), {
            [type === 'delivered' ? `deliveryReceipts.${viewerId}` : `readReceipts.${viewerId}`]: now
        }, { merge: true });
    });
    await batch.commit();
};

export const markMessagesRead = async (viewerId: string, messages: ChatMessage[]): Promise<void> => {
    const byCircle = new Map<string, ChatMessage[]>();
    messages.forEach(message => {
        if (!message.circleId) return;
        byCircle.set(message.circleId, [...(byCircle.get(message.circleId) || []), message]);
    });
    await Promise.all([...byCircle.entries()].map(([circleId, circleMessages]) =>
        acknowledgeReceipt(circleId, viewerId, circleMessages, 'read')
    ));
};

export const subscribeToMessages = (circleId: string, callback: (messages: ChatMessage[]) => void, viewerId?: string) => {
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
                    const decrypted = await decryptMessage(content, circleId);
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
                status: 'sent' as const,
                deliveryReceipts: data.deliveryReceipts || {},
                readReceipts: data.readReceipts || {}
            };
        });

        const messages = await Promise.all(decryptedPromises);
        // Reverse to maintain chronological order (Oldest -> Newest)
        messages.reverse();

        callback(messages as ChatMessage[]);
        if (viewerId) {
            void acknowledgeReceipt(circleId, viewerId, messages as ChatMessage[], 'delivered')
                .catch(error => console.debug('[Chat] Delivery receipt will retry on the next snapshot:', error));
        }
    }, (error) => {
        console.warn('💬 [ChatService] Firestore listener notice (offline / sync pending):', error?.message || error);
    });
};

/**
 * Multi-Circle Live Chat Subscriber
 * Subscribes to multiple circles concurrently and merges all messages chronologically
 */
export const subscribeToMultipleCirclesMessages = (
    circleIds: string[],
    viewerId: string,
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
        }, viewerId);
    });

    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
};

/**
 * Sync a single offline buffered message to Firestore
 */
export const syncBufferedMessage = async (msg: BufferedMessage): Promise<void> => {
    if (auth.currentUser?.uid !== msg.senderId) throw new Error('Sign in as the message sender to retry.');

    // A mobile app can resume with a valid RTDB Circle but a missing Firestore
    // membership mirror (for example after an app update, restore, or offline
    // period). Repair that trusted mirror before every durable outbox attempt.
    // This also releases messages that were queued before the rules rollout.
    const activeMembership = await syncVerifiedCircleMembership(msg.circleId);
    if (!activeMembership) {
        throw new Error('You are no longer an active member of this Circle.');
    }

    const messagesRef = collection(db, 'familyCircles', msg.circleId, 'messages');

    let secureContent = msg.content;
    try {
        secureContent = await encryptMessage(msg.content, msg.circleId);
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

    // Retrying an acknowledged write must not create a second message.
    await setDoc(doc(messagesRef, msg.clientMessageId), payload);
};

// Initialize automatic background sync when network reconnects
if (typeof window !== 'undefined') {
    setupMessageAutoFlush(syncBufferedMessage, msg => msg.senderId === auth.currentUser?.uid);
    onAuthStateChanged(auth, user => { if (user) window.dispatchEvent(new Event('myway-chat-retry')); });
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
    if (!circleId || !senderId || !content.trim()) throw new Error('Choose a circle before sending.');
    if (auth.currentUser?.uid !== senderId) throw new Error('Please sign in again to send messages.');

    // Persist before attempting the write. Every retry uses this same document
    // ID, so an ambiguous network failure cannot create a duplicate message.
    const buffered = await bufferMessage({
        clientMessageId: `msg_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`}`,
        circleId,
        senderId,
        recipientId,
        content,
        type,
        timestamp: Date.now(),
        status: 'queued'
    });
    const queuedMessage: ChatMessage = {
        id: `buffered-${buffered.id || buffered.clientMessageId}`,
        senderId,
        recipientId,
        circleId,
        content,
        type,
        timestamp: new Date(buffered.timestamp),
        status: 'queued'
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) return queuedMessage;
    try {
        await syncBufferedMessage(buffered);
        if (buffered.id) await removeBufferedMessage(buffered.id);
        window.dispatchEvent(new Event('myway-chat-queue-updated'));
        return { ...queuedMessage, id: buffered.clientMessageId, status: 'sent' };
    } catch (error) {
        const code = (error as { code?: string }).code?.replace('firestore/', '');
        console.warn('📶 Message remains in the durable outbox after a failed delivery attempt:', error);
        window.dispatchEvent(new CustomEvent('myway-chat-send-error', { detail: { senderId, code } }));
        return queuedMessage;
    }
};
