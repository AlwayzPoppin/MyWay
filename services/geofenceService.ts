/**
 * Geofence Service
 * Handles spatial calculations and transition detection for safe zones.
 */

import { getDistanceFromCoords } from '../utils/geo';

export interface Geofence {
    id: string;
    name: string;
    lat: number;
    lng: number;
    radius: number; // in meters
}

export type GeofenceStatus = 'INSIDE' | 'OUTSIDE';

export interface GeofenceTransition {
    geofence: Geofence;
    from: GeofenceStatus;
    to: GeofenceStatus;
    timestamp: number;
}

/**
 * Re-export shared Haversine for backward compatibility.
 */
export const getDistance = getDistanceFromCoords;

/**
 * Checks if a point is inside a geofence.
 */
export const isPointInGeofence = (
    point: { lat: number; lng: number },
    geofence: Geofence
): boolean => {
    const distance = getDistance(point.lat, point.lng, geofence.lat, geofence.lng);
    return distance <= geofence.radius;
};

/**
 * Detects transitions between states (INSIDE/OUTSIDE).
 */
export const detectTransition = (
    currentLocation: { lat: number; lng: number },
    geofence: Geofence,
    previousStatus: GeofenceStatus = 'OUTSIDE'
): GeofenceTransition | null => {
    const isNowInside = isPointInGeofence(currentLocation, geofence);
    const currentStatus: GeofenceStatus = isNowInside ? 'INSIDE' : 'OUTSIDE';

    if (currentStatus !== previousStatus) {
        return {
            geofence,
            from: previousStatus,
            to: currentStatus,
            timestamp: Date.now()
        };
    }

    return null;
};
