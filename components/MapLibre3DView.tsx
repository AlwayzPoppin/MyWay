import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FamilyMember, Place, CircleTask, Location } from '../types';
import { MapSkinId, getMapSkin, applySkinOverrides, SATELLITE_STYLE, TERRAIN_STYLE } from '../services/mapSkinService';
import { getDistanceMeters, getBearing, getPointOnSegmentNearestTo } from '../utils/geo';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { getBrandMeta } from '../services/brandLogoService';

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

interface MapLibre3DViewProps {
    members: FamilyMember[];
    userLocation?: Location | null;
    currentUserId?: string;
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
    onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
    mapStyle?: 'standard' | 'satellite' | 'terrain';
    isMobile?: boolean;
    buildingScale?: 'realistic' | 'enhanced' | 'monumental';
    landmarkGlow?: boolean;
    isCameraFree?: boolean;
    onCameraFreeChange?: (isFree: boolean) => void;
}

const MapLibre3DView: React.FC<MapLibre3DViewProps> = ({
    members,
    userLocation,
    currentUserId,
    theme,
    mapSkin = 'default',
    selectedMemberId,
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
    onBoundsChange,
    mapStyle = 'standard',
    isMobile = false,
    buildingScale = 'enhanced',
    landmarkGlow = true,
    isCameraFree = false,
    onCameraFreeChange
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const [isMapReady, setIsMapReady] = React.useState(false);
    const [styleVersion, setStyleVersion] = React.useState(0); // Track style reloads to re-render layers
    const [mapEpoch, setMapEpoch] = React.useState(0); // Incremented to trigger WebGL context loss recovery reboot
    const placesMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const incidentsMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const destinationMarkerRef = useRef<maplibregl.Marker | null>(null);
    const renderedGeofenceIdsRef = useRef<Set<string>>(new Set());
    const routeRafRef = useRef<number | null>(null);
    const safetyEventMarkersRef = useRef<maplibregl.Marker[]>([]);

    // Track last known camera position to restore seamless view upon WebGL recovery
    const lastCameraRef = useRef<{
        center: [number, number];
        zoom: number;
        pitch: number;
        bearing: number;
    }>({
        center: (center || (members[0] ? [members[0].location.lng, members[0].location.lat] : [-78.98, 35.09])) as [number, number],
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

                    // Clear all existing marker DOM elements
                    markersRef.current.forEach(m => m.remove());
                    markersRef.current.clear();
                    placesMarkersRef.current.forEach(m => m.remove());
                    placesMarkersRef.current.clear();
                    incidentsMarkersRef.current.forEach(m => m.remove());
                    incidentsMarkersRef.current.clear();
                    if (destinationMarkerRef.current) {
                        destinationMarkerRef.current.remove();
                        destinationMarkerRef.current = null;
                    }
                    renderedGeofenceIdsRef.current.clear();

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

    // Get the skin style URL
    // Respects Warm Cream (Light) vs Muted Slate (Dark) vs Auto Dynamic
    const styleUrl = useMemo(() => {
        const skin = getMapSkin(mapSkin as MapSkinId);
        let url: any = skin.styleUrl;
 
        if (mapStyle === 'satellite') {
            url = SATELLITE_STYLE;
        } else if (mapStyle === 'terrain') {
            url = TERRAIN_STYLE;
        } else if (mapSkin === 'default') {
            url = theme === 'dark'
                ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
        } else if (mapSkin === 'warm_cream') {
            url = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
        } else if (mapSkin === 'muted_slate') {
            url = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
        }
        return url;
    }, [mapSkin, mapStyle, theme]);

    // Prepare route polyline coordinates for map rendering
    const routeCoords = useMemo<Location[]>(() => {
        if (!activeRoute || !activeRoute.steps || activeRoute.steps.length === 0) return [];
        
        // Use the full road-following geometry from OSRM if available
        if (activeRoute.routeGeometry && activeRoute.routeGeometry.length > 0) {
            return activeRoute.routeGeometry.map((coord: [number, number]) => ({
                lng: coord[0],
                lat: coord[1]
            }));
        }

        // Fallback: connect step endpoints (straight lines)
        const coords: Location[] = [];
        if (activeRoute.startLoc) coords.push(activeRoute.startLoc);
        activeRoute.steps.forEach((step: any) => {
            if (step.endLocation) coords.push(step.endLocation);
        });
        if (activeRoute.destinationLoc) coords.push(activeRoute.destinationLoc);
        
        return coords;
    }, [activeRoute]);

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
        });
        map.current = mapInstance;

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

        // User interaction tracking (Drag, Touch, Wheel) to enable free-look mode during navigation
        const handleUserPan = () => {
            onUserInteraction?.();
            if (isNavigating) {
                onCameraFreeChange?.(true);
            }
        };
        mapInstance.on('dragstart', handleUserPan);
        mapInstance.on('touchstart', handleUserPan);
        mapInstance.on('wheel', handleUserPan);

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
        document.addEventListener('visibilitychange', handleVisibilityChange);

        const apply3DBuildingLayer = () => {
            if (!map.current) return;

            // Apply skin-specific color overrides
            if (mapStyle === 'standard') {
                applySkinOverrides(map.current, mapSkin as MapSkinId, theme);
            }

            const layers = map.current.getStyle().layers || [];
            const buildingLayer = layers.find(
                (layer: any) => layer.id.includes('building') && layer.type === 'fill'
            );

            if (buildingLayer) {
                const source = (buildingLayer as any).source;
                const sourceLayer = (buildingLayer as any)['source-layer'];
                const labelLayerId = layers.find(
                    (layer: any) => layer.type === 'symbol' && layer.layout?.['text-field']
                )?.id;

                map.current.setLayoutProperty(buildingLayer.id, 'visibility', 'none');

                const heightMultiplier = buildingScale === 'monumental' ? 2.6 : buildingScale === 'realistic' ? 1.0 : 1.8;
                const baseHeight = Math.round(14 * heightMultiplier);
                const levelHeight = Number((4.0 * heightMultiplier).toFixed(1));

                const isWarmLight = mapSkin === 'warm_cream' || (mapSkin === 'default' && theme === 'light');

                // 3D Architectural Lighting & Ambient Landmark Glow
                try {
                    map.current.setLight({
                        anchor: 'viewport',
                        color: isWarmLight ? '#fffbf0' : '#f1f5f9',
                        intensity: isWarmLight ? 0.55 : 0.28,
                        position: [1.15, isWarmLight ? 60 : 75, isWarmLight ? 40 : 45]
                    });
                } catch (e) {
                    console.warn('[MapLibre] setLight:', e);
                }

                // Sophisticated palette for 3D buildings (Warm Cream Sandstone vs Muted Graphite)
                const extrusionColor = [
                    'interpolate', ['linear'], ['zoom'],
                    14, isWarmLight ? '#eae3d5' : '#1c2128',
                    16, isWarmLight ? '#dfd6c4' : '#242b35'
                ];

                const opacityExpr: any = [
                    'interpolate', ['linear'], ['zoom'],
                    13.5, 0,
                    14.5, 0.95
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

                if (map.current.getLayer('buildings-3d')) {
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-color', extrusionColor);
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-height', heightExpr);
                    map.current.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', opacityExpr);
                } else {
                    map.current.addLayer({
                        'id': 'buildings-3d',
                        'source': source,
                        'source-layer': sourceLayer,
                        'type': 'fill-extrusion',
                        'minzoom': 13.5,
                        'paint': {
                            'fill-extrusion-color': extrusionColor as any,
                            'fill-extrusion-height': heightExpr,
                            'fill-extrusion-base': [
                                'case',
                                ['has', 'render_min_height'], ['get', 'render_min_height'],
                                ['has', 'min_height'], ['get', 'min_height'],
                                0
                            ],
                            'fill-extrusion-opacity': opacityExpr
                        }
                    }, labelLayerId);
                }
            }

            // AUDIT #6: Improve Map Label Readability
            // Add halo to all symbol layers (city names, etc)
            layers.forEach((layer: any) => {
                if (layer.type === 'symbol') {
                    try {
                        map.current!.setPaintProperty(layer.id, 'text-halo-color', theme === 'dark' ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.8)');
                        map.current!.setPaintProperty(layer.id, 'text-halo-width', 2);
                        map.current!.setPaintProperty(layer.id, 'text-halo-blur', 1);
                    } catch (e) {
                        // Some layers might not support these paint properties
                    }
                }
            });
        };

        mapInstance.on('load', () => {
            apply3DBuildingLayer();
            setIsMapReady(true);
            onMapReady?.();
        });

        // Audit Fix: Handle style background updates reactively
        // Increment styleVersion to trigger re-render of dynamic layers (routes, privacy zones)
        mapInstance.on('style.load', () => {
            apply3DBuildingLayer();
            setStyleVersion(v => v + 1);
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
            if (map.current && onBoundsChange) {
                const bounds = map.current.getBounds();
                onBoundsChange({
                    north: bounds.getNorth(),
                    south: bounds.getSouth(),
                    east: bounds.getEast(),
                    west: bounds.getWest()
                });
            }
        });

        // Add navigation controls
        mapInstance.addControl(new maplibregl.NavigationControl(), 'bottom-right');

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
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
        if (map.current && styleUrl) {
            try {
                // Set diff: false to prevent "Cannot read properties of undefined (reading 'setState')"
                // occurring in maplibre-gl when switching between complex style objects.
                map.current.setStyle(styleUrl, { diff: false });
            } catch (err) {
                console.error('🗺️ Map: setStyle failed', err);
            }
        }
    }, [styleUrl, mapStyle]);

    // Live update 3D building heights, ambient landmark glow, and architectural lighting
    useEffect(() => {
        if (!map.current) return;

        // Apply skin-specific vector color overrides
        if (mapStyle === 'standard') {
            applySkinOverrides(map.current, mapSkin as MapSkinId, theme);
        }

        if (!map.current.getLayer('buildings-3d')) return;

        const heightMultiplier = buildingScale === 'monumental' ? 2.6 : buildingScale === 'realistic' ? 1.0 : 1.8;
        const baseHeight = Math.round(14 * heightMultiplier);
        const levelHeight = Number((4.0 * heightMultiplier).toFixed(1));

        const isWarmLight = mapSkin === 'warm_cream' || (mapSkin === 'default' && theme === 'light');

        try {
            map.current.setLight({
                anchor: 'viewport',
                color: isWarmLight ? '#fff9eb' : '#f1f5f9',
                intensity: isWarmLight ? 0.65 : 0.28,
                position: [1.2, isWarmLight ? 55 : 75, isWarmLight ? 35 : 45]
            });

            // Warm Cream Sandstone vs Muted Graphite for 3D buildings
            const extrusionColor = [
                'interpolate', ['linear'], ['zoom'],
                14, isWarmLight ? '#e6decb' : '#1c2128',
                16, isWarmLight ? '#dfd6c0' : '#242b35'
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

            map.current.setPaintProperty('buildings-3d', 'fill-extrusion-color', extrusionColor);
            map.current.setPaintProperty('buildings-3d', 'fill-extrusion-height', heightExpr);
        } catch (e) {
            console.warn('[MapLibre] Dynamic building style update:', e);
        }
    }, [buildingScale, landmarkGlow, theme, mapSkin, mapStyle, styleVersion]);

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

    // Update Route Line
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const routeId = 'active-route-line';
        const completedId = 'completed-route-line';
        const you = members.find(m => m.id === 'demo-you' || m.id === members[0]?.id);
        
        if (routeCoords.length === 0) {
            if (map.current.getSource(routeId)) (map.current.getSource(routeId) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
            if (map.current.getSource(completedId)) (map.current.getSource(completedId) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
            return;
        }

        // Split logic: Use pre-calculated splitIndex from navigationEngine or fallback
        const effectiveSplitIndex = typeof splitIndex === 'number' ? splitIndex : 0;
        const completedCoords = routeCoords.slice(0, effectiveSplitIndex + 1);
        const remainingCoords = routeCoords.slice(effectiveSplitIndex);

        const remainingData = {
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': remainingCoords.map(c => [c.lng, c.lat])
            }
        };

        const completedData = {
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': completedCoords.map(c => [c.lng, c.lat])
            }
        };

        const updateGeoJsonSources = () => {
            if (!map.current) return;
            // --- RENDER REMAINING (Main Blue Line) ---
            if (map.current.getSource(routeId)) {
                (map.current.getSource(routeId) as maplibregl.GeoJSONSource).setData(remainingData as any);
            } else {
                map.current.addSource(routeId, { 'type': 'geojson', 'data': remainingData as any });
                
                // Glow layer
                map.current.addLayer({
                    'id': `${routeId}-glow`, 'type': 'line', 'source': routeId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#818cf8', 'line-width': 12, 'line-opacity': 0.3 }
                });

                // Main line layer
                map.current.addLayer({
                    'id': routeId, 'type': 'line', 'source': routeId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#6366f1', 'line-width': 8, 'line-opacity': 0.9 }
                });
            }

            // --- RENDER COMPLETED (Dimmed Grey Line) ---
            if (map.current.getSource(completedId)) {
                (map.current.getSource(completedId) as maplibregl.GeoJSONSource).setData(completedData as any);
            } else {
                map.current.addSource(completedId, { 'type': 'geojson', 'data': completedData as any });
                map.current.addLayer({
                    'id': completedId, 'type': 'line', 'source': completedId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': theme === 'dark' ? '#475569' : '#94a3b8', 'line-width': 6, 'line-opacity': 0.4 }
                }, routeId); // Add below the active route
            }
        };

        if (routeRafRef.current) {
            cancelAnimationFrame(routeRafRef.current);
        }
        routeRafRef.current = requestAnimationFrame(updateGeoJsonSources);

        return () => {
            if (routeRafRef.current) {
                cancelAnimationFrame(routeRafRef.current);
            }
        };

    }, [routeCoords, isMapReady, styleVersion, isNavigating, theme, currentStepIndex, splitIndex]); 

    // Destination Pin Marker
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        // Remove old marker
        if (destinationMarkerRef.current) {
            destinationMarkerRef.current.remove();
            destinationMarkerRef.current = null;
        }

        // Add new marker if route is active
        if (activeRoute?.destinationLoc) {
            const el = document.createElement('div');
            el.style.cssText = `
                width: 36px; height: 36px;
                background: linear-gradient(135deg, #ef4444, #dc2626);
                border-radius: 50% 50% 50% 0;
                transform: rotate(-45deg);
                border: 3px solid white;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                display: flex; align-items: center; justify-content: center;
            `;
            const inner = document.createElement('div');
            inner.style.cssText = `
                width: 10px; height: 10px;
                background: white;
                border-radius: 50%;
                transform: rotate(45deg);
            `;
            el.appendChild(inner);

            destinationMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                .setLngLat([activeRoute.destinationLoc.lng, activeRoute.destinationLoc.lat])
                .addTo(map.current!);
        }
    }, [activeRoute, isMapReady]);

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

    const placesRef = useRef(places);
    placesRef.current = places;

    // Update Places Markers
    useEffect(() => {
        if (!map.current) return;

        places.forEach(place => {
            if (!placesMarkersRef.current.has(place.id)) {
                const el = document.createElement('div');
                el.className = 'maplibre-place-marker group transition-transform hover:scale-110';
                
                const brand = getBrandMeta(place.name);
                if (brand) {
                    el.innerHTML = `
                        <div style="
                            width: 38px;
                            height: 38px;
                            border-radius: 12px;
                            background: ${brand.bg};
                            border: 2px solid ${brand.border};
                            box-shadow: 0 6px 16px rgba(0,0,0,0.5), 0 0 12px ${brand.border}55;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 5px;
                            cursor: pointer;
                        ">
                            ${brand.svg}
                        </div>
                    `;
                } else {
                    el.innerHTML = `
                        <div style="
                            width: 36px;
                            height: 36px;
                            border-radius: 12px;
                            background: rgba(15, 23, 42, 0.9);
                            backdrop-filter: blur(8px);
                            border: 2px solid rgba(255, 255, 255, 0.2);
                            box-shadow: 0 6px 16px rgba(0,0,0,0.5);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 20px;
                            cursor: pointer;
                        ">
                            ${place.icon || '📍'}
                        </div>
                    `;
                }
                el.style.cursor = 'pointer';

                // Click handler opens the PlaceDetailPanel (which has Navigate button)
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const latestPlace = placesRef.current.find(p => p.id === place.id) || place;
                    onSelectPlace?.(latestPlace);
                });

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([place.location.lng, place.location.lat])
                    .addTo(map.current!);

                placesMarkersRef.current.set(place.id, marker);
            }
        });

        // Cleanup
        placesMarkersRef.current.forEach((marker, id) => {
            if (!places.find(p => p.id === id)) {
                marker.remove();
                placesMarkersRef.current.delete(id);
            }
        });
    }, [places, onSelectPlace]);

    // Update Places Geofence Circles
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        places.forEach(place => {
            const sourceId = `place-geofence-${place.id}`;
            const radiusKm = place.radius || 0.3; // Default 300m
            const coords = getCircleCoords(place.location, radiusKm, 64);
            const geojson = {
                'type': 'Feature',
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': [coords]
                },
                'properties': {}
            };

            const source = map.current?.getSource(sourceId) as maplibregl.GeoJSONSource;
            if (source) {
                source.setData(geojson as any);
            } else {
                map.current?.addSource(sourceId, {
                    'type': 'geojson',
                    'data': geojson as any
                });

                map.current?.addLayer({
                    'id': `${sourceId}-fill`,
                    'type': 'fill',
                    'source': sourceId,
                    'paint': {
                        'fill-color': theme === 'dark' ? '#64748b' : '#4f46e5',
                        'fill-opacity': theme === 'dark' ? 0.05 : 0.10
                    }
                });

                map.current?.addLayer({
                    'id': `${sourceId}-outline`,
                    'type': 'line',
                    'source': sourceId,
                    'paint': {
                        'line-color': theme === 'dark' ? '#94a3b8' : '#6366f1',
                        'line-width': 1.2,
                        'line-opacity': theme === 'dark' ? 0.22 : 0.35,
                        'line-dasharray': [3, 3]
                    }
                });
            }
            renderedGeofenceIdsRef.current.add(place.id);
        });

        // Cleanup removed geofence circles
        const currentPlaceIds = new Set(places.map(p => p.id));
        renderedGeofenceIdsRef.current.forEach(id => {
            if (!currentPlaceIds.has(id)) {
                const sourceId = `place-geofence-${id}`;
                if (map.current?.getLayer(`${sourceId}-fill`)) map.current.removeLayer(`${sourceId}-fill`);
                if (map.current?.getLayer(`${sourceId}-outline`)) map.current.removeLayer(`${sourceId}-outline`);
                if (map.current?.getSource(sourceId)) map.current.removeSource(sourceId);
                renderedGeofenceIdsRef.current.delete(id);
            }
        });
    }, [places, isMapReady, styleVersion]);

    // Update Incident Markers
    useEffect(() => {
        if (!map.current) return;

        incidents.forEach(incident => {
            if (!incidentsMarkersRef.current.has(incident.id)) {
                const el = document.createElement('div');
                el.className = 'maplibre-incident-marker';
                el.innerHTML = `<div style="font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))">⚠️</div>`;
                el.style.cursor = 'pointer';

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([incident.location.lng, incident.location.lat])
                    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<b>${incident.type.toUpperCase()}</b>`))
                    .addTo(map.current!);

                incidentsMarkersRef.current.set(incident.id, marker);
            }
        });

        // Cleanup
        incidentsMarkersRef.current.forEach((marker, id) => {
            if (!incidents.find(i => i.id === id)) {
                marker.remove();
                incidentsMarkersRef.current.delete(id);
            }
        });
    }, [incidents]);

    // Update Trip Safety Events (Historical Trip Inspection)
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        // Clear existing safety event markers
        safetyEventMarkersRef.current.forEach(m => m.remove());
        safetyEventMarkersRef.current = [];

        if (!tripSafetyEvents || tripSafetyEvents.length === 0) return;

        tripSafetyEvents.forEach(evt => {
            if (!evt.location || typeof evt.location.lat !== 'number' || typeof evt.location.lng !== 'number') return;

            const isHardBrake = evt.type === 'hard_brake';
            const isRapidAccel = evt.type === 'rapid_accel';
            const icon = isHardBrake ? '🛑' : isRapidAccel ? '🏎️' : '⚡';
            const label = isHardBrake ? 'Hard Brake Detected' : isRapidAccel ? 'Rapid Acceleration' : 'Speeding Event';
            const badgeBg = isHardBrake ? '#ef4444' : isRapidAccel ? '#f59e0b' : '#eab308';

            const el = document.createElement('div');
            el.className = 'safety-incident-marker';
            el.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                background: ${badgeBg};
                border: 2px solid white;
                border-radius: 50%;
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                cursor: pointer;
                font-size: 14px;
                transition: transform 0.2s ease;
            `;
            el.innerHTML = `<span>${icon}</span>`;
            el.onmouseenter = () => el.style.transform = 'scale(1.25)';
            el.onmouseleave = () => el.style.transform = 'scale(1)';

            const timeFormatted = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            const popup = new maplibregl.Popup({ offset: 15, closeButton: false }).setHTML(`
                <div style="font-family: system-ui, -apple-system, sans-serif; padding: 6px 8px; font-size: 11px; font-weight: bold; color: #0f172a;">
                    <div style="display: flex; align-items: center; gap: 5px; color: ${badgeBg};">
                        <span style="font-size: 14px;">${icon}</span>
                        <span>${label}</span>
                    </div>
                    ${timeFormatted ? `<div style="font-size: 9px; color: #64748b; margin-top: 3px;">Logged at ${timeFormatted}</div>` : ''}
                </div>
            `);

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([evt.location.lng, evt.location.lat])
                .setPopup(popup)
                .addTo(map.current!);

            safetyEventMarkersRef.current.push(marker);
        });

        return () => {
            safetyEventMarkersRef.current.forEach(m => m.remove());
            safetyEventMarkersRef.current = [];
        };
    }, [tripSafetyEvents, isMapReady]);

    // Update Privacy Zones
    useEffect(() => {
        if (!map.current || !isMapReady) return;

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

    // Update member markers and accuracy circles
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const SNAPPING_THRESHOLD_METERS = 40; // Max distance to snap to road

        const validMembers = members.filter(m => !(m.location.lat === 0 && m.location.lng === 0));
        const dedupedMembers = Array.from(
            new Map<string, FamilyMember>(validMembers.map(m => [m.id, m])).values()
        );

        dedupedMembers.forEach(member => {
            let finalLocation = member.location;
            let displayBearing = 0;

            // --- Audit #5: Snap-to-Road Logic ---
            if (isNavigating && routeCoords.length >= 2) {
                // For simplicity, we snap ONLY members who are part of the active trip (usually 'You')
                // but checking distance threshold makes it safe for all.
                let minSegDist = Infinity;
                let snappedPoint: Location | null = null;
                let segBearing = 0;

                const startIdx = Math.max(0, currentStepIndex - 1);
                const endIdx = Math.min(routeCoords.length - 1, currentStepIndex + 3);
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
                }
            }

            const position: [number, number] = [finalLocation.lng, finalLocation.lat];

            // --- Accuracy & Privacy Halo Circle ---
            const circleSourceId = `accuracy-circle-${member.id}`;
            const circleLineLayerId = `accuracy-circle-line-${member.id}`;
            const isBlurred = member.privacyMode === 'blurred' || member.isGhostMode;
            const circleRadiusKm = isBlurred ? ((member.blurredRadiusMeters || 2400) / 1000) : (member.accuracy ? member.accuracy / 1000 : 0);

            if (circleRadiusKm > 0 && !isNavigating) { // Hide circle during nav for clean UI
                 const coords = getCircleCoords(finalLocation, circleRadiusKm, 36);
 
                 const circleData: GeoJSON.Feature = {
                     type: 'Feature',
                     properties: {},
                     geometry: { type: 'Polygon', coordinates: [coords] }
                 };
 
                 if (map.current!.getSource(circleSourceId)) {
                     (map.current!.getSource(circleSourceId) as maplibregl.GeoJSONSource).setData(circleData);
                 } else {
                     map.current!.addSource(circleSourceId, { type: 'geojson', data: circleData });
                     map.current!.addLayer({
                         id: circleSourceId,
                         type: 'fill',
                         source: circleSourceId,
                         paint: { 
                             'fill-color': isBlurred ? '#a855f7' : '#6366f1', 
                             'fill-opacity': isBlurred ? 0.16 : 0.1 
                         }
                     });
                     if (isBlurred) {
                         map.current!.addLayer({
                             id: circleLineLayerId,
                             type: 'line',
                             source: circleSourceId,
                             paint: {
                                 'line-color': '#c084fc',
                                 'line-width': 2,
                                 'line-dasharray': [3, 2],
                                 'line-opacity': 0.7
                             }
                         });
                     }
                 }
            } else {
                 if (map.current!.getLayer(circleLineLayerId)) map.current!.removeLayer(circleLineLayerId);
                 if (map.current!.getLayer(circleSourceId)) map.current!.removeLayer(circleSourceId);
                 if (map.current!.getSource(circleSourceId)) map.current!.removeSource(circleSourceId);
            }

            // --- Member Marker ---
            if (markersRef.current.has(member.id)) {
                const marker = markersRef.current.get(member.id);
                marker?.setLngLat(position);
                
                // Rotate marker if driving
                const el = marker?.getElement();
                if (el) {
                    const arrow = el.querySelector('.marker-direction-arrow') as HTMLElement;
                    if (arrow) {
                        arrow.style.transform = `rotate(${displayBearing}deg)`;
                        arrow.style.opacity = isNavigating ? '1' : '0';
                    }

                    // Update avatar image if changed or broken
                    const img = el.querySelector('img') as HTMLImageElement;
                    const avatarSrc = getSafeAvatarUrl(member.avatar, member.name || member.id);
                    const fallbackDataUri = getDefaultAvatarDataUri(member.name || member.id);
                    if (img && img.src !== avatarSrc) {
                        img.src = avatarSrc;
                        img.onerror = () => { img.onerror = null; img.src = fallbackDataUri; };
                    }

                    // Update live ETA badge
                    const existingEtaBadge = el.querySelector('.marker-eta-badge');
                    if (member.currentTrip) {
                        if (!existingEtaBadge) {
                            const etaBadge = document.createElement('div');
                            etaBadge.className = 'marker-eta-badge';
                            etaBadge.style.cssText = `position: absolute; top: -24px; left: 50%; transform: translateX(-50%); background: rgba(99, 102, 241, 0.9); backdrop-filter: blur(8px); color: white; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.3); box-shadow: 0 4px 10px rgba(0,0,0,0.3); white-space: nowrap; pointer-events: none; display: flex; align-items: center; gap: 3px;`;
                            etaBadge.innerHTML = `<span>🚗</span><span>${member.currentTrip.totalTime}</span>`;
                            el.appendChild(etaBadge);
                        } else {
                            existingEtaBadge.innerHTML = `<span>🚗</span><span>${member.currentTrip.totalTime}</span>`;
                        }
                    } else if (existingEtaBadge) {
                        existingEtaBadge.remove();
                    }
                }
            } else {
                const el = document.createElement('div');
                el.className = 'maplibre-member-marker';

                const updatedMs = new Date(member.lastUpdated).getTime();
                const ageMinutes = Math.floor((Date.now() - updatedMs) / 60000);
                const isStale = ageMinutes >= 5;
                const ageBadge = isStale ? (ageMinutes >= 60 ? `${Math.floor(ageMinutes / 60)}h ago` : `${ageMinutes}m ago`) : '';

                const borderColor = isBlurred 
                    ? '#a855f7' 
                    : member.privacyMode === 'frozen' 
                        ? '#38bdf8' 
                        : isStale 
                            ? '#9ca3af' 
                            : member.status === 'Driving' 
                                ? '#6366f1' 
                                : '#22c55e';

                el.style.cssText = `
                  width: 52px; height: 52px;
                  border-radius: 50%;
                  border: 3px solid ${borderColor};
                  box-shadow: 0 4px 12px ${isBlurred ? 'rgba(168, 85, 247, 0.4)' : 'rgba(0,0,0,0.4)'};
                  cursor: pointer;
                  ${isStale ? 'filter: grayscale(70%); opacity: 0.7;' : ''}
                  position: relative;
                `;

                const avatarSrc = getSafeAvatarUrl(member.avatar, member.name || member.id);
                const fallbackDataUri = getDefaultAvatarDataUri(member.name || member.id);

                const avatarWrapper = document.createElement('div');
                avatarWrapper.style.cssText = 'width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: #1e293b; display: flex; align-items: center; justify-content: center;';

                const avatarImg = document.createElement('img');
                avatarImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%;';
                avatarImg.src = avatarSrc;
                avatarImg.onerror = () => {
                    avatarImg.onerror = null;
                    avatarImg.src = fallbackDataUri;
                };
                avatarWrapper.appendChild(avatarImg);
                el.appendChild(avatarWrapper);

                const directionArrow = document.createElement('div');
                directionArrow.className = 'marker-direction-arrow';
                directionArrow.style.cssText = `
                    position: absolute; top: -12px; left: 50%; margin-left: -8px;
                    width: 16px; height: 16px; border-left: 8px solid transparent; 
                    border-right: 8px solid transparent; border-bottom: 12px solid #6366f1;
                    transition: all 0.3s ease; opacity: ${isNavigating ? '1' : '0'}; transform-origin: center 18px;
                    transform: rotate(${displayBearing}deg);
                `;
                el.appendChild(directionArrow);

                if (member.currentTrip) {
                    const etaBadge = document.createElement('div');
                    etaBadge.className = 'marker-eta-badge';
                    etaBadge.style.cssText = `position: absolute; top: -24px; left: 50%; transform: translateX(-50%); background: rgba(99, 102, 241, 0.9); backdrop-filter: blur(8px); color: white; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.3); box-shadow: 0 4px 10px rgba(0,0,0,0.3); white-space: nowrap; pointer-events: none; display: flex; align-items: center; gap: 3px;`;
                    etaBadge.innerHTML = `<span>🚗</span><span>${member.currentTrip.totalTime}</span>`;
                    el.appendChild(etaBadge);
                }

                if (isBlurred) {
                    const blurBadge = document.createElement('div');
                    blurBadge.style.cssText = `position: absolute; top: -18px; left: 50%; transform: translateX(-50%); background: rgba(168, 85, 247, 0.9); backdrop-filter: blur(6px); color: white; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); white-space: nowrap; pointer-events: none;`;
                    blurBadge.textContent = '🏙️ ~1.5 mi';
                    el.appendChild(blurBadge);
                } else if (member.privacyMode === 'frozen') {
                    const frozenBadge = document.createElement('div');
                    frozenBadge.style.cssText = `position: absolute; top: -18px; left: 50%; transform: translateX(-50%); background: rgba(56, 189, 248, 0.9); backdrop-filter: blur(6px); color: white; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); white-space: nowrap; pointer-events: none;`;
                    frozenBadge.textContent = '❄️ Frozen';
                    el.appendChild(frozenBadge);
                }

                if (isStale) {
                    const badge = document.createElement('div');
                    badge.style.cssText = `position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: #6b7280; color: white; font-size: 9px; font-weight: 600; padding: 1px 4px; border-radius: 6px; white-space: nowrap; pointer-events: none;`;
                    badge.textContent = ageBadge;
                    el.appendChild(badge);
                }

                el.addEventListener('click', () => onSelectMember?.(member.id));

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat(position)
                    .addTo(map.current!);

                markersRef.current.set(member.id, marker);
            }
        });

        // Cleanup
        markersRef.current.forEach((marker, id) => {
            if (!members.find(m => m.id === id)) {
                marker.remove();
                markersRef.current.delete(id);
                const circleSourceId = `accuracy-circle-${id}`;
                if (map.current?.getLayer(circleSourceId)) map.current.removeLayer(circleSourceId);
                if (map.current?.getSource(circleSourceId)) map.current.removeSource(circleSourceId);
            }
        });
    }, [members, isMapReady, isNavigating, routeCoords, currentStepIndex]);

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
            wasNavigatingRef.current = true;

            // If user has dragged/panned or zoomed the map ahead, DO NOT fight user touch input
            if (isCameraFree) {
                return;
            }

            // Compute travel bearing from driver device heading or route polyline
            let travelBearing = prevBearingRef.current;
            if (driver?.heading !== undefined && driver.heading >= 0 && (driver.speed || 0) > 1.5) {
                travelBearing = driver.heading;
            } else if (routeCoords.length >= 2) {
                // Find nearest route segment
                let minDist = Infinity;
                let nearestIdx = Math.max(0, Math.min(currentStepIndex, routeCoords.length - 2));
                for (let i = 0; i < routeCoords.length - 1; i++) {
                    const snap = getPointOnSegmentNearestTo(driverLoc, routeCoords[i], routeCoords[i + 1]);
                    const d = getDistanceMeters(driverLoc, snap);
                    if (d < minDist) {
                        minDist = d;
                        nearestIdx = i;
                    }
                }
                travelBearing = getBearing(routeCoords[nearestIdx], routeCoords[Math.min(nearestIdx + 1, routeCoords.length - 1)]);
            }

            // Smooth bearing interpolation (shortest path across 360 boundary)
            let delta = travelBearing - prevBearingRef.current;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            const smoothedBearing = prevBearingRef.current + delta * 0.45;
            prevBearingRef.current = ((smoothedBearing % 360) + 360) % 360;

            // 3rd Person Perspective Chase View:
            // - Pitch: 60° (high 3D tilt looking down the road)
            // - Bearing: forward along vehicle heading (MapLibre rotates map so heading faces UP)
            // - Zoom: 17.8 (detailed driving scale)
            // - Padding: shifts vehicle marker down to bottom ~35% of screen so 65% is road ahead
            map.current.easeTo({
                center: [driverLoc.lng, driverLoc.lat],
                bearing: prevBearingRef.current,
                pitch: 60,
                zoom: isMobile ? 17.5 : 18.0,
                padding: {
                    top: isMobile ? 120 : 90,
                    bottom: isMobile ? 240 : 180,
                    left: 0,
                    right: 0
                },
                duration: 700,
                easing: (t: number) => t
            });
            return;
        }
    }, [members, userLocation, currentUserId, isNavigating, isMapReady, routeCoords, is3DMode, isCameraFree, currentStepIndex, isMobile]);

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

    return (
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
    );
};

export default React.memo(MapLibre3DView);
