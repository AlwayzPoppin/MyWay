import { Location, NavigationRoute } from '../types';
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

// Driving Behavior Thresholds
const HARD_BRAKE_THRESHOLD = 4.5; // m/s² (~10 mph/s)
const RAPID_ACCEL_THRESHOLD = 3.5; // m/s² (~8 mph/s)
const SPEEDING_THRESHOLD = 38.0; // m/s (~85 mph)

// Arrival Geofence & Speed Thresholds
export const ARRIVAL_RADIUS_METERS = 150; // ~500 feet (covers parking lots near destination)
export const ARRIVAL_SPEED_THRESHOLD_MPS = 2; // meters/second (~4.47 mph, walking or stationary)
export const ARRIVAL_CONSECUTIVE_TICKS = 3; // consecutive ticks required inside radius under speed threshold

export interface NavigationState {
    currentStepIndex: number;
    distanceToNextStep: number; // in meters
    isOffRoute: boolean;
    hasArrived: boolean;
    splitIndex?: number; // Pre-calculated route split index for completed vs remaining line rendering
}

// Helper to calculate distance from a point to a line segment
const getDistanceToSegmentMeters = (p: Location, a: Location, b: Location): number => {
    // Audit Fix (Round 5): Upgrade to Haversine Cross-Track Distance
    // This provides spherical accuracy across all latitudes.
    const R = 6371000; // Earth radius in meters

    // 1. Distance from 'a' to 'p'
    const d13 = getDistanceMeters(a, p);
    if (d13 === 0) return 0;

    // 2. Bearings
    const theta13 = getBearing(a, p) * Math.PI / 180;
    const theta12 = getBearing(a, b) * Math.PI / 180;

    // 3. Cross-track distance formula
    const dxt = Math.asin(Math.sin(d13 / R) * Math.sin(theta13 - theta12)) * R;

    // 4. Robust Projection Check (Spherical Component)
    // Use the angular difference between (a->p) and (a->b)
    const deltaTheta = theta13 - theta12;
    const cosDelta = Math.cos(deltaTheta);

    // If angle is > 90 degrees (cos < 0), point is behind 'a'
    if (cosDelta < 0) return d13;

    // 5. Along-track distance check
    // dat = spherical distance along segment from 'a' to the projection of 'p'
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

    // Phase 1: Localized window around searchCenterIndex (-15 to +100 points)
    const localStart = Math.max(0, nearestIndex - 15);
    const localEnd = Math.min(routeGeometry.length - 1, nearestIndex + 100);

    for (let i = localStart; i < localEnd; i++) {
        const a = { lat: routeGeometry[i][1], lng: routeGeometry[i][0] };
        const b = { lat: routeGeometry[i + 1][1], lng: routeGeometry[i + 1][0] };
        const p = getPointOnSegmentNearestTo(currentLocation, a, b);
        const dist = getDistanceMeters(currentLocation, p);
        if (dist < minDistance) {
            minDistance = dist;
            nearestIndex = i;
        }
    }

    // Phase 2: If localized search suggests the driver drifted outside the window (> 40m),
    // verify against the entire polyline to ensure true global nearest distance
    if (minDistance > 40 && (localStart > 0 || localEnd < routeGeometry.length - 1)) {
        for (let i = 0; i < routeGeometry.length - 1; i++) {
            if (i >= localStart && i < localEnd) continue; // Already evaluated
            const a = { lat: routeGeometry[i][1], lng: routeGeometry[i][0] };
            const b = { lat: routeGeometry[i + 1][1], lng: routeGeometry[i + 1][0] };
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
    // 1. Prefer true polyline geometry
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

    // 2. Fallback to step waypoints if routeGeometry is missing
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

export const updateNavigationState = (
    currentLocation: Location,
    route: NavigationRoute,
    currentState: NavigationState,
    prevLocation?: Location, // Optional for trajectory analysis
    speedMph: number = 0     // Current speed for dynamic step radius
): NavigationState => {
    const completionRadius = getStepCompletionRadius(speedMph);
    const offRouteThreshold = getOffRouteThresholdMeters(speedMph);
    const { steps, startLoc } = route;
    const { currentStepIndex } = currentState;

    // Cross-Track Polyline Calculation: Measure exact distance to route polyline and advance splitIndex
    let splitIndex = currentState.splitIndex ?? 0;
    let distToRoute = Infinity;

    if (route.routeGeometry && route.routeGeometry.length >= 2) {
        const polyResult = getDistanceToPolylineMeters(currentLocation, route.routeGeometry, splitIndex);
        distToRoute = polyResult.minDistance;
        splitIndex = polyResult.nearestIndex;
    } else {
        distToRoute = getDistanceToRouteMeters(currentLocation, route, splitIndex, currentStepIndex);
    }

    const isOffRoute = distToRoute > offRouteThreshold;

    // Safety check
    if (!steps || steps.length === 0 || currentStepIndex >= steps.length) {
        const distToFinal = route.destinationLoc ? getDistanceMeters(currentLocation, route.destinationLoc) : 0;
        const speedMps = speedMph / 2.23694;
        const hasActuallyArrived = distToFinal <= completionRadius || (distToFinal < ARRIVAL_RADIUS_METERS && speedMps < ARRIVAL_SPEED_THRESHOLD_MPS);
        return { ...currentState, splitIndex, isOffRoute, hasArrived: hasActuallyArrived };
    }

    const currentStep = steps[currentStepIndex];
    const prevStep = currentStepIndex === 0 ? { endLocation: startLoc } : steps[currentStepIndex - 1];

    // Use startLoc as fallback for first step if prevStep.endLocation is missing
    const segmentStart = prevStep.endLocation || startLoc || currentLocation;
    const segmentEnd = currentStep.endLocation || (currentStepIndex === steps.length - 1 ? route.destinationLoc : null);

    if (!segmentStart || !segmentEnd) return { ...currentState, splitIndex, isOffRoute };

    const distToTarget = getDistanceMeters(currentLocation, segmentEnd);

    // GPS DRIFT FIX: Check if we're much closer to the NEXT step than current
    // This handles cases where GPS drift causes the user to miss the exact waypoint
    if (currentStepIndex + 1 < steps.length) {
        const nextStep = steps[currentStepIndex + 1];
        const nextStepEnd = nextStep.endLocation || route.destinationLoc;
        if (nextStepEnd) {
            const distToNextStep = getDistanceMeters(currentLocation, nextStepEnd);
            // If we're significantly closer to the next waypoint (< 50% of current distance),
            // we've clearly passed the current one - advance the step
            if (distToNextStep < distToTarget * 0.5 && distToTarget > completionRadius) {
                return {
                    currentStepIndex: currentStepIndex + 1,
                    distanceToNextStep: distToNextStep,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex
                };
            }
        }
    }

    // Check for step completion (standard radius check)
    if (distToTarget < completionRadius) {
        const nextIndex = currentStepIndex + 1;
        if (nextIndex >= steps.length) {
            // Guard: Destination Arrival requires driver to actually be close to route.destinationLoc
            const distToFinalDest = route.destinationLoc ? getDistanceMeters(currentLocation, route.destinationLoc) : distToTarget;
            const speedMps = speedMph / 2.23694;
            const hasActuallyArrived = distToFinalDest <= completionRadius || (distToFinalDest < ARRIVAL_RADIUS_METERS && speedMps < ARRIVAL_SPEED_THRESHOLD_MPS);

            if (hasActuallyArrived) {
                return {
                    currentStepIndex: steps.length - 1,
                    distanceToNextStep: 0,
                    isOffRoute: false,
                    hasArrived: true,
                    splitIndex: route.routeGeometry ? route.routeGeometry.length - 1 : splitIndex
                };
            } else {
                // Not close enough to destination yet (e.g. GPS jitter or step radius discrepancy); keep navigating towards destination
                return {
                    currentStepIndex: steps.length - 1,
                    distanceToNextStep: distToFinalDest,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex
                };
            }
        } else {
            // Advance to next step
            return {
                currentStepIndex: nextIndex,
                distanceToNextStep: getDistanceMeters(currentLocation, steps[nextIndex].endLocation || route.destinationLoc),
                isOffRoute: false,
                hasArrived: false,
                splitIndex
            };
        }
    }

    return {
        ...currentState,
        distanceToNextStep: distToTarget,
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
    // Filter out noise from very small time intervals
    if (timeDeltaMs < 500) return null;

    const timeSeconds = timeDeltaMs / 1000;
    const acceleration = (currentSpeed - previousSpeed) / timeSeconds;

    if (currentSpeed > SPEEDING_THRESHOLD) {
        return 'speeding';
    } else if (acceleration < -HARD_BRAKE_THRESHOLD) {
        return 'hard_brake';
    } else if (acceleration > RAPID_ACCEL_THRESHOLD) {
        return 'rapid_accel';
    }

    return null;
};
