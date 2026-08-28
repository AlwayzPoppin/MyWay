import { useEffect, useRef } from 'react';
import { FamilyMember } from '../types';
import { Geofence, GeofenceStatus, detectTransition } from '../services/geofenceService';
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

    // Transition detection logic
    useEffect(() => {
        if (members.length > 0 && geofences.length > 0) {
            members.forEach(member => {
                if (member.id === currentUserUid) return; // Skip current user, handled by useLocationSync
                if (member.lastUpdated === 'Waiting for signal...') return;

                const memberGeofenceStates = geofenceStatesRef.current[member.id] || {};
                geofences.forEach(geofence => {
                    const isKnown = !!memberGeofenceStates[geofence.id];
                    const previousStatus = memberGeofenceStates[geofence.id] || 'OUTSIDE';
                    const transition = detectTransition(member.location, geofence, previousStatus);

                    if (transition) {
                        if (!geofenceStatesRef.current[member.id]) {
                            geofenceStatesRef.current[member.id] = {};
                        }
                        geofenceStatesRef.current[member.id][geofence.id] = transition.to;

                        if (!isKnown) return;

                        const isInside = transition.to === 'INSIDE';
                        const verb = isInside ? 'reached' : 'left';
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
