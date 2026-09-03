import React, { useState, useEffect, useRef } from 'react';
import { geolocationService } from '../services/geolocationService';
import {
    updateMemberLocation,
    subscribeToFamilyLocations,
    subscribeToMultipleCirclesLocations,
    getCircleColor,
    getUserProfile,
    FamilyCircle,
    MemberLocation,
    UserProfile
} from '../services/authService';
import { encryptLocation, decryptLocation, getFuzzyLocation, getNeighborhoodCentroid } from '../services/cryptoService';
import { detectTransition } from '../services/geofenceService';
import { getDistanceFromCoords } from '../utils/geo';
import { FamilyMember, PrivacyMode } from '../types';
import { useUI } from '../contexts/UIContext';
import { recordTripPoint, getActiveTrip } from '../services/tripHistoryService';
import { bufferMessage } from '../services/offlineMessageBuffer';
import { broadcastGeofencePushAlert } from '../services/pushNotificationService';
import { speechService } from '../services/speechService';
import { batteryService } from '../services/batteryService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { registerDeadZone } from '../services/offlineLocationBuffer';
import { backgroundKeySyncService } from '../services/backgroundKeySyncService';
import { getCirclePrivacyMode, CirclePrivacyMode } from '../services/privacyService';

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
    // 2-fix confirmation window to prevent indoor GPS jitter toggling at 15m micro-geofence
    const selfGeofencePendingFixesRef = useRef<Map<string, { targetStatus: 'INSIDE' | 'OUTSIDE'; count: number }>>(new Map());

    // Haversine distance — delegated to shared utils/geo.ts
    const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) =>
        getDistanceFromCoords(lat1, lon1, lat2, lon2);

    const { isLowDataMode } = useUI();

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
                    driveEvents: []
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
                setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, battery: info.level } : m));
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
    useEffect(() => {
        if (!geolocationService.isSupported()) {
            setLocationError('GPS not supported on this device');
            return;
        }

        // Target ID defaults to user.uid or 'local-user' for guest / initial startup
        const targetId = user?.uid || 'local-user';

        // Register geofences for background evaluation and native notifications
        geolocationService.setBackgroundGeofences(geofences, onTransition);

        geolocationService.watchPosition((location) => {
            // Geofence Detection with 2-Fix Confirmation Window (Drift Tolerance for 15m micro-geofences)
            geofences.forEach(gf => {
                const gfLat = gf?.location?.lat ?? gf?.lat;
                const gfLng = gf?.location?.lng ?? gf?.lng;
                if (typeof gfLat !== 'number' || typeof gfLng !== 'number') return;

                const distance = getDistanceFromCoords(location.latitude, location.longitude, gfLat, gfLng);
                const radius = gf.radius || 150;

                const storedStatus = localStorage.getItem(`gf_state_${gf.id}`);
                const isKnown = storedStatus !== null;
                const confirmedStatus = (storedStatus || 'OUTSIDE') as 'INSIDE' | 'OUTSIDE';

                // Departure Hysteresis Buffer: +3m for micro-geofences (<= 30m), scaled up to max 15m for larger zones
                // When already confirmed INSIDE, exit requires crossing (radius + 3m) to eliminate driveway edge jitter
                const departureHysteresis = confirmedStatus === 'INSIDE'
                    ? (radius <= 30 ? 3 : Math.min(15, Math.round(radius * 0.1)))
                    : 0;
                const isInsideNow = distance <= (radius + departureHysteresis);
                const rawStatus: 'INSIDE' | 'OUTSIDE' = isInsideNow ? 'INSIDE' : 'OUTSIDE';

                if (!isKnown) {
                    // Prime initial state immediately on first run without triggering arrival/departure noise
                    localStorage.setItem(`gf_state_${gf.id}`, rawStatus);
                    selfGeofencePendingFixesRef.current.delete(gf.id);
                    console.log(`📍 Geofence Local: Primed ${gf.name} to ${rawStatus}`);
                } else if (rawStatus !== confirmedStatus) {
                    // Requires 2 consecutive fixes in new state to confirm transition (prevents GPS jitter drift at 15m micro-geofence)
                    const pending = selfGeofencePendingFixesRef.current.get(gf.id);
                    if (pending && pending.targetStatus === rawStatus) {
                        pending.count += 1;
                        if (pending.count >= 2) {
                            // Confirmed transition after 2 fixes!
                            localStorage.setItem(`gf_state_${gf.id}`, rawStatus);
                            selfGeofencePendingFixesRef.current.delete(gf.id);

                            const isInside = rawStatus === 'INSIDE';
                            const circleId = currentCircleId || profile?.familyCircleId;

                            // Broadcast real-time push alert to all circle devices and lock screens
                            if (circleId && user?.uid) {
                                broadcastGeofencePushAlert(
                                    circleId,
                                    user.uid,
                                    profile?.displayName || user.displayName || 'You',
                                    gf.name,
                                    isInside ? 'arrival' : 'departure',
                                    { lat: location.latitude, lng: location.longitude }
                                ).catch(e => console.warn('Could not broadcast geofence push alert:', e));
                            }

                            // Offline failover: Queue geofence alert to IndexedDB for circle sync
                            if (typeof navigator !== 'undefined' && !navigator.onLine && circleId && user?.uid) {
                                const text = `${isInside ? '📍 Arrived at' : '🚶 Departed from'} ${gf.name}`;
                                bufferMessage({
                                    clientMessageId: `gf_${Date.now()}_${gf.id}`,
                                    circleId,
                                    senderId: user.uid,
                                    content: text,
                                    type: 'geofence',
                                    timestamp: Date.now(),
                                    status: 'queued'
                                }).catch(err => console.error('Failed to buffer offline geofence alert:', err));
                            }

                            // Spoken geofence audio feedback
                            speechService.speak(
                                isInside ? `Arrived at ${gf.name}` : `Departed ${gf.name}`,
                                { chime: isInside ? 'arrival' : 'turn' }
                            );

                            onTransition?.({
                                geofence: gf,
                                from: confirmedStatus,
                                to: rawStatus,
                                timestamp: Date.now()
                            });
                        }
                    } else {
                        // First fix in candidate state - start 2-fix confirmation window
                        selfGeofencePendingFixesRef.current.set(gf.id, { targetStatus: rawStatus, count: 1 });
                    }
                } else {
                    // Position returned to confirmed state - clear jitter counter
                    selfGeofencePendingFixesRef.current.delete(gf.id);
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

            // Determine if user is currently inside any saved place zone
            let currentPlaceName: string | undefined = undefined;
            if (geofences && geofences.length > 0) {
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

            // 1. MUTATE REF IN-PLACE FOR ZERO-LATENCY NON-REACT CONSUMERS (MapLibre 3D, Audio, Crash Telemetry)
            const selfInRef = membersRef.current.find(m => m.id === targetId);
            if (selfInRef) {
                selfInRef.location = currentCoords;
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
                    const cleaned = prev.filter(m => 
                        m.id !== 'demo-you' && 
                        m.id !== 'current_user' && 
                        (user?.uid ? m.id !== 'local-user' : true)
                    );
                    const existing = cleaned.find(m => m.id === targetId);
                    const currentBattery = batteryService.getBatteryLevel();

                    if (!existing) {
                        const newSelf: FamilyMember = {
                            id: targetId,
                            name: profile?.displayName || user?.displayName || 'You',
                            avatar: getSafeAvatarUrl(profile?.photoURL || user?.photoURL, profile?.displayName || user?.displayName || targetId),
                            location: currentCoords,
                            status,
                            currentPlace: currentPlaceName,
                            battery: currentBattery,
                            membershipTier: profile?.membershipTier || 'free',
                            lastUpdated: new Date().toISOString(),
                            accuracy: location.accuracy,
                            isGhostMode: false,
                            speed: speedMph,
                            heading,
                            role: 'Primary',
                            safetyScore: 100,
                            pathHistory: [],
                            driveEvents: []
                        };
                        return [newSelf, ...cleaned.filter(m => m.id !== targetId)];
                    }

                    return cleaned.map(m =>
                        m.id === targetId ? {
                            ...m,
                            name: profile?.displayName || user?.displayName || m.name,
                            avatar: getSafeAvatarUrl(profile?.photoURL || user?.photoURL || m.avatar, profile?.displayName || user?.displayName || m.name),
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
            if (lastSyncRef.current.lat !== 0 && distMoved < DIST_THRESHOLD && timeElapsed < TIME_THRESHOLD) {
                return; // Skip network sync
            }

            // Sync to Firebase if in a circle
            if (user && currentCircleId && profile) {
                const syncLocation = async () => {
                    const currentMembers = membersRef.current;
                    const self = currentMembers.find(m => m.id === user.uid);

                    // Check if inside any geofence for status_only mode
                    let insideGeofenceName: string | null = null;
                    let insideGeofenceCoords: { lat: number; lng: number } | null = null;
                    if (geofences && geofences.length > 0) {
                        for (const gf of geofences) {
                            const gfLat = gf?.location?.lat ?? gf?.lat;
                            const gfLng = gf?.location?.lng ?? gf?.lng;
                            if (typeof gfLat === 'number' && typeof gfLng === 'number') {
                                const distToGf = getDistanceFromCoords(location.latitude, location.longitude, gfLat, gfLng);
                                if (distToGf <= (gf.radius || 150)) {
                                    insideGeofenceName = gf.name;
                                    insideGeofenceCoords = { lat: gfLat, lng: gfLng };
                                    break;
                                }
                            }
                        }
                    }

                    const targetCircleIds = (userCircles && userCircles.length > 0)
                        ? Array.from(new Set(userCircles.map(c => c.id)))
                        : (currentCircleId ? [currentCircleId] : []);

                    if (targetCircleIds.length === 0) return;

                    for (const cId of targetCircleIds) {
                        // Evaluate granular privacy mode for THIS SPECIFIC circle
                        const circlePrivacyMode = getCirclePrivacyMode(cId);

                        // If frozen, skip coordinate updates to freeze location at current place
                        if (circlePrivacyMode === 'frozen') {
                            await updateMemberLocation(cId, user.uid, {
                                lat: 0,
                                lng: 0,
                                speed: 0,
                                heading: 0,
                                accuracy: location.accuracy || 0,
                                timestamp: Date.now(),
                                battery: batteryService.getBatteryLevel(),
                                signalQuality: location.signalQuality,
                                status: '❄️ Location Paused (Ghost)',
                                privacyMode: 'frozen'
                            });
                            continue;
                        }

                        let targetLat = location.latitude;
                        let targetLng = location.longitude;
                        let statusText = 'Online';
                        let blurredRadius: number | undefined = undefined;

                        if (circlePrivacyMode === 'blurred') {
                            const centroid = getNeighborhoodCentroid(location.latitude, location.longitude, `${user.uid}_${cId}`);
                            targetLat = centroid.lat;
                            targetLng = centroid.lng;
                            blurredRadius = 2400; // ~1.5 miles
                            statusText = 'In Neighborhood (Blurred)';
                        } else if (circlePrivacyMode === 'status_only') {
                            if (insideGeofenceName && insideGeofenceCoords) {
                                targetLat = insideGeofenceCoords.lat;
                                targetLng = insideGeofenceCoords.lng;
                                statusText = `At ${insideGeofenceName}`;
                            } else {
                                targetLat = 0;
                                targetLng = 0;
                                statusText = (location.speed && location.speed > 5)
                                    ? `Driving (${Math.round(location.speed)} MPH)`
                                    : (location.speed && location.speed > 0.6)
                                    ? 'Moving (Walking)'
                                    : 'Stationary';
                            }
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
                            role: profile?.role || 'Member'
                        });
                    }
                };
                syncLocation();
            }
        });

        return () => geolocationService.stopWatching();
    }, [user, currentCircleId, userCircles, profile, geofences]);

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
                (user?.uid ? m.id !== 'local-user' : true)
            );

            // Collect unique member IDs from current state, Firebase locations, AND circle membership
            const circleMemberIds = targetCircleIds.flatMap(targetId => {
                const cObj = userCircles?.find(c => c.id === targetId);
                return cObj?.members || [];
            });

            const allMemberIds = Array.from(new Set([
                ...current.map(m => m.id),
                ...Object.keys(allLocations),
                ...circleMemberIds
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

                    return {
                        ...(existing || {
                            id: user.uid,
                            name: profile?.displayName || user.displayName || 'You',
                            avatar: getSafeAvatarUrl(profile?.photoURL || user.photoURL, profile?.displayName || user.displayName || user.uid),
                            location: userLocation || { lat: 0, lng: 0 },
                            status: 'Stationary',
                            battery: batteryService.getBatteryLevel(),
                            membershipTier: profile?.membershipTier || 'free',
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
                        name: profile?.displayName || user.displayName || 'You',
                        avatar: getSafeAvatarUrl(profile?.photoURL || user.photoURL, profile?.displayName || user.displayName || user.uid),
                        circleId: memberCircleId,
                        circleName: memberCircleName,
                        circleColor: memberCircleColor,
                        circleBadges: userCircleBadges
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
                                        role: userProfile.role || m.role
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
                    safetyScore: 100,
                    pathHistory: [],
                    driveEvents: [],
                    circleId: memberCircleId,
                    circleName: memberCircleName,
                    circleColor: memberCircleColor,
                    circleBadges: [{ id: memberCircleId || '', name: memberCircleName, color: memberCircleColor }]
                };

                if (!loc) return member;

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
                if (geofences && geofences.length > 0 && lat && lng && lat !== 0) {
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

                    geofences.forEach((gf) => {
                        const gfLat = gf?.location?.lat ?? (gf as any)?.lat;
                        const gfLng = gf?.location?.lng ?? (gf as any)?.lng;
                        if (typeof gfLat === 'number' && typeof gfLng === 'number') {
                            const distance = getDistanceFromCoords(lat, lng, gfLat, gfLng);
                            const radius = gf.radius || 150;
                            const wasInside = currentInside!.has(gf.id);
                            const confirmedStatus: 'INSIDE' | 'OUTSIDE' = wasInside ? 'INSIDE' : 'OUTSIDE';

                            // Departure Hysteresis Buffer: +3m for micro-geofences (<= 30m), scaled up to max 15m for larger zones
                            // When already confirmed INSIDE, exit requires crossing (radius + 3m) to eliminate driveway edge jitter
                            const departureHysteresis = confirmedStatus === 'INSIDE'
                                ? (radius <= 30 ? 3 : Math.min(15, Math.round(radius * 0.1)))
                                : 0;
                            const isInsideNow = distance <= (radius + departureHysteresis);
                            const candidateStatus: 'INSIDE' | 'OUTSIDE' = isInsideNow ? 'INSIDE' : 'OUTSIDE';

                            if (isInsideNow) {
                                memberPlaceName = gf.name;
                            }

                            if (isFirstTracking) {
                                if (isInsideNow) currentInside!.add(gf.id);
                            } else {
                                const confirmedStatus: 'INSIDE' | 'OUTSIDE' = wasInside ? 'INSIDE' : 'OUTSIDE';
                                if (candidateStatus !== confirmedStatus) {
                                    const pending = memberPendingMap!.get(gf.id);
                                    if (pending && pending.targetStatus === candidateStatus) {
                                        pending.count += 1;
                                        if (pending.count >= 2) {
                                            // Confirmed after 2 consecutive fixes
                                            memberPendingMap!.delete(gf.id);
                                            if (candidateStatus === 'INSIDE') {
                                                currentInside!.add(gf.id);
                                                const arrivalTitle = `📍 Arrival: ${member.name}`;
                                                const arrivalBody = `${member.name} has arrived at ${gf.name}`;
                                                broadcastGeofencePushAlert('arrival', member.name, gf.name);
                                                speechService.speak(arrivalBody);
                                            } else {
                                                currentInside!.delete(gf.id);
                                                const departureTitle = `🚶 Departure: ${member.name}`;
                                                const departureBody = `${member.name} left ${gf.name}`;
                                                broadcastGeofencePushAlert('departure', member.name, gf.name);
                                                speechService.speak(departureBody);
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

                return {
                    ...member,
                    location: { lat, lng },
                    battery: loc.battery !== undefined ? loc.battery : member.battery,
                    speed: loc.speed !== undefined ? loc.speed : member.speed,
                    heading: loc.heading !== undefined ? loc.heading : member.heading,
                    accuracy: loc.accuracy !== undefined ? loc.accuracy : member.accuracy,
                    lastUpdated: new Date(loc.timestamp).toISOString(),
                    status: loc.status || memberStatus,
                    currentPlace: memberPlaceName,
                    signalQuality: loc.signalQuality,
                    sosActive: !!loc.sosActive,
                    impact: loc.impact || undefined,
                    privacyMode: loc.privacyMode || (loc.status?.includes('Blurred') ? 'blurred' : loc.status?.includes('Status Only') ? 'status_only' : loc.status?.includes('Frozen') ? 'frozen' : 'exact'),
                    blurredRadiusMeters: loc.blurredRadiusMeters,
                    isGhostMode: loc.privacyMode === 'blurred' || loc.privacyMode === 'frozen' || !!loc.status?.includes('Blurred'),
                    currentTrip: loc.currentTrip || null,
                    circleId: memberCircleId,
                    circleName: memberCircleName,
                    circleColor: memberCircleColor
                };
            }));

            setMembers(updatedMembers);
        });

        return () => unsubscribe();
    }, [currentCircleId, user, geofences, userCircles, activeFilterCircleId]);

    // 3. SYNC PROFILE CHANGES TO LOCAL SELF
    useEffect(() => {
        if (!user?.uid || !profile) return;
        
        setMembers(prev => {
            const index = prev.findIndex(m => m.id === user.uid);
            if (index === -1) return prev;
            
            const updated = [...prev];
            updated[index] = {
                ...updated[index],
                name: profile.displayName || updated[index].name,
                avatar: getSafeAvatarUrl(profile.photoURL || updated[index].avatar, profile.displayName || updated[index].name || user.uid),
                membershipTier: profile.membershipTier || updated[index].membershipTier
            };
            return updated;
        });
    }, [profile?.displayName, profile?.photoURL, profile?.membershipTier, user?.uid]);

    return {
        members,
        setMembers,
        locationError,
        hasInitiallyCentered,
        setHasInitiallyCentered,
        userLocation
    };
};
