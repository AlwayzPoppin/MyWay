import { useState, useEffect, useRef } from 'react';
import { geolocationService } from '../services/geolocationService';
import { updateMemberLocation, subscribeToFamilyLocations, MemberLocation } from '../services/authService';
import { encryptLocation, decryptLocation, getFuzzyLocation } from '../services/cryptoService';
import { FamilyMember } from '../types';

export const useLocationSync = (
    user: any,
    profile: any,
    isSimulationActive: boolean,
    currentCircleId: string | undefined
) => {
    const [members, setMembers] = useState<FamilyMember[]>([]);
    const [hasInjectedSelf, setHasInjectedSelf] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);
    const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);
    const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
    const membersRef = useRef<FamilyMember[]>([]);

    // Keep ref in sync
    useEffect(() => {
        membersRef.current = members;
    }, [members]);

    // 1. WATCH POSITION (GPS) & UPLOAD
    useEffect(() => {
        // We now ALLOW location tracking even without a logged-in user to support "Demo Mode" localization
        if (!geolocationService.isSupported()) {
            setLocationError('GPS not supported on this device');
            return;
        }

        const targetId = user?.uid || 'demo-you';

        geolocationService.setSimulationMode(isSimulationActive);
        geolocationService.watchPosition((location) => {
            setLocationError(null);
            setUserLocation({ lat: location.latitude, lng: location.longitude });

            // Update local state for "You"
            setMembers(prev => {
                const existing = prev.find(m => m.id === targetId);

                if (!existing) {
                    // Inject real "You" marker as soon as location arrives
                    const newSelf: FamilyMember = {
                        id: targetId,
                        name: user?.displayName || 'You',
                        avatar: user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${targetId}`,
                        location: { lat: location.latitude, lng: location.longitude },
                        status: (location.speed && location.speed > 5) ? 'Driving' : 'Stationary',
                        batteryLevel: 100,
                        membershipTier: profile?.membershipTier || 'free',
                        lastUpdated: new Date().toISOString(),
                        isGhostMode: false,
                        speed: Math.round(location.speed || 0),
                        heading: location.heading || 0
                    };
                    return [newSelf, ...prev.filter(m => m.id !== targetId)];
                }

                return prev.map(m =>
                    m.id === targetId ? {
                        ...m,
                        location: { lat: location.latitude, lng: location.longitude },
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

                    const encrypted = await encryptLocation(location.latitude, location.longitude);

                    // Prevent syncing if E2EE keys aren't ready yet (prevents "Encryption skipped" console spam)
                    if (!encrypted) return;

                    const fuzzy = getFuzzyLocation(location.latitude, location.longitude);

                    await updateMemberLocation(currentCircleId, user.uid, {
                        lat: isGhost ? fuzzy.lat : location.latitude,
                        lng: isGhost ? fuzzy.lng : location.longitude,
                        speed: location.speed || 0,
                        heading: location.heading || 0,
                        accuracy: location.accuracy || 0,
                        timestamp: Date.now(),
                        battery: 100, // TODO: Real battery hook
                        signalQuality: location.signalQuality,
                        encryptedData: encrypted
                    });
                };
                syncLocation();
            }
        });

        return () => geolocationService.stopWatching();
    }, [user, isSimulationActive, currentCircleId, profile]);

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
                        speed: loc.speed,
                        heading: loc.heading,
                        battery: loc.battery,
                        lastUpdated: new Date(loc.timestamp).toISOString(),
                        status: (loc.speed > 5) ? 'Driving' : (loc.speed > 0.5) ? 'Moving' : 'Stationary',
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
