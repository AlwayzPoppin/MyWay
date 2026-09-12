/**
 * Device-only chat history preferences. These markers never alter Firestore,
 * so clearing a conversation cannot remove another member's messages.
 */

const STORAGE_PREFIX = 'myway:chat-cleared-after:v1';

export const getChatConversationKey = (
    currentUserId: string,
    selectedChannelId: string | 'all',
    selectedRecipientId: string | null
): string => {
    if (selectedRecipientId) {
        return `direct:${currentUserId}:${selectedRecipientId}`;
    }
    return selectedChannelId === 'all'
        ? 'groups:all'
        : `circle:${selectedChannelId}`;
};

const storageKey = (userId: string, conversationKey: string): string =>
    `${STORAGE_PREFIX}:${userId}:${conversationKey}`;

export const getConversationClearedAfter = (userId: string, conversationKey: string): number => {
    if (typeof window === 'undefined' || !userId) return 0;
    try {
        const value = Number(window.localStorage.getItem(storageKey(userId, conversationKey)));
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
        return 0;
    }
};

export const clearConversationOnDevice = (userId: string, conversationKey: string): number => {
    const clearedAfter = Date.now();
    if (typeof window === 'undefined' || !userId) return clearedAfter;
    try {
        window.localStorage.setItem(storageKey(userId, conversationKey), String(clearedAfter));
    } catch {
        // A storage failure must never be presented as a shared deletion.
    }
    return clearedAfter;
};

/** A Circle view also respects a later All Groups clear on this device. */
export const getGroupConversationClearedAfter = (userId: string, circleId: string): number =>
    Math.max(
        getConversationClearedAfter(userId, 'groups:all'),
        getConversationClearedAfter(userId, `circle:${circleId}`)
    );
