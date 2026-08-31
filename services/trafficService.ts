import { CongestionLevel, TrafficSegment, RouteStep, IncidentReport, Location } from '../types';
import { getDistanceMeters } from '../utils/geo';

export const CONGESTION_COLORS = {
    low: '#4f46e5', // Brand Indigo/Blue for smooth flowing traffic
    moderate: '#eab308', // Amber / Yellow for moderate congestion (slight delays)
    heavy: '#ea580c', // Orange-Red for heavy stop-and-go traffic
    severe: '#dc2626' // Deep Crimson Red for severe traffic jam
};

export const CONGESTION_GLOW_COLORS = {
    low: '#818cf8',
    moderate: '#fde047',
    heavy: '#fb923c',
    severe: '#ef4444'
};

/**
 * Computes live traffic congestion polyline segments from OSRM geometry, steps, and live incident telemetry.
 */
export function computeRouteTrafficSegments(
    routeGeometry: [number, number][],
    steps: RouteStep[] = [],
    annotations?: any,
    incidents: IncidentReport[] = []
): TrafficSegment[] {
    if (!routeGeometry || routeGeometry.length < 2) {
        return [];
    }

    // 1. If explicit OSRM congestion annotations exist
    if (annotations && annotations.congestion && Array.isArray(annotations.congestion) && annotations.congestion.length > 0) {
        const rawCongestion = annotations.congestion;
        const segments: TrafficSegment[] = [];
        let currentLevel: CongestionLevel = normalizeOSRMAnnotationCongestion(rawCongestion[0]);
        let currentCoords: [number, number][] = [routeGeometry[0]];

        for (let i = 0; i < rawCongestion.length; i++) {
            const level = normalizeOSRMAnnotationCongestion(rawCongestion[i]);
            const nextCoord = routeGeometry[i + 1] || routeGeometry[routeGeometry.length - 1];

            if (level !== currentLevel && currentCoords.length > 1) {
                currentCoords.push(nextCoord);
                segments.push({
                    coordinates: currentCoords,
                    congestion: currentLevel,
                    lengthMeters: calculatePolylineLength(currentCoords)
                });
                currentCoords = [nextCoord];
                currentLevel = level;
            } else {
                currentCoords.push(nextCoord);
            }
        }

        if (currentCoords.length > 1) {
            segments.push({
                coordinates: currentCoords,
                congestion: currentLevel,
                lengthMeters: calculatePolylineLength(currentCoords)
            });
        }

        if (segments.length > 0) {
            return overlayIncidentCongestion(segments, incidents);
        }
    }

    // 2. Synthesize traffic congestion from RouteStep speeds, road types, and congestion heuristics
    const segments: TrafficSegment[] = [];
    const totalPoints = routeGeometry.length;
    
    // Group coordinates per step or synthesize realistic traffic patterns
    if (steps.length > 0) {
        let coordIndex = 0;
        const pointsPerStep = Math.max(2, Math.floor(totalPoints / steps.length));

        for (let s = 0; s < steps.length; s++) {
            const step = steps[s];
            const isLast = s === steps.length - 1;
            const endIdx = isLast ? totalPoints - 1 : Math.min(totalPoints - 1, coordIndex + pointsPerStep);
            
            const slice = routeGeometry.slice(coordIndex, endIdx + 1);
            if (slice.length < 2) continue;

            const stepCongestion = inferStepCongestion(step);
            segments.push({
                coordinates: slice,
                congestion: stepCongestion,
                lengthMeters: calculatePolylineLength(slice)
            });

            coordIndex = endIdx;
        }
    }

    // Fallback: If no segments generated, slice geometry into standard flowing with dynamic congestion
    if (segments.length === 0) {
        segments.push({
            coordinates: routeGeometry,
            congestion: 'low',
            lengthMeters: calculatePolylineLength(routeGeometry)
        });
    }

    return overlayIncidentCongestion(segments, incidents);
}

function normalizeOSRMAnnotationCongestion(val: any): CongestionLevel {
    if (typeof val === 'string') {
        const lower = val.toLowerCase();
        if (lower.includes('severe')) return 'severe';
        if (lower.includes('heavy')) return 'heavy';
        if (lower.includes('moderate')) return 'moderate';
        return 'low';
    }
    if (typeof val === 'number') {
        if (val > 80) return 'severe';
        if (val > 50) return 'heavy';
        if (val > 25) return 'moderate';
        return 'low';
    }
    return 'low';
}

function inferStepCongestion(step: RouteStep): CongestionLevel {
    if (step.congestion) return step.congestion;
    
    const instr = (step.instruction || '').toLowerCase();
    
    // Congestion triggers from maneuver descriptions or delays
    if (instr.includes('traffic') || instr.includes('slow') || instr.includes('congestion') || instr.includes('delay') || instr.includes('bumper')) {
        return 'heavy';
    }
    if (instr.includes('construction') || instr.includes('hazard') || instr.includes('accident') || instr.includes('jam')) {
        return 'severe';
    }
    if (instr.includes('heavy traffic')) {
        return 'severe';
    }
    if (instr.includes('moderate traffic') || instr.includes('toll plaza') || instr.includes('merging traffic')) {
        return 'moderate';
    }

    return 'low';
}

function overlayIncidentCongestion(segments: TrafficSegment[], incidents: IncidentReport[]): TrafficSegment[] {
    if (!incidents || incidents.length === 0) return segments;

    const trafficIncidents = incidents.filter(i => i.type === 'traffic' || i.type === 'hazard');
    if (trafficIncidents.length === 0) return segments;

    return segments.map(seg => {
        for (const inc of trafficIncidents) {
            for (const coord of seg.coordinates) {
                const dist = getDistanceMeters({ lat: coord[1], lng: coord[0] }, inc.location);
                if (dist < 250) { // within 250 meters of reported traffic jam/hazard
                    return {
                        ...seg,
                        congestion: inc.type === 'traffic' ? 'severe' : 'heavy'
                    };
                }
            }
        }
        return seg;
    });
}

function calculatePolylineLength(coords: [number, number][]): number {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += getDistanceMeters(
            { lat: coords[i][1], lng: coords[i][0] },
            { lat: coords[i + 1][1], lng: coords[i + 1][0] }
        );
    }
    return Math.round(total);
}
