import { Location, NavigationRoute } from '../types';

// Constants
const STEP_COMPLETION_RADIUS_METERS = 30; // Within 30m counts as "arrived" at step
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

// Helper to calculate distance from a point to a line segment
const getDistanceToSegmentMeters = (p: Location, a: Location, b: Location): number => {
    const dR = 6371e3;

    // Project P onto line segment AB (using flat approximation for short distances)
    const x = p.lng;
    const y = p.lat;
    const x1 = a.lng;
    const y1 = a.lat;
    const x2 = b.lng;
    const y2 = b.lat;

    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) return getDistanceMeters(p, a);

    const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);

    if (t <= 0) return getDistanceMeters(p, a);
    if (t >= 1) return getDistanceMeters(p, b);

    const projection = {
        lng: x1 + t * dx,
        lat: y1 + t * dy
    };

    return getDistanceMeters(p, projection);
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
    const segmentStart = prevStep.endLocation || startLoc;
    const segmentEnd = currentStep.endLocation || (currentStepIndex === steps.length - 1 ? route.destinationLoc : null);

    if (!segmentEnd) return currentState;

    const distToTarget = getDistanceMeters(currentLocation, segmentEnd);
    const distToSegment = getDistanceToSegmentMeters(currentLocation, segmentStart, segmentEnd);

    const isOffRoute = distToSegment > OFF_ROUTE_THRESHOLD_METERS;

    // Check for step completion
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
