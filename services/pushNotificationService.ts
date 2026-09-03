/**
 * Push Notification Service
 * Handles FCM (Firebase Cloud Messaging) for real-time push notifications
 * when the app is closed or in the background.
 * 
 * Used for: SOS alerts, geofence entry/exit, family member arrival notifications
 */

import { getMessaging, getToken, onMessage, MessagePayload } from 'firebase/messaging';
import app from './firebase';
import { bufferMessage } from './offlineMessageBuffer';
 
// Import configuration to sync with Service Worker
const firebaseConfig = {
    apiKey: (import.meta as any).env.VITE_FIREBASE_API_KEY,
    authDomain: (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: (import.meta as any).env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: (import.meta as any).env.VITE_FIREBASE_APP_ID
};

// FCM Vapor Key (public) - configured in Firebase Console > Cloud Messaging
const VAPID_KEY = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || '';

let messaging: ReturnType<typeof getMessaging> | null = null;

/**
 * Initialize Firebase Cloud Messaging
 * Safe to call multiple times — will only init once
 */
const initMessaging = async () => {
    if (messaging) return messaging;
    try {
        messaging = getMessaging(app);
        
        // AUDIT FIX: Sync config with service worker immediately
        const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
        if (registration?.active) {
            registration.active.postMessage({
                type: 'SET_FIREBASE_CONFIG',
                config: firebaseConfig
            });
        }
 
        return messaging;
    } catch (err) {
        console.warn('⚠️ FCM not available in this environment:', (err as any)?.message);
        return null;
    }
};

let cachedFcmToken: string | null = null;
let tokenRequestPromise: Promise<string | null> | null = null;

/**
 * Request notification permission and get FCM token
 * The token should be stored in the user's Firebase profile for server-side targeting
 */
export const requestPushPermission = async (): Promise<string | null> => {
    if (cachedFcmToken) return cachedFcmToken;
    if (tokenRequestPromise) return tokenRequestPromise;

    tokenRequestPromise = (async () => {
        try {
            if (typeof window === 'undefined' || !('Notification' in window)) return null;
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('🔔 Push notification permission denied');
                return null;
            }

            const msg = await initMessaging();
            if (!msg) return null;

            // Get the FCM token — requires service worker to be registered
            const reg = await navigator.serviceWorker.getRegistration();
            const token = await getToken(msg, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: reg
            });

            cachedFcmToken = token;
            console.log('🔔 FCM Token obtained:', token.substring(0, 20) + '...');
            return token;
        } catch (err) {
            console.error('🔔 FCM Token error:', err);
            return null;
        } finally {
            tokenRequestPromise = null;
        }
    })();

    return tokenRequestPromise;
};

const lastPersistedTokenMap = new Map<string, string>();

/**
 * AUDIT FIX: Persist FCM token to user's database profile
 * This enables server-side push notification targeting for SOS/geofence alerts.
 */
export const persistTokenToProfile = async (userId: string): Promise<void> => {
    const token = await requestPushPermission();
    if (!token) return;

    if (lastPersistedTokenMap.get(userId) === token) {
        return; // Already up-to-date in this session
    }

    try {
        const { database } = await import('./firebase');
        const { ref, set } = await import('firebase/database');
        await set(ref(database, `users/${userId}/fcmToken`), token);
        await set(ref(database, `users/${userId}/fcmTokenUpdated`), Date.now());
        lastPersistedTokenMap.set(userId, token);
        console.log('🔔 FCM Token persisted to profile');
    } catch (err) {
        console.error('🔔 Failed to persist FCM token:', err);
    }
};

/**
 * Listen for foreground push notifications
 * These arrive when the app is open and active.
 * Automatically injects received alerts into the offline chat buffer for timeline persistence.
 */
export const onForegroundMessage = async (callback?: (payload: MessagePayload) => void): Promise<(() => void)> => {
    const msg = await initMessaging();
    if (!msg) return () => {};

    const unsubscribe = onMessage(msg, async (payload) => {
        console.log('🔔 Foreground push received:', payload);

        // Bridge FCM alert into persistent offline message timeline
        try {
            const circleId = payload.data?.circleId || 'default-circle';
            const body = payload.notification?.body || payload.data?.body || (payload.data ? JSON.stringify(payload.data) : 'Notification received');
            const messageId = payload.messageId || `fcm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const isGeofence = payload.data?.type === 'geofence' || payload.data?.type === 'geofence_enter' || payload.data?.type === 'geofence_exit';

            await bufferMessage({
                clientMessageId: messageId,
                circleId,
                senderId: payload.data?.memberId || 'omni-ai',
                content: body,
                type: isGeofence ? 'geofence' : 'text',
                timestamp: parseInt(payload.data?.timestamp || '') || Date.now(),
                status: 'queued'
            });
            console.log('💬 Foreground push alert buffered to chat history:', messageId);
        } catch (bufErr) {
            console.warn('⚠️ Could not buffer foreground push to chat:', bufErr);
        }

        if (callback) {
            callback(payload);
        }
    });

    return unsubscribe;
};

/**
 * Notification payload types for MyWay
 */
export interface PushNotificationData {
    type: 'sos' | 'geofence_enter' | 'geofence_exit' | 'arrival' | 'departure' | 'low_battery';
    memberId: string;
    memberName: string;
    circleId: string;
    geofenceName?: string;
    location?: { lat: number; lng: number };
    timestamp: number;
}

/**
 * Parse a raw FCM payload into typed notification data
 */
export const parsePushPayload = (payload: MessagePayload): PushNotificationData | null => {
    try {
        const data = payload.data;
        if (!data) return null;

        return {
            type: data.type as PushNotificationData['type'],
            memberId: data.memberId,
            memberName: data.memberName,
            circleId: data.circleId,
            geofenceName: data.geofenceName,
            location: data.lat && data.lng ? { lat: parseFloat(data.lat), lng: parseFloat(data.lng) } : undefined,
            timestamp: parseInt(data.timestamp) || Date.now()
        };
    } catch {
        return null;
    }
};

/**
 * Broadcasts a geofence arrival or departure alert across the circle
 * Stores in Firebase Realtime Database alerts feed, buffers to timeline, and triggers native notification.
 */
export const broadcastGeofencePushAlert = async (
    circleId: string,
    memberId: string,
    memberName: string,
    geofenceName: string,
    transitionType: 'arrival' | 'departure',
    location?: { lat: number; lng: number }
): Promise<void> => {
    if (!circleId) return;

    const isArrival = transitionType === 'arrival';
    const title = isArrival ? `📍 ${memberName} arrived at ${geofenceName}` : `🚶 ${memberName} left ${geofenceName}`;
    const body = `${memberName} has ${isArrival ? 'entered' : 'departed'} the ${geofenceName} safe zone.`;
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Buffer to persistent timeline
    try {
        await bufferMessage({
            clientMessageId: alertId,
            circleId,
            senderId: memberId,
            content: title,
            type: 'geofence',
            timestamp: Date.now(),
            status: 'queued'
        });
    } catch (e) {
        console.warn('⚠️ Could not buffer geofence push to timeline:', e);
    }

    // 2. Persist to Firebase Realtime Database for all circle devices
    try {
        const { database } = await import('./firebase');
        const { ref, push, set } = await import('firebase/database');
        const alertRef = push(ref(database, `familyCircles/${circleId}/geofenceAlerts`));
        await set(alertRef, {
            id: alertId,
            type: isArrival ? 'geofence_enter' : 'geofence_exit',
            memberId,
            memberName,
            geofenceName,
            location: location || null,
            title,
            body,
            timestamp: Date.now()
        });
        console.log(`🔔 Geofence alert broadcasted for ${memberName} at ${geofenceName}`);
    } catch (dbErr) {
        console.warn('⚠️ Could not broadcast geofence alert to Firebase:', dbErr);
    }

    // 3. Trigger native/browser notification if permission granted
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
            if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg && reg.showNotification) {
                    await reg.showNotification(title, {
                        body,
                        icon: '/icon-192.png',
                        badge: '/icon-192.png',
                        tag: `geofence_${memberId}_${geofenceName}`,
                        data: { circleId, memberId, geofenceName, timestamp: Date.now() }
                    });
                    return;
                }
            }
            new Notification(title, { body, icon: '/icon-192.png' });
        } catch (notifErr) {
            console.warn('⚠️ Native notification display error:', notifErr);
        }
    }
};
