import { Location, NavigationRoute } from '../types';

// Constants
// Audit Fix: Increased from 30m to 50m to account for real-world GPS drift (typically 10-50m)
const STEP_COMPLETION_RADIUS_METERS = 50;
const OFF_ROUTE_THRESHOLD_METERS = 100;

// Driving Behavior Thresholds
const HARD_BRAKE_THRESHOLD = 4.5; // m/s² (~10 mph/s)
const RAPID_ACCEL_THRESHOLD = 3.5; // m/s² (~8 mph/s)
const SPEEDING_THRESHOLD = 38.0; // m/s (~85 mph)

export interface NavigationState {
    currentStepIndex: number;
    distanceToNextStep: number; // in meters
    isOffRoute: boolean;
    hasArrived: boolean;
}

// Haversine formula for distance
const getDistanceMeters = (loc1: Location, loc2: Location): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = loc1.lat * Math.PI / 180;
    const φ2 = loc2.lat * Math.PI / 180;
    const Δφ = (loc2.lat - loc1.lat) * Math.PI / 180;
    const Δλ = (loc2.lng - loc1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

// Helper to calculate bearing between two points
const getBearing = (start: Location, end: Location): number => {
    const startLat = start.lat * Math.PI / 180;
    const startLng = start.lng * Math.PI / 180;
    const endLat = end.lat * Math.PI / 180;
    const endLng = end.lng * Math.PI / 180;

    const y = Math.sin(endLng - startLng) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) -
        Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

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

export const updateNavigationState = (
    currentLocation: Location,
    route: NavigationRoute,
    currentState: NavigationState,
    prevLocation?: Location // Optional for trajectory analysis
): NavigationState => {
    const { steps, startLoc } = route;
    const { currentStepIndex } = currentState;

    // Safety check
    if (!steps || steps.length === 0 || currentStepIndex >= steps.length) {
        return { ...currentState, hasArrived: true };
    }

    const currentStep = steps[currentStepIndex];
    const prevStep = currentStepIndex === 0 ? { endLocation: startLoc } : steps[currentStepIndex - 1];

    // Use startLoc as fallback for first step if prevStep.endLocation is missing
    // Audit Fix: Add currentLocation as final fallback to prevent crash if startLoc is undefined
    const segmentStart = prevStep.endLocation || startLoc || currentLocation;
    const segmentEnd = currentStep.endLocation || (currentStepIndex === steps.length - 1 ? route.destinationLoc : null);

    if (!segmentStart || !segmentEnd) return currentState;

    const distToTarget = getDistanceMeters(currentLocation, segmentEnd);
    const distToSegment = getDistanceToSegmentMeters(currentLocation, segmentStart, segmentEnd);

    const isOffRoute = distToSegment > OFF_ROUTE_THRESHOLD_METERS;

    // GPS DRIFT FIX: Check if we're much closer to the NEXT step than current
    // This handles cases where GPS drift causes the user to miss the exact waypoint
    if (currentStepIndex + 1 < steps.length) {
        const nextStep = steps[currentStepIndex + 1];
        const nextStepEnd = nextStep.endLocation || route.destinationLoc;
        if (nextStepEnd) {
            const distToNextStep = getDistanceMeters(currentLocation, nextStepEnd);
            // If we're significantly closer to the next waypoint (< 50% of current distance),
            // we've clearly passed the current one - advance the step
            if (distToNextStep < distToTarget * 0.5 && distToTarget > STEP_COMPLETION_RADIUS_METERS) {
                return {
                    currentStepIndex: currentStepIndex + 1,
                    distanceToNextStep: distToNextStep,
                    isOffRoute: false,
                    hasArrived: false
                };
            }
        }
    }

    // Check for step completion (standard radius check)
    if (distToTarget < STEP_COMPLETION_RADIUS_METERS) {
        const nextIndex = currentStepIndex + 1;
        if (nextIndex >= steps.length) {
            // Arrived at destination
            return {
                currentStepIndex: steps.length - 1,
                distanceToNextStep: 0,
                isOffRoute: false,
                hasArrived: true
            };
        } else {
            // Advance to next step
            return {
                currentStepIndex: nextIndex,
                distanceToNextStep: getDistanceMeters(currentLocation, steps[nextIndex].endLocation || route.destinationLoc),
                isOffRoute: false,
                hasArrived: false
            };
        }
    }

    return {
        ...currentState,
        distanceToNextStep: distToTarget,
        isOffRoute
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
