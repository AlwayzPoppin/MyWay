import { NavigationRoute, RouteStep, Location } from '../types';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

// Audit Fix: Use environment variable with fallback for external service flexibility
// ⚠️ PRODUCTION WARNING: The default URL is a public demo server with strict usage limits.
// For production, set VITE_OSRM_URL to a self-hosted OSRM instance or commercial API (Mapbox, Google Routes).
const OSRM_BASE_URL = (import.meta as any).env?.VITE_OSRM_URL || 'https://routing.openstreetmap.de/routed-car/route/v1/driving';

interface OSRMStep {
    maneuver: {
        type: string;
        modifier?: string;
        location: [number, number]; // [lng, lat]
    };
    name: string;
    distance: number;
    duration: number;
}

interface OSRMRoute {
    distance: number;
    duration: number;
    legs: {
        steps: OSRMStep[];
    }[];
}

interface OSRMResponse {
    code: string;
    routes: OSRMRoute[];
    waypoints: {
        name: string;
        location: [number, number];
    }[];
}

/**
 * Formats distance in meters to human-readable string
 */
function formatDistance(meters: number): string {
    if (meters < 1609) {
        return `${Math.round(meters * 3.28084)} ft`;
    }
    return `${(meters / 1609.34).toFixed(1)} mi`;
}

/**
 * Formats duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
}

/**
 * Converts OSRM maneuver type to human-readable instruction
 */
function formatInstruction(step: OSRMStep): string {
    const { type, modifier } = step.maneuver;
    const streetName = step.name || 'the road';

    const modifierText = modifier ? modifier.replace('-', ' ') : '';

    switch (type) {
        case 'turn':
            return `Turn ${modifierText} onto ${streetName}`;
        case 'new name':
            return `Continue onto ${streetName}`;
        case 'depart':
            return `Head ${modifierText} on ${streetName}`;
        case 'arrive':
            return `Arrive at your destination`;
        case 'merge':
            return `Merge ${modifierText} onto ${streetName}`;
        case 'on ramp':
            return `Take the ramp onto ${streetName}`;
        case 'off ramp':
            return `Take the exit toward ${streetName}`;
        case 'fork':
            return `Keep ${modifierText} at the fork onto ${streetName}`;
        case 'end of road':
            return `Turn ${modifierText} onto ${streetName}`;
        case 'roundabout':
            return `At the roundabout, take the exit onto ${streetName}`;
        case 'rotary':
            return `At the rotary, take the exit onto ${streetName}`;
        case 'continue':
            return `Continue ${modifierText} on ${streetName}`;
        default:
            return `Continue on ${streetName}`;
    }
}

/**
 * Gets a route from OSRM (Open Source Routing Machine)
 * This provides deterministic, real-world routing based on OpenStreetMap data
 */
export async function getRouteFromOSRM(
    start: Location,
    endName: string,
    endLocation: Location
): Promise<NavigationRoute | null> {
    try {
        // Build the OSRM URL: /route/v1/driving/{lng},{lat};{lng},{lat}
        const url = `${OSRM_BASE_URL}/${start.lng},${start.lat};${endLocation.lng},${endLocation.lat}?overview=full&geometries=geojson&steps=true`;

        console.log('[OSRM] Fetching route:', url);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`OSRM request failed: ${response.status}`);
        }

        const data: OSRMResponse = await response.json();

        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            console.error('[OSRM] No route found:', data.code);
            return null;
        }

        const route = data.routes[0];
        const steps: RouteStep[] = [];

        // Convert OSRM steps to our RouteStep format
        for (const leg of route.legs) {
            for (const osrmStep of leg.steps) {
                steps.push({
                    instruction: formatInstruction(osrmStep),
                    distance: formatDistance(osrmStep.distance),
                    endLocation: {
                        lng: osrmStep.maneuver.location[0],
                        lat: osrmStep.maneuver.location[1]
                    }
                });
            }
        }

        const navigationRoute: NavigationRoute = {
            destinationName: endName,
            destinationLoc: endLocation,
            startLoc: start, // Include start location for navigation engine
            steps: steps,
            totalDistance: formatDistance(route.distance),
            totalTime: formatDuration(route.duration)
        };

        console.log('[OSRM] Route calculated:', {
            steps: steps.length,
            distance: navigationRoute.totalDistance,
            time: navigationRoute.totalTime
        });

        return navigationRoute;
    } catch (error) {
        console.error('[OSRM] Routing error:', error);
        return null;
    }
}

/**
 * Geocode a place name to coordinates using secure Cloud Proxy
 */
export async function geocodePlace(query: string): Promise<Location | null> {
    try {
        const geocodeFn = httpsCallable<{ address: string }, { location: Location | null }>(functions, 'geocodeAddress');
        const result = await geocodeFn({ address: query });

        return result.data.location;
    } catch (error) {
        console.error('[Geocode] Proxy Error:', error);
        return null;
    }
}
