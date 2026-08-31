import { useState, useEffect, useRef, useCallback } from 'react';
import { FamilyMember, Place, NavigationRoute } from '../types';
import { getRouteFromOSRM, geocodePlace, fetchRouteOptions } from '../services/osrmService';
import { searchGasStations, searchCoffeeShops, searchRestaurants, searchGroceryStores, searchPlacesText } from '../services/placesService';
import { searchPlacesOnMap } from '../services/geminiService';
import { updateNavigationState, NavigationState } from '../services/navigationEngine';
import { startTrip, recordTripPoint, recordDriveEvent, endTrip } from '../services/tripHistoryService';
import { startCrashMonitoring, stopCrashMonitoring, updateCrashDetectionSpeed } from '../services/crashDetectionService';
import { triggerSOS, clearSOS, updateMemberTrip } from '../services/authService';
import { audioService } from '../services/audioService';
import { speechService, ManeuverProximity } from '../services/speechService';
import { offlineMapService } from '../services/offlineMapService';
import { searchHistoryService } from '../services/searchHistoryService';
import { convoyService } from '../services/convoyService';

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

export const useNavigation = (
    user: any,
    profile: any,
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
    const [betterRouteSuggestion, setBetterRouteSuggestion] = useState<BetterRouteSuggestion | null>(null);
    const [upcomingTollAlert, setUpcomingTollAlert] = useState<UpcomingTollAlert | null>(null);
    const lastRerouteCheckTimeRef = useRef<number>(0);
    const lastTollAnnouncedStepRef = useRef<number>(-1);
    const [navState, setNavState] = useState<NavigationState>({
        currentStepIndex: 0,
        distanceToNextStep: 0,
        isOffRoute: false,
        hasArrived: false,
        splitIndex: 0
    });
    const [isNavigating, setIsNavigating] = useState(false);
    const navStateRef = useRef<NavigationState>(navState);
    const currentSpeedRef = useRef<number>(0);
    const lastAnnouncedProximityRef = useRef<ManeuverProximity | null>(null);
    const lastAnnouncedStepIndexRef = useRef<number>(-1);
    const lastSpeedWarningTimeRef = useRef<number>(0);
    const lastCameraAlertStepRef = useRef<number>(-1);
    const navigationStartTimeRef = useRef<number>(0);
    const isRecalculatingRef = useRef<boolean>(false);
    const lastOffRouteRecalcTimeRef = useRef<number>(0);

    useEffect(() => {
        navStateRef.current = navState;
    }, [navState]);

    const handleStartNavigation = useCallback(async (dest: string, destCoords?: { lat: number; lng: number }, precomputedRoute?: NavigationRoute) => {
        if (members.length === 0) return;

        try {
            showNotification(`🧭 Preparing navigation...`, 5000);

            if (members[0].location.lat === 0 && members[0].location.lng === 0) {
                showNotification("⚠️ Waiting for GPS lock...", 4000);
                return;
            }

            // Use provided coordinates if available, otherwise geocode the destination string
            const destLocation = destCoords || precomputedRoute?.destinationLoc || await geocodePlace(dest, members[0].location);
            if (!destLocation) {
                showNotification("❌ Destination not found.", 4000);
                return;
            }

            const route = precomputedRoute || await getRouteFromOSRM(members[0].location, dest, destLocation);
            if (!route || !route.steps) {
                showNotification("❌ Routing failed.", 4000);
                return;
            }

            // Record to recent search & navigation history
            searchHistoryService.addItem({
                query: dest,
                name: route.destinationName || dest,
                location: destLocation
            });

            navigationStartTimeRef.current = Date.now();
            setActiveRoute(route);
            setNavState({
                currentStepIndex: 0,
                distanceToNextStep: 0,
                isOffRoute: false,
                hasArrived: false,
                splitIndex: 0
            });
            setDriveMode(true);
            setIsNavigating(true);
            set3DMode(true);

            startTrip(members[0].location, dest);

            // Announce initial route start
            if (route.steps.length > 0) {
                const firstStep = route.steps[0];
                const rawDist = parseFloat(firstStep.distance.replace(/[^0-9.]/g, '')) || 50;
                const distM = firstStep.distance.includes('mi') ? rawDist * 1609 : firstStep.distance.includes('ft') ? rawDist * 0.3048 : rawDist;
                speechService.announceManeuver(firstStep.instruction, distM, 'initial', dest);
                lastAnnouncedStepIndexRef.current = 0;
                lastAnnouncedProximityRef.current = 'initial';
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
                    const loc = members[0]?.location || userLocation;
                    if (loc && loc.lat !== 0 && loc.lng !== 0) {
                        recordDriveEvent('hard_brake', loc);
                        showNotification('⚠️ Hard braking detected', 2500);
                    }
                },
                () => {
                    const loc = members[0]?.location || userLocation;
                    if (loc && loc.lat !== 0 && loc.lng !== 0) {
                        recordDriveEvent('rapid_accel', loc);
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
    }, [members, user, profile, showNotification, setDriveMode, set3DMode, setCrashCountdown, setEtaSharing, userLocation]);

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

        // Priority 5: Neighborhood fallback (Yadkin Road / Cottonade)
        console.warn(`📍 [Search] ⚠️ ALL sources exhausted — using Yadkin Road fallback (35.105, -78.966)`);
        return { lat: 35.105, lng: -78.966 };
    }, [userLocation, members, user?.uid]);

    const handleDiscovery = useCallback((query: string, onSelectPlace?: (place: Place) => void) => {
        const location = getActiveUserLocation();

        startSearchTransition(async () => {
            try {
                const results = await searchPlacesText(query, location);
                setDiscoveredPlaces([...userPlaces, ...results]);
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
                    results = await searchPlacesOnMap(query, location);
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

    // Navigation Engine Integration
    useEffect(() => {
        if (isNavigating && activeRoute && userLocation) {
            const selfSpeedMph = (members.find(m => m.id === user?.uid)?.speed || 0);
            const currentNavState = navStateRef.current;
            const newNavState = updateNavigationState(userLocation, activeRoute, currentNavState, undefined, selfSpeedMph);

            const selfSpeed = members.find(m => m.id === user?.uid)?.speed || 0;
            const selfHeading = members.find(m => m.id === user?.uid)?.heading || 0;
            currentSpeedRef.current = selfSpeed;
            recordTripPoint(userLocation.lat, userLocation.lng, selfSpeed, selfHeading);
            updateCrashDetectionSpeed(selfSpeed);

            const currentStep = activeRoute.steps[newNavState.currentStepIndex];
            const distToStep = newNavState.distanceToNextStep;

            // Turn-by-Turn Voice Synthesizer Alerts
            if (currentStep) {
                const isInitialGracePeriod = (Date.now() - navigationStartTimeRef.current) < 3500 && newNavState.currentStepIndex === 0;

                if (newNavState.currentStepIndex !== currentNavState.currentStepIndex) {
                    showNotification(`🔜 Next: ${currentStep.instruction}`, 4000);
                    speechService.announceManeuver(currentStep.instruction, distToStep, 'far', undefined, currentStep.lanes);
                    lastAnnouncedStepIndexRef.current = newNavState.currentStepIndex;
                    lastAnnouncedProximityRef.current = 'far';

                    // Safety Camera Alert for new maneuver segment
                    if (currentStep.hasCamera && lastCameraAlertStepRef.current !== newNavState.currentStepIndex) {
                        lastCameraAlertStepRef.current = newNavState.currentStepIndex;
                        speechService.announceSafetyCamera();
                        showNotification(`📷 Safety camera zone ahead`, 4000);
                    }
                } else if (lastAnnouncedStepIndexRef.current === newNavState.currentStepIndex && !isInitialGracePeriod) {
                    // Approach warning (500 ft / 160m)
                    if (distToStep <= 160 && distToStep > 50 && lastAnnouncedProximityRef.current !== 'near' && lastAnnouncedProximityRef.current !== 'immediate') {
                        speechService.announceManeuver(currentStep.instruction, distToStep, 'near', undefined, currentStep.lanes);
                        lastAnnouncedProximityRef.current = 'near';
                    }
                    // Immediate execution (150 ft / 45m)
                    else if (distToStep <= 45 && lastAnnouncedProximityRef.current !== 'immediate') {
                        speechService.announceManeuver(currentStep.instruction, distToStep, 'immediate');
                        lastAnnouncedProximityRef.current = 'immediate';
                    }
                }

                // Speed Limit Warning (> 10 mph over limit)
                const activeSpeedLimit = currentStep.speedLimit || 35;
                if (selfSpeedMph >= activeSpeedLimit + 10) {
                    const now = Date.now();
                    if (now - lastSpeedWarningTimeRef.current > 30000) {
                        lastSpeedWarningTimeRef.current = now;
                        speechService.announceSpeedWarning(activeSpeedLimit);
                        showNotification(`⚠️ Speed limit is ${activeSpeedLimit} MPH (You: ${Math.round(selfSpeedMph)} MPH)`, 4000);
                    }
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

            // Periodic in-drive alternative route discovery (every 90s)
            const now = Date.now();
            if (now - lastRerouteCheckTimeRef.current > 90000 && activeRoute.destinationLoc && !betterRouteSuggestion) {
                lastRerouteCheckTimeRef.current = now;
                fetchRouteOptions(userLocation, activeRoute.destinationName, activeRoute.destinationLoc)
                    .then(options => {
                        if (!options || options.length <= 1) return;
                        const currentRouteDuration = activeRoute.totalDurationSec || 0;
                        for (const alt of options) {
                            if (alt.id === activeRoute.id) continue;
                            const diffSec = currentRouteDuration - (alt.totalDurationSec || 0);
                            const timeSavedMin = Math.round(diffSec / 60);

                            if (timeSavedMin >= 3) {
                                setBetterRouteSuggestion({
                                    route: alt,
                                    timeSavedMin,
                                    savingsLabel: `Save ${timeSavedMin} min`,
                                    reason: `Faster route via ${alt.summary}`
                                });
                                speechService.speak(`Faster route found via ${alt.summary}. Saves ${timeSavedMin} minutes. Tap to switch.`, { chime: 'turn' });
                                break;
                            } else if (activeRoute.hasTolls && !alt.hasTolls && timeSavedMin >= -5) {
                                setBetterRouteSuggestion({
                                    route: alt,
                                    timeSavedMin: Math.max(0, timeSavedMin),
                                    savingsLabel: alt.savingsLabel || 'Save on Tolls',
                                    reason: `Toll-free route via ${alt.summary}`
                                });
                                speechService.speak(`Toll-free route available via ${alt.summary}. Tap to switch.`, { chime: 'turn' });
                                break;
                            }
                        }
                    })
                    .catch(err => console.warn('In-drive reroute check error:', err));
            }

            // --- AUTOMATIC OFF-ROUTE RE-ROUTING ---
            // If the driver takes a wrong turn or misses a waypoint, automatically calculate a fresh route to destination
            if (newNavState.isOffRoute && activeRoute.destinationLoc && !isRecalculatingRef.current) {
                const now = Date.now();
                if (now - lastOffRouteRecalcTimeRef.current > 4000) { // 4s cooldown to prevent API spam
                    lastOffRouteRecalcTimeRef.current = now;
                    isRecalculatingRef.current = true;
                    console.log('🔄 [Navigation] Off-route detected. Recalculating path to destination...');
                    showNotification('🔄 Recalculating route...', 3000);
                    speechService.speak('Recalculating route', { chime: 'turn' });

                    getRouteFromOSRM(userLocation, activeRoute.destinationName, activeRoute.destinationLoc)
                        .then(newRoute => {
                            isRecalculatingRef.current = false;
                            if (newRoute && newRoute.steps && newRoute.steps.length > 0) {
                                setActiveRoute(newRoute);
                                setNavState({
                                    currentStepIndex: 0,
                                    distanceToNextStep: 0,
                                    isOffRoute: false,
                                    hasArrived: false,
                                    splitIndex: 0
                                });
                                showNotification(`🔀 Rerouted via ${newRoute.summary || 'fastest path'}`, 3500);
                                if (newRoute.steps[0]) {
                                    speechService.announceManeuver(newRoute.steps[0].instruction, 50, 'initial');
                                    lastAnnouncedStepIndexRef.current = 0;
                                    lastAnnouncedProximityRef.current = 'initial';
                                }

                                // Hive-Mind Fleet Routing: If current user is Convoy Leader, broadcast reroute to caravan followers
                                const activeConvoy = convoyService.getActiveConvoy();
                                const currentUid = user?.uid || members[0]?.id || 'self';
                                if (activeConvoy && activeConvoy.isActive && activeConvoy.leaderId === currentUid) {
                                    convoyService.broadcastReroute(newRoute, profile?.familyCircleId);
                                    showNotification(`📡 Fleet Reroute broadcasted to caravan followers`, 4000);
                                }
                            }
                        })
                        .catch(err => {
                            isRecalculatingRef.current = false;
                            console.warn('[Navigation] Off-route recalculation failed:', err);
                        });
                }
            }

            if (newNavState.hasArrived && !currentNavState.hasArrived) {
                showNotification(`🎯 Arrived! Safety Score: ${safetyScore}%`, 6000);
                speechService.announceManeuver('', 0, 'arrival', activeRoute.destinationName);
                endTrip(userLocation || undefined);
                stopCrashMonitoring();
                setEtaSharing(false);

                // Auto-resolve SOS if active upon safe destination arrival
                const selfMember = members.find(m => m.id === user?.uid);
                if (selfMember?.sosActive && profile?.familyCircleId && user?.uid) {
                    clearSOS(profile.familyCircleId, user.uid);
                    showNotification('🛡️ Emergency resolved: Arrived safely at destination.', 8000);
                }

                if (profile?.familyCircleId && user?.uid) {
                    updateMemberTrip(profile.familyCircleId, user.uid, null).catch(() => {});
                }
                setTimeout(() => {
                    setDriveMode(false);
                    setIsNavigating(false);
                    setActiveRoute(null);
                    setBetterRouteSuggestion(null);
                    setUpcomingTollAlert(null);
                }, 5000);
            }

            setNavState(newNavState);
        }
    }, [userLocation, isNavigating, activeRoute, safetyScore, members, user?.uid, profile?.familyCircleId, showNotification, setDriveMode, setEtaSharing, betterRouteSuggestion, upcomingTollAlert]);

    // Reroute actions
    const handleSwitchRoute = useCallback((newRoute: NavigationRoute) => {
        setActiveRoute(newRoute);
        setNavState({
            currentStepIndex: 0,
            distanceToNextStep: 0,
            isOffRoute: false,
            hasArrived: false,
            splitIndex: 0
        });
        setBetterRouteSuggestion(null);
        showNotification(`🔀 Switched to ${newRoute.routeLabel || 'alternative route'}!`, 4000);
        speechService.speak(`Rerouting to ${newRoute.summary}`, { chime: 'turn' });
    }, [showNotification]);

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
                setActiveRoute(tollFreeRoute);
                setNavState({
                    currentStepIndex: 0,
                    distanceToNextStep: 0,
                    isOffRoute: false,
                    hasArrived: false,
                    splitIndex: 0
                });
                setUpcomingTollAlert(null);
                setBetterRouteSuggestion(null);
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

    // Cleanup & Cancel Navigation
    const handleCancelNavigation = useCallback(() => {
        endTrip(userLocation || undefined);
        stopCrashMonitoring();
        setEtaSharing(false);
        setDriveMode(false);
        setIsNavigating(false);
        setActiveRoute(null);
        setBetterRouteSuggestion(null);
        setUpcomingTollAlert(null);
        if (profile?.familyCircleId && user?.uid) {
            updateMemberTrip(profile.familyCircleId, user.uid, null).catch(() => {});
        }
    }, [userLocation, setDriveMode, setEtaSharing, profile?.familyCircleId, user?.uid]);

    // Rerouting logic
    const lastRerouteRef = useRef<number>(0);
    const rerouteAttemptsRef = useRef<number>(0);
    const MAX_REROUTE_ATTEMPTS = 3;

    useEffect(() => {
        if (isNavigating && navState.isOffRoute && activeRoute) {
            const now = Date.now();
            if (now - lastRerouteRef.current < 10000) return;
            if (rerouteAttemptsRef.current >= MAX_REROUTE_ATTEMPTS) {
                showNotification("⚠️ Unable to find route.", 6000);
                return;
            }
            lastRerouteRef.current = now;
            rerouteAttemptsRef.current += 1;
            showNotification(`🔄 Off route! Recalculating...`, 4000);
            speechService.announceManeuver('', 0, 'reroute');
            handleStartNavigation(activeRoute.destinationName);
        } else if (isNavigating && !navState.isOffRoute) {
            rerouteAttemptsRef.current = 0;
        }
    }, [isNavigating, navState.isOffRoute, activeRoute, handleStartNavigation, showNotification]);

    // Hive-Mind Fleet Routing: 10-Second Countdown Decision Engine
    const [leaderDivertedPrompt, setLeaderDivertedPrompt] = useState<LeaderDivertedPrompt | null>(null);
    const leaderPromptTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearLeaderPromptTimer = useCallback(() => {
        if (leaderPromptTimerRef.current) {
            clearInterval(leaderPromptTimerRef.current);
            leaderPromptTimerRef.current = null;
        }
    }, []);

    const handleFollowLeader = useCallback(() => {
        clearLeaderPromptTimer();
        setLeaderDivertedPrompt((prev) => {
            if (!prev) return null;
            console.log('📡 [Convoy Follower] Following Convoy Leader Route:', prev.newRoute);
            setActiveRoute(prev.newRoute);
            setNavState({
                currentStepIndex: 0,
                distanceToNextStep: 0,
                isOffRoute: false,
                hasArrived: false,
                splitIndex: 0
            });
            showNotification(`🔀 Following leader on route via ${prev.newRoute.summary || 'new path'}`, 5000);
            speechService.speak(`Following leader onto updated route.`, { chime: 'turn' });
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
                    setActiveRoute(newRoute);
                    setNavState({
                        currentStepIndex: 0,
                        distanceToNextStep: 0,
                        isOffRoute: false,
                        hasArrived: false,
                        splitIndex: 0
                    });
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

    return {
        activeRoute,
        setActiveRoute,
        isNavigating,
        setIsNavigating,
        navState,
        setNavState,
        betterRouteSuggestion,
        upcomingTollAlert,
        leaderDivertedPrompt,
        handleFollowLeader,
        handleKeepOriginalRoute,
        handleSwitchRoute,
        handleDismissReroute,
        handleTakeTollFreeExit,
        handleDismissTollAlert,
        handleStartNavigation,
        handleCancelNavigation,
        handleDiscovery,
        handleQuickSearch
    };
};
