// Service Worker for Offline Map Tile Caching
const CACHE_NAME = 'myway-offline-maps-v1';
const TILE_CACHE_NAME = 'myway-tiles-v1';

// Tile URL patterns to cache
const TILE_PATTERNS = [
    'basemaps.cartocdn.com',
    'tile.openstreetmap.org'
];

self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');
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

// Intercept fetch requests
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Check if this is a map tile request
    const isTileRequest = TILE_PATTERNS.some(pattern => url.includes(pattern));

    if (isTileRequest) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        // Return cached tile
                        return cachedResponse;
                    }

                    // Fetch and cache the tile
                    return fetch(event.request).then((networkResponse) => {
                        // Clone response before caching
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    }).catch(() => {
                        // Return placeholder for offline
                        return new Response('', { status: 503, statusText: 'Offline' });
                    });
                });
            })
        );
    }
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    if (event.data.type === 'CACHE_TILES') {
        const { tiles } = event.data;
        cacheTiles(tiles, event.source);
    }

    if (event.data.type === 'CLEAR_CACHE') {
        clearTileCache(event.source);
    }

    if (event.data.type === 'GET_CACHE_SIZE') {
        getCacheSize(event.source);
    }
});

async function cacheTiles(tileUrls, client) {
    const cache = await caches.open(TILE_CACHE_NAME);
    let cached = 0;
    const total = tileUrls.length;

    for (const url of tileUrls) {
        try {
            const response = await fetch(url);
            await cache.put(url, response);
            cached++;

            // Report progress
            client.postMessage({
                type: 'CACHE_PROGRESS',
                cached,
                total
            });
        } catch (error) {
            console.warn('[SW] Failed to cache tile:', url);
        }
    }

    client.postMessage({
        type: 'CACHE_COMPLETE',
        cached,
        total
    });
}

async function clearTileCache(client) {
    await caches.delete(TILE_CACHE_NAME);
    client.postMessage({ type: 'CACHE_CLEARED' });
}

async function getCacheSize(client) {
    const cache = await caches.open(TILE_CACHE_NAME);
    const keys = await cache.keys();
    client.postMessage({
        type: 'CACHE_SIZE',
        count: keys.length
    });
}
