import { Location } from '../types';

export interface SchoolZoneAdvisory {
    distanceMeters: number;
    source: 'OpenStreetMap mapped road rule';
    message: string;
}

type RoadPoint = { lat: number; lon: number };

const cache = new Map<string, { expiresAt: number; advisory: SchoolZoneAdvisory | null }>();
const OVERPASS_ENDPOINTS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter'
];

const metersBetween = (a: Location, b: RoadPoint): number => {
    const earthRadius = 6371000;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLng = (b.lon - a.lng) * Math.PI / 180;
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

/**
 * Finds explicitly mapped school-related conditional speed roads close to the
 * driver. OSM is community-maintained, so this is intentionally an advisory,
 * never a claimed legal speed limit or a substitute for posted signs.
 */
export const findSchoolZoneAdvisory = async (location: Location): Promise<SchoolZoneAdvisory | null> => {
    const cacheKey = `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.advisory;

    const query = `[out:json][timeout:6];way(around:900,${location.lat},${location.lng})["maxspeed:conditional"~"school",i];out geom;`;
    let advisory: SchoolZoneAdvisory | null = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: `data=${encodeURIComponent(query)}`,
                signal: AbortSignal.timeout(4000)
            });
            if (!response.ok) continue;
            const payload = await response.json();
            const distance = (payload.elements || []).flatMap((way: { geometry?: RoadPoint[] }) => way.geometry || [])
                .reduce((closest: number, point: RoadPoint) => Math.min(closest, metersBetween(location, point)), Number.POSITIVE_INFINITY);
            if (Number.isFinite(distance) && distance <= 450) {
                advisory = {
                    distanceMeters: Math.round(distance),
                    source: 'OpenStreetMap mapped road rule',
                    message: 'Mapped school-zone restriction nearby — check posted signs.'
                };
            }
            break;
        } catch {
            // Try the next public mirror. Silence failures so navigation stays uninterrupted.
        }
    }

    cache.set(cacheKey, { advisory, expiresAt: Date.now() + 5 * 60_000 });
    return advisory;
};
