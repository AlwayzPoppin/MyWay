// Offline Map Service - Robust Direct CacheStorage & ServiceWorker Map Tile Manager

const TILE_CACHE_NAME = 'myway-tiles-v1';

export interface DownloadArea {
    id: string;
    name: string;
    description?: string;
    bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    };
    zoom: { min: number; max: number };
    tilesCount: number;
    downloadedAt: Date;
}

// Calculate 80km radius bounding box around coordinates
export function computeRadiusBounds(center: { lat: number; lng: number }, radiusKm: number = 80): { north: number; south: number; east: number; west: number } {
    const latOffset = radiusKm / 111;
    const lngOffset = radiusKm / (111 * Math.cos(center.lat * Math.PI / 180));
    return {
        north: Math.min(85, center.lat + latOffset),
        south: Math.max(-85, center.lat - latOffset),
        east: Math.min(180, center.lng + lngOffset),
        west: Math.max(-180, center.lng - lngOffset)
    };
}

class OfflineMapService {
    private downloadedAreas: DownloadArea[] = [];
    private isInitialized = false;
    private activeAbortController: AbortController | null = null;

    async init(): Promise<boolean> {
        if (this.isInitialized) return true;

        // Load saved areas from localStorage
        try {
            const saved = localStorage.getItem('myway-offline-areas');
            if (saved) {
                this.downloadedAreas = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[OfflineMapService] Failed to load saved areas:', e);
        }

        // Register Service Worker in background if supported
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('/sw.js');
                console.log('[OfflineMapService] Service Worker registered');
            } catch (error) {
                console.warn('[OfflineMapService] Service Worker registration warning (falling back to direct CacheStorage):', error);
            }
        }

        this.isInitialized = true;
        return true;
    }

    // Calculate tile coordinates for a given lat/lng and zoom
    private latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
        const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
        const y = Math.floor(
            (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
        );
        return { x, y };
    }

    // Generate all tile URLs for a bounding box
    public getTileUrls(
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 13,
        style: 'light_all' | 'dark_all' = 'dark_all'
    ): string[] {
        // Bounds sanity check & normalization
        const north = Math.max(bounds.north, bounds.south);
        const south = Math.min(bounds.north, bounds.south);
        const east = Math.max(bounds.east, bounds.west);
        const west = Math.min(bounds.east, bounds.west);

        // Discard absurd or world-spanning inverted bounds
        if (Math.abs(north - south) > 20 || Math.abs(east - west) > 20) {
            console.warn('[offlineMapService] Bounding box too large for tile batch, skipping to prevent memory overflow');
            return [];
        }

        const urls: string[] = [
            'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
        ];
        const subdomains = ['a', 'b', 'c', 'd'];
        const MAX_TOTAL_TILES = 1500;

        for (let z = zoomMin; z <= zoomMax; z++) {
            const topLeft = this.latLngToTile(north, west, z);
            const bottomRight = this.latLngToTile(south, east, z);

            const minX = Math.min(topLeft.x, bottomRight.x);
            const maxX = Math.max(topLeft.x, bottomRight.x);
            const minY = Math.min(topLeft.y, bottomRight.y);
            const maxY = Math.max(topLeft.y, bottomRight.y);

            const xSpan = maxX - minX + 1;
            const ySpan = maxY - minY + 1;
            if (xSpan * ySpan > 800) {
                console.warn(`[offlineMapService] Zoom ${z} tile count (${xSpan * ySpan}) exceeds limit, skipping zoom level.`);
                continue;
            }

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    if (urls.length >= MAX_TOTAL_TILES) break;
                    const subdomain = subdomains[(x + y) % subdomains.length];
                    urls.push(`https://${subdomain}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`);
                }
                if (urls.length >= MAX_TOTAL_TILES) break;
            }
            if (urls.length >= MAX_TOTAL_TILES) break;
        }

        // Deduplicate URLs
        return Array.from(new Set(urls));
    }

    // Estimate tile count for a given area
    estimateTileCount(
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 13
    ): number {
        const north = Math.max(bounds.north, bounds.south);
        const south = Math.min(bounds.north, bounds.south);
        const east = Math.max(bounds.east, bounds.west);
        const west = Math.min(bounds.east, bounds.west);

        if (Math.abs(north - south) > 20 || Math.abs(east - west) > 20) {
            return 0;
        }

        let count = 3; // style JSONs
        for (let z = zoomMin; z <= zoomMax; z++) {
            const topLeft = this.latLngToTile(north, west, z);
            const bottomRight = this.latLngToTile(south, east, z);
            const xCount = Math.abs(bottomRight.x - topLeft.x) + 1;
            const yCount = Math.abs(bottomRight.y - topLeft.y) + 1;
            count += Math.min(xCount * yCount, 1000);
        }
        return Math.min(count, 1500);
    }

    // Cancel active download
    cancelDownload(): void {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = null;
        }
    }

    // Download tiles for a given area with direct high-performance CacheStorage batching & cancellation
    async downloadArea(
        name: string,
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 13,
        onProgress?: (cached: number, total: number) => void,
        description?: string
    ): Promise<DownloadArea> {
        await this.init();

        // Create new AbortController for this download session
        this.activeAbortController = new AbortController();
        const mainSignal = this.activeAbortController.signal;

        const tileUrls = this.getTileUrls(bounds, zoomMin, zoomMax);
        const total = tileUrls.length;
        let cached = 0;

        // Immediately notify initial progress
        onProgress?.(0, total);

        let cache: Cache | null = null;
        if (typeof window !== 'undefined' && 'caches' in window) {
            try {
                cache = await window.caches.open(TILE_CACHE_NAME);
            } catch (e) {
                console.warn('[OfflineMapService] Error opening CacheStorage:', e);
            }
        }

        // Track all tiles successfully written to CacheStorage during this download session
        // to enable full transaction rollback if the download is cancelled/aborted
        const writtenUrls = new Set<string>();

        const rollbackWrittenTiles = async () => {
            if (!cache || writtenUrls.size === 0) return;
            const count = writtenUrls.size;
            console.log(`[OfflineMapService] 🔄 Rolling back ${count} orphaned tiles from aborted download session...`);
            const rollbackPromises = Array.from(writtenUrls).map(async (url) => {
                try {
                    await cache!.delete(url);
                } catch (delErr) {
                    // Tolerate individual cache delete failures during rollback
                }
            });
            await Promise.allSettled(rollbackPromises);
            writtenUrls.clear();
            console.log(`[OfflineMapService] ✅ Rollback complete: ${count} orphaned tiles purged from CacheStorage.`);
        };

        // Parallel chunk downloader (batches of 12 concurrent requests)
        const BATCH_SIZE = 12;
        try {
            for (let i = 0; i < tileUrls.length; i += BATCH_SIZE) {
                if (mainSignal.aborted) {
                    await rollbackWrittenTiles();
                    throw new DOMException('Download cancelled by user', 'AbortError');
                }

                const batch = tileUrls.slice(i, i + BATCH_SIZE);
                await Promise.allSettled(
                    batch.map(async (url) => {
                        if (mainSignal.aborted) return;
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 6000);

                            const onMainAbort = () => controller.abort();
                            mainSignal.addEventListener('abort', onMainAbort, { once: true });

                            const response = await fetch(url, {
                                signal: controller.signal,
                                mode: 'cors'
                            });
                            clearTimeout(timeoutId);
                            mainSignal.removeEventListener('abort', onMainAbort);

                            if (response && (response.ok || response.type === 'opaque') && cache) {
                                if (mainSignal.aborted) return;
                                await cache.put(url, response);
                                if (mainSignal.aborted) {
                                    try { await cache.delete(url); } catch {}
                                    return;
                                }
                                writtenUrls.add(url);
                            }
                        } catch (fetchErr) {
                            // Tolerate single tile failures gracefully
                        } finally {
                            if (!mainSignal.aborted) {
                                cached++;
                                onProgress?.(cached, total);
                            }
                        }
                    })
                );
            }

            if (mainSignal.aborted) {
                await rollbackWrittenTiles();
                throw new DOMException('Download cancelled by user', 'AbortError');
            }
        } catch (err: any) {
            if (mainSignal.aborted || err?.name === 'AbortError') {
                await rollbackWrittenTiles();
            }
            this.activeAbortController = null;
            throw err;
        }

        this.activeAbortController = null;

        const area: DownloadArea = {
            id: `area-${Date.now()}`,
            name: name || 'Offline Region',
            description,
            bounds,
            zoom: { min: zoomMin, max: zoomMax },
            tilesCount: cached,
            downloadedAt: new Date()
        };

        this.downloadedAreas.push(area);
        this.saveAreas();

        return area;
    }

    async deleteArea(id: string): Promise<boolean> {
        await this.init();
        const areaIndex = this.downloadedAreas.findIndex(a => a.id === id);
        if (areaIndex === -1) return false;
        const area = this.downloadedAreas[areaIndex];
        
        // Calculate tile URLs for this area and remove them from cache
        const tileUrls = this.getTileUrls(area.bounds, area.zoom.min, area.zoom.max);
        if (typeof window !== 'undefined' && 'caches' in window) {
            try {
                const cache = await window.caches.open(TILE_CACHE_NAME);
                await Promise.allSettled(tileUrls.map(url => cache.delete(url)));
            } catch (e) {
                console.warn('[OfflineMapService] Error removing tiles for deleted area:', e);
            }
        }

        this.downloadedAreas.splice(areaIndex, 1);
        this.saveAreas();
        return true;
    }

    getDownloadedAreas(): DownloadArea[] {
        return this.downloadedAreas;
    }

    async clearCache(): Promise<void> {
        this.cancelDownload();
        if (typeof window !== 'undefined' && 'caches' in window) {
            try {
                await window.caches.delete(TILE_CACHE_NAME);
            } catch (e) {
                console.warn('[OfflineMapService] Error deleting cache:', e);
            }
        }
        this.downloadedAreas = [];
        this.saveAreas();
    }

    async getCacheSize(): Promise<number> {
        if (typeof window !== 'undefined' && 'caches' in window) {
            try {
                const cache = await window.caches.open(TILE_CACHE_NAME);
                const keys = await cache.keys();
                return keys.length;
            } catch (e) {
                return 0;
            }
        }
        return 0;
    }

    private saveAreas(): void {
        try {
            localStorage.setItem('myway-offline-areas', JSON.stringify(this.downloadedAreas));
        } catch (e) {
            console.warn('[OfflineMapService] Failed to save offline areas:', e);
        }
    }
}

export const offlineMapService = new OfflineMapService();
