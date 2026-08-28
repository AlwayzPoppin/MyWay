/**
 * Shared Geospatial Utilities — Single Source of Truth
 * 
 * Consolidates Haversine distance and bearing calculations
 * previously duplicated across navigationEngine, useLocationSync, and geofenceService.
 */

import { Location } from '../types';

/**
 * Haversine distance between two Location objects (meters).
 */
export const getDistanceMeters = (loc1: Location, loc2: Location): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = loc1.lat * Math.PI / 180;
    const φ2 = loc2.lat * Math.PI / 180;
    const Δφ = (loc2.lat - loc1.lat) * Math.PI / 180;
    const Δλ = (loc2.lng - loc1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

/**
 * Haversine distance between raw lat/lng pairs (meters).
 * Convenience overload for callers that don't have Location objects.
 */
export const getDistanceFromCoords = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    return getDistanceMeters({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
};

/**
 * Haversine distance between two Location objects (miles).
 */
export const getDistanceMiles = (loc1: Location, loc2: Location): number => {
    return getDistanceMeters(loc1, loc2) / 1609.344;
};

/**
 * Bearing (degrees) from start to end point.
 */
export const getBearing = (start: Location, end: Location): number => {
    const startLat = start.lat * Math.PI / 180;
    const endLat = end.lat * Math.PI / 180;
    const dLng = (end.lng - start.lng) * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) -
        Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

/**
 * Audit #5: Snap-to-Road Utility
 * Projects a point onto the nearest segment of a polyline.
 */
export const getPointOnSegmentNearestTo = (p: Location, a: Location, b: Location): Location => {
    const R = 6371e3;
    const d12 = getDistanceMeters(a, b);
    const d13 = getDistanceMeters(a, p);
    
    if (d12 === 0) return a;
    
    const theta12 = getBearing(a, b) * Math.PI / 180;
    const theta13 = getBearing(a, p) * Math.PI / 180;
    
    // Cross-track distance is not enough; we need along-track to find the actual point
    const dat = Math.atan2(Math.sin(d13/R) * Math.cos(theta13 - theta12), Math.cos(d13/R)) * R;
    
    if (dat <= 0) return a;
    if (dat >= d12) return b;
    
    // Calculate new point 'dat' distance along a->b
    const adLat = a.lat * Math.PI / 180;
    const adLng = a.lng * Math.PI / 180;
    const angularDist = dat / R;
    
    const lat = Math.asin(Math.sin(adLat) * Math.cos(angularDist) +
                Math.cos(adLat) * Math.sin(angularDist) * Math.cos(theta12));
    const lng = adLng + Math.atan2(Math.sin(theta12) * Math.sin(angularDist) * Math.cos(adLat),
                Math.cos(angularDist) - Math.sin(adLat) * Math.sin(lat));
                
    return { lat: lat * 180 / Math.PI, lng: lng * 180 / Math.PI };
};
