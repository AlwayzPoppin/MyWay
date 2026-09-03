// Ambient POI Service - High-Accuracy Survey-Grade Coordinates for Gas & Emergency Services
import { Place, Location } from '../types';
import { getDistanceMeters } from '../utils/geo';
import { placeCorrectionService } from './placeCorrectionService';

const STORAGE_PREFIX = 'myway_ambient_pois_v7_';
const OVERPASS_MIRRORS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
];

// Permanently closed or demolished locations to suppress from historical map caches
// Closed or suppressed locations filter
const CLOSED_OR_SUPPRESSED_LOCATIONS: { lat: number; lng: number; radiusMeters: number }[] = [];

class AmbientPoiService {
    private currentPois: Place[] = [];
    private lastFetchCenter: Location | null = null;
    private isFetching: boolean = false;
    private listeners: Set<(pois: Place[]) => void> = new Set();

    constructor() {
        this.purgeLegacyCaches();
        this.currentPois = this.loadInitialCachedPois();
    }

    private loadInitialCachedPois(): Place[] {
        if (typeof window === 'undefined' || !window.localStorage) return [];
        try {
            // First check latest ambient POIs cached on this device
            const latest = localStorage.getItem('myway_ambient_pois_latest');
            if (latest) {
                const parsed = JSON.parse(latest);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
            // Check any existing partitioned ambient POI key
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(STORAGE_PREFIX)) {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
                    }
                }
            }
        } catch (e) {}
        return [];
    }

    private purgeLegacyCaches(): void {
        if (typeof window === 'undefined' || !window.localStorage) return [];
        try {
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('myway_ambient_pois_') && !key.startsWith(STORAGE_PREFIX) && key !== 'myway_ambient_pois_latest') {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
    }

    public getPois(): Place[] {
        return placeCorrectionService.applyCorrectionsToPlaces(this.currentPois);
    }

    public subscribe(listener: (pois: Place[]) => void): () => void {
        this.listeners.add(listener);
        listener(this.getPois());
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        const corrected = this.getPois();
        this.listeners.forEach(cb => cb(corrected));
    }

    /**
     * Fetch accurate emergency services and gas stations for the given location or bounds.
     */
    public async updateAmbientPois(
        location?: Location | null,
        bounds?: { north: number; south: number; east: number; west: number } | null,
        force: boolean = false
    ): Promise<Place[]> {
        const targetLoc = location || (bounds ? {
            lat: (bounds.north + bounds.south) / 2,
            lng: (bounds.east + bounds.west) / 2
        } : null);

        if (!targetLoc || typeof targetLoc.lat !== 'number' || typeof targetLoc.lng !== 'number') {
            return this.getPois();
        }

        // Proximity throttling (1.0 km threshold)
        if (!force && this.lastFetchCenter) {
            const distance = getDistanceMeters(targetLoc, this.lastFetchCenter);
            if (distance < 1000 && this.currentPois.length > 20) {
                return this.getPois();
            }
        }

        if (this.isFetching) return this.getPois();
        this.isFetching = true;

        try {
            const latBucket = Math.round(targetLoc.lat * 50) / 50;
            const lngBucket = Math.round(targetLoc.lng * 50) / 50;
            const cacheKey = `${STORAGE_PREFIX}${latBucket}_${lngBucket}`;

            // Check LocalStorage cache for this geographic bucket
            const cachedRaw = localStorage.getItem(cacheKey);
            if (cachedRaw && !force) {
                try {
                    const parsed: Place[] = JSON.parse(cachedRaw);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const filtered = parsed.filter(p => ['gas', 'fire_station', 'hospital', 'police'].includes(p.type));
                        this.currentPois = filtered;
                        this.lastFetchCenter = targetLoc;
                        this.notify();
                        this.isFetching = false;
                        return this.getPois();
                    }
                } catch (e) {}
            }

            // High-Performance Query (Overpass primary, Nominatim fallback)
            let fetchedPois = await this.fetchFromOverpass(targetLoc, bounds);
            if (fetchedPois.length === 0) {
                fetchedPois = await this.fetchFromNominatim(targetLoc, bounds);
            }

            if (fetchedPois.length > 0) {
                // Live Overpass / OSM bounding box results are authoritative
                this.currentPois = fetchedPois;
                this.lastFetchCenter = targetLoc;
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(fetchedPois));
                    localStorage.setItem('myway_ambient_pois_latest', JSON.stringify(fetchedPois));
                } catch (e) {}
                this.notify();
            }
        } catch (err) {
            console.warn('[AmbientPoiService] Live query failed, retaining cached POIs:', err);
        } finally {
            this.isFetching = false;
        }

        return this.getPois();
    }

    private async fetchFromOverpass(
        center: Location,
        bounds?: { north: number; south: number; east: number; west: number } | null
    ): Promise<Place[]> {
        // Use exact viewport bounds expanded slightly (0.005 deg) for edge coverage
        const s = bounds ? bounds.south - 0.005 : center.lat - 0.05;
        const w = bounds ? bounds.west - 0.005 : center.lng - 0.06;
        const n = bounds ? bounds.north + 0.005 : center.lat + 0.05;
        const e = bounds ? bounds.east + 0.005 : center.lng + 0.06;

        const overpassQL = `
[out:json][timeout:8];
(
  nw["amenity"="fuel"]["disused"!="yes"]["abandoned"!="yes"](${s},${w},${n},${e});
  nw["amenity"="fire_station"](${s},${w},${n},${e});
  nw["amenity"="hospital"](${s},${w},${n},${e});
  nw["emergency"="ambulance_station"](${s},${w},${n},${e});
  nw["amenity"="police"](${s},${w},${n},${e});
);
out center 120;
`;

        for (const mirror of OVERPASS_MIRRORS) {
            try {
                const res = await fetch(mirror, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'User-Agent': 'MyWay-GPS/1.0'
                    },
                    body: `data=${encodeURIComponent(overpassQL)}`,
                    signal: AbortSignal.timeout(4500)
                });

                if (!res.ok) continue;

                const data = await res.json();
                const elements = data.elements || [];
                if (elements.length === 0) continue;

                return elements.map((el: any, idx: number) => {
                    const tags = el.tags || {};
                    const lat = el.lat ?? el.center?.lat ?? 0;
                    const lng = el.lon ?? el.center?.lon ?? 0;
                    if (!lat || !lng) return null;

                    // Filter out permanently closed, demolished, or suppressed stations (e.g. 5030 Yadkin Rd)
                    const isSuppressed = CLOSED_OR_SUPPRESSED_LOCATIONS.some(
                        loc => getDistanceMeters({ lat, lng }, { lat: loc.lat, lng: loc.lng }) < loc.radiusMeters
                    );
                    if (isSuppressed) return null;
                    if (tags.disused === 'yes' || tags.abandoned === 'yes' || tags.closed === 'yes') return null;
                    if (tags['disused:amenity'] || tags['abandoned:amenity']) return null;

                    const amenity = tags.amenity || tags.emergency || '';

                    let placeType: Place['type'] = 'gas';
                    let icon = '⛽';
                    let brandColor = '#ea580c';
                    let defaultName = 'Gas Station';

                    if (amenity === 'fuel') {
                        placeType = 'gas';
                        icon = '⛽';
                        brandColor = '#f97316';
                        defaultName = tags.brand || tags.operator || 'Gas Station';
                    } else if (amenity === 'fire_station') {
                        placeType = 'fire_station';
                        icon = '🚒';
                        brandColor = '#ef4444';
                        defaultName = 'Fire Station';
                    } else if (amenity === 'hospital' || amenity === 'ambulance_station') {
                        placeType = 'hospital';
                        icon = '🏥';
                        brandColor = '#e11d48';
                        defaultName = 'Hospital';
                    } else if (amenity === 'police') {
                        placeType = 'police';
                        icon = '🚓';
                        brandColor = '#2563eb';
                        defaultName = 'Police Dept';
                    } else {
                        return null;
                    }

                    let name = tags.name || tags.brand || tags.operator || defaultName;
                    
                    if (name.toLowerCase().includes("sam's club") && amenity === 'fuel') {
                        name = "Sam's Club Fuel";
                    }

                    name = name.replace(/\s+#\d+$/, '').trim();
                    const street = tags['addr:street'] ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}`.trim() : '';

                    return {
                        id: `ambient-osm-${el.id || idx}`,
                        name,
                        location: { lat, lng },
                        radius: 0.15,
                        type: placeType,
                        icon,
                        brandColor,
                        description: street ? `${street}, ${tags['addr:city'] || ''}` : `${name} (Emergency / Fuel)`,
                        isAmbient: true
                    };
                }).filter((p: Place | null): p is Place => p !== null && p.location.lat !== 0 && p.location.lng !== 0);
            } catch (err) {
                continue;
            }
        }

        return [];
    }

    private async fetchFromNominatim(
        center: Location,
        bounds?: { north: number; south: number; east: number; west: number } | null
    ): Promise<Place[]> {
        const s = bounds ? bounds.south : center.lat - 0.05;
        const w = bounds ? bounds.west : center.lng - 0.05;
        const n = bounds ? bounds.north : center.lat + 0.05;
        const e = bounds ? bounds.east : center.lng + 0.05;
        
        const viewbox = `${w},${n},${e},${s}`;
        const searchCategories = [
            { q: 'gas station', type: 'gas' as const, icon: '⛽', color: '#ea580c' },
            { q: 'fire station', type: 'fire_station' as const, icon: '🚒', color: '#ef4444' },
            { q: 'hospital', type: 'hospital' as const, icon: '🏥', color: '#e11d48' },
            { q: 'police', type: 'police' as const, icon: '🚓', color: '#2563eb' }
        ];

        const results: Place[] = [];
        for (const cat of searchCategories) {
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cat.q)}&viewbox=${viewbox}&bounded=1&limit=15`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'MyWay-GPS/1.0' },
                    signal: AbortSignal.timeout(3000)
                });
                if (!res.ok) continue;
                const data = await res.json();
                if (Array.isArray(data)) {
                    data.forEach((d: any, idx: number) => {
                        const lat = parseFloat(d.lat);
                        const lng = parseFloat(d.lon);
                        if (!lat || !lng) return;

                        // Filter out permanently closed, demolished, or suppressed stations (e.g. 5030 Yadkin Rd)
                        const isSuppressed = CLOSED_OR_SUPPRESSED_LOCATIONS.some(
                            loc => getDistanceMeters({ lat, lng }, { lat: loc.lat, lng: loc.lng }) < loc.radiusMeters
                        );
                        if (isSuppressed) return;
                        let name = d.display_name?.split(',')[0] || cat.q;
                        if (name.toLowerCase().includes("sam's club")) name = "Sam's Club Fuel";
                        results.push({
                            id: `ambient-nom-${d.place_id || idx}`,
                            name,
                            location: { lat, lng },
                            radius: 0.15,
                            type: cat.type,
                            icon: cat.icon,
                            brandColor: cat.color,
                            description: d.display_name || `${name} (Emergency / Fuel)`,
                            isAmbient: true
                        });
                    });
                }
            } catch (e) {}
        }

        return results;
    }
}

export const ambientPoiService = new AmbientPoiService();
export default ambientPoiService;
