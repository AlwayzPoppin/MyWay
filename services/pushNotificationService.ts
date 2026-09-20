/**
 * Push Notification Service
 * Handles FCM (Firebase Cloud Messaging) for real-time push notifications
 * when the app is closed or in the background.
 * 
 * Used for: SOS alerts, geofence entry/exit, family member arrival notifications
 */

import { getMessaging, getToken, onMessage, MessagePayload } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { httpsCallable } from 'firebase/functions';
import app from './firebase';
import { functions } from './firebase';
import { EntranceType } from '../types';
import { getEntranceArrivalMessage } from './geofenceService';
import { speechService } from './speechService';
 
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
        const registration = (await navigator.serviceWorker.getRegistration('/sw.js')) || (await navigator.serviceWorker.getRegistration());
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
// Android notification channels cannot change their sound after creation.
// Keep this versioned so existing installs receive the arrival chime too.
const NATIVE_PUSH_CHANNEL_ID = 'myway_safety_v2';

/**
 * Request notification permission and get FCM token
 * The token should be stored in the user's Firebase profile for server-side targeting
 */
export const requestPushPermission = async (): Promise<string | null> => {
    // Native apps use Capacitor's FCM bridge. The browser SDK cannot register
    // a native Android device for background notifications.
    if (Capacitor.isNativePlatform()) return null;
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

const persistToken = async (userId: string, token: string): Promise<void> => {
    if (!token || lastPersistedTokenMap.get(userId) === token) return;
    try {
        const { database } = await import('./firebase');
        const { ref, set } = await import('firebase/database');
        await set(ref(database, `users/${userId}/fcmToken`), token);
        await set(ref(database, `users/${userId}/fcmTokenUpdated`), Date.now());
        // Keep a token per trusted device. The profile token remains as a
        // compatibility fallback for existing safety-alert deployments.
        const { updateCurrentDevicePushToken } = await import('./deviceSessionService');
        void updateCurrentDevicePushToken(token).catch(error =>
            console.debug('[Devices] Device push-token sync pending:', error)
        );
        lastPersistedTokenMap.set(userId, token);
        console.log('🔔 FCM token persisted to profile');
    } catch (err) {
        console.error('🔔 Failed to persist FCM token:', err);
    }
};

const registerNativePush = async (userId: string): Promise<void> => {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') {
        permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') {
        console.warn('🔔 Native push permission was not granted');
        return;
    }

    await PushNotifications.createChannel({
        id: NATIVE_PUSH_CHANNEL_ID,
        name: 'Safety alerts',
        description: 'SOS, crash, arrival, and departure alerts',
        importance: 4,
        visibility: 1,
        vibration: true,
        lightColor: '#6366F1',
        sound: 'myway_arrival_chime'
    });

    await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        void PushNotifications.addListener('registration', async token => {
            await persistToken(userId, token.value);
            finish();
        });
        void PushNotifications.addListener('registrationError', error => {
            console.warn('🔔 Native FCM registration failed:', error.error);
            finish();
        });
        void PushNotifications.register().catch(error => {
            console.warn('🔔 Native push registration could not start:', error);
            finish();
        });
        window.setTimeout(finish, 10000);
    });
};

/**
 * AUDIT FIX: Persist FCM token to user's database profile
 * This enables server-side push notification targeting for SOS/geofence alerts.
 */
export const persistTokenToProfile = async (userId: string): Promise<void> => {
    if (Capacitor.isNativePlatform()) {
        await registerNativePush(userId);
        return;
    }
    const token = await requestPushPermission();
    if (!token) return;
    await persistToken(userId, token);
};

const handleForegroundPayload = async (payload: MessagePayload, callback?: (payload: MessagePayload) => void): Promise<void> => {
    const isGeofence = payload.data?.type === 'geofence' || payload.data?.type === 'geofence_enter' || payload.data?.type === 'geofence_exit';
    console.log('🔔 Foreground push received:', payload);
    if (isGeofence) {
        speechService.playChime(payload.data?.type === 'geofence_exit' ? 'turn' : 'arrival');
    }
    callback?.(payload);
};

/**
 * Listen for foreground push notifications
 * These arrive when the app is open and active.
 * Delivers foreground safety alerts to app listeners and plays geofence cues.
 */
export const onForegroundMessage = async (callback?: (payload: MessagePayload) => void): Promise<(() => void)> => {
    if (Capacitor.isNativePlatform()) {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const listener = await PushNotifications.addListener('pushNotificationReceived', notification => {
            const payload = {
                messageId: notification.id,
                notification: { title: notification.title, body: notification.body },
                data: notification.data || {}
            } as MessagePayload;
            void handleForegroundPayload(payload, callback);
        });
        return () => { void listener.remove(); };
    }
    const msg = await initMessaging();
    if (!msg) return () => {};

    const unsubscribe = onMessage(msg, async (payload) => {
        void handleForegroundPayload(payload, callback);
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
 * Best-effort attention signal after the safety event has already been written
 * to RTDB. Recipients always load the event from the backend; a missed push
 * cannot hide an active SOS.
 */
export const sendSosPushAlert = async (circleId: string, memberName: string, eventType: 'sos' | 'crash'): Promise<void> => {
    try {
        const call = httpsCallable(functions, 'sendSosAlert');
        await call({ circleId, memberName, eventType });
    } catch (error) {
        console.warn('[Safety] SOS event persisted, but its push alert could not be delivered:', error);
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
    location?: { lat: number; lng: number },
    entranceType?: EntranceType
): Promise<void> => {
    if (!circleId) return;

    const isArrival = transitionType === 'arrival';
    let title = isArrival ? `📍 ${memberName} arrived at ${geofenceName}` : `🚶 ${memberName} left ${geofenceName}`;
    let body = `${memberName} has ${isArrival ? 'entered' : 'departed'} the ${geofenceName} safe zone.`;

    if (isArrival && entranceType) {
        const entranceMsg = getEntranceArrivalMessage(memberName, geofenceName, entranceType);
        title = entranceMsg.title;
        body = entranceMsg.body;
    }

    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 2. Persist to Firebase Realtime Database for all circle devices
    try {
        const { database } = await import('./firebase');
        const { ref, push, set } = await import('firebase/database');
        const alertRef = push(ref(database, `familyCircles/${circleId}/geofenceAlerts`));
        await set(alertRef, {
            id: alertId,
            type: isArrival ? (entranceType ? 'entrance_arrival' : 'geofence_enter') : 'geofence_exit',
            memberId,
            memberName,
            geofenceName,
            entranceType: entranceType || null,
            location: location || null,
            title,
            body,
            timestamp: Date.now()
        });
        console.log(`🔔 Geofence alert broadcasted for ${memberName} at ${geofenceName} (${entranceType || 'main'})`);
    } catch (dbErr) {
        console.warn('⚠️ Could not broadcast geofence alert to Firebase:', dbErr);
    }

    // FCM is the attention signal; the RTDB alert above remains the durable
    // source of truth when a device is offline or misses a push.
    try {
        const call = httpsCallable(functions, 'sendGeofenceAlert');
        await call({
            circleId,
            memberId,
            memberName,
            geofenceName,
            eventType: isArrival ? 'entered' : 'left',
            location
        });
    } catch (pushError) {
        console.warn('⚠️ Geofence event was saved, but remote push could not be sent:', pushError);
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
