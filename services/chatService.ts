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

export interface ChatMessage {
    id: string;
    senderId: string;
    content: string;
    type: 'text' | 'emoji' | 'location' | 'checkin';
    timestamp: Date;
}

// Convert Firestore timestamp to JS Date
const convertTimestamp = (timestamp: any): Date => {
    if (!timestamp) return new Date(); // Optimistic UI updates might have null timestamp initially
    if (timestamp instanceof Timestamp) return timestamp.toDate();
    return new Date(timestamp.seconds * 1000);
};

export const subscribeToMessages = (circleId: string, callback: (messages: ChatMessage[]) => void) => {
    if (!circleId) return () => { };

    const messagesRef = collection(db, 'familyCircles', circleId, 'messages');
    const q = query(
        messagesRef,
        orderBy('timestamp', 'desc'),
        limit(50)
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
                // SECURITY FIX: Don't leak encrypted data or raw content on decryption failure
                content = "[Encrypted Message]";
            }

            return {
                id: doc.id,
                senderId: data.senderId,
                content: content,
                type: data.type || 'text',
                timestamp: convertTimestamp(data.timestamp)
            };
        });

        const messages = await Promise.all(decryptedPromises);
        // Reverse to maintain chronological order (Oldest -> Newest)
        messages.reverse();

        callback(messages as ChatMessage[]);
    });
};

export const sendMessage = async (circleId: string, senderId: string, content: string, type: ChatMessage['type'] = 'text') => {
    if (!circleId || !senderId || !content.trim()) return;

    const messagesRef = collection(db, 'familyCircles', circleId, 'messages');

    let secureContent = content;
    try {
        secureContent = await encryptMessage(content);
    } catch (e) {
        console.error('Encryption failed, sending plaintext:', e);
    }

    await addDoc(messagesRef, {
        senderId,
        content: secureContent,
        type,
        timestamp: serverTimestamp()
    });
};
