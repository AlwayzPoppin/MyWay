import { useState, useEffect, useRef, useCallback } from 'react';
import { FamilyMember, Place, NavigationRoute, ArrivalTripData, Location, RouteWaypoint } from '../types';
import { getDistanceMeters } from '../utils/geo';
import { getRouteFromOSRM, geocodePlace, fetchRouteOptions, clearRouteCache } from '../services/osrmService';
import { searchGasStations, searchCoffeeShops, searchRestaurants, searchGroceryStores, searchPlacesText, searchMaintenanceAlongRoute, searchGasStationsAlongRoute } from '../services/placesService';
import { updateNavigationState, NavigationState, analyzeDrivingBehavior, ARRIVAL_RADIUS_METERS, ARRIVAL_APPROACH_RADIUS_METERS, ARRIVAL_SPEED_THRESHOLD_MPS, ARRIVAL_CONSECUTIVE_TICKS, getUpcomingManeuverGuidance, UpcomingManeuverGuidance } from '../services/navigationEngine';
import { geolocationService } from '../services/geolocationService';

export { ARRIVAL_RADIUS_METERS, ARRIVAL_SPEED_THRESHOLD_MPS, ARRIVAL_CONSECUTIVE_TICKS };
import { startTrip, resumeTrip, getActiveTrip, recordTripPoint, recordDriveEvent, endTrip } from '../services/tripHistoryService';
import { startCrashMonitoring, stopCrashMonitoring, updateCrashDetectionSpeed } from '../services/crashDetectionService';
import { triggerSOS, clearSOS, updateMemberTrip } from '../services/authService';
import { audioService } from '../services/audioService';
import { speechService, ManeuverProximity } from '../services/speechService';
import { offlineMapService } from '../services/offlineMapService';
import { searchHistoryService } from '../services/searchHistoryService';
import { convoyService } from '../services/convoyService';
import { maintenanceAlertService, VehicleHealthItem } from '../services/maintenanceAlertService';
import { findDeadZonesIntersectingRoute, syncDeadZoneTiles } from '../services/offlineLocationBuffer';
import { placeCorrectionService } from '../services/placeCorrectionService';
import { syncNavigationTelemetry, clearNavigation, onCarNavigationCancelled, notifyArrival } from '../services/androidAutoService';
import { LiveTripFuelTracker, LiveFuelSnapshot, vehicleFuelService, LowFuelAlert } from '../services/vehicleFuelService';
import { fetchGoogleTrafficRouteOptions } from '../services/googleTrafficRoutingService';

export type { LowFuelAlert };

export interface BetterRouteSuggestion {
    route: NavigationRoute;
    timeSavedMin: number;
    savingsLabel: string;
    reason: string;
}

export interface UpcomingTollAlert {
    tollName: string;
    estimatedToll: number;
    distanceMeters: number;
    stepIndex: number;
}

export interface LeaderDivertedPrompt {
    leaderName: string;
    leaderId: string;
    newRoute: NavigationRoute;
    reason: string;
    timeRemainingSeconds: number;
    timestamp: number;
}

export interface AmbientMaintenanceAdvisory {
    item: VehicleHealthItem;
    places: Place[];
    recommendedPlace: Place;
    title: string;
    description: string;
}

export interface MultiStopArrivalState {
    stop: RouteWaypoint;
    stopNumber: number;
    totalStops: number;
    phase: 'approaching' | 'arrived';
}

/** Returns the route's forward bearing near the vehicle when GPS has not yet supplied one. */
const getRouteForwardBearing = (
    currentLocation: { lat: number; lng: number } | null,
    routeGeometry?: [number, number][]
): number | undefined => {
    if (!currentLocation || !routeGeometry || routeGeometry.length < 2) return undefined;

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    routeGeometry.forEach(([lng, lat], index) => {
        const distance = getDistanceMeters(currentLocation, { lat, lng });
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });

    const from = routeGeometry[nearestIndex];
    const to = routeGeometry.slice(nearestIndex + 1).find(([lng, lat]) =>
        getDistanceMeters({ lat: from[1], lng: from[0] }, { lat, lng }) >= 5
    );
    if (!to) return undefined;

    const lat1 = from[1] * Math.PI / 180;
    const lat2 = to[1] * Math.PI / 180;
    const deltaLng = (to[0] - from[0]) * Math.PI / 180;
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

export const useNavigation = (
    user: any,
    profile: any,
    speedAlertsEnabled: boolean,
    members: FamilyMember[],
    userLocation: { lat: number, lng: number } | null,
    showNotification: (msg: string, duration?: number) => void,
    setDriveMode: (val: boolean) => void,
    set3DMode: (val: boolean) => void,
    setCrashCountdown: (val: number | null) => void,
    setEtaSharing: (val: boolean) => void,
    userPlaces: any[],
    setDiscoveredPlaces: (places: Place[]) => void,
    safetyScore: number,
    startSearchTransition: (callback: () => void) => void
) => {
    const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
    const [alternativeRoutes, setAlternativeRoutes] = useState<NavigationRoute[]>([]);
    const [activeRouteIndex, setActiveRouteIndex] = useState<number>(0);
    const [isRecalculatingRoutes, setIsRecalculatingRoutes] = useState<boolean>(false);
    const [betterRouteSuggestion, setBetterRouteSuggestion] = useState<BetterRouteSuggestion | null>(null);
    const [upcomingTollAlert, setUpcomingTollAlert] = useState<UpcomingTollAlert | null>(null);
    const [leaderDivertedPrompt, setLeaderDivertedPrompt] = useState<LeaderDivertedPrompt | null>(null);
    const leaderPromptTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearLeaderPromptTimer = useCallback(() => {
        if (leaderPromptTimerRef.current) {
            clearInterval(leaderPromptTimerRef.current);
            leaderPromptTimerRef.current = null;
        }
    }, []);
    const lastRerouteCheckTimeRef = useRef<number>(0);
    const lastTollAnnouncedStepRef = useRef<number>(-1);
    const [navState, setNavState] = useState<NavigationState>({
        currentStepIndex: 0,
        distanceToNextStep: 0,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 0
    });
    const [upcomingGuidance, setUpcomingGuidance] = useState<UpcomingManeuverGuidance | null>(null);
    const [approachingTripData, setApproachingTripData] = useState<ArrivalTripData | null>(null);
    const [completedTripData, setCompletedTripData] = useState<ArrivalTripData | null>(null);
    const [multiStopArrival, setMultiStopArrival] = useState<MultiStopArrivalState | null>(null);
    const [isNavigating, setIsNavigating] = useState(false);
    const [liveSpeedMph, setLiveSpeedMph] = useState(0);
    const navStateRef = useRef<NavigationState>(navState);
    // Maneuver Voice Guidance State Lock & Debounce:
    // Tracks current step and set of proximity stages announced to prevent repeated audio spam
    const maneuverAnnounceLockRef = useRef<{
        stepIndex: number;
        announcedStages: Set<ManeuverProximity>;
        lastSpokenTime: number;
    }>({
        stepIndex: -1,
        announcedStages: new Set(),
        lastSpokenTime: 0
    });
    const currentSpeedRef = useRef<number>(0);
    const lastSpeedWarningTimeRef = useRef<number>(0);
    const lastCameraAlertStepRef = useRef<number>(-1);
    const navigationStartTimeRef = useRef<number>(0);
    const isRecalculatingRef = useRef<boolean>(false);
    const lastOffRouteRecalcTimeRef = useRef<number>(0);
    const offRouteTicksRef = useRef<number>(0);
    const arrivalCandidateTicksRef = useRef<number>(0);
    const approachPromptRouteRef = useRef<string | null>(null);
    const stopApproachPromptRef = useRef<string | null>(null);
    const lastRerouteRef = useRef<number>(0);
    const rerouteAttemptsRef = useRef<number>(0);
    const MAX_REROUTE_ATTEMPTS = 3;
    const userLocationRef = useRef(userLocation);
    userLocationRef.current = userLocation;
    const membersRef = useRef(members);
    membersRef.current = members;
    const activeRouteRef = useRef(activeRoute);
    activeRouteRef.current = activeRoute;
    const showNotificationRef = useRef(showNotification);
    showNotificationRef.current = showNotification;
    const lastOrientationChangeTimeRef = useRef<number>(0);
    const lastRecalculatedOriginRef = useRef<{ lat: number; lng: number } | null>(null);
    const lastRecalculatedDestRef = useRef<string | null>(null);
    const fuelTrackerRef = useRef<LiveTripFuelTracker | null>(null);
    const lastFuelTickTimeRef = useRef<number>(0);
    const lastBehaviorSpeedMpsRef = useRef<number | null>(null);
    const lastBehaviorTimestampRef = useRef<number>(0);
    const lastDriveEventTimeRef = useRef<{ hard_brake: number; rapid_accel: number }>({ hard_brake: 0, rapid_accel: 0 });
    const speedingEpisodeRef = useRef<{ startedAt: number | null; speedLimit: number | null; recorded: boolean }>({ startedAt: null, speedLimit: null, recorded: false });
    const speedAlertEpisodeRef = useRef<{ startedAt: number | null; speedLimit: number | null }>({ startedAt: null, speedLimit: null });
    const [liveFuelSnapshot, setLiveFuelSnapshot] = useState<LiveFuelSnapshot | null>(null);
    const [lowFuelAlert, setLowFuelAlert] = useState<LowFuelAlert | null>(null);
    const [fuelUpdatePromptNonce, setFuelUpdatePromptNonce] = useState<number>(0);
    const hasAnnouncedLowFuelRef = useRef<boolean>(false);
    const [pendingTripResume, setPendingTripResume] = useState<{ destinationName: string; destinationLoc: Location } | null>(null);
    const [isResumingTrip, setIsResumingTrip] = useState(false);

    useEffect(() => {
        const activeTrip = getActiveTrip();
        if (!activeTrip?.destinationName || !activeTrip.destinationLocation) return;
        setPendingTripResume({
            destinationName: activeTrip.destinationName,
            destinationLoc: activeTrip.destinationLocation
        });
    }, []);

    useEffect(() => {
        navStateRef.current = navState;
    }, [navState]);

    // Track device orientation changes and window resizes to prevent transient sensor fluctuations
    // during device rotation sweeps from triggering spurious off-route route recalculation loops.
    useEffect(() => {
        const handleOrientationOrResize = () => {
            lastOrientationChangeTimeRef.current = Date.now();
        };
        window.addEventListener('resize', handleOrientationOrResize, { passive: true });
        window.addEventListener('orientationchange', handleOrientationOrResize, { passive: true });
        if (typeof screen !== 'undefined' && screen.orientation) {
            screen.orientation.addEventListener('change', handleOrientationOrResize, { passive: true });
        }
        return () => {
            window.removeEventListener('resize', handleOrientationOrResize);
            window.removeEventListener('orientationchange', handleOrientationOrResize);
            if (typeof screen !== 'undefined' && screen.orientation) {
                screen.orientation.removeEventListener('change', handleOrientationOrResize);
            }
        };
    }, []);

    const getActiveUserLocation = useCallback((): { lat: number; lng: number } => {
        // Priority 1: Live GPS from useLocationSync
        if (userLocation && userLocation.lat !== 0 && userLocation.lng !== 0 && !isNaN(userLocation.lat) && !isNaN(userLocation.lng)) {
            console.log(`📍 [Search] Using live userLocation: (${userLocation.lat}, ${userLocation.lng})`);
            return userLocation;
        }

        // Priority 2: Authenticated user's member entry
        if (user?.uid) {
            const self = members.find(m => m.id === user.uid);
            if (self && self.location && self.location.lat !== 0 && self.location.lng !== 0 && !isNaN(self.location.lat) && !isNaN(self.location.lng)) {
                console.log(`📍 [Search] Using self member location (uid=${user.uid}): (${self.location.lat}, ${self.location.lng})`);
                return self.location;
            }
        }

        // Priority 3: Any active family member with valid coordinates
        const activeMember = members.find(m => m.location && m.location.lat !== 0 && m.location.lng !== 0 && !isNaN(m.location.lat) && !isNaN(m.location.lng));
        if (activeMember) {
            console.log(`📍 [Search] Using active member "${activeMember.name}" location: (${activeMember.location.lat}, ${activeMember.location.lng})`);
            return activeMember.location;
        }

        // Priority 4: Last known location from localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
            const saved = window.localStorage.getItem('myway_last_known_location');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number' && parsed.lat !== 0 && parsed.lng !== 0) {
                        console.log(`📍 [Search] Using localStorage last known: (${parsed.lat}, ${parsed.lng})`);
                        return parsed;
                    }
                } catch (e) { /* ignore */ }
            }
        }

        // Priority 5: Default coordinates fallback (only if browser/device denied location permissions and no prior cache exists)
        console.warn(`📍 [Search] Live location unavailable — using default fallback center (35.105, -78.966)`);
        return { lat: 35.105, lng: -78.966 };
    }, [userLocation, members, user?.uid]);

    const handleStartNavigation = useCallback(async (
        dest: string,
        destCoords?: { lat: number; lng: number },
        precomputedRoute?: NavigationRoute,
        resumeActiveTrip = false
    ) => {
        try {
            showNotification(`🧭 Preparing navigation...`, 5000);

            // Explicitly pull fresh, live GPS coordinates for the trip origin
            const liveOrigin = getActiveUserLocation();
            if (liveOrigin.lat === 0 && liveOrigin.lng === 0) {
                showNotification("⚠️ Waiting for GPS lock...", 4000);
                return;
            }

            // Use provided coordinates if available, otherwise geocode the destination string from fresh live GPS
            const destLocation = destCoords || precomputedRoute?.destinationLoc || await geocodePlace(dest, liveOrigin);
            if (!destLocation) {
                showNotification("❌ Destination not found.", 4000);
                return;
            }

            // Stale route protection: If a precomputed route is provided, verify that the vehicle has not moved
            // away from the preview origin. If offset by > 40m, purge precomputed route to prevent routing from stale position.
            let route: NavigationRoute | null = null;
            if (precomputedRoute && precomputedRoute.startLoc) {
                const distFromPreviewOrigin = getDistanceMeters(liveOrigin, precomputedRoute.startLoc);
                if (distFromPreviewOrigin <= 40) {
                    route = precomputedRoute;
                } else {
                    console.log(`📍 [useNavigation] Vehicle offset by ${Math.round(distFromPreviewOrigin)}m from preview origin. Recalculating from live GPS.`);
                }
            }

            clearRouteCache();
            const allOptions = await fetchRouteOptions(liveOrigin, dest, destLocation, { bypassCache: true });
            if (!route) {
                route = allOptions.length > 0 ? allOptions[0] : null;
            } else {
                const exists = allOptions.some(r => r.id === route!.id || r.summary === route!.summary);
                if (!exists) {
                    allOptions.unshift(route);
                }
            }

            if (!route || !route.steps) {
                showNotification("❌ Routing failed.", 4000);
                return;
            }

            setAlternativeRoutes(allOptions);
            const foundIdx = allOptions.findIndex(r => r.id === route!.id || r.summary === route!.summary);
            setActiveRouteIndex(foundIdx !== -1 ? foundIdx : 0);

            // Purge stale recalculation flags from any previously aborted trip
            isRecalculatingRef.current = false;
            lastOffRouteRecalcTimeRef.current = 0;
            offRouteTicksRef.current = 0;
            lastRerouteRef.current = 0;
            rerouteAttemptsRef.current = 0;
            lastRecalculatedOriginRef.current = { ...liveOrigin };
            lastRecalculatedDestRef.current = `${route.destinationName || dest}_${destLocation.lat.toFixed(5)}_${destLocation.lng.toFixed(5)}`;

            // Record to recent search & navigation history
            searchHistoryService.addItem({
                query: dest,
                name: route.destinationName || dest,
                location: destLocation
            });

            // Attach storefront photo and entrance guidance if available
            const matchingPlace = userPlaces.find(p => 
                p.name.toLowerCase() === dest.toLowerCase() || 
                (destLocation && getDistanceMeters(p.location, destLocation) < 200)
            );
            const correction = matchingPlace 
                ? placeCorrectionService.getCorrection(matchingPlace) 
                : placeCorrectionService.getCorrection({
                    id: '',
                    name: dest,
                    location: destLocation,
                    radius: 0.3,
                    type: 'search_result',
                    icon: '📍'
                });

            if (correction) {
                route.destinationImageUrl = correction.imageUrl || matchingPlace?.imageUrl;
                route.destinationEntranceNotes = correction.entranceNotes || matchingPlace?.entranceNotes;
                route.destinationEntranceType = correction.entranceType || matchingPlace?.entranceType;
            } else if (matchingPlace) {
                route.destinationImageUrl = matchingPlace.imageUrl;
                route.destinationEntranceNotes = matchingPlace.entranceNotes;
                route.destinationEntranceType = matchingPlace.entranceType;
            }
            route.destinationPlaceId = matchingPlace?.id;
            route.destinationNeedsBuildingPhoto = Boolean(matchingPlace?.needsBuildingPhoto && !matchingPlace.imageUrl);
            allOptions.forEach(option => {
                option.destinationImageUrl = route.destinationImageUrl;
                option.destinationEntranceNotes = route.destinationEntranceNotes;
                option.destinationEntranceType = route.destinationEntranceType;
                option.destinationPlaceId = route.destinationPlaceId;
                option.destinationNeedsBuildingPhoto = route.destinationNeedsBuildingPhoto;
            });

            navigationStartTimeRef.current = Date.now();
            approachPromptRouteRef.current = null;
            setApproachingTripData(null);
            activeRouteRef.current = route;
            setActiveRoute(route);
            const initialNav = updateNavigationState(liveOrigin, route, {
                currentStepIndex: 0,
                distanceToNextStep: 0,
                isOffRoute: false,
                hasArrived: false,
                splitIndex: 0
            });
            const initialGuidance = getUpcomingManeuverGuidance(route, initialNav);
            setNavState(initialNav);
            navStateRef.current = initialNav;
            setUpcomingGuidance(initialGuidance);
            setDriveMode(true);
            setIsNavigating(true);
            set3DMode(true);

            if (resumeActiveTrip) {
                resumeTrip(liveOrigin, dest);
            } else {
                startTrip(liveOrigin, dest, destCoords);
            }

            // Initialize live fuel consumption tracker
            fuelTrackerRef.current = new LiveTripFuelTracker();
            lastFuelTickTimeRef.current = Date.now();
            setLiveFuelSnapshot(fuelTrackerRef.current.getSnapshot());

            // Check low fuel & low battery readiness for this trip
            const tripDistanceMiles = route.distanceMeters
                ? route.distanceMeters / 1609.344
                : (parseFloat(route.totalDistance) || 0);

            hasAnnouncedLowFuelRef.current = false;
            const tripFuelAlert = vehicleFuelService.checkLowFuelAlert(tripDistanceMiles);
            if (tripFuelAlert) {
                setLowFuelAlert(tripFuelAlert);
                hasAnnouncedLowFuelRef.current = true;

                // Deliver spoken alert after initial maneuver announcement
                setTimeout(() => {
                    speechService.speak(tripFuelAlert.spokenPrompt, { chime: 'turn' });
                }, 2000);

                showNotification(
                    `${tripFuelAlert.fuelType === 'electric' ? '⚡' : '⛽'} ${tripFuelAlert.title}: ${tripFuelAlert.message}`,
                    7000
                );

                // Proactively search corridor gas stations / EV chargers along route
                searchGasStationsAlongRoute(route.routeGeometry, liveOrigin, tripFuelAlert.fuelType === 'electric')
                    .then(stations => {
                        if (stations && stations.length > 0) {
                            setLowFuelAlert(prev => prev ? {
                                ...prev,
                                gasStations: stations,
                                recommendedGasStation: stations[0]
                            } : null);
                        }
                    })
                    .catch(err => console.warn('[useNavigation] Failed to fetch corridor gas stations:', err));
            } else {
                setLowFuelAlert(null);
            }

            // Announce initial route start
            if (route.steps.length > 0) {
                const firstStep = route.steps[0];
                const rawDist = parseFloat(firstStep.distance.replace(/[^0-9.]/g, '')) || 50;
                const distM = firstStep.distance.includes('mi') ? rawDist * 1609 : firstStep.distance.includes('ft') ? rawDist * 0.3048 : rawDist;
                const initialFt = Math.round(distM * 3.28084);

                speechService.announceManeuver(firstStep.instruction, distM, 'initial', dest);

                const initialStages = new Set<ManeuverProximity>();
                if (initialFt <= 5280) initialStages.add('preparatory');
                if (initialFt <= 1200) initialStages.add('mid');
                if (initialFt <= 300) initialStages.add('immediate');

                maneuverAnnounceLockRef.current = {
                    stepIndex: 0,
                    announcedStages: initialStages,
                    lastSpokenTime: Date.now()
                };
            }

            startCrashMonitoring(
                (crashLoc, impact) => {
                    if (user && profile?.familyCircleId) {
                        triggerSOS(profile.familyCircleId, user.uid, crashLoc, impact);
                        const alertMsg = impact
                            ? `🚨 CRASH SOS SENT (${impact.gForce}G Impact @ ${impact.speed} mph)!`
                            : '🚨 CRASH SOS SENT!';
                        showNotification(alertMsg, 10000);
                    }
                    setCrashCountdown(null);
                },
                (remaining) => setCrashCountdown(remaining),
                () => {
                    setCrashCountdown(null);
                    showNotification('✅ Crash alert cancelled.', 5000);
                },
                () => {
                    const loc = userLocation || liveOrigin;
                    if (loc && loc.lat !== 0 && loc.lng !== 0) {
                        recordDriveEvent('hard_brake', loc);
                        fuelTrackerRef.current?.recordDriveEvent('hard_brake');
                        showNotification('⚠️ Hard braking detected', 2500);
                    }
                },
                () => {
                    const loc = userLocation || liveOrigin;
                    if (loc && loc.lat !== 0 && loc.lng !== 0) {
                        recordDriveEvent('rapid_accel', loc);
                        fuelTrackerRef.current?.recordDriveEvent('rapid_accel');
                        showNotification('⚡ Rapid acceleration detected', 2500);
                    }
                },
                () => currentSpeedRef.current
            );

            if (profile?.familyCircleId && user?.uid && route) {
                setEtaSharing(true);
                updateMemberTrip(profile.familyCircleId, user.uid, {
                    destinationName: route.destinationName || dest,
                    totalTime: route.totalTime,
                    totalDistance: route.totalDistance,
                    destinationCoords: destLocation,
                    etaTimestamp: Date.now() + ((route.durationMinutes || 10) * 60 * 1000)
                }).catch(err => console.warn('Could not sync trip ETA to circle:', err));
            }

            // Proactive corridor tile prefetching for offline dead-zone resilience
            if (route.routeGeometry && route.routeGeometry.length > 0) {
                let north = -90, south = 90, east = -180, west = 180;
                let validCount = 0;
                for (const pt of route.routeGeometry) {
                    const lat = Array.isArray(pt) ? pt[1] : (pt as any)?.lat;
                    const lng = Array.isArray(pt) ? pt[0] : (pt as any)?.lng;
                    if (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng)) {
                        if (lat > north) north = lat;
                        if (lat < south) south = lat;
                        if (lng > east) east = lng;
                        if (lng < west) west = lng;
                        validCount++;
                    }
                }
                if (validCount > 0 && north >= south && east >= west) {
                    const corridorBounds = {
                        north: Math.min(north + 0.015, 85),
                        south: Math.max(south - 0.015, -85),
                        east: Math.min(east + 0.015, 180),
                        west: Math.max(west - 0.015, -180)
                    };
                    offlineMapService.downloadArea('Active Route Corridor', corridorBounds, 12, 14).catch(err => {
                        console.warn('[useNavigation] Background route corridor tile cache notice:', err);
                    });
                }
            }
        } catch (error) {
            console.error("Navigation startup error:", error);
            showNotification("❌ Navigation failed.", 3000);
        }
    }, [members, user, profile, showNotification, setDriveMode, set3DMode, setCrashCountdown, setEtaSharing, userLocation, getActiveUserLocation, userPlaces]);

    /**
     * Recalculates the active route forward from fresh, live GPS coordinates and driver heading.
     * Biases the route forward along the driver's current path of travel rather than prompting U-turns.
     * Purges passed waypoints and clears route cache without resetting trip timer.
     */
    const recalculateRoute = useCallback(async (customOrigin?: { lat: number; lng: number }): Promise<NavigationRoute | null> => {
        const route = activeRouteRef.current;
        if (!route || !route.destinationLoc) {
            console.warn('⚠️ [recalculateRoute] No active destination to recalculate.');
            return null;
        }

        // Pull fresh live GPS coordinates explicitly
        const liveOrigin = customOrigin || getActiveUserLocation();
        if (liveOrigin.lat === 0 && liveOrigin.lng === 0) {
            console.warn('⚠️ [recalculateRoute] Live location unavailable for recalculation.');
            return null;
        }

        // Strict decouple from screen resize / rotation events:
        // Route should only evaluate when destination or currentLocation significantly changes (> 20m), NEVER when screen rotates.
        const destKey = `${route.destinationName}_${route.destinationLoc.lat.toFixed(5)}_${route.destinationLoc.lng.toFixed(5)}`;
        const prevOrigin = lastRecalculatedOriginRef.current;
        const prevDest = lastRecalculatedDestRef.current;

        if (!customOrigin && prevOrigin && prevDest === destKey && getDistanceMeters(prevOrigin, liveOrigin) < 20) {
            console.log('📍 [recalculateRoute] Vehicle has not moved significantly (<20m) from previous calculation. Skipping redundant route recalculation.');
            return route;
        }

        // Extract live heading of driver to bias route forward
        const currentMembers = membersRef.current;
        const selfMember = currentMembers.find(m => m.id === user?.uid);
        const liveHeading = typeof selfMember?.heading === 'number' && !isNaN(selfMember.heading)
            ? selfMember.heading
            : undefined;

        console.log(`🔄 [recalculateRoute] Recalculating forward route from live GPS (${liveOrigin.lat}, ${liveOrigin.lng}) heading ${liveHeading ?? 'auto'} to ${route.destinationName}`);
        showNotificationRef.current('🔄 Recalculating route forward...', 3000);
        speechService.playChime('reroute');

        // Purge route cache so routing engines don't return a stale snapshot
        clearRouteCache();

        // Stale Waypoint State Purge:
        // Filter out intermediate stops that were already reached/passed (currentLegIndex)
        // Keep only remaining pending stops so phantom past stops never bias the route
        const currentLeg = route.currentLegIndex || 0;
        const remainingWaypoints = (route.waypoints || []).slice(currentLeg);

        try {
            isRecalculatingRef.current = true;
            const options: any = {
                bypassCache: true,
                heading: liveHeading,
                continueStraight: true,
                isReroute: true
            };
            if (remainingWaypoints.length > 0) {
                options.waypoints = remainingWaypoints;
            }
            if (route.avoidTolls) {
                options.avoidTolls = true;
            }

            const allFreshRoutes = await fetchRouteOptions(
                liveOrigin,
                route.destinationName,
                route.destinationLoc,
                options
            );
            const freshRoute = allFreshRoutes.length > 0 ? allFreshRoutes[0] : null;

            isRecalculatingRef.current = false;
            offRouteTicksRef.current = 0;

            if (freshRoute && freshRoute.steps && freshRoute.steps.length > 0) {
                freshRoute.destinationImageUrl = route.destinationImageUrl;
                freshRoute.destinationPlaceId = route.destinationPlaceId;
                freshRoute.destinationNeedsBuildingPhoto = route.destinationNeedsBuildingPhoto;
                freshRoute.destinationEntranceNotes = route.destinationEntranceNotes;
                freshRoute.destinationEntranceType = route.destinationEntranceType;
                freshRoute.waypoints = remainingWaypoints;
                freshRoute.currentLegIndex = 0;

                allFreshRoutes.forEach(r => {
                    r.destinationImageUrl = route.destinationImageUrl;
                    r.destinationPlaceId = route.destinationPlaceId;
                    r.destinationNeedsBuildingPhoto = route.destinationNeedsBuildingPhoto;
                    r.destinationEntranceNotes = route.destinationEntranceNotes;
                    r.destinationEntranceType = route.destinationEntranceType;
                });
                setAlternativeRoutes(allFreshRoutes);
                activeRouteRef.current = freshRoute;
                setActiveRoute(freshRoute);
                setActiveRouteIndex(0);
                lastRecalculatedOriginRef.current = { ...liveOrigin };
                lastRecalculatedDestRef.current = destKey;
                const freshNav = updateNavigationState(liveOrigin, freshRoute, {
                    currentStepIndex: 0,
                    distanceToNextStep: 0,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex: 0
                });
                const freshGuidance = getUpcomingManeuverGuidance(freshRoute, freshNav);
                setNavState(freshNav);
                navStateRef.current = freshNav;
                setUpcomingGuidance(freshGuidance);

                if (freshRoute.steps[0]) {
                    showNotificationRef.current(`🧭 Route recalculated: ${freshRoute.steps[0].instruction}`, 5000);
                }

                // Reset speech maneuver locks to re-prompt first turn cleanly
                const firstStep = freshRoute.steps[0];
                if (firstStep) {
                    const rawDist = freshRoute.steps[0].distance || '0';
                    const distValue = parseFloat(rawDist.replace(/[^0-9.]/g, '')) || 0;
                    const isKm = rawDist.toLowerCase().includes('km');
                    const meters = isKm ? distValue * 1000 : (rawDist.toLowerCase().includes('mi') ? distValue * 1609.34 : distValue * 0.3048);
                    const ft = Math.round(meters * 3.28084);
                    const rerouteStages = new Set<ManeuverProximity>();
                    if (ft <= 1200) rerouteStages.add('preparatory');
                    if (ft <= 300) rerouteStages.add('mid');

                    maneuverAnnounceLockRef.current = {
                        stepIndex: 0,
                        announcedStages: rerouteStages,
                        lastSpokenTime: Date.now()
                    };
                } else {
                    maneuverAnnounceLockRef.current = {
                        stepIndex: 0,
                        announcedStages: new Set(),
                        lastSpokenTime: Date.now()
                    };
                }
                showNotificationRef.current(`🔀 Rerouted forward via ${freshRoute.summary || 'fastest path'}`, 3500);

                // Hive-Mind Fleet Routing: If current user is Convoy Leader, broadcast reroute to caravan followers
                const activeConvoy = convoyService.getActiveConvoy();
                const currentUid = user?.uid || currentMembers[0]?.id || 'self';
                if (activeConvoy && activeConvoy.isActive && activeConvoy.leaderId === currentUid) {
                    convoyService.broadcastReroute(freshRoute, profile?.familyCircleId);
                    showNotificationRef.current(`📡 Fleet Reroute broadcasted to caravan followers`, 4000);
                }

                return freshRoute;
            }
        } catch (err) {
            isRecalculatingRef.current = false;
            console.warn('[recalculateRoute] Failed:', err);
        }
        return null;
    }, [getActiveUserLocation, user?.uid, profile?.familyCircleId]);

    // On-the-fly manual alternative routes evaluation
    const handleRecalculateRoutes = useCallback(async (silent: boolean = false) => {
        if (!activeRoute || !activeRoute.destinationLoc) {
            if (!silent) showNotification('⚠️ No active route to evaluate alternatives', 3000);
            return;
        }
        const liveOrigin = getActiveUserLocation();
        if (liveOrigin.lat === 0 && liveOrigin.lng === 0) {
            if (!silent) showNotification('⚠️ Waiting for GPS location...', 3000);
            return;
        }

        setIsRecalculatingRoutes(true);
        if (!silent) {
            showNotification('🔄 Evaluating alternative routes...', 4000);
            speechService.speak('Evaluating alternative routes.', { chime: 'turn' });
        }

        try {
            clearRouteCache();
            const currentLeg = activeRoute.currentLegIndex || 0;
            const remainingWaypoints = (activeRoute.waypoints || []).slice(currentLeg);
            const opts: any = { bypassCache: true };
            if (remainingWaypoints.length > 0) opts.waypoints = remainingWaypoints;
            if (activeRoute.avoidTolls) opts.avoidTolls = true;

            const freshOptions = await fetchRouteOptions(
                liveOrigin,
                activeRoute.destinationName,
                activeRoute.destinationLoc,
                opts
            );

            if (freshOptions && freshOptions.length > 0) {
                freshOptions.forEach(r => {
                    r.destinationImageUrl = activeRoute.destinationImageUrl;
                    r.destinationPlaceId = activeRoute.destinationPlaceId;
                    r.destinationNeedsBuildingPhoto = activeRoute.destinationNeedsBuildingPhoto;
                    r.destinationEntranceNotes = activeRoute.destinationEntranceNotes;
                    r.destinationEntranceType = activeRoute.destinationEntranceType;
                });
                const currentIdx = freshOptions.findIndex(r => r.id === activeRoute.id || r.summary === activeRoute.summary);
                if (currentIdx !== -1) {
                    freshOptions[currentIdx].id = activeRoute.id;
                    setActiveRouteIndex(currentIdx);
                }
                setAlternativeRoutes(freshOptions);
                if (!silent) {
                    showNotification(`✅ Found ${freshOptions.length} route alternative${freshOptions.length > 1 ? 's' : ''}`, 3500);
                }
            } else {
                if (!silent) {
                    showNotification('ℹ️ Current route is the optimal path', 3000);
                }
            }
        } catch (err) {
            console.warn('[useNavigation] Error recalculating alternatives:', err);
            if (!silent) {
                showNotification('⚠️ Could not refresh alternative routes', 3000);
            }
        } finally {
            setIsRecalculatingRoutes(false);
        }
    }, [activeRoute, getActiveUserLocation, showNotification]);



    const handleDiscovery = useCallback((query: string, onSelectPlace?: (place: Place) => void) => {
        const location = getActiveUserLocation();

        startSearchTransition(async () => {
            try {
                const results = await searchPlacesText(query, location);
                // Only include saved places whose NAME matches the query — not ALL userPlaces.
                // This prevents unrelated saved places (e.g. Home) from appearing
                // when searching for a brand/business (e.g. "mcdonalds").
                const qLower = query.toLowerCase().trim();
                const relevantSaved = userPlaces.filter(p =>
                    (p.name || '').toLowerCase().includes(qLower)
                );
                setDiscoveredPlaces([...relevantSaved, ...results]);
                if (results.length > 0) {
                    showNotification(`📍 Found ${results.length} results`, 3000);
                    onSelectPlace?.(results[0]); // Auto-select the first result so the panel opens immediately
                    searchHistoryService.addItem({
                        query,
                        name: results[0].name,
                        description: results[0].description,
                        location: results[0].location,
                        type: results[0].type,
                        icon: results[0].icon
                    });
                } else {
                    searchHistoryService.addItem({ query });
                }
            } catch (err) {
                console.warn('Search failed:', err);
            }
        });
    }, [userPlaces, startSearchTransition, setDiscoveredPlaces, showNotification, getActiveUserLocation]);

    const handleQuickSearch = useCallback((type: 'gas' | 'coffee' | 'food' | 'grocery') => {
        const location = getActiveUserLocation();
        console.log(`⛽ [QuickSearch] type=${type}, center=(${location.lat}, ${location.lng})`);

        startSearchTransition(async () => {
            let results: Place[] = [];
            try {
                switch (type) {
                    case 'gas': results = await searchGasStations(location); break;
                    case 'coffee': results = await searchCoffeeShops(location); break;
                    case 'food': results = await searchRestaurants(location); break;
                    case 'grocery': results = await searchGroceryStores(location); break;
                }
                console.log(`⛽ [QuickSearch] Primary search returned ${results.length} results`);
            } catch (error) {
                console.warn('Places API error, fallback to Gemini');
            }

            if (results.length === 0) {
                try {
                    const query = type === 'gas' ? 'gas station' : type === 'coffee' ? 'coffee shop' : type === 'food' ? 'restaurant' : 'grocery store';
                    results = await searchPlacesText(query, location);
                    console.log(`⛽ [QuickSearch] Gemini fallback returned ${results.length} results (pre-filter)`);

                    // CRITICAL: Filter Gemini results to 5km radius — Gemini returns city-wide results
                    const R = 6371000;
                    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                        const dLat = (lat2 - lat1) * Math.PI / 180;
                        const dLng = (lon2 - lon1) * Math.PI / 180;
                        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
                        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    };
                    results = results.filter(p => {
                        if (!p.location || isNaN(p.location.lat) || isNaN(p.location.lng)) return false;
                        return haversine(location.lat, location.lng, p.location.lat, p.location.lng) <= 5000;
                    });
                    console.log(`⛽ [QuickSearch] Gemini after 5km filter: ${results.length} results`);
                } catch (err) {
                    console.warn('Gemini fallback failed');
                }
            }
            setDiscoveredPlaces([...userPlaces, ...results]);
        });
    }, [userPlaces, startSearchTransition, setDiscoveredPlaces, getActiveUserLocation]);

    // Centralized Arrival & Trip Completion Handler: Sets arrival trip data to trigger the wizard
    const onTripCompleted = useCallback((customLocation?: Location, immediate?: boolean) => {
        const currentRoute = activeRouteRef.current || activeRoute;
        if (!currentRoute) return;
        const loc = customLocation || userLocation || currentRoute.destinationLoc;

        // Keep the completed route's context before navigation state is cleared.
        // The review card owns its own optional feedback flow, so a driver can
        // dismiss it without keeping a stale active trip on the map.
        setCompletedTripData({
            destinationName: currentRoute.destinationName || 'Destination',
            destinationLoc: currentRoute.destinationLoc || loc,
            destinationPlace: {
                id: currentRoute.destinationPlaceId || `completed_${Date.now()}`,
                name: currentRoute.destinationName || 'Destination',
                location: currentRoute.destinationLoc || loc,
                radius: 0.3,
                type: 'search_result',
                icon: '📍',
                imageUrl: currentRoute.destinationImageUrl,
                isSaved: Boolean(currentRoute.destinationPlaceId),
                description: currentRoute.summary
            },
            totalDistance: currentRoute.totalDistance || '',
            totalTime: currentRoute.totalTime || '',
            safetyScore,
            arrivedAt: Date.now()
        });

        audioService.playAlertChime();
        showNotification(`🎯 Arrived at ${currentRoute.destinationName}! Safety Score: ${safetyScore}%`, 6000);
        speechService.announceManeuver('', 0, 'arrival', currentRoute.destinationName);
        const actualFuelGallons = fuelTrackerRef.current?.getGallonsBurned();
        endTrip(loc || undefined, actualFuelGallons && actualFuelGallons > 0 ? actualFuelGallons : undefined);
        fuelTrackerRef.current = null;
        setLiveFuelSnapshot(null);
        stopCrashMonitoring();
        setEtaSharing(false);
        clearNavigation();

        // The contribution prompt has already been offered during the approach.
        // Completing the trip clears that non-blocking card instead of launching
        // the former multi-step post-drive wizard.
        setApproachingTripData(null);

        // Auto-resolve SOS if active upon safe destination arrival
        const selfMember = members.find(m => m.id === user?.uid);
        if (selfMember?.sosActive && profile?.familyCircleId && user?.uid) {
            clearSOS(profile.familyCircleId, user.uid);
            showNotification('🛡️ Emergency resolved: Arrived safely at destination.', 8000);
        }

        if (profile?.familyCircleId && user?.uid) {
            updateMemberTrip(profile.familyCircleId, user.uid, null).catch(() => {});
        }

        arrivalCandidateTicksRef.current = 0;
        clearRouteCache();

        navStateRef.current = {
            ...navStateRef.current,
            hasArrived: true
        };
        setNavState(prev => ({
            ...prev,
            hasArrived: true
        }));

        const finalizeExit = () => {
            setDriveMode(false);
            setIsNavigating(false);
            activeRouteRef.current = null;
            setActiveRoute(null);
            setUpcomingGuidance(null);
            setBetterRouteSuggestion(null);
            setUpcomingTollAlert(null);
            setLeaderDivertedPrompt(null);
            clearLeaderPromptTimer();
        };

        if (immediate) {
            finalizeExit();
        } else {
            // Keep activeRoute and navigation state active so map camera settles
            // smoothly on the destination pin and arrival view remains stable
            setDriveMode(false);
            // Auto-cleanup fallback after 45 seconds if user leaves wizard open
            setTimeout(finalizeExit, 45000);
        }
    }, [activeRoute, userLocation, safetyScore, members, user?.uid, profile?.familyCircleId, showNotification, setDriveMode, setEtaSharing, clearLeaderPromptTimer]);

    // Navigation Engine Integration
    useEffect(() => {
        if (isNavigating && activeRoute && userLocation) {
            const member = members.find(m => m.id === user?.uid);
            const memberSpeedMph = member?.speed || 0;
            // Circle telemetry is intentionally throttled and can lag during a drive.
            // Safety feedback must use the phone's freshest GPS speed whenever it exists.
            const deviceSpeedMps = geolocationService.getCurrentSpeedMps();
            const selfSpeedMph = deviceSpeedMps > 0
                ? deviceSpeedMps * 2.23694
                : memberSpeedMph;
            const roundedSpeedMph = Math.round(selfSpeedMph);
            setLiveSpeedMph(previous => previous === roundedSpeedMph ? previous : roundedSpeedMph);
            const currentNavState = navStateRef.current;
            const newNavState = updateNavigationState(userLocation, activeRoute, currentNavState, undefined, selfSpeedMph);
            const upcomingGuidance = getUpcomingManeuverGuidance(activeRoute, newNavState);

            const selfHeading = member?.heading || 0;
            currentSpeedRef.current = selfSpeedMph;
            recordTripPoint(userLocation.lat, userLocation.lng, selfSpeedMph, selfHeading);
            updateCrashDetectionSpeed(selfSpeedMph);

            const now = Date.now();
            const rawMps = deviceSpeedMps || (selfSpeedMph / 2.23694);

            // Driving Behavior Analysis via GPS velocity delta tracking
            if (lastBehaviorSpeedMpsRef.current !== null && lastBehaviorTimestampRef.current > 0) {
                const dtMs = now - lastBehaviorTimestampRef.current;
                const prevSpeedMps = lastBehaviorSpeedMpsRef.current;
                const behaviorEvent = analyzeDrivingBehavior(rawMps, prevSpeedMps, dtMs);

                if (behaviorEvent === 'hard_brake' && (now - lastDriveEventTimeRef.current.hard_brake > 3500)) {
                    lastDriveEventTimeRef.current.hard_brake = now;
                    recordDriveEvent('hard_brake', userLocation);
                    fuelTrackerRef.current?.recordDriveEvent('hard_brake');
                    showNotification('⚠️ Hard braking detected', 2500);
                } else if (behaviorEvent === 'rapid_accel' && (now - lastDriveEventTimeRef.current.rapid_accel > 3500)) {
                    lastDriveEventTimeRef.current.rapid_accel = now;
                    recordDriveEvent('rapid_accel', userLocation);
                    fuelTrackerRef.current?.recordDriveEvent('rapid_accel');
                    showNotification('⚡ Rapid acceleration detected', 2500);
                }
            }
            lastBehaviorSpeedMpsRef.current = rawMps;
            lastBehaviorTimestampRef.current = now;

            // Feed live fuel tracker with raw GPS speed
            if (fuelTrackerRef.current) {
                const dt = (now - lastFuelTickTimeRef.current) / 1000;
                lastFuelTickTimeRef.current = now;
                fuelTrackerRef.current.recordTick(rawMps, dt);
                const snapshot = fuelTrackerRef.current.getSnapshot();
                setLiveFuelSnapshot(snapshot);

                // Check for mid-trip depletion if not already alerted
                if (!hasAnnouncedLowFuelRef.current && snapshot) {
                    const remainingDistanceMiles = (newNavState.remainingDistanceMeters || 0) / 1609.344;
                    const dynamicAlert = vehicleFuelService.checkLowFuelAlert(remainingDistanceMiles);
                    if (dynamicAlert) {
                        hasAnnouncedLowFuelRef.current = true;
                        setLowFuelAlert(dynamicAlert);
                        speechService.speak(dynamicAlert.spokenPrompt, { chime: 'turn' });
                        showNotification(
                            `${dynamicAlert.fuelType === 'electric' ? '⚡' : '⛽'} ${dynamicAlert.title}: ${dynamicAlert.message}`,
                            7000
                        );
                        searchGasStationsAlongRoute(activeRoute.routeGeometry, userLocation, dynamicAlert.fuelType === 'electric')
                            .then(stations => {
                                if (stations && stations.length > 0) {
                                    setLowFuelAlert(prev => prev ? {
                                        ...prev,
                                        gasStations: stations,
                                        recommendedGasStation: stations[0]
                                    } : null);
                                }
                            })
                            .catch(err => console.warn('[useNavigation] Failed to fetch corridor gas stations:', err));
                    }
                }
            }

            const currentStep = activeRoute.steps[newNavState.currentStepIndex];
            const distToStep = newNavState.distanceToNextStep;

            // Turn-by-Turn Voice Synthesizer Alerts
            if (currentStep) {
                const now = Date.now();
                const distFt = Math.round(distToStep * 3.28084);
                const lock = maneuverAnnounceLockRef.current;
                const isNewStep = lock.stepIndex !== newNavState.currentStepIndex;

                if (isNewStep) {
                    showNotification(`🔜 Next: ${currentStep.instruction}`, 4000);

                    // Safety Camera Alert for new maneuver segment
                    if (currentStep.hasCamera && lastCameraAlertStepRef.current !== newNavState.currentStepIndex) {
                        lastCameraAlertStepRef.current = newNavState.currentStepIndex;
                        speechService.announceSafetyCamera();
                        showNotification(`📷 Safety camera zone ahead`, 4000);
                    }

                    // Reset lock for new step and pre-mark any brackets we have already passed
                    const initialStages = new Set<ManeuverProximity>();
                    if (distFt <= 1200) initialStages.add('preparatory');
                    if (distFt <= 300) initialStages.add('mid');

                    maneuverAnnounceLockRef.current = {
                        stepIndex: newNavState.currentStepIndex,
                        announcedStages: initialStages,
                        lastSpokenTime: lock.lastSpokenTime
                    };
                }

                const currentLock = maneuverAnnounceLockRef.current;
                const isInitialGracePeriod = (now - navigationStartTimeRef.current) < 3500 && newNavState.currentStepIndex === 0;
                const timeSinceLastSpoken = now - currentLock.lastSpokenTime;

                // Enforce strict proximity brackets & debouncing (minimum 2.5s between audio alerts)
                if (!isInitialGracePeriod && timeSinceLastSpoken > 2500) {
                    // Bracket 1: Preparatory Announcement: ~1 mile (5,280 ft) (once only)
                    if (distFt <= 5280 && distFt > 1200 && !currentLock.announcedStages.has('preparatory')) {
                        currentLock.announcedStages.add('preparatory');
                        currentLock.lastSpokenTime = now;
                        speechService.announceManeuver(currentStep.instruction, distToStep, 'preparatory', undefined, currentStep.lanes);
                    }
                    // Bracket 2: Mid-Range Notice: ~1,000 ft (once only)
                    else if (distFt <= 1200 && distFt > 300 && !currentLock.announcedStages.has('mid')) {
                        currentLock.announcedStages.add('mid');
                        currentLock.lastSpokenTime = now;
                        speechService.announceManeuver(currentStep.instruction, distToStep, 'mid', undefined, currentStep.lanes);
                    }
                    // Bracket 3: Immediate Turn Action: < 300 ft (once only)
                    else if (distFt <= 300 && distToStep > 0 && !currentLock.announcedStages.has('immediate')) {
                        currentLock.announcedStages.add('immediate');
                        currentLock.lastSpokenTime = now;
                        speechService.announceManeuver(currentStep.instruction, distToStep, 'immediate');
                    }
                }

                // Speed alerts are independent from scoring. They warn on a sustained
                // overspeed episode only when the member explicitly enabled the setting.
                const activeSpeedLimit = currentStep.speedLimit || 35;

                // Score a sustained speeding episode once. GPS can fluctuate
                // by several MPH, so require 6 MPH over for 8 seconds and do
                // not issue repeated penalties until speed settles back down.
                const speedingState = speedingEpisodeRef.current;
                const isOverScoringThreshold = selfSpeedMph >= activeSpeedLimit + 6;
                const hasSettledBelowLimit = selfSpeedMph <= activeSpeedLimit + 2;
                if (isOverScoringThreshold) {
                    if (speedingState.speedLimit !== activeSpeedLimit || speedingState.startedAt === null) {
                        speedingState.startedAt = now;
                        speedingState.speedLimit = activeSpeedLimit;
                        speedingState.recorded = false;
                    }
                    if (!speedingState.recorded && now - speedingState.startedAt >= 8_000) {
                        speedingState.recorded = true;
                        recordDriveEvent('speeding', userLocation);
                    }
                } else if (hasSettledBelowLimit) {
                    speedingState.startedAt = null;
                    speedingState.speedLimit = null;
                    speedingState.recorded = false;
                }

                const speedAlertState = speedAlertEpisodeRef.current;
                const isOverAlertThreshold = selfSpeedMph >= activeSpeedLimit + 7;
                const hasSettledBelowAlertThreshold = selfSpeedMph <= activeSpeedLimit + 3;
                if (speedAlertsEnabled && isOverAlertThreshold) {
                    if (speedAlertState.speedLimit !== activeSpeedLimit || speedAlertState.startedAt === null) {
                        speedAlertState.startedAt = now;
                        speedAlertState.speedLimit = activeSpeedLimit;
                    }
                    if (
                        now - speedAlertState.startedAt >= 5_000
                        && now - lastSpeedWarningTimeRef.current > 30_000
                    ) {
                        lastSpeedWarningTimeRef.current = now;
                        speechService.announceSpeedWarning(activeSpeedLimit);
                        showNotification(`⚠️ Speed alert: ${Math.round(selfSpeedMph)} MPH in a ${activeSpeedLimit} MPH zone`, 5000);
                    }
                } else if (hasSettledBelowAlertThreshold || !speedAlertsEnabled) {
                    speedAlertState.startedAt = null;
                    speedAlertState.speedLimit = null;
                }
            }

            // Check upcoming steps for toll facilities within ~3 miles (5000m)
            if (activeRoute.steps && activeRoute.steps.length > 0 && !upcomingTollAlert) {
                let accumulatedDist = distToStep;
                for (let i = newNavState.currentStepIndex; i < Math.min(newNavState.currentStepIndex + 6, activeRoute.steps.length); i++) {
                    const step = activeRoute.steps[i];
                    if (i > newNavState.currentStepIndex) {
                        const stepDist = parseFloat(step.distance.replace(/[^0-9.]/g, '')) || 0;
                        const distInMeters = step.distance.includes('mi') ? stepDist * 1609 : step.distance.includes('km') ? stepDist * 1000 : stepDist * 0.3048;
                        accumulatedDist += distInMeters;
                    }

                    if (step.isToll && accumulatedDist <= 5000) {
                        if (lastTollAnnouncedStepRef.current !== i) {
                            lastTollAnnouncedStepRef.current = i;
                            const costFormatted = step.estimatedToll ? `$${step.estimatedToll.toFixed(2)}` : '$4.50';
                            setUpcomingTollAlert({
                                tollName: step.tollName || 'Toll Plaza',
                                estimatedToll: step.estimatedToll || 4.50,
                                distanceMeters: Math.round(accumulatedDist),
                                stepIndex: i
                            });
                            speechService.speak(
                                `Toll plaza ahead on ${step.tollName || 'route'}. Estimated toll: ${costFormatted}. Tap Take Toll-Free Exit to divert.`,
                                { chime: 'turn' }
                            );
                        }
                        break;
                    }
                }
            }

            // Periodic route suggestions require real, current traffic routes.
            // OSRM corridor variants are useful in the route picker, but they
            // cannot substantiate a live "save X min" claim while driving.
            if (now - lastRerouteCheckTimeRef.current > 90000 && activeRoute.destinationLoc && !betterRouteSuggestion && !(activeRoute.waypoints?.length)) {
                lastRerouteCheckTimeRef.current = now;
                fetchGoogleTrafficRouteOptions(userLocation, activeRoute.destinationName, activeRoute.destinationLoc)
                    .then(options => {
                        if (!options || options.length <= 1) return;
                        const currentRouteDuration = navStateRef.current.remainingDurationSeconds;
                        const currentRemainingDistance = navStateRef.current.remainingDistanceMeters;
                        if (!currentRouteDuration || currentRouteDuration <= 0) return;
                        for (const alt of options) {
                            const sameSummary = (alt.summary || '').replace(/^via\s+/i, '').trim().toLowerCase() === (activeRoute.summary || '').replace(/^via\s+/i, '').trim().toLowerCase();
                            const sameDistance = typeof currentRemainingDistance === 'number' && typeof alt.distanceMeters === 'number'
                                && Math.abs(currentRemainingDistance - alt.distanceMeters) < Math.max(160, currentRemainingDistance * 0.06);
                            // A new request starts at the current GPS point, so
                            // route ids differ even when it is the same path.
                            if (sameSummary || sameDistance) continue;
                            const diffSec = currentRouteDuration - (alt.totalDurationSec || 0);
                            const timeSavedMin = Math.floor(diffSec / 60);

                            if (timeSavedMin >= 3) {
                                setBetterRouteSuggestion({
                                    route: alt,
                                    timeSavedMin,
                                    savingsLabel: `Save ${timeSavedMin} min`,
                                    reason: `Faster route ${alt.summary || 'with live traffic'}`
                                });
                                break;
                            }
                        }
                    })
                    .catch(err => console.warn('In-drive reroute check error:', err));
            }

            // --- AUTOMATIC OFF-ROUTE RE-ROUTING ---
            // If the driver takes an unprogrammed turn or deviates from the path, instantly calculate a fresh route forward.
            // Suppress during orientation transition / gyro stabilization window (1500ms) to prevent device tilt from triggering loops.
            const isWithinOrientationTransition = (Date.now() - lastOrientationChangeTimeRef.current) < 1500;
            if (newNavState.isOffRoute && activeRoute.destinationLoc && !isRecalculatingRef.current && !isWithinOrientationTransition) {
                offRouteTicksRef.current += 1;
                const now = Date.now();
                // Trigger when 2 consecutive ticks confirm off-route (~1.5s) OR if clearly off-route (> 60m)
                const isConfirmedOffRoute = offRouteTicksRef.current >= 2 || newNavState.distanceToNextStep > 60;
                const cooldownPassed = (now - lastOffRouteRecalcTimeRef.current) > 2500; // 2.5s cooldown once rerouted

                if (isConfirmedOffRoute && cooldownPassed) {
                    lastOffRouteRecalcTimeRef.current = now;
                    offRouteTicksRef.current = 0;
                    recalculateRoute(userLocation || undefined);
                }
            } else if (!newNavState.isOffRoute || isWithinOrientationTransition) {
                offRouteTicksRef.current = 0;
            }

            // Intermediate stops are their own arrival lifecycle. Announce the
            // approach, then pause on arrival until the driver resumes the trip.
            if (activeRoute.waypoints && activeRoute.waypoints.length > 0) {
                const currentLeg = activeRoute.currentLegIndex || 0;
                if (currentLeg < activeRoute.waypoints.length) {
                    const targetStop = activeRoute.waypoints[currentLeg];
                    if (targetStop && targetStop.location && userLocation) {
                        const distToStop = getDistanceMeters(userLocation, targetStop.location);
                        const stopKey = `${activeRoute.id || activeRoute.destinationName}:${currentLeg}:${targetStop.id}`;
                        if (distToStop <= ARRIVAL_APPROACH_RADIUS_METERS && distToStop > 50 && stopApproachPromptRef.current !== stopKey) {
                            stopApproachPromptRef.current = stopKey;
                            setMultiStopArrival({
                                stop: targetStop,
                                stopNumber: currentLeg + 1,
                                totalStops: activeRoute.waypoints.length + 1,
                                phase: 'approaching'
                            });
                            speechService.announceManeuver('', 0, 'arrival', targetStop.name);
                        }
                        if (distToStop <= 50) {
                            audioService.playAlertChime();
                            speechService.announceManeuver('', 0, 'arrival', targetStop.name);
                            setMultiStopArrival({
                                stop: targetStop,
                                stopNumber: currentLeg + 1,
                                totalStops: activeRoute.waypoints.length + 1,
                                phase: 'arrived'
                            });
                            setIsNavigating(false);
                            showNotification(`🎯 Arrived at Stop ${currentLeg + 1}: ${targetStop.name}`, 6000);
                            return;
                        }
                    }
                }
            }

            const distToFinalDestination = (activeRoute.destinationLoc && userLocation)
                ? getDistanceMeters(userLocation, activeRoute.destinationLoc)
                : 0;

            // Speed check from Geolocation API coords.speed or live member telemetry in m/s
            const currentSpeedMps = geolocationService.getCurrentSpeedMps() || (selfSpeedMph / 2.23694);

            const currentLeg = activeRoute.currentLegIndex || 0;
            const hasPendingWaypoints = Boolean(activeRoute.waypoints && activeRoute.waypoints.length > 0 && currentLeg < activeRoute.waypoints.length);
            const isOnFinalStep = newNavState.currentStepIndex >= (activeRoute.steps?.length || 1) - 1;

            // This is intentionally independent from trip completion. The driver
            // sees the optional photo prompt at 250 ft while navigation remains
            // active, then still reaches the normal precise-arrival threshold.
            const approachRouteKey = activeRoute.id || `${activeRoute.destinationName}_${activeRoute.destinationLoc?.lat}_${activeRoute.destinationLoc?.lng}`;
            const isWithinApproachZone = distToFinalDestination > 0 && distToFinalDestination <= ARRIVAL_APPROACH_RADIUS_METERS;
            if (isWithinApproachZone && !hasPendingWaypoints && isOnFinalStep && approachPromptRouteRef.current !== approachRouteKey) {
                approachPromptRouteRef.current = approachRouteKey;
                setApproachingTripData({
                    destinationName: activeRoute.destinationName || 'Destination',
                    destinationLoc: activeRoute.destinationLoc || userLocation || { lat: 0, lng: 0 },
                    destinationPlace: {
                        id: activeRoute.destinationPlaceId || `approach_${Date.now()}`,
                        name: activeRoute.destinationName || 'Destination',
                        location: activeRoute.destinationLoc || userLocation || { lat: 0, lng: 0 },
                        radius: 0.3,
                        type: 'search_result',
                        icon: '📍',
                        imageUrl: activeRoute.destinationImageUrl,
                        isSaved: Boolean(activeRoute.destinationPlaceId),
                        needsBuildingPhoto: activeRoute.destinationNeedsBuildingPhoto,
                        description: activeRoute.summary
                    },
                    totalDistance: activeRoute.totalDistance || '',
                    totalTime: activeRoute.totalTime || '',
                    safetyScore,
                    arrivedAt: Date.now()
                });
            }

            const isInsideArrivalRadius = distToFinalDestination > 0 && distToFinalDestination <= ARRIVAL_RADIUS_METERS;
            const isStationaryOrWalking = currentSpeedMps < ARRIVAL_SPEED_THRESHOLD_MPS;

            if (isInsideArrivalRadius && isStationaryOrWalking && !hasPendingWaypoints && isOnFinalStep) {
                arrivalCandidateTicksRef.current += 1;
            } else {
                arrivalCandidateTicksRef.current = 0;
            }

            // Strict Destination Arrival Condition:
            // 1. All intermediate waypoints must be cleared
            // 2. Vehicle must be on final step
            // 3. Must be within ARRIVAL_RADIUS_METERS (25m) at stationary speed (< 2 m/s) for consecutive ticks,
            //    or pinpoint coordinate arrival within 12m
            const hasMetGeofencedHeuristic = !hasPendingWaypoints && isOnFinalStep && arrivalCandidateTicksRef.current >= ARRIVAL_CONSECUTIVE_TICKS;
            const hasReachedPinpoint = !hasPendingWaypoints && isOnFinalStep && (distToFinalDestination <= 12 && distToFinalDestination > 0);
            const canArrive = hasMetGeofencedHeuristic || hasReachedPinpoint;

            const isArrived = newNavState.hasArrived || canArrive;

            if (canArrive && !currentNavState.hasArrived) {
                notifyArrival(activeRoute.destinationName || 'Destination');
                onTripCompleted(userLocation || undefined, false);
            }

            if (isArrived) {
                newNavState.hasArrived = true;
                newNavState.distanceToNextStep = 0;
                newNavState.remainingDistanceMeters = 0;
                newNavState.remainingDurationSeconds = 0;
            } else if (newNavState.currentStepIndex >= (activeRoute.steps?.length || 1) - 1) {
                // Ensure the final step displays actual remaining distance to destination
                newNavState.distanceToNextStep = distToFinalDestination || newNavState.remainingDistanceMeters || 0;
            }

            // Sync navigation telemetry & turn-by-turn instruction to Android Auto head unit
            const remainDistStr = isArrived
                ? '0 ft'
                : (typeof newNavState.remainingDistanceMeters === 'number' && Number.isFinite(newNavState.remainingDistanceMeters)
                    ? (newNavState.remainingDistanceMeters >= 1609.34
                        ? `${(newNavState.remainingDistanceMeters / 1609.34).toFixed(1)} mi`
                        : `${Math.round(newNavState.remainingDistanceMeters * 3.28084)} ft`)
                    : (currentStep
                        ? (distToStep > 1000
                            ? `${(distToStep / 1609.34).toFixed(1)} mi`
                            : `${Math.round(distToStep * 3.28084)} ft`)
                        : (activeRoute.totalDistance || '')));

            const instructionText = isArrived
                ? 'Arrived!'
                : (currentStep?.instruction || 'Follow highlighted route');
            const gpsBearing = geolocationService.getLastTelemetry()?.heading;
            const routeBearing = getRouteForwardBearing(userLocation, activeRoute.routeGeometry);
            const carBearing = typeof gpsBearing === 'number' && Number.isFinite(gpsBearing)
                ? gpsBearing
                : (typeof routeBearing === 'number' ? routeBearing : selfHeading);

            syncNavigationTelemetry({
                destinationName: activeRoute.destinationName || 'Destination',
                eta: isArrived ? '0 min' : (activeRoute.totalTime || ''),
                remainingDistance: remainDistStr,
                currentInstruction: instructionText,
                speedMph: Math.round(selfSpeedMph),
                speedLimit: currentStep?.speedLimit || 35,
                isArrived: isArrived,
                currentLocation: userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined,
                destinationLocation: activeRoute.destinationLoc ? { lat: activeRoute.destinationLoc.lat, lng: activeRoute.destinationLoc.lng } : undefined,
                bearing: carBearing,
                routeCoordinates: activeRoute.routeGeometry?.map(([lng, lat]) => ({ lat, lng })),
                fuelGallonsBurned: liveFuelSnapshot?.gallonsBurned,
                fuelCostSoFar: liveFuelSnapshot?.costSoFar,
                fuelGallonsRemaining: liveFuelSnapshot?.gallonsRemaining,
                fuelPercentRemaining: liveFuelSnapshot?.percentRemaining,
                fuelRangeMiles: liveFuelSnapshot?.predictedRangeMiles
            });

            setNavState(newNavState);
            setUpcomingGuidance(upcomingGuidance);
        }
    }, [userLocation, isNavigating, activeRoute, safetyScore, speedAlertsEnabled, members, user?.uid, profile?.familyCircleId, showNotification, setDriveMode, setEtaSharing, betterRouteSuggestion, upcomingTollAlert, onTripCompleted]);

    // Reroute / Switch to alternative route actions
    const handleSwitchRoute = useCallback((newRoute: NavigationRoute) => {
        const prevRoute = activeRouteRef.current;
        activeRouteRef.current = newRoute;
        setActiveRoute(newRoute);

        // Update alternativeRoutes: place newRoute at index 0, and retain previous route
        setAlternativeRoutes(prevAlts => {
            const list = (prevAlts || []).filter(r => r.id !== newRoute.id && r.summary !== newRoute.summary);
            if (prevRoute && prevRoute.id !== newRoute.id) {
                list.push(prevRoute);
            }
            return [newRoute, ...list];
        });
        setActiveRouteIndex(0);

        // Calculate synchronized navigation state and guidance from current user location
        const loc = userLocationRef.current || getActiveUserLocation();
        const currentSpeedMph = currentSpeedRef.current || 0;
        const freshNavState = updateNavigationState(loc, newRoute, {
            currentStepIndex: 0,
            distanceToNextStep: 0,
            isOffRoute: false,
            hasArrived: false,
            splitIndex: 0
        }, undefined, currentSpeedMph);

        const freshGuidance = getUpcomingManeuverGuidance(newRoute, freshNavState);
        setNavState(freshNavState);
        navStateRef.current = freshNavState;
        setUpcomingGuidance(freshGuidance);

        const currentStep = newRoute.steps[freshNavState.currentStepIndex] || newRoute.steps[0];
        if (currentStep) {
            const rawDist = freshGuidance.distanceMeters || 50;
            const initialFt = Math.round(rawDist * 3.28084);
            const initialStages = new Set<ManeuverProximity>();
            if (initialFt <= 5280) initialStages.add('preparatory');
            if (initialFt <= 1200) initialStages.add('mid');
            if (initialFt <= 300) initialStages.add('immediate');

            maneuverAnnounceLockRef.current = {
                stepIndex: freshNavState.currentStepIndex,
                announcedStages: initialStages,
                lastSpokenTime: Date.now()
            };
            speechService.announceManeuver(freshGuidance.instruction, rawDist, 'initial');
        } else {
            maneuverAnnounceLockRef.current = {
                stepIndex: 0,
                announcedStages: new Set(),
                lastSpokenTime: Date.now()
            };
        }

        setBetterRouteSuggestion(null);
        showNotification(`🔀 Switched to ${newRoute.routeLabel || newRoute.summary || 'alternative route'}!`, 4000);
        speechService.speak(`Switched route to ${newRoute.summary || 'alternative route'}.`, { chime: 'turn' });
    }, [getActiveUserLocation, showNotification]);

    const handleDismissReroute = useCallback(() => {
        setBetterRouteSuggestion(null);
    }, []);

    // Take Toll-Free Exit handler
    const handleTakeTollFreeExit = useCallback(async () => {
        if (!activeRoute?.destinationLoc || !userLocation) return;
        showNotification('🛣️ Calculating toll-free exit route...', 4000);
        speechService.speak('Diverting to toll-free route. Recalculating.', { chime: 'turn' });
        try {
            const options = await fetchRouteOptions(
                userLocation,
                activeRoute.destinationName,
                activeRoute.destinationLoc,
                { avoidTolls: true }
            );
            if (options && options.length > 0) {
                const tollFreeRoute = options.find(r => !r.hasTolls) || options[0];
                handleSwitchRoute(tollFreeRoute);
                setUpcomingTollAlert(null);
                showNotification(`🟢 Diverted: Now on Toll-Free Route (${tollFreeRoute.summary})`, 5000);
            }
        } catch (err) {
            console.warn('Toll-free diversion failed:', err);
            showNotification('⚠️ Could not find toll-free diversion.', 4000);
        }
    }, [activeRoute, userLocation, showNotification]);

    const handleDismissTollAlert = useCallback(() => {
        setUpcomingTollAlert(null);
    }, []);

    const handleAddStop = useCallback(async (place: Place) => {
        if (!activeRoute) return;
        if (!place?.location || !Number.isFinite(place.location.lat) || !Number.isFinite(place.location.lng)) {
            showNotification('⚠️ This stop does not have a usable location.', 4000);
            return;
        }
        const stopName = place.name;
        showNotification(`➕ Adding ${stopName} as a stop...`, 4000);
        speechService.speak(`Adding ${stopName} to your route.`, { chime: 'turn' });

        setLowFuelAlert(null);

        const currentLeg = activeRoute.currentLegIndex || 0;
        const remainingWaypoints = (activeRoute.waypoints || []).slice(currentLeg);
        const newWaypoint: RouteWaypoint = {
            id: `stop_${Date.now()}`,
            name: stopName,
            location: place.location,
            order: currentLeg,
            isStop: true,
            // Preserve why the stop was added. The HUD uses this to offer the
            // refill flow when navigation reaches a station the driver chose.
            isFuelStop: place.type === 'gas' || /\b(gas|fuel)\b/i.test(`${place.category || ''} ${place.name}`)
        };

        const updatedWaypoints = [newWaypoint, ...remainingWaypoints];
        const liveOrigin = getActiveUserLocation();

        try {
            clearRouteCache();
            const allOptions = await fetchRouteOptions(
                liveOrigin,
                activeRoute.destinationName,
                activeRoute.destinationLoc,
                {
                    waypoints: updatedWaypoints,
                    avoidTolls: activeRoute.avoidTolls,
                    bypassCache: true
                }
            );

            if (allOptions && allOptions.length > 0) {
                const newRoute = allOptions[0];
                newRoute.waypoints = updatedWaypoints;
                newRoute.currentLegIndex = 0;
                setActiveRoute(newRoute);
                setActiveRouteIndex(0);
                setNavState({
                    currentStepIndex: 0,
                    distanceToNextStep: 0,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex: 0
                });
                showNotification(`🧭 Route updated: ${stopName} is your next stop`, 5000);
            }
        } catch (err) {
            console.warn('[useNavigation] Failed to recalculate with added stop:', err);
            showNotification('⚠️ Could not add that stop. Your current route is unchanged.', 4500);
        }
    }, [activeRoute, getActiveUserLocation, showNotification]);

    const handleContinueAfterStop = useCallback(() => {
        const route = activeRouteRef.current;
        if (!route?.waypoints?.length) return;
        const currentLeg = route.currentLegIndex || 0;
        if (currentLeg >= route.waypoints.length) return;

        const nextRoute = { ...route, currentLegIndex: currentLeg + 1 };
        activeRouteRef.current = nextRoute;
        setActiveRoute(nextRoute);
        setMultiStopArrival(null);
        stopApproachPromptRef.current = null;
        arrivalCandidateTicksRef.current = 0;
        setNavState({ currentStepIndex: 0, distanceToNextStep: 0, isOffRoute: false, hasArrived: false, splitIndex: 0 });
        setIsNavigating(true);
        showNotification(`▶️ Continuing to ${currentLeg + 1 < route.waypoints.length ? route.waypoints[currentLeg + 1].name : route.destinationName}`, 3500);
        void recalculateRoute(userLocationRef.current || undefined);
    }, [recalculateRoute, showNotification]);

    const handleDismissStopApproach = useCallback(() => {
        setMultiStopArrival(current => current?.phase === 'approaching' ? null : current);
    }, []);

    const handleDismissLowFuelAlert = useCallback(() => {
        setLowFuelAlert(null);
    }, []);

    const handleQuickFuelUpdate = useCallback((percent: number, isFull: boolean) => {
        let tankStatus = null;
        if (isFull) {
            tankStatus = vehicleFuelService.markTankFull();
        } else {
            const activeVeh = vehicleFuelService.getActiveVehicleNullable();
            if (activeVeh?.tankCapacityGal) {
                const gallons = (Math.max(0, Math.min(100, percent)) / 100) * activeVeh.tankCapacityGal;
                tankStatus = vehicleFuelService.setFuelLevel(gallons, activeVeh, 'manual');
            }
        }
        if (fuelTrackerRef.current) {
            // The tracker keeps cumulative trip burn. Rebase its starting
            // reading so the HUD reflects this pump reading immediately.
            if (tankStatus) fuelTrackerRef.current.syncFuelLevel(tankStatus.gallonsRemaining);
            setLiveFuelSnapshot(fuelTrackerRef.current.getSnapshot());
        } else if (tankStatus) {
            // Keep the HUD honest even during the short interval before the
            // trip tracker is initialized.
            setLiveFuelSnapshot(previous => previous ? {
                ...previous,
                gallonsRemaining: tankStatus.gallonsRemaining,
                percentRemaining: Math.round((tankStatus.gallonsRemaining / tankStatus.tankCapacityGal) * 100),
                predictedRangeMiles: Math.max(0, Math.round(tankStatus.gallonsRemaining * previous.effectiveTripMpg))
            } : previous);
        }
    }, []);

    // Cleanup & Cancel Navigation / Manual End-Trip Override
    const handleCancelNavigation = useCallback(() => {
        // Manual End-Trip Override:
        // If the user manually taps "End Trip" (the red 'X' button on the active navigation UI)
        // while inside ARRIVAL_RADIUS_METERS, treat it as a successfully completed trip (triggering the wizard)
        // rather than a "Cancelled" trip.
        if (activeRoute && userLocation && activeRoute.destinationLoc) {
            const distToDest = getDistanceMeters(userLocation, activeRoute.destinationLoc);
            if (distToDest <= ARRIVAL_RADIUS_METERS) {
                onTripCompleted(userLocation, true);
                return;
            }
        }

        // Standard Cancel (user is far outside ARRIVAL_RADIUS_METERS or aborting trip):
        // 1. Purge route cache so subsequent routing calculations pull fresh live geometry
        clearRouteCache();

        // 2. Clear active routing and phantom waypoint states
        activeRouteRef.current = null;
        setActiveRoute(null);
        setUpcomingGuidance(null);
        setAlternativeRoutes([]);
        setActiveRouteIndex(0);
        setIsRecalculatingRoutes(false);
        setBetterRouteSuggestion(null);
        setUpcomingTollAlert(null);
        setLowFuelAlert(null);
        hasAnnouncedLowFuelRef.current = false;
        setLeaderDivertedPrompt(null);
        clearLeaderPromptTimer();
        arrivalCandidateTicksRef.current = 0;

        // 3. Reset navigation engine state cleanly
        navStateRef.current = {
            currentStepIndex: 0,
            distanceToNextStep: 0,
            isOffRoute: false,
            hasArrived: false,
            splitIndex: 0
        };
        setNavState({
            currentStepIndex: 0,
            distanceToNextStep: 0,
            isOffRoute: false,
            hasArrived: false,
            splitIndex: 0
        });

        // 4. Reset recalculation & reroute tracking refs
        isRecalculatingRef.current = false;
        lastOffRouteRecalcTimeRef.current = 0;
        offRouteTicksRef.current = 0;
        lastRerouteRef.current = 0;
        rerouteAttemptsRef.current = 0;
        lastRecalculatedOriginRef.current = null;
        lastRecalculatedDestRef.current = null;
        maneuverAnnounceLockRef.current = {
            stepIndex: -1,
            announcedStages: new Set(),
            lastSpokenTime: 0
        };
        lastTollAnnouncedStepRef.current = -1;
        lastCameraAlertStepRef.current = -1;

        const actualFuelGallons = fuelTrackerRef.current?.getGallonsBurned();
        endTrip(userLocation || undefined, actualFuelGallons && actualFuelGallons > 0 ? actualFuelGallons : undefined);
        fuelTrackerRef.current = null;
        setLiveFuelSnapshot(null);
        stopCrashMonitoring();
        setEtaSharing(false);
        setDriveMode(false);
        setIsNavigating(false);
        clearNavigation();
        if (profile?.familyCircleId && user?.uid) {
            updateMemberTrip(profile.familyCircleId, user.uid, null).catch(() => {});
        }
    }, [activeRoute, userLocation, onTripCompleted, setDriveMode, setEtaSharing, profile?.familyCircleId, user?.uid, clearLeaderPromptTimer]);

    const handleResumeTrip = useCallback(async () => {
        const recovery = pendingTripResume;
        if (!recovery || isResumingTrip) return;
        setIsResumingTrip(true);
        try {
            await handleStartNavigation(recovery.destinationName, recovery.destinationLoc, undefined, true);
            setPendingTripResume(null);
        } finally {
            setIsResumingTrip(false);
        }
    }, [pendingTripResume, isResumingTrip, handleStartNavigation]);

    const handleDiscardTripResume = useCallback(() => {
        endTrip(userLocation || undefined);
        setPendingTripResume(null);
    }, [userLocation]);

    // Android Auto Integration: Sync cancellation initiated from vehicle head unit Action Strip (red "X" button)
    useEffect(() => {
        const unsubscribe = onCarNavigationCancelled(() => {
            console.log('[AndroidAuto] Navigation cancelled via vehicle Action Strip (red X button)');
            handleCancelNavigation();
        });
        return unsubscribe;
    }, [handleCancelNavigation]);

    // Rerouting logic - triggered strictly when off-route state transitions to true
    useEffect(() => {
        const currentRoute = activeRouteRef.current;
        const isWithinOrientationTransition = (Date.now() - lastOrientationChangeTimeRef.current) < 1500;
        if (isNavigating && navState.isOffRoute && currentRoute && !isRecalculatingRef.current && !isWithinOrientationTransition) {
            const now = Date.now();
            if (now - lastRerouteRef.current < 10000) return;
            if (rerouteAttemptsRef.current >= MAX_REROUTE_ATTEMPTS) {
                showNotificationRef.current("⚠️ Unable to find route.", 6000);
                return;
            }
            lastRerouteRef.current = now;
            rerouteAttemptsRef.current += 1;
            recalculateRoute(userLocationRef.current || undefined);
        } else if (isNavigating && !navState.isOffRoute) {
            rerouteAttemptsRef.current = 0;
        }
    }, [isNavigating, navState.isOffRoute, recalculateRoute]);

    const handleFollowLeader = useCallback(() => {
        clearLeaderPromptTimer();
        setLeaderDivertedPrompt((prev) => {
            if (!prev) return null;
            console.log('📡 [Convoy Follower] Following Convoy Leader Route:', prev.newRoute);
            handleSwitchRoute(prev.newRoute);
            showNotification(`🔀 Following leader on route via ${prev.newRoute.summary || 'new path'}`, 5000);
            return null;
        });
    }, [showNotification, clearLeaderPromptTimer]);

    const handleKeepOriginalRoute = useCallback(() => {
        clearLeaderPromptTimer();
        setLeaderDivertedPrompt(null);
        showNotification(`🛑 Keeping original route`, 4000);
        speechService.speak(`Keeping current route.`, { chime: 'turn' });
    }, [showNotification, clearLeaderPromptTimer]);

    // Hive-Mind Fleet Routing: Listen for Leader Reroutes when trailing in a Convoy
    useEffect(() => {
        const unsub = convoyService.onReroute((newRoute, event) => {
            const activeConvoy = convoyService.getActiveConvoy();
            const currentUid = user?.uid || members[0]?.id || 'self';

            // Only trigger prompt if user is a follower in an active caravan
            if (!activeConvoy || !activeConvoy.isActive || activeConvoy.leaderId === currentUid) {
                return;
            }

            console.log('📡 [Convoy Follower] Received Leader Reroute:', event.leaderId, newRoute);

            // Announce to driver
            speechService.speak(`Convoy leader changed route. Syncing in ten seconds.`, { chime: 'turn' });

            // Clear any existing timer
            clearLeaderPromptTimer();

            let seconds = 10;
            setLeaderDivertedPrompt({
                leaderName: activeConvoy.leaderName || 'Convoy Leader',
                leaderId: event.leaderId,
                newRoute,
                reason: newRoute.summary ? `Recalculated via ${newRoute.summary}` : 'Alternative path selected',
                timeRemainingSeconds: seconds,
                timestamp: Date.now()
            });

            leaderPromptTimerRef.current = setInterval(() => {
                seconds -= 1;
                if (seconds <= 0) {
                    clearLeaderPromptTimer();
                    // Auto-sync after 10s window expires
                    console.log('📡 [Convoy Follower] 10s timer expired: Auto-syncing to Leader route');
                    handleSwitchRoute(newRoute);
                    setLeaderDivertedPrompt(null);
                    showNotification(`🔀 Convoy Leader path synced via ${newRoute.summary || 'updated route'}`, 4000);
                } else {
                    setLeaderDivertedPrompt(prev => prev ? { ...prev, timeRemainingSeconds: seconds } : null);
                }
            }, 1000);
        });

        return () => {
            unsub();
            clearLeaderPromptTimer();
        };
    }, [user, members, showNotification, clearLeaderPromptTimer]);

    // Predictive Ambient Maintenance: Autonomously highlight local mechanics along the commute corridor when maintenance is due within 100 miles
    const [ambientMaintenanceAdvisory, setAmbientMaintenanceAdvisory] = useState<AmbientMaintenanceAdvisory | null>(null);
    const hasSearchedMaintenanceForRouteRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isNavigating || !activeRoute) {
            hasSearchedMaintenanceForRouteRef.current = null;
            setAmbientMaintenanceAdvisory(null);
            return;
        }

        const routeKey = `${activeRoute.destinationName}_${activeRoute.totalDistance}`;
        if (hasSearchedMaintenanceForRouteRef.current === routeKey) return;
        hasSearchedMaintenanceForRouteRef.current = routeKey;

        const checkAmbientMaintenance = async () => {
            try {
                const health = maintenanceAlertService.getVehicleHealth(profile?.vehicle);
                // Find item due soon (e.g. oil change or tires due within 100 miles, or overdue)
                const dueItem = health.items.find(i => i.status === 'overdue' || i.status === 'due_soon' || i.milesRemaining <= 100);

                if (!dueItem) return;

                console.log(`🔧 [Predictive Maintenance] Vehicle ${dueItem.title} is due in ${Math.round(dueItem.milesRemaining)} miles. Querying corridor...`);

                const maintenanceSpots = await searchMaintenanceAlongRoute(
                    activeRoute.routeGeometry,
                    dueItem.category,
                    userLocation
                );

                if (maintenanceSpots && maintenanceSpots.length > 0) {
                    console.log(`🔧 [Predictive Maintenance] Found ${maintenanceSpots.length} auto shops along route corridor`);

                    // Drop custom 3D pins onto the MapLibre layer
                    setDiscoveredPlaces(maintenanceSpots);

                    const topSpot = maintenanceSpots[0];
                    const advisory: AmbientMaintenanceAdvisory = {
                        item: dueItem,
                        places: maintenanceSpots,
                        recommendedPlace: topSpot,
                        title: `${dueItem.icon} ${dueItem.title} Due Soon`,
                        description: `${Math.round(dueItem.milesRemaining)} mi remaining • ${maintenanceSpots.length} auto shops along your route`
                    };

                    setAmbientMaintenanceAdvisory(advisory);
                    speechService.speak(`Vehicle notice: ${dueItem.title} due in ${Math.round(dueItem.milesRemaining)} miles. Local service spots highlighted on your route.`);
                }
            } catch (err) {
                console.warn('[Predictive Maintenance] Ambient check failed:', err);
            }
        };

        checkAmbientMaintenance();
    }, [isNavigating, activeRoute, profile?.vehicle, userLocation, setDiscoveredPlaces]);

    const handleSelectMaintenanceStop = useCallback(async (place: Place) => {
        showNotification(`🔧 Adding ${place.name} as stop along route...`, 4000);
        speechService.speak(`Adding ${place.name} to route.`, { chime: 'turn' });
        setAmbientMaintenanceAdvisory(null);
        await handleStartNavigation(place.name);
    }, [handleStartNavigation, showNotification]);

    const handleDismissMaintenanceAdvisory = useCallback(() => {
        setAmbientMaintenanceAdvisory(null);
    }, []);

    // Predictive Geographic Caching: Preemptively cache map tiles for known dead zones along the upcoming route
    const hasCachedDeadZonesForRouteRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isNavigating || !activeRoute) {
            hasCachedDeadZonesForRouteRef.current = null;
            return;
        }

        const routeKey = `${activeRoute.destinationName}_${activeRoute.totalDistance}`;
        if (hasCachedDeadZonesForRouteRef.current === routeKey) return;
        hasCachedDeadZonesForRouteRef.current = routeKey;

        const intersectingDeadZones = findDeadZonesIntersectingRoute(activeRoute.routeGeometry);
        const uncached = intersectingDeadZones.filter(z => !z.isCached);

        if (uncached.length > 0) {
            console.log(`📦 [Predictive Caching] Route intersects ${uncached.length} known cellular dead zones. Proactively triggering background tile sync...`);
            uncached.forEach(zone => {
                syncDeadZoneTiles(zone).catch(err => console.warn('📦 Failed to delta sync dead zone:', err));
            });
            showNotification(`📦 Preemptively caching map tiles for ${uncached.length} cellular dead zone${uncached.length > 1 ? 's' : ''} along your route`, 4000);
        }
    }, [isNavigating, activeRoute, showNotification]);

    return {
        activeRoute,
        setActiveRoute,
        upcomingGuidance,
        setUpcomingGuidance,
        alternativeRoutes,
        setAlternativeRoutes,
        activeRouteIndex,
        setActiveRouteIndex,
        isRecalculatingRoutes,
        handleRecalculateRoutes,
        isNavigating,
        setIsNavigating,
        liveSpeedMph,
        navState,
        setNavState,
        betterRouteSuggestion,
        upcomingTollAlert,
        leaderDivertedPrompt,
        ambientMaintenanceAdvisory,
        handleSelectMaintenanceStop,
        handleDismissMaintenanceAdvisory,
        handleFollowLeader,
        handleKeepOriginalRoute,
        handleSwitchRoute,
        handleDismissReroute,
        handleTakeTollFreeExit,
        handleDismissTollAlert,
        handleStartNavigation,
        handleCancelNavigation,
        recalculateRoute,
        handleDiscovery,
        handleQuickSearch,
        approachingTripData,
        setApproachingTripData,
        completedTripData,
        setCompletedTripData,
        multiStopArrival,
        handleContinueAfterStop,
        handleDismissStopApproach,
        onTripCompleted,
        pendingTripResume,
        isResumingTrip,
        handleResumeTrip,
        handleDiscardTripResume,
        liveFuelSnapshot,
        lowFuelAlert,
        handleSelectGasStationStop: handleAddStop,
        handleAddStop,
        handleDismissLowFuelAlert,
        fuelUpdatePromptNonce,
        handleQuickFuelUpdate
    };
};
