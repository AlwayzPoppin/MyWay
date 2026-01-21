import { useState, useEffect, useRef } from 'react';
import { geolocationService } from '../services/geolocationService';
import { updateMemberLocation, subscribeToFamilyLocations, MemberLocation } from '../services/authService';
import { encryptLocation, decryptLocation, getFuzzyLocation } from '../services/cryptoService';
import { detectTransition } from '../services/geofenceService';
import { FamilyMember } from '../types';

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

    // Distance helper (Haversine)
    const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    // 1. WATCH POSITION (GPS) & UPLOAD
    useEffect(() => {
        if (!geolocationService.isSupported()) {
            setLocationError('GPS not supported on this device');
            return;
        }

        const targetId = user?.uid || 'demo-you';

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
                        onTransition?.(transition);
                    } else {
                        console.log(`📍 Geofence Local: Primed ${gf.name} to ${transition.to}`);
                    }
                }
            });

            // ACCURACY FILTER: Ignore poor quality signals to prevent "guessing"
            // EXCEPT: If we haven't received ANY real signal yet, accept even a poor one (up to 2000m) to get a lock
            const isFirstSignal = !hasReceivedRealSignalRef.current;

            if (location.signalQuality === 'poor' && (!isFirstSignal || location.accuracy > 2000)) {
                console.log("📍 GPS Filter: Skipping poor accuracy signal (", location.accuracy, "m)");
                return;
            }

            if (isFirstSignal) {
                console.log("📍 GPS Accepted: First real signal locked (", location.accuracy, "m)");
                hasReceivedRealSignalRef.current = true;
            }

            // DISTANCE DEBOUNCE: Only sync to Firebase if moved > 2.5m or 30s passed
            // NOTE: Local UI state (setUserLocation) is updated immediately below for responsiveness,
            // while only the Firebase write (syncLocation) is gated by this debounce.
            const distMoved = getDistanceMeters(
                lastSyncRef.current.lat, lastSyncRef.current.lng,
                location.latitude, location.longitude
            );
            const timeElapsed = (Date.now() - lastSyncRef.current.time) / 1000;
            const currentCoords = { lat: location.latitude, lng: location.longitude };

            // IMMEDIATELY update local UI state for responsive navigation
            setLocationError(null);
            setUserLocation(currentCoords);

            // Debounce check for Firebase sync only
            if (lastSyncRef.current.lat !== 0 && distMoved < 2.5 && timeElapsed < 30) {
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
                        name: user?.displayName || 'You',
                        avatar: user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${targetId}`,
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
                    return [newSelf, ...prev.filter(m => m.id !== targetId)];
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
                    const isGhost = self?.isGhostMode;

                    // Get fuzzy location first (needed for both Ghost Mode check and public coords)
                    const fuzzy = getFuzzyLocation(location.latitude, location.longitude);

                    // PRIVACY FIX: Encrypt the FUZZY location when Ghost Mode is on
                    // This prevents circle members from decrypting exact coordinates
                    const encrypted = await encryptLocation(
                        isGhost ? fuzzy.lat : location.latitude,
                        isGhost ? fuzzy.lng : location.longitude
                    );

                    // UX Fix: If keys aren't ready, sync "Pending Keys" status so user doesn't appear offline
                    if (!encrypted) {
                        await updateMemberLocation(currentCircleId, user.uid, {
                            lat: 0, // Fallback (Null Island) - receiver handles this
                            lng: 0,
                            speed: 0,
                            heading: 0,
                            accuracy: 0,
                            timestamp: Date.now(),
                            battery: 100,
                            signalQuality: 'unknown',
                            status: 'Pending Keys'
                        });
                        return;
                    }

                    await updateMemberLocation(currentCircleId, user.uid, {
                        lat: encrypted ? 0 : (isGhost ? fuzzy.lat : location.latitude),
                        lng: encrypted ? 0 : (isGhost ? fuzzy.lng : location.longitude),
                        speed: location.speed || 0,
                        heading: location.heading || 0,
                        accuracy: location.accuracy || 0,
                        timestamp: Date.now(),
                        battery: 100,
                        signalQuality: location.signalQuality,
                        encryptedData: encrypted,
                        status: 'Online'
                    });
                };
                syncLocation();
            }
        });

        return () => geolocationService.stopWatching();
    }, [user, currentCircleId, profile]);

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

                    return {
                        ...member,
                        location: { lat, lng },
                        accuracy: loc.accuracy,
                        speed: loc.speed,
                        heading: loc.heading,
                        battery: loc.battery,
                        lastUpdated: new Date(loc.timestamp).toISOString(),
                        status: loc.status || ((loc.speed > 5) ? 'Driving' : (loc.speed > 0.5) ? 'Moving' : 'Stationary'),
                        signalQuality: loc.signalQuality
                    };
                }));

                setMembers(updatedMembers);
            };

            processUpdates();
        });
        return () => unsubscribe();
    }, [currentCircleId, user]);

    return {
        members,
        setMembers,
        locationError,
        hasInitiallyCentered,
        setHasInitiallyCentered,
        userLocation
    };
};
