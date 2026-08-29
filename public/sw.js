// Unified Service Worker for Offline Map Tile Caching & FCM Notifications
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const CACHE_NAME = 'myway-offline-maps-v1';
const TILE_CACHE_NAME = 'myway-tiles-v1';

// Tile URL patterns to cache
const TILE_PATTERNS = [
    'basemaps.cartocdn.com',
    'tile.openstreetmap.org',
    'server.arcgisonline.com',
    'tile.opentopomap.org'
];

const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- 1. FCM INITIALIZATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBCSoXNwWnnblKxB4JZF2ElKcwds7PIH2A",
    authDomain: "myway-gps.firebaseapp.com",
    projectId: "myway-gps",
    storageBucket: "myway-gps.firebasestorage.app",
    messagingSenderId: "740093147434",
    appId: "1:740093147434:web:5c4e12c11d1d47813ac653"
};

try {
    if (!self.firebase.apps.length) {
        self.firebase.initializeApp(firebaseConfig);
    }
    const messaging = self.firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
        console.log('[SW/FCM] Background message received:', payload);
        const notificationTitle = payload.notification?.title || 'MyWay Alert';
        const notificationOptions = {
            body: payload.notification?.body || 'You have a new notification',
            icon: '/icon.png',
            badge: '/icon.png',
            data: payload.data,
            tag: payload.data?.type || 'default',
            renotify: true,
            requireInteraction: payload.data?.type === 'sos'
        };
        self.registration.showNotification(notificationTitle, notificationOptions);
    });
} catch (fcmErr) {
    console.warn('[SW/FCM] Top-level FCM initialization:', fcmErr);
}

const initializeFCM = (config) => {
    // Dynamic reconfiguration if updated
    if (config && self.firebase.apps.length) {
        console.log('[SW/FCM] Service Worker config verified');
    }
};

// --- 2. LIFECYCLE EVENTS ---
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Unified Service Worker...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Unified Service Worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('myway-') && name !== CACHE_NAME && name !== TILE_CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// --- 3. FETCH INTERCEPTION (Offline Tiles) ---
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    const isTileRequest = TILE_PATTERNS.some(pattern => url.includes(pattern));

    if (isTileRequest) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        const cachedAt = cachedResponse.headers.get('X-Cached-At');
                        if (cachedAt && (Date.now() - parseInt(cachedAt)) > TILE_TTL_MS) {
                            return fetchAndCacheTile(cache, event.request);
                        }
                        return cachedResponse;
                    }
                    return fetchAndCacheTile(cache, event.request);
                });
            })
        );
    }
});

async function fetchAndCacheTile(cache, request) {
    try {
        const networkResponse = await fetch(request);
        const headers = new Headers(networkResponse.headers);
        headers.set('X-Cached-At', Date.now().toString());
        const timedResponse = new Response(await networkResponse.clone().blob(), {
            status: networkResponse.status,
            statusText: networkResponse.statusText,
            headers
        });
        cache.put(request, timedResponse);
        return networkResponse;
    } catch (e) {
        return new Response('', { status: 503, statusText: 'Offline' });
    }
}

// --- 4. MESSAGE HANDLING ---
self.addEventListener('message', (event) => {
    if (event.data.type === 'SET_FIREBASE_CONFIG') {
        initializeFCM(event.data.config);
    }
    
    const target = (event.ports && event.ports[0]) || event.source;

    if (event.data.type === 'CACHE_TILES') {
        cacheTiles(event.data.tiles, target);
    }

    if (event.data.type === 'CLEAR_CACHE') {
        caches.delete(TILE_CACHE_NAME).then(() => {
            if (target && target.postMessage) {
                target.postMessage({ type: 'CACHE_CLEARED' });
            }
        });
    }

    if (event.data.type === 'GET_CACHE_SIZE') {
        caches.open(TILE_CACHE_NAME).then((cache) => cache.keys()).then((keys) => {
            if (target && target.postMessage) {
                target.postMessage({ type: 'CACHE_SIZE', count: keys.length });
            }
        });
    }
});

// Refinement: Capped to 15K to prevent silent cache evictions on iOS Safari and mobile WebViews
const MAX_TILES = 15000;

async function cacheTiles(tileUrls, client) {
    const cache = await caches.open(TILE_CACHE_NAME);
    const existingKeys = await cache.keys();
    let currentCount = existingKeys.length;

    let cached = 0;
    const total = tileUrls.length;

    for (const url of tileUrls) {
        if (currentCount >= MAX_TILES) break;
        try {
            const response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response);
                cached++;
                currentCount++;
            }
            if (client && client.postMessage) {
                client.postMessage({ type: 'CACHE_PROGRESS', cached, total });
            }
        } catch (error) {
            console.warn('[SW] Failed to cache tile:', url);
        }
    }

    if (client && client.postMessage) {
        client.postMessage({ type: 'CACHE_COMPLETE', cached });
    }
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data;
    let targetUrl = '/';
    if (data?.type === 'geofence_enter' || data?.type === 'geofence_exit') {
        targetUrl = `/?member=${data.memberId}`;
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin)) {
                    client.focus();
                    client.postMessage({ type: 'NOTIFICATION_CLICK', data });
                    return;
                }
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});

console.log('[SW] READY (Unified)');
