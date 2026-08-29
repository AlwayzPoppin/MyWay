// Offline Map Service - Robust Direct CacheStorage & ServiceWorker Map Tile Manager

const TILE_CACHE_NAME = 'myway-tiles-v1';

export interface DownloadArea {
    id: string;
    name: string;
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
        zoomMax: number = 14,
        style: 'light_all' | 'dark_all' = 'dark_all'
    ): string[] {
        const urls: string[] = [
            'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
        ];
        const subdomains = ['a', 'b', 'c', 'd'];

        for (let z = zoomMin; z <= zoomMax; z++) {
            const topLeft = this.latLngToTile(bounds.north, bounds.west, z);
            const bottomRight = this.latLngToTile(bounds.south, bounds.east, z);

            const minX = Math.min(topLeft.x, bottomRight.x);
            const maxX = Math.max(topLeft.x, bottomRight.x);
            const minY = Math.min(topLeft.y, bottomRight.y);
            const maxY = Math.max(topLeft.y, bottomRight.y);

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const subdomain = subdomains[(x + y) % subdomains.length];
                    urls.push(`https://${subdomain}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`);
                    if (style === 'dark_all') {
                        urls.push(`https://${subdomain}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}@2x.png`);
                    }
                }
            }
        }

        // Deduplicate URLs
        return Array.from(new Set(urls));
    }

    // Estimate tile count for a given area
    estimateTileCount(
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 14
    ): number {
        let count = 0;
        for (let z = zoomMin; z <= zoomMax; z++) {
            const topLeft = this.latLngToTile(bounds.north, bounds.west, z);
            const bottomRight = this.latLngToTile(bounds.south, bounds.east, z);
            const xCount = Math.abs(bottomRight.x - topLeft.x) + 1;
            const yCount = Math.abs(bottomRight.y - topLeft.y) + 1;
            count += xCount * yCount;
        }
        return count;
    }

    // Download tiles for a given area with direct high-performance CacheStorage batching
    async downloadArea(
        name: string,
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 14,
        onProgress?: (cached: number, total: number) => void
    ): Promise<DownloadArea> {
        await this.init();

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

        // Parallel chunk downloader (batches of 8 concurrent requests)
        const BATCH_SIZE = 8;
        for (let i = 0; i < tileUrls.length; i += BATCH_SIZE) {
            const batch = tileUrls.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
                batch.map(async (url) => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 6000);

                        const response = await fetch(url, {
                            signal: controller.signal,
                            mode: 'cors'
                        });
                        clearTimeout(timeoutId);

                        if (response && (response.ok || response.type === 'opaque') && cache) {
                            await cache.put(url, response);
                        }
                    } catch (fetchErr) {
                        // Tolerate single tile failures gracefully
                    } finally {
                        cached++;
                        onProgress?.(cached, total);
                    }
                })
            );
        }

        const area: DownloadArea = {
            id: `area-${Date.now()}`,
            name: name || 'Offline Region',
            bounds,
            zoom: { min: zoomMin, max: zoomMax },
            tilesCount: cached,
            downloadedAt: new Date()
        };

        this.downloadedAreas.push(area);
        this.saveAreas();

        return area;
    }

    getDownloadedAreas(): DownloadArea[] {
        return this.downloadedAreas;
    }

    async clearCache(): Promise<void> {
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
