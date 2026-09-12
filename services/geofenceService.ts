/**
 * Geofence Service
 * Handles spatial calculations and transition detection for safe zones.
 */

import { getDistanceFromCoords } from '../utils/geo';
import { EntranceType, Location, EntrancePrecision, EntranceBox, Place } from '../types';

export interface Geofence {
    id: string;
    name: string;
    lat: number;
    lng: number;
    radius: number; // in meters
    entranceType?: EntranceType;
    entranceLocation?: Location;
    entrancePrecision?: EntrancePrecision;
    /** Saved place address retained for unambiguous activity and alerts. */
    address?: string;
    description?: string;
}

/** "Home" is only useful when a circle has one home. Pair aliases with their address. */
export const getGeofenceDisplayName = (geofence: Pick<Geofence, 'name' | 'address' | 'description'>): string => {
    const rawAddress = geofence.address || geofence.description || '';
    const streetAddress = rawAddress.split(',')[0]?.trim();
    if (!streetAddress || streetAddress.toLowerCase() === geofence.name.toLowerCase()) return geofence.name;
    return `${geofence.name} • ${streetAddress}`;
};

export type GeofenceStatus = 'INSIDE' | 'OUTSIDE';

export interface GeofenceTransition {
    geofence: Geofence;
    from: GeofenceStatus;
    to: GeofenceStatus;
    timestamp: number;
}

/**
 * Default rectangular footprint dimensions (meters) for entrance categories.
 * Driveway: 10m wide × 22m long (covers vehicle pad & walkway, excluding street).
 * Parking Lot: 20m wide × 20m square (covers gate / entrance apron).
 */
export const DEFAULT_ENTRANCE_BOX: Record<EntranceType, EntranceBox> = {
    driveway: { widthMeters: 10, lengthMeters: 22, rotationDeg: 0 },
    parking: { widthMeters: 20, lengthMeters: 20, rotationDeg: 0 },
    front_door: { widthMeters: 6, lengthMeters: 8, rotationDeg: 0 },
    drive_thru: { widthMeters: 6, lengthMeters: 25, rotationDeg: 0 },
    main_door: { widthMeters: 8, lengthMeters: 10, rotationDeg: 0 },
    curbside: { widthMeters: 10, lengthMeters: 15, rotationDeg: 0 },
    general: { widthMeters: 12, lengthMeters: 18, rotationDeg: 0 }
};

/**
 * Returns context-aware arrival notifications for specific entrance types
 * e.g., "Mike pulled into the driveway" vs "Mike arrived at Starbucks"
 */
export function getEntranceArrivalMessage(
    memberName: string,
    placeName: string,
    entranceType?: EntranceType
): { title: string; body: string; emoji: string } {
    switch (entranceType) {
        case 'driveway':
            return {
                title: `🚗 ${memberName} pulled into the driveway`,
                body: `${memberName} pulled into the driveway at ${placeName}.`,
                emoji: '🚗'
            };
        case 'parking':
            return {
                title: `🅿️ ${memberName} entered the parking lot`,
                body: `${memberName} entered the parking lot at ${placeName}.`,
                emoji: '🅿️'
            };
        case 'drive_thru':
            return {
                title: `🚗 ${memberName} entered the drive-thru`,
                body: `${memberName} entered the drive-thru lane at ${placeName}.`,
                emoji: '🚗'
            };
        case 'front_door':
            return {
                title: `🚪 ${memberName} arrived at the front door`,
                body: `${memberName} reached the front entrance at ${placeName}.`,
                emoji: '🚪'
            };
        case 'curbside':
            return {
                title: `📦 ${memberName} arrived at curbside pickup`,
                body: `${memberName} pulled into curbside pickup at ${placeName}.`,
                emoji: '📦'
            };
        case 'main_door':
            return {
                title: `🚪 ${memberName} reached the main entrance`,
                body: `${memberName} arrived at the main entrance of ${placeName}.`,
                emoji: '🚪'
            };
        default:
            return {
                title: `📍 ${memberName} arrived at ${placeName}`,
                body: `${memberName} has entered the ${placeName} safe zone.`,
                emoji: '📍'
            };
    }
}

/**
 * Re-export shared Haversine for backward compatibility.
 */
export const getDistance = getDistanceFromCoords;

/**
 * Checks if a point is inside a geofence with optional departure hysteresis.
 */
export const isPointInGeofence = (
    point: { lat: number; lng: number },
    geofence: Geofence,
    hysteresisMeters: number = 0
): boolean => {
    const distance = getDistance(point.lat, point.lng, geofence.lat, geofence.lng);
    return distance <= (geofence.radius + hysteresisMeters);
};

/**
 * Detects transitions between states (INSIDE/OUTSIDE).
 * Applies dynamic departure hysteresis: Math.max(15, radius * 0.5)
 * For a 15m driveway geofence → 15m buffer → must drift 30m total before exit evaluation.
 * For a 150m neighborhood zone → 75m buffer → must drift 225m total before exit evaluation.
 * Prevents indoor GPS drift from triggering false departures.
 */
export const detectTransition = (
    currentLocation: { lat: number; lng: number },
    geofence: Geofence,
    previousStatus: GeofenceStatus = 'OUTSIDE'
): GeofenceTransition | null => {
    const departureHysteresis = previousStatus === 'INSIDE'
        ? Math.max(15, Math.round(geofence.radius * 0.5))
        : 0;
    const isNowInside = isPointInGeofence(currentLocation, geofence, departureHysteresis);
    const currentStatus: GeofenceStatus = isNowInside ? 'INSIDE' : 'OUTSIDE';

    if (currentStatus !== previousStatus) {
        return {
            geofence,
            from: previousStatus,
            to: currentStatus,
            timestamp: Date.now()
        };
    }

    return null;
};

/**
 * Computes whether a GPS coordinate is inside an EntranceBox footprint.
 * Uses local tangent plane metric conversion and inverse bearing rotation.
 * Prevents false-positive triggers from cars passing on the street outside the driveway.
 */
export function isPointInEntranceBox(
    point: { lat: number; lng: number },
    center: { lat: number; lng: number },
    box: EntranceBox,
    hysteresisMeters: number = 0
): boolean {
    const latRad = (center.lat * Math.PI) / 180;
    const metersPerLat = 111320;
    const metersPerLng = 111320 * Math.cos(latRad);

    const deltaY = (point.lat - center.lat) * metersPerLat;
    const deltaX = (point.lng - center.lng) * metersPerLng;

    // Standard bearing rotation (0° = North, 90° = East)
    const rotRad = (box.rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    // Transform into box local coordinate system:
    // x: across width, y: along length
    const localX = deltaX * cosR - deltaY * sinR;
    const localY = deltaX * sinR + deltaY * cosR;

    const halfWidth = (box.widthMeters / 2) + hysteresisMeters;
    const halfLength = (box.lengthMeters / 2) + hysteresisMeters;

    return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfLength;
}

/**
 * Checks if a point is inside an entrance zone, prioritizing the rectangular footprint
 * if configured, with fallback to circular radius.
 */
export function isPointInEntranceZone(
    point: { lat: number; lng: number },
    precision?: EntrancePrecision,
    fallbackLocation?: Location,
    entranceType?: EntranceType,
    hysteresisMeters: number = 0,
    fallbackRadiusMeters?: number
): boolean {
    const center = precision?.location || fallbackLocation;
    if (!center) return false;

    if (precision?.box) {
        return isPointInEntranceBox(point, center, precision.box, hysteresisMeters);
    }

    const radius = precision?.radius || fallbackRadiusMeters || (entranceType === 'parking' ? 25 : (entranceType === 'driveway' ? 15 : 50));
    const distance = getDistanceFromCoords(point.lat, point.lng, center.lat, center.lng);
    return distance <= (radius + hysteresisMeters);
}

/**
 * Generates GeoJSON polygon ring coordinates for a rotated entrance box.
 * Returns [ [lng, lat], [lng, lat], [lng, lat], [lng, lat], [lng, lat] ]
 */
export function getRotatedBoxCoords(
    center: Location,
    box: EntranceBox,
    hysteresisMeters: number = 0
): [number, number][] {
    const latRad = (center.lat * Math.PI) / 180;
    const metersPerLat = 111320;
    const metersPerLng = 111320 * Math.cos(latRad);

    const hw = (box.widthMeters / 2) + hysteresisMeters;
    const hl = (box.lengthMeters / 2) + hysteresisMeters;

    const rotRad = (box.rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    // 4 corners in local space (x = width, y = length)
    // 1: Top-Left, 2: Top-Right, 3: Bottom-Right, 4: Bottom-Left, 5: Top-Left
    const localCorners: [number, number][] = [
        [-hw, -hl],
        [hw, -hl],
        [hw, hl],
        [-hw, hl],
        [-hw, -hl]
    ];

    return localCorners.map(([lx, ly]) => {
        const dx = lx * cosR + ly * sinR;
        const dy = -lx * sinR + ly * cosR;

        const lng = center.lng + (dx / metersPerLng);
        const lat = center.lat + (dy / metersPerLat);
        return [parseFloat(lng.toFixed(7)), parseFloat(lat.toFixed(7))];
    });
}

/**
 * Standard ray-casting algorithm to determine if a GPS coordinate is inside a polygon.
 * Supports both Location[] ({ lat, lng }) and GeoJSON [lng, lat][] rings.
 */
export function isPointInPolygon(
    point: { lat: number; lng: number },
    polygon: ({ lat: number; lng: number } | [number, number])[]
): boolean {
    if (!polygon || polygon.length < 3) return false;
    const x = point.lng;
    const y = point.lat;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const p1 = polygon[i];
        const p2 = polygon[j];
        const xi = Array.isArray(p1) ? p1[0] : p1.lng;
        const yi = Array.isArray(p1) ? p1[1] : p1.lat;
        const xj = Array.isArray(p2) ? p2[0] : p2.lng;
        const yj = Array.isArray(p2) ? p2[1] : p2.lat;

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}

/**
 * Checks whether GPS coordinates intersect any saved Driveway polygon or driveway micro-zone.
 */
export function isPointInDrivewayZone(
    coords: { lat: number; lng: number },
    places?: Place[]
): { isDriveway: boolean; place?: Place } {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
        return { isDriveway: false };
    }

    // 1. Check custom driveway polygon stored in localStorage
    if (typeof localStorage !== 'undefined') {
        try {
            const rawPoly = localStorage.getItem('myway_driveway_polygon') || localStorage.getItem('myway_home_driveway_polygon');
            if (rawPoly) {
                const parsed = JSON.parse(rawPoly);
                if (Array.isArray(parsed) && parsed.length >= 3) {
                    if (isPointInPolygon(coords, parsed)) {
                        return { isDriveway: true };
                    }
                }
            }
        } catch (e) {}
    }

    if (!places || places.length === 0) return { isDriveway: false };

    for (const place of places) {
        const typeLower = (place.type || '').toLowerCase();
        const catLower = (place.category || '').toLowerCase();
        const nameLower = (place.name || '').toLowerCase();
        const isHome = typeLower === 'home' || typeLower === 'residential' || catLower === 'home' || nameLower.includes('home');
        const entranceType = place.entranceType;

        // A. Check explicit drivewayPolygon or polygon on place / entrancePrecision
        const customPoly = (place as any).drivewayPolygon || place.polygon || place.entrancePrecision?.drivewayPolygon || place.entrancePrecision?.polygon;
        if (Array.isArray(customPoly) && customPoly.length >= 3) {
            if (isPointInPolygon(coords, customPoly)) {
                return { isDriveway: true, place };
            }
        }

        // B. Check Home or Driveway rotated bounding box polygon
        if (isHome || entranceType === 'driveway') {
            const anchorLoc: Location = (place.entrancePrecision?.location && typeof place.entrancePrecision.location.lat === 'number')
                ? place.entrancePrecision.location
                : (place.entrancePin && typeof place.entrancePin.lat === 'number')
                    ? place.entrancePin
                    : (place.entranceLocation && typeof place.entranceLocation.lat === 'number')
                        ? place.entranceLocation
                        : place.location;

            if (anchorLoc && typeof anchorLoc.lat === 'number' && typeof anchorLoc.lng === 'number') {
                const box = place.entrancePrecision?.box || (place as any).entranceBox || (entranceType === 'driveway' ? DEFAULT_ENTRANCE_BOX.driveway : undefined);
                if (box) {
                    const polyCoords = getRotatedBoxCoords(anchorLoc, box, 5);
                    if (isPointInPolygon(coords, polyCoords) || isPointInEntranceBox(coords, anchorLoc, box, 5)) {
                        return { isDriveway: true, place };
                    }
                }

                // C. Precision driveway circular zone (e.g. 15m radius)
                if (entranceType === 'driveway') {
                    const isInside = isPointInEntranceZone(coords, place.entrancePrecision, anchorLoc, 'driveway', 5);
                    if (isInside) {
                        return { isDriveway: true, place };
                    }
                }
            }
        }
    }

    return { isDriveway: false };
}
