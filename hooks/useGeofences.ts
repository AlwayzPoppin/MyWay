import { useEffect, useRef } from 'react';
import { FamilyMember } from '../types';
import { Geofence, GeofenceStatus, detectTransition, getDistance, getEntranceArrivalMessage, isPointInEntranceZone } from '../services/geofenceService';
import { AppNotification } from '../components/NotificationCenter';

export const useGeofences = (
    members: FamilyMember[],
    geofences: Geofence[],
    showNotification: (msg: string, duration?: number) => void,
    currentUserUid?: string,
    onTransition?: (
        type: AppNotification['type'],
        title: string,
        message: string,
        icon: string,
        memberId: string
    ) => void
) => {
    const geofenceStatesRef = useRef<Record<string, Record<string, GeofenceStatus>>>({});
    const entranceStatesRef = useRef<Record<string, Record<string, GeofenceStatus>>>({});

    // Transition detection logic
    useEffect(() => {
        if (members.length > 0 && geofences.length > 0) {
            members.forEach(member => {
                if (member.id === currentUserUid) return; // Skip current user, handled by useLocationSync
                if (member.lastUpdated === 'Waiting for signal...') return;

                const memberGeofenceStates = geofenceStatesRef.current[member.id] || {};
                const memberEntranceStates = entranceStatesRef.current[member.id] || {};

                geofences.forEach(geofence => {
                    const isKnown = !!memberGeofenceStates[geofence.id];
                    const previousStatus = memberGeofenceStates[geofence.id] || 'OUTSIDE';

                    // 1. Granular Entrance Check (Driveway / Parking pin with rectangular footprint)
                    const entranceLoc = geofence.entrancePrecision?.location || geofence.entranceLocation;
                    if (geofence.entranceType && entranceLoc) {
                        const isEntranceInside = isPointInEntranceZone(
                            { lat: member.location.lat, lng: member.location.lng },
                            geofence.entrancePrecision,
                            geofence.entranceLocation,
                            geofence.entranceType
                        );
                        const prevEntranceStatus = memberEntranceStates[geofence.id] || 'OUTSIDE';

                        if (isEntranceInside) {
                            if (prevEntranceStatus === 'OUTSIDE') {
                                if (!entranceStatesRef.current[member.id]) {
                                    entranceStatesRef.current[member.id] = {};
                                }
                                entranceStatesRef.current[member.id][geofence.id] = 'INSIDE';

                                // Only notify entrance if member is not already confirmed INSIDE main geofence
                                if (previousStatus === 'OUTSIDE') {
                                    const entranceMsg = getEntranceArrivalMessage(member.name, geofence.name, geofence.entranceType);
                                    showNotification(entranceMsg.title, 5000);
                                    onTransition?.(
                                        'arrival',
                                        'Entrance Arrival',
                                        entranceMsg.body,
                                        entranceMsg.emoji,
                                        member.id
                                    );
                                }
                            }
                        } else if (prevEntranceStatus === 'INSIDE') {
                            // Reset entrance state once drifted away with 15m departure hysteresis buffer
                            const isStillInside = isPointInEntranceZone(
                                { lat: member.location.lat, lng: member.location.lng },
                                geofence.entrancePrecision,
                                geofence.entranceLocation,
                                geofence.entranceType,
                                15
                            );
                            if (!isStillInside) {
                                if (!entranceStatesRef.current[member.id]) {
                                    entranceStatesRef.current[member.id] = {};
                                }
                                entranceStatesRef.current[member.id][geofence.id] = 'OUTSIDE';
                            }
                        }
                    }

                    // 2. Strict accuracy filter: If member was confirmed INSIDE, ignore updates with accuracy > 65m
                    if (previousStatus === 'INSIDE' && typeof member.accuracy === 'number' && member.accuracy > 65) {
                        return;
                    }

                    // 3. Main Geofence Transition
                    const transition = detectTransition(member.location, geofence, previousStatus);

                    if (transition) {
                        if (!geofenceStatesRef.current[member.id]) {
                            geofenceStatesRef.current[member.id] = {};
                        }
                        geofenceStatesRef.current[member.id][geofence.id] = transition.to;

                        if (!isKnown) return;

                        const isInside = transition.to === 'INSIDE';
                        const verb = isInside ? 'entered' : 'left';
                        const emoji = isInside ? '🏠' : '🚗';
                        const activityType = isInside ? 'arrival' : 'departure';
                        const activityTitle = isInside ? 'Geofence Entry' : 'Geofence Exit';
                        const activityIcon = isInside ? '📍' : '🚶';

                        // Show banner notification
                        showNotification(`${emoji} ${member.name} ${verb} ${geofence.name}!`, 5000);

                        // Log activity to timeline
                        onTransition?.(
                            activityType,
                            activityTitle,
                            `${member.name} ${isInside ? 'entered' : 'left'} ${geofence.name}`,
                            activityIcon,
                            member.id
                        );
                    }
                });
            });
        }
    }, [members, geofences, showNotification, currentUserUid, onTransition]);
};
