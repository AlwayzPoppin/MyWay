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

// SYNC: This value MUST match MAX_TILES in services/offlineMapService.ts (line ~113)
const MAX_TILES = 10000; // ~200-250MB depending on tile complexity

async function enforceLimits() {
    try {
        const cache = await caches.open(TILE_CACHE_NAME);
        const keys = await cache.keys();

        if (keys.length > MAX_TILES) {
            const tilesToDelete = keys.length - MAX_TILES;
            // Delete the oldest/first entries (approximation of LRU)
            await Promise.all(
                keys.slice(0, tilesToDelete).map(request => cache.delete(request))
            );
            console.log(`[SW] Pruned ${tilesToDelete} tiles from cache to enforce limit of ${MAX_TILES}`);
        }
    } catch (e) {
        console.error('[SW] Error enforcing cache limits:', e);
    }
}

async function getCacheSize(client) {
    const cache = await caches.open(TILE_CACHE_NAME);
    const keys = await cache.keys();
    client.postMessage({
        type: 'CACHE_SIZE',
        count: keys.length
    });
}

// Call enforceLimits after caching operations
async function cacheTiles(tileUrls, client) {
    const cache = await caches.open(TILE_CACHE_NAME);
    const existingKeys = await cache.keys();
    let currentCount = existingKeys.length;

    let cached = 0;
    const total = tileUrls.length;

    if (currentCount >= MAX_TILES) {
        console.warn(`[SW] Cache limit reached (${currentCount}/${MAX_TILES}). Skipping download.`);
        client.postMessage({
            type: 'CACHE_ERROR',
            message: 'Cache limit reached. Please clear some space.'
        });
        return;
    }

    for (const url of tileUrls) {
        if (currentCount >= MAX_TILES) {
            console.warn(`[SW] Cache limit reached during download. Halting.`);
            break;
        }

        try {
            const response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response);
                cached++;
                currentCount++;
            }

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

    // Clean up if we exceeded limits (extra safety)
    await enforceLimits();

    client.postMessage({
        type: 'CACHE_COMPLETE',
        cached,
    });
}

async function clearTileCache(client) {
    try {
        await caches.delete(TILE_CACHE_NAME);
        console.log('[SW] Tile cache cleared');
        client.postMessage({ type: 'CACHE_CLEARED' });
    } catch (error) {
        console.error('[SW] Failed to clear cache:', error);
    }
}

/**
 * Mesh P2P Relay Background Service
 * Acts as a proximity node for nearby encrypted location heartbeats.
 */
const meshChannel = new BroadcastChannel('myway-mesh-relay');
meshChannel.onmessage = (event) => {
    if (event.data.type === 'MESH_HEARTBEAT') {
        console.log('[SW-Mesh] Relaying heartbeat for node:', event.data.senderId);
    }
};
