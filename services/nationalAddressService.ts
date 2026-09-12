import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/**
 * A point from the U.S. DOT National Address Database.  These are address
 * points, not interpolated road ranges, so the placement field stays attached
 * to every label we put on the map.
 */
export interface NationalAddressPoint {
    id: string;
    number: string;
    street?: string;
    placement?: string;
    latitude: number;
    longitude: number;
}

export interface NationalAddressBounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

const MINIMUM_LABEL_ZOOM = 15;
const CACHE_TTL_MS = 3 * 60 * 1000;
const RETRY_AFTER_UNAVAILABLE_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; points: NationalAddressPoint[] }>();
let providerUnavailableUntil = 0;
let providerFailureReported = false;

const toCacheKey = (bounds: NationalAddressBounds, zoom: number) => {
    // Group nearby pans together. A 0.01-degree cell is small enough for
    // house-number labels while avoiding a network request for every nudge.
    const precision = 100;
    return [
        Math.floor(bounds.west * precision),
        Math.floor(bounds.south * precision),
        Math.ceil(bounds.east * precision),
        Math.ceil(bounds.north * precision),
        Math.floor(zoom)
    ].join(':');
};

/**
 * Fetches a small, high-zoom viewport from our authenticated callable proxy.
 * The browser never queries the national provider directly, which lets My Way
 * control request size, caching, outages, and future vector-tile migration.
 */
export const getNationalAddressPoints = async (
    bounds: NationalAddressBounds,
    zoom: number
): Promise<NationalAddressPoint[]> => {
    if (zoom < MINIMUM_LABEL_ZOOM) return [];

    const key = toCacheKey(bounds, zoom);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.points;
    if (Date.now() < providerUnavailableUntil) return cached?.points || [];

    const query = httpsCallable<
        NationalAddressBounds & { zoom: number },
        { points: NationalAddressPoint[] }
    >(functions, 'getNationalAddressPoints');

    try {
        const result = await query({ ...bounds, zoom });
        const points = Array.isArray(result.data?.points)
            ? result.data.points.filter(point =>
                point &&
                typeof point.id === 'string' &&
                typeof point.number === 'string' &&
                Number.isFinite(point.latitude) &&
                Number.isFinite(point.longitude)
            )
            : [];

        cache.set(key, { points, expiresAt: Date.now() + CACHE_TTL_MS });
        if (cache.size > 72) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
        }
        return points;
    } catch (error) {
        // Address labels are an enhancement. The base map and verified My Way
        // place labels remain usable when the provider or function is offline.
        // A cooldown prevents each MapLibre move event from generating a CORS
        // error storm while a deployment or connection is unavailable.
        providerUnavailableUntil = Date.now() + RETRY_AFTER_UNAVAILABLE_MS;
        if (!providerFailureReported) {
            providerFailureReported = true;
            console.info('[NationalAddress] Address labels are temporarily unavailable; retrying in five minutes.', error);
        }
        return cached?.points || [];
    }
};

export const nationalAddressPointsToGeoJSON = (points: NationalAddressPoint[]): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: points.map(point => ({
        type: 'Feature' as const,
        id: point.id,
        properties: {
            houseNumber: point.number,
            street: point.street || '',
            placement: point.placement || 'Unknown',
            source: 'national-address-database'
        },
        geometry: {
            type: 'Point' as const,
            coordinates: [point.longitude, point.latitude]
        }
    }))
});
