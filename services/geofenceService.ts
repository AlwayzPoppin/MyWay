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
 * Applies departure hysteresis (+3m for micro-geofences <= 30m, up to 15m for larger zones)
 * to prevent border jitter when parked at driveway edges.
 */
export const detectTransition = (
    currentLocation: { lat: number; lng: number },
    geofence: Geofence,
    previousStatus: GeofenceStatus = 'OUTSIDE'
): GeofenceTransition | null => {
    const departureHysteresis = previousStatus === 'INSIDE'
        ? (geofence.radius <= 30 ? 3 : Math.min(15, Math.round(geofence.radius * 0.1)))
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
