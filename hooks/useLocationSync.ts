import React, { useState, useEffect, useRef, useCallback } from 'react';
import { geolocationService } from '../services/geolocationService';
import {
    updateMemberLocation,
    clearMemberLocations,
    subscribeToFamilyLocations,
    subscribeToMultipleCirclesLocations,
    getCircleColor,
    getUserProfile,
    FamilyCircle,
    MemberLocation,
    UserProfile
} from '../services/authService';
import { encryptLocation, decryptLocation, getFuzzyLocation, getNeighborhoodCentroid } from '../services/cryptoService';
import { detectTransition, getEntranceArrivalMessage, getGeofenceDisplayName, isPointInEntranceZone } from '../services/geofenceService';
import { getDistanceFromCoords } from '../utils/geo';
import { FamilyMember, PrivacyMode } from '../types';
import { recordTripPoint, getActiveTrip } from '../services/tripHistoryService';
import { broadcastGeofencePushAlert } from '../services/pushNotificationService';
import { speechService } from '../services/speechService';
import { batteryService } from '../services/batteryService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { registerDeadZone } from '../services/offlineLocationBuffer';
import { backgroundKeySyncService } from '../services/backgroundKeySyncService';
import { getCirclePrivacyMode, CirclePrivacyMode } from '../services/privacyService';
import { checkTier1MicroZone, resolveLocationStatus } from '../services/locationService';
import { parkingService } from '../services/parkingService';

export const useLocationSync = (
    user: any,
    profile: any,
    currentCircleId: string | undefined,
    geofences: any[] = [],
    onTransition?: (transition: any) => void,
    userCircles: FamilyCircle[] = [],
    activeFilterCircleId: string | 'all' = 'all'
) => {
    const [members, setMembers] = useState<FamilyMember[]>([]);
    const [hasInjectedSelf, setHasInjectedSelf] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);
    const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);

    // Initialize userLocation from Last Known if possible
    const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(() => {
        const saved = localStorage.getItem('myway_last_known_location');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                return null;
            }
        }
        return null;
    });

    const membersRef = useRef<FamilyMember[]>([]);
    const profilesCacheRef = useRef<Map<string, UserProfile>>(new Map());
    const fetchingProfilesRef = useRef<Set<string>>(new Set());

    // Keep ref in sync
    useEffect(() => {
        membersRef.current = members;
    }, [members]);
    const userLocationRef = useRef(userLocation);
    useEffect(() => {
        userLocationRef.current = userLocation;
    }, [userLocation]);
    const lastSyncRef = useRef<{ lat: number, lng: number, time: number }>({ lat: 0, lng: 0, time: 0 });
    const lastReactRenderRef = useRef<{
        lat: number;
        lng: number;
        speed: number;
        heading: number;
        status: string;
        time: number;
    }>({ lat: 0, lng: 0, speed: -1, heading: -1, status: '', time: 0 });
    const hasReceivedRealSignalRef = useRef(false);
    const poorSignalStartTimeRef = useRef<number | null>(null);
    const poorSignalAnchorRef = useRef<{ lat: number; lng: number } | null>(null);

    // 45-Second PENDING_EXIT Debounce State Machine (eliminates indoor GPS drift false departures)
    const pendingExitDebounceRef = useRef<Map<string, {
        timerId: ReturnType<typeof setTimeout>;
        startTime: number;
        fixCount: number;
        lastLocation: { lat: number; lng: number };
    }>>(new Map());

    // 2-fix confirmation window for Arrivals
    const pendingArrivalFixesRef = useRef<Map<string, { count: number }>>(new Map());

    // Fresh refs for asynchronous 45s departure timeout callbacks
    const userRef = useRef(user);
    const profileRef = useRef(profile);
    const currentCircleIdRef = useRef(currentCircleId);
    const onTransitionRef = useRef(onTransition);

    const geofencesRef = useRef(geofences);
    const userCirclesRef = useRef(userCircles);

    useEffect(() => {
        userRef.current = user;
        profileRef.current = profile;
        currentCircleIdRef.current = currentCircleId;
        onTransitionRef.current = onTransition;
        geofencesRef.current = geofences;
        userCirclesRef.current = userCircles;
    }, [user, profile, currentCircleId, onTransition, geofences, userCircles]);

    // Haversine distance — delegated to shared utils/geo.ts
    const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) =>
        getDistanceFromCoords(lat1, lon1, lat2, lon2);

    // 0. QUICK INJECT SELF FROM STALE LOCATION
    // Fixes the issue where the user doesn't show up until GPS locks.
    useEffect(() => {
        if (!user?.uid || hasInjectedSelf) return;

        if (userLocation) {
            setMembers(prev => {
                const cleaned = prev.filter(m => m.id !== 'demo-you' && m.id !== 'local-user' && m.id !== 'current_user' && m.id !== user.uid);
                const newSelf: FamilyMember = {
                    id: user.uid,
                    name: profile?.displayName || user.displayName || 'You',
                    avatar: getSafeAvatarUrl(profile?.photoURL || user.photoURL, profile?.displayName || user.displayName || user.uid),
                    location: userLocation,
                    status: 'Stationary',
                    battery: batteryService.getBatteryLevel(),
                    membershipTier: profile?.membershipTier || 'free',
                    lastUpdated: new Date().toISOString(),
                    accuracy: 2500, // Large uncertainty circle until real GPS corrects it
                    isGhostMode: false,
                    speed: 0,
                    heading: 0,
                    role: 'Primary',
                    safetyScore: 100,
                    pathHistory: [],
                    driveEvents: [],
                    isSelf: true
                };
                return [newSelf, ...cleaned];
            });
            setHasInjectedSelf(true);
        }
    }, [user?.uid, profile, userLocation, hasInjectedSelf]);

    // Continuous Real-Time Battery Sync
    useEffect(() => {
        const unsubscribe = batteryService.subscribe((info) => {
            if (user?.uid) {
                setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, battery: info.level, batteryLevel: info.level, isCharging: info.isCharging } : m));
            }
        });
        return () => unsubscribe();
    }, [user?.uid]);

    // Continuous Background E2EE Key Synchronization
    useEffect(() => {
        if (!user?.uid || !currentCircleId) return;
        backgroundKeySyncService.init(user.uid, currentCircleId);

        return () => {
            backgroundKeySyncService.stop();
        };
    }, [user?.uid, currentCircleId]);

    // 1. WATCH POSITION (GPS) & UPLOAD
    // Register geofences for background evaluation without restarting GPS watch
    useEffect(() => {
        geolocationService.setBackgroundGeofences(geofences, onTransitionRef.current);
    }, [geofences]);

    useEffect(() => {
        if (!geolocationService.isSupported()) {
            setLocationError('GPS not supported on this device');
            return;
        }

        // Register geofences for background evaluation and native notifications
        geolocationService.setBackgroundGeofences(geofencesRef.current, onTransitionRef.current);

        geolocationService.watchPosition((location) => {
            // This watcher can outlive an auth transition briefly. Resolve identity
            // at callback time so a pre-auth watcher cannot resurrect `local-user`
            // every time the stationary 30-second GPS update fires.
            const targetId = userRef.current?.uid || 'local-user';
            // Geofence Detection with Strict Accuracy Filtering, Dynamic Hysteresis Buffer & 45-Second PENDING_EXIT Debounce
            const activeGfs = geofencesRef.current || [];
            activeGfs.forEach(gf => {
                // 0. Granular Entrance Arrival Check (Driveway / Parking pin with rectangular footprint)
                const entranceLoc = gf.entrancePrecision?.location || gf.entranceLocation;
                if (gf.entranceType && entranceLoc) {
                    const isEntranceInside = isPointInEntranceZone(
                        { lat: location.latitude, lng: location.longitude },
                        gf.entrancePrecision,
                        gf.entranceLocation,
                        gf.entranceType
                    );
                    const storedEntranceStatus = localStorage.getItem(`gf_entrance_${gf.id}`);

                    if (isEntranceInside && storedEntranceStatus !== 'INSIDE') {
                        localStorage.setItem(`gf_entrance_${gf.id}`, 'INSIDE');

                        // Only notify entrance if not already confirmed INSIDE the main place geofence
                        const curConfirmed = localStorage.getItem(`gf_state_${gf.id}`);
                        if (curConfirmed !== 'INSIDE') {
                            const circleId = currentCircleIdRef.current || profileRef.current?.familyCircleId;
                            const uid = userRef.current?.uid;
                            const memberName = profileRef.current?.displayName || userRef.current?.displayName || 'You';

                            if (circleId && uid) {
                                broadcastGeofencePushAlert(
                                    circleId,
                                    uid,
                                    memberName,
                                    gf.name,
                                    'arrival',
                                    { lat: location.latitude, lng: location.longitude },
                                    gf.entranceType
                                ).catch(e => console.warn('Could not broadcast entrance push alert:', e));
                            }

                            const entranceMsg = getEntranceArrivalMessage(memberName, gf.name, gf.entranceType);
                            speechService.playChime('arrival');

                            onTransitionRef.current?.({
                                geofence: { ...gf, name: `${gf.name} (${entranceMsg.title})` },
                                from: 'OUTSIDE',
                                to: 'INSIDE',
                                timestamp: Date.now()
                            });
                        }
                    } else if (storedEntranceStatus === 'INSIDE') {
                        // Reset entrance state with 15m departure hysteresis buffer
                        const isStillInside = isPointInEntranceZone(
                            { lat: location.latitude, lng: location.longitude },
                            gf.entrancePrecision,
                            gf.entranceLocation,
                            gf.entranceType,
                            15
                        );
                        if (!isStillInside) {
                            localStorage.setItem(`gf_entrance_${gf.id}`, 'OUTSIDE');
                        }
                    }
                }

                const gfLat = gf?.location?.lat ?? gf?.lat;
                const gfLng = gf?.location?.lng ?? gf?.lng;
                if (typeof gfLat !== 'number' || typeof gfLng !== 'number') return;

                const distance = getDistanceFromCoords(location.latitude, location.longitude, gfLat, gfLng);
                const radius = gf.radius || 150;

                const storedStatus = localStorage.getItem(`gf_state_${gf.id}`);
                const isKnown = storedStatus !== null;
                const confirmedStatus = (storedStatus || 'OUTSIDE') as 'INSIDE' | 'OUTSIDE';

                // 1. STRICT ACCURACY FILTER FOR GEOFENCE EXITS
                // If the device is currently confirmed INSIDE a place, completely ignore any new location updates
                // where accuracy is greater than 65 meters. Do not use highly inaccurate cell-tower bounces to calculate geofence exits.
                if (confirmedStatus === 'INSIDE' && typeof location.accuracy === 'number' && location.accuracy > 65) {
                    console.log(`📍 Geofence Accuracy Filter: Ignored GPS ping (${location.accuracy}m > 65m limit) for exit evaluation at ${gf.name}`);
                    return;
                }

                // 2. DYNAMIC DEPARTURE HYSTERESIS BUFFER
                // Dynamic calculation: Math.max(15, radius * 0.5)
                // For a 15m driveway micro-geofence: 15m buffer -> requires drifting >= 30m away before exit threshold is breached.
                // For a 150m neighborhood zone: 75m buffer -> requires drifting >= 225m away.
                const departureHysteresis = confirmedStatus === 'INSIDE'
                    ? Math.max(15, Math.round(radius * 0.5))
                    : 0;
                const isInsideNow = distance <= (radius + departureHysteresis);
                const rawStatus: 'INSIDE' | 'OUTSIDE' = isInsideNow ? 'INSIDE' : 'OUTSIDE';

                if (!isKnown) {
                    // Prime initial state immediately on first run without triggering arrival/departure noise
                    localStorage.setItem(`gf_state_${gf.id}`, rawStatus);
                    console.log(`📍 Geofence Local: Primed ${gf.name} to ${rawStatus}`);
                    return;
                }

                // 3. TIME-BASED EXIT DEBOUNCE (45-Second PENDING_EXIT Window)
                if (confirmedStatus === 'INSIDE') {
                    if (rawStatus === 'OUTSIDE') {
                        // User has crossed the exit line (> radius + departureHysteresis)
                        const pending = pendingExitDebounceRef.current.get(gf.id);
                        if (!pending) {
                            // Initiate PENDING_EXIT state with 45-second debounce timer
                            console.log(`📍 Geofence: ${gf.name} entered PENDING_EXIT (dist: ${distance.toFixed(1)}m > ${radius + departureHysteresis}m). Starting 45s debounce timer.`);
                            const timerId = setTimeout(() => {
                                // Double check if still in pendingExitDebounceRef
                                const currentPending = pendingExitDebounceRef.current.get(gf.id);
                                if (!currentPending) return;
                                pendingExitDebounceRef.current.delete(gf.id);

                                // Verify stored status is still INSIDE
                                const currentConfirmed = localStorage.getItem(`gf_state_${gf.id}`);
                                if (currentConfirmed !== 'INSIDE') return;

                                // Officially commit OUTSIDE
                                localStorage.setItem(`gf_state_${gf.id}`, 'OUTSIDE');
                                localStorage.setItem(`gf_entrance_${gf.id}`, 'OUTSIDE');
                                console.log(`🚶 Geofence: Officially broadcast Left ${gf.name} after 45s debounce window (${currentPending.fixCount} fixes outside).`);

                                const circleId = currentCircleIdRef.current || profileRef.current?.familyCircleId;
                                const uid = userRef.current?.uid;
                                const departurePlace = getGeofenceDisplayName(gf);

                                // 1. Broadcast real-time push alert to circle devices and lock screens
                                if (circleId && uid) {
                                    broadcastGeofencePushAlert(
                                        circleId,
                                        uid,
                                        profileRef.current?.displayName || userRef.current?.displayName || 'You',
                                        departurePlace,
                                        'departure',
                                        currentPending.lastLocation
                                    ).catch(e => console.warn('Could not broadcast geofence push alert:', e));
                                }

                            // Spoken geofence audio feedback
                                speechService.playChime('turn');

                                // 4. Notify app listeners
                                onTransitionRef.current?.({
                                    geofence: gf,
                                    from: 'INSIDE',
                                    to: 'OUTSIDE',
                                    timestamp: Date.now()
                                });
                            }, 45000);

                            pendingExitDebounceRef.current.set(gf.id, {
                                timerId,
                                startTime: Date.now(),
                                fixCount: 1,
                                lastLocation: { lat: location.latitude, lng: location.longitude }
                            });
                        } else {
                            // Already in PENDING_EXIT window — record subsequent fix
                            pending.fixCount += 1;
                            pending.lastLocation = { lat: location.latitude, lng: location.longitude };
                            console.log(`📍 Geofence PENDING_EXIT: ${gf.name} (fix #${pending.fixCount}, elapsed: ${Math.round((Date.now() - pending.startTime) / 1000)}s / 45s, dist: ${distance.toFixed(1)}m)`);
                        }
                    } else {
                        // rawStatus === 'INSIDE': User is safely within geofence + hysteresis buffer
                        if (pendingExitDebounceRef.current.has(gf.id)) {
                            // GPS drifted back inside the geofence during the 45-second window!
                            // Silently clear the timeout and cancel the departure.
                            const pending = pendingExitDebounceRef.current.get(gf.id)!;
                            clearTimeout(pending.timerId);
                            pendingExitDebounceRef.current.delete(gf.id);
                            console.log(`📍 Geofence Debounce: User drifted back INSIDE ${gf.name} (${distance.toFixed(1)}m). Departure CANCELLED silently.`);
                        }
                    }
                } else {
                    // confirmedStatus === 'OUTSIDE'
                    // Clear any lingering pending exit state
                    if (pendingExitDebounceRef.current.has(gf.id)) {
                        const pending = pendingExitDebounceRef.current.get(gf.id)!;
                        clearTimeout(pending.timerId);
                        pendingExitDebounceRef.current.delete(gf.id);
                    }

                    if (rawStatus === 'INSIDE') {
                        // User entered the geofence! 2-fix confirmation for arrival
                        const pendingArrival = pendingArrivalFixesRef.current.get(gf.id) || { count: 0 };
                        pendingArrival.count += 1;
                        pendingArrivalFixesRef.current.set(gf.id, pendingArrival);

                        if (pendingArrival.count >= 2) {
                            pendingArrivalFixesRef.current.delete(gf.id);
                            localStorage.setItem(`gf_state_${gf.id}`, 'INSIDE');
                            console.log(`📍 Geofence: Confirmed Arrival at ${gf.name}.`);

                            const circleId = currentCircleIdRef.current || profileRef.current?.familyCircleId;
                            const uid = userRef.current?.uid;

                            // 1. Broadcast real-time push alert to circle devices and lock screens
                            if (circleId && uid) {
                                broadcastGeofencePushAlert(
                                    circleId,
                                    uid,
                                    profileRef.current?.displayName || userRef.current?.displayName || 'You',
                                    gf.name,
                                    'arrival',
                                    { lat: location.latitude, lng: location.longitude }
                                ).catch(e => console.warn('Could not broadcast geofence push alert:', e));
                            }

                            // Spoken geofence audio feedback
                            speechService.playChime('arrival');

                            // 4. Notify app listeners
                            onTransitionRef.current?.({
                                geofence: gf,
                                from: 'OUTSIDE',
                                to: 'INSIDE',
                                timestamp: Date.now()
                            });
                        } else {
                            console.log(`📍 Geofence Arrival: Detected fix #1 inside ${gf.name}, awaiting confirmation fix #2...`);
                        }
                    } else {
                        pendingArrivalFixesRef.current.delete(gf.id);
                    }
                }
            });

            // ACCURACY FILTER: Previously discarded poor signals entirely (>150m).
            // AUDIT FIX: Now accept signals up to 500m - the accuracy circle visualizes uncertainty.
            // Only discard truly unusable signals (>500m) to prevent wild jumps.
            // EXCEPT: First signal is ALWAYS accepted to ensure app recovers from no-location state.
            const isFirstSignal = !hasReceivedRealSignalRef.current;
            const MAX_ACCURACY_M = 500; // Raised from 150m for urban canyon/indoor tolerance

            if (location.accuracy > MAX_ACCURACY_M && !isFirstSignal) {
                console.log(`📍 GPS Filter: Skipping unusable signal (${location.accuracy}m > ${MAX_ACCURACY_M}m limit)`);
                return;
            }

            if (isFirstSignal) {
                console.log("📍 GPS Accepted: First real signal locked (", location.accuracy, "m)");
                hasReceivedRealSignalRef.current = true;
            } else if (location.signalQuality === 'poor') {
                console.log(`📍 GPS Accepted: Poor signal (${location.accuracy}m) - accuracy circle will show uncertainty`);
            }

            // ADAPTIVE SYNC: Adjust thresholds based on movement status for battery efficiency
            // Driving: speed > 5 mph
            // Walking: speed > 0.6 mph and <= 5 mph
            // Stationary: speed <= 0.6 mph
            const speedMph = Math.round(location.speed || 0);
            const heading = location.heading || 0;
            const status: 'Driving' | 'Walking' | 'Stationary' = (speedMph > 5) ? 'Driving' : (speedMph > 0.6) ? 'Walking' : 'Stationary';
            const currentCoords = { lat: location.latitude, lng: location.longitude };

            // Determine if user is currently inside any saved place zone or micro-zone (Tier 1)
            let currentPlaceName: string | undefined = undefined;
            const microMatch = checkTier1MicroZone(currentCoords);
            if (microMatch) {
                currentPlaceName = `${microMatch.place.name} (${microMatch.zoneName})`;
            } else if (geofences && geofences.length > 0) {
                for (const g of geofences) {
                    const gLat = g?.location?.lat ?? (g as any)?.lat;
                    const gLng = g?.location?.lng ?? (g as any)?.lng;
                    if (typeof gLat === 'number' && typeof gLng === 'number') {
                        const distM = getDistanceFromCoords(currentCoords.lat, currentCoords.lng, gLat, gLng);
                        const radiusM = g.radius || 150;
                        if (distM <= radiusM) {
                            currentPlaceName = g.name;
                            break;
                        }
                    }
                }
            }

            const effectiveStatus = (parkingService.isParkedInDriveway() && speedMph <= 1.5)
                ? 'Parked in Driveway'
                : resolveLocationStatus(currentCoords, {
                    status,
                    speed: speedMph,
                    currentPlace: currentPlaceName,
                    places: geofences
                });
            const resolvedLabel = effectiveStatus;

            // 1. MUTATE REF IN-PLACE FOR ZERO-LATENCY NON-REACT CONSUMERS (MapLibre 3D, Audio, Crash Telemetry)
            const selfInRef = membersRef.current.find(m => m.id === targetId);
            if (selfInRef) {
                selfInRef.location = { ...currentCoords, label: resolvedLabel };
                selfInRef.speed = speedMph;
                selfInRef.heading = heading;
                selfInRef.accuracy = location.accuracy;
                selfInRef.status = status;
                selfInRef.currentPlace = currentPlaceName;
                selfInRef.signalQuality = location.signalQuality;
                selfInRef.lastUpdated = new Date().toISOString();
            }

            // 2. RECORD TRIP TELEMETRY
            if (getActiveTrip()) {
                recordTripPoint(
                    location.latitude,
                    location.longitude,
                    speedMph,
                    heading
                );
            }

            // 2b. DYNAMIC LAST PARKED TELEMETRY EVALUATION
            parkingService.processTelemetry({
                userLocation: currentCoords,
                speedMph,
                status,
                places: geofences,
                user,
                profile,
                circleId: currentCircleId
            }).catch(e => {
                console.warn('[useLocationSync] Parking telemetry processing error:', e);
            });

            // 3. PERSIST LAST KNOWN LOCATION
            localStorage.setItem('myway_last_known_location', JSON.stringify(currentCoords));

            // 4. EVALUATE LOGICAL RECONCILIATION GATE (High-Frequency GPS Debounce)
            const distMovedFromLastReact = getDistanceMeters(
                lastReactRenderRef.current.lat, lastReactRenderRef.current.lng,
                location.latitude, location.longitude
            );
            const timeSinceLastReactMs = Date.now() - lastReactRenderRef.current.time;
            const statusChanged = status !== lastReactRenderRef.current.status;
            const speedDiff = Math.abs(speedMph - lastReactRenderRef.current.speed);
            const headingDiff = Math.abs(heading - lastReactRenderRef.current.heading);

            const isDrivingMode = (status === 'Driving') || (speedMph > 3);
            const minDistanceM = isDrivingMode ? 0.5 : (status === 'Walking') ? 3 : 8;
            const isSignificantMove = distMovedFromLastReact >= minDistanceM;
            const isSignificantSpeedChange = speedDiff >= 1;
            const isSignificantHeadingChange = isDrivingMode && (headingDiff >= 5);
            const isTimeThrottled = isDrivingMode ? (timeSinceLastReactMs >= 350) : (timeSinceLastReactMs >= 1500);

            const shouldTriggerReactRender = isFirstSignal || statusChanged || isSignificantMove || isSignificantSpeedChange || isSignificantHeadingChange || isTimeThrottled;

            if (shouldTriggerReactRender) {
                lastReactRenderRef.current = {
                    lat: location.latitude,
                    lng: location.longitude,
                    speed: speedMph,
                    heading,
                    status,
                    time: Date.now()
                };

                setLocationError(null);
                setUserLocation(currentCoords);

                setMembers(prev => {
                    const liveProfile = profileRef.current;
                    const liveUser = userRef.current;
                    const resolvedSelfName = liveProfile?.displayName || liveUser?.displayName;
                    const cleaned = prev.filter(m =>
                        m.id !== 'demo-you' &&
                        m.id !== 'current_user' &&
                        (targetId !== 'local-user' ? m.id !== 'local-user' : true) &&
                        // A remote member must never retain a stale self flag from a
                        // previous optimistic update or profile refresh.
                        (!m.isSelf || m.id === targetId)
                    );
                    const existing = cleaned.find(m => m.id === targetId);
                    const currentBattery = batteryService.getBatteryLevel();

                    if (!existing) {
                        const newSelf: FamilyMember = {
                            id: targetId,
                            name: resolvedSelfName || 'You',
                            avatar: getSafeAvatarUrl(liveProfile?.photoURL || liveUser?.photoURL, resolvedSelfName || targetId),
                            location: currentCoords,
                            status,
                            currentPlace: currentPlaceName,
                            battery: currentBattery,
                            batteryLevel: currentBattery,
                            isCharging: batteryService.getBatteryInfo().isCharging,
                            membershipTier: liveProfile?.membershipTier || 'free',
                            lastUpdated: new Date().toISOString(),
                            accuracy: location.accuracy,
                            isGhostMode: false,
                            speed: speedMph,
                            heading,
                            role: 'Primary',
                            safetyScore: 100,
                            pathHistory: [],
                            driveEvents: [],
                            isSelf: true
                        };
                        return [newSelf, ...cleaned.filter(m => m.id !== targetId)];
                    }

                    return cleaned.map(m =>
                        m.id === targetId ? {
                            ...m,
                            isSelf: true,
                            // Keep the established display name until a current profile
                            // is available. Do not flash the generic “You” fallback.
                            name: resolvedSelfName || m.name,
                            avatar: getSafeAvatarUrl(liveProfile?.photoURL || liveUser?.photoURL || m.avatar, resolvedSelfName || m.name),
                            location: currentCoords,
                            battery: currentBattery,
                            accuracy: location.accuracy,
                            speed: speedMph,
                            heading,
                            lastUpdated: new Date().toISOString(),
                            status,
                            currentPlace: currentPlaceName,
                            signalQuality: location.signalQuality
                        } : m
                    );
                });
            }

            // Predictive Geographic Caching: Track poor signal duration and register dead zones
            if (location.signalQuality === 'poor') {
                if (!poorSignalStartTimeRef.current) {
                    poorSignalStartTimeRef.current = Date.now();
                    poorSignalAnchorRef.current = { lat: location.latitude, lng: location.longitude };
                } else if (Date.now() - poorSignalStartTimeRef.current >= 2 * 60 * 1000) {
                    // Poor signal persisted for > 2 minutes: Register dead zone
                    const anchor = poorSignalAnchorRef.current || { lat: location.latitude, lng: location.longitude };
                    const durationSec = Math.round((Date.now() - poorSignalStartTimeRef.current) / 1000);
                    registerDeadZone(anchor, durationSec, 10);
                    // Reset start time anchor so it records continuously without spam
                    poorSignalStartTimeRef.current = Date.now();
                }
            } else {
                poorSignalStartTimeRef.current = null;
                poorSignalAnchorRef.current = null;
            }

            // 5. DEBOUNCE CHECK FOR FIREBASE SYNC (Adaptive Network Thresholds)
            const DIST_THRESHOLD = 15;
            const TIME_THRESHOLD = 30000;
            const distMoved = lastSyncRef.current.lat ? getDistanceMeters(
                lastSyncRef.current.lat, lastSyncRef.current.lng,
                currentCoords.lat, currentCoords.lng
            ) : 999;
            const timeElapsed = Date.now() - lastSyncRef.current.time;

            if (lastSyncRef.current.lat !== 0 && distMoved < DIST_THRESHOLD && timeElapsed < TIME_THRESHOLD) {
                return; // Skip network sync
            }

            // Sync to Firebase if in a circle
            if (user && currentCircleId && profile) {
                if (profile?.settings?.locationSharing === false) {
                    return; // Skip sync when location sharing disabled
                }
                const syncLocation = async () => {
                    const currentMembers = membersRef.current;
                    const self = currentMembers.find(m => m.id === user.uid);

                    const targetCircleIds = (userCircles && userCircles.length > 0)
                        ? Array.from(new Set(userCircles.map(c => c.id)))
                        : (currentCircleId ? [currentCircleId] : []);

                    if (targetCircleIds.length === 0) return;

                    for (const cId of targetCircleIds) {
                        // Evaluate granular privacy mode for THIS SPECIFIC circle
                        const circlePrivacyMode = getCirclePrivacyMode(cId);

                        if (circlePrivacyMode === 'invisible') {
                            await updateMemberLocation(cId, user.uid, {
                                lat: 0,
                                lng: 0,
                                speed: 0,
                                heading: 0,
                                accuracy: location.accuracy || 0,
                                timestamp: Date.now(),
                                battery: batteryService.getBatteryLevel(),
                                signalQuality: location.signalQuality,
                                status: 'Invisible',
                                privacyMode: 'invisible',
                                isSharingLocation: false,
                                locationSharing: false
                            });
                            continue;
                        }

                        let targetLat = location.latitude;
                        let targetLng = location.longitude;
                        let statusText = (parkingService.isParkedInDriveway() && (location.speed || 0) <= 1.5)
                            ? 'Parked in Driveway'
                            : (resolvedLabel || 'Online');
                        let blurredRadius: number | undefined = undefined;

                        if (circlePrivacyMode === 'blurred') {
                            const centroid = getNeighborhoodCentroid(location.latitude, location.longitude, `${user.uid}_${cId}`);
                            targetLat = centroid.lat;
                            targetLng = centroid.lng;
                            blurredRadius = 2400; // ~1.5 miles
                            statusText = 'In Neighborhood (Blurred)';
                        }

                        // Encrypt the target location if family key is established
                        let encrypted: string | null = null;
                        try {
                            encrypted = (targetLat !== 0 && targetLng !== 0)
                                ? await encryptLocation(targetLat, targetLng, cId)
                                : null;
                        } catch (e) {
                            // Non-critical: allow broadcast of location to family circle
                        }

                        await updateMemberLocation(cId, user.uid, {
                            lat: targetLat,
                            lng: targetLng,
                            speed: circlePrivacyMode === 'exact' ? (location.speed || 0) : 0,
                            heading: circlePrivacyMode === 'exact' ? (location.heading || 0) : 0,
                            accuracy: circlePrivacyMode === 'blurred' ? 2400 : (location.accuracy || 0),
                            timestamp: Date.now(),
                            battery: batteryService.getBatteryLevel(),
                            signalQuality: location.signalQuality,
                            encryptedData: encrypted || undefined,
                            status: statusText,
                            privacyMode: circlePrivacyMode,
                            blurredRadiusMeters: blurredRadius,
                            displayName: profile?.displayName || user.displayName || 'You',
                            photoURL: profile?.photoURL || user.photoURL || undefined,
                            role: profile?.role || 'Member',
                            isSharingLocation: true,
                            locationSharing: true
                        });
                    }
                };
                syncLocation();
            }
        });

        return () => {
            geolocationService.stopWatching();
            pendingExitDebounceRef.current.forEach(item => clearTimeout(item.timerId));
            pendingExitDebounceRef.current.clear();
            pendingArrivalFixesRef.current.clear();
        };
    }, [user?.uid, currentCircleId]);

    // Track geofence status per member ID -> Set<geofenceId>
    const memberInsideGeofencesRef = useRef<Map<string, Set<string>>>(new Map());
    // 2-fix confirmation tracking per member ID -> Map<geofenceId, { targetStatus, count }>
    const memberGeofencePendingFixesRef = useRef<Map<string, Map<string, { targetStatus: 'INSIDE' | 'OUTSIDE'; count: number }>>>(new Map());

    // 2. SUBSCRIBE TO CIRCLE MEMBERS & DECRYPT (MULTI-CIRCLE ENABLED)
    useEffect(() => {
        if (!user) return;

        const targetCircleIds = activeFilterCircleId === 'all'
            ? (userCircles && userCircles.length > 0 ? userCircles.map(c => c.id) : (currentCircleId ? [currentCircleId] : []))
            : [activeFilterCircleId];

        if (targetCircleIds.length === 0) return;

        const circleLocationsMap: Record<string, Record<string, MemberLocation>> = {};

        const unsubscribe = subscribeToMultipleCirclesLocations(targetCircleIds, async (cId, locations) => {
            circleLocationsMap[cId] = locations;

            const allLocations: Record<string, { loc: MemberLocation; circleId: string; circleName?: string; circleColor?: string }> = {};

            targetCircleIds.forEach(targetId => {
                const cObj = userCircles?.find(c => c.id === targetId);
                const cName = cObj?.name || 'Family';
                const cColor = cObj?.color || getCircleColor(targetId).hex;
                const locs = circleLocationsMap[targetId] || {};

                Object.keys(locs).forEach(memberId => {
                    allLocations[memberId] = {
                        loc: locs[memberId],
                        circleId: targetId,
                        circleName: cName,
                        circleColor: cColor
                    };
                });
            });

            const current = membersRef.current.filter(m =>
                m.id !== 'demo-you' &&
                m.id !== 'current_user' &&
                (user?.uid ? m.id !== 'local-user' : true) &&
                // Keep exactly one self identity: the authenticated Firebase UID.
                // This removes any short-lived optimistic alias before it can render.
                (!m.isSelf || m.id === user.uid)
            );

            // Membership is authoritative. Do not carry remote members from a
            // departed Circle forward merely because they were present in the
            // previous React state; that made former members reappear under a
            // generic "Family" badge after creating a new Circle.
            const circleMemberIds = targetCircleIds.flatMap(targetId => {
                const cObj = userCircles?.find(c => c.id === targetId);
                return cObj?.members || [];
            });

            const allMemberIds = Array.from(new Set([
                ...Object.keys(allLocations),
                ...circleMemberIds,
                user.uid
            ])).filter(id =>
                id !== 'demo-you' &&
                id !== 'current_user' &&
                (user?.uid ? id !== 'local-user' : true)
            );

            const activeCircleObj = userCircles?.find(c => c.id === currentCircleId);
            const defaultCircleName = activeCircleObj?.name || 'Family';
            const defaultCircleColor = activeCircleObj?.color || getCircleColor(currentCircleId || '').hex;

            const updatedMembers = await Promise.all(allMemberIds.map(async (id) => {
                const existing = current.find(m => m.id === id);
                const locInfo = allLocations[id];
                const memberCircleId = locInfo?.circleId || existing?.circleId || currentCircleId;
                const memberCircleName = locInfo?.circleName || existing?.circleName || defaultCircleName;
                const memberCircleColor = locInfo?.circleColor || existing?.circleColor || defaultCircleColor;

                if (id === user.uid) {
                    const userCircleBadges = (activeFilterCircleId === 'all' && userCircles && userCircles.length > 0)
                        ? userCircles.map(c => ({
                            id: c.id,
                            name: c.name,
                            color: c.color || getCircleColor(c.id).hex
                        }))
                        : [{ id: memberCircleId || '', name: memberCircleName, color: memberCircleColor }];

                    const liveProfile = profileRef.current;
                    const liveUser = userRef.current;
                    const resolvedSelfName = liveProfile?.displayName || liveUser?.displayName || existing?.name || 'You';
                    const selfSharing = liveProfile?.settings?.locationSharing !== false;
                    return {
                        ...(existing || {
                            id: user.uid,
                            name: resolvedSelfName,
                            avatar: getSafeAvatarUrl(liveProfile?.photoURL || liveUser?.photoURL, resolvedSelfName),
                            location: userLocation || { lat: 0, lng: 0 },
                            status: 'Stationary',
                            battery: batteryService.getBatteryLevel(),
                            membershipTier: liveProfile?.membershipTier || 'free',
                            lastUpdated: new Date().toISOString(),
                            accuracy: 15,
                            isGhostMode: false,
                            speed: 0,
                            heading: 0,
                            role: 'Primary',
                            safetyScore: 100,
                            pathHistory: [],
                            driveEvents: []
                        }),
                        name: resolvedSelfName,
                        avatar: getSafeAvatarUrl(liveProfile?.photoURL || liveUser?.photoURL, resolvedSelfName),
                        circleId: memberCircleId,
                        circleName: memberCircleName,
                        circleColor: memberCircleColor,
                        circleBadges: userCircleBadges,
                        isSelf: true,
                        activeViewerDeviceLabel: profile?.activeViewerDeviceLabel,
                        activeViewerDevicePlatform: profile?.activeViewerDevicePlatform,
                        isSharingLocation: selfSharing,
                        locationSharing: selfSharing
                    };
                }

                const loc = locInfo?.loc;

                // Cache profile if displayName or photoURL was broadcast in loc
                if (loc?.displayName) {
                    const existingProfile = profilesCacheRef.current.get(id) || { uid: id } as UserProfile;
                    existingProfile.displayName = loc.displayName;
                    if (loc.photoURL) existingProfile.photoURL = loc.photoURL;
                    if (loc.role) existingProfile.role = loc.role;
                    profilesCacheRef.current.set(id, existingProfile);
                }

                // Asynchronously fetch profile from users/${id} if not cached
                if (!profilesCacheRef.current.has(id) && !fetchingProfilesRef.current.has(id)) {
                    fetchingProfilesRef.current.add(id);
                    getUserProfile(id).then(userProfile => {
                        if (userProfile) {
                            profilesCacheRef.current.set(id, userProfile);
                            setMembers(prev => prev.map(m => {
                                if (m.id === id) {
                                    const name = userProfile.displayName || (userProfile as any).name || m.name;
                                    const avatar = userProfile.photoURL ? getSafeAvatarUrl(userProfile.photoURL, name) : m.avatar;
                                    return {
                                        ...m,
                                        name,
                                        avatar,
                                        role: (userProfile as any).role || m.role,
                                        activeViewerDeviceLabel: userProfile.activeViewerDeviceLabel,
                                        activeViewerDevicePlatform: userProfile.activeViewerDevicePlatform
                                    };
                                }
                                return m;
                            }));
                        }
                    }).catch(err => {
                        console.warn('[useLocationSync] Failed to fetch profile for member:', id, err);
                    });
                }

                const cachedProfile = profilesCacheRef.current.get(id);
                const resolvedName = loc?.displayName || cachedProfile?.displayName || (cachedProfile as any)?.name || (existing?.name && existing.name !== 'Circle Member' ? existing.name : undefined);
                const resolvedAvatar = loc?.photoURL
                    ? getSafeAvatarUrl(loc.photoURL, resolvedName || id)
                    : cachedProfile?.photoURL
                    ? getSafeAvatarUrl(cachedProfile.photoURL, resolvedName || id)
                    : (existing?.avatar && !existing.avatar.includes('default') ? existing.avatar : getDefaultAvatarDataUri(resolvedName || id));

                const member: FamilyMember = existing ? {
                    ...existing,
                    name: resolvedName || existing.name,
                    avatar: resolvedAvatar || existing.avatar,
                    role: cachedProfile?.role || loc?.role || existing.role || 'Member',
                    activeViewerDeviceLabel: cachedProfile?.activeViewerDeviceLabel,
                    activeViewerDevicePlatform: cachedProfile?.activeViewerDevicePlatform,
                    circleId: memberCircleId,
                    circleName: memberCircleName,
                    circleColor: memberCircleColor,
                    circleBadges: [{ id: memberCircleId || '', name: memberCircleName, color: memberCircleColor }]
                } : {
                    id,
                    name: resolvedName || 'Circle Member',
                    avatar: resolvedAvatar,
                    location: { lat: 0, lng: 0 },
                    status: 'Stationary',
                    battery: 100,
                    membershipTier: 'free',
                    lastUpdated: new Date().toISOString(),
                    accuracy: 15,
                    isGhostMode: false,
                    speed: 0,
                    heading: 0,
                    role: cachedProfile?.role || loc?.role || 'Member',
                    activeViewerDeviceLabel: cachedProfile?.activeViewerDeviceLabel,
                    activeViewerDevicePlatform: cachedProfile?.activeViewerDevicePlatform,
                    safetyScore: 100,
                    pathHistory: [],
                    driveEvents: [],
                    circleId: memberCircleId,
                    circleName: memberCircleName,
                    circleColor: memberCircleColor,
                    circleBadges: [{ id: memberCircleId || '', name: memberCircleName, color: memberCircleColor }]
                };

                if (!loc) {
                    return {
                        ...member,
                        isSharingLocation: false,
                        locationSharing: false
                    };
                }

                let lat = loc.lat;
                let lng = loc.lng;

                if (loc.encryptedData) {
                    try {
                        const decrypted = await decryptLocation(loc.encryptedData, memberCircleId);
                        if (decrypted && typeof decrypted.lat === 'number' && typeof decrypted.lng === 'number' && !(decrypted.lat === 0 && decrypted.lng === 0)) {
                            lat = decrypted.lat;
                            lng = decrypted.lng;
                        }
                    } catch (e) {
                        // Decryption failed or keys still syncing — keep plaintext loc.lat and loc.lng
                    }
                }

                // Circle Member Geofence Arrival / Departure Tracking with 2-Fix Confirmation Window
                let memberPlaceName: string | undefined = undefined;
                const currentGeofences = geofencesRef.current || [];
                if (currentGeofences.length > 0 && lat && lng && lat !== 0) {
                    let currentInside = memberInsideGeofencesRef.current.get(member.id);
                    const isFirstTracking = !currentInside;
                    if (!currentInside) {
                        currentInside = new Set<string>();
                        memberInsideGeofencesRef.current.set(member.id, currentInside);
                    }

                    let memberPendingMap = memberGeofencePendingFixesRef.current.get(member.id);
                    if (!memberPendingMap) {
                        memberPendingMap = new Map();
                        memberGeofencePendingFixesRef.current.set(member.id, memberPendingMap);
                    }

                    currentGeofences.forEach((gf) => {
                        const gfLat = gf?.entranceLocation?.lat ?? gf?.location?.lat ?? (gf as any)?.lat;
                        const gfLng = gf?.entranceLocation?.lng ?? gf?.location?.lng ?? (gf as any)?.lng;
                        if (typeof gfLat === 'number' && typeof gfLng === 'number') {
                            const distance = getDistanceFromCoords(lat, lng, gfLat, gfLng);
                            const radius = gf.radius || 150;
                            const wasInside = currentInside!.has(gf.id);
                            const confirmedStatus: 'INSIDE' | 'OUTSIDE' = wasInside ? 'INSIDE' : 'OUTSIDE';

                            // Strict accuracy filter: ignore updates >65m when evaluating departures
                            if (confirmedStatus === 'INSIDE' && typeof loc.accuracy === 'number' && loc.accuracy > 65) {
                                return;
                            }

                            // Dynamic Departure Hysteresis Buffer: Math.max(15, radius * 0.5)
                            const departureHysteresis = confirmedStatus === 'INSIDE'
                                ? Math.max(15, Math.round(radius * 0.5))
                                : 0;
                            const isInsideNow = distance <= (radius + departureHysteresis);
                            const candidateStatus: 'INSIDE' | 'OUTSIDE' = isInsideNow ? 'INSIDE' : 'OUTSIDE';

                            if (isInsideNow) {
                                memberPlaceName = gf.name;
                            }

                            if (isFirstTracking) {
                                if (isInsideNow) currentInside!.add(gf.id);
                            } else {
                                if (candidateStatus !== confirmedStatus) {
                                    const pending = memberPendingMap!.get(gf.id);
                                    if (pending && pending.targetStatus === candidateStatus) {
                                        pending.count += 1;
                                        if (pending.count >= 2) {
                                            // Confirmed after 2 consecutive fixes
                                            memberPendingMap!.delete(gf.id);
                                            if (candidateStatus === 'INSIDE') {
                                                currentInside!.add(gf.id);
                                                broadcastGeofencePushAlert(
                                                    memberCircleId || currentCircleId || '',
                                                    member.id,
                                                    member.name,
                                                    gf.name,
                                                    'arrival',
                                                    { lat, lng }
                                                ).catch(e => console.warn('Could not broadcast member geofence push alert:', e));
                                                speechService.playChime('arrival');
                                            } else {
                                                currentInside!.delete(gf.id);
                                                const departurePlace = getGeofenceDisplayName(gf);
                                                broadcastGeofencePushAlert(
                                                    memberCircleId || currentCircleId || '',
                                                    member.id,
                                                    member.name,
                                                    departurePlace,
                                                    'departure',
                                                    { lat, lng }
                                                ).catch(e => console.warn('Could not broadcast member geofence push alert:', e));
                                                speechService.playChime('turn');
                                            }
                                        }
                                    } else {
                                        memberPendingMap!.set(gf.id, { targetStatus: candidateStatus, count: 1 });
                                    }
                                } else {
                                    // Candidate matches confirmed state, reset jitter counter
                                    memberPendingMap!.delete(gf.id);
                                }
                            }
                        }
                    });
                }

                let memberStatus: 'Moving' | 'Stationary' | 'Driving' | 'Walking' | 'Offline' = 'Stationary';
                const speed = loc.speed || 0;
                if (speed > 25) {
                    memberStatus = 'Driving';
                } else if (speed > 3) {
                    memberStatus = 'Walking';
                } else if (speed > 0.5) {
                    memberStatus = 'Moving';
                }

                const memberMicro = checkTier1MicroZone({ lat, lng });
                if (memberMicro) {
                    memberPlaceName = `${memberMicro.place.name} (${memberMicro.zoneName})`;
                }

                const memberLabel = resolveLocationStatus({ lat, lng }, {
                    status: loc.status || memberStatus,
                    speed,
                    currentPlace: memberPlaceName
                });

                const isSharing = loc.isSharingLocation !== false && loc.locationSharing !== false && cachedProfile?.settings?.locationSharing !== false;

                return {
                    ...member,
                    isSelf: false,
                    location: { lat, lng, label: memberLabel },
                    battery: loc.battery !== undefined ? loc.battery : member.battery,
                    batteryLevel: loc.battery !== undefined ? loc.battery : member.batteryLevel,
                    isCharging: (loc as any).isCharging !== undefined ? (loc as any).isCharging : member.isCharging,
                    speed: loc.speed !== undefined ? loc.speed : member.speed,
                    heading: loc.heading !== undefined ? loc.heading : member.heading,
                    accuracy: loc.accuracy !== undefined ? loc.accuracy : member.accuracy,
                    lastUpdated: new Date(loc.timestamp).toISOString(),
                    status: loc.status || memberStatus,
                    currentPlace: memberPlaceName,
                    signalQuality: loc.signalQuality,
                    sosActive: !!loc.sosActive,
                    impact: loc.impact || undefined,
                    privacyMode: loc.privacyMode === 'blurred'
                        ? 'blurred'
                        : (loc.privacyMode === 'invisible' || loc.privacyMode === 'status_only' || loc.privacyMode === 'frozen' || loc.status?.includes('Invisible'))
                            ? 'invisible'
                            : 'exact',
                    blurredRadiusMeters: loc.blurredRadiusMeters,
                    isGhostMode: loc.privacyMode === 'invisible' || loc.privacyMode === 'status_only' || loc.privacyMode === 'frozen' || !!loc.status?.includes('Invisible'),
                    currentTrip: loc.currentTrip || null,
                    circleId: memberCircleId,
                    circleName: memberCircleName,
                    circleColor: memberCircleColor,
                    activeViewerDeviceLabel: cachedProfile?.activeViewerDeviceLabel,
                    activeViewerDevicePlatform: cachedProfile?.activeViewerDevicePlatform,
                    isSharingLocation: isSharing,
                    locationSharing: isSharing
                };
            }));

            setMembers(prev => {
                if (prev.length === updatedMembers.length && prev.every((m, idx) => {
                    const u = updatedMembers[idx];
                    return m.id === u.id &&
                           m.location.lat === u.location.lat &&
                           m.location.lng === u.location.lng &&
                           m.batteryLevel === u.batteryLevel &&
                           m.isCharging === u.isCharging &&
                           m.speed === u.speed &&
                           m.status === u.status &&
                           m.privacyMode === u.privacyMode &&
                           m.sosActive === u.sosActive &&
                           m.name === u.name &&
                           m.avatar === u.avatar &&
                           m.activeViewerDeviceLabel === u.activeViewerDeviceLabel &&
                           m.activeViewerDevicePlatform === u.activeViewerDevicePlatform &&
                           m.isSharingLocation === u.isSharingLocation &&
                           m.locationSharing === u.locationSharing;
                })) {
                    return prev;
                }
                return updatedMembers;
            });
        });

        return () => unsubscribe();
    }, [currentCircleId, user?.uid, activeFilterCircleId, (userCircles || []).map(c => c.id).sort().join(',')]);

    // 3. SYNC PROFILE CHANGES TO LOCAL SELF
    useEffect(() => {
        if (!user?.uid || !profile) return;

        const selfSharing = profile.settings?.locationSharing !== false;
        setMembers(prev => {
            const index = prev.findIndex(m => m.id === user.uid);
            if (index === -1) return prev;

            const updated = [...prev];
            updated[index] = {
                ...updated[index],
                name: profile.displayName || updated[index].name,
                avatar: getSafeAvatarUrl(profile.photoURL || updated[index].avatar, profile.displayName || updated[index].name || user.uid),
                membershipTier: profile.membershipTier || updated[index].membershipTier,
                activeViewerDeviceLabel: profile.activeViewerDeviceLabel,
                activeViewerDevicePlatform: profile.activeViewerDevicePlatform,
                isSharingLocation: selfSharing,
                locationSharing: selfSharing
            };
            return updated;
        });
    }, [profile?.displayName, profile?.photoURL, profile?.membershipTier, profile?.settings?.locationSharing, profile?.activeViewerDeviceLabel, profile?.activeViewerDevicePlatform, user?.uid]);

    const forcePublishLocation = useCallback(async (explicitSharingState?: boolean) => {
        if (!user?.uid) return;
        const sharingEnabled = explicitSharingState !== undefined
            ? explicitSharingState
            : profile?.settings?.locationSharing !== false;

        const targetCircleIds = (userCircles && userCircles.length > 0)
            ? Array.from(new Set(userCircles.map(c => c.id)))
            : (currentCircleId ? [currentCircleId] : []);

        if (targetCircleIds.length === 0) return;

        if (!sharingEnabled) {
            try {
                await clearMemberLocations(user.uid, targetCircleIds);
            } catch (err) {
                console.warn('[useLocationSync] Failed to clear member locations:', err);
            }
            return;
        }

        const coords = userLocationRef.current || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null);
        if (!coords || (coords.lat === 0 && coords.lng === 0)) return;

        for (const cId of targetCircleIds) {
            const circlePrivacyMode = getCirclePrivacyMode(cId);
            let targetLat = coords.lat;
            let targetLng = coords.lng;
            let statusText = 'Online';
            let blurredRadius: number | undefined = undefined;

            if (circlePrivacyMode === 'blurred') {
                const centroid = getNeighborhoodCentroid(coords.lat, coords.lng, `${user.uid}_${cId}`);
                targetLat = centroid.lat;
                targetLng = centroid.lng;
                blurredRadius = 2400;
                statusText = 'In Neighborhood (Blurred)';
            }

            let encrypted: string | null = null;
            try {
                encrypted = (targetLat !== 0 && targetLng !== 0)
                    ? await encryptLocation(targetLat, targetLng, cId)
                    : null;
            } catch (e) {
                // Ignore encryption failure
            }

            try {
                await updateMemberLocation(cId, user.uid, {
                    lat: targetLat,
                    lng: targetLng,
                    speed: 0,
                    heading: 0,
                    accuracy: circlePrivacyMode === 'blurred' ? 2400 : 15,
                    timestamp: Date.now(),
                    battery: batteryService.getBatteryLevel(),
                    signalQuality: 'strong',
                    encryptedData: encrypted || undefined,
                    status: statusText,
                    privacyMode: circlePrivacyMode,
                    blurredRadiusMeters: blurredRadius,
                    displayName: profile?.displayName || user.displayName || 'You',
                    photoURL: profile?.photoURL || user.photoURL || undefined,
                    role: profile?.role || 'Member',
                    isSharingLocation: true,
                    locationSharing: true
                });
            } catch (err) {
                console.warn('[useLocationSync] Failed to force publish member location for circle:', cId, err);
            }
        }
    }, [user?.uid, user?.displayName, user?.photoURL, profile?.displayName, profile?.photoURL, profile?.role, profile?.settings?.locationSharing, userCircles, currentCircleId, getCirclePrivacyMode, userLocation]);

    const prevLocationSharingRef = useRef<boolean | undefined>(profile?.settings?.locationSharing);
    useEffect(() => {
        if (!user?.uid) return;
        const currentSharing = profile?.settings?.locationSharing !== false;
        if (prevLocationSharingRef.current !== undefined && prevLocationSharingRef.current !== currentSharing) {
            prevLocationSharingRef.current = currentSharing;
            forcePublishLocation(currentSharing);
        } else {
            prevLocationSharingRef.current = currentSharing;
        }
    }, [profile?.settings?.locationSharing, user?.uid, forcePublishLocation]);

    return {
        members,
        setMembers,
        locationError,
        hasInitiallyCentered,
        setHasInitiallyCentered,
        userLocation,
        forcePublishLocation
    };
};
