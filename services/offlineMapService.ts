// Offline Map Service - Handles tile caching and storage management

const TILE_SIZE = 256;
const CARTO_TILE_URL = 'https://{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{r}.png';

interface DownloadArea {
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

class OfflineMapService {
    private swRegistration: ServiceWorkerRegistration | null = null;
    private downloadedAreas: DownloadArea[] = [];

    async init(): Promise<boolean> {
        if (!('serviceWorker' in navigator)) {
            console.warn('Service Worker not supported');
            return false;
        }

        try {
            this.swRegistration = await navigator.serviceWorker.register('/sw.js');
            console.log('[OfflineMapService] Service Worker registered');

            // Load saved areas from localStorage
            const saved = localStorage.getItem('myway-offline-areas');
            if (saved) {
                this.downloadedAreas = JSON.parse(saved);
            }

            return true;
        } catch (error) {
            console.error('[OfflineMapService] Registration failed:', error);
            return false;
        }
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
    private getTileUrls(
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number,
        zoomMax: number,
        style: 'light_all' | 'dark_all' = 'light_all'
    ): string[] {
        const urls: string[] = [];
        const subdomains = ['a', 'b', 'c', 'd'];

        for (let z = zoomMin; z <= zoomMax; z++) {
            const topLeft = this.latLngToTile(bounds.north, bounds.west, z);
            const bottomRight = this.latLngToTile(bounds.south, bounds.east, z);

            for (let x = topLeft.x; x <= bottomRight.x; x++) {
                for (let y = topLeft.y; y <= bottomRight.y; y++) {
                    const subdomain = subdomains[(x + y) % subdomains.length];
                    const url = `https://${subdomain}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`;
                    urls.push(url);
                }
            }
        }

        return urls;
    }

    // Estimate tile count for a given area
    estimateTileCount(
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number,
        zoomMax: number
    ): number {
        let count = 0;

        for (let z = zoomMin; z <= zoomMax; z++) {
            const topLeft = this.latLngToTile(bounds.north, bounds.west, z);
            const bottomRight = this.latLngToTile(bounds.south, bounds.east, z);
            count += (bottomRight.x - topLeft.x + 1) * (bottomRight.y - topLeft.y + 1);
        }

        return count;
    }

    // Download tiles for a given area
    async downloadArea(
        name: string,
        bounds: { north: number; south: number; east: number; west: number },
        zoomMin: number = 10,
        zoomMax: number = 16,
        onProgress?: (cached: number, total: number) => void
    ): Promise<DownloadArea> {
        if (!this.swRegistration?.active) {
            throw new Error('Service Worker not ready');
        }

        const currentSize = await this.getCacheSize();
        const estimated = this.estimateTileCount(bounds, zoomMin, zoomMax);
        // SYNC: This value MUST match MAX_TILES in public/sw.js (line ~78)
        const MAX_TILES = 2000;

        if (currentSize + estimated > MAX_TILES) {
            console.warn(`[OfflineMapService] Download would exceed limit: ${currentSize + estimated} / ${MAX_TILES}`);
            // We still try, but sw.js will enforce the hard stop. 
            // Better to alert the user here if we had a UI for it.
        }

        const tileUrls = this.getTileUrls(bounds, zoomMin, zoomMax);

        return new Promise((resolve, reject) => {
            const channel = new MessageChannel();

            channel.port1.onmessage = (event) => {
                if (event.data.type === 'CACHE_ERROR') {
                    reject(new Error(event.data.message));
                }

                if (event.data.type === 'CACHE_PROGRESS') {
                    onProgress?.(event.data.cached, event.data.total);
                }

                if (event.data.type === 'CACHE_COMPLETE') {
                    const area: DownloadArea = {
                        id: `area-${Date.now()}`,
                        name,
                        bounds,
                        zoom: { min: zoomMin, max: zoomMax },
                        tilesCount: event.data.cached,
                        downloadedAt: new Date()
                    };

                    this.downloadedAreas.push(area);
                    this.saveAreas();
                    resolve(area);
                }
            };

            this.swRegistration.active.postMessage(
                { type: 'CACHE_TILES', tiles: tileUrls },
                [channel.port2]
            );
        });
    }

    // Get downloaded areas
    getDownloadedAreas(): DownloadArea[] {
        return this.downloadedAreas;
    }

    // Clear all cached tiles
    async clearCache(): Promise<void> {
        if (!this.swRegistration?.active) return;

        return new Promise((resolve) => {
            const channel = new MessageChannel();

            channel.port1.onmessage = (event) => {
                if (event.data.type === 'CACHE_CLEARED') {
                    this.downloadedAreas = [];
                    this.saveAreas();
                    resolve();
                }
            };

            this.swRegistration.active.postMessage(
                { type: 'CLEAR_CACHE' },
                [channel.port2]
            );
        });
    }

    // Get cache size
    async getCacheSize(): Promise<number> {
        if (!this.swRegistration?.active) return 0;

        return new Promise((resolve) => {
            const channel = new MessageChannel();

            channel.port1.onmessage = (event) => {
                if (event.data.type === 'CACHE_SIZE') {
                    resolve(event.data.count);
                }
            };

            this.swRegistration.active.postMessage(
                { type: 'GET_CACHE_SIZE' },
                [channel.port2]
            );
        });
    }

    private saveAreas(): void {
        localStorage.setItem('myway-offline-areas', JSON.stringify(this.downloadedAreas));
    }
}

export const offlineMapService = new OfflineMapService();
export type { DownloadArea };
