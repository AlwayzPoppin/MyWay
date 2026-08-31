import { Location, TrafficControlPoint, TrafficControlType } from '../types';
import { getDistanceMeters } from '../utils/geo';

// Overpass API Endpoints with multi-mirror failover
const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter'
];

interface OSMNode {
    type: 'node';
    id: number;
    lat: number;
    lon: number;
    tags?: Record<string, string>;
}

interface OverpassResponse {
    elements: OSMNode[];
}

interface CacheEntry {
    controls: TrafficControlPoint[];
    timestamp: number;
}

class OSMTrafficService {
    private cache = new Map<string, CacheEntry>();
    private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
    private activeRequests = new Map<string, Promise<TrafficControlPoint[]>>();

    /**
     * Compute a cache key from bounding box rounded to 3 decimal places (~100m)
     */
    private getBBoxKey(minLat: number, minLng: number, maxLat: number, maxLng: number): string {
        return `${minLat.toFixed(3)},${minLng.toFixed(3)},${maxLat.toFixed(3)},${maxLng.toFixed(3)}`;
    }

    /**
     * Fetch real OpenStreetMap ground-truth traffic signals, stop signs, and railroad crossings
     * for a given bounding box.
     */
    public async fetchControlsInBBox(
        minLat: number,
        minLng: number,
        maxLat: number,
        maxLng: number
    ): Promise<TrafficControlPoint[]> {
        const cacheKey = this.getBBoxKey(minLat, minLng, maxLat, maxLng);
        const cached = this.cache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL_MS)) {
            return cached.controls;
        }

        // Deduplicate simultaneous requests for the same bbox
        if (this.activeRequests.has(cacheKey)) {
            return this.activeRequests.get(cacheKey)!;
        }

        const queryPromise = (async () => {
            // Overpass QL Query for real physical traffic infrastructure
            const bboxStr = `${minLat.toFixed(6)},${minLng.toFixed(6)},${maxLat.toFixed(6)},${maxLng.toFixed(6)}`;
            const overpassQL = `[out:json][timeout:6];
(
  node["highway"="traffic_signals"](${bboxStr});
  node["highway"="stop"](${bboxStr});
  node["railway"="level_crossing"](${bboxStr});
  node["railway"="crossing"](${bboxStr});
  node["highway"="speed_camera"](${bboxStr});
);
out body;`;

            for (const endpoint of OVERPASS_ENDPOINTS) {
                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': 'MyWay-GPS-Navigation/1.0 (contact@mywaygps.com)'
                        },
                        body: 'data=' + encodeURIComponent(overpassQL),
                        signal: AbortSignal.timeout(6000)
                    });

                    if (!response.ok) continue;

                    const data: OverpassResponse = await response.json();
                    if (!data.elements || !Array.isArray(data.elements)) continue;

                    const controls: TrafficControlPoint[] = [];

                    data.elements.forEach(el => {
                        if (!el.lat || !el.lon) return;

                        let type: TrafficControlType | null = null;
                        const tags = el.tags || {};

                        if (tags.highway === 'traffic_signals') {
                            type = 'traffic_light';
                        } else if (tags.highway === 'stop') {
                            type = 'stop_sign';
                        } else if (tags.railway === 'level_crossing' || tags.railway === 'crossing') {
                            type = 'railroad_crossing';
                        } else if (tags.highway === 'speed_camera') {
                            type = 'speed_camera';
                        }

                        if (type) {
                            controls.push({
                                id: `osm_${el.id}`,
                                type,
                                location: {
                                    lat: el.lat,
                                    lng: el.lon
                                },
                                name: tags.name || (
                                    type === 'traffic_light' ? 'Traffic Signal' :
                                    type === 'stop_sign' ? 'Stop Sign' :
                                    type === 'railroad_crossing' ? 'Railroad Crossing' : 'Speed Camera'
                                )
                            });
                        }
                    });

                    // Save to memory cache
                    this.cache.set(cacheKey, {
                        controls,
                        timestamp: Date.now()
                    });

                    return controls;
                } catch (e) {
                    console.warn(`[OSMTraffic] Endpoint ${endpoint} failed:`, e);
                }
            }

            return [];
        })();

        this.activeRequests.set(cacheKey, queryPromise);
        try {
            const results = await queryPromise;
            return results;
        } finally {
            this.activeRequests.delete(cacheKey);
        }
    }

    /**
     * Fetch real OSM traffic controls along an active route polyline,
     * filtering to only include controls within 35 meters of the traveled road corridor.
     */
    public async fetchControlsForRoute(routeGeometry: [number, number][]): Promise<TrafficControlPoint[]> {
        if (!routeGeometry || routeGeometry.length < 2) return [];

        // 1. Calculate route bounding box
        let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
        routeGeometry.forEach(pt => {
            const lng = pt[0];
            const lat = pt[1];
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        });

        // Add 300-meter padding (~0.003 degrees)
        minLat -= 0.003;
        maxLat += 0.003;
        minLng -= 0.003;
        maxLng += 0.003;

        // 2. Fetch all real OSM nodes in the bounding box
        const rawControls = await this.fetchControlsInBBox(minLat, minLng, maxLat, maxLng);
        if (rawControls.length === 0) return [];

        // 3. Distance-filter: Keep only controls within 35 meters of the actual route polyline segments
        const CORRIDOR_MAX_DIST_METERS = 35;
        const matchedControls: TrafficControlPoint[] = [];

        rawControls.forEach(ctrl => {
            let isNearRoute = false;
            for (let i = 0; i < routeGeometry.length - 1; i++) {
                const p1 = { lng: routeGeometry[i][0], lat: routeGeometry[i][1] };
                const p2 = { lng: routeGeometry[i + 1][0], lat: routeGeometry[i + 1][1] };

                // Fast segment bounding box pre-check
                const segMinLat = Math.min(p1.lat, p2.lat) - 0.0004;
                const segMaxLat = Math.max(p1.lat, p2.lat) + 0.0004;
                const segMinLng = Math.min(p1.lng, p2.lng) - 0.0004;
                const segMaxLng = Math.max(p1.lng, p2.lng) + 0.0004;

                if (
                    ctrl.location.lat >= segMinLat && ctrl.location.lat <= segMaxLat &&
                    ctrl.location.lng >= segMinLng && ctrl.location.lng <= segMaxLng
                ) {
                    const distToP1 = getDistanceMeters(ctrl.location, p1);
                    const distToP2 = getDistanceMeters(ctrl.location, p2);
                    if (distToP1 <= CORRIDOR_MAX_DIST_METERS || distToP2 <= CORRIDOR_MAX_DIST_METERS) {
                        isNearRoute = true;
                        break;
                    }
                }
            }

            if (isNearRoute) {
                matchedControls.push(ctrl);
            }
        });

        return matchedControls;
    }
}

export const osmTrafficService = new OSMTrafficService();
