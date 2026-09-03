import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FamilyMember, Place, CircleTask, Location, TrafficSegment, TrafficControlPoint } from '../types';
import { MapSkinId, getMapSkin, resolveMapSkinId, applySkinOverrides, SATELLITE_STYLE, TERRAIN_STYLE } from '../services/mapSkinService';
import { solarService, SolarInfo } from '../services/solarService';
import { getDistanceMeters, getDistanceMiles, getBearing, getPointOnSegmentNearestTo } from '../utils/geo';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { getBrandMeta } from '../services/brandLogoService';
import { getGTAPlaceBlipHtml, getGTADestinationPinHtml } from '../services/gtaIconsService';
import { convoyService } from '../services/convoyService';
import { computeRouteTrafficSegments } from '../services/trafficService';
import { maintenanceAlertService } from '../services/maintenanceAlertService';
import { searchMaintenanceAlongRoute } from '../services/placesService';
import { osmTrafficService } from '../services/osmTrafficService';
import { publicMapReportService, PublicMapReport } from '../services/publicMapReportService';
import { UserProfile } from '../services/authService';
import { extractHouseNumber } from '../utils/addressUtils';
import { hapticTick, hapticMilestone, hapticSuccess, hapticError } from '../utils/haptics';

// Memoized Circle Polygon Generator for Geofences, Privacy Zones & Accuracy Circles
const circleCoordsCache = new Map<string, [number, number][]>();
const CIRCLE_CACHE_MAX = 100;

export const getCircleCoords = (center: Location, radiusKm: number, points: number = 64): [number, number][] => {
    // Quantize center to ~1m precision (5 decimals) and radius to 3 decimals
    const key = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}_${radiusKm.toFixed(3)}_${points}`;
    if (circleCoordsCache.has(key)) {
        return circleCoordsCache.get(key)!;
    }

    const coords: [number, number][] = [];
    const distanceX = radiusKm / (111.32 * Math.cos(center.lat * Math.PI / 180));
    const distanceY = radiusKm / 110.574;

    for (let i = 0; i < points; i++) {
        const theta = (i / points) * (2 * Math.PI);
        const x = distanceX * Math.cos(theta);
        const y = distanceY * Math.sin(theta);
        coords.push([center.lng + x, center.lat + y]);
    }
    coords.push(coords[0]);

    if (circleCoordsCache.size >= CIRCLE_CACHE_MAX) {
        const oldest = circleCoordsCache.keys().next().value;
        if (oldest !== undefined) circleCoordsCache.delete(oldest);
    }
    circleCoordsCache.set(key, coords);
    return coords;
};

// Static GeoJSON Shells instantiated once to achieve Zero-GC AAA frame budgeting during route rendering
const STATIC_EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: []
};

const staticRemainingRouteGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: {
        type: 'LineString',
        coordinates: []
    }
};

const staticCompletedRouteGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: {
        type: 'LineString',
        coordinates: []
    }
};

interface MapLibre3DViewProps {
    members: FamilyMember[];
    userLocation?: Location | null;
    currentUserId?: string;
    userProfile?: UserProfile | null;
    theme: 'light' | 'dark';
    mapSkin?: MapSkinId;
    selectedMemberId?: string | null;
    center?: [number, number]; // [lng, lat]
    zoom?: number;
    onZoomChange?: (zoom: number) => void;
    onUserInteraction?: () => void;
    onMapReady?: () => void;
    activeRoute?: any; // NavigationRoute | null
    places?: Place[];
    incidents?: any[]; // IncidentReport[]
    privacyZones?: any[];
    tasks?: CircleTask[];
    tripSafetyEvents?: Array<{ type: string; timestamp: number; location: { lat: number; lng: number } }>;
    // UNIFIED MAP: Props added for MapView parity
    is3DMode?: boolean; // False = 2D flat view, True = 3D tilted view
    isNavigating?: boolean;
    currentStepIndex?: number;
    splitIndex?: number;
    onSelectMember?: (memberId: string) => void;
    onSelectPlace?: (place: Place) => void;
    onSelectIncident?: (incident: any) => void;
    onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
    mapStyle?: 'standard' | 'satellite' | 'terrain';
    isMobile?: boolean;
    buildingScale?: 'none' | 'flat' | 'realistic' | 'enhanced' | 'monumental';
    landmarkGlow?: boolean;
    isCameraFree?: boolean;
    onCameraFreeChange?: (isFree: boolean) => void;
    isLowDataMode?: boolean;
    showTrafficControls?: boolean;
    onToggle3DMode?: () => void;
    onSelectMapStyle?: (style: 'standard' | 'satellite' | 'terrain') => void;
    selectedPlaceId?: string | null;
}

const MapLibre3DView: React.FC<MapLibre3DViewProps> = ({
    members,
    userLocation,
    currentUserId,
    userProfile,
    theme,
    mapSkin = 'default',
    selectedMemberId,
    selectedPlaceId,
    center,
    zoom = 16,
    onZoomChange,
    onUserInteraction,
    onMapReady,
    activeRoute,
    places = [],
    incidents = [],
    privacyZones = [],
    tasks = [],
    tripSafetyEvents = [],
    // UNIFIED MAP: New props for MapView parity
    is3DMode = true,
    isNavigating = false,
    currentStepIndex = 0,
    splitIndex = 0,
    onSelectMember,
    onSelectPlace,
    onSelectIncident,
    onBoundsChange,
    mapStyle = 'standard',
    isMobile = false,
    buildingScale = 'enhanced',
    landmarkGlow = true,
    isCameraFree = false,
    onCameraFreeChange,
    isLowDataMode = false,
    showTrafficControls = true,
    onToggle3DMode,
    onSelectMapStyle
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = React.useState(false);
    const [styleVersion, setStyleVersion] = React.useState(0); // Track style reloads to re-render layers
    const [mapEpoch, setMapEpoch] = React.useState(0); // Incremented to trigger WebGL context loss recovery reboot
    const [publicReports, setPublicReports] = React.useState<PublicMapReport[]>(() => publicMapReportService.getCachedReports());

    useEffect(() => {
        const unsub = publicMapReportService.subscribe(reports => {
            setPublicReports(reports);
        });
        return unsub;
    }, []);
    const renderedGeofenceIdsRef = useRef<Set<string>>(new Set());
    const routeRafRef = useRef<number | null>(null);
    const trafficControlMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const incidentMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const membersMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    // Smooth Vehicle Puck & Camera 1Hz Linear Interpolation Refs
    const latestLocationRef = useRef<{ lng: number; lat: number } | null>(null);
    const latestBearingRef = useRef<number>(0);
    const selfMarkerRef = useRef<maplibregl.Marker | null>(null);
    const puckInterpolationRef = useRef<{
        prevCoords: [number, number];
        targetCoords: [number, number];
        prevBearing: number;
        targetBearing: number;
        startTime: number;
        duration: number;
        currentCoords: [number, number];
        currentBearing: number;
    } | null>(null);
    const placesMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const destinationMarkerRef = useRef<maplibregl.Marker | null>(null);
    const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
    const junctionBeaconMarkerRef = useRef<maplibregl.Marker | null>(null);
    const currentStyleUrlRef = useRef<string | null>(null);

    // Predictive Autonomous Maintenance Corridor Places
    const [maintenancePlaces, setMaintenancePlaces] = React.useState<Place[]>([]);

    useEffect(() => {
        if (!activeRoute || !activeRoute.routeGeometry || activeRoute.routeGeometry.length === 0) {
            setMaintenancePlaces([]);
            return;
        }

        const pending = maintenanceAlertService.getPendingMaintenanceDue();
        if (!pending.isDue) {
            setMaintenancePlaces([]);
            return;
        }

        let isCancelled = false;
        searchMaintenanceAlongRoute(activeRoute.routeGeometry, pending.categoryQuery, userLocation).then(results => {
            if (!isCancelled) {
                console.log(`🔧 [Maintenance] Found ${results.length} recommended mechanics along route for ${pending.item?.title || 'service'}`);
                setMaintenancePlaces(results);
            }
        }).catch(err => {
            console.warn('[MapLibre] Failed to fetch maintenance places:', err);
        });

        return () => {
            isCancelled = true;
        };
    }, [activeRoute?.destinationName, activeRoute?.totalDistance, userLocation?.lat, userLocation?.lng]);

    // Track last known camera position to restore seamless view upon WebGL recovery
    const lastCameraRef = useRef<{
        center: [number, number];
        zoom: number;
        pitch: number;
        bearing: number;
    }>({
        center: (() => {
            if (center) return center;
            const validMember = members.find(m => m.location && m.location.lat !== 0 && m.location.lng !== 0);
            if (validMember) return [validMember.location.lng, validMember.location.lat] as [number, number];
            if (typeof window !== 'undefined' && window.localStorage) {
                try {
                    const saved = localStorage.getItem('myway_last_known_location');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        if (parsed && typeof parsed.lng === 'number' && typeof parsed.lat === 'number' && parsed.lat !== 0) {
                            return [parsed.lng, parsed.lat] as [number, number];
                        }
                    }
                } catch (e) {}
            }
            return [-78.98, 35.09] as [number, number];
        })(),
        zoom: zoom,
        pitch: is3DMode ? 60 : 0,
        bearing: is3DMode ? -17.6 : 0
    });

    // Debounced recovery reboot handler with 1000ms delay + rAF chaining to ensure DOM readiness
    const rebootTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleMapReboot = useCallback(() => {
        if (rebootTimeoutRef.current) return;
        rebootTimeoutRef.current = setTimeout(() => {
            rebootTimeoutRef.current = null;
            
            // Double rAF ensures the browser compositor and layout engine are fully unthrottled
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    console.warn('🔄 MapLibre3DView: Executing WebGL recovery reboot...');
                    renderedGeofenceIdsRef.current.clear();
                    membersMarkersRef.current.forEach(m => m.remove());
                    membersMarkersRef.current.clear();
                    placesMarkersRef.current.forEach(m => m.remove());
                    placesMarkersRef.current.clear();
                    if (destinationMarkerRef.current) {
                        destinationMarkerRef.current.remove();
                        destinationMarkerRef.current = null;
                    }
                    waypointMarkersRef.current.forEach(m => m.remove());
                    waypointMarkersRef.current = [];

                    if (map.current) {
                        try {
                            map.current.remove();
                        } catch (e) {
                            console.warn('Map cleanup error during recovery:', e);
                        }
                        map.current = null;
                    }

                    setIsMapReady(false);
                    setMapEpoch(epoch => epoch + 1);
                });
            });
        }, 1000);
    }, []);

    // Clear geofence tracking set when style changes, as sources are wiped
    useEffect(() => {
        renderedGeofenceIdsRef.current.clear();
    }, [styleVersion]);

    // Navigation camera tracking state
    const userInteractedRef = useRef<number>(0); // Timestamp of last user drag/zoom
    const prevBearingRef = useRef<number>(0);     // Smoothed bearing for interpolation
    const wasNavigatingRef = useRef<boolean>(false); // Track nav exit for camera reset
    const lastNavUpdateRef = useRef<number>(Date.now()); // Track GPS time delta for fluid continuous camera flight

    // ==========================================
    // ASTRONOMICAL SOLAR DAY/NIGHT TRACKING
    // ==========================================
    const [solarInfo, setSolarInfo] = React.useState<SolarInfo>(() => solarService.getSolarInfo());

    // Update solar calculator with live driver GPS location
    useEffect(() => {
        if (userLocation) {
            solarService.updateLocation(userLocation);
        }
    }, [userLocation?.lat, userLocation?.lng]);

    // Live subscription to day/night solar transitions
    useEffect(() => {
        return solarService.subscribe(setSolarInfo);
    }, []);

    // Resolve dynamic skin ID: 'default' automatically resolves to 'warm_cream' (Day) or 'muted_slate' (Night)
    const effectiveSkin = useMemo<MapSkinId>(() => {
        return resolveMapSkinId(mapSkin as MapSkinId, solarInfo.isDaylight);
    }, [mapSkin, solarInfo.isDaylight]);

    // Get the skin style URL
    // Respects Low Data Mode vs Warm Cream (Day) vs Los Santos Radar (Night) vs Auto Solar Transition
    const styleUrl = useMemo(() => {
        if (isLowDataMode) {
            // Low Data Mode: Minimal vector 2D basemap
            return effectiveSkin === 'warm_cream'
                ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
        }

        if (mapStyle === 'satellite') {
            return SATELLITE_STYLE;
        }
        if (mapStyle === 'terrain') {
            return TERRAIN_STYLE;
        }

        const skin = getMapSkin(effectiveSkin);
        return skin.styleUrl;
    }, [effectiveSkin, mapStyle, isLowDataMode]);

    // Prepare route polyline coordinates for map rendering
    const routeCoords = useMemo<Location[]>(() => {
        if (!activeRoute) return [];
        
        // Use the full road-following geometry from OSRM if available
        if (activeRoute.routeGeometry && activeRoute.routeGeometry.length > 0) {
            return activeRoute.routeGeometry.map((coord: any) => {
                if (Array.isArray(coord)) {
                    return { lng: Number(coord[0]), lat: Number(coord[1]) };
                }
                if (typeof coord === 'object' && coord !== null) {
                    return { lng: Number(coord.lng ?? coord.lon ?? coord[0]), lat: Number(coord.lat ?? coord[1]) };
                }
                return { lng: 0, lat: 0 };
            }).filter((c: Location) => typeof c.lat === 'number' && typeof c.lng === 'number' && !(c.lat === 0 && c.lng === 0));
        }

        // Fallback: connect step endpoints (straight lines)
        const coords: Location[] = [];
        if (activeRoute.startLoc) coords.push(activeRoute.startLoc);
        if (Array.isArray(activeRoute.steps)) {
            activeRoute.steps.forEach((step: any) => {
                if (step.endLocation) coords.push(step.endLocation);
            });
        }
        if (activeRoute.destinationLoc) coords.push(activeRoute.destinationLoc);
        
        return coords;
    }, [activeRoute]);

    // ==========================================
    // 3D BUILDINGS & ARCHITECTURAL SHADING ENGINE
    // ==========================================
    const apply3DBuildingLayer = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;

        // Apply skin-specific color overrides
        if (mapStyle === 'standard' && !isLowDataMode) {
            applySkinOverrides(map.current, effectiveSkin, theme);
        }

        const layers = map.current.getStyle()?.layers || [];
        const buildingLayer = layers.find(
            (layer: any) => layer.id.includes('building') && layer.type === 'fill'
        );

        // 1. Building Rendering Logic (2D, Flat, or 3D Extrusion)
        if (buildingScale === 'none') {
            if (map.current.getLayer('buildings-3d')) {
                map.current.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
            layers.forEach((layer: any) => {
                if (
                    (layer.id.includes('building') || layer.id.includes('structure') || layer.id.includes('roof')) &&
                    (layer.type === 'fill' || layer.type === 'line' || layer.type === 'fill-extrusion')
                ) {
                    try {
                        map.current!.setLayoutProperty(layer.id, 'visibility', 'none');
                    } catch {}
                }
            });
            try {
                map.current.setLight({ intensity: 0 });
            } catch {}
        } else if (buildingScale === 'flat' || isLowDataMode) {
            // Flat Mode or Low Data Mode: Suppress 3D building extrusions and restore 2D flat building footprints
            if (map.current.getLayer('buildings-3d')) {
                map.current.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
            layers.forEach((layer: any) => {
                if (
                    layer.id !== 'buildings-3d' &&
                    (layer.id.includes('building') || layer.id.includes('structure') || layer.id.includes('roof')) &&
                    (layer.type === 'fill' || layer.type === 'line')
                ) {
                    try {
                        map.current!.setLayoutProperty(layer.id, 'visibility', 'visible');
                    } catch {}
                }
            });
            if (buildingLayer) {
                map.current.setLayoutProperty(buildingLayer.id, 'visibility', 'visible');
            }
            try {
                map.current.setLight({ intensity: 0 });
            } catch {}
        } else {
            // Hide all 2D flat building and shadow layers so only the clean 3D volumetric extrusion renders
            layers.forEach((layer: any) => {
                if (
                    layer.id !== 'buildings-3d' &&
                    (layer.id.includes('building') || layer.id.includes('structure') || layer.id.includes('roof')) &&
                    (layer.type === 'fill' || layer.type === 'line')
                ) {
                    try {
                        map.current!.setLayoutProperty(layer.id, 'visibility', 'none');
                    } catch {}
                }
            });

            const sources = map.current.getStyle()?.sources || {};
            const source = (buildingLayer as any)?.source || (map.current.getSource('carto') ? 'carto' : map.current.getSource('openmaptiles') ? 'openmaptiles' : Object.keys(sources)[0]);
            const sourceLayer = (buildingLayer as any)?.['source-layer'] || 'building';

            if (source) {
                const labelLayerId = layers.find(
                    (layer: any) => layer.type === 'symbol' && layer.layout?.['text-field']
                )?.id;

                const heightMultiplier = buildingScale === 'monumental' ? 2.6 : buildingScale === 'realistic' ? 1.0 : 1.8;
                const baseHeight = Math.round(14 * heightMultiplier);
                const levelHeight = Number((4.0 * heightMultiplier).toFixed(1));

                const isWarmLight = effectiveSkin === 'warm_cream';

                // 3D Architectural Lighting & Balanced Sun Shading (Viewport anchor prevents harsh shadow skewing on light themes)
                try {
                    map.current.setLight({
                        anchor: 'viewport',
                        color: '#ffffff',
                        intensity: isWarmLight ? 0.24 : 0.36,
                        position: [1.15, 210, 45]
                    });
                } catch (e) {
                    console.warn('[MapLibre] setLight:', e);
                }

                const isCarbonAmber = effectiveSkin === 'carbon-amber' || effectiveSkin === 'los-santos';
                // Crisp, solid volumetric architectural contrast for both light and dark themes
                const extrusionColor = [
                    'interpolate', ['linear'], ['zoom'],
                    14, isWarmLight ? '#cbd5e1' : isCarbonAmber ? '#121824' : '#1e293b',
                    16, isWarmLight ? '#b8c4d4' : isCarbonAmber ? '#192231' : '#243044'
                ];

                // 100% Solid opaque buildings for authentic WebGL depth testing (no see-through artifacts)
                const opacityExpr: any = [
                    'interpolate', ['linear'], ['zoom'],
                    13.5, 0,
                    14.5, 1.0
                ];

                const heightExpr: any = [
                    'interpolate', ['linear'], ['zoom'],
                    13.5, 0,
                    15, [
                        'case',
                        ['has', 'height'], ['*', ['get', 'height'], heightMultiplier],
                        ['has', 'render_height'], ['*', ['get', 'render_height'], heightMultiplier],
                        ['has', 'levels'], ['*', ['get', 'levels'], levelHeight],
                        baseHeight
                    ]
                ];

                const baseExpr: any = [
                    'case',
                    ['has', 'render_min_height'], ['get', 'render_min_height'],
                    ['has', 'min_height'], ['get', 'min_height'],
                    0
                ];

                if (map.current.getLayer('buildings-3d')) {
                    map.current.setLayoutProperty('buildings-3d', 'visibility', 'visible');
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-color', extrusionColor);
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-height', heightExpr);
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-base', baseExpr);
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', opacityExpr);
                } else {
                    try {
                        map.current.addLayer({
                            'id': 'buildings-3d',
                            'source': source,
                            'source-layer': sourceLayer,
                            'type': 'fill-extrusion',
                            'minzoom': 13.5,
                            'paint': {
                                'fill-extrusion-color': extrusionColor as any,
                                'fill-extrusion-height': heightExpr,
                                'fill-extrusion-base': baseExpr,
                                'fill-extrusion-opacity': opacityExpr
                            }
                        }, labelLayerId);
                    } catch (e) {
                        console.warn('[MapLibre] Failed to add buildings-3d layer:', e);
                    }
                }
            }
        }

        // ==========================================
        // THEME OVERRIDES: Carbon Amber (Tactical Night Aesthetic)
        // ==========================================
        const isCarbonAmber = effectiveSkin === 'carbon-amber' || effectiveSkin === 'los-santos';

        if (isCarbonAmber) {
            try {
                // 1. Water & Landmass
                // Land background: Deep carbon black #0b0f17
                if (map.current!.getLayer('background')) map.current!.setPaintProperty('background', 'background-color', '#0b0f17');
                // Water bodies: Inky obsidian navy #070a10 (darker than slate)
                if (map.current!.getLayer('water')) map.current!.setPaintProperty('water', 'fill-color', '#070a10');
                // Greenery/Parks: Muted dark graphite #0f1720
                if (map.current!.getLayer('park')) map.current!.setPaintProperty('park', 'fill-color', '#0f1720');

                // 2. Road Arterial Hierarchy
                // Freeways / Motorways: Vivid amber-orange #f97316, width 4–7px, with 1.5px #000000 border casing
                const freewayFillLayers = ['road_mot_fill_noramp', 'road_mot_fill_ramp', 'bridge_mot_fill', 'tunnel_mot_fill', 'road_trunk_fill_noramp', 'road_trunk_fill_ramp', 'bridge_trunk_fill'];
                freewayFillLayers.forEach(id => {
                    if (map.current!.getLayer(id)) {
                        map.current!.setPaintProperty(id, 'line-color', '#f97316');
                        map.current!.setPaintProperty(id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, 4,
                            14, 5.5,
                            17, 7
                        ]);
                    }
                });

                const freewayCasingLayers = ['road_mot_casing', 'bridge_mot_casing', 'tunnel_mot_casing', 'road_trunk_casing', 'bridge_trunk_casing'];
                freewayCasingLayers.forEach(id => {
                    if (map.current!.getLayer(id)) {
                        map.current!.setPaintProperty(id, 'line-color', '#000000');
                        map.current!.setPaintProperty(id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, 7,
                            14, 8.5,
                            17, 10
                        ]);
                    }
                });

                // Primary & Secondary Arteries: Luminous warm gold #fbbf24, width 2.5–4.5px
                const arteryFillLayers = ['road_pri_fill_noramp', 'road_pri_fill_ramp', 'bridge_pri_fill', 'road_sec_fill_noramp', 'road_sec_fill_ramp', 'bridge_sec_fill'];
                arteryFillLayers.forEach(id => {
                    if (map.current!.getLayer(id)) {
                        map.current!.setPaintProperty(id, 'line-color', '#fbbf24');
                        map.current!.setPaintProperty(id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, 2.5,
                            14, 3.5,
                            17, 4.5
                        ]);
                    }
                });

                // Minor & Residential Roads: Clean dark slate #243044, width 1.2–2px
                if (map.current!.getLayer('road_minor_fill')) {
                    map.current!.setPaintProperty('road_minor_fill', 'line-color', '#243044');
                    map.current!.setPaintProperty('road_minor_fill', 'line-width', [
                        'interpolate', ['linear'], ['zoom'],
                        11, 1.2,
                        14, 1.6,
                        17, 2.0
                    ]);
                }
                if (map.current!.getLayer('road_service_fill')) {
                    map.current!.setPaintProperty('road_service_fill', 'line-color', '#1e293b');
                    map.current!.setPaintProperty('road_service_fill', 'line-width', [
                        'interpolate', ['linear'], ['zoom'],
                        12, 1.0,
                        16, 1.5
                    ]);
                }
            } catch (e) {
                console.warn('[MapLibre3DView] Error applying Carbon Amber overrides:', e);
            }
        }

        // ==========================================
        // WAZE-STYLE HORIZONTAL ROAD LABELS ENGINE
        // ==========================================
        const isWarmLightSkin = effectiveSkin === 'warm_cream';

        const style = map.current.getStyle();
        const vectorSourceId = Object.keys(style?.sources || {}).find(id => {
            return style?.sources?.[id]?.type === 'vector';
        }) || 'carto';

        const wazeMajorLabelsId = 'waze-road-labels-major';
        const wazeMinorLabelsId = 'waze-road-labels-minor';
        const defaultRoadLayers = ['roadname_minor', 'roadname_sec', 'roadname_pri', 'roadname_major'];
        
        // High-Contrast Palette: Crisp warm ivory (#fef9c3) on Dark with 2.8px Pure Black Halo (#000000, blur 0.5px)
        const wazeTextColor = isWarmLightSkin ? '#111827' : isCarbonAmber ? '#fef9c3' : '#ffffff';
        const wazeHaloColor = isWarmLightSkin ? '#ffffff' : '#000000';
        const wazeHaloWidth = isWarmLightSkin ? 3.0 : isCarbonAmber ? 2.8 : 3.2;
        const wazeHaloBlur = isCarbonAmber ? 0.5 : 0.3;

        // Configure default CARTO road label layers with high-contrast Carbon Amber styling
        defaultRoadLayers.forEach(id => {
            if (map.current!.getLayer(id)) {
                try {
                    map.current!.setLayoutProperty(id, 'visibility', 'visible');
                    map.current!.setLayoutProperty(id, 'text-field', ['get', 'name']);
                    map.current!.setLayoutProperty(id, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
                    map.current!.setPaintProperty(id, 'text-color', wazeTextColor);
                    map.current!.setPaintProperty(id, 'text-halo-color', wazeHaloColor);
                    map.current!.setPaintProperty(id, 'text-halo-width', wazeHaloWidth);
                    map.current!.setPaintProperty(id, 'text-halo-blur', wazeHaloBlur);
                } catch (e) {}
            }
        });

        // Purge legacy monolithic layer if lingering
        if (map.current.getLayer('waze-style-road-labels')) {
            try {
                map.current.removeLayer('waze-style-road-labels');
            } catch (e) {}
        }

        // ==========================================
        // 1. MAJOR ROAD LABELS (Motorways, Trunk, Primary, Secondary)
        // ==========================================
        if (map.current.getLayer(wazeMajorLabelsId)) {
            try {
                map.current.setPaintProperty(wazeMajorLabelsId, 'text-color', wazeTextColor);
                map.current.setPaintProperty(wazeMajorLabelsId, 'text-halo-color', wazeHaloColor);
                map.current.setPaintProperty(wazeMajorLabelsId, 'text-halo-width', wazeHaloWidth);
                map.current.setPaintProperty(wazeMajorLabelsId, 'text-halo-blur', wazeHaloBlur);
                map.current.setLayoutProperty(wazeMajorLabelsId, 'symbol-spacing', 500);
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-padding', 20);
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-allow-overlap', false);
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-ignore-placement', false);
                map.current.setLayoutProperty(wazeMajorLabelsId, 'symbol-placement', 'line');
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-rotation-alignment', 'viewport');
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-pitch-alignment', 'viewport');
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-field', ['get', 'name']);
                map.current.setLayoutProperty(wazeMajorLabelsId, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
            } catch (e) {}
        } else {
            try {
                map.current.addLayer({
                    id: wazeMajorLabelsId,
                    type: 'symbol',
                    source: vectorSourceId,
                    'source-layer': 'transportation_name',
                    minzoom: 10,
                    filter: [
                        'any',
                        ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
                        ['all', 
                            ['has', 'name'], 
                            ['!', ['in', ['get', 'class'], ['literal', ['minor', 'service', 'residential', 'track', 'path', 'unclassified', 'tertiary']]]]
                        ]
                    ],
                    layout: {
                        'text-field': ['get', 'name'],
                        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                        'text-size': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            10, 11,
                            13, 13,
                            15, 14.5,
                            17, 16.5
                        ],
                        'symbol-placement': 'line',
                        'text-rotation-alignment': 'viewport',
                        'text-pitch-alignment': 'viewport',
                        'symbol-spacing': 500,
                        'text-padding': 20,
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                        'text-max-angle': 30,
                        'text-letter-spacing': 0.02
                    },
                    paint: {
                        'text-color': wazeTextColor,
                        'text-halo-color': wazeHaloColor,
                        'text-halo-width': wazeHaloWidth,
                        'text-halo-blur': wazeHaloBlur
                    }
                });
            } catch (e) {
                console.warn('[MapLibre] Failed to add waze-road-labels-major layer:', e);
            }
        }

        // ==========================================
        // 2. MINOR ROAD LABELS (Tertiary, Residential, Service, Minor, Unclassified)
        // ==========================================
        if (map.current.getLayer(wazeMinorLabelsId)) {
            try {
                map.current.setPaintProperty(wazeMinorLabelsId, 'text-color', wazeTextColor);
                map.current.setPaintProperty(wazeMinorLabelsId, 'text-halo-color', wazeHaloColor);
                map.current.setPaintProperty(wazeMinorLabelsId, 'text-halo-width', wazeHaloWidth);
                map.current.setPaintProperty(wazeMinorLabelsId, 'text-halo-blur', wazeHaloBlur);
                map.current.setLayoutProperty(wazeMinorLabelsId, 'symbol-spacing', 450);
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-padding', 18);
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-allow-overlap', false);
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-ignore-placement', false);
                map.current.setLayoutProperty(wazeMinorLabelsId, 'symbol-placement', 'line');
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-rotation-alignment', 'viewport');
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-pitch-alignment', 'viewport');
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-field', ['get', 'name']);
                map.current.setLayoutProperty(wazeMinorLabelsId, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
            } catch (e) {}
        } else {
            try {
                map.current.addLayer({
                    id: wazeMinorLabelsId,
                    type: 'symbol',
                    source: vectorSourceId,
                    'source-layer': 'transportation_name',
                    minzoom: 12,
                    filter: [
                        'in',
                        ['get', 'class'],
                        ['literal', ['minor', 'service', 'residential', 'tertiary', 'unclassified']]
                    ],
                    layout: {
                        'text-field': ['get', 'name'],
                        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                        'text-size': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            12, 10.5,
                            14, 12,
                            16, 13.5,
                            18, 15
                        ],
                        'symbol-placement': 'line',
                        'text-rotation-alignment': 'viewport',
                        'text-pitch-alignment': 'viewport',
                        'symbol-spacing': 450,
                        'text-padding': 18,
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                        'text-max-angle': 30,
                        'text-letter-spacing': 0.02
                    },
                    paint: {
                        'text-color': wazeTextColor,
                        'text-halo-color': wazeHaloColor,
                        'text-halo-width': wazeHaloWidth,
                        'text-halo-blur': wazeHaloBlur
                    }
                });
            } catch (e) {
                console.warn('[MapLibre] Failed to add waze-road-labels-minor layer:', e);
            }
        }

        layers.forEach((layer: any) => {
            if (layer.type === 'symbol' && layer.id !== wazeMajorLabelsId && layer.id !== wazeMinorLabelsId && !defaultRoadLayers.includes(layer.id)) {
                const id = layer.id.toLowerCase();
                const isPlaceOrPoi = id.includes('poi') || id.includes('place') || id.includes('park') || 
                                     id.includes('school') || id.includes('hospital') || id.includes('suburb') || id.includes('neighborhood');
                try {
                    if (isPlaceOrPoi) {
                        // POI / Landmark Billboard Alignment
                        try {
                            map.current!.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
                            map.current!.setLayoutProperty(layer.id, 'text-rotation-alignment', 'viewport');
                            map.current!.setLayoutProperty(layer.id, 'text-padding', 3);
                            map.current!.setLayoutProperty(layer.id, 'text-size', [
                                'interpolate', ['linear'], ['zoom'],
                                12, 10,
                                15, 12,
                                18, 14
                            ]);
                        } catch {}

                        const poiColor = isWarmLightSkin ? '#334155' : '#cbd5e1';
                        const poiHalo = isWarmLightSkin ? 'rgba(255, 255, 255, 0.95)' : 'rgba(10, 15, 26, 0.95)';
                        map.current!.setPaintProperty(layer.id, 'text-color', poiColor);
                        map.current!.setPaintProperty(layer.id, 'text-halo-color', poiHalo);
                        map.current!.setPaintProperty(layer.id, 'text-halo-width', 2.2);
                        map.current!.setPaintProperty(layer.id, 'text-halo-blur', 0.5);
                        map.current!.setPaintProperty(layer.id, 'text-opacity', 0.92);
                    } else {
                        // General symbols fallback
                        try {
                            map.current!.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
                        } catch {}
                        const generalColor = isWarmLightSkin ? '#0f172a' : '#f8fafc';
                        const generalHalo = isWarmLightSkin ? 'rgba(255, 255, 255, 0.98)' : 'rgba(5, 8, 17, 0.98)';
                        map.current!.setPaintProperty(layer.id, 'text-color', generalColor);
                        map.current!.setPaintProperty(layer.id, 'text-halo-color', generalHalo);
                        map.current!.setPaintProperty(layer.id, 'text-halo-width', 2.5);
                    }
                } catch (e) {
                    // Ignore layers that don't accept paint properties
                }
            }

            // Enhanced Railroad & Train Track Styling
            if (layer.id.includes('rail') || layer.id.includes('railway') || layer.id.includes('train')) {
                try {
                    map.current!.setLayoutProperty(layer.id, 'visibility', 'visible');
                    if (layer.type === 'line') {
                        map.current!.setPaintProperty(layer.id, 'line-color', isWarmLightSkin ? '#475569' : '#94a3b8');
                        map.current!.setPaintProperty(layer.id, 'line-opacity', 0.9);
                        map.current!.setPaintProperty(layer.id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, 1.5,
                            14, 3.5,
                            17, 6
                        ]);
                    }
                } catch (e) {}
            }
        });

        try {
            map.current.triggerRepaint();
        } catch (e) {}
    }, [mapStyle, isLowDataMode, mapSkin, theme, buildingScale]);

    useEffect(() => {
        if (map.current) return;
        if (!mapContainer.current) return;

        const initialCenter = lastCameraRef.current.center;
        const initialZoom = lastCameraRef.current.zoom;
        const initialPitch = lastCameraRef.current.pitch;
        const initialBearing = lastCameraRef.current.bearing;

        const mapInstance = new maplibregl.Map({
            container: mapContainer.current,
            style: styleUrl,
            center: initialCenter,
            zoom: initialZoom,
            pitch: initialPitch,
            bearing: initialBearing,
            attributionControl: false
        });
        map.current = mapInstance;

        // Clean, compact attribution icon (never stretches across center road view)
        mapInstance.addControl(new maplibregl.AttributionControl({
            compact: true
        }), 'bottom-right');

        // Track live camera position for seamless reboot recovery
        mapInstance.on('move', () => {
            const c = mapInstance.getCenter();
            lastCameraRef.current = {
                center: [c.lng, c.lat],
                zoom: mapInstance.getZoom(),
                pitch: mapInstance.getPitch(),
                bearing: mapInstance.getBearing()
            };
        });

        // User interaction tracking (Drag, Touch, Wheel, Move, Zoom, Pitch, Rotate) to enable free-look mode during navigation
        const handleUserPan = (e?: any) => {
            onUserInteraction?.();
            if (isNavigating) {
                onCameraFreeChange?.(true);
            }
        };
        mapInstance.on('movestart', (e: any) => {
            if (e.originalEvent) handleUserPan(e);
        });
        mapInstance.on('dragstart', handleUserPan);
        mapInstance.on('touchstart', handleUserPan);
        mapInstance.on('wheel', handleUserPan);
        mapInstance.on('zoomstart', (e: any) => {
            if (e.originalEvent) handleUserPan(e);
        });
        mapInstance.on('rotatestart', (e: any) => {
            if (e.originalEvent) handleUserPan(e);
        });
        mapInstance.on('pitchstart', (e: any) => {
            if (e.originalEvent) handleUserPan(e);
        });

        // --- WebGL Context Loss Handlers ---
        const canvas = mapInstance.getCanvas();
        const handleContextLost = (e: Event) => {
            e.preventDefault(); // Standard requirement to permit recovery
            console.warn('⚠️ MapLibre3DView: Canvas WebGL context lost!');
            scheduleMapReboot();
        };
        const handleContextRestored = () => {
            console.log('✅ MapLibre3DView: Canvas WebGL context restored.');
            scheduleMapReboot();
        };
        canvas.addEventListener('webglcontextlost', handleContextLost, false);
        canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

        mapInstance.on('error', (e: any) => {
            const msg = e?.error?.message || '';
            if (msg.includes('WebGL') || msg.includes('context lost') || msg.includes('GL_OUT_OF_MEMORY')) {
                console.warn('⚠️ MapLibre3DView: WebGL error on map instance:', e.error);
                scheduleMapReboot();
            }
        });

        // Check WebGL health on app foreground resume
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (!map.current) {
                    scheduleMapReboot();
                    return;
                }
                try {
                    const c = map.current.getCanvas();
                    const gl = c.getContext('webgl2') || c.getContext('webgl');
                    if (gl && gl.isContextLost()) {
                        console.warn('⚠️ MapLibre3DView: WebGL context lost detected on app resume.');
                        scheduleMapReboot();
                    } else {
                        map.current.resize();
                    }
                } catch {
                    scheduleMapReboot();
                }
            }
        };
        const handleStyleLoaded = () => {
            if (mapInstance.isStyleLoaded()) {
                apply3DBuildingLayer();
            }
        };

        mapInstance.on('load', () => {
            currentStyleUrlRef.current = styleUrl;
            apply3DBuildingLayer();
            setIsMapReady(true);
            onMapReady?.();
        });

        mapInstance.on('styledata', handleStyleLoaded);
        mapInstance.on('style.load', handleStyleLoaded);
        mapInstance.once('idle', () => {
            apply3DBuildingLayer();
        });

        // Track user interaction — suppress auto-camera for 5s after manual pan/zoom
        mapInstance.on('dragstart', () => {
            onUserInteraction?.();
            userInteractedRef.current = Date.now();
        });
        mapInstance.on('zoomstart', () => {
            onUserInteraction?.();
            userInteractedRef.current = Date.now();
        });

        // Report zoom changes for 2D/3D sync
        mapInstance.on('zoomend', () => {
            if (map.current && onZoomChange) {
                onZoomChange(map.current.getZoom());
            }
        });

        // Report bounds changes for unified API (matching MapView)
        mapInstance.on('moveend', () => {
            if (map.current) {
                const bounds = map.current.getBounds();
                const b = {
                    north: bounds.getNorth(),
                    south: bounds.getSouth(),
                    east: bounds.getEast(),
                    west: bounds.getWest()
                };
                if (onBoundsChange) {
                    onBoundsChange(b);
                }
                // Viewport fetching for crowdsourced public reports
                publicMapReportService.fetchReportsInViewport(b).then(reports => {
                    setPublicReports(reports);
                }).catch(() => {});
            }
        });

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
            membersMarkersRef.current.forEach(m => m.remove());
            membersMarkersRef.current.clear();
            placesMarkersRef.current.forEach(m => m.remove());
            placesMarkersRef.current.clear();
            if (destinationMarkerRef.current) {
                destinationMarkerRef.current.remove();
                destinationMarkerRef.current = null;
            }
            if (map.current) {
                try {
                    map.current.remove();
                } catch (e) {}
                map.current = null;
            }
        };
    }, [mapEpoch]);

    // Audit Fix: Reactively update styleUrl when skin or style changes
    useEffect(() => {
        if (!map.current || !isMapReady) return;
        if (!currentStyleUrlRef.current) {
            currentStyleUrlRef.current = styleUrl;
            return;
        }
        if (currentStyleUrlRef.current === styleUrl) return;
        currentStyleUrlRef.current = styleUrl;

        try {
            // Set diff: false to prevent "Cannot read properties of undefined (reading 'setState')"
            // occurring in maplibre-gl when switching between complex style objects.
            map.current.setStyle(styleUrl, { diff: false });
        } catch (err) {
            console.error('🗺️ Map: setStyle failed', err);
        }
    }, [styleUrl, mapStyle, isMapReady]);

    // Live update 3D building heights, ambient landmark glow, and architectural lighting
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;
        apply3DBuildingLayer();
    }, [apply3DBuildingLayer, isMapReady, styleVersion]);

    // UNIFIED MAP: Toggle 2D/3D mode by adjusting pitch and bearing
    // When not navigating, use the static 3D toggle; navigation camera is handled below.
    useEffect(() => {
        if (!map.current || isNavigating) return; // Navigation camera takes priority

        const targetPitch = is3DMode ? 60 : 0;
        const targetBearing = is3DMode ? -17.6 : 0;

        // Only animate if there's a significant change
        if (Math.abs(map.current.getPitch() - targetPitch) > 1) {
            map.current.easeTo({
                pitch: targetPitch,
                bearing: targetBearing,
                duration: 800
            });
        }
    }, [is3DMode, isNavigating]);

    // ==========================================
    // BULLETPROOF REAL-TIME ROUTE GUIDELINE RENDERER
    // ==========================================
    const syncRouteLayers = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;

        const routeId = 'active-route-line';
        const completedId = 'completed-route-line';

        if (routeCoords.length < 2) {
            const routeSrc = map.current.getSource(routeId) as maplibregl.GeoJSONSource | undefined;
            const compSrc = map.current.getSource(completedId) as maplibregl.GeoJSONSource | undefined;
            if (routeSrc) routeSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            if (compSrc) compSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            return;
        }

        const isLightSkin = effectiveSkin === 'warm_cream';
        const isCarbonAmber = effectiveSkin === 'carbon-amber' || effectiveSkin === 'los-santos';

        // Full coordinates array [[lng, lat], ...]
        const fullCoordinates: [number, number][] = routeCoords.map(c => [c.lng, c.lat]);

        // Split logic: remaining vs completed
        const effectiveSplitIndex = Math.min(
            Math.max(0, typeof splitIndex === 'number' ? splitIndex : 0),
            Math.max(0, fullCoordinates.length - 1)
        );

        const remainingCoordinates = fullCoordinates.slice(effectiveSplitIndex);
        const completedCoordinates = fullCoordinates.slice(0, effectiveSplitIndex + 1);

        // Ensure at least 2 points for LineString
        const activeLineCoords = remainingCoordinates.length >= 2 ? remainingCoordinates : fullCoordinates;

        const activeRouteGeoJSON: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {
                        congestion: 'low',
                        isCompleted: false
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: activeLineCoords
                    }
                }
            ]
        };

        const completedRouteGeoJSON: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
            type: 'FeatureCollection',
            features: completedCoordinates.length >= 2 ? [
                {
                    type: 'Feature',
                    properties: {
                        isCompleted: true
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: completedCoordinates
                    }
                }
            ] : []
        };

        const primaryRouteColor = isCarbonAmber 
            ? '#00f2fe' // Vibrant Electric Cyan — maximum contrast against amber/orange roads
            : isLightSkin 
                ? '#0284c7' 
                : '#00f2fe';

        const glowColor = isCarbonAmber 
            ? '#06b6d4' // Electric cyan luminous underglow accent
            : isLightSkin 
                ? '#38bdf8' 
                : '#06b6d4';

        const casingColor = '#000000'; // Pure black high-contrast outer border casing

        try {
            // 1. UPDATE OR ADD SOURCE
            const existingRouteSrc = map.current.getSource(routeId) as maplibregl.GeoJSONSource | undefined;
            if (existingRouteSrc) {
                existingRouteSrc.setData(activeRouteGeoJSON as any);
            } else {
                map.current.addSource(routeId, {
                    type: 'geojson',
                    data: activeRouteGeoJSON as any
                });
            }

            // 2. ADD / UPDATE GLOW LAYER (Bottom glow layer)
            if (!map.current.getLayer(`${routeId}-glow`)) {
                map.current.addLayer({
                    id: `${routeId}-glow`,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': glowColor,
                        'line-width': 18,
                        'line-opacity': 0.45
                    }
                });
            } else {
                map.current.setPaintProperty(`${routeId}-glow`, 'line-color', glowColor);
                map.current.setPaintProperty(`${routeId}-glow`, 'line-width', 18);
                map.current.setPaintProperty(`${routeId}-glow`, 'line-opacity', 0.45);
            }

            // 3. ADD / UPDATE CASING LAYER (Solid 2px pure black border on both sides of 8px guideline)
            if (!map.current.getLayer(`${routeId}-casing`)) {
                map.current.addLayer({
                    id: `${routeId}-casing`,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': casingColor,
                        'line-width': 12,
                        'line-opacity': 1.0
                    }
                });
            } else {
                map.current.setPaintProperty(`${routeId}-casing`, 'line-color', casingColor);
                map.current.setPaintProperty(`${routeId}-casing`, 'line-width', 12);
                map.current.setPaintProperty(`${routeId}-casing`, 'line-opacity', 1.0);
            }

            // 4. ADD / UPDATE MAIN GUIDELINE LAYER (8px Electric Cyan guideline)
            if (!map.current.getLayer(routeId)) {
                map.current.addLayer({
                    id: routeId,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': primaryRouteColor,
                        'line-width': 8,
                        'line-opacity': 1.0
                    }
                });
            } else {
                map.current.setPaintProperty(routeId, 'line-color', primaryRouteColor);
                map.current.setPaintProperty(routeId, 'line-width', 8);
                map.current.setPaintProperty(routeId, 'line-opacity', 1.0);
            }

            // 4b. ADD / UPDATE DIRECTIONAL CHEVRON ACCENT LAYER (White/Cyan turn flow on center line)
            if (!map.current.getLayer(`${routeId}-chevrons`)) {
                map.current.addLayer({
                    id: `${routeId}-chevrons`,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#ffffff',
                        'line-width': 3,
                        'line-dasharray': [0.4, 2.6],
                        'line-opacity': 0.85
                    }
                });
            } else {
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-color', '#ffffff');
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-width', 3);
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-dasharray', [0.4, 2.6]);
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-opacity', 0.85);
            }

            // 5. COMPLETED ROUTE LAYER
            const existingCompSrc = map.current.getSource(completedId) as maplibregl.GeoJSONSource | undefined;
            if (existingCompSrc) {
                existingCompSrc.setData(completedRouteGeoJSON as any);
            } else {
                map.current.addSource(completedId, {
                    type: 'geojson',
                    data: completedRouteGeoJSON as any
                });
            }

            if (!map.current.getLayer(completedId)) {
                map.current.addLayer({
                    id: completedId,
                    type: 'line',
                    source: completedId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': theme === 'dark' ? '#475569' : '#94a3b8',
                        'line-width': 6,
                        'line-opacity': 0.45
                    }
                });
            }
        } catch (err) {
            console.warn('[MapLibre3DView] Error syncing route layers:', err);
        }
    }, [routeCoords, splitIndex, mapSkin, effectiveSkin, theme]);

    // Trigger route layers sync whenever route, split index, map state, or skin changes
    useEffect(() => {
        if (!map.current || !isMapReady) return;
        syncRouteLayers();

        const onMapData = () => syncRouteLayers();
        map.current.on('styledata', onMapData);
        map.current.on('style.load', onMapData);
        map.current.on('idle', onMapData);

        return () => {
            if (map.current) {
                map.current.off('styledata', onMapData);
                map.current.off('style.load', onMapData);
                map.current.off('idle', onMapData);
            }
        };
    }, [syncRouteLayers, isMapReady, styleVersion]); 

    // ==========================================
    // UNIFIED DESTINATION PIN MARKER (HIGH-VISIBILITY DOM MARKER)
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        // Clean up any legacy WebGL layers if present
        try {
            if (map.current.getLayer('destination-name-label')) map.current.removeLayer('destination-name-label');
            if (map.current.getLayer('destination-pin-symbol')) map.current.removeLayer('destination-pin-symbol');
            if (map.current.getLayer('destination-core-circle')) map.current.removeLayer('destination-core-circle');
            if (map.current.getLayer('destination-pulse-glow')) map.current.removeLayer('destination-pulse-glow');
            if (map.current.getSource('destination-pin-webgl-source')) map.current.removeSource('destination-pin-webgl-source');
        } catch {}

        // Resolve destination coordinate: prefer activeRoute.destinationLoc,
        // fallback to the last coordinate of the route polyline or steps
        let destLoc: { lat: number; lng: number } | null = null;
        if (
            activeRoute?.destinationLoc &&
            typeof activeRoute.destinationLoc.lat === 'number' &&
            typeof activeRoute.destinationLoc.lng === 'number' &&
            !isNaN(activeRoute.destinationLoc.lat) &&
            !isNaN(activeRoute.destinationLoc.lng) &&
            !(activeRoute.destinationLoc.lat === 0 && activeRoute.destinationLoc.lng === 0)
        ) {
            destLoc = { lat: Number(activeRoute.destinationLoc.lat), lng: Number(activeRoute.destinationLoc.lng) };
        } else if (routeCoords && routeCoords.length > 0) {
            const lastCoord = routeCoords[routeCoords.length - 1];
            if (
                lastCoord &&
                typeof lastCoord.lat === 'number' &&
                typeof lastCoord.lng === 'number' &&
                !isNaN(lastCoord.lat) &&
                !isNaN(lastCoord.lng) &&
                !(lastCoord.lat === 0 && lastCoord.lng === 0)
            ) {
                destLoc = { lat: Number(lastCoord.lat), lng: Number(lastCoord.lng) };
            }
        } else if (Array.isArray(activeRoute?.steps) && activeRoute.steps.length > 0) {
            const lastStep = activeRoute.steps[activeRoute.steps.length - 1];
            if (
                lastStep?.endLocation &&
                typeof lastStep.endLocation.lat === 'number' &&
                typeof lastStep.endLocation.lng === 'number' &&
                !isNaN(lastStep.endLocation.lat) &&
                !isNaN(lastStep.endLocation.lng)
            ) {
                destLoc = { lat: Number(lastStep.endLocation.lat), lng: Number(lastStep.endLocation.lng) };
            }
        }

        // If no active route or destination, remove existing marker
        if (!destLoc || !activeRoute) {
            if (destinationMarkerRef.current) {
                destinationMarkerRef.current.remove();
                destinationMarkerRef.current = null;
            }
            return;
        }

        const destName = activeRoute.destinationName || 'Destination';
        const isGTA = effectiveSkin === 'carbon-amber' || effectiveSkin === 'los-santos';

        // Recreate marker on skin/theme changes to ensure correct visuals
        if (destinationMarkerRef.current) {
            destinationMarkerRef.current.remove();
            destinationMarkerRef.current = null;
        }

        const el = document.createElement('div');
        el.className = 'myway-destination-marker select-none';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.style.zIndex = '50';

        if (isGTA) {
            el.innerHTML = getGTADestinationPinHtml();
        } else {
            el.innerHTML = `
                <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                    <!-- Animated Pulse Glow Ring (Brand Purple Smooth Glow) -->
                    <div style="
                        position: absolute;
                        top: -8px;
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: rgba(168, 85, 247, 0.25);
                        border: 2px solid rgba(168, 85, 247, 0.65);
                        animation: marker-steady-pulse 2.2s ease-in-out infinite;
                        pointer-events: none;
                    "></div>
                    
                    <!-- Core Pin Badge -->
                    <div style="
                        position: relative;
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
                        border: 3px solid #ffffff;
                        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5), 0 0 14px rgba(168, 85, 247, 0.7);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 20px;
                        z-index: 2;
                        transition: transform 0.15s ease;
                    ">
                        🏁
                    </div>
                    
                    <!-- Pin Needle Pointer -->
                    <div style="
                        width: 0;
                        height: 0;
                        border-left: 7px solid transparent;
                        border-right: 7px solid transparent;
                        border-top: 10px solid #7c3aed;
                        margin-top: -2px;
                        z-index: 1;
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
                    "></div>

                    <!-- Destination Name Pill -->
                    <div class="destination-label-text" style="
                        margin-top: 4px;
                        padding: 3px 10px;
                        background: ${isGTA ? 'rgba(2, 6, 23, 0.94)' : theme === 'dark' ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)'};
                        color: ${isGTA ? '#00f2fe' : theme === 'dark' ? '#f8fafc' : '#0f172a'};
                        border: 1.5px solid ${isGTA ? '#00f2fe' : theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)'};
                        border-radius: 9999px;
                        font-size: 11px;
                        font-weight: 900;
                        white-space: nowrap;
                        max-width: 150px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        box-shadow: ${isGTA ? '0 4px 14px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 242, 254, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.4)'};
                        letter-spacing: 0.02em;
                        backdrop-filter: blur(8px);
                    ">
                        ${destName}
                    </div>
                </div>
            `;
        }

        el.addEventListener('mouseenter', () => {
            const badge = el.querySelector('div[style*="border-radius: 50%"]') as HTMLElement;
            if (badge) badge.style.transform = 'scale(1.15)';
        });
        el.addEventListener('mouseleave', () => {
            const badge = el.querySelector('div[style*="border-radius: 50%"]') as HTMLElement;
            if (badge) badge.style.transform = 'scale(1)';
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([destLoc.lng, destLoc.lat])
            .addTo(map.current);

        destinationMarkerRef.current = marker;

        return () => {
            if (destinationMarkerRef.current) {
                destinationMarkerRef.current.remove();
                destinationMarkerRef.current = null;
            }
        };
    }, [activeRoute?.destinationLoc, activeRoute?.destinationName, routeCoords, isMapReady, effectiveSkin, theme]);

    // Intermediate Waypoint Numbered Amber Diamond Chips on 3D Map
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        // Clean up previous markers
        waypointMarkersRef.current.forEach(m => m.remove());
        waypointMarkersRef.current = [];

        const waypoints = activeRoute?.waypoints?.filter(w => w.isStop !== false) || [];
        if (waypoints.length === 0) return;

        waypoints.forEach((wp, idx) => {
            if (!wp.location) return;

            const el = document.createElement('div');
            el.className = 'myway-waypoint-chip select-none';
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.alignItems = 'center';
            el.style.cursor = 'pointer';
            el.style.zIndex = '45';

            el.innerHTML = `
                <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                    <!-- Subtle Amber Radar Pulse -->
                    <div style="
                        position: absolute;
                        top: -6px;
                        width: 44px;
                        height: 44px;
                        border-radius: 50%;
                        background: rgba(245, 158, 11, 0.22);
                        border: 1.5px solid rgba(245, 158, 11, 0.6);
                        animation: destination-ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite;
                        pointer-events: none;
                    "></div>

                    <!-- 2px Pure Black Casing & Amber Diamond Chip -->
                    <div style="
                        position: relative;
                        width: 32px;
                        height: 32px;
                        background: #020617;
                        border: 2px solid #000000;
                        outline: 2px solid #f59e0b;
                        border-radius: 6px;
                        transform: rotate(45deg);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.9), 0 0 10px rgba(245, 158, 11, 0.5);
                        transition: transform 0.15s ease;
                    ">
                        <span style="
                            transform: rotate(-45deg);
                            font-size: 13px;
                            font-weight: 900;
                            color: #fbbf24;
                            line-height: 1;
                            font-family: ui-monospace, monospace;
                        ">${idx + 1}</span>
                    </div>

                    <!-- Amber Pointer Stem -->
                    <div style="
                        width: 0;
                        height: 0;
                        border-left: 5px solid transparent;
                        border-right: 5px solid transparent;
                        border-top: 7px solid #f59e0b;
                        margin-top: 3px;
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
                    "></div>

                    <!-- Waypoint Name Pill -->
                    <div style="
                        margin-top: 3px;
                        padding: 2px 8px;
                        border-radius: 9999px;
                        background: rgba(2, 6, 23, 0.94);
                        border: 1.5px solid rgba(245, 158, 11, 0.6);
                        color: #fbbf24;
                        font-size: 10px;
                        font-weight: 900;
                        white-space: nowrap;
                        max-width: 140px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.8), 0 0 8px rgba(245, 158, 11, 0.3);
                        letter-spacing: 0.02em;
                        backdrop-filter: blur(8px);
                    ">
                        ${wp.name || `Stop ${idx + 1}`}
                    </div>
                </div>
            `;

            el.addEventListener('mouseenter', () => {
                const chip = el.querySelector('div[style*="transform: rotate(45deg)"]') as HTMLElement;
                if (chip) chip.style.transform = 'rotate(45deg) scale(1.15)';
            });
            el.addEventListener('mouseleave', () => {
                const chip = el.querySelector('div[style*="transform: rotate(45deg)"]') as HTMLElement;
                if (chip) chip.style.transform = 'rotate(45deg) scale(1)';
            });

            const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                .setLngLat([wp.location.lng, wp.location.lat])
                .addTo(map.current!);

            waypointMarkersRef.current.push(marker);
        });

        return () => {
            waypointMarkersRef.current.forEach(m => m.remove());
            waypointMarkersRef.current = [];
        };
    }, [activeRoute?.waypoints, isMapReady, effectiveSkin, theme]);

    // Dynamic Amber Highway Junction & Off-Ramp Beacon Pulse on Map
    useEffect(() => {
        if (!map.current || !isMapReady || !isNavigating || !activeRoute) {
            if (junctionBeaconMarkerRef.current) {
                junctionBeaconMarkerRef.current.remove();
                junctionBeaconMarkerRef.current = null;
            }
            return;
        }

        const steps = activeRoute.steps || [];
        const step = steps[currentStepIndex] || steps[currentStepIndex + 1];

        if (!step || !step.instruction) {
            if (junctionBeaconMarkerRef.current) {
                junctionBeaconMarkerRef.current.remove();
                junctionBeaconMarkerRef.current = null;
            }
            return;
        }

        const text = step.instruction.toLowerCase();
        const isExitOrRamp = text.includes('exit') || text.includes('ramp') || text.includes('fork') || text.includes('merge') || text.includes('junction') || text.includes('outer loop') || text.includes('fwy');

        if (!isExitOrRamp) {
            if (junctionBeaconMarkerRef.current) {
                junctionBeaconMarkerRef.current.remove();
                junctionBeaconMarkerRef.current = null;
            }
            return;
        }

        // Determine junction GPS coordinate
        let junctionCoord: [number, number] | null = null;
        if (step.endLocation && typeof step.endLocation.lng === 'number' && typeof step.endLocation.lat === 'number') {
            junctionCoord = [step.endLocation.lng, step.endLocation.lat];
        } else if (routeCoords && routeCoords.length > 0) {
            const targetIdx = Math.min(routeCoords.length - 1, Math.max(0, (splitIndex || currentStepIndex) + 4));
            junctionCoord = [routeCoords[targetIdx].lng, routeCoords[targetIdx].lat];
        }

        if (!junctionCoord) {
            if (junctionBeaconMarkerRef.current) {
                junctionBeaconMarkerRef.current.remove();
                junctionBeaconMarkerRef.current = null;
            }
            return;
        }

        const exitMatch = step.instruction.match(/exit\s+([0-9]+[a-z]?)/i);
        const exitLabel = exitMatch ? `EXIT ${exitMatch[1].toUpperCase()}` : text.includes('ramp') ? 'OFF-RAMP' : 'JUNCTION';

        if (junctionBeaconMarkerRef.current) {
            junctionBeaconMarkerRef.current.setLngLat(junctionCoord);
            return;
        }

        const el = document.createElement('div');
        el.className = 'myway-junction-beacon select-none pointer-events-none';
        el.style.position = 'relative';
        el.style.width = '64px';
        el.style.height = '64px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';

        el.innerHTML = `
            <!-- Dynamic Amber Beacon Radar Pulse -->
            <div style="position: absolute; inset: 0px; border-radius: 50%; background: #f97316; opacity: 0.45; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <!-- Secondary Luminous Ring -->
            <div style="position: absolute; inset: 10px; border-radius: 50%; background: rgba(249, 115, 22, 0.25); border: 2px solid #fbbf24; box-shadow: 0 0 16px rgba(249, 115, 22, 0.75);"></div>
            <!-- High-Contrast Exit Signboard Marker -->
            <div style="position: relative; z-index: 2; padding: 3px 8px; border-radius: 999px; background: #0b0f17; border: 2px solid #f97316; box-shadow: 0 4px 14px rgba(0,0,0,0.85); display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 11px;">🛣️</span>
                <span style="font-size: 9px; font-weight: 900; color: #fbbf24; letter-spacing: 0.05em; text-transform: uppercase;">${exitLabel}</span>
            </div>
        `;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat(junctionCoord)
            .addTo(map.current);

        junctionBeaconMarkerRef.current = marker;

        return () => {
            if (junctionBeaconMarkerRef.current) {
                junctionBeaconMarkerRef.current.remove();
                junctionBeaconMarkerRef.current = null;
            }
        };
    }, [isNavigating, activeRoute, currentStepIndex, splitIndex, routeCoords, isMapReady]);

    // Auto-frame route when previewing or starting route
    useEffect(() => {
        if (!map.current || !isMapReady || !activeRoute || isNavigating) return;
        const coords = activeRoute.routeGeometry && activeRoute.routeGeometry.length > 0
            ? activeRoute.routeGeometry
            : activeRoute.steps?.map((s: any) => s.endLocation ? [s.endLocation.lng, s.endLocation.lat] : null).filter(Boolean);

        if (coords && coords.length > 1) {
            const bounds = new maplibregl.LngLatBounds();
            coords.forEach((c: any) => {
                if (Array.isArray(c)) bounds.extend([c[0], c[1]]);
                else if (c.lng && c.lat) bounds.extend([c.lng, c.lat]);
            });
            if (activeRoute.startLoc) bounds.extend([activeRoute.startLoc.lng, activeRoute.startLoc.lat]);
            if (activeRoute.destinationLoc) bounds.extend([activeRoute.destinationLoc.lng, activeRoute.destinationLoc.lat]);

            try {
                map.current.fitBounds(bounds, {
                    padding: isMobile 
                        ? { top: 60, bottom: 260, left: 30, right: 30 }
                        : { top: 80, bottom: 80, left: 320, right: 80 },
                    duration: 900,
                    maxZoom: 16
                });
            } catch (e) {
                console.warn('[MapLibre] fitBounds error:', e);
            }
        }
    }, [activeRoute?.destinationName, activeRoute?.totalDistance, isNavigating, isMapReady, isMobile]);

    // ==========================================
    // TRAFFIC CONTROLS & RAILROAD CROSSINGS (STOP SIGNS, RED LIGHTS, TRAIN TRACKS)
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        // Clear markers if disabled or no active route / not navigating
        if (showTrafficControls === false || (!activeRoute && !isNavigating)) {
            trafficControlMarkersRef.current.forEach(m => m.remove());
            trafficControlMarkersRef.current.clear();
            return;
        }

        let isCancelled = false;

        const updateMarkers = (controls: TrafficControlPoint[]) => {
            if (isCancelled || !map.current) return;
            const currentIds = new Set(controls.map(c => c.id));

            // Remove stale markers
            for (const [id, marker] of trafficControlMarkersRef.current.entries()) {
                if (!currentIds.has(id)) {
                    marker.remove();
                    trafficControlMarkersRef.current.delete(id);
                }
            }

            // Render each real traffic control
            controls.forEach(ctrl => {
                if (!ctrl.location || typeof ctrl.location.lat !== 'number' || typeof ctrl.location.lng !== 'number') return;

                let marker = trafficControlMarkersRef.current.get(ctrl.id);
                if (!marker) {
                    const el = document.createElement('div');
                    el.className = 'myway-traffic-control-marker select-none';
                    el.style.cursor = 'pointer';
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.alignItems = 'center';
                    el.style.filter = 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))';
                    el.style.transform = 'translate3d(0,0,0)';

                    if (ctrl.type === 'stop_sign') {
                        el.innerHTML = `
                            <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                                <div style="background: #dc2626; border: 2px solid #ffffff; width: 24px; height: 24px; clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%); display: flex; align-items: center; justify-content: center; font-size: 6.5px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px; box-shadow: 0 0 10px rgba(220,38,38,0.6);">
                                    STOP
                                </div>
                                <div style="width: 2px; height: 8px; background: #ffffff; opacity: 0.85;"></div>
                            </div>
                        `;
                    } else if (ctrl.type === 'traffic_light') {
                        el.innerHTML = `
                            <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                                <div style="background: #0f172a; border: 1.5px solid #334155; border-radius: 6px; padding: 2px 3px; display: flex; flex-direction: column; gap: 2px; align-items: center; box-shadow: 0 0 10px rgba(234,179,8,0.3);">
                                    <div style="width: 5px; height: 5px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 4px #ef4444;"></div>
                                    <div style="width: 5px; height: 5px; border-radius: 50%; background: #eab308; opacity: 0.4;"></div>
                                    <div style="width: 5px; height: 5px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 4px #22c55e;"></div>
                                </div>
                                <div style="width: 1.5px; height: 8px; background: #64748b;"></div>
                            </div>
                        `;
                    } else if (ctrl.type === 'railroad_crossing') {
                        el.innerHTML = `
                            <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                                <div style="background: #f59e0b; border: 2px solid #000000; border-radius: 4px; transform: rotate(45deg); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px rgba(245,158,11,0.6);">
                                    <div style="transform: rotate(-45deg); font-weight: 900; font-size: 10px; line-height: 1;">
                                        🚂
                                    </div>
                                </div>
                                <div style="margin-top: 3px; background: rgba(0,0,0,0.85); border: 1px solid #f59e0b; border-radius: 3px; padding: 1px 3px; font-size: 6.5px; font-weight: 900; color: #fbbf24; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px;">
                                    Rail
                                </div>
                            </div>
                        `;
                    } else if (ctrl.type === 'speed_camera') {
                        el.innerHTML = `
                            <div style="background: #4f46e5; border: 1.5px solid #ffffff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 9px; box-shadow: 0 0 8px rgba(99,102,241,0.5);">
                                📷
                            </div>
                        `;
                    }

                    marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                        .setLngLat([ctrl.location.lng, ctrl.location.lat])
                        .addTo(map.current!);
                    trafficControlMarkersRef.current.set(ctrl.id, marker);
                } else {
                    marker.setLngLat([ctrl.location.lng, ctrl.location.lat]);
                }
            });
        };

        if (activeRoute?.trafficControls && activeRoute.trafficControls.length > 0) {
            updateMarkers(activeRoute.trafficControls);
        } else if (activeRoute?.routeGeometry && activeRoute.routeGeometry.length > 0) {
            osmTrafficService.fetchControlsForRoute(activeRoute.routeGeometry).then(controls => {
                if (!isCancelled) updateMarkers(controls);
            });
        } else if (userLocation && isNavigating) {
            osmTrafficService.fetchControlsInBBox(
                userLocation.lat - 0.015,
                userLocation.lng - 0.015,
                userLocation.lat + 0.015,
                userLocation.lng + 0.015
            ).then(controls => {
                if (!isCancelled) updateMarkers(controls);
            });
        }

        return () => {
            isCancelled = true;
        };
    }, [activeRoute?.trafficControls, activeRoute?.routeGeometry, showTrafficControls, isMapReady, isNavigating, userLocation?.lat, userLocation?.lng]);

    // ==========================================
    // CROWD-SOURCED ROAD INCIDENTS (POLICE, HAZARDS, SHOULDER, WORK ZONES)
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const validIncidents = (incidents || []).filter(
            (inc: any) => inc && inc.location && typeof inc.location.lat === 'number' && typeof inc.location.lng === 'number'
        );
        const currentIds = new Set(validIncidents.map((i: any) => i.id));

        // Remove stale incident markers
        for (const [id, marker] of incidentMarkersRef.current.entries()) {
            if (!currentIds.has(id)) {
                marker.remove();
                incidentMarkersRef.current.delete(id);
            }
        }

        // Render or update each incident marker
        validIncidents.forEach((inc: any) => {
            let marker = incidentMarkersRef.current.get(inc.id);
            if (!marker) {
                const el = document.createElement('div');
                el.className = 'myway-incident-marker select-none';
                el.style.cursor = 'pointer';
                el.style.display = 'flex';
                el.style.flexDirection = 'column';
                el.style.alignItems = 'center';
                el.style.filter = 'drop-shadow(0 6px 16px rgba(0,0,0,0.6))';
                el.style.transform = 'translate3d(0,0,0)';

                const icon = 
                    inc.type === 'police' ? '🚔' :
                    inc.type === 'hazard' ? '⚠️' :
                    inc.type === 'shoulder' ? '🚗' :
                    inc.type === 'construction' ? '🚧' :
                    inc.type === 'traffic' ? '🚙' : '🛡️';

                const label = 
                    inc.type === 'police' ? 'Police' :
                    inc.type === 'hazard' ? 'Hazard' :
                    inc.type === 'shoulder' ? 'Shoulder' :
                    inc.type === 'construction' ? 'Work Zone' :
                    inc.type === 'traffic' ? 'Traffic' : 'Alert';

                const color = 
                    inc.type === 'police' ? '#3b82f6' :
                    inc.type === 'hazard' ? '#f59e0b' :
                    inc.type === 'shoulder' ? '#a855f7' :
                    inc.type === 'construction' ? '#f97316' :
                    inc.type === 'traffic' ? '#ef4444' : '#10b981';

                el.innerHTML = `
                    <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                        <div style="position: absolute; inset: -4px; border-radius: 50%; background: ${color}; opacity: 0.4; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                        <div style="width: 38px; height: 38px; border-radius: 50%; background: ${color}; border: 2.5px solid #ffffff; box-shadow: 0 4px 16px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; font-size: 18px; position: relative;">
                            ${icon}
                        </div>
                        <div style="margin-top: 3px; background: rgba(0,0,0,0.85); border: 1px solid ${color}; border-radius: 6px; padding: 1px 5px; font-size: 8.5px; font-weight: 900; color: #ffffff; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 3px;">
                            <span>${label}</span>
                            ${(inc.upvotes || 1) > 1 ? `<span style="color: #4ade80;">+${inc.upvotes}</span>` : ''}
                        </div>
                    </div>
                `;

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (onSelectIncident) {
                        onSelectIncident(inc);
                    }
                });

                marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                    .setLngLat([inc.location.lng, inc.location.lat])
                    .addTo(map.current!);
                incidentMarkersRef.current.set(inc.id, marker);
            } else {
                marker.setLngLat([inc.location.lng, inc.location.lat]);
            }
        });
    }, [incidents, isMapReady, onSelectIncident]);

    const placesRef = useRef(places);
    placesRef.current = places;

    // Track previous mapSkin to reset places and members markers on skin change
    const prevMapSkinRef = useRef(mapSkin);

    // ==========================================
    // PLACES MARKERS (HTML DOM MARKERS FOR GUARANTEED INSTANT VISIBILITY)
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const validPlaces = (places || []).filter(p => p && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number' && !(p.location.lat === 0 && p.location.lng === 0));
        const currentPlaceIds = new Set(validPlaces.map(p => p.id));

        // Remove old place markers
        for (const [id, marker] of placesMarkersRef.current.entries()) {
            if (!currentPlaceIds.has(id)) {
                marker.remove();
                placesMarkersRef.current.delete(id);
            }
        }

        // Add or update place markers
        validPlaces.forEach(place => {
            const isHome = place.type === 'home' || place.category === 'home' || place.name?.toLowerCase() === 'home' || place.tags?.includes('home');
            const placeColor = place.brandColor || (place as any).color || (
                isHome ? '#8b5cf6' :
                place.type === 'work' ? '#3b82f6' :
                place.type === 'school' ? '#f59e0b' :
                place.type === 'gym' ? '#ec4899' :
                place.type === 'gas' ? '#f97316' :
                place.type === 'food' ? '#ef4444' :
                place.type === 'coffee' ? '#a855f7' :
                place.type === 'fire_station' ? '#dc2626' :
                place.type === 'hospital' || place.type === 'emergency' ? '#e11d48' :
                place.type === 'police' ? '#2563eb' :
                place.type === 'grocery' ? '#10b981' :
                place.type === 'pharmacy' ? '#06b6d4' : '#8b5cf6'
            );

            const rawIcon = place.icon || (
                isHome ? '🏠' :
                place.type === 'work' ? '💼' :
                place.type === 'school' ? '🏫' :
                place.type === 'gym' ? '💪' :
                place.type === 'gas' ? '⛽' :
                place.type === 'food' ? '🍔' :
                place.type === 'coffee' ? '☕' :
                place.type === 'fire_station' ? '🚒' :
                place.type === 'hospital' || place.type === 'emergency' ? '🏥' :
                place.type === 'police' ? '🚓' :
                place.type === 'grocery' ? '🛒' :
                place.type === 'pharmacy' ? '💊' : '📍'
            );
            const icon = rawIcon === 'home' ? '🏠' : rawIcon;

            const isAmbient = !!place.isAmbient;
            const isDark = theme === 'dark';
            const textColor = isDark ? '#94a3b8' : '#475569';
            const haloColor = isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.9)';

            const isSelected = !!selectedPlaceId && selectedPlaceId === place.id;
            const isSearchResult = place.type === 'search_result' || (place.id && (place.id.startsWith('photon-') || place.id.startsWith('nominatim-') || place.id.startsWith('google-')));

            const markerHtml = isAmbient ? `
                <div class="myway-ambient-poi-text" style="display: flex; align-items: center; justify-content: center; padding: 2px 4px; pointer-events: auto; user-select: none;">
                    <span style="
                        font-family: inherit;
                        font-size: 10.5px;
                        font-weight: 600;
                        letter-spacing: 0.02em;
                        color: ${textColor};
                        text-shadow: -1px -1px 0 ${haloColor}, 1px -1px 0 ${haloColor}, -1px 1px 0 ${haloColor}, 1px 1px 0 ${haloColor}, 0 2px 4px rgba(0,0,0,0.5);
                        text-align: center;
                        white-space: nowrap;
                        max-width: 140px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        transition: color 0.15s ease, transform 0.15s ease;
                    ">${place.name}</span>
                </div>
            ` : `
                <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
                    ${isSelected ? `
                        <div style="
                            position: absolute;
                            inset: -5px;
                            border-radius: 9999px;
                            background: rgba(168, 85, 247, 0.3);
                            border: 2px solid #a855f7;
                            animation: marker-steady-pulse 2.2s ease-in-out infinite;
                            pointer-events: none;
                        "></div>
                    ` : ''}
                    <!-- Auto-width pill container that prevents text overflow -->
                    <div class="myway-pin-badge" style="
                        position: relative;
                        width: auto;
                        min-width: 40px;
                        height: ${isSelected ? '40px' : '36px'};
                        padding: 0 10px;
                        border-radius: 9999px;
                        background: ${placeColor};
                        border: ${isSelected ? '3px solid #ffffff' : '2.5px solid #ffffff'};
                        box-shadow: ${isSelected ? '0 6px 20px rgba(0,0,0,0.5), 0 0 14px ' + placeColor : '0 4px 14px rgba(0,0,0,0.35)'};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                        transition: transform 0.15s ease;
                    ">
                        <span style="font-size: ${isSelected ? '18px' : '16px'}; line-height: 1; display: flex; align-items: center;">${icon}</span>
                        ${isHome ? `
                            <span style="font-size: 13px; font-weight: 700; color: #ffffff; white-space: nowrap; text-align: center; letter-spacing: -0.2px;">Home</span>
                        ` : ''}
                        ${place.isCorrected ? `
                            <div style="position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 50%; background: #f59e0b; border: 1.5px solid #ffffff; display: flex; align-items: center; justify-content: center; font-size: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.4);" title="Verified Entrance Pin">
                                ⭐
                            </div>
                        ` : ''}
                    </div>
                    <!-- Pin Needle Pointer -->
                    <div style="
                        width: 0;
                        height: 0;
                        border-left: 6px solid transparent;
                        border-right: 6px solid transparent;
                        border-top: 8px solid ${placeColor};
                        margin-top: -2px;
                        filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4));
                    "></div>
                    <!-- Label Pill for Search Results and Selected Places -->
                    ${(isSelected || isSearchResult) && !isHome ? `
                        <div style="
                            margin-top: 3px;
                            padding: 2px 10px;
                            background: ${isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)'};
                            color: ${isDark ? '#f8fafc' : '#0f172a'};
                            border: 1px solid ${isSelected ? '#a855f7' : (isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)')};
                            border-radius: 9999px;
                            font-size: 11px;
                            font-weight: 800;
                            white-space: nowrap;
                            max-width: 180px;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.35);
                            pointer-events: none;
                        ">
                            ${place.name}
                        </div>
                    ` : ''}
                </div>
            `;

            let marker = placesMarkersRef.current.get(place.id);
            const isAttached = marker && marker.getElement() && marker.getElement().parentNode;

            if (!marker || !isAttached) {
                if (marker) {
                    try { marker.remove(); } catch (e) {}
                }
                const el = document.createElement('div');
                el.className = `myway-place-marker select-none ${isAmbient ? 'myway-ambient-poi' : ''}`;
                el.style.display = 'flex';
                el.style.flexDirection = 'column';
                el.style.alignItems = 'center';
                el.style.cursor = 'pointer';
                el.style.transform = 'translate3d(0,0,0)';
                el.style.zIndex = isSelected ? '60' : isSearchResult ? '35' : isAmbient ? '10' : '25';
                el.innerHTML = markerHtml;

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onSelectPlace?.(place);
                });

                el.addEventListener('mouseenter', () => {
                    if (isAmbient) {
                        const span = el.querySelector('span');
                        if (span) {
                            span.style.color = isDark ? '#ffffff' : '#0f172a';
                            span.style.transform = 'scale(1.08)';
                        }
                    } else {
                        const badge = (el.querySelector('.myway-pin-badge') || el.querySelector('div')) as HTMLElement;
                        if (badge) badge.style.transform = 'scale(1.15)';
                    }
                });
                el.addEventListener('mouseleave', () => {
                    if (isAmbient) {
                        const span = el.querySelector('span');
                        if (span) {
                            span.style.color = textColor;
                            span.style.transform = 'scale(1)';
                        }
                    } else {
                        const badge = (el.querySelector('.myway-pin-badge') || el.querySelector('div')) as HTMLElement;
                        if (badge) badge.style.transform = 'scale(1)';
                    }
                });

                const anchor = isAmbient ? 'center' : 'bottom';
                marker = new maplibregl.Marker({ element: el, anchor })
                    .setLngLat([place.location.lng, place.location.lat])
                    .addTo(map.current!);
                placesMarkersRef.current.set(place.id, marker);
            } else {
                marker.getElement().innerHTML = markerHtml;
                marker.getElement().style.zIndex = isSelected ? '60' : isSearchResult ? '35' : isAmbient ? '10' : '25';
                marker.setLngLat([place.location.lng, place.location.lat]);
            }
        });
    }, [places, isMapReady, theme, styleVersion, onSelectPlace, selectedPlaceId]);

    // ==========================================
    // PREDICTIVE AUTONOMOUS MAINTENANCE CORRIDOR LAYER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'ambient-maintenance-source';
        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: maintenancePlaces.map(p => ({
                type: 'Feature',
                id: p.id,
                properties: {
                    id: p.id,
                    name: p.name,
                    label: `${p.name} (+${p.detourMinutes || 2}m)`,
                    icon: p.icon || '🔧',
                    deal: p.deal || 'Recommended Service',
                    detour: `+${p.detourMinutes || 2} min detour`
                },
                geometry: {
                    type: 'Point',
                    coordinates: [p.location.lng, p.location.lat]
                }
            }))
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            // 1. Pulsing Ambient Amber Glow
            map.current.addLayer({
                id: 'ambient-maintenance-glow',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': '#f59e0b',
                    'circle-radius': 18,
                    'circle-opacity': 0.35,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });

            // 2. Core Amber Badge
            map.current.addLayer({
                id: 'ambient-maintenance-badge',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': '#d97706',
                    'circle-radius': 12,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.95
                }
            });

            // 3. Mechanic Emoji Icon
            map.current.addLayer({
                id: 'ambient-maintenance-symbol',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'icon'],
                    'text-size': 13,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                }
            });

            // 4. Detour & Name Label
            map.current.addLayer({
                id: 'ambient-maintenance-label',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'label'],
                    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10.5,
                    'text-offset': [0, 1.6],
                    'text-anchor': 'top',
                    'text-optional': true
                },
                paint: {
                    'text-color': '#f59e0b',
                    'text-halo-color': theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    'text-halo-width': 2
                }
            });

            // Click -> select place
            map.current.on('click', 'ambient-maintenance-badge', (e) => {
                const feature = e.features?.[0];
                if (feature?.properties?.id) {
                    const place = maintenancePlaces.find(p => p.id === feature.properties.id);
                    if (place) onSelectPlace?.(place);
                }
            });

            map.current.on('mouseenter', 'ambient-maintenance-badge', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
            map.current.on('mouseleave', 'ambient-maintenance-badge', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
        }
    }, [maintenancePlaces, onSelectPlace, isMapReady, styleVersion, theme]);

    // ==========================================
    // UNIFIED WEBGL GEOFENCE POLYGONS
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'places-geofences-source';
        const features = places.filter(place => !place.isAmbient).map(place => {
            const radiusKm = place.radius || 0.3;
            const coords = getCircleCoords(place.location, radiusKm, 48);
            return {
                type: 'Feature' as const,
                id: place.id,
                properties: { id: place.id, name: place.name },
                geometry: {
                    type: 'Polygon' as const,
                    coordinates: [coords]
                }
            };
        });

        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            map.current.addLayer({
                id: `${sourceId}-fill`,
                type: 'fill',
                source: sourceId,
                paint: {
                    'fill-color': theme === 'dark' ? '#64748b' : '#4f46e5',
                    'fill-opacity': theme === 'dark' ? 0.06 : 0.10
                }
            });

            map.current.addLayer({
                id: `${sourceId}-outline`,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': theme === 'dark' ? '#94a3b8' : '#6366f1',
                    'line-width': 1.5,
                    'line-opacity': theme === 'dark' ? 0.25 : 0.38,
                    'line-dasharray': [3, 3]
                }
            });
        }
    }, [places, isMapReady, styleVersion, theme]);

    // ==========================================
    // UNIFIED WEBGL INCIDENTS LAYER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'incidents-webgl-source';
        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: incidents.map(inc => ({
                type: 'Feature',
                id: inc.id,
                properties: {
                    id: inc.id,
                    type: inc.type || 'alert',
                    title: (inc.type || 'hazard').toUpperCase(),
                },
                geometry: {
                    type: 'Point',
                    coordinates: [inc.location.lng, inc.location.lat]
                }
            }))
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            map.current.addLayer({
                id: 'incidents-circle',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': '#ef4444',
                    'circle-radius': 12,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });

            map.current.addLayer({
                id: 'incidents-symbol',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': '⚠️',
                    'text-size': 14,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                }
            });

            map.current.on('click', 'incidents-circle', (e) => {
                const feature = e.features?.[0];
                if (feature) {
                    const coords = (feature.geometry as any).coordinates.slice();
                    new maplibregl.Popup({ offset: 15 })
                        .setLngLat(coords)
                        .setHTML(`<b>${feature.properties?.title || 'INCIDENT'}</b>`)
                        .addTo(map.current!);
                }
            });

            map.current.on('mouseenter', 'incidents-circle', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
            map.current.on('mouseleave', 'incidents-circle', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
        }
    }, [incidents, isMapReady, styleVersion]);

    // ==========================================
    // UNIFIED WEBGL TRIP SAFETY EVENTS LAYER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'trip-safety-events-source';
        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: (tripSafetyEvents || []).filter(e => e.location && typeof e.location.lat === 'number' && typeof e.location.lng === 'number').map((evt, idx) => ({
                type: 'Feature',
                id: idx,
                properties: {
                    type: evt.type,
                    color: evt.type === 'hard_brake' ? '#ef4444' : evt.type === 'rapid_accel' ? '#f59e0b' : '#eab308',
                    icon: evt.type === 'hard_brake' ? '🛑' : evt.type === 'rapid_accel' ? '🏎️' : '⚡',
                    label: evt.type === 'hard_brake' ? 'Hard Brake' : evt.type === 'rapid_accel' ? 'Rapid Acceleration' : 'Speeding Event'
                },
                geometry: {
                    type: 'Point',
                    coordinates: [evt.location.lng, evt.location.lat]
                }
            }))
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            map.current.addLayer({
                id: 'safety-events-circle',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 11,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });

            map.current.addLayer({
                id: 'safety-events-label',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'icon'],
                    'text-size': 11,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                }
            });
        }
    }, [tripSafetyEvents, isMapReady, styleVersion]);

    // ==========================================
    // CROWDSOURCED PUBLIC MAP REPORTS LAYER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'public-reports-source';
        // Only render standalone road hazards on the map canvas.
        // "Entrance Fix" and "Pin Move" reports are tied to destination places and their verification
        // data is displayed exclusively in PlaceDetailPanel, eliminating hovering popups and duplicate map pins.
        const validReports = (publicReports || []).filter(r =>
            r && r.coordinates &&
            typeof r.coordinates.lat === 'number' &&
            typeof r.coordinates.lng === 'number' &&
            r.reportType === 'hazard'
        );

        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: validReports.map(r => ({
                type: 'Feature',
                id: r.id,
                properties: {
                    id: r.id,
                    reportType: r.reportType,
                    placeName: r.placeName || (r.reportType === 'entrance_fix' ? 'Entrance Fix' : r.reportType === 'hazard' ? 'Road Hazard' : 'Location Pin Edit'),
                    details: r.details || '',
                    entranceType: r.entranceType || '',
                    entranceNotes: r.entranceNotes || '',
                    imageUrl: r.imageUrl || '',
                    trustScore: r.trustScore,
                    reporterName: r.reporterName || 'Community Driver',
                    color: r.reportType === 'hazard' ? '#ef4444' : r.reportType === 'entrance_fix' ? '#10b981' : '#8b5cf6',
                    icon: r.reportType === 'hazard' ? '⚠️' : r.reportType === 'entrance_fix' ? '🚪' : '📌',
                    label: `${r.placeName || 'Community Edit'} (⭐${r.trustScore})`
                },
                geometry: {
                    type: 'Point',
                    coordinates: [r.coordinates.lng, r.coordinates.lat]
                }
            }))
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            // Halo layer
            map.current.addLayer({
                id: 'public-reports-halo',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 18,
                    'circle-opacity': 0.25,
                    'circle-blur': 0.4
                }
            });

            // Badge circle
            map.current.addLayer({
                id: 'public-reports-badge',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 13,
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.95
                }
            });

            // Emoji icon
            map.current.addLayer({
                id: 'public-reports-symbol',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'icon'],
                    'text-size': 13,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                }
            });

            // Compact text label
            map.current.addLayer({
                id: 'public-reports-label',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'label'],
                    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10,
                    'text-offset': [0, 1.6],
                    'text-anchor': 'top',
                    'text-optional': true
                },
                paint: {
                    'text-color': theme === 'dark' ? '#e2e8f0' : '#1e293b',
                    'text-halo-color': theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    'text-halo-width': 2
                }
            });

            // Interactive popup with voting
            map.current.on('click', 'public-reports-badge', (e) => {
                const feature = e.features?.[0];
                if (!feature || !map.current) return;

                hapticTick();
                const props = feature.properties as any;
                const coords = (feature.geometry as any).coordinates.slice();
                const reportId = props.id;

                const popupDiv = document.createElement('div');
                popupDiv.className = 'p-1 font-sans text-slate-900 min-w-[210px] max-w-[260px]';

                const typeLabel = props.reportType === 'hazard' ? 'Road Hazard Alert' : props.reportType === 'entrance_fix' ? 'Verified Entrance Fix' : 'Community Pin Relocation';

                popupDiv.innerHTML = `
                    <div style="font-family: system-ui, -apple-system, sans-serif;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; padding: 2px 6px; border-radius: 6px; background: #ede9fe; color: #6d28d9;">
                                ${props.icon || '🌐'} ${typeLabel}
                            </span>
                            <span id="popup-trust-${reportId}" style="font-size: 11px; font-weight: 800; color: #f59e0b;">
                                ⭐ Trust: ${props.trustScore}
                            </span>
                        </div>
                        <h4 style="font-size: 13px; font-weight: 800; margin: 0 0 4px 0; color: #0f172a;">${props.placeName}</h4>
                        ${props.details ? `<p style="font-size: 11px; color: #475569; margin: 0 0 6px 0; line-height: 1.3;">${props.details}</p>` : ''}
                        ${props.entranceNotes ? `<p style="font-size: 11px; font-weight: 600; color: #059669; margin: 0 0 6px 0;">🚪 Note: ${props.entranceNotes}</p>` : ''}
                        ${props.imageUrl ? `<img src="${props.imageUrl}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 8px; margin-bottom: 8px;" />` : ''}
                        
                        <div style="font-size: 10px; color: #64748b; margin-bottom: 8px;">
                            Reported by <b>${props.reporterName || 'Driver'}</b>
                        </div>

                        <div style="display: flex; gap: 6px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
                            <button id="vote-up-${reportId}" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 8px; border: 1px solid #d1fae5; background: #ecfdf5; color: #065f46; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                👍 Helpful
                            </button>
                            <button id="vote-down-${reportId}" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 8px; border: 1px solid #fee2e2; background: #fef2f2; color: #991b1b; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                👎 Not there
                            </button>
                        </div>
                        <div id="vote-status-${reportId}" style="font-size: 10px; text-align: center; color: #64748b; margin-top: 4px;"></div>
                    </div>
                `;

                const popup = new maplibregl.Popup({ offset: 16, maxWidth: '280px' })
                    .setLngLat(coords)
                    .setDOMContent(popupDiv)
                    .addTo(map.current!);

                // Attach button actions
                setTimeout(() => {
                    const upBtn = document.getElementById(`vote-up-${reportId}`);
                    const downBtn = document.getElementById(`vote-down-${reportId}`);
                    const statusEl = document.getElementById(`vote-status-${reportId}`);
                    const trustEl = document.getElementById(`popup-trust-${reportId}`);

                    const handleVote = async (type: 'up' | 'down') => {
                        if (type === 'up') {
                            hapticSuccess();
                        } else {
                            hapticTick();
                        }
                        if (statusEl) statusEl.textContent = 'Recording vote...';
                        const res = await publicMapReportService.voteReport(reportId, currentUserId || 'driver', type);
                        if (res.isDeleted) {
                            hapticMilestone();
                            popup.remove();
                        } else {
                            if (trustEl) trustEl.textContent = `⭐ Trust: ${res.trustScore}`;
                            if (statusEl) statusEl.textContent = type === 'up' ? 'Thanks for confirming!' : 'Vote recorded!';
                            if (upBtn) (upBtn as HTMLButtonElement).disabled = true;
                            if (downBtn) (downBtn as HTMLButtonElement).disabled = true;
                        }
                    };

                    upBtn?.addEventListener('click', () => handleVote('up'));
                    downBtn?.addEventListener('click', () => handleVote('down'));
                }, 50);
            });

            map.current.on('mouseenter', 'public-reports-badge', () => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';
            });
            map.current.on('mouseleave', 'public-reports-badge', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';
            });
        }
    }, [publicReports, isMapReady, styleVersion, theme, currentUserId]);

    // ==========================================
    // CIRCLE HOMES 3D HOUSE NUMBER LABELS LAYER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'circle-homes-source';
        const layerId = 'circle-homes-layer';

        interface HomeFeature {
            id: string;
            coordinates: [number, number];
            houseNumber: string;
            label: string;
        }

        const homeFeatures: HomeFeature[] = [];

        // 1. Current user's verified preciseHomeLocation from profile
        if (userProfile?.preciseHomeLocation?.lat && userProfile?.preciseHomeLocation?.lng) {
            const extractedNumber = extractHouseNumber(userProfile.preciseHomeLocation.address);
            if (extractedNumber) {
                homeFeatures.push({
                    id: 'user_precise_home',
                    coordinates: [userProfile.preciseHomeLocation.lng, userProfile.preciseHomeLocation.lat],
                    houseNumber: extractedNumber,
                    label: userProfile.preciseHomeLocation.address || 'My Home'
                });
            }
        }

        // 2. Circle members' home locations & saved Home places
        (places || []).forEach(p => {
            const isHome = p.category === 'home' ||
                p.icon === 'home' ||
                p.name?.toLowerCase().includes('home') ||
                p.tags?.includes('home') ||
                p.tags?.includes('Verified Precision Pin');

            if (isHome && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number') {
                const extractedNumber = extractHouseNumber(p.address || p.description || p.name);
                if (extractedNumber) {
                    // Deduplicate by proximity (~10m) to avoid duplicate stacked labels
                    const isDuplicate = homeFeatures.some(hf =>
                        Math.abs(hf.coordinates[1] - p.location.lat) < 0.0001 &&
                        Math.abs(hf.coordinates[0] - p.location.lng) < 0.0001
                    );
                    if (!isDuplicate) {
                        homeFeatures.push({
                            id: `place_home_${p.id}`,
                            coordinates: [p.location.lng, p.location.lat],
                            houseNumber: extractedNumber,
                            label: p.name || 'Home'
                        });
                    }
                }
            }
        });

        // 3. Any active Circle members with home location attached
        (members || []).forEach(m => {
            if ((m as any).homeLocation?.lat && (m as any).homeLocation?.lng) {
                const loc = (m as any).homeLocation;
                const extractedNumber = extractHouseNumber((m as any).homeAddress || (m as any).address);
                if (extractedNumber) {
                    const isDuplicate = homeFeatures.some(hf =>
                        Math.abs(hf.coordinates[1] - loc.lat) < 0.0001 &&
                        Math.abs(hf.coordinates[0] - loc.lng) < 0.0001
                    );
                    if (!isDuplicate) {
                        homeFeatures.push({
                            id: `member_home_${m.id}`,
                            coordinates: [loc.lng, loc.lat],
                            houseNumber: extractedNumber,
                            label: `${m.name}'s Home`
                        });
                    }
                }
            }
        });

        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: homeFeatures.map(h => ({
                type: 'Feature',
                id: h.id,
                properties: {
                    id: h.id,
                    houseNumber: h.houseNumber,
                    label: h.label
                },
                geometry: {
                    type: 'Point',
                    coordinates: h.coordinates
                }
            }))
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });
        }

        if (!map.current.getLayer(layerId)) {
            try {
                // Ensure this layer sits visually above the 3d-buildings layer
                map.current.addLayer({
                    id: layerId,
                    type: 'symbol',
                    source: sourceId,
                    minzoom: 14, // Visible at neighborhood, street, and 3D building zoom levels
                    layout: {
                        'text-field': '{houseNumber}',
                        'text-size': 14,
                        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                        'text-pitch-alignment': 'map', // Lays flat on the ground/roof in 3D pitch mode
                        'text-rotation-alignment': 'map',
                        'text-allow-overlap': true,
                        'text-ignore-placement': true
                    },
                    paint: {
                        'text-color': '#ffffff',
                        'text-halo-color': '#000000',
                        'text-halo-width': 1.5
                    }
                });
            } catch (layerErr) {
                console.warn('[MapLibre3DView] Failed to add circle-homes-layer:', layerErr);
            }
        }
    }, [userProfile?.preciseHomeLocation, places, members, isMapReady, styleVersion, theme]);

    // Update Privacy Zones
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        privacyZones.forEach(zone => {
            const sourceId = `privacy-zone-${zone.id}`;
            if (!map.current?.getSource(sourceId)) {
                const radiusKm = zone.radius || 0.1; // km
                const coords = getCircleCoords(zone.location, radiusKm, 64);

                map.current?.addSource(sourceId, {
                    'type': 'geojson',
                    'data': {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [coords]
                        },
                        'properties': {}
                    }
                });

                map.current?.addLayer({
                    'id': sourceId,
                    'type': 'fill',
                    'source': sourceId,
                    'paint': {
                        'fill-color': '#6366f1',
                        'fill-opacity': 0.2
                    }
                });
            }
        });
    }, [privacyZones, styleVersion]);

    // ==========================================
    // MEMBER AVATARS & LIVE LOCATION PUCK MARKERS
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const SNAPPING_THRESHOLD_METERS = 40;
        const validMembers = (members || []).filter(m => 
            m && 
            m.location && 
            typeof m.location.lat === 'number' && 
            typeof m.location.lng === 'number' && 
            !(m.location.lat === 0 && m.location.lng === 0) &&
            (currentUserId ? (m.id !== 'demo-you' && m.id !== 'local-user' && m.id !== 'current_user') : true)
        );

        // Ensure user location puck is rendered if no self record exists yet
        const allMembersToRender = [...validMembers];
        const hasSelf = allMembersToRender.some(m => m.id === currentUserId || m.id === 'current_user' || m.id === 'local-user' || m.id === 'demo-you');
        if (!hasSelf && userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number' && !(userLocation.lat === 0 && userLocation.lng === 0)) {
            allMembersToRender.unshift({
                id: currentUserId || 'local-user',
                name: 'You',
                avatar: getDefaultAvatarDataUri('You'),
                location: userLocation,
                status: isNavigating ? 'Driving' : 'Stationary',
                battery: 100,
                membershipTier: 'free',
                lastUpdated: new Date().toISOString(),
                accuracy: 15,
                isGhostMode: false,
                speed: 0,
                heading: 0,
                role: 'Primary',
                safetyScore: 100,
                pathHistory: [],
                driveEvents: []
            });
        }

        const dedupedMembers = Array.from(
            new Map<string, FamilyMember>(allMembersToRender.map(m => [m.id, m])).values()
        );

        const currentMemberIds = new Set(dedupedMembers.map(m => m.id));

        // Remove stale member markers
        for (const [id, marker] of membersMarkersRef.current.entries()) {
            if (!currentMemberIds.has(id)) {
                marker.remove();
                membersMarkersRef.current.delete(id);
            }
        }

        dedupedMembers.forEach(member => {
            let finalLocation = member.location;
            let displayBearing = (member as any).bearing || 0;

            // Snap-to-Road during navigation
            if (isNavigating && routeCoords.length >= 2) {
                let minSegDist = Infinity;
                let snappedPoint: Location | null = null;
                let segBearing = 0;

                const startIdx = 0;
                const endIdx = Math.min(routeCoords.length - 1, currentStepIndex + 6);
                for (let i = startIdx; i < endIdx; i++) {
                    const a = routeCoords[i];
                    const b = routeCoords[i + 1];
                    const snap = getPointOnSegmentNearestTo(member.location, a, b);
                    const dist = getDistanceMeters(member.location, snap);
                    
                    if (dist < minSegDist) {
                        minSegDist = dist;
                        snappedPoint = snap;
                        segBearing = getBearing(a, b);
                    }
                }

                if (snappedPoint && minSegDist < SNAPPING_THRESHOLD_METERS) {
                    finalLocation = snappedPoint;
                    displayBearing = segBearing;
                } else if (routeCoords.length >= 2) {
                    displayBearing = getBearing(routeCoords[0], routeCoords[1]);
                }
            }

            // Calculate rotation relative to map camera angle so vehicle arrow points directly along the road on-screen
            const mapCamBearing = map.current ? map.current.getBearing() : 0;
            const visualRotation = Math.round(((displayBearing - mapCamBearing) % 360 + 360) % 360);

            const updatedMs = new Date(member.lastUpdated).getTime();
            const ageMinutes = Math.floor((Date.now() - updatedMs) / 60000);
            const isStale = ageMinutes >= 5;
            const isBlurred = member.privacyMode === 'blurred' || member.isGhostMode;
            const isFrozen = member.privacyMode === 'frozen';
            const isCarbonAmber = effectiveSkin === 'carbon-amber' || effectiveSkin === 'los-santos';
            const isDriving = member.status === 'Driving' || (member.speed && member.speed > 5);
            const isSelf = member.id === currentUserId || member.id === 'demo-you' || member.id === 'current_user' || member.id === 'local-user';

            const circleColor = member.circleColor || '#6366f1';
            const borderColor = isCarbonAmber
                ? '#f59e0b'
                : isBlurred 
                    ? '#a855f7' 
                    : isFrozen 
                        ? '#38bdf8' 
                        : isStale 
                            ? '#9ca3af' 
                            : isDriving 
                                ? '#6366f1' 
                                : circleColor;

            const initials = (member.name || 'M').charAt(0).toUpperCase();

            const isSelfNavigating = isNavigating && isSelf;
            const isLightSkin = effectiveSkin === 'warm_cream';
            const markerHtml = isSelfNavigating ? `
                <div class="myway-nav-puck-container select-none" style="position: relative; width: 68px; height: 68px; display: flex; align-items: center; justify-content: center;">
                    <!-- Dynamic Forward Vision Headlight Beam (Electric Cyan) -->
                    <div class="myway-puck-beam" style="position: absolute; top: -38px; left: 50%; transform: translateX(-50%) rotate(${visualRotation}deg); transform-origin: bottom center; width: 56px; height: 60px; background: radial-gradient(ellipse at bottom, ${isCarbonAmber ? 'rgba(0, 242, 254, 0.65)' : 'rgba(56, 189, 248, 0.45)'} 0%, ${isCarbonAmber ? 'rgba(6, 182, 212, 0.25)' : 'rgba(56, 189, 248, 0.12)'} 50%, transparent 80%); clip-path: polygon(50% 100%, 0% 0%, 100% 0%); pointer-events: none;"></div>
                    
                    <!-- Radar Pulse Beacon (Electric Cyan) -->
                    <div style="position: absolute; inset: 6px; border-radius: 50%; background: ${isCarbonAmber ? '#00f2fe' : isLightSkin ? '#0284c7' : circleColor}; opacity: 0.4; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; box-shadow: ${isCarbonAmber ? '0 0 16px #00f2fe' : 'none'};"></div>
                    
                    <!-- 3D Navigation Vehicle Arrow Puck with Solid Black Casing -->
                    <div class="myway-puck-arrow" style="position: relative; width: 46px; height: 46px; transform: rotate(${visualRotation}deg); display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.8));">
                        <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                            <!-- 2px Solid Pure Black Outer Casing Border -->
                            <path d="M22 2 L40 40 L22 31 L4 40 Z" fill="#000000" />
                            <!-- Electric Cyan Primary Arrow -->
                            <path d="M22 4 L38 38 L22 30 L6 38 Z" fill="${isCarbonAmber ? '#00f2fe' : isLightSkin ? '#0284c7' : '#4f46e5'}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" />
                            <!-- Inner Cyan Core Accent -->
                            <path d="M22 8 L33 34 L22 27 L11 34 Z" fill="${isCarbonAmber ? '#06b6d4' : isLightSkin ? '#38bdf8' : circleColor}" />
                            <circle cx="22" cy="22" r="4" fill="#ffffff" />
                        </svg>
                    </div>
                </div>
            ` : `
                <div class="myway-member-avatar-container select-none" style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
                        ${isStale ? '' : `<div style="position: absolute; inset: -4px; border-radius: 50%; background: ${circleColor}; opacity: 0.35; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`}
                        <div style="position: relative; width: 42px; height: 42px; border-radius: 50%; border: 3px solid ${circleColor}; background: #0f172a; box-shadow: 0 6px 18px rgba(0,0,0,0.5); overflow: hidden; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #ffffff; font-size: 16px;">
                            ${member.avatar && !member.avatar.includes('default') ? `<img src="${member.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
                            <span style="${member.avatar && !member.avatar.includes('default') ? 'display: none;' : 'display: flex;'}">${initials}</span>
                        </div>
                        ${isDriving ? `<div style="position: absolute; top: -12px; transform: rotate(${visualRotation}deg); font-size: 15px; color: ${circleColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">▲</div>` : ''}
                        ${member.circleName ? `<div style="position: absolute; bottom: -1px; right: -1px; width: 13px; height: 13px; border-radius: 50%; background: ${circleColor}; border: 2px solid #0f172a; box-shadow: 0 2px 6px rgba(0,0,0,0.5);"></div>` : ''}
                    </div>
                    <div style="margin-top: 2px; padding: 1px 6px; border-radius: 999px; background: rgba(15, 23, 42, 0.88); backdrop-filter: blur(4px); border: 1px solid ${circleColor}88; color: #ffffff; font-size: 9px; font-weight: 800; white-space: nowrap; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
                        <span style="width: 5px; height: 5px; border-radius: 50%; background: ${circleColor}; shrink: 0;"></span>
                        <span>${member.name || 'Member'}</span>
                    </div>
                </div>
            `;

            let marker = membersMarkersRef.current.get(member.id);
            if (!marker) {
                const el = document.createElement('div');
                el.className = 'myway-member-avatar-marker select-none';
                el.style.cursor = 'pointer';
                el.style.display = 'flex';
                el.style.flexDirection = 'column';
                el.style.alignItems = 'center';
                el.style.transform = 'translate3d(0,0,0)';
                el.innerHTML = markerHtml;
                (el as any)._lastHtml = markerHtml;

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onSelectMember?.(member.id);
                });

                marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([finalLocation.lng, finalLocation.lat])
                    .addTo(map.current!);
                membersMarkersRef.current.set(member.id, marker);
            } else {
                // Prevent destroying and recreating the marker inner DOM on every 1Hz GPS coordinate ping
                if ((marker.getElement() as any)._lastHtml !== markerHtml) {
                    marker.getElement().innerHTML = markerHtml;
                    (marker.getElement() as any)._lastHtml = markerHtml;
                }
            }

            if (isSelfNavigating) {
                selfMarkerRef.current = marker;
                latestLocationRef.current = { lng: finalLocation.lng, lat: finalLocation.lat };
                latestBearingRef.current = displayBearing;

                // Initialize or smoothly update puck linear interpolation targets
                if (!puckInterpolationRef.current) {
                    puckInterpolationRef.current = {
                        prevCoords: [finalLocation.lng, finalLocation.lat],
                        targetCoords: [finalLocation.lng, finalLocation.lat],
                        prevBearing: displayBearing,
                        targetBearing: displayBearing,
                        startTime: performance.now(),
                        duration: 1000,
                        currentCoords: [finalLocation.lng, finalLocation.lat],
                        currentBearing: displayBearing
                    };
                    marker.setLngLat([finalLocation.lng, finalLocation.lat]);
                } else {
                    const anim = puckInterpolationRef.current;
                    const dist = getDistanceMeters(
                        { lat: anim.currentCoords[1], lng: anim.currentCoords[0] },
                        finalLocation
                    );
                    // If vehicle jumps > 300m (e.g. route restart, snapping jump), reset instantly
                    if (dist > 300) {
                        anim.prevCoords = [finalLocation.lng, finalLocation.lat];
                        anim.targetCoords = [finalLocation.lng, finalLocation.lat];
                        anim.currentCoords = [finalLocation.lng, finalLocation.lat];
                        anim.prevBearing = displayBearing;
                        anim.targetBearing = displayBearing;
                        anim.currentBearing = displayBearing;
                        anim.startTime = performance.now();
                        marker.setLngLat([finalLocation.lng, finalLocation.lat]);
                    } else {
                        anim.prevCoords = [anim.currentCoords[0], anim.currentCoords[1]];
                        anim.targetCoords = [finalLocation.lng, finalLocation.lat];
                        anim.prevBearing = anim.currentBearing;
                        anim.targetBearing = displayBearing;
                        anim.startTime = performance.now();
                        anim.duration = 1000;
                    }
                }
            } else {
                marker.setLngLat([finalLocation.lng, finalLocation.lat]);
            }
        });
    }, [members, userLocation?.lat, userLocation?.lng, currentUserId, isMapReady, isNavigating, routeCoords, currentStepIndex, mapSkin, theme, styleVersion, onSelectMember]);

    // ==========================================
    // SMOOTH 60FPS PUCK & BEARING INTERPOLATION (rAF LOOP)
    // ==========================================
    // Decoupled from React render cycles: interpolates vehicle puck coordinates
    // and orientation smoothly across the 1000ms (1Hz) GPS interval at native screen refresh rate.
    useEffect(() => {
        if (!isNavigating || !isMapReady) return;

        let rafId: number;

        const animatePuck = (now: number) => {
            const anim = puckInterpolationRef.current;
            const marker = selfMarkerRef.current;

            if (anim && marker && map.current) {
                const elapsed = now - anim.startTime;
                const progress = Math.min(1, Math.max(0, elapsed / (anim.duration || 1000)));

                // Smooth linear interpolation for coordinates (1000ms window matching 1Hz GPS)
                const lng = anim.prevCoords[0] + (anim.targetCoords[0] - anim.prevCoords[0]) * progress;
                const lat = anim.prevCoords[1] + (anim.targetCoords[1] - anim.prevCoords[1]) * progress;
                anim.currentCoords = [lng, lat];

                // Smooth shortest-path angular interpolation for heading/bearing
                let deltaBearing = anim.targetBearing - anim.prevBearing;
                if (deltaBearing > 180) deltaBearing -= 360;
                if (deltaBearing < -180) deltaBearing -= 360;
                const bearing = ((anim.prevBearing + deltaBearing * progress) % 360 + 360) % 360;
                anim.currentBearing = bearing;

                // Move vehicle marker smoothly at display refresh rate (60-120fps)
                marker.setLngLat([lng, lat]);

                // Sync vehicle arrow & headlight beam rotation with camera heading
                const mapCamBearing = map.current.getBearing();
                const visualRotation = Math.round(((bearing - mapCamBearing) % 360 + 360) % 360);

                const el = marker.getElement();
                const beamEl = el.querySelector('.myway-puck-beam') as HTMLElement | null;
                const arrowEl = el.querySelector('.myway-puck-arrow') as HTMLElement | null;
                if (beamEl) {
                    beamEl.style.transform = `translateX(-50%) rotate(${visualRotation}deg)`;
                }
                if (arrowEl) {
                    arrowEl.style.transform = `rotate(${visualRotation}deg)`;
                }
            }

            rafId = requestAnimationFrame(animatePuck);
        };

        rafId = requestAnimationFrame(animatePuck);
        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [isNavigating, isMapReady]);

    // ==========================================
    // DYNAMIC NAVIGATION CAMERA TRACKING SYSTEM (3RD PERSON CHASE CAM)
    // ==========================================
    // When navigation is active: lock 3rd person chase camera behind the driver (60° tilt,
    // following travel heading with forward road padding). Paused when user explores the route ahead.
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        // Resolve driver location
        const driver = members.find(m => (currentUserId && m.id === currentUserId) || m.id === 'demo-you' || m.id === members[0]?.id);
        const driverLoc: Location | undefined = (userLocation && userLocation.lat !== 0 && userLocation.lng !== 0)
            ? userLocation
            : driver?.location;

        if (!driverLoc || (driverLoc.lat === 0 && driverLoc.lng === 0)) return;

        // --- NAVIGATION EXIT: Smooth reset to flat/tilted 2D/3D map ---
        if (wasNavigatingRef.current && !isNavigating) {
            wasNavigatingRef.current = false;
            prevBearingRef.current = 0;
            puckInterpolationRef.current = null;
            selfMarkerRef.current = null;
            map.current.easeTo({
                pitch: is3DMode ? 60 : 0,
                bearing: is3DMode ? -17.6 : 0,
                zoom: 16,
                center: [driverLoc.lng, driverLoc.lat],
                padding: { top: 0, bottom: 0, left: 0, right: 0 },
                duration: 1000
            });
            return;
        }

        // --- ACTIVE NAVIGATION CAMERA ---
        if (isNavigating) {
            const isInitialNavStart = !wasNavigatingRef.current;
            wasNavigatingRef.current = true;

            // If user has dragged/panned or zoomed the map ahead, DO NOT fight user touch input
            if (isCameraFree) {
                return;
            }

            // Compute travel bearing from driver device heading or route polyline
            let travelBearing = 0;
            if (driver?.heading !== undefined && driver.heading >= 0 && (driver.speed || 0) > 1.5) {
                travelBearing = driver.heading;
            } else if (routeCoords.length >= 2) {
                // Find nearest route segment ahead of driver
                let minDist = Infinity;
                let nearestIdx = 0;
                for (let i = 0; i < routeCoords.length - 1; i++) {
                    const snap = getPointOnSegmentNearestTo(driverLoc, routeCoords[i], routeCoords[i + 1]);
                    const d = getDistanceMeters(driverLoc, snap);
                    if (d < minDist) {
                        minDist = d;
                        nearestIdx = i;
                    }
                }
                travelBearing = getBearing(routeCoords[nearestIdx], routeCoords[Math.min(nearestIdx + 1, routeCoords.length - 1)]);
            } else if (driver?.heading !== undefined && driver.heading >= 0) {
                travelBearing = driver.heading;
            }

            // On initial trip start: immediately align camera with the road bearing
            if (isInitialNavStart || prevBearingRef.current === 0) {
                prevBearingRef.current = travelBearing;
            } else {
                // Smooth bearing interpolation (shortest path across 360 boundary)
                let delta = travelBearing - prevBearingRef.current;
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                const smoothedBearing = prevBearingRef.current + delta * 0.6;
                prevBearingRef.current = ((smoothedBearing % 360) + 360) % 360;
            }

            // --- FLEET-AWARE DYNAMIC CONVOY FRAMING ---
            const activeConvoy = convoyService.getActiveConvoy();
            let isMultiVehicleConvoy = false;

            const containerHeight = mapContainer.current?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
            const navTopPadding = Math.round(containerHeight * 0.52); // Anchors vehicle at ~76% screen height

            if (activeConvoy && activeConvoy.isActive && activeConvoy.memberIds && activeConvoy.memberIds.length > 1) {
                const fleetMembers = members.filter(m =>
                    activeConvoy.memberIds.includes(m.id) &&
                    m.location &&
                    !(m.location.lat === 0 && m.location.lng === 0)
                );

                if (fleetMembers.length > 1) {
                    const convoyBounds = new maplibregl.LngLatBounds();
                    convoyBounds.extend([driverLoc.lng, driverLoc.lat]);
                    let membersEnclosed = 1;

                    fleetMembers.forEach(m => {
                        // Include convoy members within local visual corridor (~25 miles)
                        const distMiles = getDistanceMiles(driverLoc, m.location);
                        if (distMiles <= 25) {
                            convoyBounds.extend([m.location.lng, m.location.lat]);
                            membersEnclosed++;
                        }
                    });

                    if (membersEnclosed > 1) {
                        isMultiVehicleConvoy = true;
                        map.current.fitBounds(convoyBounds, {
                            pitch: 58,
                            bearing: prevBearingRef.current,
                            maxZoom: isMobile ? 17.5 : 18.0,
                            padding: {
                                top: Math.round(containerHeight * 0.35),
                                bottom: 40,
                                left: isMobile ? 50 : 160,
                                right: isMobile ? 50 : 80
                            },
                            duration: isInitialNavStart ? 1200 : 1000,
                            easing: (t: number) => t
                        });
                    }
                }
            }

            // Fallback: Standard Single-Vehicle 3rd Person Perspective Chase View
            // Uses duration: 1000 and linear easing: (t) => t matching 1Hz GPS updates for buttery smooth tracking
            if (!isMultiVehicleConvoy) {
                map.current.easeTo({
                    center: [driverLoc.lng, driverLoc.lat],
                    bearing: prevBearingRef.current,
                    pitch: 60,
                    zoom: isMobile ? 18.2 : 18.4,
                    padding: {
                        top: navTopPadding,
                        bottom: 0,
                        left: isMobile ? 0 : 120,
                        right: 0
                    },
                    duration: isInitialNavStart ? 1200 : 1000,
                    easing: (t: number) => t
                });
            }
            return;
        }
    }, [members, userLocation?.lat, userLocation?.lng, currentUserId, isNavigating, isMapReady, routeCoords, is3DMode, isCameraFree, currentStepIndex, isMobile]);

    // Camera control — initial center and member selection
    useEffect(() => {
        if (map.current && members.length > 0 && !selectedMemberId && !center && !isNavigating) {
            const you = members.find(m => m.id === 'demo-you' || m.id === members[0].id);
            if (you) map.current.flyTo({ center: [you.location.lng, you.location.lat], zoom: 17, pitch: is3DMode ? 60 : 0, duration: 1500 });
        }
    }, [members.length > 0]);

    useEffect(() => {
        if (!map.current || !selectedMemberId) return;
        const member = members.find(m => m.id === selectedMemberId);
        if (member) map.current.flyTo({ center: [member.location.lng, member.location.lat], zoom: 17, pitch: is3DMode ? 60 : 0, duration: 1500 });
    }, [selectedMemberId, members]);

    useEffect(() => {
        if (!map.current || !center || isNavigating) return; // Don't override nav camera
        const currentCenter = map.current.getCenter();
        const dist = Math.sqrt(Math.pow(currentCenter.lng - center[0], 2) + Math.pow(currentCenter.lat - center[1], 2));
        if (dist > 0.0001) {
            map.current.flyTo({
                center: center,
                zoom: 17,
                pitch: is3DMode ? 60 : 0,
                duration: 2000,
                padding: isMobile ? { top: 0, bottom: 250, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 }
            });
        }
    }, [center, isNavigating, isMobile, is3DMode]);

    // Consolidated Map Style & 3D Mode Handlers
    const [showStylePicker, setShowStylePicker] = React.useState(false);
    const styleLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didStyleLongPressRef = useRef(false);

    const handleStylePointerDown = useCallback(() => {
        didStyleLongPressRef.current = false;
        if (styleLongPressTimerRef.current) clearTimeout(styleLongPressTimerRef.current);
        styleLongPressTimerRef.current = setTimeout(() => {
            didStyleLongPressRef.current = true;
            setShowStylePicker(prev => !prev);
        }, 450);
    }, []);

    const handleStylePointerUp = useCallback(() => {
        if (styleLongPressTimerRef.current) {
            clearTimeout(styleLongPressTimerRef.current);
            styleLongPressTimerRef.current = null;
        }
        if (!didStyleLongPressRef.current) {
            if (onToggle3DMode) {
                onToggle3DMode();
            } else if (map.current) {
                const currentPitch = map.current.getPitch();
                if (currentPitch > 10) {
                    map.current.easeTo({ pitch: 0, bearing: 0, duration: 600 });
                } else {
                    map.current.easeTo({ pitch: 60, bearing: -17.6, duration: 600 });
                }
            }
        }
    }, [onToggle3DMode]);

    const handleStylePointerLeave = useCallback(() => {
        if (styleLongPressTimerRef.current) {
            clearTimeout(styleLongPressTimerRef.current);
            styleLongPressTimerRef.current = null;
        }
    }, []);

    return (
        <div className="relative w-full h-full overflow-hidden select-none">
            <div 
                ref={mapContainer} 
                className={`w-full h-full transition-all duration-500 ${
                    isNavigating ? 'cursor-none' : ''
                }`}
                style={{ 
                    minHeight: '100vh', 
                    background: theme === 'dark' ? '#0f172a' : '#f1f5f9',
                    // AUDIT FIX: Ghost Mode Ambiguity Indicator
                    // Outer glow when in privacy mode
                    boxShadow: !members.find(m => m.id === 'demo-you')?.locationSharing 
                        ? 'inset 0 0 100px rgba(217, 70, 239, 0.4)' 
                        : 'none'
                }} 
            />

            {/* Consolidated Map View & Zoom Controls Cluster (with +, -, and 3D/Map View) */}
            <div 
                className={`absolute z-40 pointer-events-auto flex flex-col items-center gap-1.5 transition-all duration-300 ${
                    isMobile
                        ? (isNavigating ? 'right-3.5 bottom-24' : 'right-4 bottom-48 sm:bottom-52')
                        : (isNavigating ? 'right-6 bottom-28' : 'right-6 bottom-36')
                }`}
            >
                {/* Map Style Radial / Layer Picker (slides out to the left when held/toggled) */}
                {showStylePicker && (
                    <div className="absolute right-14 bottom-0 flex items-center gap-1.5 bg-black/85 backdrop-blur-2xl rounded-2xl p-1.5 border border-white/20 shadow-2xl animate-in slide-in-from-right duration-200">
                        {[
                            { id: 'standard' as const, label: '🗺️', name: 'Standard' },
                            { id: 'satellite' as const, label: '🛰️', name: 'Satellite' },
                            { id: 'terrain' as const, label: '⛰️', name: 'Terrain' },
                        ].map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => {
                                    onSelectMapStyle?.(opt.id);
                                    setShowStylePicker(false);
                                }}
                                className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                                    mapStyle === opt.id
                                        ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg scale-105'
                                        : 'bg-white/10 text-slate-300 hover:bg-white/20'
                                }`}
                                title={opt.name}
                            >
                                <span className="text-base leading-none">{opt.label}</span>
                                <span className="text-[7px] font-black uppercase mt-0.5 tracking-tight">{opt.name.slice(0, 3)}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Control Pill: [+] [-] [3D/Style] */}
                <div className="flex flex-col p-1 bg-black/75 backdrop-blur-2xl rounded-2xl border border-white/15 shadow-2xl overflow-hidden divide-y divide-white/10">
                    {/* Zoom In */}
                    <button
                        type="button"
                        onClick={() => map.current?.zoomIn({ duration: 250 })}
                        title="Zoom In"
                        className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/15 active:scale-95 transition-all text-xl font-bold select-none cursor-pointer"
                    >
                        +
                    </button>

                    {/* Zoom Out */}
                    <button
                        type="button"
                        onClick={() => map.current?.zoomOut({ duration: 250 })}
                        title="Zoom Out"
                        className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/15 active:scale-95 transition-all text-xl font-bold select-none cursor-pointer"
                    >
                        −
                    </button>

                    {/* 3D / 2D & Map Style Toggle Button */}
                    <button
                        type="button"
                        onPointerDown={handleStylePointerDown}
                        onPointerUp={handleStylePointerUp}
                        onPointerLeave={handleStylePointerLeave}
                        title="Tap: Toggle 3D/2D View • Hold: Change Map Layer"
                        className={`w-10 h-10 flex flex-col items-center justify-center transition-all active:scale-95 select-none cursor-pointer ${
                            is3DMode 
                                ? 'bg-amber-500/90 text-white font-black shadow-inner' 
                                : 'text-slate-300 hover:bg-white/15'
                        }`}
                    >
                        <span className="text-[11px] font-black leading-none tracking-tight">
                            {is3DMode ? '3D' : '2D'}
                        </span>
                        <span className="text-[7px] font-black uppercase tracking-tighter opacity-80 mt-0.5">
                            {mapStyle === 'satellite' ? 'SAT' : mapStyle === 'terrain' ? 'TER' : 'MAP'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(MapLibre3DView);
