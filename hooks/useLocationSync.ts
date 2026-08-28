import { useState, useEffect, useRef } from 'react';
import { geolocationService } from '../services/geolocationService';
import { updateMemberLocation, subscribeToFamilyLocations, MemberLocation } from '../services/authService';
import { encryptLocation, decryptLocation, getFuzzyLocation, getNeighborhoodCentroid } from '../services/cryptoService';
import { detectTransition } from '../services/geofenceService';
import { getDistanceFromCoords } from '../utils/geo';
import { FamilyMember, PrivacyMode } from '../types';
import { useUI } from '../contexts/UIContext';
import { recordTripPoint, getActiveTrip } from '../services/tripHistoryService';
import { bufferMessage } from '../services/offlineMessageBuffer';
import { broadcastGeofencePushAlert } from '../services/pushNotificationService';
import { speechService } from '../services/speechService';
import { getSafeAvatarUrl } from '../utils/avatar';

export const useLocationSync = (
    user: any,
    profile: any,
    currentCircleId: string | undefined,
    geofences: any[] = [],
    onTransition?: (transition: any) => void
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

    // Keep ref in sync
    useEffect(() => {
        membersRef.current = members;
    }, [members]);
    const lastSyncRef = useRef<{ lat: number, lng: number, time: number }>({ lat: 0, lng: 0, time: 0 });
    const hasReceivedRealSignalRef = useRef(false);

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
                if (prev.find(m => m.id === user.uid)) return prev;

                const newSelf: FamilyMember = {
                    id: user.uid,
                    name: profile?.displayName || user.displayName || 'You',
                    avatar: getSafeAvatarUrl(profile?.photoURL || user.photoURL, profile?.displayName || user.displayName || user.uid),
                    location: userLocation,
                    status: 'Stationary',
                    battery: 100,
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
                return [newSelf, ...prev.filter(m => m.id !== 'demo-you')];
            });
            setHasInjectedSelf(true);
        }
    }, [user?.uid, profile, userLocation, hasInjectedSelf]);

    // 1. WATCH POSITION (GPS) & UPLOAD
    useEffect(() => {
        if (!geolocationService.isSupported()) {
            setLocationError('GPS not supported on this device');
            return;
        }

        // FIX: Don't inject self into members without a real user ID
        // This prevents creating 'demo-you' entries that duplicate the real user
        if (!user?.uid) {
            console.log('📍 GPS: Skipping member injection — no authenticated user yet');
            return;
        }
        const targetId = user.uid;

        // Register geofences for background evaluation and native notifications
        geolocationService.setBackgroundGeofences(geofences, onTransition);

        geolocationService.watchPosition((location) => {
            // Geofence Detection logic - Integrated into core sync loop
            geofences.forEach(gf => {
                const storedStatus = localStorage.getItem(`gf_state_${gf.id}`);
                const isKnown = storedStatus !== null;
                const prevStatus = (storedStatus || 'OUTSIDE') as any;

                const transition = detectTransition({ lat: location.latitude, lng: location.longitude }, gf, prevStatus);
                if (transition) {
                    localStorage.setItem(`gf_state_${gf.id}`, transition.to);

                    // Only trigger if we already knew the status (prevents startup noise)
                    if (isKnown) {
                        const isInside = transition.to === 'INSIDE';
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

                        onTransition?.(transition);
                    } else {
                        console.log(`📍 Geofence Local: Primed ${gf.name} to ${transition.to}`);
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
            // Driving: sync every 2.5m or 5s (responsive tracking)
            // Moving/Walking: sync every 5m or 15s (balanced)
            // Stationary: sync every 10m or 60s (battery saver)
            const speedMph = location.speed || 0;
            const isStationary = speedMph < 1;
            const isDriving = speedMph > 5;
            
            // AUDIT FIX: Low-Data Mode Throttling
            const dataMultiplier = isLowDataMode ? 6 : 1; 
            const DIST_THRESHOLD = (isDriving ? 5 : isStationary ? 20 : 10) * dataMultiplier;
            const TIME_THRESHOLD = (isDriving ? 5 : isStationary ? 60 : 15) * dataMultiplier;

            const distMoved = getDistanceMeters(
                lastSyncRef.current.lat, lastSyncRef.current.lng,
                location.latitude, location.longitude
            );
            const timeElapsed = (Date.now() - lastSyncRef.current.time) / 1000;
            const currentCoords = { lat: location.latitude, lng: location.longitude };

            // IMMEDIATELY update local UI state for responsive navigation
            setLocationError(null);
            setUserLocation(currentCoords);

            // Record trip telemetry if an active trip (manual nav or background auto-drive) is running
            if (getActiveTrip()) {
                recordTripPoint(
                    location.latitude,
                    location.longitude,
                    Math.round(location.speed || 0),
                    location.heading || 0
                );
            }

            // Debounce check for Firebase sync only (adaptive thresholds)
            if (lastSyncRef.current.lat !== 0 && distMoved < DIST_THRESHOLD && timeElapsed < TIME_THRESHOLD) {
                return; // Skip Firebase sync (but UI is already updated above)
            }

            lastSyncRef.current = { ...currentCoords, time: Date.now() };

            // PERSIST: Last Known Location
            localStorage.setItem('myway_last_known_location', JSON.stringify(currentCoords));

            // Update local state for "You"
            setMembers(prev => {
                const existing = prev.find(m => m.id === targetId);

                if (!existing) {
                    // Inject real "You" marker as soon as location arrives
                    const newSelf: FamilyMember = {
                        id: targetId,
                        name: profile?.displayName || user?.displayName || 'You',
                        avatar: getSafeAvatarUrl(profile?.photoURL || user?.photoURL, profile?.displayName || user?.displayName || targetId),
                        location: currentCoords,
                        status: (location.speed && location.speed > 5) ? 'Driving' : 'Stationary',
                        battery: 100,
                        membershipTier: profile?.membershipTier || 'free',
                        lastUpdated: new Date().toISOString(),
                        accuracy: location.accuracy,
                        isGhostMode: false,
                        speed: Math.round(location.speed || 0),
                        heading: location.heading || 0,
                        role: 'Primary',
                        safetyScore: 100,
                        pathHistory: [],
                        driveEvents: []
                    };
                    return [newSelf, ...prev.filter(m => m.id !== targetId && m.id !== 'demo-you')];
                }

                return prev.map(m =>
                    m.id === targetId ? {
                        ...m,
                        location: currentCoords,
                        accuracy: location.accuracy,
                        speed: Math.round(location.speed || 0),
                        heading: location.heading || 0,
                        lastUpdated: new Date().toISOString(),
                        status: (location.speed && location.speed > 5) ? 'Driving' :
                            (location.speed && location.speed > 0.5) ? 'Moving' : 'Stationary',
                        signalQuality: location.signalQuality
                    } : m
                );
            });

            // Sync to Firebase if in a circle
            if (user && currentCircleId && profile) {
                const syncLocation = async () => {
                    const currentMembers = membersRef.current;
                    const self = currentMembers.find(m => m.id === user.uid);
                    
                    // Read active privacy mode from localStorage or profile
                    const storedPrivacy = (typeof window !== 'undefined' ? localStorage.getItem('myway_privacy_mode') : null) as PrivacyMode | null;
                    const privacyMode: PrivacyMode = storedPrivacy || self?.privacyMode || (self?.isGhostMode ? 'blurred' : 'exact');

                    // If frozen, skip coordinate updates to freeze location at current place
                    if (privacyMode === 'frozen') {
                        await updateMemberLocation(currentCircleId, user.uid, {
                            lat: 0,
                            lng: 0,
                            speed: 0,
                            heading: 0,
                            accuracy: location.accuracy || 0,
                            timestamp: Date.now(),
                            battery: 100,
                            signalQuality: location.signalQuality,
                            status: '❄️ Location Paused (Frozen)',
                            privacyMode: 'frozen'
                        });
                        return;
                    }

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

                    let targetLat = location.latitude;
                    let targetLng = location.longitude;
                    let statusText = 'Online';
                    let blurredRadius = undefined;

                    if (privacyMode === 'blurred') {
                        const centroid = getNeighborhoodCentroid(location.latitude, location.longitude, user.uid);
                        targetLat = centroid.lat;
                        targetLng = centroid.lng;
                        blurredRadius = 2400; // ~1.5 miles
                        statusText = 'In Neighborhood (Blurred)';
                    } else if (privacyMode === 'status_only') {
                        if (insideGeofenceName && insideGeofenceCoords) {
                            targetLat = insideGeofenceCoords.lat;
                            targetLng = insideGeofenceCoords.lng;
                            statusText = `At ${insideGeofenceName}`;
                        } else {
                            targetLat = 0;
                            targetLng = 0;
                            statusText = 'In Transit (Status Only)';
                        }
                    }

                    // PRIVACY FIX: Encrypt the chosen target location
                    const encrypted = (targetLat !== 0 && targetLng !== 0) 
                        ? await encryptLocation(targetLat, targetLng) 
                        : null;

                    // If encryption is pending
                    if (!encrypted && (targetLat !== 0 && targetLng !== 0)) {
                        await updateMemberLocation(currentCircleId, user.uid, {
                            lat: 0,
                            lng: 0,
                            speed: 0,
                            heading: 0,
                            accuracy: 0,
                            timestamp: Date.now(),
                            battery: 100,
                            signalQuality: 'unknown',
                            status: 'Pending Keys',
                            privacyMode
                        });
                        return;
                    }

                    await updateMemberLocation(currentCircleId, user.uid, {
                        lat: encrypted ? 0 : targetLat,
                        lng: encrypted ? 0 : targetLng,
                        speed: privacyMode === 'exact' ? (location.speed || 0) : 0,
                        heading: privacyMode === 'exact' ? (location.heading || 0) : 0,
                        accuracy: privacyMode === 'blurred' ? 2400 : (location.accuracy || 0),
                        timestamp: Date.now(),
                        battery: 100,
                        signalQuality: location.signalQuality,
                        encryptedData: encrypted || undefined,
                        status: statusText,
                        privacyMode,
                        blurredRadiusMeters: blurredRadius
                    });
                };
                syncLocation();
            }
        });

        return () => geolocationService.stopWatching();
    }, [user, currentCircleId, profile, geofences]);

    // Track geofence status per member ID -> Set<geofenceId>
    const memberInsideGeofencesRef = useRef<Map<string, Set<string>>>(new Map());

    // 2. SUBSCRIBE TO CIRCLE MEMBERS & DECRYPT
    useEffect(() => {
        if (!currentCircleId || !user) return;

        const unsubscribe = subscribeToFamilyLocations(currentCircleId, (locations) => {
            const processUpdates = async () => {
                const current = membersRef.current;
                const updatedMembers = await Promise.all(current.map(async (member) => {
                    if (member.id === user.uid) return member; // Don't overwrite self with stale echo

                    const loc = locations[member.id];
                    if (!loc) return member;

                    let lat = loc.lat;
                    let lng = loc.lng;

                    if (loc.encryptedData) {
                        const decrypted = await decryptLocation(loc.encryptedData);
                        if (decrypted) {
                            lat = decrypted.lat;
                            lng = decrypted.lng;
                        }
                    }

                    // Circle Member Geofence Arrival / Departure Tracking
                    if (geofences && geofences.length > 0 && lat && lng && lat !== 0) {
                        let currentInside = memberInsideGeofencesRef.current.get(member.id);
                        const isFirstTracking = !currentInside;
                        if (!currentInside) {
                            currentInside = new Set<string>();
                            memberInsideGeofencesRef.current.set(member.id, currentInside);
                        }

                        geofences.forEach((gf) => {
                            const distance = getDistanceFromCoords(lat, lng, gf.location.lat, gf.location.lng);
                            const wasInside = currentInside!.has(gf.id);
                            const isInsideNow = distance <= (gf.radius || 150);

                            if (isInsideNow && !wasInside) {
                                currentInside!.add(gf.id);
                                if (!isFirstTracking) {
                                    speechService.speak(`${member.name} arrived at ${gf.name}`, { chime: 'arrival' });
                                    useUI.getState().addActivity({
                                        id: `act_${Date.now()}_${Math.random()}`,
                                        type: 'arrival',
                                        message: `${member.name} arrived at ${gf.name}`,
                                        member: member,
                                        timestamp: Date.now()
                                    });
                                }
                            } else if (!isInsideNow && wasInside) {
                                currentInside!.delete(gf.id);
                                if (!isFirstTracking) {
                                    speechService.speak(`${member.name} left ${gf.name}`, { chime: 'turn' });
                                    useUI.getState().addActivity({
                                        id: `act_${Date.now()}_${Math.random()}`,
                                        type: 'departure',
                                        message: `${member.name} left ${gf.name}`,
                                        member: member,
                                        timestamp: Date.now()
                                    });
                                }
                            }
                        });
                    }

                    return {
                        ...member,
                        name: member.name || 'Circle Member',
                        avatar: getSafeAvatarUrl(member.avatar, member.name || member.id),
                        location: { lat, lng },
                        accuracy: loc.accuracy,
                        speed: loc.speed,
                        heading: loc.heading,
                        battery: loc.battery,
                        lastUpdated: new Date(loc.timestamp).toISOString(),
                        status: loc.status || ((loc.speed > 5) ? 'Driving' : (loc.speed > 0.5) ? 'Moving' : 'Stationary'),
                        signalQuality: loc.signalQuality,
                        sosActive: !!loc.sosActive,
                        privacyMode: loc.privacyMode || (loc.status?.includes('Blurred') ? 'blurred' : loc.status?.includes('Status Only') ? 'status_only' : loc.status?.includes('Frozen') ? 'frozen' : 'exact'),
                        blurredRadiusMeters: loc.blurredRadiusMeters,
                        isGhostMode: loc.privacyMode === 'blurred' || loc.privacyMode === 'frozen' || !!loc.status?.includes('Blurred'),
                        currentTrip: loc.currentTrip || null
                    };
                }));

                setMembers(updatedMembers);
            };

            processUpdates();
        });
        return () => unsubscribe();
    }, [currentCircleId, user, geofences]);

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
