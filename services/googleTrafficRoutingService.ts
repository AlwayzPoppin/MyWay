import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { CongestionLevel, Location, NavigationRoute, RouteStep, TrafficSegment } from '../types';

interface GoogleSpeedInterval {
    startPolylinePointIndex?: number;
    endPolylinePointIndex?: number;
    speed?: 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM' | string;
}

interface GoogleRoute {
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    travelAdvisory?: { speedReadingIntervals?: GoogleSpeedInterval[] };
    legs?: Array<{ steps?: Array<{
        distanceMeters?: number;
        staticDuration?: string;
        navigationInstruction?: { instructions?: string };
        polyline?: { encodedPolyline?: string };
    }> }>;
}

const LIVE_TRAFFIC_ENABLED = (import.meta as any).env?.VITE_ENABLE_LIVE_TRAFFIC === 'true';

const secondsFromDuration = (value?: string): number => {
    const seconds = Number.parseFloat((value || '').replace('s', ''));
    return Number.isFinite(seconds) ? seconds : 0;
};

const formatDuration = (seconds: number): string => {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    return totalMinutes >= 60
        ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
        : `${totalMinutes} min`;
};

const formatDistance = (meters: number): string =>
    meters < 1609.344 ? `${Math.round(meters * 3.28084)} ft` : `${(meters / 1609.344).toFixed(1)} mi`;

const roadNamesFromSteps = (steps: RouteStep[]): string[] => {
    const seen = new Set<string>();

    return steps.reduce<string[]>((roads, step) => {
        const match = step.instruction?.match(/(?:onto|on|toward)\s+(.+?)(?:\s+(?:then|and)\s+|$)/i);
        const road = match?.[1]?.replace(/[.,;]+$/, '').trim();
        const normalized = road?.toLowerCase();

        if (
            road && normalized &&
            !normalized.includes('destination') &&
            !normalized.includes('the route') &&
            !seen.has(normalized)
        ) {
            seen.add(normalized);
            roads.push(road);
        }
        return roads;
    }, []).slice(0, 3);
};

/** Decodes a Google encoded polyline into MapLibre coordinates [lng, lat]. */
export const decodeGooglePolyline = (encoded: string): [number, number][] => {
    let index = 0;
    let lat = 0;
    let lng = 0;
    const points: [number, number][] = [];

    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index < encoded.length);
        lat += result & 1 ? ~(result >> 1) : result >> 1;

        result = 0;
        shift = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index < encoded.length);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        points.push([lng / 1e5, lat / 1e5]);
    }

    return points;
};

const congestionForGoogleSpeed = (speed?: string): CongestionLevel => {
    if (speed === 'TRAFFIC_JAM') return 'severe';
    if (speed === 'SLOW') return 'heavy';
    return 'low';
};

const trafficSegmentsFromGoogle = (geometry: [number, number][], intervals: GoogleSpeedInterval[] = []): TrafficSegment[] => {
    if (geometry.length < 2) return [];
    if (!intervals.length) return [{ coordinates: geometry, congestion: 'low', lengthMeters: 0 }];

    return intervals.map(interval => {
        const start = Math.max(0, interval.startPolylinePointIndex || 0);
        const end = Math.min(geometry.length - 1, interval.endPolylinePointIndex ?? geometry.length - 1);
        const coordinates = geometry.slice(start, Math.max(start + 2, end + 1));
        return {
            coordinates: coordinates.length >= 2 ? coordinates : geometry.slice(Math.max(0, start - 1), start + 1),
            congestion: congestionForGoogleSpeed(interval.speed),
            lengthMeters: 0
        };
    }).filter(segment => segment.coordinates.length >= 2);
};

const routeFromGoogle = (route: GoogleRoute, destinationName: string, destinationLoc: Location, start: Location, index: number): NavigationRoute | null => {
    const encoded = route.polyline?.encodedPolyline;
    if (!encoded || !route.distanceMeters) return null;

    const geometry = decodeGooglePolyline(encoded);
    if (geometry.length < 2) return null;
    const trafficDuration = secondsFromDuration(route.duration);
    const staticDuration = secondsFromDuration(route.staticDuration);
    const steps: RouteStep[] = (route.legs || []).flatMap(leg => (leg.steps || []).map(step => ({
        instruction: step.navigationInstruction?.instructions || 'Continue on the route',
        distance: formatDistance(step.distanceMeters || 0),
        endLocation: (() => {
            const stepGeometry = step.polyline?.encodedPolyline ? decodeGooglePolyline(step.polyline.encodedPolyline) : [];
            const end = stepGeometry[stepGeometry.length - 1];
            return end ? { lng: end[0], lat: end[1] } : undefined;
        })()
    })));
    const roadNames = roadNamesFromSteps(steps);

    return {
        id: `google_traffic_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        destinationName,
        destinationLoc,
        startLoc: start,
        steps,
        totalDistance: formatDistance(route.distanceMeters),
        totalTime: formatDuration(trafficDuration),
        durationMinutes: Math.max(1, Math.round(trafficDuration / 60)),
        totalDurationSec: trafficDuration,
        staticDurationSec: staticDuration || undefined,
        distanceMeters: route.distanceMeters,
        routeGeometry: geometry,
        trafficSegments: trafficSegmentsFromGoogle(geometry, route.travelAdvisory?.speedReadingIntervals),
        congestionLevel: route.travelAdvisory?.speedReadingIntervals?.some(i => i.speed === 'TRAFFIC_JAM')
            ? 'severe'
            : route.travelAdvisory?.speedReadingIntervals?.some(i => i.speed === 'SLOW') ? 'heavy' : 'low',
        summary: roadNames.length ? `via ${roadNames.join(' / ')}` : 'Live traffic route'
    };
};

/**
 * Gets traffic-aware alternatives from the secure Cloud Function. A disabled
 * feature flag or provider failure returns null so the OSRM route remains safe.
 */
export async function fetchGoogleTrafficRouteOptions(start: Location, destinationName: string, destinationLoc: Location): Promise<NavigationRoute[] | null> {
    if (!LIVE_TRAFFIC_ENABLED || typeof navigator !== 'undefined' && !navigator.onLine) return null;

    try {
        const computeTrafficRoutes = httpsCallable<{ origin: Location; destination: Location; alternatives: boolean }, { routes?: GoogleRoute[] }>(functions, 'computeTrafficRoutes');
        const response = await computeTrafficRoutes({ origin: start, destination: destinationLoc, alternatives: true });
        const routes = (response.data.routes || [])
            .map((route, index) => routeFromGoogle(route, destinationName, destinationLoc, start, index))
            .filter((route): route is NavigationRoute => route !== null);
        return routes.length ? routes : null;
    } catch (error) {
        console.info('[LiveTraffic] Google traffic routing unavailable; using OSRM fallback.', error);
        return null;
    }
}
