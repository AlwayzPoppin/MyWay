import React, { useEffect, useState } from 'react';
import { Battery, Zap } from 'lucide-react';
import { Place, FamilyMember } from '../types';
import {
    checkTier1MicroZone,
    checkTier2SavedPlace,
    shouldExecuteReverseGeocode,
    formatParkedStatus,
    getKnownPlaces
} from '../services/locationService';

/**
 * In-memory cache for reverse-geocoded coordinates (quantized to ~10m precision)
 */
const REVERSE_CACHE = new Map<string, string>();
const IN_FLIGHT_REQUESTS = new Map<string, Promise<string | null>>();

/**
 * Format raw address/street properties into a user-friendly street or block name.
 * e.g. "500 Block of Main St" or "Carson Drive" or "Downtown".
 */
export function formatStreetOrBlock(props: {
    housenumber?: string;
    street?: string;
    name?: string;
    district?: string;
    locality?: string;
    city?: string;
    road?: string;
    house_number?: string;
    suburb?: string;
}): string | null {
    const street = props.street || props.road || props.name;
    const housenumber = props.housenumber || props.house_number;

    if (street && housenumber) {
        const num = parseInt(housenumber, 10);
        if (!isNaN(num) && num > 0) {
            const block = Math.floor(num / 100) * 100;
            if (block > 0) {
                return `${block} Block of ${street}`;
            }
            return `${housenumber} ${street}`;
        }
        return `${housenumber} ${street}`;
    }

    if (street) {
        return street;
    }

    if (props.name && !/^\d+$/.test(props.name)) {
        return props.name;
    }

    const area = props.district || props.locality || props.suburb || props.city;
    if (area) {
        return `Near ${area}`;
    }

    return null;
}

/**
 * Reverse geocode coordinates using Photon (OSM) with Nominatim fallback.
 * Automatically quantizes coordinates to ~10m grid to cache and eliminate redundant network hits.
 * Bypasses raw network geocoding if inside Tier 1 micro-zones or Tier 2 saved places.
 */
export async function reverseGeocodeLocation(lat?: number, lng?: number, places?: Place[]): Promise<string | null> {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;

    // Fast-path guard: if coordinates are inside a known micro-zone or saved place, bypass network hits
    const allPlaces = getKnownPlaces(places);
    const microZone = checkTier1MicroZone({ lat, lng }, allPlaces);
    if (microZone) {
        return microZone.zoneName;
    }

    const savedPlace = checkTier2SavedPlace({ lat, lng }, allPlaces);
    if (savedPlace) {
        return savedPlace.streetName;
    }

    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (REVERSE_CACHE.has(cacheKey)) {
        return REVERSE_CACHE.get(cacheKey)!;
    }

    if (IN_FLIGHT_REQUESTS.has(cacheKey)) {
        return IN_FLIGHT_REQUESTS.get(cacheKey)!;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return null;
    }

    const promise = (async () => {
        try {
            // 1. Photon Reverse Geocoding (Lightning fast, CORS enabled)
            const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`;
            const res = await fetch(photonUrl, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                const data = await res.json();
                const props = data.features?.[0]?.properties;
                if (props) {
                    const formatted = formatStreetOrBlock(props);
                    if (formatted) {
                        REVERSE_CACHE.set(cacheKey, formatted);
                        return formatted;
                    }
                }
            }
        } catch {
            // Photon network fail or timeout, proceed to fallback
        }

        try {
            // 2. Nominatim Reverse Geocoding Fallback
            const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
            const res = await fetch(nominatimUrl, {
                headers: { 'User-Agent': 'MyWay-GPS/1.0' },
                signal: AbortSignal.timeout(3500)
            });
            if (res.ok) {
                const data = await res.json();
                const address = data.address;
                if (address) {
                    const formatted = formatStreetOrBlock(address);
                    if (formatted) {
                        REVERSE_CACHE.set(cacheKey, formatted);
                        return formatted;
                    }
                }
            }
        } catch {
            // Silently swallow network error
        }

        return null;
    })().finally(() => {
        IN_FLIGHT_REQUESTS.delete(cacheKey);
    });

    IN_FLIGHT_REQUESTS.set(cacheKey, promise);
    return promise;
}

/**
 * Format arrival time from ISO string: e.g. "5:30 PM"
 */
function formatTime(isoString?: string): string | null {
    if (!isoString) return null;
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
        return null;
    }
}

/**
 * Build rich contextual status string based on member telemetry with strict 3-tier priority:
 * - Tier 1: Micro-Zone (e.g. "Parked in Driveway")
 * - Tier 2: Saved Place Address (e.g. "Parked on Carson Drive")
 * - Tier 3: Raw Reverse-Geocoding API Fallback (outside saved places)
 */
export function formatMemberStatus(
    member: FamilyMember,
    reverseLocation?: string | null,
    places?: Place[]
): string {
    const speedMph = Math.round(member.speed || 0);
    const isMoving = member.status === 'Driving' || member.status === 'Moving' || member.status === 'Walking' || speedMph >= 3;

    // 1. Driving / Moving
    if (isMoving) {
        let activity = 'Driving';
        if (member.status === 'Walking') {
            activity = 'Walking';
        } else if (member.status === 'Moving' && speedMph < 15) {
            activity = speedMph <= 4 ? 'Walking' : 'Moving';
        } else if (speedMph < 15 && member.status !== 'Driving') {
            activity = speedMph <= 4 ? 'Walking' : 'Moving';
        }

        return speedMph > 0 ? `${activity} • ${speedMph} MPH` : activity;
    }

    // 2. Stationary / Parked Evaluation (3-Tier Priority)
    if (member.location?.lat != null && member.location?.lng != null) {
        const allPlaces = getKnownPlaces(places);

        // TIER 1: Micro-Zones (Driveway bounding box, parking zone)
        const microZone = checkTier1MicroZone(member.location, allPlaces);
        if (microZone) {
            return microZone.status; // e.g., "Parked in Driveway"
        }

        // TIER 2: Saved Place Address (known street, e.g., "Carson Drive")
        const savedPlace = checkTier2SavedPlace(member.location, allPlaces);
        if (savedPlace) {
            return savedPlace.status; // e.g., "Parked on Carson Drive"
        }
    }

    // 3. Known Saved Place Name with timestamp if already flagged
    if (member.currentPlace) {
        const time = formatTime(member.lastUpdated);
        return time ? `${member.currentPlace} • Since ${time}` : `At ${member.currentPlace}`;
    }

    // 4. TIER 3: Raw Reverse-Geocode Fallback (completely outside saved places and micro-zones)
    const streetOrArea = reverseLocation || member.location?.label;
    if (streetOrArea) {
        return formatParkedStatus(streetOrArea);
    }

    if (member.status === 'Offline') {
        const time = formatTime(member.lastUpdated);
        return time ? `Offline • Seen ${time}` : 'Offline';
    }

    return 'Parked';
}

/**
 * Hook to retrieve reverse-geocoded street context for a coordinate.
 */
export function useReverseGeocode(lat?: number, lng?: number, enabled: boolean = true): string | null {
    const cacheKey = (lat != null && lng != null) ? `${lat.toFixed(4)},${lng.toFixed(4)}` : null;
    const [street, setStreet] = useState<string | null>(() => (cacheKey ? REVERSE_CACHE.get(cacheKey) || null : null));

    useEffect(() => {
        if (!enabled || lat == null || lng == null) return;
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        const cached = REVERSE_CACHE.get(key);
        if (cached) {
            setStreet(cached);
            return;
        }

        let isMounted = true;
        reverseGeocodeLocation(lat, lng).then((resolved) => {
            if (isMounted && resolved) {
                setStreet(resolved);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [lat, lng, enabled]);

    return street;
}

/**
 * Member status text component that resolves status with 3-tier priority:
 * - Bypasses reverse-geocoding if inside Tier 1 (micro-zone) or Tier 2 (saved place)
 * - Only queries raw reverse-geocoder when completely outside saved places
 */
export const MemberStatusText: React.FC<{
    member: FamilyMember;
    places?: Place[];
    className?: string;
}> = ({ member, places, className }) => {
    const isMoving = member.status === 'Driving' || member.status === 'Moving' || member.status === 'Walking' || (member.speed || 0) >= 3;

    // Only resolve raw reverse geocoding if the member is stationary/offline
    // AND completely outside any known saved place or micro-zone (Bypass Geocoder Drift)
    const shouldReverseGeocode = Boolean(
        !isMoving &&
        member.location?.lat != null &&
        member.location?.lng != null &&
        !member.location?.label &&
        shouldExecuteReverseGeocode(member.location, places)
    );

    const reverseStreet = useReverseGeocode(
        member.location?.lat,
        member.location?.lng,
        shouldReverseGeocode
    );

    const statusText = formatMemberStatus(member, reverseStreet, places);

    return (
        <span
            className={className || "text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate"}
            title={statusText}
        >
            {statusText}
        </span>
    );
};

/**
 * Member battery indicator pill that visually reflects low-battery warnings (< 20%)
 * and active charging state with an inline lightning bolt (Zap).
 */
export const MemberBatteryPill: React.FC<{
    member: FamilyMember;
    isDark?: boolean;
    className?: string;
}> = ({ member, isDark = false, className = '' }) => {
    const batteryVal = member.batteryLevel !== undefined ? member.batteryLevel : (member.battery !== undefined ? member.battery : 100);
    const isLow = batteryVal < 20;
    const isCharging = Boolean(member.isCharging);

    const styleClass = isLow
        ? (isDark ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-red-100 text-red-700 border-red-200')
        : (isDark ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-green-100 text-green-700 border-green-200');

    return (
        <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 transition-colors ${styleClass} ${className}`}
            title={`Battery: ${batteryVal}%${isCharging ? ' (Charging)' : ''}`}
        >
            <Battery className="w-3 h-3 shrink-0" />
            <span className="inline-flex items-center gap-0.5 leading-none">
                <span>{batteryVal}%</span>
                {isCharging && (
                    <Zap className="w-2.5 h-2.5 shrink-0 fill-current text-amber-500 dark:text-amber-400 animate-pulse" />
                )}
            </span>
        </span>
    );
};
