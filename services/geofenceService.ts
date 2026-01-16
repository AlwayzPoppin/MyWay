/**
 * Geofence Service
 * Handles spatial calculations and transition detection for safe zones.
 */

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
 * Calculates the Haversine distance between two points in meters.
 */
export const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

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
