import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getUpcomingManeuverGuidance,
    updateNavigationState,
    formatManeuverDistance,
    extractRoadName,
    inferManeuverType,
    inferManeuverModifier,
    isLocationOffRoute,
    getDistanceToPolylineMeters
} from '../services/navigationEngine.ts';
import { NavigationRoute, RouteStep, Location } from '../types.ts';

// Helper to create synthetic test route
function createMockRoute(): NavigationRoute {
    const step0: RouteStep = {
        instruction: 'Drive north on Santa Fe Drive',
        distance: '500 ft',
        roadName: 'Santa Fe Drive',
        maneuverType: 'depart',
        maneuverModifier: 'straight',
        startLocation: { lat: 35.0500, lng: -78.9000 },
        endLocation: { lat: 35.0514, lng: -78.9000 }
    };

    const step1: RouteStep = {
        instruction: 'Turn left onto McArthur Road',
        distance: '1.2 mi',
        roadName: 'McArthur Road',
        maneuverType: 'turn',
        maneuverModifier: 'left',
        startLocation: { lat: 35.0514, lng: -78.9000 },
        endLocation: { lat: 35.0514, lng: -78.9200 }
    };

    const step2: RouteStep = {
        instruction: 'Continue straight onto Ramsey Street',
        distance: '0.8 mi',
        roadName: 'Ramsey Street',
        maneuverType: 'continue',
        maneuverModifier: 'straight',
        startLocation: { lat: 35.0514, lng: -78.9200 },
        endLocation: { lat: 35.0600, lng: -78.9200 }
    };

    const step3: RouteStep = {
        instruction: 'Arrive at destination on right',
        distance: '0 ft',
        roadName: 'Ramsey Street',
        maneuverType: 'arrive',
        maneuverModifier: 'right',
        startLocation: { lat: 35.0600, lng: -78.9200 },
        endLocation: { lat: 35.0600, lng: -78.9200 }
    };

    const routeGeometry: [number, number][] = [
        [-78.9000, 35.0500],
        [-78.9000, 35.0514],
        [-78.9100, 35.0514],
        [-78.9200, 35.0514],
        [-78.9200, 35.0550],
        [-78.9200, 35.0600]
    ];

    return {
        id: 'test-route-1',
        summary: 'Test Navigation Route',
        steps: [step0, step1, step2, step3],
        totalDistance: '2.1 mi',
        totalTime: '4 min',
        routeGeometry,
        destinationName: 'Fayetteville Regional Destination',
        destinationLoc: { lat: 35.0600, lng: -78.9200 }
    };
}

test('1. Maneuver Lookahead: Step 0 displays upcoming turn onto McArthur Road', () => {
    const route = createMockRoute();
    const guidance = getUpcomingManeuverGuidance(route, {
        currentStepIndex: 0,
        distanceToNextStep: 152.4, // ~500 ft
        remainingDistanceMeters: 3379,
        remainingDurationSeconds: 240,
        isOffRoute: false,
        hasArrived: false
    });

    // While driving on Santa Fe Dr (Step 0), upcoming action is turning onto McArthur Rd
    assert.strictEqual(guidance.instruction, 'Turn left onto McArthur Road');
    assert.strictEqual(guidance.currentRoadName, 'Santa Fe Drive');
    assert.strictEqual(guidance.targetRoadName, 'McArthur Road');
    assert.strictEqual(guidance.maneuverType, 'turn');
    assert.strictEqual(guidance.maneuverModifier, 'left');
    assert.strictEqual(guidance.distanceStr, '500 ft');
    assert.strictEqual(guidance.isArrival, false);
});

test('2. Maneuver Lookahead: Step 1 (cruising McArthur Rd) displays next action ahead, NOT stale turn banner', () => {
    const route = createMockRoute();
    // Driver is cruising down McArthur Road (Step 1)
    const guidance = getUpcomingManeuverGuidance(route, {
        currentStepIndex: 1,
        distanceToNextStep: 1931.2, // ~1.2 mi
        remainingDistanceMeters: 3226,
        remainingDurationSeconds: 210,
        isOffRoute: false,
        hasArrived: false
    });

    // The vehicle is ALREADY on McArthur Road. The banner MUST NOT say "Turn left onto McArthur Road".
    // It must announce the upcoming transition at the end of McArthur Rd into Ramsey Street.
    assert.notStrictEqual(guidance.instruction, 'Turn left onto McArthur Road');
    assert.strictEqual(guidance.instruction, 'Continue straight onto Ramsey Street');
    assert.strictEqual(guidance.currentRoadName, 'McArthur Road');
    assert.strictEqual(guidance.targetRoadName, 'Ramsey Street');
    assert.strictEqual(guidance.maneuverType, 'continue');
    assert.strictEqual(guidance.distanceStr, '1.2 mi');
    assert.strictEqual(guidance.isArrival, false);
});

test('3. Arrival Guidance: Final step approaches destination cleanly', () => {
    const route = createMockRoute();
    const guidance = getUpcomingManeuverGuidance(route, {
        currentStepIndex: 3,
        distanceToNextStep: 5,
        remainingDistanceMeters: 5,
        remainingDurationSeconds: 0,
        isOffRoute: false,
        hasArrived: true
    });

    assert.strictEqual(guidance.isArrival, true);
    assert.match(guidance.instruction.toLowerCase(), /arrive|destination/);
});

test('4. Monotonic Step Progress: GPS jitter backwards does NOT revert step index', () => {
    const route = createMockRoute();
    
    // Initial state on Step 1 (after turning onto McArthur Rd)
    const state0 = {
        currentStepIndex: 1,
        distanceToNextStep: 1800,
        remainingDistanceMeters: 3000,
        remainingDurationSeconds: 180,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 2
    };

    // Forward reading along McArthur Rd
    const pos1: Location = { lat: 35.0514, lng: -78.9080 };
    const state1 = updateNavigationState(pos1, route, state0, undefined, 35);
    assert.strictEqual(state1.currentStepIndex, 1);

    // Jittered reading: GPS temporarily drifts slightly back towards the turn corner
    const jitteredPos: Location = { lat: 35.0514, lng: -78.9010 };
    const stateJitter = updateNavigationState(jitteredPos, route, state1, pos1, 35);

    // Step index MUST remain monotonic (must NOT jump back to 0)
    assert.ok(stateJitter.currentStepIndex >= 1, `Expected step index >= 1, got ${stateJitter.currentStepIndex}`);
});

test('5. Off-Route Detection: Reliable threshold prevents false triggers during lane changes', () => {
    const route = createMockRoute();
    
    // Location 12m away from center line (normal road lane position)
    const onRoadLoc: Location = { lat: 35.0514, lng: -78.9051 };
    const isOff1 = isLocationOffRoute(onRoadLoc, route, 35);
    assert.strictEqual(isOff1, false);

    // Location 95m away (clearly diverged off the planned route corridor)
    const farOffLoc: Location = { lat: 35.0530, lng: -78.9050 };
    const isOff2 = isLocationOffRoute(farOffLoc, route, 35);
    assert.strictEqual(isOff2, true);
});

test('6. Distance Formatting: High-precision rounding and legible units', () => {
    assert.strictEqual(formatManeuverDistance(0), '0 ft');
    assert.strictEqual(formatManeuverDistance(15.24), '50 ft');
    assert.strictEqual(formatManeuverDistance(152.4), '500 ft');
    assert.strictEqual(formatManeuverDistance(804.67), '0.5 mi');
    assert.strictEqual(formatManeuverDistance(1609.34), '1.0 mi');
    assert.strictEqual(formatManeuverDistance(3218.69), '2.0 mi');
});

test('7. Road Name and Maneuver Type Parsing Extraction', () => {
    assert.strictEqual(extractRoadName('Turn left onto McArthur Road'), 'McArthur Road');
    assert.strictEqual(extractRoadName('Continue straight on Ramsey Street then merge'), 'Ramsey Street');
    assert.strictEqual(extractRoadName('Head north on Santa Fe Dr'), 'Santa Fe Dr');

    assert.strictEqual(inferManeuverType('Turn left onto McArthur Road'), 'turn');
    assert.strictEqual(inferManeuverType('Arrive at your destination on right'), 'arrive');
    assert.strictEqual(inferManeuverType('Keep left at the fork'), 'fork');

    assert.strictEqual(inferManeuverModifier('Turn left onto McArthur Road'), 'left');
    assert.strictEqual(inferManeuverModifier('Turn sharp right onto Elm Street'), 'sharp right');
    assert.strictEqual(inferManeuverModifier('Make a U-turn at 1st Ave'), 'uturn');
});

test('8. Polyline-Anchored Step Alignment: Aligns stranded step 0 forward to active vehicle position', () => {
    const route = createMockRoute();
    // Vehicle is mid-route along Ramsey Street (step 2), but state is initialized with step 0 (e.g. after route switch or recalculation)
    const midRouteLoc: Location = { lat: 35.0560, lng: -78.9200 };
    const strandedState = {
        currentStepIndex: 0,
        distanceToNextStep: 0,
        remainingDistanceMeters: 3379,
        remainingDurationSeconds: 240,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 0
    };

    const updatedState = updateNavigationState(midRouteLoc, route, strandedState, undefined, 35);

    // Vehicle is on Ramsey Street (step 2), so step index must NOT be stranded at 0
    assert.strictEqual(updatedState.currentStepIndex, 2, `Expected step index to align to 2, got ${updatedState.currentStepIndex}`);
    assert.strictEqual(updatedState.isOffRoute, false);
    assert.ok(updatedState.splitIndex && updatedState.splitIndex >= 3, `Expected splitIndex >= 3, got ${updatedState.splitIndex}`);
});

test('9. Unified Guidance Synchronization: Maneuver instruction accurately reflects aligned step', () => {
    const route = createMockRoute();
    const midRouteLoc: Location = { lat: 35.0560, lng: -78.9200 };
    const strandedState = {
        currentStepIndex: 0,
        distanceToNextStep: 0,
        remainingDistanceMeters: 3379,
        remainingDurationSeconds: 240,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 0
    };

    const alignedState = updateNavigationState(midRouteLoc, route, strandedState, undefined, 35);
    const guidance = getUpcomingManeuverGuidance(route, alignedState);

    // Active road is Ramsey Street; next upcoming action is arrival at destination
    assert.strictEqual(guidance.currentRoadName, 'Ramsey Street');
    assert.match(guidance.instruction.toLowerCase(), /arrive|destination/);
    assert.ok(!/mcarthur/i.test(guidance.instruction), `Expected instruction not to mention mcarthur, got: ${guidance.instruction}`);
    assert.ok(!/santa fe/i.test(guidance.instruction), `Expected instruction not to mention santa fe, got: ${guidance.instruction}`);
});

test('10. Maneuver Snap: Threshold ~25ft (8m) transitions to next step without holding 0 ft', () => {
    const route = createMockRoute();
    // Step 0 ends at { lat: 35.0514, lng: -78.9000 }
    // Position car ~6 meters south of turn intersection
    const nearTurnLoc: Location = { lat: 35.05135, lng: -78.9000 };
    const state0 = {
        currentStepIndex: 0,
        distanceToNextStep: 25,
        remainingDistanceMeters: 3379,
        remainingDurationSeconds: 240,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 1
    };

    // Even if vehicle is crawling at 2 mph, distToTarget <= 8m forces step transition to step 1
    const updated = updateNavigationState(nearTurnLoc, route, state0, undefined, 2);
    assert.strictEqual(updated.currentStepIndex, 1, `Expected step index to advance to 1 at turn waypoint, got ${updated.currentStepIndex}`);
    assert.strictEqual(updated.hasArrived, false);
});

test('11. Distance Formatting Consistency: Standardizes ft and mi, clamps pending maneuver from 0 ft', () => {
    // Zero / negative distance
    assert.strictEqual(formatManeuverDistance(0, false), '0 ft');
    assert.strictEqual(formatManeuverDistance(0, true), '0 ft');
    
    // Distances under MANEUVER_COMPLETE_THRESHOLD_METERS (8m) clamp to 25 ft for pending turn
    assert.strictEqual(formatManeuverDistance(5, false), '25 ft');
    assert.strictEqual(formatManeuverDistance(7, false), '25 ft');
    
    // Arrival allows 0 ft
    assert.strictEqual(formatManeuverDistance(3, true), '0 ft');

    // Standard intervals
    assert.strictEqual(formatManeuverDistance(30.48), '100 ft');
    assert.strictEqual(formatManeuverDistance(152.4), '500 ft');
    assert.strictEqual(formatManeuverDistance(804.67), '0.5 mi');
    assert.strictEqual(formatManeuverDistance(1609.34), '1.0 mi');

    // Verify no 'feet' or 'miles' in strings
    const samples = [0, 5, 20, 100, 500, 1200, 3000].map(m => formatManeuverDistance(m));
    for (const str of samples) {
        assert.ok(!/feet/i.test(str), `String should use 'ft', not 'feet': ${str}`);
        assert.ok(!/miles/i.test(str), `String should use 'mi', not 'miles': ${str}`);
    }
});

test('12. Anti-Shortcut Polyline Bounding: Search window clamps forward search during active routing', () => {
    // Mock geometry of 60 points spaced ~20m apart
    const geometry: [number, number][] = [];
    for (let i = 0; i < 60; i++) {
        geometry.push([-78.9000 - i * 0.0002, 35.0500]);
    }

    // Vehicle is at index 5, searching from index 5
    const vehicleLoc: Location = { lat: 35.0500, lng: -78.9000 - 5 * 0.0002 };
    const res = getDistanceToPolylineMeters(vehicleLoc, geometry, 5);
    assert.ok(Math.abs(res.nearestIndex - 5) <= 1, `Expected segment nearest index near 5, got ${res.nearestIndex}`);

    // Suppose a parallel road loops near index 55 (e.g. 35 meters away)
    // Vehicle is at index 10, but is 35m from point 55
    const nearLoopLoc: Location = { lat: 35.0503, lng: -78.9000 - 10 * 0.0002 };
    const resActive = getDistanceToPolylineMeters(nearLoopLoc, geometry, 10);
    // Because active search is clamped to searchCenterIndex + 40 (i.e. <= 50),
    // it will NOT jump to index 55
    assert.ok(resActive.nearestIndex <= 50, `Expected nearestIndex <= 50, got ${resActive.nearestIndex}`);
});

test('13. Strict Destination Geofence Decoupling: High speed pass-by does not trigger arrival', () => {
    const route = createMockRoute();
    // Destination is at { lat: 35.0600, lng: -78.9200 }
    // Vehicle passes 40m away at 45 mph
    const passByLoc: Location = { lat: 35.06036, lng: -78.9200 }; // ~40m north
    const stateAtFinalStep = {
        currentStepIndex: 3, // final step
        distanceToNextStep: 40,
        remainingDistanceMeters: 40,
        remainingDurationSeconds: 2,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 4
    };

    // Even at 45 mph (where completionRadius is 80m), arrival must NOT trigger because dist > 25m
    const updated = updateNavigationState(passByLoc, route, stateAtFinalStep, undefined, 45);
    assert.strictEqual(updated.hasArrived, false, 'Expected hasArrived to be false when 40m away at 45mph');

    // When vehicle is within 18m and slowed to 1.5 m/s (~3.3 mph)
    const arrivalLoc: Location = { lat: 35.06015, lng: -78.9200 }; // ~16m away
    const updatedArrived = updateNavigationState(arrivalLoc, route, stateAtFinalStep, undefined, 3);
    assert.strictEqual(updatedArrived.hasArrived, true, 'Expected hasArrived to be true within 25m at slow speed');
});


