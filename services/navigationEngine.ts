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
const OFF_ROUTE_THRESHOLD_METERS = 45;

// Driving Behavior Thresholds
const HARD_BRAKE_THRESHOLD = 4.5; // m/s² (~10 mph/s)
const RAPID_ACCEL_THRESHOLD = 3.5; // m/s² (~8 mph/s)
const SPEEDING_THRESHOLD = 38.0; // m/s (~85 mph)

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
 * Audit #5: Snap-to-Road — project raw GPS onto nearest route segment
 * Returns the perpendicular distance to the nearest segment of the route polyline.
 * 
 * AUDIT FIX: Memoized by quantized coordinates (5 decimal places ≈ 1.1m precision)
 * to prevent redundant Haversine calculations on every render cycle.
 */
const routeDistanceCache = new Map<string, number>();
const ROUTE_CACHE_MAX = 50;

const getDistanceToRouteMeters = (
    currentLocation: Location,
    route: { steps: { endLocation?: Location }[]; startLoc?: Location },
    currentStepIndex: number = 0
): number => {
    // Quantize to ~1m precision for cache key + currentStepIndex
    const key = `${currentLocation.lat.toFixed(5)},${currentLocation.lng.toFixed(5)}_${currentStepIndex}`;

    if (routeDistanceCache.has(key)) {
        return routeDistanceCache.get(key)!;
    }

    const waypoints: Location[] = [];
    if (route.startLoc) waypoints.push(route.startLoc);

    for (const step of route.steps) {
        if (step.endLocation) waypoints.push(step.endLocation);
    }

    if (waypoints.length < 2) return Infinity;

    // Restrict search window to adjacent segments around currentStepIndex
    const startIdx = Math.max(0, currentStepIndex - 1);
    const endIdx = Math.min(waypoints.length - 1, currentStepIndex + 3);

    let minDistance = Infinity;
    for (let i = startIdx; i < endIdx; i++) {
        const dist = getDistanceToSegmentMeters(currentLocation, waypoints[i], waypoints[i + 1]);
        if (dist < minDistance) minDistance = dist;
    }

    // LRU eviction
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
    const { steps, startLoc } = route;
    const { currentStepIndex } = currentState;

    // Split logic: Find nearest polyline point (bounded window around splitIndex)
    let splitIndex = currentState.splitIndex ?? 0;
    if (route.routeGeometry && route.routeGeometry.length >= 2) {
        let minDist = Infinity;
        const searchStart = Math.max(0, splitIndex - 10);
        const searchEnd = Math.min(route.routeGeometry.length - 1, Math.max(searchStart + 80, splitIndex + 80));
        for (let i = searchStart; i < searchEnd; i++) {
            const a = { lat: route.routeGeometry[i][1], lng: route.routeGeometry[i][0] };
            const b = { lat: route.routeGeometry[i + 1][1], lng: route.routeGeometry[i + 1][0] };
            const p = getPointOnSegmentNearestTo(currentLocation, a, b);
            const d = getDistanceMeters(currentLocation, p);
            if (d < minDist) {
                minDist = d;
                splitIndex = i;
            }
        }
    }

    // Safety check
    if (!steps || steps.length === 0 || currentStepIndex >= steps.length) {
        return { ...currentState, splitIndex, hasArrived: true };
    }

    const currentStep = steps[currentStepIndex];
    const prevStep = currentStepIndex === 0 ? { endLocation: startLoc } : steps[currentStepIndex - 1];

    // Use startLoc as fallback for first step if prevStep.endLocation is missing
    // Audit Fix: Add currentLocation as final fallback to prevent crash if startLoc is undefined
    const segmentStart = prevStep.endLocation || startLoc || currentLocation;
    const segmentEnd = currentStep.endLocation || (currentStepIndex === steps.length - 1 ? route.destinationLoc : null);

    if (!segmentStart || !segmentEnd) return { ...currentState, splitIndex };

    const distToTarget = getDistanceMeters(currentLocation, segmentEnd);

    // Audit #5: Snap-to-road — check against local route segments around current step
    // Prevents false off-route alerts when GPS drifts near segment boundaries
    const distToRoute = getDistanceToRouteMeters(currentLocation, route, currentStepIndex);
    const isOffRoute = distToRoute > OFF_ROUTE_THRESHOLD_METERS;

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
            // Arrived at destination
            return {
                currentStepIndex: steps.length - 1,
                distanceToNextStep: 0,
                isOffRoute: false,
                hasArrived: true,
                splitIndex: route.routeGeometry ? route.routeGeometry.length - 1 : splitIndex
            };
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
