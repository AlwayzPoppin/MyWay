import { Location, NavigationRoute, RouteStep, LaneGuidance } from '../types';
import { getDistanceMeters, getBearing, getPointOnSegmentNearestTo } from '../utils/geo';

// Constants
// Audit Fix: Dynamic step completion radius scaled by speed
// Walking (<5 mph): 20m — precise for pedestrians
// City driving (5–45 mph): linearly scaled 20m–60m
// Highway (>45 mph): 80m — accounts for high-speed GPS lag
const getStepCompletionRadius = (speedMph: number = 0): number => {
    if (speedMph <= 5) return 20;
    if (speedMph >= 45) return 80;
    // Linear interpolation: 20m at 5mph → 60m at 45mph
    return 20 + ((speedMph - 5) / 40) * 40;
};
export const getOffRouteThresholdMeters = (speedMph: number = 0): number => {
    if (speedMph <= 45) return 38; // 38m (~125ft, city road width + sidewalk)
    if (speedMph >= 70) return 55; // 55m for high-speed highway GPS jitter
    // Linear scaling 38m at 45mph -> 55m at 70mph
    return 38 + ((speedMph - 45) / 25) * 17;
};

// Default fallback constant for backward compatibility
const OFF_ROUTE_THRESHOLD_METERS = 38;

// Driving Behavior Thresholds (Calibrated for real-world automotive telematics)
const HARD_BRAKE_THRESHOLD = 3.6; // m/s² (~8.1 mph/s deceleration)
const RAPID_ACCEL_THRESHOLD = 2.8; // m/s² (~6.3 mph/s aggressive acceleration)
const SPEEDING_THRESHOLD = 38.0; // m/s (~85 mph)

// Arrival Geofence & Speed Thresholds
export const ARRIVAL_RADIUS_METERS = 25; // ~82 feet (precise curb / driveway arrival threshold)
export const ARRIVAL_APPROACH_RADIUS_METERS = 76.2; // 250 feet: show the optional arrival contribution prompt
export const ARRIVAL_PINPOINT_RADIUS_METERS = 12; // ~39 feet (instant pinpoint arrival)
export const ARRIVAL_SPEED_THRESHOLD_MPS = 2; // meters/second (~4.47 mph, walking or stationary)
export const ARRIVAL_CONSECUTIVE_TICKS = 3; // consecutive ticks required inside radius under speed threshold
export const MANEUVER_COMPLETE_THRESHOLD_METERS = 8; // ~26 feet (snap maneuver at ~25ft instead of counting down to 0ft)

export interface NavigationState {
    currentStepIndex: number;
    distanceToNextStep: number; // in meters
    remainingDistanceMeters?: number; // distance along the active route from the snapped position to the destination
    remainingDurationSeconds?: number; // live ETA based on remaining road distance
    isOffRoute: boolean;
    hasArrived: boolean;
    splitIndex?: number; // Pre-calculated route split index for completed vs remaining line rendering
}

export interface UpcomingManeuverGuidance {
    instruction: string;
    currentRoadName?: string;
    targetRoadName?: string;
    distanceMeters: number;
    distanceStr: string;
    maneuverType: string;
    maneuverModifier?: string;
    lanes?: LaneGuidance[];
    hasCamera?: boolean;
    speedLimit?: number;
    isArrival: boolean;
    departInstruction?: string;
    thenManeuver?: {
        instruction: string;
        maneuverType: string;
        maneuverModifier?: string;
        distanceMeters?: number;
    };
}

const remainingPolylineDistanceCache = new WeakMap<NavigationRoute, number[]>();

/**
 * Formats distance in meters to standard driving HUD string
 */
export function formatManeuverDistance(meters: number, isArrival: boolean = false): string {
    if (!Number.isFinite(meters) || meters <= 0) return '0 ft';
    if (isArrival && meters <= 5) return '0 ft';
    if (!isArrival && meters < MANEUVER_COMPLETE_THRESHOLD_METERS) {
        return '25 ft';
    }
    if (meters >= 402) { // 0.25 mi or greater: use legible miles (e.g. 0.3 mi, 0.5 mi, 1.2 mi)
        return `${(meters / 1609.34).toFixed(1)} mi`;
    }
    const feet = meters * 3.28084;
    if (feet > 100) {
        return `${Math.round(feet / 50) * 50} ft`;
    }
    return `${Math.max(25, Math.round(feet))} ft`;
}

/** Formats the remaining trip distance consistently across the driving HUD and Android Auto. */
export function formatRemainingDistance(meters: number): string {
    if (!Number.isFinite(meters) || meters <= 0) return '0 ft';
    // A route summary becomes much easier to scan in miles before a full mile.
    // Keep the threshold aligned with the maneuver banner.
    if (meters >= 402) return `${(meters / 1609.34).toFixed(1)} mi`;
    return `${Math.max(0, Math.round(meters * 3.28084))} ft`;
}

/**
 * Extracts target road name from instruction string
 */
export function extractRoadName(instruction?: string): string {
    if (!instruction) return '';
    const match = instruction.match(/(?:onto|on|toward|towards)\s+(.+?)(?:\s+(?:then|and)\s+|,|$)/i);
    if (match && match[1]) {
        return match[1].replace(/[.,;]+$/, '').trim();
    }
    return instruction.replace(/^(turn left|turn right|continue|head|make a u-turn|merge|take the exit|take exit|take the ramp|at the roundabout|at the rotary)\s+(?:onto|on|toward|towards)?\s*/i, '').trim();
}

/**
 * Infers normalized maneuver type from instruction text
 */
export function inferManeuverType(instruction: string = ''): string {
    const text = instruction.toLowerCase();
    if (text.includes('arrive')) return 'arrive';
    if (text.includes('depart') || text.includes('head')) return 'depart';
    if (text.includes('u-turn') || text.includes('uturn')) return 'uturn';
    if (text.includes('turn')) return 'turn';
    if (text.includes('merge')) return 'merge';
    if (text.includes('exit') || text.includes('off ramp')) return 'off ramp';
    if (text.includes('ramp')) return 'on ramp';
    if (text.includes('fork') || text.includes('keep')) return 'fork';
    if (text.includes('roundabout')) return 'roundabout';
    if (text.includes('rotary')) return 'rotary';
    if (text.includes('continue')) return 'continue';
    return 'straight';
}

/**
 * Infers normalized maneuver modifier (direction) from instruction text
 */
export function inferManeuverModifier(instruction: string = ''): string | undefined {
    const text = instruction.toLowerCase();
    if (text.includes('u-turn') || text.includes('uturn')) return 'uturn';
    if (text.includes('slight left')) return 'slight left';
    if (text.includes('slight right')) return 'slight right';
    if (text.includes('sharp left')) return 'sharp left';
    if (text.includes('sharp right')) return 'sharp right';
    if (text.includes('left')) return 'left';
    if (text.includes('right')) return 'right';
    if (text.includes('straight')) return 'straight';
    return undefined;
}

/**
 * Resolves upcoming maneuver guidance for the driving HUD and voice synthesizer.
 *
 * Traversal Semantics:
 * When the vehicle is traversing step[i], the upcoming action approaching at step[i].endLocation
 * is defined by step[i + 1] (or Arrival at destination if on the final step).
 * This eliminates the defect where "Turn left onto McArthur Road" was shown while already driving down McArthur Road.
 */
export function getUpcomingManeuverGuidance(
    route: NavigationRoute,
    navState: NavigationState
): UpcomingManeuverGuidance {
    const steps = route.steps || [];
    const stepIdx = Math.max(0, Math.min(navState.currentStepIndex, Math.max(0, steps.length - 1)));
    const traversingStep = steps[stepIdx];

    const distMeters = Math.max(0, navState.distanceToNextStep ?? 0);
    const distStr = formatManeuverDistance(distMeters, navState.hasArrived || stepIdx >= steps.length - 1);
    const currentRoadName = traversingStep?.roadName || extractRoadName(traversingStep?.instruction) || '';

    if (navState.hasArrived) {
        return {
            instruction: route.destinationName ? `Arrived at ${route.destinationName}` : 'You have arrived',
            currentRoadName,
            targetRoadName: route.destinationName,
            distanceMeters: 0,
            distanceStr: '0 ft',
            maneuverType: 'arrive',
            isArrival: true
        };
    }

    const isDeparting = stepIdx === 0 && (traversingStep?.maneuverType === 'depart' || traversingStep?.instruction.toLowerCase().startsWith('head'));

    if (stepIdx < steps.length - 1) {
        const upcomingStep = steps[stepIdx + 1];
        const isUpcomingArrival = (stepIdx + 1 === steps.length - 1) &&
            (upcomingStep.instruction.toLowerCase().includes('arrive') || upcomingStep.maneuverType === 'arrive');

        let thenManeuver: UpcomingManeuverGuidance['thenManeuver'] = undefined;
        if (stepIdx + 2 < steps.length) {
            const nextNextStep = steps[stepIdx + 2];
            thenManeuver = {
                instruction: nextNextStep.instruction,
                maneuverType: nextNextStep.maneuverType || inferManeuverType(nextNextStep.instruction),
                maneuverModifier: nextNextStep.maneuverModifier || inferManeuverModifier(nextNextStep.instruction)
            };
        } else if (stepIdx + 1 < steps.length - 1) {
            thenManeuver = {
                instruction: route.destinationName ? `Arrive at ${route.destinationName}` : 'Arrive at destination',
                maneuverType: 'arrive'
            };
        }

        return {
            instruction: upcomingStep.instruction,
            currentRoadName,
            targetRoadName: upcomingStep.roadName || extractRoadName(upcomingStep.instruction) || (isUpcomingArrival ? route.destinationName : ''),
            distanceMeters: distMeters,
            distanceStr: distStr,
            maneuverType: upcomingStep.maneuverType || inferManeuverType(upcomingStep.instruction),
            maneuverModifier: upcomingStep.maneuverModifier || inferManeuverModifier(upcomingStep.instruction),
            lanes: upcomingStep.lanes || traversingStep?.lanes,
            hasCamera: upcomingStep.hasCamera || traversingStep?.hasCamera,
            speedLimit: traversingStep?.speedLimit || upcomingStep.speedLimit,
            isArrival: isUpcomingArrival,
            departInstruction: isDeparting ? traversingStep?.instruction : undefined,
            thenManeuver
        };
    }

    // Final step before arrival
    const arrivalDistMeters = (typeof navState.remainingDistanceMeters === 'number' && Number.isFinite(navState.remainingDistanceMeters))
        ? navState.remainingDistanceMeters
        : distMeters;

    return {
        instruction: route.destinationName ? `Arrive at ${route.destinationName}` : 'Arrive at your destination',
        currentRoadName,
        targetRoadName: route.destinationName || '',
        distanceMeters: arrivalDistMeters,
        distanceStr: formatManeuverDistance(arrivalDistMeters),
        maneuverType: 'arrive',
        lanes: traversingStep?.lanes,
        hasCamera: traversingStep?.hasCamera,
        speedLimit: traversingStep?.speedLimit,
        isArrival: true,
        departInstruction: undefined,
        thenManeuver: undefined
    };
}

/**
 * Calculates road distance still ahead of the driver. The cumulative segment cache
 * makes this safe to call on every accepted GPS update.
 */
export const getRemainingRouteDistanceMeters = (
    currentLocation: Location,
    route: NavigationRoute,
    splitIndex: number = 0
): number | null => {
    const geometry = route.routeGeometry;
    if (!geometry || geometry.length < 2) return null;

    const { nearestIndex } = getDistanceToPolylineMeters(currentLocation, geometry, splitIndex);
    const segmentIndex = Math.max(0, Math.min(geometry.length - 2, nearestIndex));
    const segmentStart = { lat: geometry[segmentIndex][1], lng: geometry[segmentIndex][0] };
    const segmentEnd = { lat: geometry[segmentIndex + 1][1], lng: geometry[segmentIndex + 1][0] };
    const snappedPoint = getPointOnSegmentNearestTo(currentLocation, segmentStart, segmentEnd);

    let segmentTotals = remainingPolylineDistanceCache.get(route);
    if (!segmentTotals || segmentTotals.length !== geometry.length) {
        segmentTotals = Array.from({ length: geometry.length }, () => 0);
        for (let index = geometry.length - 2; index >= 0; index -= 1) {
            const start = { lat: geometry[index][1], lng: geometry[index][0] };
            const end = { lat: geometry[index + 1][1], lng: geometry[index + 1][0] };
            segmentTotals[index] = getDistanceMeters(start, end) + (segmentTotals[index + 1] || 0);
        }
        remainingPolylineDistanceCache.set(route, segmentTotals);
    }

    return Math.max(0, getDistanceMeters(snappedPoint, segmentEnd) + (segmentTotals[segmentIndex + 1] || 0));
};

/**
 * Converts the original route duration into a live ETA using the same
 * road-following distance calculation used by the navigation display.
 */
const getRemainingRouteDurationSeconds = (
    route: NavigationRoute,
    remainingDistanceMeters: number | null
): number | undefined => {
    if (remainingDistanceMeters === null || !Number.isFinite(remainingDistanceMeters)) return undefined;
    const originalSeconds = route.totalDurationSec || (route.durationMinutes ? route.durationMinutes * 60 : 0);
    const originalDistance = route.distanceMeters || 0;
    if (originalSeconds <= 0 || originalDistance <= 0) return undefined;
    return Math.max(0, Math.round(originalSeconds * Math.min(1, remainingDistanceMeters / originalDistance)));
};

// Helper to calculate distance from a point to a line segment
const getDistanceToSegmentMeters = (p: Location, a: Location, b: Location): number => {
    // Haversine Cross-Track Distance
    const R = 6371000; // Earth radius in meters

    const d13 = getDistanceMeters(a, p);
    if (d13 === 0) return 0;

    const theta13 = getBearing(a, p) * Math.PI / 180;
    const theta12 = getBearing(a, b) * Math.PI / 180;

    const dxt = Math.asin(Math.sin(d13 / R) * Math.sin(theta13 - theta12)) * R;

    const deltaTheta = theta13 - theta12;
    const cosDelta = Math.cos(deltaTheta);

    if (cosDelta < 0) return d13;

    const dat = Math.atan2(Math.sin(d13 / R) * cosDelta, Math.cos(d13 / R)) * R;
    const d12 = getDistanceMeters(a, b);

    if (dat > d12) return getDistanceMeters(p, b);

    return Math.abs(dxt);
};

/**
 * Computes exact perpendicular cross-track distance from a location to the actual route polyline.
 * Uses a localized search window around searchCenterIndex first, expanding to full geometry if needed.
 */
export const getDistanceToPolylineMeters = (
    currentLocation: Location,
    routeGeometry: [number, number][], // [lng, lat]
    searchCenterIndex: number = 0
): { minDistance: number; nearestIndex: number } => {
    if (!routeGeometry || routeGeometry.length < 2) {
        return { minDistance: Infinity, nearestIndex: 0 };
    }

    let minDistance = Infinity;
    let nearestIndex = Math.max(0, Math.min(routeGeometry.length - 1, searchCenterIndex));

    // Phase 1: Localized window around searchCenterIndex (-15 to +40 points)
    // Clamping forward search window prevents cross-track snapping to parallel residential streets
    const localStart = Math.max(0, nearestIndex - 15);
    const localEnd = Math.min(routeGeometry.length - 1, nearestIndex + 40);

    const toPoint = (pt: any): Location => {
        if (Array.isArray(pt)) return { lat: Number(pt[1]), lng: Number(pt[0]) };
        return { lat: Number(pt.lat ?? pt.latitude ?? 0), lng: Number(pt.lng ?? pt.longitude ?? 0) };
    };

    for (let i = localStart; i < localEnd; i++) {
        const a = toPoint(routeGeometry[i]);
        const b = toPoint(routeGeometry[i + 1]);
        const p = getPointOnSegmentNearestTo(currentLocation, a, b);
        const dist = getDistanceMeters(currentLocation, p);
        if (dist < minDistance) {
            minDistance = dist;
            nearestIndex = i;
        }
    }

    // Phase 2: Only perform global search if the vehicle is genuinely far from the local corridor (> 55m)
    // AND search center was at the origin (e.g. initial route start / full reroute).
    // During active driving along a route, do not allow jumping far forward across uncompleted roads.
    if (minDistance > 55 && searchCenterIndex === 0 && (localStart > 0 || localEnd < routeGeometry.length - 1)) {
        for (let i = 0; i < routeGeometry.length - 1; i++) {
            if (i >= localStart && i < localEnd) continue;
            const a = toPoint(routeGeometry[i]);
            const b = toPoint(routeGeometry[i + 1]);
            const p = getPointOnSegmentNearestTo(currentLocation, a, b);
            const dist = getDistanceMeters(currentLocation, p);
            if (dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        }
    }

    return { minDistance, nearestIndex };
};

const routeDistanceCache = new Map<string, number>();
const ROUTE_CACHE_MAX = 50;

export const getDistanceToRouteMeters = (
    currentLocation: Location,
    route: NavigationRoute,
    splitIndex: number = 0,
    currentStepIndex: number = 0
): number => {
    if (route.routeGeometry && route.routeGeometry.length >= 2) {
        const key = `${currentLocation.lat.toFixed(5)},${currentLocation.lng.toFixed(5)}_${splitIndex}`;
        if (routeDistanceCache.has(key)) {
            return routeDistanceCache.get(key)!;
        }

        const { minDistance } = getDistanceToPolylineMeters(currentLocation, route.routeGeometry, splitIndex);

        if (routeDistanceCache.size >= ROUTE_CACHE_MAX) {
            const oldest = routeDistanceCache.keys().next().value;
            if (oldest !== undefined) routeDistanceCache.delete(oldest);
        }
        routeDistanceCache.set(key, minDistance);
        return minDistance;
    }

    const key = `${currentLocation.lat.toFixed(5)},${currentLocation.lng.toFixed(5)}_s${currentStepIndex}`;
    if (routeDistanceCache.has(key)) {
        return routeDistanceCache.get(key)!;
    }

    const waypoints: Location[] = [];
    if (route.startLoc) waypoints.push(route.startLoc);
    for (const step of route.steps || []) {
        if (step.endLocation) waypoints.push(step.endLocation);
    }
    if (waypoints.length < 2) return Infinity;

    const startIdx = Math.max(0, currentStepIndex - 1);
    const endIdx = Math.min(waypoints.length - 1, currentStepIndex + 3);

    let minDistance = Infinity;
    for (let i = startIdx; i < endIdx; i++) {
        const dist = getDistanceToSegmentMeters(currentLocation, waypoints[i], waypoints[i + 1]);
        if (dist < minDistance) minDistance = dist;
    }

    if (routeDistanceCache.size >= ROUTE_CACHE_MAX) {
        const oldest = routeDistanceCache.keys().next().value;
        if (oldest !== undefined) routeDistanceCache.delete(oldest);
    }
    routeDistanceCache.set(key, minDistance);
    return minDistance;
};

export function isLocationOffRoute(location: Location, route: NavigationRoute, speedMph: number = 0): boolean {
    const threshold = getOffRouteThresholdMeters(speedMph);
    let dist = Infinity;
    if (route.routeGeometry && route.routeGeometry.length >= 2) {
        dist = getDistanceToPolylineMeters(location, route.routeGeometry).minDistance;
    } else {
        dist = getDistanceToRouteMeters(location, route);
    }
    return dist > threshold;
}

const stepEndPolylineCache = new WeakMap<NavigationRoute, number[]>();

/**
 * Maps each step in the route to its ending vertex index along routeGeometry.
 * Enables instantaneous step synchronization when switching routes, resuming trips,
 * or recovering from GPS jumps.
 */
export function getStepEndPolylineIndices(route: NavigationRoute): number[] {
    const geometry = route.routeGeometry;
    const steps = route.steps;
    if (!geometry || geometry.length < 2 || !steps || steps.length === 0) {
        return [];
    }
    const cached = stepEndPolylineCache.get(route);
    if (cached && cached.length === steps.length) {
        return cached;
    }

    const indices: number[] = [];
    let lastFoundIndex = 0;

    for (let sIdx = 0; sIdx < steps.length; sIdx++) {
        if (sIdx === steps.length - 1) {
            indices.push(geometry.length - 1);
            break;
        }

        const step = steps[sIdx];
        const targetLoc = step.endLocation;
        if (!targetLoc) {
            indices.push(lastFoundIndex);
            continue;
        }

        const searchStart = Math.max(0, lastFoundIndex - 5);
        let bestDist = Infinity;
        let bestIdx = lastFoundIndex;

        for (let gIdx = searchStart; gIdx < geometry.length; gIdx++) {
            const pt: Location = { lat: geometry[gIdx][1], lng: geometry[gIdx][0] };
            const d = getDistanceMeters(targetLoc, pt);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = gIdx;
            }
        }

        indices.push(bestIdx);
        lastFoundIndex = Math.max(lastFoundIndex, bestIdx);
    }

    stepEndPolylineCache.set(route, indices);
    return indices;
}

export const updateNavigationState = (
    currentLocation: Location,
    route: NavigationRoute,
    currentState: NavigationState,
    prevLocation?: Location,
    speedMph: number = 0
): NavigationState => {
    const completionRadius = getStepCompletionRadius(speedMph);
    const offRouteThreshold = getOffRouteThresholdMeters(speedMph);
    const { steps, startLoc } = route;
    // Enforce non-negative valid step index and prevent backward regression
    const initialStepIndex = Math.max(0, currentState.currentStepIndex || 0);

    let splitIndex = currentState.splitIndex ?? 0;
    let distToRoute = Infinity;

    if (route.routeGeometry && route.routeGeometry.length >= 2) {
        const polyResult = getDistanceToPolylineMeters(currentLocation, route.routeGeometry, splitIndex);
        distToRoute = polyResult.minDistance;
        splitIndex = Math.max(splitIndex, polyResult.nearestIndex);
    } else {
        distToRoute = getDistanceToRouteMeters(currentLocation, route, splitIndex, initialStepIndex);
    }

    const isOffRoute = distToRoute > offRouteThreshold;
    const remainingDistanceMeters = getRemainingRouteDistanceMeters(currentLocation, route, splitIndex);
    const remainingDurationSeconds = getRemainingRouteDurationSeconds(route, remainingDistanceMeters);

    let currentStepIndex = initialStepIndex;

    // Polyline-Anchored Step Alignment Engine:
    // If the driver is mid-route (e.g. after a route switch to an alternative route,
    // after an app restart, or if GPS briefly lagged behind a turn), align currentStepIndex
    // forward to the step corresponding to the vehicle's position along the polyline.
    if (steps && steps.length > 0 && route.routeGeometry && route.routeGeometry.length >= 2 && !isOffRoute) {
        const stepPolyIndices = getStepEndPolylineIndices(route);
        if (stepPolyIndices.length === steps.length) {
            let polyAlignedIndex = currentStepIndex;
            for (let i = 0; i < stepPolyIndices.length; i++) {
                if (stepPolyIndices[i] >= splitIndex) {
                    polyAlignedIndex = i;
                    break;
                }
            }
            if (polyAlignedIndex > currentStepIndex) {
                currentStepIndex = polyAlignedIndex;
            }
        }
    }

    if (!steps || steps.length === 0 || currentStepIndex >= steps.length) {
        const distToFinal = route.destinationLoc ? getDistanceMeters(currentLocation, route.destinationLoc) : 0;
        const speedMps = speedMph / 2.23694;
        const hasActuallyArrived = (distToFinal <= ARRIVAL_PINPOINT_RADIUS_METERS) ||
            (distToFinal <= ARRIVAL_RADIUS_METERS && speedMps < ARRIVAL_SPEED_THRESHOLD_MPS);
        return {
            ...currentState,
            currentStepIndex: Math.max(0, (steps?.length || 1) - 1),
            splitIndex,
            remainingDistanceMeters: hasActuallyArrived ? 0 : remainingDistanceMeters ?? undefined,
            remainingDurationSeconds: hasActuallyArrived ? 0 : remainingDurationSeconds,
            isOffRoute,
            hasArrived: hasActuallyArrived
        };
    }

    const currentStep = steps[currentStepIndex];
    const prevStep = currentStepIndex === 0 ? { endLocation: startLoc } : steps[currentStepIndex - 1];

    const segmentStart = prevStep.endLocation || startLoc || currentLocation;
    const segmentEnd = currentStep.endLocation || (currentStepIndex === steps.length - 1 ? route.destinationLoc : null);

    if (!segmentStart || !segmentEnd) {
        return {
            ...currentState,
            currentStepIndex,
            splitIndex,
            remainingDistanceMeters: remainingDistanceMeters ?? undefined,
            remainingDurationSeconds,
            isOffRoute
        };
    }

    const distToTarget = getDistanceMeters(currentLocation, segmentEnd);

    // GPS DRIFT FIX: Check if we're much closer to the NEXT step than current
    // Bounded by max proximity to prevent false advancement across parallel roads
    if (currentStepIndex + 1 < steps.length) {
        const nextStep = steps[currentStepIndex + 1];
        const nextStepEnd = nextStep.endLocation || route.destinationLoc;
        if (nextStepEnd) {
            const distToNextStep = getDistanceMeters(currentLocation, nextStepEnd);
            if (distToNextStep < distToTarget * 0.5 && distToTarget > completionRadius && distToNextStep < Math.max(160, completionRadius * 2.5)) {
                return {
                    currentStepIndex: currentStepIndex + 1,
                    distanceToNextStep: distToNextStep,
                    remainingDistanceMeters: remainingDistanceMeters ?? undefined,
                    remainingDurationSeconds,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex
                };
            }
        }
    }

    // Step completion radius check or early maneuver transition snap (threshold ~25ft / 8m)
    if (distToTarget < completionRadius || distToTarget <= MANEUVER_COMPLETE_THRESHOLD_METERS) {
        const nextIndex = currentStepIndex + 1;
        if (nextIndex >= steps.length) {
            const distToFinalDest = route.destinationLoc ? getDistanceMeters(currentLocation, route.destinationLoc) : distToTarget;
            const speedMps = speedMph / 2.23694;
            // STRICT DESTINATION ARRIVAL: Decoupled from completionRadius.
            // Requires vehicle to be genuinely at destination (<= 25m at slow speed < 2 m/s, or <= 12m pinpoint)
            const hasActuallyArrived = (distToFinalDest <= ARRIVAL_PINPOINT_RADIUS_METERS) ||
                (distToFinalDest <= ARRIVAL_RADIUS_METERS && speedMps < ARRIVAL_SPEED_THRESHOLD_MPS);

            if (hasActuallyArrived) {
                return {
                    currentStepIndex: steps.length - 1,
                    distanceToNextStep: 0,
                    remainingDistanceMeters: 0,
                    remainingDurationSeconds: 0,
                    isOffRoute: false,
                    hasArrived: true,
                    splitIndex: route.routeGeometry ? route.routeGeometry.length - 1 : splitIndex
                };
            } else {
                return {
                    currentStepIndex: steps.length - 1,
                    distanceToNextStep: distToFinalDest,
                    remainingDistanceMeters: remainingDistanceMeters ?? undefined,
                    remainingDurationSeconds,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex
                };
            }
        } else {
            return {
                currentStepIndex: nextIndex,
                distanceToNextStep: getDistanceMeters(currentLocation, steps[nextIndex].endLocation || route.destinationLoc),
                remainingDistanceMeters: remainingDistanceMeters ?? undefined,
                remainingDurationSeconds,
                isOffRoute: false,
                hasArrived: false,
                splitIndex
            };
        }
    }

    return {
        ...currentState,
        currentStepIndex,
        distanceToNextStep: distToTarget,
        remainingDistanceMeters: remainingDistanceMeters ?? undefined,
        remainingDurationSeconds,
        isOffRoute,
        splitIndex
    };
};

/**
 * Analyzes driving behavior based on speed changes over time.
 */
export const analyzeDrivingBehavior = (
    currentSpeed: number, // meters per second
    previousSpeed: number, // meters per second
    timeDeltaMs: number // milliseconds
): 'hard_brake' | 'rapid_accel' | 'speeding' | null => {
    if (timeDeltaMs < 400 || timeDeltaMs > 5000) return null;

    const timeSeconds = timeDeltaMs / 1000;
    const acceleration = (currentSpeed - previousSpeed) / timeSeconds;

    if (currentSpeed > SPEEDING_THRESHOLD) {
        return 'speeding';
    } else if (acceleration < -HARD_BRAKE_THRESHOLD && previousSpeed >= 3.5) {
        return 'hard_brake';
    } else if (acceleration > RAPID_ACCEL_THRESHOLD && currentSpeed >= 2.5) {
        return 'rapid_accel';
    }

    return null;
};
