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
 * Checks if a point is inside a geofence with optional departure hysteresis.
 */
export const isPointInGeofence = (
    point: { lat: number; lng: number },
    geofence: Geofence,
    hysteresisMeters: number = 0
): boolean => {
    const distance = getDistance(point.lat, point.lng, geofence.lat, geofence.lng);
    return distance <= (geofence.radius + hysteresisMeters);
};

/**
 * Detects transitions between states (INSIDE/OUTSIDE).
 * Applies dynamic departure hysteresis: Math.max(15, radius * 0.5)
 * For a 15m driveway geofence → 15m buffer → must drift 30m total before exit evaluation.
 * For a 150m neighborhood zone → 75m buffer → must drift 225m total before exit evaluation.
 * Prevents indoor GPS drift from triggering false departures.
 */
export const detectTransition = (
    currentLocation: { lat: number; lng: number },
    geofence: Geofence,
    previousStatus: GeofenceStatus = 'OUTSIDE'
): GeofenceTransition | null => {
    const departureHysteresis = previousStatus === 'INSIDE'
        ? Math.max(15, Math.round(geofence.radius * 0.5))
        : 0;
    const isNowInside = isPointInGeofence(currentLocation, geofence, departureHysteresis);
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
