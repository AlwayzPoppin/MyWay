import React, { useEffect, useState } from 'react';
import { Battery, Home, MapPin, Monitor, Zap } from 'lucide-react';
import { Place, FamilyMember } from '../types';
import {
    classifyMovementMode,
    getMovementLabel,
    getMovementVisuals
} from './movementUtils';
import {
    checkTier1MicroZone,
    checkTier2SavedPlace,
    isAtHomePlace,
    shouldExecuteReverseGeocode,
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
 * Format relative elapsed time into human-friendly strings (e.g. 'just now', '5m ago', '21h ago', '2d ago').
 */
export function formatRelativeTime(timestamp?: number | string | Date): string {
    if (!timestamp) return 'recently';
    const timeMs = typeof timestamp === 'number'
        ? timestamp
        : (timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp));
    if (!Number.isFinite(timeMs)) return 'recently';
    const now = Date.now();
    const diffMs = Math.max(0, now - timeMs);
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

/**
 * A web/desktop session is a companion viewer, never a GPS publisher. Keep this
 * separate from movement telemetry so cached phone data cannot look like it came
 * from the desktop currently shown in the circle.
 */
export function getMemberViewerLabel(member: Pick<FamilyMember, 'companionDeviceLabel' | 'activeViewerDeviceLabel' | 'activeViewerDevicePlatform'>): 'Desktop' | 'Browser' | null {
    const label = `${member.companionDeviceLabel || ''} ${member.activeViewerDeviceLabel || ''}`.toLowerCase();
    const isDesktop = /windows|macintosh|mac os|linux|desktop|chromebook/.test(label);

    if (isDesktop) return 'Desktop';
    if (member.activeViewerDevicePlatform === 'web') return 'Browser';
    return null;
}

/**
 * Build rich contextual status string based on member telemetry with strict priority:
 * - Presence at a saved place always wins over movement telemetry.
 * - Tier 1: Micro-Zone (e.g. "Parked in Driveway")
 * - Tier 2: Saved Place Address (e.g. "Parked on Carson Drive")
 * - Tier 3: Movement fallback (outside saved places)
 */
export function formatMemberStatus(
    member: FamilyMember,
    reverseLocation?: string | null,
    places?: Place[],
    options?: { hasDesktopBadge?: boolean }
): string {
    const viewerLabel = getMemberViewerLabel(member) || (options?.hasDesktopBadge ? 'Desktop' : null);
    if (viewerLabel) return viewerLabel;
    const lastFixMs = Date.parse(member.lastUpdated || '');
    const locationAgeMs = Number.isFinite(lastFixMs) ? Math.max(0, Date.now() - lastFixMs) : Infinity;
    const isStale = member.locationStale === true || locationAgeMs > 90_000;
    const isOffline = member.status === 'Offline' || locationAgeMs > 180_000;

    // 0. Offline / Stale: Never report active motion or speed for stale historical fixes
    if (isOffline) {
        const relativeTime = formatRelativeTime(member.lastUpdated);
        return `Offline • Seen ${relativeTime}`;
    }

    if (isStale) {
        const relativeTime = formatRelativeTime(member.lastUpdated);
        return `Last seen ${relativeTime}`;
    }

    const coords = member.location;
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        const knownPlaces = getKnownPlaces(places);
        if (isAtHomePlace(coords, knownPlaces)) return 'At Home';

        const microZone = checkTier1MicroZone(coords, knownPlaces);
        if (microZone?.place?.name) return `At ${microZone.place.name}`;

        const savedPlace = checkTier2SavedPlace(coords, knownPlaces);
        if (savedPlace?.place?.name) return `At ${savedPlace.place.name}`;
    }

    // Synced members can arrive with a confirmed place label before this device
    // has the saved-place record. It still outranks movement telemetry.
    if (member.currentPlace) {
        return /^at\s/i.test(member.currentPlace) ? member.currentPlace : `At ${member.currentPlace}`;
    }

    // Movement telemetry applies only outside known places.
    const mode = classifyMovementMode(member.id, member.speed || 0);
    return getMovementLabel(mode, member.speed || 0);
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
        reverseGeocodeLocation(lat, lng).then(result => {
            if (isMounted && result) {
                setStreet(result);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [lat, lng, enabled]);

    return street;
}

/**
 * Autonomous contextual status text line with physical movement activity tracking.
 * Displays saved-place presence before movement: "At Home", "At Work",
 * "Walking", "Driving • 35 mph", or "Stopped in traffic".
 */
export const MemberStatusText: React.FC<{
    member: FamilyMember;
    places?: Place[];
    className?: string;
    hasDesktopBadge?: boolean;
}> = ({ member, places, className = '', hasDesktopBadge }) => {
    const lastFixMs = Date.parse(member.lastUpdated || '');
    const locationAgeMs = Number.isFinite(lastFixMs) ? Math.max(0, Date.now() - lastFixMs) : Infinity;
    const isStale = member.locationStale === true || locationAgeMs > 90_000;
    const isOffline = member.status === 'Offline' || locationAgeMs > 180_000;

    const mode = classifyMovementMode(member.id, member.speed || 0);
    const visuals = getMovementVisuals(mode, member.speed || 0);
    const statusText = formatMemberStatus(member, undefined, places, { hasDesktopBadge });
    const viewerLabel = getMemberViewerLabel(member) || (hasDesktopBadge ? 'Desktop' : null);
    const isPresenceStatus = /^(At|Arriving|Parked)\b/i.test(statusText);
    const isAtHome = /^At Home\b/i.test(statusText);

    return (
        <span
            className={`inline-flex items-center gap-1.5 truncate ${className || "text-[10px] font-medium text-slate-500 dark:text-slate-400"}`}
            title={statusText}
        >
            {viewerLabel && <Monitor className="h-3.5 w-3.5 shrink-0 text-sky-500" strokeWidth={2.5} aria-hidden="true" />}
            {!viewerLabel && !isOffline && !isStale && isPresenceStatus && (
                isAtHome
                    ? <Home className="h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden="true" />
                    : <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden="true" />
            )}
            {!viewerLabel && !isOffline && !isStale && !isPresenceStatus && (
                <span
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 shadow-xs"
                    style={{ backgroundColor: visuals.badgeBg }}
                    dangerouslySetInnerHTML={{ __html: visuals.iconSvg }}
                />
            )}
            <span className="truncate">{statusText}</span>
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
    const lastFixMs = Date.parse(member.lastUpdated || '');
    const locationAgeMs = Number.isFinite(lastFixMs) ? Math.max(0, Date.now() - lastFixMs) : Infinity;
    const isStale = member.locationStale === true || locationAgeMs > 90_000 || member.status === 'Offline';
    const isOffline = member.status === 'Offline' || isStale || locationAgeMs > 180_000;
    const isCharging = !isOffline && ((member as any).batteryCharging !== undefined ? (member as any).batteryCharging === true : Boolean(member.isCharging));

    const styleClass = isOffline
        ? (isDark ? 'bg-zinc-800 text-zinc-200 border-zinc-700' : 'bg-zinc-100 text-zinc-700 border-zinc-300')
        : isLow
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
