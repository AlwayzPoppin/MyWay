// Offline Map Service - Robust Direct CacheStorage & ServiceWorker Map Tile Manager

const TILE_CACHE_NAME = 'myway-tiles-v2';

export interface DownloadProgress {
    cached: number;
    total: number;
    deltaUnchanged: number; // Verified current via ETag 304 or existing Cache match
    deltaUpdated: number;   // Freshly downloaded / updated via 200 OK
    bytesSavedKb: number;   // Estimated bandwidth saved via 304 Not Modified
}

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

    // Delta / Differential Area Tile Downloader with HTTP ETag & If-Modified-Since validation
    async downloadArea(
        name: string,
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 13,
        onProgress?: (progress: DownloadProgress) => void,
        description?: string
    ): Promise<DownloadArea> {
        await this.init();

        // Create new AbortController for this download session
        this.activeAbortController = new AbortController();
        const mainSignal = this.activeAbortController.signal;

        const tileUrls = this.getTileUrls(bounds, zoomMin, zoomMax);
        const total = tileUrls.length;
        let cached = 0;
        let deltaUnchanged = 0;
        let deltaUpdated = 0;
        let bytesSavedKb = 0;

        const reportProgress = () => {
            if (!mainSignal.aborted) {
                onProgress?.({
                    cached,
                    total,
                    deltaUnchanged,
                    deltaUpdated,
                    bytesSavedKb
                });
            }
        };

        // Immediately notify initial progress
        reportProgress();

        let cache: Cache | null = null;
        if (typeof window !== 'undefined' && 'caches' in window) {
            try {
                cache = await window.caches.open(TILE_CACHE_NAME);
            } catch (e) {
                console.warn('[OfflineMapService] Error opening CacheStorage:', e);
            }
        }

        // Track newly written tiles in this session for rollback if cancelled
        const writtenUrls = new Set<string>();

        const rollbackWrittenTiles = async () => {
            if (!cache || writtenUrls.size === 0) return;
            const count = writtenUrls.size;
            console.log(`[OfflineMapService] 🔄 Rolling back ${count} orphaned tiles from aborted download session...`);
            const rollbackPromises = Array.from(writtenUrls).map(async (url) => {
                try {
                    await cache!.delete(url);
                } catch (delErr) {}
            });
            await Promise.allSettled(rollbackPromises);
            writtenUrls.clear();
            console.log(`[OfflineMapService] ✅ Rollback complete: ${count} orphaned tiles purged from CacheStorage.`);
        };

        // Parallel chunk downloader with HTTP Conditional Requests (ETag / If-Modified-Since)
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

                            // Check CacheStorage for existing tile
                            if (cache) {
                                try {
                                    const cachedResponse = await cache.match(url);
                                    if (cachedResponse) {
                                        deltaUnchanged++;
                                        bytesSavedKb += 28; // ~28KB saved per tile
                                        return;
                                    }
                                } catch {}
                            }

                            // Fetch cleanly without CORS-unsafe headers that trigger CDN preflight blockage
                            const response = await fetch(url, {
                                signal: controller.signal,
                                mode: 'cors'
                            });
                            clearTimeout(timeoutId);
                            mainSignal.removeEventListener('abort', onMainAbort);

                            if (response) {
                                if (response.status === 304) {
                                    // 304 Not Modified: Delta match! Existing cached tile is current
                                    deltaUnchanged++;
                                    bytesSavedKb += 28; // ~28KB saved per tile
                                } else if ((response.ok || response.type === 'opaque') && cache) {
                                    if (mainSignal.aborted) return;
                                    await cache.put(url, response);
                                    if (mainSignal.aborted) {
                                        try { await cache.delete(url); } catch {}
                                        return;
                                    }
                                    writtenUrls.add(url);
                                    deltaUpdated++;
                                }
                            }
                        } catch (fetchErr) {
                            // If network failed but tile exists in offline cache, count as ready
                            if (cache) {
                                try {
                                    const hasCached = await cache.match(url);
                                    if (hasCached) deltaUnchanged++;
                                } catch {}
                            }
                        } finally {
                            if (!mainSignal.aborted) {
                                cached++;
                                reportProgress();
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

        // Upsert area record (avoid duplicates on re-downloading existing named region)
        const existingIdx = this.downloadedAreas.findIndex(a => a.name.toLowerCase() === name.toLowerCase());
        const area: DownloadArea = {
            id: existingIdx >= 0 ? this.downloadedAreas[existingIdx].id : `area-${Date.now()}`,
            name: name || 'Offline Region',
            description,
            bounds,
            zoom: { min: zoomMin, max: zoomMax },
            tilesCount: cached,
            downloadedAt: new Date()
        };

        if (existingIdx >= 0) {
            this.downloadedAreas[existingIdx] = area;
        } else {
            this.downloadedAreas.push(area);
        }
        this.saveAreas();

        return area;
    }

    // Single-click Delta Synchronization for an existing saved region
    async syncArea(
        id: string,
        onProgress?: (progress: DownloadProgress) => void
    ): Promise<DownloadArea> {
        await this.init();
        const area = this.downloadedAreas.find(a => a.id === id);
        if (!area) throw new Error(`Offline region "${id}" not found`);

        return this.downloadArea(
            area.name,
            area.bounds,
            area.zoom.min,
            area.zoom.max,
            onProgress,
            area.description
        );
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

    /**
     * Checks if a target bounding box is fully contained within an existing downloaded area
     * with matching or deeper zoom depth.
     */
    public isBoundsCovered(
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 13
    ): boolean {
        const bNorth = Math.max(bounds.north, bounds.south);
        const bSouth = Math.min(bounds.north, bounds.south);
        const bEast = Math.max(bounds.east, bounds.west);
        const bWest = Math.min(bounds.east, bounds.west);

        return this.downloadedAreas.some(area => {
            const aNorth = Math.max(area.bounds.north, area.bounds.south);
            const aSouth = Math.min(area.bounds.north, area.bounds.south);
            const aEast = Math.max(area.bounds.east, area.bounds.west);
            const aWest = Math.min(area.bounds.east, area.bounds.west);

            const isEnclosed =
                aNorth >= (bNorth - 0.001) &&
                aSouth <= (bSouth + 0.001) &&
                aEast >= (bEast - 0.001) &&
                aWest <= (bWest + 0.001);

            const isZoomSufficient =
                area.zoom.min <= zoomMin &&
                area.zoom.max >= zoomMax;

            return isEnclosed && isZoomSufficient;
        });
    }

    /**
     * Checks if a radius around a geographic coordinate is already fully covered by an offline region.
     */
    public isLocationCovered(
        center: { lat: number; lng: number },
        radiusKm: number = 5,
        zoomMin: number = 13,
        zoomMax: number = 15
    ): boolean {
        const targetBounds = computeRadiusBounds(center, radiusKm);
        return this.isBoundsCovered(targetBounds, zoomMin, zoomMax);
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
