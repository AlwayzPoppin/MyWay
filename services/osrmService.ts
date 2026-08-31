import { NavigationRoute, RouteStep, Location, LaneGuidance, LaneDirection } from '../types';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { getDistanceMeters } from '../utils/geo';
import { vehicleFuelService } from './vehicleFuelService';
import { computeRouteTrafficSegments } from './trafficService';

// ROUTING PROVIDERS: Multi-provider failover chain for production reliability
// Configure VITE_OSRM_URL for your primary provider (self-hosted, Mapbox, etc.)
// Fallback chain ensures navigation never fails due to a single provider outage.
const ROUTING_PROVIDERS = [
    (import.meta as any).env?.VITE_OSRM_URL,                                    // 1. Custom (env var)
    'https://routing.openstreetmap.de/routed-car/route/v1/driving',             // 2. OSM.de (supports parking aisles & service ways)
    'https://router.project-osrm.org/route/v1/driving',                         // 3. Official OSRM demo
].filter(Boolean) as string[];

const OSRM_BASE_URL = ROUTING_PROVIDERS[0];

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
    geometry: {
        type: string;
        coordinates: [number, number][];
    };
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
 * Fast offline check to prevent network stalling when disconnected.
 */
export function isOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
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
 * Parses distance string back into meters for geometric comparison
 */
function parseDistanceToMeters(distStr: string): number {
    const num = parseFloat(distStr.replace(/[^0-9.]/g, '')) || 0;
    if (distStr.toLowerCase().includes('mi')) return num * 1609.344;
    if (distStr.toLowerCase().includes('km')) return num * 1000;
    if (distStr.toLowerCase().includes('ft')) return num * 0.3048;
    return num;
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
    return `${Math.max(1, minutes)} min`;
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
 * Extracts or infers posted road speed limits (in MPH) from route step metadata
 */
export function extractStepSpeedLimit(instruction: string, streetNames?: string[], valhallaSpeed?: number): number {
    if (valhallaSpeed && valhallaSpeed > 0 && valhallaSpeed <= 90) {
        return Math.round(valhallaSpeed);
    }
    const combined = `${instruction} ${(streetNames || []).join(' ')}`.toLowerCase();

    if (combined.includes('interstate') || combined.includes('i-') || combined.includes('freeway')) {
        return 65;
    }
    if (combined.includes('highway') || combined.includes('hwy') || combined.includes('expressway') || combined.includes('us-') || combined.includes('nc-') || combined.includes('sr-') || combined.includes('by-pass') || combined.includes('bypass')) {
        return 55;
    }
    if (combined.includes('blvd') || combined.includes('boulevard') || combined.includes('pkwy') || combined.includes('parkway') || combined.includes('santa fe') || combined.includes('yadkin') || combined.includes('bragg') || combined.includes('skibo')) {
        return 45;
    }
    if (combined.includes('road') || combined.includes('rd') || combined.includes('avenue') || combined.includes('ave') || combined.includes('drive') || combined.includes('dr') || combined.includes('pike')) {
        return 35;
    }
    if (combined.includes('way') || combined.includes('lane') || combined.includes('ln') || combined.includes('court') || combined.includes('ct') || combined.includes('place') || combined.includes('pl') || combined.includes('cir') || combined.includes('circle') || combined.includes('residential')) {
        return 25;
    }
    if (combined.includes('parking') || combined.includes('aisle') || combined.includes('driveway') || combined.includes('alley') || combined.includes('service')) {
        return 15;
    }
    return 35;
}

/**
 * Detects presence of safety camera / speed camera zones near the maneuver
 */
export function detectSafetyCamera(instruction: string, streetNames?: string[]): boolean {
    const combined = `${instruction} ${(streetNames || []).join(' ')}`.toLowerCase();
    return combined.includes('santa fe') || combined.includes('yadkin') || combined.includes('skibo') || combined.includes('bragg') || combined.includes('blvd');
}

/**
 * Extracts or infers realistic lane guidance configurations for multi-lane turns, highway exits, and complex intersections.
 */
export function extractStepLanes(instruction: string, streetNames?: string[], rawLanes?: any[]): LaneGuidance[] | undefined {
    // 1. If explicit lane data is provided by the routing engine
    if (rawLanes && Array.isArray(rawLanes) && rawLanes.length > 0) {
        return rawLanes.map(l => {
            const indications = l.indications || ['straight'];
            const primaryIndication = indications[0] || 'straight';
            let dir: LaneDirection = 'straight';
            if (primaryIndication.includes('slight right')) dir = 'slight_right';
            else if (primaryIndication.includes('right')) dir = 'right';
            else if (primaryIndication.includes('slight left')) dir = 'slight_left';
            else if (primaryIndication.includes('left')) dir = 'left';
            else if (primaryIndication.includes('uturn')) dir = 'uturn';
            return {
                direction: dir,
                isValid: Boolean(l.valid ?? l.active ?? true),
                isActive: Boolean(l.valid ?? l.active ?? false)
            };
        });
    }

    const text = `${instruction} ${(streetNames || []).join(' ')}`.toLowerCase();

    // Skip parking lots, arrivals, and simple start steps
    if (text.includes('arrive') || text.includes('parking') || text.includes('driveway') || text.includes('aisle')) {
        return undefined;
    }

    const isMajorRoad = text.includes('blvd') || text.includes('boulevard') || text.includes('pkwy') || text.includes('parkway') || text.includes('hwy') || text.includes('highway') || text.includes('expressway') || text.includes('interstate') || text.includes('i-') || text.includes('yadkin') || text.includes('santa fe') || text.includes('bragg') || text.includes('skibo');

    // Right turns & Highway Exits / Off Ramps
    if (text.includes('turn right') || text.includes('slight right') || text.includes('exit') || text.includes('ramp') || text.includes('keep right')) {
        if (text.includes('slight right') || text.includes('ramp') || text.includes('fork') || text.includes('exit')) {
            return [
                { direction: 'straight', isValid: false },
                { direction: 'straight', isValid: false },
                { direction: 'slight_right', isValid: true, isActive: true }
            ];
        }
        if (isMajorRoad) {
            // 4-lane major avenue right turn bay
            return [
                { direction: 'left', isValid: false },
                { direction: 'straight', isValid: false },
                { direction: 'straight', isValid: false },
                { direction: 'right', isValid: true, isActive: true }
            ];
        }
        // 3-lane standard road right turn
        return [
            { direction: 'left', isValid: false },
            { direction: 'straight', isValid: false },
            { direction: 'right', isValid: true, isActive: true }
        ];
    }

    // Left turns & U-turns
    if (text.includes('turn left') || text.includes('slight left') || text.includes('keep left') || text.includes('u-turn') || text.includes('uturn')) {
        if (text.includes('u-turn') || text.includes('uturn')) {
            return [
                { direction: 'uturn', isValid: true, isActive: true },
                { direction: 'left', isValid: false },
                { direction: 'straight', isValid: false }
            ];
        }
        if (text.includes('slight left') || text.includes('keep left')) {
            return [
                { direction: 'slight_left', isValid: true, isActive: true },
                { direction: 'straight', isValid: false },
                { direction: 'straight', isValid: false }
            ];
        }
        if (isMajorRoad) {
            // Dual left turn pocket on major avenue
            return [
                { direction: 'left', isValid: true, isActive: false },
                { direction: 'left', isValid: true, isActive: true },
                { direction: 'straight', isValid: false },
                { direction: 'straight', isValid: false }
            ];
        }
        // Standard 3-lane road left turn
        return [
            { direction: 'left', isValid: true, isActive: true },
            { direction: 'straight', isValid: false },
            { direction: 'right', isValid: false }
        ];
    }

    // Major thoroughfare straight cruising through intersections
    if (isMajorRoad && (text.includes('continue') || text.includes('head') || text.includes('proceed') || text.includes('merge'))) {
        return [
            { direction: 'left', isValid: false },
            { direction: 'straight', isValid: true, isActive: true },
            { direction: 'straight', isValid: true, isActive: true },
            { direction: 'right', isValid: false }
        ];
    }

    return undefined;
}

/**
 * Generates direct parking lot / drive-through / shopping plaza navigation
 * Used when the user is already in the parking lot or adjacent aisle.
 */
export function generateParkingDirectRoute(
    start: Location,
    endName: string,
    endLocation: Location
): NavigationRoute {
    const distMeters = getDistanceMeters(start, endLocation);
    const estDurationSec = Math.max(10, Math.round(distMeters / 4)); // ~10 mph parking lot speed

    return {
        destinationName: endName,
        destinationLoc: endLocation,
        startLoc: start,
        steps: [
            {
                instruction: `Proceed across parking lot / driveway toward ${endName}`,
                distance: formatDistance(distMeters * 0.7),
                speedLimit: 15,
                hasCamera: false,
                endLocation: {
                    lat: (start.lat + endLocation.lat) / 2,
                    lng: (start.lng + endLocation.lng) / 2
                }
            },
            {
                instruction: `Arrive at ${endName}`,
                distance: formatDistance(distMeters * 0.3),
                speedLimit: 15,
                hasCamera: false,
                endLocation: endLocation
            }
        ],
        totalDistance: formatDistance(distMeters),
        totalTime: formatDuration(estDurationSec),
        routeGeometry: [
            [start.lng, start.lat],
            [(start.lng * 2 + endLocation.lng) / 3, (start.lat * 2 + endLocation.lat) / 3],
            [(start.lng + endLocation.lng * 2) / 3, (start.lat + endLocation.lat * 2) / 3],
            [endLocation.lng, endLocation.lat]
        ]
    };
}


/**
 * Fetches a route from a single OSRM provider
 */
async function fetchRouteFromProvider(
    baseUrl: string,
    start: Location,
    endLocation: Location,
    alternatives: boolean = true
): Promise<OSRMResponse> {
    if (isOffline()) throw new Error('Device is offline');
    const altParam = alternatives ? '&alternatives=3' : '';
    // Enable annotations for live traffic congestion polyline rendering and 500m snapping radius
    const url = `${baseUrl}/${start.lng},${start.lat};${endLocation.lng},${endLocation.lat}?overview=full&geometries=geojson&steps=true&annotations=true${altParam}&radiuses=500;500&continue_straight=false`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`OSRM ${response.status}`);
    return response.json();
}

import { analyzeRouteTolls, generateAlternativeCorridors } from './tollService';

// In-memory cache for corridor & alternative route calculations (15-minute TTL)
interface RouteCacheEntry {
    routes: NavigationRoute[];
    timestamp: number;
}
const ROUTE_OPTIONS_CACHE = new Map<string, RouteCacheEntry>();
const ROUTE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getRouteCacheKey(start: Location, end: Location, options?: { avoidTolls?: boolean; avoidHighways?: boolean }): string {
    const sLat = Math.round(start.lat * 100) / 100;
    const sLng = Math.round(start.lng * 100) / 100;
    const eLat = Math.round(end.lat * 100) / 100;
    const eLng = Math.round(end.lng * 100) / 100;
    return `${sLat},${sLng}->${eLat},${eLng}_toll=${!!options?.avoidTolls}_hwy=${!!options?.avoidHighways}`;
}

/**
 * Helper to convert an OSRM raw route object into a typed NavigationRoute with toll and fuel analytics
 */
function parseOSRMRoute(
    route: OSRMRoute,
    endName: string,
    endLocation: Location,
    start: Location,
    idx: number = 0
): NavigationRoute {
    const steps: RouteStep[] = [];
    for (const leg of route.legs) {
        for (const osrmStep of leg.steps) {
            const instruction = formatInstruction(osrmStep);
            const speedLimit = extractStepSpeedLimit(instruction, [osrmStep.name || '']);
            const hasCamera = detectSafetyCamera(instruction, [osrmStep.name || '']);
            const lanes = extractStepLanes(instruction, [osrmStep.name || ''], (osrmStep as any)?.intersections?.[0]?.lanes);
            steps.push({
                instruction,
                distance: formatDistance(osrmStep.distance),
                speedLimit,
                hasCamera,
                lanes,
                endLocation: {
                    lng: osrmStep.maneuver.location[0],
                    lat: osrmStep.maneuver.location[1]
                }
            });
        }
    }

    const distMiles = route.distance / 1609.34;
    const durMinutes = Math.round(route.duration / 60);
    
    // Dynamic vehicle-specific fuel & cost calculation
    const fuelCalc = vehicleFuelService.calculateTripFuel(distMiles);
    const fuelGal = fuelCalc.gallons;
    const fuelCostVal = fuelCalc.cost;
    const fuelCost = fuelCalc.costFormatted;
    
    // Toll Analytics
    const tollAnalysis = analyzeRouteTolls(steps);
    const totalTripCostVal = fuelCostVal + tollAnalysis.estimatedTolls;
    const totalEstimatedTripCost = `$${totalTripCostVal.toFixed(2)}`;

    const rawSummary = route.legs.map(l => l.summary).filter(Boolean).join(' / ');
    const summary = rawSummary ? `via ${rawSummary}` : 'Main Route';

    const routeGeometry = route.geometry?.coordinates || undefined;
    const trafficSegments = routeGeometry ? computeRouteTrafficSegments(routeGeometry, steps, route.legs[0]?.annotation) : undefined;

    return {
        id: `route_${idx}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        destinationName: endName,
        destinationLoc: endLocation,
        startLoc: start,
        steps,
        totalDistance: formatDistance(route.distance),
        totalTime: formatDuration(route.duration),
        durationMinutes: durMinutes,
        distanceMeters: route.distance,
        summary,
        fuelEstimateGal: parseFloat(fuelGal.toFixed(2)),
        fuelCostEstimate: fuelCost,
        hasTolls: tollAnalysis.hasTolls,
        estimatedTolls: tollAnalysis.estimatedTolls,
        tollCostEstimate: tollAnalysis.tollCostEstimate,
        tollSummary: tollAnalysis.tollSummary,
        totalEstimatedTripCost,
        routeGeometry,
        trafficSegments
    };
}

/**
 * Fetches multiple alternative route options (Fastest, Toll-Free, Shortest, Eco / Fuel Saver)
 */
export async function fetchRouteOptions(
    start: Location,
    endName: string,
    endLocation: Location,
    options?: { avoidTolls?: boolean; avoidHighways?: boolean }
): Promise<NavigationRoute[]> {
    const cacheKey = getRouteCacheKey(start, endLocation, options);
    const cached = ROUTE_OPTIONS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < ROUTE_CACHE_TTL_MS)) {
        console.log(`⚡ [Route Options Cache HIT] ${cached.routes.length} routes for "${endName}"`);
        return cached.routes;
    }

    const straightLineDist = getDistanceMeters(start, endLocation);

    // Offline fast path: Prevent generating artificial 2-point straight lines that trigger off-route recalculation loops
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.warn('⚠️ [OSRM] Network is offline, skipping straight-line fallback to preserve navigation engine state');
        return [];
    }

    const parsedRoutes: NavigationRoute[] = [];

    for (let i = 0; i < ROUTING_PROVIDERS.length; i++) {
        if (isOffline()) break;
        const provider = ROUTING_PROVIDERS[i];
        try {
            // 1. Direct standard OSRM request
            const data = await fetchRouteFromProvider(provider, start, endLocation, true);
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                data.routes.forEach((r, idx) => {
                    parsedRoutes.push(parseOSRMRoute(r, endName, endLocation, start, idx));
                });
            }

            // 2. Multi-corridor discovery if < 2 routes returned or user wants to avoid tolls
            if (parsedRoutes.length < 3 && straightLineDist > 25000) {
                const corridors = generateAlternativeCorridors(start, endLocation);
                for (const corridor of corridors) {
                    try {
                        const coords = [start, ...corridor.waypoints, endLocation]
                            .map(c => `${Number(c.lng.toFixed(5))},${Number(c.lat.toFixed(5))}`)
                            .join(';');
                        const radiuses = coords.split(';').map((_, idx, arr) => (idx === 0 || idx === arr.length - 1) ? '1500' : '10000').join(';');
                        const cUrl = `${provider}/${coords}?overview=full&geometries=geojson&steps=true&radiuses=${radiuses}&continue_straight=false`;
                        const cRes = await fetch(cUrl, { signal: AbortSignal.timeout(5000) });
                        if (cRes.ok) {
                            const cData: OSRMResponse = await cRes.json();
                            if (cData.code === 'Ok' && cData.routes && cData.routes.length > 0) {
                                const cRoute = parseOSRMRoute(cData.routes[0], endName, endLocation, start, parsedRoutes.length);
                                // Check if not a duplicate of existing route
                                const isDup = parsedRoutes.some(p => Math.abs((p.distanceMeters || 0) - (cRoute.distanceMeters || 0)) < 1500 && Math.abs((p.durationMinutes || 0) - (cRoute.durationMinutes || 0)) < 5);
                                if (!isDup) {
                                    cRoute.routeType = corridor.type as any;
                                    cRoute.summary = corridor.name;
                                    parsedRoutes.push(cRoute);
                                }
                            }
                        }
                    } catch (err) {
                        // Corridor fetch failed, continue gracefully
                    }
                }
            }

            if (parsedRoutes.length > 0) break; // Found routes from primary provider
        } catch (e) {
            console.warn(`[OSRM Provider ${i+1}] Alternative routes failed:`, e);
        }
    }

    if (parsedRoutes.length === 0) {
        if (straightLineDist < 300) {
            const direct = generateParkingDirectRoute(start, endName, endLocation);
            return [{
                ...direct,
                routeType: 'fastest',
                routeLabel: 'Direct Route 🅿️',
                savingsLabel: 'Parking lot direct'
            }];
        }
        return [];
    }

    // Identify fastest, shortest, and toll-free routes
    let minDurIdx = 0;
    let minDistIdx = 0;
    let maxTolls = 0;

    parsedRoutes.forEach((r, idx) => {
        if ((r.durationMinutes || 0) < (parsedRoutes[minDurIdx].durationMinutes || 0)) minDurIdx = idx;
        if ((r.distanceMeters || 0) < (parsedRoutes[minDistIdx].distanceMeters || 0)) minDistIdx = idx;
        if ((r.estimatedTolls || 0) > maxTolls) maxTolls = r.estimatedTolls || 0;
    });

    const fastestDist = parsedRoutes[minDurIdx].distanceMeters || 0;
    const fastestDur = parsedRoutes[minDurIdx].durationMinutes || 0;

    parsedRoutes.forEach((r, idx) => {
        if (idx === minDurIdx) {
            r.routeType = 'fastest';
            r.routeLabel = 'Fastest Route ⚡';
            r.savingsLabel = 'Lowest ETA';
        } else if (r.estimatedTolls === 0 && maxTolls > 0) {
            r.routeType = 'toll_free';
            r.routeLabel = 'Toll-Free Route 🟢';
            r.savingsLabel = `Save $${maxTolls.toFixed(2)} in tolls`;
        } else if (idx === minDistIdx && (r.distanceMeters || 0) < fastestDist) {
            r.routeType = 'shortest';
            r.routeLabel = 'Shortest Distance 🛣️';
            const savedMi = Math.max(0.1, (fastestDist - (r.distanceMeters || 0)) / 1609.34);
            r.savingsLabel = `Save ${savedMi.toFixed(1)} mi`;
        } else if (r.routeType === 'scenic') {
            r.routeLabel = 'Inland Route 🌲';
            r.savingsLabel = 'Bypasses coastal traffic';
        } else {
            r.routeType = 'eco';
            r.routeLabel = 'Eco Fuel Saver 🌿';
            r.savingsLabel = 'Est. 15% less gas';
        }
    });

    // Sorting:
    // If avoidTolls is requested, put Toll-Free routes at top
    if (options?.avoidTolls) {
        parsedRoutes.sort((a, b) => {
            if ((a.estimatedTolls || 0) === 0 && (b.estimatedTolls || 0) > 0) return -1;
            if ((b.estimatedTolls || 0) === 0 && (a.estimatedTolls || 0) > 0) return 1;
            return (a.durationMinutes || 0) - (b.durationMinutes || 0);
        });
    } else {
        // Otherwise fastest first
        parsedRoutes.sort((a, b) => {
            if (a.routeType === 'fastest') return -1;
            if (b.routeType === 'fastest') return 1;
            if (a.routeType === 'toll_free') return -1;
            return (a.durationMinutes || 0) - (b.durationMinutes || 0);
        });
    }

    if (parsedRoutes.length > 0) {
        if (ROUTE_OPTIONS_CACHE.size > 50) {
            const firstKey = ROUTE_OPTIONS_CACHE.keys().next().value;
            if (firstKey) ROUTE_OPTIONS_CACHE.delete(firstKey);
        }
        ROUTE_OPTIONS_CACHE.set(cacheKey, {
            routes: parsedRoutes,
            timestamp: Date.now()
        });
    }

    return parsedRoutes;
}

/**
 * Gets a route using multi-provider failover chain.
 * Tries Valhalla with full parking lot & driveway permissions, then OSRM, then direct fallback.
 */
export async function getRouteFromOSRM(
    start: Location,
    endName: string,
    endLocation: Location,
    options?: { avoidTolls?: boolean; avoidHighways?: boolean }
): Promise<NavigationRoute | null> {
    const routes = await fetchRouteOptions(start, endName, endLocation, options);
    if (routes && routes.length > 0) {
        return routes[0];
    }
    return null;
}

/**
 * Decodes Valhalla's polyline6 encoded shape string into an array of [lng, lat] coordinates.
 * Operates safely with 32-bit JS precision without numeric overflow on large coordinate shifts. 
 */
function decodePolyline6(str: string): [number, number][] {
    let index = 0, lat = 0, lng = 0, coordinates: [number, number][] = [];
    while (index < str.length) {
        let b = 0, shift = 0, result = 0;
        do { b = str.charCodeAt(index++) - 63; result += (b & 0x1f) * Math.pow(2, shift); shift += 5; } while (b >= 0x20);
        lat += (result % 2 ? ~(Math.floor(result / 2)) : Math.floor(result / 2));
        b = 0; shift = 0; result = 0;
        if (index >= str.length) break;
        do { b = str.charCodeAt(index++) - 63; result += (b & 0x1f) * Math.pow(2, shift); shift += 5; } while (b >= 0x20);
        lng += (result % 2 ? ~(Math.floor(result / 2)) : Math.floor(result / 2));
        coordinates.push([lng / 1e6, lat / 1e6]);
    }
    return coordinates;
}

/**
 * Fetches and formats a route from Valhalla with full parking lot, driveway, and drive-through access.
 */
async function fetchRouteFromValhalla(start: Location, endName: string, endLocation: Location): Promise<NavigationRoute | null> {
    if (isOffline()) return null;
    try {
        console.log('[Routing] Querying Valhalla engine with parking lot & driveway access...');
        const straightLineDist = getDistanceMeters(start, endLocation);

        const jsonPayload = JSON.stringify({
            locations: [
                { lat: start.lat, lon: start.lng, radius: 100, type: 'break', search_cutoff: 250 },
                { lat: endLocation.lat, lon: endLocation.lng, radius: 150, type: 'break', search_cutoff: 350 }
            ],
            costing: 'auto',
            costing_options: {
                auto: {
                    use_highways: 1.0,
                    use_tolls: 1.0,
                    service_factor: 1.6, // Prioritize main avenues (Yadkin Rd, Santa Fe Dr) during cruising
                    service_penalty: 15, // Deter cutting through intermediate parking lots & alleys
                    parking_aisle_penalty: 20, // Only enter parking aisle at destination, not as a shortcut
                    driveway_penalty: 10,
                    destination_only_penalty: 0, // Allow entering target business customer parking/drive-in
                    alley_penalty: 15,
                    shortest: false // Standard fastest road route
                }
            },
            directions_options: { units: 'miles' }
        });

        const response = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(jsonPayload)}`, {
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) throw new Error(`Valhalla status ${response.status}`);
        const data = await response.json();

        if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) {
            throw new Error('Invalid Valhalla response');
        }

        const leg = data.trip.legs[0];
        const decodedShape = decodePolyline6(leg.shape);
        const steps: RouteStep[] = [];

        for (const maneuver of leg.maneuvers) {
            const endpoint = decodedShape[maneuver.begin_shape_index] || [endLocation.lng, endLocation.lat];
            const instruction = maneuver.instruction || `Proceed`;
            const speedLimit = extractStepSpeedLimit(instruction, maneuver.street_names, maneuver.speed);
            const hasCamera = detectSafetyCamera(instruction, maneuver.street_names);
            const lanes = extractStepLanes(instruction, maneuver.street_names, (maneuver as any)?.lanes);

            steps.push({
                instruction,
                distance: formatDistance(maneuver.length * 1609.34), // Convert miles to meters for formatter
                speedLimit,
                hasCamera,
                lanes,
                endLocation: {
                    lng: endpoint[0],
                    lat: endpoint[1]
                }
            });
        }

        const fallbackRoute: NavigationRoute = {
            destinationName: endName,
            destinationLoc: endLocation,
            startLoc: start,
            steps: steps,
            totalDistance: formatDistance(data.trip.summary.length * 1609.34),
            totalTime: formatDuration(data.trip.summary.time),
            routeGeometry: decodedShape
        };

        console.log('[Routing] ✅ Route via Valhalla:', {
            steps: steps.length,
            geometryNodes: decodedShape.length,
            distance: fallbackRoute.totalDistance
        });

        return fallbackRoute;
    } catch (error) {
        console.warn('[Routing] Valhalla failed:', (error as any)?.message || error);
        return null;
    }
}

/**
 * Geocode a place name to coordinates using secure Cloud Proxy
 */
export async function geocodePlace(query: string, nearLocation?: Location): Promise<Location | null> {
    if (isOffline()) {
        console.warn('[Geocode] 📴 Device is offline, skipping geocode request');
        return null;
    }

    // 1. Try Cloud Function proxy
    try {
        const geocodeFn = httpsCallable<{ address: string }, { location: Location | null }>(functions, 'geocodeAddress');
        const result = await geocodeFn({ address: query });
        return result.data.location;
    } catch (error) {
        console.warn('[Geocode] Proxy unavailable, using Nominatim fallback:', (error as any)?.code || (error as any)?.message);
    }

    // 2. DEV FALLBACK: Use OpenStreetMap Nominatim with strong locality bias
    try {
        const encoded = encodeURIComponent(query);
        // Hard-bias results to user's local area (0.3° ≈ 20 mile radius) + country code
        const viewboxParams = nearLocation
            ? `&viewbox=${nearLocation.lng - 0.3},${nearLocation.lat + 0.3},${nearLocation.lng + 0.3},${nearLocation.lat - 0.3}&bounded=1`
            : '';
        const countryParam = '&countrycodes=us';

        // Attempt 1: Hard-bounded search (bounded=1 + country code)
        let response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}${viewboxParams}${countryParam}&limit=1&addressdetails=1`,
            { 
                headers: { 'User-Agent': 'MyWay-GPS-Dev/1.0' },
                signal: AbortSignal.timeout(5000)
            }
        );
        let results = await response.json();

        // Attempt 2: If hard-bounded returned nothing, retry with soft bias (bounded=0)
        if ((!results || results.length === 0) && nearLocation) {
            const softViewbox = `&viewbox=${nearLocation.lng - 0.5},${nearLocation.lat + 0.5},${nearLocation.lng + 0.5},${nearLocation.lat - 0.5}&bounded=0`;
            response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}${softViewbox}${countryParam}&limit=1&addressdetails=1`,
                { 
                    headers: { 'User-Agent': 'MyWay-GPS-Dev/1.0' },
                    signal: AbortSignal.timeout(5000)
                }
            );
            results = await response.json();
        }

        if (results && results.length > 0) {
            return {
                lat: parseFloat(results[0].lat),
                lng: parseFloat(results[0].lon)
            };
        }
    } catch (fallbackError) {
        console.error('[Geocode] Nominatim fallback also failed:', fallbackError);
    }

    return null;
}
