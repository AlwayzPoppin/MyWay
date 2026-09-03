/**
 * High-performance, zero-dependency 32-character base32 Geohash implementation
 * Based on Gustavo Niemeyer's canonical algorithm.
 * Precision guide:
 * 5 chars: ~4.9km x 4.9km
 * 6 chars: ~1.2km x 0.6km
 * 7 chars: ~152m x 152m (ideal for street / entrance / parcel precision)
 * 8 chars: ~38m x 19m
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BITS = [16, 8, 4, 2, 1];

export interface BoundingBox {
    north: number;
    south: number;
    east: number;
    west: number;
}

/**
 * Encodes latitude and longitude into a geohash string
 */
export function encodeGeohash(latitude: number, longitude: number, precision: number = 7): string {
    let latInterval = [-90.0, 90.0];
    let lonInterval = [-180.0, 180.0];
    let isEven = true;
    let bit = 0;
    let ch = 0;
    let geohash = '';

    while (geohash.length < precision) {
        let mid: number;
        if (isEven) {
            mid = (lonInterval[0] + lonInterval[1]) / 2;
            if (longitude >= mid) {
                ch |= BITS[bit];
                lonInterval[0] = mid;
            } else {
                lonInterval[1] = mid;
            }
        } else {
            mid = (latInterval[0] + latInterval[1]) / 2;
            if (latitude >= mid) {
                ch |= BITS[bit];
                latInterval[0] = mid;
            } else {
                latInterval[1] = mid;
            }
        }

        isEven = !isEven;
        if (bit < 4) {
            bit++;
        } else {
            geohash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }

    return geohash;
}

/**
 * Decodes a geohash string into latitude and longitude with error margins
 */
export function decodeGeohash(geohash: string): { lat: number; lng: number; error: { lat: number; lng: number } } {
    let isEven = true;
    let latInterval = [-90.0, 90.0];
    let lonInterval = [-180.0, 180.0];

    for (let i = 0; i < geohash.length; i++) {
        const c = geohash[i];
        const cd = BASE32.indexOf(c);
        if (cd === -1) continue;

        for (let j = 0; j < 5; j++) {
            const mask = BITS[j];
            if (isEven) {
                const mid = (lonInterval[0] + lonInterval[1]) / 2;
                if ((cd & mask) !== 0) {
                    lonInterval[0] = mid;
                } else {
                    lonInterval[1] = mid;
                }
            } else {
                const mid = (latInterval[0] + latInterval[1]) / 2;
                if ((cd & mask) !== 0) {
                    latInterval[0] = mid;
                } else {
                    latInterval[1] = mid;
                }
            }
            isEven = !isEven;
        }
    }

    const lat = (latInterval[0] + latInterval[1]) / 2;
    const lng = (lonInterval[0] + lonInterval[1]) / 2;
    const latError = latInterval[1] - lat;
    const lngError = lonInterval[1] - lng;

    return { lat, lng, error: { lat: latError, lng: lngError } };
}

/**
 * Checks if a coordinate is inside a given bounding box
 */
export function isCoordinateInBounds(coord: { lat: number; lng: number }, bounds: BoundingBox): boolean {
    if (!coord || typeof coord.lat !== 'number' || typeof coord.lng !== 'number') return false;
    const latOk = coord.lat >= bounds.south && coord.lat <= bounds.north;
    let lngOk = false;
    if (bounds.west <= bounds.east) {
        lngOk = coord.lng >= bounds.west && coord.lng <= bounds.east;
    } else {
        // Antimeridian wrap
        lngOk = coord.lng >= bounds.west || coord.lng <= bounds.east;
    }
    return latOk && lngOk;
}

/**
 * Calculates geohash query prefixes covering a bounding box
 */
export function getGeohashPrefixesForBounds(bounds: BoundingBox, precision: number = 5): string[] {
    const prefixes = new Set<string>();
    const latStep = (bounds.north - bounds.south) / 4 || 0.05;
    const lngStep = (bounds.east - bounds.west) / 4 || 0.05;

    for (let lat = bounds.south; lat <= bounds.north; lat += latStep) {
        for (let lng = bounds.west; lng <= bounds.east; lng += lngStep) {
            prefixes.add(encodeGeohash(lat, lng, precision));
        }
    }
    return Array.from(prefixes);
}
