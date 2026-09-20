/**
 * Location & Telemetry Service
 * Resolves high-precision contextual location status with a strict 3-tier priority hierarchy:
 *
 * Tier 1 (Micro-Zones): Checks if coordinates intersect custom bounding boxes or polygons
 *        (e.g., dashed driveway zone, parking apron) -> returns "Parked in Driveway" or "Parked in Parking Lot".
 * Tier 2 (Saved Place Address): If inside a general Saved Place radius (like Home),
 *        uses the known street address associated with that place (e.g., "Carson Drive")
 *        instead of querying the raw geocoder -> returns "Parked on Carson Drive".
 * Tier 3 (Raw Geocoder Fallback): Only executes raw reverse-geocoding (which is prone to
 *        backyard/adjacent road drift like Adobe Court) when completely outside all saved places and micro-zones.
 */

import { Place, Location, EntrancePrecision, EntranceBox, EntranceType, FamilyMember } from '../types';
import { getDistanceFromCoords } from '../utils/geo';
import { isPointInEntranceBox, isPointInEntranceZone, isPointInPolygon, isPointInDrivewayZone, DEFAULT_ENTRANCE_BOX } from './geofenceService';
import { extractStreetName } from '../utils/addressUtils';

export { isPointInPolygon, isPointInDrivewayZone };

// In-memory cache of user places & home locations
let inMemoryPlaces: Place[] = [];

/**
 * Format raw street or zone into a user-friendly parked status string:
 * e.g., "Carson Drive" -> "Parked on Carson Drive"
 *       "Driveway" -> "Parked in Driveway"
 *       "Parking Lot" -> "Parked in Parking Lot"
 */
export function formatParkedStatus(streetOrZone: string): string {
    const trimmed = (streetOrZone || '').trim();
    if (!trimmed) return 'Parked';
    if (/^parked\b/i.test(trimmed)) return trimmed;
    if (/^in\b/i.test(trimmed) || /^at\b/i.test(trimmed)) return `Parked ${trimmed}`;
    if (/driveway/i.test(trimmed)) return `Parked in ${trimmed}`;
    if (/parking\s*(lot)?/i.test(trimmed)) {
        return `Parked in ${/lot/i.test(trimmed) ? trimmed : `${trimmed} Lot`}`;
    }
    if (/garage/i.test(trimmed) || /carport/i.test(trimmed)) {
        return `Parked in ${trimmed}`;
    }
    if (/near\s+/i.test(trimmed)) {
        return `Parked • ${trimmed}`;
    }
    return `Parked on ${trimmed}`;
}

/**
 * Loads known places from memory or synchronously reads from localStorage:
 * - myway_user_places
 * - myway_precise_home_location (migration fallback only)
 */
export function getKnownPlaces(explicitPlaces?: Place[]): Place[] {
    const placesMap = new Map<string, Place>();

    // 1. Explicitly passed places take top priority
    if (Array.isArray(explicitPlaces) && explicitPlaces.length > 0) {
        explicitPlaces.forEach(p => {
            if (p && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number') {
                placesMap.set(p.id, p);
            }
        });
    }

    // 2. In-memory registered places
    if (inMemoryPlaces.length > 0) {
        inMemoryPlaces.forEach(p => {
            if (p && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number' && !placesMap.has(p.id)) {
                placesMap.set(p.id, p);
            }
        });
    }

    // 3. Fallback: Synchronous LocalStorage hydration
    if (typeof localStorage !== 'undefined') {
        try {
            const rawPlaces = localStorage.getItem('myway_user_places');
            if (rawPlaces) {
                const parsed = JSON.parse(rawPlaces);
                if (Array.isArray(parsed)) {
                    parsed.forEach((p: Place) => {
                        if (p && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number' && !placesMap.has(p.id)) {
                            placesMap.set(p.id, p);
                        }
                    });
                }
            }
        } catch (e) {}

        try {
            const rawHome = localStorage.getItem('myway_precise_home_location');
            if (rawHome) {
                const home = JSON.parse(rawHome);
                // A saved Home is the source of truth. The profile/local-storage
                // coordinate exists only for older accounts that have not yet
                // created a saved place; rendering both creates two Home radii.
                const hasSavedHome = Array.from(placesMap.values()).some(place =>
                    place.type === 'home' || place.name?.trim().toLowerCase() === 'home'
                );
                if (home && typeof home.lat === 'number' && typeof home.lng === 'number' && !hasSavedHome && !placesMap.has('precise_home')) {
                    placesMap.set('precise_home', {
                        id: 'precise_home',
                        name: 'Home',
                        type: 'home',
                        location: { lat: home.lat, lng: home.lng },
                        radius: 50,
                        address: home.address || '',
                        description: home.address || '',
                        entranceType: 'driveway',
                        entranceLocation: { lat: home.lat, lng: home.lng },
                        icon: 'Home',
                        houseNumber: home.houseNumber
                    });
                }
            }
        } catch (e) {}
    }

    return Array.from(placesMap.values());
}

/**
 * Register places in-memory for zero-latency lookups.
 */
export function setKnownPlaces(places: Place[]): void {
    if (Array.isArray(places)) {
        inMemoryPlaces = places;
    }
}

export interface MicroZoneMatch {
    matched: true;
    zoneName: string;
    status: string;
    place: Place;
}

/**
 * Tier 1: Micro-Zone Evaluation
 * Checks if coordinates intersect any custom polygons, entrance bounding boxes,
 * or driveway zones.
 */
export function checkTier1MicroZone(
    coords: { lat: number; lng: number },
    places?: Place[]
): MicroZoneMatch | null {
    if (coords.lat == null || coords.lng == null || isNaN(coords.lat) || isNaN(coords.lng)) {
        return null;
    }

    const allPlaces = getKnownPlaces(places);

    for (const place of allPlaces) {
        const box: EntranceBox | undefined = place.entrancePrecision?.box || (place as any).entranceBox;
        const anchorLoc: Location = (place.entrancePrecision?.location && typeof place.entrancePrecision.location.lat === 'number')
            ? place.entrancePrecision.location
            : (place.entrancePin && typeof place.entrancePin.lat === 'number')
                ? place.entrancePin
                : (place.entranceLocation && typeof place.entranceLocation.lat === 'number')
                    ? place.entranceLocation
                    : place.location;

        if (!anchorLoc || typeof anchorLoc.lat !== 'number' || typeof anchorLoc.lng !== 'number') {
            continue;
        }

        const entranceType: EntranceType | undefined = place.entranceType;

        // A. Explicit Rotated Entrance Box (with 5m departure tolerance)
        if (box && typeof box.widthMeters === 'number' && typeof box.lengthMeters === 'number') {
            const isInsideBox = isPointInEntranceBox(coords, anchorLoc, box, 5);
            if (isInsideBox) {
                const zoneName = place.entranceNotes
                    ? place.entranceNotes
                    : entranceType === 'driveway'
                        ? 'Driveway'
                        : entranceType === 'parking'
                            ? 'Parking Lot'
                            : entranceType === 'drive_thru'
                                ? 'Drive-Thru'
                                : 'Entrance Zone';
                return {
                    matched: true,
                    zoneName,
                    status: formatParkedStatus(zoneName),
                    place
                };
            }
        }

        // B. Driveway Category Precision Zone (when explicitly configured)
        if (entranceType === 'driveway') {
            const defBox = DEFAULT_ENTRANCE_BOX.driveway;
            // Check default 10m x 22m driveway box
            const isInsideDefaultDriveway = isPointInEntranceBox(coords, anchorLoc, defBox, 5);
            if (isInsideDefaultDriveway) {
                return {
                    matched: true,
                    zoneName: 'Driveway',
                    status: 'Parked in Driveway',
                    place
                };
            }

            // Check circular precision driveway footprint (e.g. 15m radius)
            const isInsidePrecisionDriveway = isPointInEntranceZone(
                coords,
                place.entrancePrecision,
                anchorLoc,
                'driveway',
                5
            );
            if (isInsidePrecisionDriveway) {
                return {
                    matched: true,
                    zoneName: 'Driveway',
                    status: 'Parked in Driveway',
                    place
                };
            }
        }

        // C. Parking Lot Footprint (20m x 20m default or 25m radius)
        if (entranceType === 'parking') {
            const defBox = DEFAULT_ENTRANCE_BOX.parking;
            const isInsideDefaultParking = isPointInEntranceBox(coords, anchorLoc, defBox, 5);
            if (isInsideDefaultParking) {
                return {
                    matched: true,
                    zoneName: 'Parking Lot',
                    status: 'Parked in Parking Lot',
                    place
                };
            }

            const isInsidePrecisionParking = isPointInEntranceZone(
                coords,
                place.entrancePrecision,
                anchorLoc,
                'parking',
                5
            );
            if (isInsidePrecisionParking) {
                return {
                    matched: true,
                    zoneName: 'Parking Lot',
                    status: 'Parked in Parking Lot',
                    place
                };
            }
        }
    }

    return null;
}

export interface SavedPlaceMatch {
    matched: true;
    place: Place;
    streetName: string;
    status: string;
}

/**
 * Tier 2: Saved Place Address Evaluation
 * If coordinates fall within a general Saved Place radius (e.g., Home),
 * extracts the known street address associated with that place (e.g., "Carson Drive")
 * rather than querying the geocoder.
 */
export function checkTier2SavedPlace(
    coords: { lat: number; lng: number },
    places?: Place[]
): SavedPlaceMatch | null {
    if (coords.lat == null || coords.lng == null || isNaN(coords.lat) || isNaN(coords.lng)) {
        return null;
    }

    const allPlaces = getKnownPlaces(places);

    for (const place of allPlaces) {
        if (!place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') {
            continue;
        }

        const distM = getDistanceFromCoords(coords.lat, coords.lng, place.location.lat, place.location.lng);
        const radiusM = place.radius && place.radius > 5
            ? place.radius
            : place.radius
                ? place.radius * 1000
                : 150;

        if (distM <= radiusM) {
            // Extract known street name from place address / description / name
            const rawStreet = extractStreetName(place.address)
                || extractStreetName(place.description)
                || extractStreetName(place.name);

            let streetName = rawStreet;
            if (!streetName && place.address) {
                const firstPart = place.address.split(',')[0].trim();
                streetName = extractStreetName(firstPart) || firstPart;
            }
            if (!streetName && place.description) {
                const firstPart = place.description.split(',')[0].trim();
                streetName = extractStreetName(firstPart) || firstPart;
            }
            if (!streetName) {
                streetName = place.name || 'Saved Place';
            }

            return {
                matched: true,
                place,
                streetName,
                status: formatParkedStatus(streetName)
            };
        }
    }

    return null;
}

/**
 * Bypass Geocoder Drift Guard:
 * Returns true ONLY if coordinates are completely outside all Tier 1 micro-zones
 * and Tier 2 saved places.
 */
export function shouldExecuteReverseGeocode(
    coords: { lat?: number; lng?: number } | null | undefined,
    places?: Place[]
): boolean {
    if (!coords || coords.lat == null || coords.lng == null || isNaN(coords.lat) || isNaN(coords.lng)) {
        return false;
    }

    const pt = { lat: coords.lat, lng: coords.lng };
    const allPlaces = getKnownPlaces(places);

    // If inside micro-zone (Tier 1), BYPASS raw geocoding call
    if (checkTier1MicroZone(pt, allPlaces)) {
        return false;
    }

    // If inside saved place radius (Tier 2), BYPASS raw geocoding call
    if (checkTier2SavedPlace(pt, allPlaces)) {
        return false;
    }

    // Tier 3 fallback allowed
    return true;
}

/**
 * Resolves the member's current movement or place status. A parked status is
 * only carried through when the parking tracker has explicitly confirmed it.
 */
export function resolveLocationStatus(
    coords: { lat?: number; lng?: number } | null | undefined,
    options: {
        status?: string;
        speed?: number;
        places?: Place[];
        reverseStreet?: string | null;
        lastUpdated?: string;
        currentPlace?: string;
        /** Arrival is one accurate fix inside; at is the confirmed second fix. */
        placePhase?: 'arriving' | 'at';
    } = {}
): string {
    const speedMph = Math.round(options.speed || 0);
    let savedPlaceName: string | null = null;

    if (coords && coords.lat != null && coords.lng != null && !isNaN(coords.lat) && !isNaN(coords.lng)) {
        const pt = { lat: coords.lat, lng: coords.lng };
        const allPlaces = getKnownPlaces(options.places);

        if (isAtHomePlace(pt, allPlaces)) {
            savedPlaceName = 'Home';
        } else {
            const microZone = checkTier1MicroZone(pt, allPlaces);
            const savedPlace = checkTier2SavedPlace(pt, allPlaces);
            savedPlaceName = microZone?.place.name || savedPlace?.place.name || savedPlace?.streetName || null;
        }
    }

    // The geofence engine is authoritative for an arrival. Do not turn the
    // first boundary crossing into a completed arrival or let motion overwrite
    // a confirmed saved-place label.
    if (options.placePhase === 'arriving' && savedPlaceName) {
        return `Arriving at ${savedPlaceName}`;
    }
    if (options.placePhase === 'at' && savedPlaceName) {
        return `At ${savedPlaceName}`;
    }

    // Saved-place presence is a stronger, more useful state than a low-speed
    // movement estimate. A member at Home should read "At Home", even if GPS
    // briefly reports walking around the house or driveway.
    if (savedPlaceName) {
        if (/^parked\b/i.test(options.status || '')) {
            return options.status!;
        }
        return `At ${savedPlaceName}`;
    }

    const isMoving = options.status === 'Driving'
        || options.status === 'Moving'
        || options.status === 'Walking'
        || speedMph >= 3;

    // Movement telemetry takes precedence if active
    if (isMoving) {
        let activity = 'Driving';
        if (options.status === 'Walking') {
            activity = 'Walking';
        } else if (speedMph < 15 && options.status !== 'Driving') {
            activity = speedMph <= 4 ? 'Walking' : 'Moving';
        }
        return speedMph > 0 ? `${activity} • ${speedMph} MPH` : activity;
    }

    // Existing place indicator if available
    if (options.currentPlace) {
        return `At ${options.currentPlace}`;
    }

    // TIER 3: Raw Reverse-Geocode Fallback (completely outside saved places)
    const isGenericTelemetryLabel = /^(stationary|moving|walking|driving|offline)$/i.test((options.reverseStreet || '').trim());
    if (options.reverseStreet && !isGenericTelemetryLabel) {
        return `Stationary near ${options.reverseStreet}`;
    }

    if (options.status === 'Offline') {
        return 'Offline';
    }

    return 'Stationary';
}

/**
 * Check if coordinates are within the radius or driveway/micro-zone of a saved "Home" place.
 * Used to enforce Home exclusion for parked vehicle tracking.
 */
export function isAtHomePlace(
    coords: { lat: number; lng: number } | null | undefined,
    places?: Place[]
): boolean {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number' || isNaN(coords.lat) || isNaN(coords.lng)) {
        return false;
    }

    const allPlaces = getKnownPlaces(places);
    const homePlaces = allPlaces.filter(p => {
        if (!p) return false;
        const typeLower = (p.type || '').toLowerCase();
        const catLower = (p.category || '').toLowerCase();
        const nameLower = (p.name || '').trim().toLowerCase();
        const iconLower = (p.icon || '').toLowerCase();
        return (
            typeLower === 'home' ||
            typeLower === 'residential' ||
            catLower === 'home' ||
            catLower === 'residential' ||
            nameLower === 'home' ||
            nameLower === 'my home' ||
            iconLower === '🏠' ||
            iconLower === 'home'
        );
    });

    for (const home of homePlaces) {
        // 0. Check Driveway polygon / zone
        if (isPointInDrivewayZone(coords, [home]).isDriveway) return true;

        // 1. Check Tier 1 micro-zone (driveway, entrance box)
        const micro = checkTier1MicroZone(coords, [home]);
        if (micro) return true;

        // 2. Check circular geofence radius
        const anchor = home.originalLocation || home.location;
        if (anchor && typeof anchor.lat === 'number' && typeof anchor.lng === 'number') {
            const distM = getDistanceFromCoords(coords.lat, coords.lng, anchor.lat, anchor.lng);
            const radiusM = (home.radius && home.radius > 5)
                ? home.radius
                : (home.radius ? home.radius * 1000 : 150);
            if (distM <= radiusM) {
                return true;
            }
        }
    }

    return false;
}
