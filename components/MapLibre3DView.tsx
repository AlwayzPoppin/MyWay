import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FamilyMember, Place, CircleTask, Location, TrafficSegment } from '../types';
import { MapSkinId, getMapSkin, applySkinOverrides, SATELLITE_STYLE, TERRAIN_STYLE } from '../services/mapSkinService';
import { getDistanceMeters, getDistanceMiles, getBearing, getPointOnSegmentNearestTo } from '../utils/geo';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { getBrandMeta } from '../services/brandLogoService';
import { getGTAPlaceBlipHtml, getGTADestinationPinHtml } from '../services/gtaIconsService';
import { convoyService } from '../services/convoyService';
import { computeRouteTrafficSegments } from '../services/trafficService';
import { maintenanceAlertService } from '../services/maintenanceAlertService';
import { searchMaintenanceAlongRoute } from '../services/placesService';

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
    isLowDataMode?: boolean;
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
    onCameraFreeChange,
    isLowDataMode = false
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = React.useState(false);
    const [styleVersion, setStyleVersion] = React.useState(0); // Track style reloads to re-render layers
    const [mapEpoch, setMapEpoch] = React.useState(0); // Incremented to trigger WebGL context loss recovery reboot
    const renderedGeofenceIdsRef = useRef<Set<string>>(new Set());
    const routeRafRef = useRef<number | null>(null);
    const membersMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const placesMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
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
                    renderedGeofenceIdsRef.current.clear();
                    membersMarkersRef.current.forEach(m => m.remove());
                    membersMarkersRef.current.clear();
                    placesMarkersRef.current.forEach(m => m.remove());
                    placesMarkersRef.current.clear();

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
    // Respects Low Data Mode (minimal 2D vector) vs Warm Cream (Light) vs Muted Slate (Dark) vs Auto Dynamic
    const styleUrl = useMemo(() => {
        if (isLowDataMode) {
            // Low Data Mode: Minimal vector 2D basemap, avoids heavy raster tiles and complex layers
            return theme === 'dark'
                ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
        }

        const skin = getMapSkin(mapSkin as MapSkinId);
        let url: any = skin.styleUrl;
 
        if (mapStyle === 'satellite') {
            url = SATELLITE_STYLE;
        } else if (mapStyle === 'terrain') {
            url = TERRAIN_STYLE;
        } else if (mapSkin === 'default') {
            url = theme === 'dark'
                ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
        } else if (mapSkin === 'warm_cream') {
            url = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
        } else if (mapSkin === 'muted_slate') {
            url = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
        }
        return url;
    }, [mapSkin, mapStyle, theme, isLowDataMode]);

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

    // ==========================================
    // 3D BUILDINGS & ARCHITECTURAL SHADING ENGINE
    // ==========================================
    const apply3DBuildingLayer = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;

        // Apply skin-specific color overrides
        if (mapStyle === 'standard' && !isLowDataMode) {
            applySkinOverrides(map.current, mapSkin as MapSkinId, theme);
        }

        const layers = map.current.getStyle()?.layers || [];
        const buildingLayer = layers.find(
            (layer: any) => layer.id.includes('building') && layer.type === 'fill'
        );

        // Hide all 2D flat building and shadow layers so only the clean 3D extrusion renders
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

        // Low Data Mode: Suppress heavy 3D building extrusions, tessellation, and complex lighting to conserve bandwidth & CPU
        if (isLowDataMode) {
            if (map.current.getLayer('buildings-3d')) {
                map.current.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
            if (buildingLayer) {
                map.current.setLayoutProperty(buildingLayer.id, 'visibility', 'visible');
            }
            try {
                map.current.setLight({ intensity: 0 });
            } catch {}
            return;
        }

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

            const isWarmLight = mapSkin === 'warm_cream' || (mapSkin === 'default' && theme === 'light');

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

            const isGTARadar = mapSkin === 'gta_radar';
            // Crisp, solid volumetric architectural contrast for both light and dark themes
            const extrusionColor = [
                'interpolate', ['linear'], ['zoom'],
                14, isWarmLight ? '#cbd5e1' : isGTARadar ? '#202936' : '#1e293b',
                16, isWarmLight ? '#b8c4d4' : isGTARadar ? '#2a3647' : '#243044'
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

        // GTA Los Santos Radar Vector Styling (Freeway Yellow, Bright White Arterials, Sage Parks, Deep Ocean)
        if (mapSkin === 'gta_radar') {
            try {
                const motLayers = ['road_mot_fill_noramp', 'road_mot_fill_ramp', 'bridge_mot_fill', 'tunnel_mot_fill'];
                motLayers.forEach(id => {
                    if (map.current!.getLayer(id)) map.current!.setPaintProperty(id, 'line-color', '#fbbf24');
                });
                const trunkLayers = ['road_trunk_fill_noramp', 'road_pri_fill_noramp', 'bridge_trunk_fill', 'bridge_pri_fill'];
                trunkLayers.forEach(id => {
                    if (map.current!.getLayer(id)) map.current!.setPaintProperty(id, 'line-color', '#f8fafc');
                });
                const secLayers = ['road_sec_fill_noramp', 'bridge_sec_fill'];
                secLayers.forEach(id => {
                    if (map.current!.getLayer(id)) map.current!.setPaintProperty(id, 'line-color', '#cbd5e1');
                });
                if (map.current!.getLayer('road_minor_fill')) map.current!.setPaintProperty('road_minor_fill', 'line-color', '#475569');
                if (map.current!.getLayer('park')) map.current!.setPaintProperty('park', 'fill-color', '#1a2e22');
                if (map.current!.getLayer('water')) map.current!.setPaintProperty('water', 'fill-color', '#0d1721');
            } catch (e) {}
        }

        // ==========================================
        // 3D STREET LABEL LEGIBILITY & VIEWPORT ORIENTATION ENGINE
        // ==========================================
        const isWarmLightSkin = mapSkin === 'warm_cream' || (mapSkin === 'default' && theme === 'light');
        const isGTARadar = mapSkin === 'gta_radar';

        layers.forEach((layer: any) => {
            if (layer.type === 'symbol') {
                try {
                    // 1. Force viewport-aligned billboarding so street text never squashes, skews, or foreshortens when camera is pitched/tilted
                    if (map.current!.getLayoutProperty(layer.id, 'text-pitch-alignment') !== 'viewport') {
                        map.current!.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
                    }
                    
                    // Allow road labels to bend naturally around curves without vanishing
                    try {
                        map.current!.setLayoutProperty(layer.id, 'text-max-angle', 45);
                    } catch {}

                    // 2. High-contrast typography colors & protective backdrop halos
                    if (isWarmLightSkin) {
                        // Light Mode / Warm Cream: Deep Charcoal text with brilliant crisp white halos
                        map.current!.setPaintProperty(layer.id, 'text-color', '#0f172a');
                        map.current!.setPaintProperty(layer.id, 'text-halo-color', 'rgba(255, 255, 255, 0.98)');
                        map.current!.setPaintProperty(layer.id, 'text-halo-width', 2.5);
                        map.current!.setPaintProperty(layer.id, 'text-halo-blur', 1);
                    } else if (isGTARadar) {
                        // GTA Radar: Golden Amber / Crisp White typography with deep midnight outline
                        const isRoad = layer.id.includes('road') || layer.id.includes('street') || layer.id.includes('highway');
                        map.current!.setPaintProperty(layer.id, 'text-color', isRoad ? '#fef08a' : '#f8fafc');
                        map.current!.setPaintProperty(layer.id, 'text-halo-color', '#000000');
                        map.current!.setPaintProperty(layer.id, 'text-halo-width', 2.5);
                        map.current!.setPaintProperty(layer.id, 'text-halo-blur', 0.8);
                    } else {
                        // Dark Mode / Muted Slate: High-contrast pure white/light-slate text with deep obsidian halos
                        map.current!.setPaintProperty(layer.id, 'text-color', '#f8fafc');
                        map.current!.setPaintProperty(layer.id, 'text-halo-color', 'rgba(9, 13, 22, 0.98)');
                        map.current!.setPaintProperty(layer.id, 'text-halo-width', 2.5);
                        map.current!.setPaintProperty(layer.id, 'text-halo-blur', 1);
                    }

                    // 3. Ensure full opacity for road names across all camera angles
                    if (layer.id.includes('road') || layer.id.includes('street') || layer.id.includes('highway') || layer.id.includes('path')) {
                        map.current!.setPaintProperty(layer.id, 'text-opacity', 1.0);
                    }
                } catch (e) {
                    // Some layers might not support these paint properties
                }
            }
        });
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
            membersMarkersRef.current.forEach(m => m.remove());
            membersMarkersRef.current.clear();
            placesMarkersRef.current.forEach(m => m.remove());
            placesMarkersRef.current.clear();
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

    // Update Route Line
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const routeId = 'active-route-line';
        const completedId = 'completed-route-line';
        
        if (routeCoords.length === 0) {
            staticRemainingRouteGeoJSON.geometry.coordinates.length = 0;
            staticCompletedRouteGeoJSON.geometry.coordinates.length = 0;
            const routeSrc = map.current.getSource(routeId) as maplibregl.GeoJSONSource | undefined;
            const compSrc = map.current.getSource(completedId) as maplibregl.GeoJSONSource | undefined;
            if (routeSrc) routeSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            if (compSrc) compSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            return;
        }

        // Split logic: In-place array mutation avoiding slice, map, and per-frame GC allocations
        const effectiveSplitIndex = typeof splitIndex === 'number' ? splitIndex : 0;
        const totalPoints = routeCoords.length;

        const remainingCoords = staticRemainingRouteGeoJSON.geometry.coordinates;
        const completedCoords = staticCompletedRouteGeoJSON.geometry.coordinates;

        // 1. Populate completed coordinates [0 .. effectiveSplitIndex] in-place
        const completedCount = Math.min(effectiveSplitIndex + 1, totalPoints);
        completedCoords.length = completedCount;
        for (let i = 0; i < completedCount; i++) {
            const pt = routeCoords[i];
            if (!completedCoords[i]) {
                completedCoords[i] = [pt.lng, pt.lat];
            } else {
                completedCoords[i][0] = pt.lng;
                completedCoords[i][1] = pt.lat;
            }
        }

        // 2. Populate remaining coordinates [effectiveSplitIndex .. totalPoints - 1] in-place
        const remainingCount = Math.max(0, totalPoints - effectiveSplitIndex);
        remainingCoords.length = remainingCount;
        for (let i = 0; i < remainingCount; i++) {
            const pt = routeCoords[effectiveSplitIndex + i];
            if (!remainingCoords[i]) {
                remainingCoords[i] = [pt.lng, pt.lat];
            } else {
                remainingCoords[i][0] = pt.lng;
                remainingCoords[i][1] = pt.lat;
            }
        }

        // --- Live Traffic Congestion Polyline Construction ---
        const trafficSegments: TrafficSegment[] = activeRoute?.trafficSegments || (
            routeCoords.length > 1
                ? computeRouteTrafficSegments(
                    routeCoords.map(c => [c.lng, c.lat]),
                    activeRoute?.steps || [],
                    undefined,
                    incidents
                )
                : []
        );

        // Convert segments into GeoJSON Features accounting for effectiveSplitIndex
        const remainingFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        let accumulatedPoints = 0;

        for (const seg of trafficSegments) {
            const segCoords = seg.coordinates;
            const segLen = segCoords.length;
            const segStartIdx = accumulatedPoints;
            const segEndIdx = accumulatedPoints + segLen - 1;
            accumulatedPoints += segLen;

            // If the segment is completely traversed by the user
            if (segEndIdx <= effectiveSplitIndex) {
                continue;
            }

            // If the user is currently inside this segment
            if (segStartIdx < effectiveSplitIndex && effectiveSplitIndex < segEndIdx) {
                const subIndex = effectiveSplitIndex - segStartIdx;
                const activeSlice = segCoords.slice(subIndex);
                if (activeSlice.length >= 2) {
                    remainingFeatures.push({
                        type: 'Feature',
                        properties: {
                            congestion: seg.congestion,
                            isCompleted: false
                        },
                        geometry: {
                            type: 'LineString',
                            coordinates: activeSlice
                        }
                    });
                }
            } else if (segStartIdx >= effectiveSplitIndex) {
                // Segment is ahead of user
                remainingFeatures.push({
                    type: 'Feature',
                    properties: {
                        congestion: seg.congestion,
                        isCompleted: false
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: segCoords
                    }
                });
            }
        }

        // If no split segments, fallback to whole remaining line
        if (remainingFeatures.length === 0 && remainingCoords.length >= 2) {
            remainingFeatures.push({
                type: 'Feature',
                properties: { congestion: 'low', isCompleted: false },
                geometry: { type: 'LineString', coordinates: remainingCoords }
            });
        }

        const remainingGeoJSON: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
            type: 'FeatureCollection',
            features: remainingFeatures
        };

        const updateGeoJsonSources = () => {
            if (!map.current || !map.current.isStyleLoaded()) return;

            const routeColorExpression: any = [
                'match',
                ['get', 'congestion'],
                'severe', '#dc2626',
                'heavy', '#ea580c',
                'moderate', '#eab308',
                'low', mapSkin === 'gta_radar' ? '#facc15' : '#4f46e5',
                mapSkin === 'gta_radar' ? '#facc15' : '#6366f1'
            ];

            const routeGlowExpression: any = [
                'match',
                ['get', 'congestion'],
                'severe', '#ef4444',
                'heavy', '#fb923c',
                'moderate', '#fde047',
                'low', mapSkin === 'gta_radar' ? '#f59e0b' : '#818cf8',
                '#818cf8'
            ];

            // --- RENDER REMAINING (Live Traffic Polyline) ---
            if (map.current.getSource(routeId)) {
                (map.current.getSource(routeId) as maplibregl.GeoJSONSource).setData(remainingGeoJSON as any);
                if (map.current.getLayer(`${routeId}-glow`)) {
                    map.current.setPaintProperty(`${routeId}-glow`, 'line-color', routeGlowExpression);
                }
                if (map.current.getLayer(routeId)) {
                    map.current.setPaintProperty(routeId, 'line-color', routeColorExpression);
                }
            } else {
                map.current.addSource(routeId, { 'type': 'geojson', 'data': remainingGeoJSON as any });

                // Contrast Casing Layer (dark background outline)
                map.current.addLayer({
                    'id': `${routeId}-casing`,
                    'type': 'line',
                    'source': routeId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#0f172a', 'line-width': 11, 'line-opacity': 0.75 }
                });
                
                // Glow layer
                map.current.addLayer({
                    'id': `${routeId}-glow`,
                    'type': 'line',
                    'source': routeId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': routeGlowExpression, 'line-width': 15, 'line-opacity': 0.35 }
                });

                // Main traffic line layer
                map.current.addLayer({
                    'id': routeId,
                    'type': 'line',
                    'source': routeId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': routeColorExpression, 'line-width': 8, 'line-opacity': 0.95 }
                });
            }

            // --- RENDER COMPLETED (Dimmed Grey Line) ---
            if (map.current.getSource(completedId)) {
                (map.current.getSource(completedId) as maplibregl.GeoJSONSource).setData(staticCompletedRouteGeoJSON as any);
            } else {
                map.current.addSource(completedId, { 'type': 'geojson', 'data': staticCompletedRouteGeoJSON as any });
                map.current.addLayer({
                    'id': completedId,
                    'type': 'line',
                    'source': completedId,
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': theme === 'dark' ? '#475569' : '#94a3b8', 'line-width': 6, 'line-opacity': 0.4 }
                }, `${routeId}-casing`); // Add below the active route casing
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

    // ==========================================
    // UNIFIED WEBGL DESTINATION PIN LAYER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'destination-pin-webgl-source';
        const destinationLoc = activeRoute?.destinationLoc;

        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: destinationLoc ? [{
                type: 'Feature',
                properties: {
                    name: activeRoute.destinationName || 'Destination',
                    isGTARadar: mapSkin === 'gta_radar'
                },
                geometry: {
                    type: 'Point',
                    coordinates: [destinationLoc.lng, destinationLoc.lat]
                }
            }] : []
        };

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            // Outer Pulse Glow Circle
            map.current.addLayer({
                id: 'destination-pulse-glow',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': '#ef4444',
                    'circle-radius': 18,
                    'circle-opacity': 0.35,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });

            // Core Pin Circle
            map.current.addLayer({
                id: 'destination-core-circle',
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-color': '#dc2626',
                    'circle-radius': 11,
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.98
                }
            });

            // Destination Icon
            map.current.addLayer({
                id: 'destination-pin-symbol',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': '🏁',
                    'text-size': 13,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                }
            });

            // Destination Name Label
            map.current.addLayer({
                id: 'destination-name-label',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-size': 11,
                    'text-offset': [0, 1.8],
                    'text-anchor': 'top',
                    'text-optional': true
                },
                paint: {
                    'text-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
                    'text-halo-color': theme === 'dark' ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                    'text-halo-width': 2
                }
            });
        }
    }, [activeRoute?.destinationLoc, activeRoute?.destinationName, isMapReady, styleVersion, mapSkin, theme]);

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
            const placeColor = place.brandColor || (place as any).color || (
                place.type === 'home' ? '#22c55e' :
                place.type === 'work' ? '#3b82f6' :
                place.type === 'school' ? '#f59e0b' :
                place.type === 'gym' ? '#ec4899' :
                place.type === 'gas' ? '#f97316' :
                place.type === 'food' ? '#ef4444' :
                place.type === 'coffee' ? '#a855f7' : '#6366f1'
            );

            const icon = place.icon || (
                place.type === 'home' ? '🏠' :
                place.type === 'work' ? '💼' :
                place.type === 'school' ? '🏫' :
                place.type === 'gym' ? '💪' :
                place.type === 'gas' ? '⛽' :
                place.type === 'food' ? '🍔' :
                place.type === 'coffee' ? '☕' : '📍'
            );

            let marker = placesMarkersRef.current.get(place.id);
            if (!marker) {
                const el = document.createElement('div');
                el.className = 'myway-place-marker select-none';
                el.style.display = 'flex';
                el.style.flexDirection = 'column';
                el.style.alignItems = 'center';
                el.style.cursor = 'pointer';
                el.style.transform = 'translate3d(0,0,0)';
                el.innerHTML = `
                    <div style="width: 38px; height: 38px; border-radius: 50%; background: ${placeColor}; border: 2.5px solid #ffffff; box-shadow: 0 4px 14px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 18px; transition: transform 0.15s ease;">
                        ${icon}
                    </div>
                `;

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onSelectPlace?.(place);
                });

                el.addEventListener('mouseenter', () => {
                    const badge = el.querySelector('div') as HTMLElement;
                    if (badge) badge.style.transform = 'scale(1.15)';
                });
                el.addEventListener('mouseleave', () => {
                    const badge = el.querySelector('div') as HTMLElement;
                    if (badge) badge.style.transform = 'scale(1)';
                });

                marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                    .setLngLat([place.location.lng, place.location.lat])
                    .addTo(map.current!);
                placesMarkersRef.current.set(place.id, marker);
            } else {
                marker.setLngLat([place.location.lng, place.location.lat]);
            }
        });
    }, [places, isMapReady, theme, onSelectPlace]);

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
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
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
        const features = places.map(place => {
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
            let displayBearing = member.bearing || 0;

            // Snap-to-Road during navigation
            if (isNavigating && routeCoords.length >= 2) {
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

            const updatedMs = new Date(member.lastUpdated).getTime();
            const ageMinutes = Math.floor((Date.now() - updatedMs) / 60000);
            const isStale = ageMinutes >= 5;
            const isBlurred = member.privacyMode === 'blurred' || member.isGhostMode;
            const isFrozen = member.privacyMode === 'frozen';
            const isGTARadar = mapSkin === 'gta_radar';
            const isDriving = member.status === 'Driving' || (member.speed && member.speed > 5);
            const isSelf = member.id === currentUserId || member.id === 'demo-you' || member.id === 'current_user' || member.id === 'local-user';

            const borderColor = isGTARadar
                ? '#facc15'
                : isBlurred 
                    ? '#a855f7' 
                    : isFrozen 
                        ? '#38bdf8' 
                        : isStale 
                            ? '#9ca3af' 
                            : isDriving 
                                ? '#6366f1' 
                                : '#22c55e';

            const initials = (member.name || 'M').charAt(0).toUpperCase();

            let marker = membersMarkersRef.current.get(member.id);
            if (!marker) {
                const el = document.createElement('div');
                el.className = 'myway-member-avatar-marker select-none';
                el.style.cursor = 'pointer';
                el.style.display = 'flex';
                el.style.flexDirection = 'column';
                el.style.alignItems = 'center';
                el.style.transform = 'translate3d(0,0,0)';

                el.innerHTML = `
                    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
                        ${isStale ? '' : `<div style="position: absolute; inset: -4px; border-radius: 50%; background: ${borderColor}; opacity: 0.35; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`}
                        <div style="position: relative; width: 42px; height: 42px; border-radius: 50%; border: 3.5px solid #ffffff; background: ${borderColor}; box-shadow: 0 6px 18px rgba(0,0,0,0.45); overflow: hidden; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #ffffff; font-size: 16px;">
                            ${member.avatar && !member.avatar.includes('default') ? `<img src="${member.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
                            <span style="${member.avatar && !member.avatar.includes('default') ? 'display: none;' : 'display: flex;'}">${initials}</span>
                        </div>
                        ${isDriving ? `<div style="position: absolute; top: -12px; transform: rotate(${displayBearing}deg); font-size: 15px; color: ${borderColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">▲</div>` : ''}
                    </div>
                `;

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onSelectMember?.(member.id);
                });

                marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([finalLocation.lng, finalLocation.lat])
                    .addTo(map.current!);
                membersMarkersRef.current.set(member.id, marker);
            } else {
                marker.setLngLat([finalLocation.lng, finalLocation.lat]);
            }
        });
    }, [members, userLocation?.lat, userLocation?.lng, currentUserId, isMapReady, isNavigating, routeCoords, currentStepIndex, mapSkin, theme, styleVersion, onSelectMember]);

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

            // --- FLEET-AWARE DYNAMIC CONVOY FRAMING ---
            const activeConvoy = convoyService.getActiveConvoy();
            let isMultiVehicleConvoy = false;

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
                            pitch: 60,
                            bearing: prevBearingRef.current,
                            maxZoom: isMobile ? 17.5 : 18.0,
                            padding: {
                                top: isMobile ? 140 : 110,
                                bottom: isMobile ? 260 : 200,
                                left: isMobile ? 50 : 80,
                                right: isMobile ? 50 : 80
                            },
                            duration: 700,
                            easing: (t: number) => t
                        });
                    }
                }
            }

            // Fallback: Standard Single-Vehicle 3rd Person Perspective Chase View
            if (!isMultiVehicleConvoy) {
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
            }
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
