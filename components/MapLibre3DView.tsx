import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertTriangle } from 'lucide-react';
import { FamilyMember, Place, CircleTask, Location, TrafficSegment, TrafficControlPoint } from '../types';
import { MapSkinId, getMapSkin, resolveMapSkinId, applySkinOverrides, SATELLITE_STYLE, TERRAIN_STYLE } from '../services/mapSkinService';
import { solarService, SolarInfo } from '../services/solarService';
import { getDistanceMeters, getDistanceMiles, getBearing, getPointOnSegmentNearestTo, getDistanceFromCoords } from '../utils/geo';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { getBrandMeta } from '../services/brandLogoService';
import { getGTAPlaceBlipHtml, getGTADestinationPinHtml } from '../services/gtaIconsService';
import { convoyService } from '../services/convoyService';
import { computeRouteTrafficSegments } from '../services/trafficService';
import { maintenanceAlertService } from '../services/maintenanceAlertService';
import { searchMaintenanceAlongRoute, reverseGeocode } from '../services/placesService';
import { osmTrafficService } from '../services/osmTrafficService';
import { publicMapReportService, PublicMapReport } from '../services/publicMapReportService';
import { communityBuildingService, CommunityBuilding } from '../services/communityBuildingService';
import { UserProfile } from '../services/authService';
import { extractHouseNumber } from '../utils/addressUtils';
import { hapticTick, hapticMilestone, hapticSuccess, hapticError } from '../utils/haptics';
import { getRotatedBoxCoords, isPointInEntranceBox, isPointInEntranceZone, isPointInPolygon, DEFAULT_ENTRANCE_BOX } from '../services/geofenceService';
import { isHomePlace, getPlaceColor, getPlaceIconSvg } from './PlacePin';

// Memoized Circle Polygon Generator for Geofences, Privacy Zones & Accuracy Circles
const circleCoordsCache = new Map<string, [number, number][]>();
const CIRCLE_CACHE_MAX = 100;

const getCircleCoords = (center: Location, radiusKm: number, points: number = 64): [number, number][] => {
    // Quantize center to ~1m precision (5 decimals) and radius to 4 decimals (sub-meter precision)
    const key = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}_${radiusKm.toFixed(4)}_${points}`;
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

// Returns place geofence radius in meters (supports both meters and km units)
const getPlaceRadiusMeters = (place: Place | Partial<Place>): number => {
    if (!place) return 50;
    const r = (typeof place.radius === 'number' && !isNaN(place.radius) && place.radius > 0)
        ? place.radius
        : (typeof (place as any).departureRadius === 'number' && !isNaN((place as any).departureRadius) && (place as any).departureRadius > 0)
            ? (place as any).departureRadius
            : 50;
    return r > 5 ? r : r * 1000;
};

// Evaluates whether a member ID represents the local user
const checkIsMemberSelf = (memberId: string | undefined, currentUserId?: string): boolean => {
    if (!memberId) return false;
    return (
        (Boolean(currentUserId) && memberId === currentUserId) ||
        memberId === 'demo-you' ||
        memberId === 'current_user' ||
        memberId === 'local-user'
    );
};

// Generates deduplicated list of circle members including synthesized local user if not present
const getEffectiveMembersWithSelf = (
    members: FamilyMember[] | undefined,
    userLocation: Location | null | undefined,
    currentUserId?: string,
    userProfile?: UserProfile | null,
    isNavigating: boolean = false
): FamilyMember[] => {
    const validMembers = (members || []).filter(m => 
        m && 
        m.location && 
        typeof m.location.lat === 'number' && 
        typeof m.location.lng === 'number' && 
        !(m.location.lat === 0 && m.location.lng === 0) &&
        (currentUserId ? (m.id !== 'demo-you' && m.id !== 'local-user' && m.id !== 'current_user') : true)
    );

    const allMembers = [...validMembers];
    const hasSelf = allMembers.some(m => checkIsMemberSelf(m.id, currentUserId));

    if (!hasSelf && userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number' && !(userLocation.lat === 0 && userLocation.lng === 0)) {
        const selfName = userProfile?.displayName || 'You';
        const selfAvatar = getSafeAvatarUrl(userProfile?.photoURL, selfName);
        allMembers.unshift({
            id: currentUserId || 'local-user',
            name: selfName,
            avatar: selfAvatar,
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
            driveEvents: [],
            circleColor: '#8b5cf6'
        });
    }

    return Array.from(new Map<string, FamilyMember>(allMembers.map(m => [m.id, m])).values());
};

// Evaluates geofence containment for all saved places, assigning members into place occupant clusters
const computePlaceOccupants = (
    places: Place[] | undefined,
    allMembers: FamilyMember[],
    currentUserId?: string,
    isNavigating: boolean = false
): {
    placeOccupantsMap: Map<string, FamilyMember[]>;
    clusteredIntoPlaceMemberIds: Set<string>;
} => {
    const placeOccupantsMap = new Map<string, FamilyMember[]>();
    const clusteredIntoPlaceMemberIds = new Set<string>();

    const savedPlaces = (places || []).filter(p => 
        p && 
        p.location && 
        typeof p.location.lat === 'number' && 
        typeof p.location.lng === 'number' && 
        !(p.location.lat === 0 && p.location.lng === 0) &&
        !p.isAmbient && 
        p.isSaved !== false &&
        p.type !== 'search_result' && 
        !p.id?.startsWith('building_') &&
        !p.id?.startsWith('comm_bld_') &&
        !p.id?.startsWith('place_bld_') &&
        !p.id?.startsWith('community_') &&
        !p.id?.startsWith('rooftop_') &&
        !(p.id && (
            p.id.startsWith('search-') ||
            p.id.startsWith('photon-') || 
            p.id.startsWith('nominatim-') || 
            p.id.startsWith('google-') ||
            p.id.startsWith('overpass-') ||
            p.id.startsWith('temp-') ||
            p.id.startsWith('discovered-')
        ))
    );

    // Strictly ensure only genuine user/family avatars (and not building labels/rooftops) are clustered
    const validMembers = (allMembers || []).filter(m =>
        m &&
        m.id &&
        !m.id.startsWith('bld_') &&
        !m.id.startsWith('building_') &&
        !m.id.startsWith('comm_bld_') &&
        !m.id.startsWith('community_') &&
        !m.id.startsWith('place_bld_') &&
        !m.id.startsWith('rooftop_') &&
        m.location &&
        typeof m.location.lat === 'number' &&
        typeof m.location.lng === 'number'
    );

    validMembers.forEach(member => {
        const isSelf = checkIsMemberSelf(member.id, currentUserId);
        // Turn-by-turn navigation puck is protected: never suppress or absorb active driver puck into place
        if (isSelf && isNavigating) {
            return;
        }

        let closestPlace: Place | null = null;
        let closestDist = Infinity;

        savedPlaces.forEach(place => {
            const radiusM = getPlaceRadiusMeters(place);
            const dist = getDistanceMeters(member.location, place.location);
            if (dist <= radiusM && dist < closestDist) {
                closestPlace = place;
                closestDist = dist;
            }
        });

        if (closestPlace) {
            const placeId = (closestPlace as Place).id;
            const occupants = placeOccupantsMap.get(placeId) || [];
            occupants.push(member);
            placeOccupantsMap.set(placeId, occupants);
            clusteredIntoPlaceMemberIds.add(member.id);
        }
    });

    return { placeOccupantsMap, clusteredIntoPlaceMemberIds };
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
    alternativeRoutes?: any[]; // NavigationRoute[] alternative routes
    onSelectAlternativeRoute?: (route: any, index: number) => void;
    places?: Place[];
    savedPlaces?: Place[]; // Explicit list of saved user/circle geofenced places
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
    onOpenAlerts?: () => void;
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
    alternativeRoutes = [],
    onSelectAlternativeRoute,
    places = [],
    savedPlaces,
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
    onSelectMapStyle,
    onOpenAlerts
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = React.useState(false);
    const [styleVersion, setStyleVersion] = React.useState(0); // Track style reloads to re-render layers
    const [mapEpoch, setMapEpoch] = React.useState(0); // Incremented to trigger WebGL context loss recovery reboot
    const [publicReports, setPublicReports] = React.useState<PublicMapReport[]>(() => publicMapReportService.getCachedReports());
    const [communityBuildings, setCommunityBuildings] = React.useState<CommunityBuilding[]>(() => communityBuildingService.getAllBuildings());

    useEffect(() => {
        const unsub = publicMapReportService.subscribe(reports => {
            setPublicReports(reports);
        });
        return unsub;
    }, []);
    useEffect(() => {
        const unsub = communityBuildingService.subscribe(buildings => {
            setCommunityBuildings(buildings);
        });
        return unsub;
    }, []);
    const renderedGeofenceIdsRef = useRef<Set<string>>(new Set());
    const routeRafRef = useRef<number | null>(null);
    const trafficControlMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const incidentMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const membersMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const clusterMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    // Smooth Vehicle Puck & Camera 1Hz Linear Interpolation Refs
    const latestLocationRef = useRef<{ lng: number; lat: number } | null>(null);
    const latestBearingRef = useRef<number>(0);
    const prevSelfLocationRef = useRef<Location | null>(null);
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
    const puckRafIdRef = useRef<number | null>(null);
    const isPuckAnimatingRef = useRef<boolean>(false);
    const placesMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const membersRef = useRef<FamilyMember[]>(members);
    membersRef.current = members;
    const userLocationRef = useRef(userLocation);
    userLocationRef.current = userLocation;
    const onSelectPlaceRef = useRef(onSelectPlace);
    onSelectPlaceRef.current = onSelectPlace;
    const savedPlacesRef = useRef<Place[]>(savedPlaces || []);
    savedPlacesRef.current = savedPlaces || [];
    const onSelectMemberRef = useRef(onSelectMember);
    onSelectMemberRef.current = onSelectMember;
    const lastMemberSelectTimeRef = useRef<number>(0);
    const isNavigatingRef = useRef(isNavigating);
    isNavigatingRef.current = isNavigating;
    const activeRouteRef = useRef(activeRoute);
    activeRouteRef.current = activeRoute;
    const isMobileRef = useRef(isMobile);
    isMobileRef.current = isMobile;
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
                    clusterMarkersRef.current.forEach(m => m.remove());
                    clusterMarkersRef.current.clear();
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

    // Resolve dynamic skin ID: 'default' (Day) or 'carbon-amber' (Night)
    const effectiveSkin = useMemo<MapSkinId>(() => {
        return resolveMapSkinId(mapSkin as MapSkinId, solarInfo.isDaylight);
    }, [mapSkin, solarInfo.isDaylight]);

    // Respects Low Data Mode vs Default (Day) vs Carbon Amber (Night) vs Auto Solar Transition
    const styleUrl = useMemo(() => {
        if (isLowDataMode) {
            // Low Data Mode: Minimal vector 2D basemap
            return (effectiveSkin === 'default' || effectiveSkin === 'warm_cream')
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
    }, [activeRoute?.id, activeRoute?.destinationName, activeRoute?.totalDistance, activeRoute?.routeGeometry, activeRoute?.steps]);

    const routeCoordsRef = useRef<Location[]>([]);
    routeCoordsRef.current = routeCoords;
    const syncRouteLayersRef = useRef<() => void>(() => {});

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

                const isWarmLight = effectiveSkin === 'default' || effectiveSkin === 'warm_cream';

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

        // Move building numbers layers to the absolute top of the rendering stack above 3D extrusions
        if (map.current.getLayer('community-buildings-layer')) {
            try { map.current.moveLayer('community-buildings-layer'); } catch {}
        }
        if (map.current.getLayer('community-building-numbers')) {
            try { map.current.moveLayer('community-building-numbers'); } catch {}
        }
        if (map.current.getLayer('circle-homes-layer')) {
            try { map.current.moveLayer('circle-homes-layer'); } catch {}
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
        } else {
            try {
                // ==========================================
                // THEME OVERRIDES: Default (Fresh Daylight Aesthetic)
                // Restores clean ivory ground, blue water, sage parks, and crisp white roads
                // ==========================================
                if (map.current!.getLayer('background')) map.current!.setPaintProperty('background', 'background-color', '#f8f4f0');
                if (map.current!.getLayer('water')) map.current!.setPaintProperty('water', 'fill-color', '#c4e4f7');
                if (map.current!.getLayer('park')) map.current!.setPaintProperty('park', 'fill-color', '#d8ebd4');

                // Freeways: Crisp white fill with clean slate border casing
                const freewayFillLayers = ['road_mot_fill_noramp', 'road_mot_fill_ramp', 'bridge_mot_fill', 'tunnel_mot_fill', 'road_trunk_fill_noramp', 'road_trunk_fill_ramp', 'bridge_trunk_fill'];
                freewayFillLayers.forEach(id => {
                    if (map.current!.getLayer(id)) {
                        map.current!.setPaintProperty(id, 'line-color', '#ffffff');
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
                        map.current!.setPaintProperty(id, 'line-color', '#cbd5e1');
                        map.current!.setPaintProperty(id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, 6,
                            14, 7.5,
                            17, 9
                        ]);
                    }
                });

                // Primary & Secondary Arteries: Crisp white fill
                const arteryFillLayers = ['road_pri_fill_noramp', 'road_pri_fill_ramp', 'bridge_pri_fill', 'road_sec_fill_noramp', 'road_sec_fill_ramp', 'bridge_sec_fill'];
                arteryFillLayers.forEach(id => {
                    if (map.current!.getLayer(id)) {
                        map.current!.setPaintProperty(id, 'line-color', '#ffffff');
                        map.current!.setPaintProperty(id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, 2.5,
                            14, 3.5,
                            17, 4.5
                        ]);
                    }
                });

                // Minor & Residential Roads: Clean white
                if (map.current!.getLayer('road_minor_fill')) {
                    map.current!.setPaintProperty('road_minor_fill', 'line-color', '#ffffff');
                    map.current!.setPaintProperty('road_minor_fill', 'line-width', [
                        'interpolate', ['linear'], ['zoom'],
                        11, 1.2,
                        14, 1.6,
                        17, 2.0
                    ]);
                }
                if (map.current!.getLayer('road_service_fill')) {
                    map.current!.setPaintProperty('road_service_fill', 'line-color', '#f1f5f9');
                    map.current!.setPaintProperty('road_service_fill', 'line-width', [
                        'interpolate', ['linear'], ['zoom'],
                        12, 1.0,
                        16, 1.5
                    ]);
                }
            } catch (e) {
                console.warn('[MapLibre3DView] Error applying Default skin overrides:', e);
            }
        }

        // ==========================================
        // HIGH-CONTRAST HORIZONTAL ROAD LABELS ENGINE
        // ==========================================
        const isWarmLightSkin = effectiveSkin === 'default' || effectiveSkin === 'warm_cream';
        const style = map.current.getStyle();
        const vectorSourceId = Object.keys(style?.sources || {}).find(id => {
            return style?.sources?.[id]?.type === 'vector';
        }) || 'carto';

        const majorLabelsId = 'myway-road-labels-major';
        const minorLabelsId = 'myway-road-labels-minor';
        const defaultRoadLayers = ['roadname_minor', 'roadname_sec', 'roadname_pri', 'roadname_major'];
        
        // High-Contrast Palette: Crisp warm ivory (#fef9c3) on Dark with 2.8px Pure Black Halo (#000000, blur 0.5px)
        const roadTextColor = isWarmLightSkin ? '#111827' : isCarbonAmber ? '#fef9c3' : '#ffffff';
        const roadHaloColor = isWarmLightSkin ? '#ffffff' : '#000000';
        const roadHaloWidth = isWarmLightSkin ? 3.0 : isCarbonAmber ? 2.8 : 3.2;
        const roadHaloBlur = isCarbonAmber ? 0.5 : 0.3;

        // Configure default CARTO road label layers with high-contrast Carbon Amber styling
        defaultRoadLayers.forEach(id => {
            if (map.current!.getLayer(id)) {
                try {
                    map.current!.setLayoutProperty(id, 'visibility', 'visible');
                    map.current!.setLayoutProperty(id, 'text-field', ['get', 'name']);
                    map.current!.setLayoutProperty(id, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
                    map.current!.setPaintProperty(id, 'text-color', roadTextColor);
                    map.current!.setPaintProperty(id, 'text-halo-color', roadHaloColor);
                    map.current!.setPaintProperty(id, 'text-halo-width', roadHaloWidth);
                    map.current!.setPaintProperty(id, 'text-halo-blur', roadHaloBlur);
                } catch (e) {}
            }
        });

        // Purge legacy layers if lingering
        ['waze-style-road-labels', 'waze-road-labels-major', 'waze-road-labels-minor'].forEach(legacyId => {
            if (map.current!.getLayer(legacyId)) {
                try { map.current!.removeLayer(legacyId); } catch (e) {}
            }
        });

        // ==========================================
        // 1. MAJOR ROAD LABELS (Motorways, Trunk, Primary, Secondary)
        // ==========================================
        if (map.current.getLayer(majorLabelsId)) {
            try {
                map.current.setPaintProperty(majorLabelsId, 'text-color', roadTextColor);
                map.current.setPaintProperty(majorLabelsId, 'text-halo-color', roadHaloColor);
                map.current.setPaintProperty(majorLabelsId, 'text-halo-width', roadHaloWidth);
                map.current.setPaintProperty(majorLabelsId, 'text-halo-blur', roadHaloBlur);
                map.current.setLayoutProperty(majorLabelsId, 'symbol-spacing', 500);
                map.current.setLayoutProperty(majorLabelsId, 'text-padding', 20);
                map.current.setLayoutProperty(majorLabelsId, 'text-allow-overlap', false);
                map.current.setLayoutProperty(majorLabelsId, 'text-ignore-placement', false);
                map.current.setLayoutProperty(majorLabelsId, 'symbol-placement', 'line');
                map.current.setLayoutProperty(majorLabelsId, 'text-rotation-alignment', 'viewport');
                map.current.setLayoutProperty(majorLabelsId, 'text-pitch-alignment', 'viewport');
                map.current.setLayoutProperty(majorLabelsId, 'text-field', ['get', 'name']);
                map.current.setLayoutProperty(majorLabelsId, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
            } catch (e) {}
        } else {
            try {
                map.current.addLayer({
                    id: majorLabelsId,
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
                        'text-color': roadTextColor,
                        'text-halo-color': roadHaloColor,
                        'text-halo-width': roadHaloWidth,
                        'text-halo-blur': roadHaloBlur
                    }
                });
            } catch (e) {
                console.warn('[MapLibre] Failed to add major road labels layer:', e);
            }
        }

        // ==========================================
        // 2. MINOR ROAD LABELS (Tertiary, Residential, Service, Minor, Unclassified)
        // ==========================================
        if (map.current.getLayer(minorLabelsId)) {
            try {
                map.current.setPaintProperty(minorLabelsId, 'text-color', roadTextColor);
                map.current.setPaintProperty(minorLabelsId, 'text-halo-color', roadHaloColor);
                map.current.setPaintProperty(minorLabelsId, 'text-halo-width', roadHaloWidth);
                map.current.setPaintProperty(minorLabelsId, 'text-halo-blur', roadHaloBlur);
                map.current.setLayoutProperty(minorLabelsId, 'symbol-spacing', 450);
                map.current.setLayoutProperty(minorLabelsId, 'text-padding', 18);
                map.current.setLayoutProperty(minorLabelsId, 'text-allow-overlap', false);
                map.current.setLayoutProperty(minorLabelsId, 'text-ignore-placement', false);
                map.current.setLayoutProperty(minorLabelsId, 'symbol-placement', 'line');
                map.current.setLayoutProperty(minorLabelsId, 'text-rotation-alignment', 'viewport');
                map.current.setLayoutProperty(minorLabelsId, 'text-pitch-alignment', 'viewport');
                map.current.setLayoutProperty(minorLabelsId, 'text-field', ['get', 'name']);
                map.current.setLayoutProperty(minorLabelsId, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
            } catch (e) {}
        } else {
            try {
                map.current.addLayer({
                    id: minorLabelsId,
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
                        'text-color': roadTextColor,
                        'text-halo-color': roadHaloColor,
                        'text-halo-width': roadHaloWidth,
                        'text-halo-blur': roadHaloBlur
                    }
                });
            } catch (e) {
                console.warn('[MapLibre] Failed to add minor road labels layer:', e);
            }
        }

        layers.forEach((layer: any) => {
            if (layer.type === 'symbol' && layer.id !== majorLabelsId && layer.id !== minorLabelsId && !defaultRoadLayers.includes(layer.id)) {
                const id = layer.id.toLowerCase();
                const isEmergency = id.includes('hospital') || id.includes('police') || id.includes('emergency') || id.includes('ambulance') || id.includes('fire');
                const isGasOrStore = id.includes('gas') || id.includes('fuel') || id.includes('petrol') || id.includes('convenience') || id.includes('shop') || id.includes('store') || id.includes('commercial');
                const isPlaceOrPoi = isEmergency || isGasOrStore || id.includes('poi') || id.includes('place') || id.includes('park') || 
                                     id.includes('school') || id.includes('suburb') || id.includes('neighborhood');
                try {
                    if (isPlaceOrPoi) {
                        // Strict minzoom restraints: 12.5 for emergency (hospitals/police), 13.5 for gas stations and convenience stores/POIs
                        const poiMinZ = isEmergency ? 12.5 : 13.5;
                        try {
                            map.current!.setLayerZoomRange(layer.id, poiMinZ, 24);
                        } catch {}

                        // POI / Landmark Billboard Alignment & Dynamic Icon/Text Scaling
                        try {
                            map.current!.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
                            map.current!.setLayoutProperty(layer.id, 'text-rotation-alignment', 'viewport');
                            map.current!.setLayoutProperty(layer.id, 'text-padding', 3);
                            map.current!.setLayoutProperty(layer.id, 'text-size', [
                                'interpolate', ['linear'], ['zoom'],
                                poiMinZ, 0,
                                poiMinZ + 0.5, 10,
                                16, 13,
                                18, 15
                            ]);

                            // Dynamic Icon Scaling without hard pop-in
                            try {
                                map.current!.setLayoutProperty(layer.id, 'icon-size', [
                                    'interpolate', ['linear'], ['zoom'],
                                    poiMinZ, 0,
                                    poiMinZ + 0.5, 0.8,
                                    16, 1.2
                                ]);
                            } catch {}
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

            // Enhanced Railroad & Train Track Styling (Subtle authentic tracks, never harsh black roads)
            if (layer.id.includes('rail') || layer.id.includes('railway') || layer.id.includes('train')) {
                try {
                    map.current!.setLayoutProperty(layer.id, 'visibility', 'visible');
                    if (layer.type === 'line') {
                        const isDash = layer.id.includes('dash');
                        if (isWarmLightSkin) {
                            // Light Mode: Clean subtle light slate track with crisp white ties — eliminates black road appearance
                            map.current!.setPaintProperty(layer.id, 'line-color', isDash ? '#ffffff' : '#cbd5e1');
                            map.current!.setPaintProperty(layer.id, 'line-opacity', isDash ? 0.65 : 0.35);
                            map.current!.setPaintProperty(layer.id, 'line-width', [
                                'interpolate', ['linear'], ['zoom'],
                                10, 0.75,
                                14, 1.2,
                                17, 1.8
                            ]);
                        } else {
                            // Dark / Carbon Amber Mode: Muted slate tracks with subtle contrast
                            map.current!.setPaintProperty(layer.id, 'line-color', isDash ? '#334155' : '#1e293b');
                            map.current!.setPaintProperty(layer.id, 'line-opacity', isDash ? 0.5 : 0.4);
                            map.current!.setPaintProperty(layer.id, 'line-width', [
                                'interpolate', ['linear'], ['zoom'],
                                10, 0.75,
                                14, 1.2,
                                17, 1.8
                            ]);
                        }
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
            attributionControl: false,
            trackResize: false
        });
        map.current = mapInstance;
        if (typeof window !== 'undefined') {
            (window as any).mywayMap = mapInstance;
        }

        // Controlled debounced ResizeObserver to guarantee the WebGL canvas stretches to fill the screen,
        // ONLY after the CSS layout / orientation animation has completely stabilized.
        let resizeObserver: ResizeObserver | null = null;
        let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

        const performDebouncedResize = () => {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (!map.current) return;
                // Double requestAnimationFrame ensures browser compositor has finished layout reflows
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (map.current) {
                            map.current.resize();
                            syncRouteLayersRef.current();
                            // If navigating, immediately re-align camera on driver with updated landscape/portrait padding
                            const anim = puckInterpolationRef.current;
                            const coords = anim?.currentCoords || anim?.targetCoords || (latestLocationRef.current ? [latestLocationRef.current.lng, latestLocationRef.current.lat] : null);
                            if (isNavigatingRef.current && coords && map.current) {
                                const containerH = mapContainer.current?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
                                const containerW = mapContainer.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1000);
                                const isLandscape = containerW > containerH;
                                const navTopPadding = isLandscape ? Math.round(containerH * 0.42) : Math.round(containerH * 0.52);
                                map.current.easeTo({
                                    center: coords,
                                    bearing: prevBearingRef.current || 0,
                                    pitch: 60,
                                    padding: {
                                        top: navTopPadding,
                                        bottom: 0,
                                        left: isMobileRef.current ? 0 : 120,
                                        right: 0
                                    },
                                    duration: 300,
                                    easing: (t: number) => t
                                });
                            }
                        }
                    });
                });
            }, 180);
        };

        const handleOrientationChange = () => {
            performDebouncedResize();
        };
        window.addEventListener('orientationchange', handleOrientationChange, { passive: true });

        if (typeof window !== 'undefined' && window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                performDebouncedResize();
            });
            if (mapContainer.current) {
                resizeObserver.observe(mapContainer.current);
            }
        }

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
            if (Date.now() - lastMemberSelectTimeRef.current < 800) return;
            if (e && !e.originalEvent) return;
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
            const msg = (e?.error?.message || '').toLowerCase();
            const isFatalContextLoss = msg.includes('context lost') || msg.includes('gl_out_of_memory');

            if (!isFatalContextLoss) {
                console.warn('⚠️ MapLibre3DView: Non-fatal WebGL warning on map instance:', e.error);
                return;
            }

            console.warn('⚠️ MapLibre3DView: Fatal WebGL context error on map instance:', e.error);
            scheduleMapReboot();
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
                        map.current?.triggerRepaint();
                    }
                } catch {
                    scheduleMapReboot();
                }
            }
        };
        const ensureCommunityBuildingLayer = () => {
            if (!mapInstance || !mapInstance.isStyleLoaded()) return;

            // 1. Primary GeoJSON Source
            if (!mapInstance.getSource('community-buildings')) {
                try {
                    const cached = communityBuildingService.getAllBuildings();
                    const initialFeatures: GeoJSON.Feature[] = [];
                    cached.forEach(b => {
                        if (!b) return;
                        const bId = b.id || `${b.coordinates?.lat}_${b.coordinates?.lng}`;
                        const lat = b.coordinates?.lat ?? (b as any).lat;
                        const lng = b.coordinates?.lng ?? (b as any).lng;
                        const houseNumber = b.houseNumber || extractHouseNumber(b.address || '');
                        if (houseNumber && typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
                            initialFeatures.push({
                                type: 'Feature',
                                id: bId,
                                properties: {
                                    id: bId,
                                    houseNumber: String(houseNumber),
                                    house_number: String(houseNumber),
                                    housenumber: String(houseNumber),
                                    'addr:housenumber': String(houseNumber),
                                    label: b.address || `Building ${houseNumber}`
                                },
                                geometry: {
                                    type: 'Point',
                                    coordinates: [lng, lat]
                                }
                            });
                        }
                    });
                    mapInstance.addSource('community-buildings', {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: initialFeatures }
                    });
                } catch (err) {
                    console.warn('[MapLibre3DView] Error adding community-buildings source:', err);
                }
            }

            // 2. Pure WebGL Symbol Layer for House / Building Numbers
            if (!mapInstance.getLayer('community-buildings-layer')) {
                try {
                    mapInstance.addLayer({
                        id: 'community-buildings-layer',
                        type: 'symbol',
                        source: 'community-buildings',
                        minzoom: 16,
                        layout: {
                            'text-field': ['coalesce', ['get', 'houseNumber'], ['get', 'house_number'], ['get', 'housenumber'], ['get', 'addr:housenumber'], ''],
                            'text-size': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                15, 11,
                                18, 13,
                                20, 15
                            ],
                            'text-font': ['Open Sans Bold', 'Open Sans Regular', 'Arial Unicode MS Bold'],
                            'text-anchor': 'center',
                            'text-justify': 'center',
                            'text-pitch-alignment': 'viewport',
                            'text-rotation-alignment': 'viewport',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'text-optional': false
                        },
                        paint: {
                            'text-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
                            'text-halo-color': theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                            'text-halo-width': 2.0,
                            'text-halo-blur': 0.5
                        }
                    });
                } catch (layerErr) {
                    console.warn('[MapLibre3DView] Failed to add community-buildings-layer:', layerErr);
                }
            }

            // Move to absolute top of rendering stack above 3D building extrusions
            try {
                mapInstance.moveLayer('community-buildings-layer');
            } catch {}
        };

        const handleStyleLoaded = () => {
            if (mapInstance.isStyleLoaded()) {
                apply3DBuildingLayer();
                ensureCommunityBuildingLayer();
                setStyleVersion(v => v + 1);
            }
        };

        mapInstance.on('load', () => {
            currentStyleUrlRef.current = styleUrl;
            apply3DBuildingLayer();
            ensureCommunityBuildingLayer();

            setStyleVersion(v => v + 1);
            setIsMapReady(true);
            onMapReady?.();
        });

        // Only listen to style.load for full style switches to avoid recursive styledata loops
        mapInstance.on('style.load', handleStyleLoaded);
        mapInstance.once('idle', () => {
            apply3DBuildingLayer();
            ensureCommunityBuildingLayer();
        });

        // Track user interaction — suppress auto-camera for 5s after manual pan/zoom
        mapInstance.on('dragstart', (e: any) => {
            if (Date.now() - lastMemberSelectTimeRef.current < 800) return;
            onUserInteraction?.();
            userInteractedRef.current = Date.now();
        });
        mapInstance.on('zoomstart', (e: any) => {
            if (Date.now() - lastMemberSelectTimeRef.current < 800) return;
            if (e && e.originalEvent) {
                onUserInteraction?.();
                userInteractedRef.current = Date.now();
            }
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
            window.removeEventListener('orientationchange', handleOrientationChange);
            if (resizeTimeout) clearTimeout(resizeTimeout);
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
            membersMarkersRef.current.forEach(m => m.remove());
            membersMarkersRef.current.clear();
            clusterMarkersRef.current.forEach(m => m.remove());
            clusterMarkersRef.current.clear();
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
            if (typeof window !== 'undefined' && (window as any).mywayMap === mapInstance) {
                (window as any).mywayMap = null;
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
        const altSourceId = 'alternative-routes-source';
        const altCasingLayerId = 'alternative-routes-casing';
        const altLineLayerId = 'alternative-routes-line';
        const altHitboxLayerId = 'alternative-routes-hitbox';

        if (routeCoords.length < 2) {
            const routeSrc = map.current.getSource(routeId) as maplibregl.GeoJSONSource | undefined;
            const compSrc = map.current.getSource(completedId) as maplibregl.GeoJSONSource | undefined;
            const altSrc = map.current.getSource(altSourceId) as maplibregl.GeoJSONSource | undefined;
            if (routeSrc) routeSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            if (compSrc) compSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            if (altSrc) altSrc.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            return;
        }

        const isLightSkin = effectiveSkin === 'default' || effectiveSkin === 'warm_cream';
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
            : theme === 'dark'
                ? '#38bdf8' // Luminous Electric Blue in Dark Mode
                : '#2563eb'; // Vibrant Modern Electric Blue in Daylight

        const glowColor = isCarbonAmber 
            ? '#06b6d4' // Electric cyan luminous underglow accent
            : theme === 'dark'
                ? '#38bdf8' 
                : '#60a5fa'; // Soft radiant electric blue halo

        const casingColor = isCarbonAmber
            ? '#082f49'
            : theme === 'dark'
                ? '#0c4a6e'
                : '#1d4ed8'; // Refined royal navy casing — subtle contrast without harsh black

        // ZOOM-INTERPOLATED PROPORTIONAL LINE WIDTHS & BLUR
        // Proportional across zooms: clean and non-dominant when zoomed out, crisp and native when zoomed in
        const activeRouteLineWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 3,
            15, 6,
            18, 10
        ];

        const activeRouteCasingWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 5,
            15, 9,
            18, 14
        ];

        const activeRouteGlowWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 8,
            15, 14,
            18, 22
        ];

        const activeRouteGlowBlur = [
            'interpolate', ['linear'], ['zoom'],
            10, 2,
            15, 3.5,
            18, 5
        ];

        const activeRouteChevronWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 1.2,
            15, 2.5,
            18, 4
        ];

        const completedRouteWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 2.5,
            15, 5,
            18, 8
        ];

        const altLineWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 2.5,
            15, 5,
            18, 8
        ];

        const altCasingWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 4.5,
            15, 7.5,
            18, 11
        ];

        const altHitboxWidth = [
            'interpolate', ['linear'], ['zoom'],
            10, 16,
            15, 24,
            18, 32
        ];

        try {
            // 0. COMPLETED ROUTE LAYER (Rendered underneath active route)
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
                        'line-width': completedRouteWidth as any,
                        'line-opacity': 0.45
                    }
                });
            } else {
                map.current.setPaintProperty(completedId, 'line-color', theme === 'dark' ? '#475569' : '#94a3b8');
                map.current.setPaintProperty(completedId, 'line-width', completedRouteWidth as any);
                map.current.setPaintProperty(completedId, 'line-opacity', 0.45);
            }

            // 0b. ALTERNATIVE ROUTES (SECONDARY PATHS IN MUTED SLATE/SILVER)
            const secondaryRoutes = (alternativeRoutes || []).filter(r => {
                if (!r || !r.routeGeometry || r.routeGeometry.length < 2) return false;
                if (activeRoute && r.id && activeRoute.id && r.id === activeRoute.id) return false;
                if (activeRoute && activeRoute.routeGeometry && activeRoute.routeGeometry.length === r.routeGeometry.length) {
                    const firstA = activeRoute.routeGeometry[0];
                    const firstB = r.routeGeometry[0];
                    const midA = activeRoute.routeGeometry[Math.floor(activeRoute.routeGeometry.length / 2)];
                    const midB = r.routeGeometry[Math.floor(r.routeGeometry.length / 2)];
                    if (firstA && firstB && midA && midB && Math.abs(midA[0] - midB[0]) < 0.0001 && Math.abs(midA[1] - midB[1]) < 0.0001) {
                        return false;
                    }
                }
                return true;
            });

            const altFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = secondaryRoutes.map((r, idx) => ({
                type: 'Feature',
                properties: {
                    routeId: r.id || `alt_route_${idx}`,
                    index: idx,
                    summary: r.summary || 'Alternative Route',
                    totalTime: r.totalTime || '',
                    totalDistance: r.totalDistance || '',
                    routeType: r.routeType || 'alternative'
                },
                geometry: {
                    type: 'LineString',
                    coordinates: r.routeGeometry!
                }
            }));

            const altGeoJSON: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
                type: 'FeatureCollection',
                features: altFeatures
            };

            const existingAltSrc = map.current.getSource(altSourceId) as maplibregl.GeoJSONSource | undefined;
            if (existingAltSrc) {
                existingAltSrc.setData(altGeoJSON as any);
            } else {
                map.current.addSource(altSourceId, {
                    type: 'geojson',
                    data: altGeoJSON as any
                });
            }

            const altCasingColor = theme === 'dark' ? '#1e293b' : '#cbd5e1';
            const altLineColor = isCarbonAmber ? '#64748b' : theme === 'dark' ? '#64748b' : '#94a3b8';

            // Alternative casing layer
            if (!map.current.getLayer(altCasingLayerId)) {
                map.current.addLayer({
                    id: altCasingLayerId,
                    type: 'line',
                    source: altSourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': altCasingColor,
                        'line-width': altCasingWidth as any,
                        'line-opacity': 0.65,
                        'line-blur': 0.5
                    }
                });
            } else {
                map.current.setPaintProperty(altCasingLayerId, 'line-color', altCasingColor);
                map.current.setPaintProperty(altCasingLayerId, 'line-width', altCasingWidth as any);
                map.current.setPaintProperty(altCasingLayerId, 'line-opacity', 0.65);
                map.current.setPaintProperty(altCasingLayerId, 'line-blur', 0.5);
            }

            // Alternative line layer
            if (!map.current.getLayer(altLineLayerId)) {
                map.current.addLayer({
                    id: altLineLayerId,
                    type: 'line',
                    source: altSourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': altLineColor,
                        'line-width': altLineWidth as any,
                        'line-opacity': 0.8
                    }
                });
            } else {
                map.current.setPaintProperty(altLineLayerId, 'line-color', altLineColor);
                map.current.setPaintProperty(altLineLayerId, 'line-width', altLineWidth as any);
                map.current.setPaintProperty(altLineLayerId, 'line-opacity', 0.8);
            }

            // Alternative hitbox layer (wide transparent line for touch & click)
            if (!map.current.getLayer(altHitboxLayerId)) {
                map.current.addLayer({
                    id: altHitboxLayerId,
                    type: 'line',
                    source: altSourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#000000',
                        'line-width': altHitboxWidth as any,
                        'line-opacity': 0.001
                    }
                });
            } else {
                map.current.setPaintProperty(altHitboxLayerId, 'line-width', altHitboxWidth as any);
            }

            // 1. UPDATE OR ADD ACTIVE ROUTE SOURCE
            const existingRouteSrc = map.current.getSource(routeId) as maplibregl.GeoJSONSource | undefined;
            if (existingRouteSrc) {
                existingRouteSrc.setData(activeRouteGeoJSON as any);
            } else {
                map.current.addSource(routeId, {
                    type: 'geojson',
                    data: activeRouteGeoJSON as any
                });
            }

            // 2. ADD / UPDATE GLOW LAYER (Bottom glow layer with soft blur)
            if (!map.current.getLayer(`${routeId}-glow`)) {
                map.current.addLayer({
                    id: `${routeId}-glow`,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': glowColor,
                        'line-width': activeRouteGlowWidth as any,
                        'line-blur': activeRouteGlowBlur as any,
                        'line-opacity': 0.45
                    }
                });
            } else {
                map.current.setPaintProperty(`${routeId}-glow`, 'line-color', glowColor);
                map.current.setPaintProperty(`${routeId}-glow`, 'line-width', activeRouteGlowWidth as any);
                map.current.setPaintProperty(`${routeId}-glow`, 'line-blur', activeRouteGlowBlur as any);
                map.current.setPaintProperty(`${routeId}-glow`, 'line-opacity', 0.45);
            }

            // 3. ADD / UPDATE CASING LAYER (Subtle contrasting casing with softened edge)
            if (!map.current.getLayer(`${routeId}-casing`)) {
                map.current.addLayer({
                    id: `${routeId}-casing`,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': casingColor,
                        'line-width': activeRouteCasingWidth as any,
                        'line-opacity': 0.85,
                        'line-blur': 0.5
                    }
                });
            } else {
                map.current.setPaintProperty(`${routeId}-casing`, 'line-color', casingColor);
                map.current.setPaintProperty(`${routeId}-casing`, 'line-width', activeRouteCasingWidth as any);
                map.current.setPaintProperty(`${routeId}-casing`, 'line-opacity', 0.85);
                map.current.setPaintProperty(`${routeId}-casing`, 'line-blur', 0.5);
            }

            // 4. ADD / UPDATE MAIN GUIDELINE LAYER (Zoom-interpolated Electric Blue guideline)
            if (!map.current.getLayer(routeId)) {
                map.current.addLayer({
                    id: routeId,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': primaryRouteColor,
                        'line-width': activeRouteLineWidth as any,
                        'line-opacity': 0.98
                    }
                });
            } else {
                map.current.setPaintProperty(routeId, 'line-color', primaryRouteColor);
                map.current.setPaintProperty(routeId, 'line-width', activeRouteLineWidth as any);
                map.current.setPaintProperty(routeId, 'line-opacity', 0.98);
            }

            // 4b. ADD / UPDATE DIRECTIONAL CHEVRON ACCENT LAYER (White turn flow on center line)
            if (!map.current.getLayer(`${routeId}-chevrons`)) {
                map.current.addLayer({
                    id: `${routeId}-chevrons`,
                    type: 'line',
                    source: routeId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#ffffff',
                        'line-width': activeRouteChevronWidth as any,
                        'line-dasharray': [0.4, 2.6],
                        'line-opacity': 0.85
                    }
                });
            } else {
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-color', '#ffffff');
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-width', activeRouteChevronWidth as any);
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-dasharray', [0.4, 2.6]);
                map.current.setPaintProperty(`${routeId}-chevrons`, 'line-opacity', 0.85);
            }


            // 5. PROMINENT Z-ORDERING: Move active route guideline layers to the top of line stack
            try {
                if (map.current.getLayer(completedId)) map.current.moveLayer(completedId);
                if (map.current.getLayer(altCasingLayerId)) map.current.moveLayer(altCasingLayerId);
                if (map.current.getLayer(altLineLayerId)) map.current.moveLayer(altLineLayerId);
                if (map.current.getLayer(`${routeId}-glow`)) map.current.moveLayer(`${routeId}-glow`);
                if (map.current.getLayer(`${routeId}-casing`)) map.current.moveLayer(`${routeId}-casing`);
                if (map.current.getLayer(routeId)) map.current.moveLayer(routeId);
                if (map.current.getLayer(`${routeId}-chevrons`)) map.current.moveLayer(`${routeId}-chevrons`);
            } catch {}
        } catch (err) {
            console.warn('[MapLibre3DView] Error syncing route layers:', err);
        }
    }, [routeCoords, splitIndex, mapSkin, effectiveSkin, theme, alternativeRoutes, activeRoute]);

    // Keep ref synchronized
    syncRouteLayersRef.current = syncRouteLayers;

    // Trigger route layers sync whenever route, split index, map state, or skin changes
    useEffect(() => {
        if (!map.current || !isMapReady) return;
        syncRouteLayers();

        const onMapData = () => {
            if (!map.current || !map.current.isStyleLoaded()) return;
            syncRouteLayers();
        };
        map.current.on('style.load', onMapData);
        map.current.on('styledata', onMapData);
        map.current.on('idle', onMapData);

        return () => {
            if (map.current) {
                map.current.off('style.load', onMapData);
                map.current.off('styledata', onMapData);
                map.current.off('idle', onMapData);
            }
        };
    }, [syncRouteLayers, isMapReady, styleVersion]); 

    // Interactive selection for alternative route lines on map
    useEffect(() => {
        if (!map.current || !isMapReady) return;
        const currentMap = map.current;

        const handleAltClick = (e: maplibregl.MapLayerMouseEvent) => {
            if (!e.features || e.features.length === 0) return;
            const clickedFeature = e.features[0];
            const routeId = clickedFeature.properties?.routeId;
            const routeSummary = clickedFeature.properties?.summary;

            const selected = (alternativeRoutes || []).find(r => 
                (r.id && r.id === routeId) || 
                (r.summary && r.summary === routeSummary)
            );
            if (selected && onSelectAlternativeRoute) {
                const foundIdx = (alternativeRoutes || []).indexOf(selected);
                onSelectAlternativeRoute(selected, foundIdx !== -1 ? foundIdx : 0);
            }
        };

        const handleMouseEnter = () => {
            if (currentMap) currentMap.getCanvas().style.cursor = 'pointer';
        };

        const handleMouseLeave = () => {
            if (currentMap) currentMap.getCanvas().style.cursor = '';
        };

        currentMap.on('click', 'alternative-routes-hitbox', handleAltClick);
        currentMap.on('mouseenter', 'alternative-routes-hitbox', handleMouseEnter);
        currentMap.on('mouseleave', 'alternative-routes-hitbox', handleMouseLeave);

        return () => {
            if (currentMap) {
                try {
                    currentMap.off('click', 'alternative-routes-hitbox', handleAltClick);
                    currentMap.off('mouseenter', 'alternative-routes-hitbox', handleMouseEnter);
                    currentMap.off('mouseleave', 'alternative-routes-hitbox', handleMouseLeave);
                } catch (e) { /* ignore cleanup on unmounted map */ }
            }
        };
    }, [isMapReady, alternativeRoutes, onSelectAlternativeRoute]); 

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
                    
                    <!-- Pin Needle Pointer (Seamlessly anchored to pill with matching border & placeColor) -->
                    <svg width="14" height="9" viewBox="0 0 14 9" style="
                        display: block;
                        margin-top: -2.5px;
                        z-index: 1;
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45));
                        overflow: visible;
                    ">
                        <polygon points="1,0 7,8 13,0" fill="#7c3aed" />
                        <polyline points="1,0 7,8 13,0" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>

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
                    padding: isMobileRef.current 
                        ? { top: 60, bottom: 260, left: 30, right: 30 }
                        : { top: 80, bottom: 80, left: 320, right: 80 },
                    duration: 900,
                    maxZoom: 16
                });
            } catch (e) {
                console.warn('[MapLibre] fitBounds error:', e);
            }
        }
    }, [activeRoute?.destinationName, activeRoute?.totalDistance, isNavigating, isMapReady]);

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

        const candidatePlaces = [...(places || [])];
        if (savedPlaces && savedPlaces.length > 0) {
            savedPlaces.forEach(sp => {
                if (sp && sp.id && !candidatePlaces.some(cp => cp.id === sp.id)) {
                    candidatePlaces.push({ ...sp, isSaved: true });
                }
            });
        }

        const validPlaces = candidatePlaces.filter(p => 
            p && 
            p.id &&
            p.location && 
            typeof p.location.lat === 'number' && 
            typeof p.location.lng === 'number' && 
            !(p.location.lat === 0 && p.location.lng === 0) &&
            !p.id?.startsWith('building_') &&
            !p.id?.startsWith('comm_bld_') &&
            !p.id?.startsWith('place_bld_') &&
            !p.id?.startsWith('community_') &&
            !p.id?.startsWith('rooftop_')
        );
        const currentPlaceIds = new Set(validPlaces.map(p => p.id));

        // Evaluate place occupants across circle members and local user
        const effectiveMembers = getEffectiveMembersWithSelf(
            members,
            userLocation,
            currentUserId,
            userProfile,
            isNavigating
        );
        const { placeOccupantsMap } = computePlaceOccupants(
            (savedPlaces && savedPlaces.length > 0) ? savedPlaces : places,
            effectiveMembers,
            currentUserId,
            isNavigating
        );

        // Remove old place markers
        for (const [id, marker] of placesMarkersRef.current.entries()) {
            if (!currentPlaceIds.has(id)) {
                marker.remove();
                placesMarkersRef.current.delete(id);
            }
        }

        // Add or update place markers
        validPlaces.forEach(place => {
            const isHome = isHomePlace(place);
            const placeColor = getPlaceColor(place);
            const isSelected = !!selectedPlaceId && selectedPlaceId === place.id;
            const isSearchResult = place.type === 'search_result' || (place.id && (place.id.startsWith('photon-') || place.id.startsWith('nominatim-') || place.id.startsWith('google-')));
            const isSavedPlace = Boolean(
                place.isSaved === true ||
                (!isSearchResult && (
                    place.type === 'home' ||
                    place.type === 'work' ||
                    place.type === 'school' ||
                    place.type === 'gym' ||
                    place.type === 'saved' ||
                    place.type === 'favorite' ||
                    place.type === 'custom'
                )) ||
                (savedPlaces && savedPlaces.some(sp => sp && (
                    sp.id === place.id ||
                    (sp.location && place.location &&
                     Math.abs(sp.location.lat - place.location.lat) < 0.0001 &&
                     Math.abs(sp.location.lng - place.location.lng) < 0.0001)
                )))
            );
            const iconSvg = getPlaceIconSvg(place, isSelected, 'w-4 h-4 text-white');

            const isAmbient = !!place.isAmbient;
            const isDark = theme === 'dark';
            const textColor = isDark ? '#94a3b8' : '#475569';
            const haloColor = isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.9)';

            // Place occupant cluster badge & label
            const occupants = placeOccupantsMap.get(place.id) || [];
            let occupantClusterHtml = '';
            let occupantsLabelHtml = '';

            if (occupants.length > 0) {
                const maxVisibleAvatars = 3;
                const visibleOccupants = occupants.slice(0, maxVisibleAvatars);
                const overflowCount = occupants.length - maxVisibleAvatars;

                const avatarStack = visibleOccupants.map((occ, i) => {
                    const isSelfOcc = checkIsMemberSelf(occ.id, currentUserId);
                    const occName = isSelfOcc ? 'You' : (occ.name || 'Member');
                    const occInitial = occName.charAt(0).toUpperCase();
                    const hasAvatar = occ.avatar && !occ.avatar.includes('default');
                    const marginLeft = i === 0 ? '0' : '-8px';
                    const zIndex = 10 - i;
                    const occBorderColor = isSelfOcc ? '#a855f7' : (occ.circleColor || '#6366f1');

                    return `
                        <div class="myway-place-occupant-avatar" data-member-id="${occ.id}" title="${occName}" style="
                            position: relative;
                            z-index: ${zIndex};
                            margin-left: ${marginLeft};
                            width: 26px;
                            height: 26px;
                            border-radius: 50%;
                            border: 2px solid ${isDark ? '#0f172a' : '#ffffff'};
                            background: #0f172a;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.45);
                            overflow: hidden;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                            cursor: ${isSelfOcc ? 'default' : 'pointer'};
                            transition: transform 0.15s ease;
                        ">
                            ${hasAvatar 
                                ? `<img src="${occ.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` 
                                : ''}
                            <span style="${hasAvatar ? 'display: none;' : 'display: flex;'} font-weight: 900; color: #ffffff; font-size: 11px;">${occInitial}</span>
                            <div style="position: absolute; bottom: 0; right: 0; width: 6px; height: 6px; border-radius: 50%; background: ${occBorderColor}; border: 1px solid #ffffff;"></div>
                        </div>
                    `;
                }).join('');

                const overflowBadge = overflowCount > 0 ? `
                    <div style="
                        margin-left: -6px;
                        z-index: 1;
                        width: 22px;
                        height: 22px;
                        border-radius: 50%;
                        background: #1e293b;
                        border: 1.5px solid ${isDark ? '#0f172a' : '#ffffff'};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 9px;
                        font-weight: 900;
                        color: #ffffff;
                        flex-shrink: 0;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.45);
                    ">+${overflowCount}</div>
                ` : '';

                occupantClusterHtml = `
                    <div class="myway-place-occupants-badge select-none" style="
                        position: absolute;
                        top: -20px;
                        display: flex;
                        align-items: center;
                        padding: 2px 4px 2px 4px;
                        border-radius: 9999px;
                        background: ${isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.96)'};
                        border: 1.5px solid ${isHome ? '#8b5cf6' : placeColor};
                        box-shadow: 0 4px 12px rgba(0,0,0,0.45);
                        z-index: 15;
                        animation: fadeIn 0.2s ease-out;
                    ">
                        <div style="
                            width: 6px;
                            height: 6px;
                            border-radius: 50%;
                            background: #10b981;
                            margin-right: 4px;
                            margin-left: 2px;
                            box-shadow: 0 0 6px #10b981;
                            animation: marker-steady-pulse 1.8s ease-in-out infinite;
                            flex-shrink: 0;
                        "></div>
                        ${avatarStack}
                        ${overflowBadge}
                    </div>
                `;

                const occNames = occupants.map(m => checkIsMemberSelf(m.id, currentUserId) ? 'You' : (m.name || 'Member').split(' ')[0]);
                let occupantsSummary = '';
                if (occupants.length === 1) {
                    occupantsSummary = occNames[0] === 'You' ? 'You are here' : `${occNames[0]} is here`;
                } else if (occupants.length === 2) {
                    occupantsSummary = `${occNames[0]} & ${occNames[1]} are here`;
                } else {
                    occupantsSummary = `${occupants.length} here`;
                }

                occupantsLabelHtml = `
                    <div style="
                        margin-top: 3px;
                        padding: 2px 8px;
                        background: ${isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)'};
                        color: ${isDark ? '#f8fafc' : '#0f172a'};
                        border: 1px solid #10b98166;
                        border-radius: 9999px;
                        font-size: 10px;
                        font-weight: 800;
                        white-space: nowrap;
                        max-width: 180px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
                        pointer-events: none;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    ">
                        <span style="color: #10b981;">●</span>
                        <span>${occupantsSummary}</span>
                    </div>
                `;
            }

            // Determine strict minzoom for POIs while protecting critical markers:
            // - Circle members (rendered in separate memberMarkersRef with no minzoom)
            // - User's Home base (isHome -> minzoom 0)
            // - Occupied places (occupants.length > 0 -> minzoom 0)
            // - Selected place (isSelected -> minzoom 0)
            // - Active search results (isSearchResult -> minzoom 0)
            // - Custom saved circle places (!isAmbient -> minzoom 0)
            // - Hazards (incidents/reports -> minzoom 0)
            const isEmergency = place.type === 'hospital' || place.type === 'emergency' || place.type === 'police' || place.type === 'fire_station';
            const isGasOrStore = place.type === 'gas' || place.type === 'grocery' || place.type === 'convenience' || place.type === 'coffee' || place.type === 'food';
            
            let markerMinZoom = 0;
            if (isAmbient && !isHome && !isSelected && !isSearchResult && occupants.length === 0) {
                markerMinZoom = isEmergency ? 12.5 : 13.5;
            }

            const homePinCoords: Location = (isHome && userProfile?.preciseHomeLocation && typeof userProfile.preciseHomeLocation.lat === 'number' && typeof userProfile.preciseHomeLocation.lng === 'number' && !(userProfile.preciseHomeLocation.lat === 0 && userProfile.preciseHomeLocation.lng === 0))
                ? { lat: userProfile.preciseHomeLocation.lat, lng: userProfile.preciseHomeLocation.lng }
                : (place.originalLocation && typeof place.originalLocation.lat === 'number' && typeof place.originalLocation.lng === 'number' && !(place.originalLocation.lat === 0 && place.originalLocation.lng === 0))
                    ? place.originalLocation
                    : place.location;

            // Strict point coordinate anchoring:
            const markerLoc = isHome
                ? homePinCoords
                : (place.originalLocation && typeof place.originalLocation.lat === 'number' && typeof place.originalLocation.lng === 'number' && !(place.originalLocation.lat === 0 && place.originalLocation.lng === 0))
                    ? place.originalLocation
                    : place.location;

            // Visual Offset for Identical Coordinates:
            // If a reactive search pin's coordinate is an exact match to a savedPlace (like Home),
            // apply a slight CSS offset translate(10px, -10px) so it peeks out from behind the saved pin.
            const referenceSavedPlaces = (savedPlaces && savedPlaces.length > 0) 
                ? savedPlaces 
                : places.filter(p => p.type !== 'search_result' && !p.id.startsWith('photon-') && !p.id.startsWith('nominatim-') && !p.id.startsWith('google-'));

            const isOverlappingSaved = Boolean(
                isSearchResult && 
                markerLoc && 
                referenceSavedPlaces.some(sp => {
                    if (!sp || sp.id === place.id) return false;
                    const spLoc = isHomePlace(sp) && userProfile?.preciseHomeLocation && typeof userProfile.preciseHomeLocation.lat === 'number' && !(userProfile.preciseHomeLocation.lat === 0 && userProfile.preciseHomeLocation.lng === 0)
                        ? userProfile.preciseHomeLocation
                        : (sp.originalLocation || sp.location);
                    if (!spLoc || typeof spLoc.lat !== 'number' || typeof spLoc.lng !== 'number') return false;
                    const dLat = Math.abs(spLoc.lat - markerLoc.lat);
                    const dLng = Math.abs(spLoc.lng - markerLoc.lng);
                    return dLat < 0.00012 && dLng < 0.00012;
                })
            );

            const offsetTransform = isOverlappingSaved ? 'transform: translate(10px, -10px);' : '';

            const markerHtml = isAmbient ? `
                <div class="marker-content myway-ambient-poi-text" style="display: flex; align-items: center; justify-content: center; padding: 2px 4px; pointer-events: auto; user-select: none; transition: transform 0.15s ease, opacity 0.15s ease; transform-origin: center center;">
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
                <div class="marker-content" style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer; pointer-events: auto; touch-action: manipulation; transition: transform 0.15s ease, opacity 0.15s ease; transform-origin: bottom center; ${offsetTransform}">
                    ${isSelected && isSavedPlace ? `
                        <div class="myway-place-geofence-radius" style="
                            position: absolute;
                            inset: -5px;
                            border-radius: 9999px;
                            background: rgba(168, 85, 247, 0.3);
                            border: 2px solid #a855f7;
                            animation: marker-steady-pulse 2.2s ease-in-out infinite;
                            pointer-events: none;
                        "></div>
                    ` : ''}
                    ${place.type === 'parked_vehicle' ? `
                        <div class="myway-parked-vehicle-radius" style="
                            position: absolute;
                            inset: -14px;
                            border-radius: 9999px;
                            background: rgba(6, 182, 212, 0.14);
                            border: 1.5px dashed #06b6d4;
                            box-shadow: 0 0 12px rgba(6, 182, 212, 0.25);
                            animation: marker-steady-pulse 2.4s ease-in-out infinite;
                            pointer-events: none;
                        "></div>
                    ` : ''}
                    ${occupantClusterHtml}
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
                        gap: 5px;
                        transition: transform 0.15s ease;
                    ">
                        <span style="display: inline-flex; align-items: center; justify-content: center; line-height: 1;" class="shrink-0">${iconSvg}</span>
                        ${isHome ? `
                            <span style="font-size: 13px; font-weight: 700; color: #ffffff; white-space: nowrap; text-align: center; letter-spacing: -0.2px;">Home</span>
                        ` : place.type === 'parked_vehicle' ? `
                            <span style="font-size: 12px; font-weight: 700; color: #ffffff; white-space: nowrap; text-align: center; letter-spacing: -0.2px;">Parked</span>
                        ` : ''}
                        ${place.isCorrected ? `
                            <div style="position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 50%; background: #f59e0b; border: 1.5px solid #ffffff; display: flex; align-items: center; justify-content: center; font-size: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.4);" title="Verified Entrance Pin">
                                ⭐
                            </div>
                        ` : ''}
                    </div>
                    <!-- Pin Needle Pointer (Seamlessly anchored to pill with matching border & placeColor) -->
                    <svg width="14" height="9" viewBox="0 0 14 9" style="
                        display: block;
                        margin-top: -2.5px;
                        z-index: 1;
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45));
                        overflow: visible;
                    ">
                        <polygon points="1,0 7,8 13,0" fill="${placeColor}" />
                        <polyline points="1,0 7,8 13,0" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <!-- Label Pill for Occupants, Search Results, or Selected Places -->
                    ${occupantsLabelHtml ? occupantsLabelHtml : ((isSelected || place.type === 'parked_vehicle' || (isSearchResult && place.isRooftop !== false)) && !isHome ? `
                        <div style="
                            margin-top: 3px;
                            padding: 2px 10px;
                            background: ${place.type === 'parked_vehicle' ? (isDark ? 'rgba(6, 182, 212, 0.18)' : 'rgba(6, 182, 212, 0.15)') : (isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)')};
                            color: ${place.type === 'parked_vehicle' ? '#06b6d4' : (isDark ? '#f8fafc' : '#0f172a')};
                            border: 1px solid ${place.type === 'parked_vehicle' ? '#06b6d4' : (isSelected ? '#a855f7' : (isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)'))};
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
                    ` : '')}
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
                el.style.pointerEvents = 'auto';
                el.style.touchAction = 'manipulation';
                el.dataset.minzoom = String(markerMinZoom);
                el.style.zIndex = isSelected ? '60' : isSearchResult ? (isOverlappingSaved ? '24' : '35') : isAmbient ? '10' : '25';
                el.innerHTML = markerHtml;
                (el as any)._lastHtml = markerHtml;
                (el as any)._place = place;

                let touchStartX = 0;
                let touchStartY = 0;
                let isTouchTap = false;
                let lastSelectTime = 0;

                const handlePlaceSelection = (e: Event) => {
                    const now = Date.now();
                    if (now - lastSelectTime < 300) return;
                    lastSelectTime = now;

                    const target = e.target as HTMLElement;
                    const avatarEl = target.closest('.myway-place-occupant-avatar') as HTMLElement | null;
                    if (avatarEl && avatarEl.dataset.memberId) {
                        e.stopPropagation();
                        if ((e as any).originalEvent?.stopPropagation) {
                            (e as any).originalEvent.stopPropagation();
                        }
                        lastMemberSelectTimeRef.current = Date.now();
                        // Do not open member detail card if occupant avatar is the current user
                        if (checkIsMemberSelf(avatarEl.dataset.memberId, currentUserId)) {
                            return;
                        }
                        onSelectMemberRef.current?.(avatarEl.dataset.memberId);
                        return;
                    }
                    const targetPlace = (el as any)._place || place;
                    console.log('Place clicked:', targetPlace);
                    onSelectPlaceRef.current?.(targetPlace);
                };

                el.addEventListener('touchstart', (e: TouchEvent) => {
                    if (e.touches.length === 1) {
                        touchStartX = e.touches[0].clientX;
                        touchStartY = e.touches[0].clientY;
                        isTouchTap = true;
                    }
                }, { passive: true });

                el.addEventListener('touchend', (e: TouchEvent) => {
                    if (!isTouchTap) return;
                    const touch = e.changedTouches[0];
                    if (touch) {
                        const dx = Math.abs(touch.clientX - touchStartX);
                        const dy = Math.abs(touch.clientY - touchStartY);
                        if (dx < 12 && dy < 12) {
                            e.stopPropagation();
                            handlePlaceSelection(e);
                        }
                    }
                    isTouchTap = false;
                });

                el.addEventListener('click', (e: MouseEvent) => {
                    e.stopPropagation();
                    handlePlaceSelection(e);
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
                if (markerLoc && typeof markerLoc.lat === 'number' && typeof markerLoc.lng === 'number') {
                    marker = new maplibregl.Marker({ element: el, anchor })
                        .setLngLat([markerLoc.lng, markerLoc.lat])
                        .addTo(map.current!);
                    placesMarkersRef.current.set(place.id, marker);
                }
            } else {
                const el = marker.getElement();
                (el as any)._place = place;
                el.style.pointerEvents = 'auto';
                el.style.touchAction = 'manipulation';
                if ((el as any)._lastHtml !== markerHtml) {
                    el.innerHTML = markerHtml;
                    (el as any)._lastHtml = markerHtml;
                }
                el.dataset.minzoom = String(markerMinZoom);
                el.style.zIndex = isSelected ? '60' : isSearchResult ? (isOverlappingSaved ? '24' : '35') : isAmbient ? '10' : '25';

                if (markerLoc && typeof markerLoc.lat === 'number' && typeof markerLoc.lng === 'number') {
                    marker.setLngLat([markerLoc.lng, markerLoc.lat]);
                }
            }
        });

        // Dynamic smooth scaling & visibility updater for POI markers based on map zoom
        // Applies scale & opacity strictly to innerContent child to preserve MapLibre's root translate matrix
        const updatePoiMarkerVisibility = () => {
            if (!map.current) return;
            const currentZoom = map.current.getZoom();
            for (const [id, marker] of placesMarkersRef.current.entries()) {
                const el = marker.getElement();
                if (!el) continue;
                const innerContent = (el.firstElementChild || el.querySelector('.marker-content')) as HTMLElement | null;
                if (!innerContent) continue;

                const minZStr = el.dataset.minzoom;
                if (!minZStr) continue;
                const minZ = parseFloat(minZStr);
                if (minZ === 0) {
                    el.style.display = 'flex';
                    innerContent.style.opacity = '1';
                    innerContent.style.transform = 'scale(1)';
                    continue;
                }

                if (currentZoom < minZ) {
                    el.style.display = 'none';
                } else {
                    el.style.display = 'flex';
                    // Smooth zoom scaling between minZ and minZ + 1.5 without abrupt pop-in
                    const zoomDelta = currentZoom - minZ;
                    const scale = Math.min(1.15, Math.max(0.65, 0.65 + (zoomDelta / 1.5) * 0.5));
                    const opacity = Math.min(1, Math.max(0.2, zoomDelta / 0.5));
                    innerContent.style.opacity = String(opacity);
                    innerContent.style.transform = `scale(${scale.toFixed(2)})`;
                }
            }
        };

        updatePoiMarkerVisibility();

        const onZoom = () => updatePoiMarkerVisibility();
        map.current.on('zoom', onZoom);
        return () => {
            map.current?.off('zoom', onZoom);
        };
    }, [places, savedPlaces, isMapReady, theme, styleVersion, onSelectPlace, selectedPlaceId, members, userLocation?.lat, userLocation?.lng, currentUserId, userProfile?.displayName, userProfile?.photoURL, isNavigating, onSelectMember]);

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
                minzoom: 13.5,
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
                minzoom: 13.5,
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
                minzoom: 13.5,
                layout: {
                    'text-field': ['get', 'icon'],
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        13.5, 0,
                        14, 11,
                        16, 14
                    ],
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                }
            });

            // 4. Detour & Name Label
            map.current.addLayer({
                id: 'ambient-maintenance-label',
                type: 'symbol',
                source: sourceId,
                minzoom: 13.5,
                layout: {
                    'text-field': ['get', 'label'],
                    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        13.5, 0,
                        14, 9,
                        16, 11
                    ],
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
                    if (place) onSelectPlaceRef.current?.(place);
                }
            });

            map.current.on('mouseenter', 'ambient-maintenance-badge', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
            map.current.on('mouseleave', 'ambient-maintenance-badge', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
        }
    }, [maintenancePlaces, onSelectPlace, isMapReady, styleVersion, theme]);

    // ==========================================
    // UNIFIED WEBGL GEOFENCE POLYGONS & HYSTERESIS BUFFER
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady || !map.current.isStyleLoaded()) return;

        const sourceId = 'places-geofences-source';
        const entranceBoxSourceId = 'places-entrance-boxes-source';
        const hysteresisSourceId = 'places-geofences-hysteresis-source';

        const circleFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
        const entranceBoxFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
        const hysteresisFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];

        // Synthesize full member roster including active local user
        const effectiveMembers = getEffectiveMembersWithSelf(
            members,
            userLocation,
            currentUserId,
            userProfile,
            isNavigating
        );

        // Only evaluate geofences and entrance boxes for genuinely SAVED places (never temporary search results or ambient POIs)
        const sourceList = (savedPlaces && savedPlaces.length > 0) ? savedPlaces : places;
        const placesToEvaluate = sourceList.filter(place => {
            if (!place) return false;
            if (place.type === 'parked_vehicle') return true;
            if (place.isAmbient) return false;
            if (place.isSaved === false) return false;
            if (place.type === 'search_result') return false;
            if (place.id && (
                place.id.startsWith('search-') ||
                place.id.startsWith('photon-') ||
                place.id.startsWith('nominatim-') ||
                place.id.startsWith('google-') ||
                place.id.startsWith('overpass-') ||
                place.id.startsWith('temp-') ||
                place.id.startsWith('discovered-') ||
                place.id.startsWith('building_') ||
                place.id.startsWith('comm_bld_') ||
                place.id.startsWith('place_bld_') ||
                place.id.startsWith('community_') ||
                place.id.startsWith('rooftop_')
            )) return false;

            if (savedPlaces && savedPlaces.length > 0) {
                const isMatch = savedPlaces.some(sp => sp.id === place.id || (
                    sp.location && place.location &&
                    Math.abs(sp.location.lat - place.location.lat) < 0.0001 &&
                    Math.abs(sp.location.lng - place.location.lng) < 0.0001
                ));
                if (!isMatch) return false;
            }

            return Boolean(
                (place.location && typeof place.location.lat === 'number' && typeof place.location.lng === 'number' && !(place.location.lat === 0 && place.location.lng === 0)) ||
                (isHomePlace(place) && userProfile?.preciseHomeLocation && typeof userProfile.preciseHomeLocation.lat === 'number' && typeof userProfile.preciseHomeLocation.lng === 'number' && !(userProfile.preciseHomeLocation.lat === 0 && userProfile.preciseHomeLocation.lng === 0)) ||
                (place.originalLocation && typeof place.originalLocation.lat === 'number' && typeof place.originalLocation.lng === 'number' && !(place.originalLocation.lat === 0 && place.originalLocation.lng === 0)) ||
                (place.entrancePrecision?.location && typeof place.entrancePrecision.location.lat === 'number')
            );
        });

        placesToEvaluate.forEach(place => {
            if (place.type === 'parked_vehicle') {
                if (!place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') return;
                const parkedRadiusKm = (place.radius && place.radius > 5) ? place.radius / 1000 : (place.radius || 0.025);
                const circleCoords = getCircleCoords(place.location, parkedRadiusKm, 64);
                circleFeatures.push({
                    type: 'Feature' as const,
                    id: place.id,
                    properties: { id: place.id, name: place.name, isParked: true },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [circleCoords]
                    }
                });
                return;
            }

            const isHome = isHomePlace(place);

            // Strict point coordinate anchoring:
            // The circular radius must center strictly on the Home pin's exact point coordinates
            // and must NOT anchor to, inherit, or merge with the custom driveway polygon geometry.
            const homePinCoords: Location = (isHome && userProfile?.preciseHomeLocation && typeof userProfile.preciseHomeLocation.lat === 'number' && typeof userProfile.preciseHomeLocation.lng === 'number' && !(userProfile.preciseHomeLocation.lat === 0 && userProfile.preciseHomeLocation.lng === 0))
                ? { lat: userProfile.preciseHomeLocation.lat, lng: userProfile.preciseHomeLocation.lng }
                : (place.originalLocation && typeof place.originalLocation.lat === 'number' && typeof place.originalLocation.lng === 'number' && !(place.originalLocation.lat === 0 && place.originalLocation.lng === 0))
                    ? place.originalLocation
                    : place.location;

            if (!homePinCoords || typeof homePinCoords.lat !== 'number' || typeof homePinCoords.lng !== 'number' || (homePinCoords.lat === 0 && homePinCoords.lng === 0)) {
                return;
            }

            // Circular geofence radius must strictly rely on place.radius or place.departureRadius
            // and must NOT fall back to place.entrancePrecision.radius
            const rawRadius = (typeof place.radius === 'number' && !isNaN(place.radius) && place.radius > 0)
                ? place.radius
                : (typeof (place as any).departureRadius === 'number' && !isNaN((place as any).departureRadius) && (place as any).departureRadius > 0)
                    ? (place as any).departureRadius
                    : 0.05;
            const radiusKm = rawRadius > 5 ? rawRadius / 1000 : rawRadius;
            const effectiveRadiusKm = Math.max(0.015, radiusKm);

            // 1. Primary Circular Geofence Boundary: Always centered strictly on the exact point coordinates of the place
            const circleCoords = getCircleCoords(homePinCoords, effectiveRadiusKm, 64);
            circleFeatures.push({
                type: 'Feature' as const,
                id: place.id,
                properties: { id: place.id, name: place.name },
                geometry: {
                    type: 'Polygon' as const,
                    coordinates: [circleCoords]
                }
            });

            // 2. Driveway / Precision Micro-Zone: Occupancy-responsive footprint
            // Check for custom polygon first, then bounding box, then circular micro-zone
            const customPoly = (place as any).drivewayPolygon || place.polygon || place.entrancePrecision?.drivewayPolygon || place.entrancePrecision?.polygon;
            const box = place.entrancePrecision?.box || (place as any).entranceBox;
            const effectiveBox = (box && typeof box.widthMeters === 'number' && typeof box.lengthMeters === 'number') ? box : undefined;

            const drivewayAnchor = (place.entrancePrecision?.location && typeof place.entrancePrecision.location.lat === 'number')
                ? place.entrancePrecision.location
                : (place.entrancePin && typeof place.entrancePin.lat === 'number')
                    ? place.entrancePin
                    : (place.entranceLocation && typeof place.entranceLocation.lat === 'number')
                        ? place.entranceLocation
                        : place.location;

            if (Array.isArray(customPoly) && customPoly.length >= 3) {
                const ring: [number, number][] = customPoly.map((p: any) => {
                    if (Array.isArray(p)) return [p[0], p[1]] as [number, number];
                    return [p.lng, p.lat] as [number, number];
                });
                if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
                    ring.push([ring[0][0], ring[0][1]]);
                }

                // Check real-time occupancy across circle members and local user
                const occupyingMembers = effectiveMembers.filter(m => {
                    if (!m.location || typeof m.location.lat !== 'number' || typeof m.location.lng !== 'number') return false;
                    if (m.location.lat === 0 && m.location.lng === 0) return false;
                    return isPointInPolygon(m.location, customPoly);
                });
                const isOccupied = occupyingMembers.length > 0;
                const occupantNames = occupyingMembers.map(m => m.name || 'Member').join(', ');
                const zoneLabel = place.entranceNotes || (isHome ? 'Driveway' : 'Custom Zone');

                entranceBoxFeatures.push({
                    type: 'Feature' as const,
                    id: `${place.id}-entrance-box`,
                    properties: { 
                        id: `${place.id}-entrance-box`, 
                        placeId: place.id,
                        name: place.name ? `${place.name} (${zoneLabel})` : zoneLabel,
                        isOccupied: isOccupied,
                        occupantCount: occupyingMembers.length,
                        occupantNames: occupantNames,
                        zoneType: isHome ? 'driveway' : (place.entranceType || 'custom_polygon')
                    },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [ring]
                    }
                });
            } else if (effectiveBox) {
                const boxCoords = getRotatedBoxCoords(drivewayAnchor, effectiveBox);

                // Check real-time occupancy across circle members and local user
                const occupyingMembers = effectiveMembers.filter(m => {
                    if (!m.location || typeof m.location.lat !== 'number' || typeof m.location.lng !== 'number') return false;
                    if (m.location.lat === 0 && m.location.lng === 0) return false;
                    return isPointInEntranceBox(m.location, drivewayAnchor, effectiveBox, 5); // 5m hysteresis departure buffer
                });
                const isOccupied = occupyingMembers.length > 0;
                const occupantNames = occupyingMembers.map(m => m.name || 'Member').join(', ');
                const zoneLabel = place.entranceNotes || (isHome ? 'Driveway' : 'Entrance Zone');

                entranceBoxFeatures.push({
                    type: 'Feature' as const,
                    id: `${place.id}-entrance-box`,
                    properties: { 
                        id: `${place.id}-entrance-box`, 
                        placeId: place.id,
                        name: place.name ? `${place.name} (${zoneLabel})` : zoneLabel,
                        isOccupied: isOccupied,
                        occupantCount: occupyingMembers.length,
                        occupantNames: occupantNames,
                        zoneType: isHome ? 'driveway' : (place.entranceType || 'precision_zone')
                    },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [boxCoords]
                    }
                });

                // Entrance box hysteresis buffer (+5m departure buffer)
                const hystCoords = getRotatedBoxCoords(drivewayAnchor, effectiveBox, 5);
                hysteresisFeatures.push({
                    type: 'Feature' as const,
                    id: `${place.id}-hysteresis`,
                    properties: { 
                        id: `${place.id}-hysteresis`, 
                        placeId: place.id,
                        name: `${place.name} (+5m Driveway Buffer)`,
                        isOccupied: isOccupied
                    },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [hystCoords]
                    }
                });
            } else if (
                (place.entranceType === 'driveway' || place.entranceType === 'parking' || place.entranceType === 'drive_thru') &&
                place.entrancePrecision?.radius &&
                place.entrancePrecision.radius <= 35
            ) {
                // Circular driveway / precision micro-zone
                const precisionRadiusKm = place.entrancePrecision.radius / 1000;
                const boxCoords = getCircleCoords(drivewayAnchor, precisionRadiusKm, 32);

                const occupyingMembers = effectiveMembers.filter(m => {
                    if (!m.location || typeof m.location.lat !== 'number' || typeof m.location.lng !== 'number') return false;
                    if (m.location.lat === 0 && m.location.lng === 0) return false;
                    return getDistanceFromCoords(m.location.lat, m.location.lng, drivewayAnchor.lat, drivewayAnchor.lng) <= (place.entrancePrecision!.radius! + 5);
                });
                const isOccupied = occupyingMembers.length > 0;
                const occupantNames = occupyingMembers.map(m => m.name || 'Member').join(', ');
                const zoneLabel = place.entranceNotes || 'Precision Zone';

                entranceBoxFeatures.push({
                    type: 'Feature' as const,
                    id: `${place.id}-entrance-box`,
                    properties: { 
                        id: `${place.id}-entrance-box`, 
                        placeId: place.id,
                        name: place.name ? `${place.name} (${zoneLabel})` : zoneLabel,
                        isOccupied: isOccupied,
                        occupantCount: occupyingMembers.length,
                        occupantNames: occupantNames,
                        zoneType: 'precision_zone'
                    },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [boxCoords]
                    }
                });

                const hystCoords = getCircleCoords(drivewayAnchor, (place.entrancePrecision.radius + 5) / 1000, 32);
                hysteresisFeatures.push({
                    type: 'Feature' as const,
                    id: `${place.id}-hysteresis`,
                    properties: { 
                        id: `${place.id}-hysteresis`, 
                        placeId: place.id,
                        name: `${place.name} (+5m Buffer)`,
                        isOccupied: isOccupied
                    },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [hystCoords]
                    }
                });
            } else if (effectiveRadiusKm <= 0.030) {
                // Circular departure buffer for tight micro-geofences without custom boxes
                const radiusM = effectiveRadiusKm * 1000;
                const hystBufferM = Math.max(15, Math.round(radiusM * 0.5));
                const hystKm = (radiusM + hystBufferM) / 1000;
                const hystCoords = getCircleCoords(homePinCoords, hystKm, 64);
                hysteresisFeatures.push({
                    type: 'Feature' as const,
                    id: `${place.id}-hysteresis`,
                    properties: { id: `${place.id}-hysteresis`, name: `${place.name} (+${Math.round(hystBufferM)}m Departure Buffer)` },
                    geometry: {
                        type: 'Polygon' as const,
                        coordinates: [hystCoords]
                    }
                });
            }
        });

        const geojsonData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: circleFeatures
        };

        const entranceBoxData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: entranceBoxFeatures
        };

        const hysteresisData: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: hysteresisFeatures
        };

        // 1. Primary Safe Zone Circular Geofence Layer (House / Saved Place Perimeter)
        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
            source.setData(geojsonData);
            if (map.current.getLayer(`${sourceId}-fill`)) {
                map.current.setPaintProperty(`${sourceId}-fill`, 'fill-color', '#8b5cf6');
                map.current.setPaintProperty(`${sourceId}-fill`, 'fill-opacity', theme === 'dark' ? 0.12 : 0.10);
            }
            if (map.current.getLayer(`${sourceId}-outline`)) {
                map.current.setPaintProperty(`${sourceId}-outline`, 'line-color', '#8b5cf6');
                map.current.setPaintProperty(`${sourceId}-outline`, 'line-width', 1.5);
                map.current.setPaintProperty(`${sourceId}-outline`, 'line-opacity', 0.6);
            }
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
                    'fill-color': '#8b5cf6',
                    'fill-opacity': theme === 'dark' ? 0.12 : 0.10
                }
            });

            map.current.addLayer({
                id: `${sourceId}-outline`,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#8b5cf6',
                    'line-width': 1.5,
                    'line-opacity': 0.6
                }
            });
        }

        // 2. Occupancy-Responsive Entrance Bounding Box Layer (Driveway / Precision Micro-Zone)
        // Solid bright teal border + filled background when occupied; faint dashed grey border + no fill when empty
        const boxSource = map.current.getSource(entranceBoxSourceId) as maplibregl.GeoJSONSource;
        const outlineOccupiedId = `${entranceBoxSourceId}-outline-occupied`;
        const outlineEmptyId = `${entranceBoxSourceId}-outline-empty`;
        const legacyOutlineId = `${entranceBoxSourceId}-outline`;

        // Clean up legacy outline layer if present
        if (map.current.getLayer(legacyOutlineId)) {
            map.current.removeLayer(legacyOutlineId);
        }

        const occupiedTealColor = theme === 'dark' ? '#2dd4bf' : '#0d9488';
        const occupiedFillColor = theme === 'dark' ? '#14b8a6' : '#0d9488';
        const emptyDashedColor = theme === 'dark' ? '#94a3b8' : '#64748b';

        if (boxSource) {
            boxSource.setData(entranceBoxData);

            // A. Filled Background: ONLY rendered when a circle member or user is inside (No fill when empty)
            if (!map.current.getLayer(`${entranceBoxSourceId}-fill`)) {
                map.current.addLayer({
                    id: `${entranceBoxSourceId}-fill`,
                    type: 'fill',
                    source: entranceBoxSourceId,
                    filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                    paint: {
                        'fill-color': occupiedFillColor,
                        'fill-opacity': theme === 'dark' ? 0.30 : 0.22
                    }
                });
            } else {
                map.current.setFilter(`${entranceBoxSourceId}-fill`, ['==', ['to-boolean', ['get', 'isOccupied']], true]);
                map.current.setPaintProperty(`${entranceBoxSourceId}-fill`, 'fill-color', occupiedFillColor);
                map.current.setPaintProperty(`${entranceBoxSourceId}-fill`, 'fill-opacity', theme === 'dark' ? 0.30 : 0.22);
            }

            // B. Glowing Teal Halo: ONLY lights up when occupied
            if (!map.current.getLayer(`${entranceBoxSourceId}-glow`)) {
                map.current.addLayer({
                    id: `${entranceBoxSourceId}-glow`,
                    type: 'line',
                    source: entranceBoxSourceId,
                    filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': theme === 'dark' ? '#2dd4bf' : '#14b8a6',
                        'line-width': 6.0,
                        'line-opacity': theme === 'dark' ? 0.40 : 0.28,
                        'line-blur': 3.0
                    }
                });
            } else {
                map.current.setFilter(`${entranceBoxSourceId}-glow`, ['==', ['to-boolean', ['get', 'isOccupied']], true]);
                map.current.setPaintProperty(`${entranceBoxSourceId}-glow`, 'line-color', theme === 'dark' ? '#2dd4bf' : '#14b8a6');
                map.current.setPaintProperty(`${entranceBoxSourceId}-glow`, 'line-width', 6.0);
                map.current.setPaintProperty(`${entranceBoxSourceId}-glow`, 'line-opacity', theme === 'dark' ? 0.40 : 0.28);
                map.current.setPaintProperty(`${entranceBoxSourceId}-glow`, 'line-blur', 3.0);
            }

            // C. Solid Teal Border: Bright, solid border when occupied
            if (!map.current.getLayer(outlineOccupiedId)) {
                map.current.addLayer({
                    id: outlineOccupiedId,
                    type: 'line',
                    source: entranceBoxSourceId,
                    filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': occupiedTealColor,
                        'line-width': 2.8,
                        'line-opacity': 1.0
                    }
                });
            } else {
                map.current.setFilter(outlineOccupiedId, ['==', ['to-boolean', ['get', 'isOccupied']], true]);
                map.current.setPaintProperty(outlineOccupiedId, 'line-color', occupiedTealColor);
                map.current.setPaintProperty(outlineOccupiedId, 'line-width', 2.8);
                map.current.setPaintProperty(outlineOccupiedId, 'line-opacity', 1.0);
            }

            // D. Faint Dashed Grey Border: ONLY when driveway is empty
            if (!map.current.getLayer(outlineEmptyId)) {
                map.current.addLayer({
                    id: outlineEmptyId,
                    type: 'line',
                    source: entranceBoxSourceId,
                    filter: ['!=', ['to-boolean', ['get', 'isOccupied']], true],
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': emptyDashedColor,
                        'line-width': 1.6,
                        'line-opacity': theme === 'dark' ? 0.55 : 0.45,
                        'line-dasharray': [3, 3]
                    }
                });
            } else {
                map.current.setFilter(outlineEmptyId, ['!=', ['to-boolean', ['get', 'isOccupied']], true]);
                map.current.setPaintProperty(outlineEmptyId, 'line-color', emptyDashedColor);
                map.current.setPaintProperty(outlineEmptyId, 'line-width', 1.6);
                map.current.setPaintProperty(outlineEmptyId, 'line-opacity', theme === 'dark' ? 0.55 : 0.45);
            }
        } else {
            map.current.addSource(entranceBoxSourceId, {
                type: 'geojson',
                data: entranceBoxData
            });

            // Modern glassmorphic fill: ONLY rendered when occupied (No fill when empty)
            map.current.addLayer({
                id: `${entranceBoxSourceId}-fill`,
                type: 'fill',
                source: entranceBoxSourceId,
                filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                paint: {
                    'fill-color': occupiedFillColor,
                    'fill-opacity': theme === 'dark' ? 0.30 : 0.22
                }
            });

            // Glowing teal aura: ONLY rendered when occupied
            map.current.addLayer({
                id: `${entranceBoxSourceId}-glow`,
                type: 'line',
                source: entranceBoxSourceId,
                filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': theme === 'dark' ? '#2dd4bf' : '#14b8a6',
                    'line-width': 6.0,
                    'line-opacity': theme === 'dark' ? 0.40 : 0.28,
                    'line-blur': 3.0
                }
            });

            // Crisp solid teal border: ONLY when occupied
            map.current.addLayer({
                id: outlineOccupiedId,
                type: 'line',
                source: entranceBoxSourceId,
                filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': occupiedTealColor,
                    'line-width': 2.8,
                    'line-opacity': 1.0
                }
            });

            // Faint dashed grey outline: when empty (no fill, dashed border)
            map.current.addLayer({
                id: outlineEmptyId,
                type: 'line',
                source: entranceBoxSourceId,
                filter: ['!=', ['to-boolean', ['get', 'isOccupied']], true],
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': emptyDashedColor,
                    'line-width': 1.6,
                    'line-opacity': theme === 'dark' ? 0.55 : 0.45,
                    'line-dasharray': [3, 3]
                }
            });
        }

        // 3. Faint Departure Buffer Outer Ring / Box Buffer (Only when occupied)
        const hystSource = map.current.getSource(hysteresisSourceId) as maplibregl.GeoJSONSource;
        if (hystSource) {
            hystSource.setData(hysteresisData);
            if (map.current.getLayer(`${hysteresisSourceId}-outline`)) {
                map.current.setFilter(`${hysteresisSourceId}-outline`, ['==', ['to-boolean', ['get', 'isOccupied']], true]);
                map.current.setPaintProperty(`${hysteresisSourceId}-outline`, 'line-color', theme === 'dark' ? '#2dd4bf' : '#14b8a6');
                map.current.setPaintProperty(`${hysteresisSourceId}-outline`, 'line-width', 1.4);
                map.current.setPaintProperty(`${hysteresisSourceId}-outline`, 'line-opacity', theme === 'dark' ? 0.45 : 0.35);
            }
        } else {
            map.current.addSource(hysteresisSourceId, {
                type: 'geojson',
                data: hysteresisData
            });

            map.current.addLayer({
                id: `${hysteresisSourceId}-outline`,
                type: 'line',
                source: hysteresisSourceId,
                filter: ['==', ['to-boolean', ['get', 'isOccupied']], true],
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': theme === 'dark' ? '#2dd4bf' : '#14b8a6',
                    'line-width': 1.4,
                    'line-opacity': theme === 'dark' ? 0.45 : 0.35,
                    'line-dasharray': [2, 3]
                }
            });
        }

        // 4. Z-Index / Layer Ordering:
        // Ensure smaller driveway micro-zone (fill, glow, outline) renders ABOVE the larger home radius circle (fill, outline)
        // so its vibrant teal color and crisp borders are never muddied by the purple fill.
        try {
            if (map.current.getLayer(`${sourceId}-outline`)) {
                if (map.current.getLayer(`${hysteresisSourceId}-outline`)) {
                    map.current.moveLayer(`${hysteresisSourceId}-outline`);
                }
                if (map.current.getLayer(`${entranceBoxSourceId}-fill`)) {
                    map.current.moveLayer(`${entranceBoxSourceId}-fill`);
                }
                if (map.current.getLayer(`${entranceBoxSourceId}-glow`)) {
                    map.current.moveLayer(`${entranceBoxSourceId}-glow`);
                }
                if (map.current.getLayer(outlineEmptyId)) {
                    map.current.moveLayer(outlineEmptyId);
                }
                if (map.current.getLayer(outlineOccupiedId)) {
                    map.current.moveLayer(outlineOccupiedId);
                }
            }
        } catch (e) {
            console.debug('Geofence layer reordering skipped:', e);
        }
    }, [places, savedPlaces, members, userLocation, currentUserId, userProfile, isNavigating, isMapReady, styleVersion, theme]);

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
                minzoom: 0,
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
                minzoom: 0,
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

            // Halo layer (Protected from minzoom: visible at all zoom levels)
            map.current.addLayer({
                id: 'public-reports-halo',
                type: 'circle',
                source: sourceId,
                minzoom: 0,
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 18,
                    'circle-opacity': 0.25,
                    'circle-blur': 0.4
                }
            });

            // Badge circle (Protected from minzoom: visible at all zoom levels)
            map.current.addLayer({
                id: 'public-reports-badge',
                type: 'circle',
                source: sourceId,
                minzoom: 0,
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 13,
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.95
                }
            });

            // Emoji icon (Protected from minzoom: visible at all zoom levels)
            map.current.addLayer({
                id: 'public-reports-symbol',
                type: 'symbol',
                source: sourceId,
                minzoom: 0,
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
    // COMMUNITY BUILDING NUMBERS (PURE WEBGL LAYER - ZERO DOM MARKERS)
    // Decoupled from avatar clustering; purely updates WebGL source via .setData()
    // ==========================================
    useEffect(() => {
        if (!map.current) return;

        const injectData = () => {
            // Check if map is fully ready first
            if (!map.current || !map.current.isStyleLoaded()) return;

            // Robust Layer Initialization: Check if source exists; if not, dynamically addSource and addLayer
            if (!map.current.getSource('community-buildings')) {
                try {
                    map.current.addSource('community-buildings', {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: [] }
                    });
                } catch (err) {
                    console.warn('[MapLibre3DView] Error dynamically adding community-buildings source:', err);
                }
            }

            if (!map.current.getLayer('community-buildings-layer')) {
                try {
                    map.current.addLayer({
                        id: 'community-buildings-layer',
                        type: 'symbol',
                        source: 'community-buildings',
                        minzoom: 16,
                        layout: {
                            'text-field': ['coalesce', ['get', 'houseNumber'], ['get', 'house_number'], ['get', 'housenumber'], ['get', 'addr:housenumber'], ''],
                            'text-size': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                15, 11,
                                18, 13,
                                20, 15
                            ],
                            'text-font': ['Open Sans Bold', 'Open Sans Regular', 'Arial Unicode MS Bold'],
                            'text-anchor': 'center',
                            'text-justify': 'center',
                            'text-pitch-alignment': 'viewport',
                            'text-rotation-alignment': 'viewport',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'text-optional': false
                        },
                        paint: {
                            'text-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
                            'text-halo-color': theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                            'text-halo-width': 2.0,
                            'text-halo-blur': 0.5
                        }
                    });
                } catch (layerErr) {
                    console.warn('[MapLibre3DView] Failed to dynamically add community-buildings-layer:', layerErr);
                }
            }

            const source = map.current.getSource('community-buildings') as maplibregl.GeoJSONSource | undefined;
            if (!source) return;

            // 1. Auto-register saved places with house numbers into community building cache ONLY if verified rooftop
            if (savedPlaces && savedPlaces.length > 0) {
                savedPlaces.forEach(p => {
                    // NEVER register unverified or street/intersection places into persistent community building layer
                    if (!p.isRooftop && !p.isCorrected) return;
                    if (p.geocodePrecision === 'street' || p.geocodePrecision === 'intersection') return;
                    const hn = p.houseNumber || extractHouseNumber(p.address || p.name || '');
                    const lat = p.location?.lat;
                    const lng = p.location?.lng;
                    if (hn && typeof lat === 'number' && typeof lng === 'number') {
                        communityBuildingService.registerBuilding({
                            address: p.address || p.name || `${hn} Street`,
                            houseNumber: hn,
                            coordinates: { lat, lng },
                            userId: currentUserId,
                            source: 'place_correction',
                            isRooftop: true,
                            precision: 'rooftop'
                        });
                    }
                });
            }

            // Purge unverified street/intersection artifacts from cache and map
            communityBuildingService.purgeStrayBuildings(savedPlaces, userProfile?.preciseHomeLocation);

            // 2. Auto-register user's verified precise home location if present
            if (userProfile?.preciseHomeLocation && typeof userProfile.preciseHomeLocation.lat === 'number' && typeof userProfile.preciseHomeLocation.lng === 'number' && !(userProfile.preciseHomeLocation.lat === 0 && userProfile.preciseHomeLocation.lng === 0)) {
                const hn = userProfile.houseNumber || extractHouseNumber(userProfile.homeAddress || '');
                if (hn) {
                    communityBuildingService.registerBuilding({
                        address: userProfile.homeAddress || `Building ${hn}`,
                        houseNumber: hn,
                        coordinates: { lat: userProfile.preciseHomeLocation.lat, lng: userProfile.preciseHomeLocation.lng },
                        userId: currentUserId,
                        source: 'user_profile',
                        isRooftop: true,
                        precision: 'rooftop'
                    });
                }
            }

            // 3. Combine communityBuildings state with synchronous cache
            const allBuildings = [
                ...(communityBuildings || []),
                ...communityBuildingService.getAllBuildings()
            ];

            const seen = new Set<string>();
            const features: GeoJSON.Feature[] = [];

            allBuildings.forEach(b => {
                if (!b) return;
                // Never inject unverified street or intersection numbers into WebGL layer
                if (b.isRooftop === false || b.precision === 'street' || b.precision === 'intersection') return;
                if (/(\s&|\sand\s|\s\/\s|\sat\s)/i.test(b.address || '')) return;
                if (b.source !== 'user_profile' && b.source !== 'pinpoint_verification' && !b.isRooftop && /(drive|dr|court|ct|road|rd|street|st|avenue|ave|lane|ln|way|blvd)\b/i.test(b.address || '') && !/building/i.test(b.address || '')) return;

                const bId = b.id || `${b.coordinates?.lat}_${b.coordinates?.lng}`;
                if (seen.has(bId)) return;
                seen.add(bId);

                const lat = b.coordinates?.lat ?? (b as any).lat;
                const lng = b.coordinates?.lng ?? (b as any).lng;
                const houseNumber = b.houseNumber || extractHouseNumber(b.address || '');

                if (houseNumber && typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
                    features.push({
                        type: 'Feature',
                        id: bId,
                        properties: {
                            id: bId,
                            houseNumber: String(houseNumber),
                            house_number: String(houseNumber),
                            housenumber: String(houseNumber),
                            'addr:housenumber': String(houseNumber),
                            label: b.address || `Building ${houseNumber}`
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: [lng, lat]
                        }
                    });
                }
            });

            const geojson: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features
            };

            try {
                source.setData(geojson);
            } catch (e) {
                console.warn('[MapLibre3DView] Error updating community-buildings source:', e);
            }

            // 4. Update dynamic layer paint properties if changed
            if (map.current.getLayer('community-buildings-layer')) {
                try {
                    const targetTextColor = theme === 'dark' ? '#f8fafc' : '#0f172a';
                    const currentTextColor = map.current.getPaintProperty('community-buildings-layer', 'text-color');
                    if (currentTextColor !== targetTextColor) {
                        map.current.setPaintProperty('community-buildings-layer', 'text-color', targetTextColor);
                        map.current.setPaintProperty('community-buildings-layer', 'text-halo-color', theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)');
                    }
                } catch {}
            }
        };

        // Retry Mechanism: If data is ready but isStyleLoaded() is false, retry when map finishes rendering
        if (!map.current.isStyleLoaded()) {
            map.current.once('idle', injectData);
            map.current.once('style.load', injectData);
            map.current.once('load', injectData);
        } else {
            injectData();
        }

        // Listen for Style Changes: Only re-inject when style.load fires and layer is missing
        const handleStyleChange = () => {
            if (!map.current || !map.current.isStyleLoaded()) return;
            if (!map.current.getLayer('community-buildings-layer')) {
                injectData();
            }
        };

        map.current.on('style.load', handleStyleChange);

        return () => {
            if (map.current) {
                map.current.off('style.load', handleStyleChange);
                map.current.off('idle', injectData);
                map.current.off('load', injectData);
            }
        };
    }, [communityBuildings, savedPlaces, userProfile, theme, isMapReady, styleVersion, currentUserId]);

    // ==========================================
    // VOLATILE ACTIVE SEARCH LAYER (active-search-source)
    // Instantly wiped empty when search is cleared, detail panel closed, or navigation starts
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const sourceId = 'active-search-source';
        const layerId = 'active-search-layer';

        if (!map.current.getSource(sourceId)) {
            try {
                map.current.addSource(sourceId, {
                    type: 'geojson',
                    data: STATIC_EMPTY_FEATURE_COLLECTION
                });
                map.current.addLayer({
                    id: layerId,
                    type: 'symbol',
                    source: sourceId,
                    minzoom: 14,
                    layout: {
                        'text-field': ['coalesce', ['get', 'houseNumber'], ''],
                        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                        'text-size': 12,
                        'text-anchor': 'top',
                        'text-offset': [0, 0.8],
                        'text-allow-overlap': false
                    },
                    paint: {
                        'text-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
                        'text-halo-color': theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                        'text-halo-width': 2.0
                    }
                });
            } catch (e) {
                console.warn('[MapLibre3DView] Error creating active-search-source:', e);
            }
        }

        const source = map.current.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
        if (!source) return;

        // Instantly wipe empty if user is navigating, or no search places exist
        if (isNavigating || !places || places.length === 0) {
            try {
                source.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            } catch {}
            return;
        }

        const searchPlaces = places.filter(p => 
            p && 
            p.type === 'search_result' && 
            p.location && 
            typeof p.location.lat === 'number' && 
            typeof p.location.lng === 'number' && 
            !(p.location.lat === 0 && p.location.lng === 0)
        );

        if (searchPlaces.length === 0) {
            try {
                source.setData(STATIC_EMPTY_FEATURE_COLLECTION);
            } catch {}
            return;
        }

        // Only inject text building numbers if strictly verified rooftop; NEVER for intersections or streets!
        const searchFeatures: GeoJSON.Feature[] = searchPlaces.map(sp => {
            const isRooftopVerified = sp.isRooftop === true && sp.geocodePrecision === 'rooftop' && Boolean(sp.houseNumber);
            return {
                type: 'Feature',
                id: sp.id,
                properties: {
                    id: sp.id,
                    name: sp.name,
                    houseNumber: isRooftopVerified ? String(sp.houseNumber) : '',
                    label: isRooftopVerified ? String(sp.houseNumber) : '',
                    isRooftop: isRooftopVerified
                },
                geometry: {
                    type: 'Point',
                    coordinates: [sp.location.lng, sp.location.lat]
                }
            };
        });

        try {
            source.setData({
                type: 'FeatureCollection',
                features: searchFeatures
            });
        } catch (err) {
            console.warn('[MapLibre3DView] Error updating active-search-source:', err);
        }
    }, [places, isNavigating, isMapReady, theme]);

    // ==========================================
    // INTERACTIVE MAP BUILDINGS (TAP-TO-MOVE)
    // Tapping neighboring buildings / coordinates reverse-geocodes the location,
    // updates SearchBox, and shifts active search pin & Place Detail Panel
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const currentMap = map.current;

        const handleMapClick = async (e: maplibregl.MapMouseEvent) => {
            // Guard: Never interrupt active turn-by-turn navigation
            if (isNavigating) return;

            // Guard: Ignore map background clicks if a circle member was recently clicked/selected
            if (Date.now() - lastMemberSelectTimeRef.current < 800) {
                return;
            }

            const lat = e.lngLat.lat;
            const lng = e.lngLat.lng;

            // Prioritize user saved places if clicked directly on or adjacent to saved geofence
            const currentSaved = savedPlacesRef.current || [];
            if (currentSaved && currentSaved.length > 0) {
                const nearbySaved = currentSaved.find(sp => {
                    if (!sp.location || typeof sp.location.lat !== 'number' || typeof sp.location.lng !== 'number') return false;
                    const distM = getDistanceMeters(sp.location, { lat, lng });
                    const radiusM = Math.max((sp.radius || 0.15) * 1609.34, 45);
                    return distM <= radiusM;
                });
                if (nearbySaved) {
                    console.log('Place clicked:', nearbySaved);
                    onSelectPlaceRef.current?.(nearbySaved);
                    return;
                }
            }

            // Also check other places (e.g. search results or custom pins)
            const currentPlaces = placesRef.current || [];
            if (currentPlaces && currentPlaces.length > 0) {
                const nearbyPlace = currentPlaces.find(p => {
                    if (!p.location || typeof p.location.lat !== 'number' || typeof p.location.lng !== 'number') return false;
                    const distM = getDistanceMeters(p.location, { lat, lng });
                    const radiusM = Math.max((p.radius || 0.15) * 1609.34, 45);
                    return distM <= radiusM;
                });
                if (nearbyPlace) {
                    console.log('Place clicked:', nearbyPlace);
                    onSelectPlaceRef.current?.(nearbyPlace);
                    return;
                }
            }

            // Check zoom level: only allow address/building inspection at street/neighborhood zoom (>= 14)
            if (currentMap.getZoom() < 14) return;

            try {
                const point = e.point;
                // Check if user tapped directly on a community building or 3D building footprint
                const commFeatures = currentMap.queryRenderedFeatures(point, {
                    layers: ['community-buildings-layer', 'community-building-numbers', 'buildings-3d'].filter(id => currentMap.getLayer(id))
                });

                let targetLat = lat;
                let targetLng = lng;

                if (commFeatures && commFeatures.length > 0) {
                    const feat = commFeatures[0];
                    if (feat.geometry && feat.geometry.type === 'Point') {
                        const coords = (feat.geometry as GeoJSON.Point).coordinates;
                        targetLng = coords[0];
                        targetLat = coords[1];
                    }
                }

                const place = await reverseGeocode({ lat: targetLat, lng: targetLng });
                if (place && onSelectPlaceRef.current) {
                    console.log('Place clicked:', place);
                    onSelectPlaceRef.current(place);
                }
            } catch (err) {
                console.warn('[MapLibre3DView] Interactive building tap reverse geocode failed:', err);
            }
        };

        currentMap.on('click', handleMapClick);

        // Cursor pointer styling on hover over buildings at street zoom
        const buildingLayers = ['buildings-3d', 'community-buildings-layer', 'community-building-numbers'];
        const handleMouseEnter = () => {
            if (currentMap && !isNavigating && currentMap.getZoom() >= 14) {
                currentMap.getCanvas().style.cursor = 'pointer';
            }
        };
        const handleMouseLeave = () => {
            if (currentMap) {
                currentMap.getCanvas().style.cursor = '';
            }
        };

        buildingLayers.forEach(layerId => {
            if (currentMap.getLayer(layerId)) {
                currentMap.on('mouseenter', layerId, handleMouseEnter);
                currentMap.on('mouseleave', layerId, handleMouseLeave);
            }
        });

        return () => {
            try {
                currentMap.off('click', handleMapClick);
                buildingLayers.forEach(layerId => {
                    if (currentMap.getLayer(layerId)) {
                        currentMap.off('mouseenter', layerId, handleMouseEnter);
                        currentMap.off('mouseleave', layerId, handleMouseLeave);
                    }
                });
            } catch {}
        };
    }, [isMapReady, isNavigating, onSelectPlace, styleVersion]);

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
    // SMOOTH ON-DEMAND VEHICLE PUCK & BEARING INTERPOLATION (rAF)
    // ==========================================
    // Decoupled from React render cycles: interpolates vehicle puck coordinates
    // and orientation smoothly across the 1000ms (1Hz) GPS interval at native screen refresh rate.
    // Stops automatically when stationary or once interpolation finishes, preventing frame budget violations.
    const triggerPuckAnimation = useCallback(() => {
        if (isPuckAnimatingRef.current) return;
        const anim = puckInterpolationRef.current;
        if (!anim) return;

        const hasMoved = Math.abs(anim.targetCoords[0] - anim.prevCoords[0]) > 1e-7 ||
                         Math.abs(anim.targetCoords[1] - anim.prevCoords[1]) > 1e-7 ||
                         Math.abs(anim.targetBearing - anim.prevBearing) > 0.5;
        if (!hasMoved) return;

        isPuckAnimatingRef.current = true;

        const animatePuck = (now: number) => {
            const currentAnim = puckInterpolationRef.current;
            const marker = selfMarkerRef.current;

            if (!currentAnim || !marker || !isNavigatingRef.current) {
                isPuckAnimatingRef.current = false;
                puckRafIdRef.current = null;
                return;
            }

            const elapsed = now - currentAnim.startTime;
            const duration = currentAnim.duration || 1000;
            const progress = Math.min(1, Math.max(0, elapsed / duration));

            const lng = currentAnim.prevCoords[0] + (currentAnim.targetCoords[0] - currentAnim.prevCoords[0]) * progress;
            const lat = currentAnim.prevCoords[1] + (currentAnim.targetCoords[1] - currentAnim.prevCoords[1]) * progress;
            currentAnim.currentCoords = [lng, lat];

            let deltaBearing = currentAnim.targetBearing - currentAnim.prevBearing;
            if (deltaBearing > 180) deltaBearing -= 360;
            if (deltaBearing < -180) deltaBearing += 360;
            const bearing = ((currentAnim.prevBearing + deltaBearing * progress) % 360 + 360) % 360;
            currentAnim.currentBearing = bearing;

            marker.setLngLat([lng, lat]);
            marker.setRotation(bearing);

            if (progress < 1) {
                puckRafIdRef.current = requestAnimationFrame(animatePuck);
            } else {
                isPuckAnimatingRef.current = false;
                puckRafIdRef.current = null;
            }
        };

        puckRafIdRef.current = requestAnimationFrame(animatePuck);
    }, []);

    // ==========================================
    // MEMBER AVATARS & LIVE LOCATION PUCK MARKERS
    // ==========================================
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const SNAPPING_THRESHOLD_METERS = 40;

        // Generate deduplicated member list including local user
        const dedupedMembers = getEffectiveMembersWithSelf(
            members,
            userLocation,
            currentUserId,
            userProfile,
            isNavigating
        );

        // ── GEOFENCE PLACE OCCUPANT CLUSTERING ───────────────────────
        // Evaluate if any members (or the local user when !isNavigating) fall within a Saved Place radius.
        // If so, their standalone floating marker is suppressed and they are absorbed into that Place's occupant cluster.
        const { clusteredIntoPlaceMemberIds } = computePlaceOccupants(
            (savedPlaces && savedPlaces.length > 0) ? savedPlaces : places,
            dedupedMembers,
            currentUserId,
            isNavigating
        );

        // Filter to members who are NOT inside any saved place radius (and strictly exclude any building IDs)
        const unclusteredMembers = dedupedMembers.filter(m => 
            !clusteredIntoPlaceMemberIds.has(m.id) &&
            !m.id.startsWith('bld_') &&
            !m.id.startsWith('building_') &&
            !m.id.startsWith('comm_bld_') &&
            !m.id.startsWith('community_') &&
            !m.id.startsWith('place_bld_') &&
            !m.id.startsWith('rooftop_')
        );
        const currentMemberIds = new Set(unclusteredMembers.map(m => m.id));

        // ── CLUSTER DETECTION ──────────────────────────────────────
        // Group remaining unclustered members within 15m of each other into clusters.
        // Self-navigating user is always kept solo so the arrow puck is never obscured.
        const CLUSTER_THRESHOLD_METERS = 15;
        type MemberCluster = { members: FamilyMember[]; centroid: Location };
        const clusters: MemberCluster[] = [];
        const clustered = new Set<string>();

        unclusteredMembers.forEach(member => {
            if (clustered.has(member.id)) return;
            const isSelf = checkIsMemberSelf(member.id, currentUserId);
            const isSelfNav = isNavigating && isSelf;
            // Self-navigating user is always rendered solo
            if (isSelfNav) {
                clusters.push({ members: [member], centroid: member.location });
                clustered.add(member.id);
                return;
            }
            const group: FamilyMember[] = [member];
            clustered.add(member.id);

            unclusteredMembers.forEach(other => {
                if (clustered.has(other.id)) return;
                const otherIsSelf = checkIsMemberSelf(other.id, currentUserId);
                const otherIsSelfNav = isNavigating && otherIsSelf;
                if (otherIsSelfNav) return; // don't cluster with nav puck
                const dist = getDistanceMeters(member.location, other.location);
                if (dist < CLUSTER_THRESHOLD_METERS) {
                    group.push(other);
                    clustered.add(other.id);
                }
            });

            // Compute centroid of the group
            const centroid: Location = {
                lat: group.reduce((sum, m) => sum + m.location.lat, 0) / group.length,
                lng: group.reduce((sum, m) => sum + m.location.lng, 0) / group.length
            };
            clusters.push({ members: group, centroid });
        });

        // Determine which individual member IDs are NOT in a cluster (solo)
        const soloMemberIds = new Set<string>();
        const clusteredMemberIds = new Set<string>();
        const activeClusterKeys = new Set<string>();

        clusters.forEach(cluster => {
            if (cluster.members.length === 1) {
                soloMemberIds.add(cluster.members[0].id);
            } else {
                const key = 'cluster_' + cluster.members.map(m => m.id).sort().join('_');
                activeClusterKeys.add(key);
                cluster.members.forEach(m => clusteredMemberIds.add(m.id));
            }
        });

        // Remove stale individual member markers (not in current unclustered set OR now clustered with members OR now absorbed into saved place)
        for (const [id, marker] of membersMarkersRef.current.entries()) {
            if (!currentMemberIds.has(id) || clusteredMemberIds.has(id) || clusteredIntoPlaceMemberIds.has(id)) {
                marker.remove();
                membersMarkersRef.current.delete(id);
            }
        }

        // Remove stale cluster markers (cluster key no longer active)
        for (const [key, marker] of clusterMarkersRef.current.entries()) {
            if (!activeClusterKeys.has(key)) {
                marker.remove();
                clusterMarkersRef.current.delete(key);
            }
        }

        // ── RENDER CLUSTERS ────────────────────────────────────────
        const isLightSkin = effectiveSkin === 'default' || effectiveSkin === 'warm_cream';
        const isCarbonAmber = effectiveSkin === 'carbon-amber' || effectiveSkin === 'los-santos';

        clusters.forEach(cluster => {
            if (cluster.members.length === 1) {
                // ── SOLO MEMBER ──
                const member = cluster.members[0];
                const isSelf = checkIsMemberSelf(member.id, currentUserId);
                const isSelfNavigating = isNavigating && isSelf;
                let finalLocation = member.location;

                // 1. Calculate delta movement distance & bearing between consecutive GPS pings
                let movementBearing: number | null = null;
                if (isSelf && prevSelfLocationRef.current) {
                    const dMoved = getDistanceMeters(prevSelfLocationRef.current, member.location);
                    if (dMoved >= 1.5) {
                        movementBearing = getBearing(prevSelfLocationRef.current, member.location);
                        prevSelfLocationRef.current = { lat: member.location.lat, lng: member.location.lng };
                    }
                } else if (isSelf) {
                    prevSelfLocationRef.current = { lat: member.location.lat, lng: member.location.lng };
                }

                // 2. Geolocation true heading from device telemetry (valid when vehicle is moving)
                const hasValidDeviceHeading = typeof member.heading === 'number' && member.heading >= 0 && !isNaN(member.heading) && (member.speed || 0) > 1.0;
                const trueHeading = hasValidDeviceHeading ? member.heading! : null;

                // 3. Fallback raw bearing
                let displayBearing = trueHeading ?? movementBearing ?? (typeof member.heading === 'number' && member.heading >= 0 ? member.heading : (isSelf ? latestBearingRef.current : 0));

                // 4. Snap-to-Road & Route Vector Alignment during active navigation
                if (isNavigating && routeCoords.length >= 2) {
                    let minSegDist = Infinity;
                    let snappedPoint: Location | null = null;
                    let segBearing = 0;

                    // Scan entire route coordinates to find the exact nearest polyline segment
                    for (let i = 0; i < routeCoords.length - 1; i++) {
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

                        // Align orientation cleanly to the route polyline vector
                        // If device true heading or delta movement bearing indicates a sharp divergence (> 65°),
                        // honor the vehicle's actual orientation (e.g. U-turns, sharp driveway maneuvers);
                        // otherwise lock smoothly straight along the route polyline vector (segBearing)
                        const candidateBearing = trueHeading ?? movementBearing;
                        if (candidateBearing !== null) {
                            let diff = Math.abs(candidateBearing - segBearing);
                            if (diff > 180) diff = 360 - diff;
                            if (diff <= 65) {
                                displayBearing = segBearing;
                            } else {
                                displayBearing = candidateBearing;
                            }
                        } else {
                            displayBearing = segBearing;
                        }
                    } else {
                        // Off-route or outside snapping radius: prioritize device true heading, then movement bearing, then route forward vector
                        if (trueHeading !== null) {
                            displayBearing = trueHeading;
                        } else if (movementBearing !== null) {
                            displayBearing = movementBearing;
                        } else if (segBearing !== 0) {
                            displayBearing = segBearing;
                        }
                    }
                }

                // Calculate rotation relative to map camera angle so vehicle arrow points directly along the road on-screen
                const mapCamBearing = map.current ? map.current.getBearing() : 0;
                let visualRotation = ((displayBearing - mapCamBearing) % 360 + 360) % 360;
                if (visualRotation > 180) visualRotation -= 360;
                visualRotation = Math.round(visualRotation);

                const circleColor = member.circleColor || '#6366f1';
                const isDriving = (member.speed || 0) > 10 || !!(member as any).isDriving;
                const isStale = !!(member as any).isStale;
                const isBlurred = (member as any).privacyMode === 'blurred' || (member as any).privacyMode === 'approximate';
                const isFrozen = (member as any).privacyMode === 'frozen' || (member as any).privacyMode === 'ghost';

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
                const markerHtml = isSelfNavigating ? `
                    <div class="myway-nav-puck-container select-none" style="position: relative; width: 68px; height: 68px; display: flex; align-items: center; justify-content: center;">
                        <!-- Dynamic Forward Vision Headlight Beam (Electric Cyan) -->
                        <div class="myway-puck-beam" style="position: absolute; top: -38px; left: 50%; transform: translateX(-50%); transform-origin: bottom center; width: 56px; height: 60px; background: radial-gradient(ellipse at bottom, ${isCarbonAmber ? 'rgba(0, 242, 254, 0.65)' : 'rgba(56, 189, 248, 0.45)'} 0%, ${isCarbonAmber ? 'rgba(6, 182, 212, 0.25)' : 'rgba(56, 189, 248, 0.12)'} 50%, transparent 80%); clip-path: polygon(50% 100%, 0% 0%, 100% 0%); pointer-events: none;"></div>
                        
                        <!-- Radar Pulse Beacon (Electric Cyan) -->
                        <div style="position: absolute; inset: 6px; border-radius: 50%; background: ${isCarbonAmber ? '#00f2fe' : isLightSkin ? '#0284c7' : circleColor}; opacity: 0.4; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; box-shadow: ${isCarbonAmber ? '0 0 16px #00f2fe' : 'none'};"></div>
                        
                        <!-- 3D Navigation Vehicle Arrow Puck with Solid Black Casing -->
                        <div class="myway-puck-arrow" style="position: relative; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.8));">
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
                    el.className = `myway-member-avatar-marker select-none ${isSelf ? 'cursor-default' : 'cursor-pointer'}`;
                    el.style.cursor = isSelf ? 'default' : 'pointer';
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.alignItems = 'center';
                    el.style.transform = 'translate3d(0,0,0)';
                    el.innerHTML = markerHtml;
                    (el as any)._lastHtml = markerHtml;

                    const handleMemberMarkerClick = (e: Event) => {
                        e.stopPropagation();
                        if ((e as any).originalEvent?.stopPropagation) {
                            (e as any).originalEvent.stopPropagation();
                        }
                        lastMemberSelectTimeRef.current = Date.now();
                        // Prevent opening Circle Member detail card when clicking own live location marker
                        if (isSelf || checkIsMemberSelf(member.id, currentUserId)) {
                            return;
                        }
                        onSelectMemberRef.current?.(member.id);
                    };

                    el.addEventListener('click', handleMemberMarkerClick);
                    const stopMarkerPointerPropagation = (e: Event) => {
                        e.stopPropagation();
                        if ((e as any).originalEvent?.stopPropagation) {
                            (e as any).originalEvent.stopPropagation();
                        }
                    };
                    el.addEventListener('pointerdown', stopMarkerPointerPropagation);
                    el.addEventListener('mousedown', stopMarkerPointerPropagation);
                    el.addEventListener('touchstart', stopMarkerPointerPropagation, { passive: false });

                    marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                        .setLngLat([finalLocation.lng, finalLocation.lat])
                        .addTo(map.current!);
                    membersMarkersRef.current.set(member.id, marker);
                } else {
                    const existingEl = marker.getElement();
                    existingEl.style.cursor = isSelf ? 'default' : 'pointer';
                    if (isSelf) {
                        existingEl.classList.remove('cursor-pointer');
                        existingEl.classList.add('cursor-default');
                    } else {
                        existingEl.classList.remove('cursor-default');
                        existingEl.classList.add('cursor-pointer');
                    }
                    // Prevent destroying and recreating the marker inner DOM on every 1Hz GPS coordinate ping
                    if ((existingEl as any)._lastHtml !== markerHtml) {
                        existingEl.innerHTML = markerHtml;
                        (existingEl as any)._lastHtml = markerHtml;
                    }
                }

                if (isSelfNavigating) {
                    selfMarkerRef.current = marker;
                    marker.setRotationAlignment('map');
                    marker.setPitchAlignment('map');
                    marker.setRotation(displayBearing);
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
                        let deltaB = Math.abs(displayBearing - anim.currentBearing);
                        if (deltaB > 180) deltaB = 360 - deltaB;

                        // If vehicle jumps > 300m or makes a sharp >120° turn/recalculation, reset instantly to avoid slow 1s spinning
                        if (dist > 300 || deltaB > 120) {
                            anim.prevCoords = [finalLocation.lng, finalLocation.lat];
                            anim.targetCoords = [finalLocation.lng, finalLocation.lat];
                            anim.currentCoords = [finalLocation.lng, finalLocation.lat];
                            anim.prevBearing = displayBearing;
                            anim.targetBearing = displayBearing;
                            anim.currentBearing = displayBearing;
                            anim.startTime = performance.now();
                            marker.setLngLat([finalLocation.lng, finalLocation.lat]);
                            marker.setRotation(displayBearing);
                        } else {
                            anim.prevCoords = [anim.currentCoords[0], anim.currentCoords[1]];
                            anim.targetCoords = [finalLocation.lng, finalLocation.lat];
                            anim.prevBearing = anim.currentBearing;
                            anim.targetBearing = displayBearing;
                            anim.startTime = performance.now();
                            anim.duration = 1000;
                            triggerPuckAnimation();
                        }
                    }
                } else {
                    marker.setRotationAlignment('auto');
                    marker.setPitchAlignment('auto');
                    marker.setRotation(0);
                    marker.setLngLat([finalLocation.lng, finalLocation.lat]);
                }

            } else {
                // ── GROUPED CLUSTER PILL MARKER ──
                const clusterMembers = cluster.members;
                const clusterKey = 'cluster_' + clusterMembers.map(m => m.id).sort().join('_');

                // Hide individual markers for clustered members (they may exist from a previous frame)
                clusterMembers.forEach(m => {
                    const existing = membersMarkersRef.current.get(m.id);
                    if (existing) {
                        existing.remove();
                        membersMarkersRef.current.delete(m.id);
                    }
                });

                // Build group label: "Alice & Bob" or "3 Members" if too long / ≥3 members
                const names = clusterMembers.map(m => (m.name || 'Member').split(' ')[0]);
                let groupLabel: string;
                if (clusterMembers.length >= 3 || names.join(' & ').length > 18) {
                    groupLabel = `${clusterMembers.length} Members`;
                } else {
                    groupLabel = names.join(' & ');
                }

                // Find if the group is near a saved place for a context badge
                let nearbyPlaceName = '';
                if (places && places.length > 0) {
                    for (const p of places) {
                        if (p.location && getDistanceMeters(cluster.centroid, p.location) < 50) {
                            nearbyPlaceName = p.name || '';
                            break;
                        }
                    }
                }

                // Determine a shared accent color from the first member
                const accentColor = clusterMembers[0].circleColor || '#6366f1';

                // Build stacked avatar HTML: horizontal flex with negative margins for overlap
                const avatarStackHtml = clusterMembers.slice(0, 4).map((m, i) => {
                    const init = (m.name || 'M').charAt(0).toUpperCase();
                    const marginLeft = i === 0 ? '0' : '-10px';
                    const zIndex = 10 - i;
                    const mColor = m.circleColor || '#6366f1';
                    const hasAvatar = m.avatar && !m.avatar.includes('default');
                    return `<div style="position: relative; z-index: ${zIndex}; margin-left: ${marginLeft}; width: 34px; height: 34px; border-radius: 50%; border: 2.5px solid #0f172a; background: #1e293b; box-shadow: 0 3px 10px rgba(0,0,0,0.5); overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        ${hasAvatar ? `<img src="${m.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
                        <span style="${hasAvatar ? 'display: none;' : 'display: flex;'} font-weight: 900; color: #ffffff; font-size: 13px;">${init}</span>
                        <div style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: ${mColor}; border: 1.5px solid #0f172a;"></div>
                    </div>`;
                }).join('');

                // Overflow indicator if more than 4 members
                const overflowBadge = clusterMembers.length > 4
                    ? `<div style="margin-left: -8px; z-index: 1; width: 28px; height: 28px; border-radius: 50%; background: rgba(100, 116, 139, 0.8); border: 2px solid #0f172a; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: #ffffff; flex-shrink: 0;">+${clusterMembers.length - 4}</div>`
                    : '';

                const clusterMarkerHtml = `
                    <div class="myway-cluster-pill select-none" style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer; animation: fadeIn 0.2s ease-out;">
                        <!-- Shared pulse ring -->
                        <div style="position: absolute; top: 50%; left: 50%; width: 60px; height: 60px; transform: translate(-50%, -55%); border-radius: 50%; background: ${accentColor}; opacity: 0.2; animation: ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite; pointer-events: none;"></div>
                        <!-- Avatar stack row -->
                        <div style="position: relative; display: flex; flex-direction: row; align-items: center;">
                            ${avatarStackHtml}
                            ${overflowBadge}
                        </div>
                        <!-- Group label pill -->
                        <div style="margin-top: 3px; padding: 1px 8px; border-radius: 999px; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(6px); border: 1px solid ${accentColor}66; color: #ffffff; font-size: 9px; font-weight: 800; white-space: nowrap; display: flex; align-items: center; gap: 4px; box-shadow: 0 3px 12px rgba(0,0,0,0.6);">
                            <span style="width: 5px; height: 5px; border-radius: 50%; background: ${accentColor}; flex-shrink: 0;"></span>
                            <span>${groupLabel}</span>
                            ${nearbyPlaceName ? `<span style="color: rgba(255,255,255,0.5); font-size: 8px; margin-left: 2px;">· ${nearbyPlaceName}</span>` : ''}
                        </div>
                    </div>
                `;

                const selectableClusterMembers = clusterMembers.filter(m => !checkIsMemberSelf(m.id, currentUserId));
                const isAllClusterSelf = selectableClusterMembers.length === 0;

                let clusterMarker = clusterMarkersRef.current.get(clusterKey);
                if (!clusterMarker) {
                    const el = document.createElement('div');
                    el.className = `myway-cluster-marker select-none ${isAllClusterSelf ? 'cursor-default' : 'cursor-pointer'}`;
                    el.style.cursor = isAllClusterSelf ? 'default' : 'pointer';
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.alignItems = 'center';
                    el.style.transform = 'translate3d(0,0,0)';
                    el.innerHTML = clusterMarkerHtml;
                    (el as any)._lastHtml = clusterMarkerHtml;

                    // Click handler: select first non-self member, cycle on repeated taps
                    let tapIndex = 0;
                    const handleClusterClick = (e: Event) => {
                        e.stopPropagation();
                        if ((e as any).originalEvent?.stopPropagation) {
                            (e as any).originalEvent.stopPropagation();
                        }
                        lastMemberSelectTimeRef.current = Date.now();
                        const currentSelectable = clusterMembers.filter(m => !checkIsMemberSelf(m.id, currentUserId));
                        if (currentSelectable.length === 0) return;
                        const targetMember = currentSelectable[tapIndex % currentSelectable.length];
                        onSelectMemberRef.current?.(targetMember.id);
                        tapIndex++;
                    };
                    el.addEventListener('click', handleClusterClick);
                    const stopClusterPointerPropagation = (e: Event) => {
                        e.stopPropagation();
                        if ((e as any).originalEvent?.stopPropagation) {
                            (e as any).originalEvent.stopPropagation();
                        }
                    };
                    el.addEventListener('pointerdown', stopClusterPointerPropagation);
                    el.addEventListener('mousedown', stopClusterPointerPropagation);
                    el.addEventListener('touchstart', stopClusterPointerPropagation, { passive: false });

                    clusterMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
                        .setLngLat([cluster.centroid.lng, cluster.centroid.lat])
                        .addTo(map.current!);
                    clusterMarkersRef.current.set(clusterKey, clusterMarker);
                } else {
                    const existingClusterEl = clusterMarker.getElement();
                    existingClusterEl.style.cursor = isAllClusterSelf ? 'default' : 'pointer';
                    // Update HTML only if changed (prevents DOM thrashing)
                    if ((existingClusterEl as any)._lastHtml !== clusterMarkerHtml) {
                        existingClusterEl.innerHTML = clusterMarkerHtml;
                        (existingClusterEl as any)._lastHtml = clusterMarkerHtml;
                    }
                    clusterMarker.setLngLat([cluster.centroid.lng, cluster.centroid.lat]);
                }
            }
        });
    }, [members, userLocation?.lat, userLocation?.lng, currentUserId, userProfile?.displayName, userProfile?.photoURL, isMapReady, isNavigating, routeCoords, currentStepIndex, mapSkin, theme, styleVersion, onSelectMember, places, savedPlaces]);

    // ==========================================
    // VEHICLE PUCK INTERPOLATION LIFECYCLE & CLEANUP
    // ==========================================
    useEffect(() => {
        if (!isNavigating) {
            if (puckRafIdRef.current) {
                cancelAnimationFrame(puckRafIdRef.current);
                puckRafIdRef.current = null;
            }
            isPuckAnimatingRef.current = false;
        }
    }, [isNavigating]);

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
            if (puckRafIdRef.current) {
                cancelAnimationFrame(puckRafIdRef.current);
                puckRafIdRef.current = null;
            }
            isPuckAnimatingRef.current = false;
            if (selfMarkerRef.current) {
                selfMarkerRef.current.setRotationAlignment('auto');
                selfMarkerRef.current.setPitchAlignment('auto');
                selfMarkerRef.current.setRotation(0);
            }
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

            // Compute travel bearing from synchronized puck bearing, driver device heading, or route polyline
            let travelBearing = latestBearingRef.current || 0;
            if (travelBearing === 0) {
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
            const containerWidth = mapContainer.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1000);
            const isLandscape = containerWidth > containerHeight;
            const navTopPadding = isLandscape ? Math.round(containerHeight * 0.42) : Math.round(containerHeight * 0.52); // Anchors vehicle at proper height (42% in landscape, 52% in portrait)

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
                            maxZoom: isMobileRef.current ? 17.5 : 18.0,
                            padding: {
                                top: Math.round(containerHeight * 0.35),
                                bottom: 40,
                                left: isMobileRef.current ? 50 : 160,
                                right: isMobileRef.current ? 50 : 80
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
                    zoom: isMobileRef.current ? 18.2 : 18.4,
                    padding: {
                        top: navTopPadding,
                        bottom: 0,
                        left: isMobileRef.current ? 0 : 120,
                        right: 0
                    },
                    duration: isInitialNavStart ? 1200 : 1000,
                    easing: (t: number) => t
                });
            }
            return;
        }
    }, [members, userLocation?.lat, userLocation?.lng, currentUserId, isNavigating, isMapReady, routeCoords, is3DMode, isCameraFree, currentStepIndex]);

    // Camera control — initial center and member selection
    useEffect(() => {
        if (map.current && members.length > 0 && !selectedMemberId && !center && !isNavigating) {
            const you = members.find(m => (m.id === 'demo-you' || m.id === members[0].id) && !(m.location.lat === 0 && m.location.lng === 0));
            if (you) map.current.easeTo({ center: [you.location.lng, you.location.lat], zoom: 16.5, pitch: is3DMode ? 60 : 0, duration: 600 });
        }
    }, [members.length > 0]);

    useEffect(() => {
        if (!map.current || !selectedMemberId) return;
        const member = members.find(m => m.id === selectedMemberId);
        if (!member || !member.location) return;
        const lat = (member.location as any).latitude ?? member.location.lat;
        const lng = (member.location as any).longitude ?? member.location.lng;
        // Guard: skip flying to Null Island (0, 0) for members without a valid location broadcast
        if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0) || isNaN(lat) || isNaN(lng)) return;
        const currentCenter = map.current.getCenter();
        const dist = Math.hypot(currentCenter.lng - lng, currentCenter.lat - lat);
        if (dist > 0.0001) {
            const curZoom = map.current.getZoom();
            const targetZoom = Math.max(16, curZoom);
            if (dist > 0.25) {
                map.current.flyTo({ center: [lng, lat], zoom: targetZoom, pitch: is3DMode ? 60 : 0, speed: 2.5, curve: 1.0, maxDuration: 850, essential: true });
            } else {
                map.current.easeTo({ center: [lng, lat], zoom: targetZoom, pitch: is3DMode ? 60 : 0, duration: 550, essential: true });
            }
        }
    }, [selectedMemberId, is3DMode]);

    const lastAnimatedCenterRef = useRef<{ lng: number; lat: number } | null>(null);
    const centerLng = center ? center[0] : null;
    const centerLat = center ? center[1] : null;

    useEffect(() => {
        if (!map.current || typeof centerLng !== 'number' || typeof centerLat !== 'number' || isNavigating) return; // Don't override nav camera

        // Guard: if we already animated to this coordinate target, skip to prevent animation restart loops
        if (lastAnimatedCenterRef.current &&
            Math.abs(lastAnimatedCenterRef.current.lng - centerLng) < 0.00005 &&
            Math.abs(lastAnimatedCenterRef.current.lat - centerLat) < 0.00005) {
            return;
        }

        const currentCenter = map.current.getCenter();
        const dist = Math.hypot(currentCenter.lng - centerLng, currentCenter.lat - centerLat);
        if (dist > 0.0001) {
            lastAnimatedCenterRef.current = { lng: centerLng, lat: centerLat };
            const padding = isMobile ? { top: 0, bottom: 200, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 };
            const curZoom = map.current.getZoom();
            const targetZoom = Math.max(16, curZoom);
            if (dist > 0.25) {
                map.current.flyTo({
                    center: [centerLng, centerLat],
                    zoom: targetZoom,
                    pitch: is3DMode ? 60 : 0,
                    speed: 2.5,
                    curve: 1.0,
                    maxDuration: 850,
                    essential: true,
                    padding
                });
            } else {
                map.current.easeTo({
                    center: [centerLng, centerLat],
                    zoom: targetZoom,
                    pitch: is3DMode ? 60 : 0,
                    duration: 550,
                    essential: true,
                    padding
                });
            }
        }
    }, [centerLng, centerLat, isNavigating, isMobile, is3DMode]);

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
                className={`absolute inset-0 w-full h-full ${
                    isNavigating ? 'cursor-none' : ''
                }`}
                style={{ 
                    background: theme === 'dark' ? '#0f172a' : '#f1f5f9',
                    // AUDIT FIX: Ghost Mode Ambiguity Indicator
                    // Outer glow when in privacy mode
                    boxShadow: !members.find(m => m.id === 'demo-you')?.locationSharing 
                        ? 'inset 0 0 100px rgba(217, 70, 239, 0.4)' 
                        : 'none'
                }} 
            />

            {/* Unified Map Controls & Alerts Tool Stack */}
            <div 
                className={`absolute z-40 pointer-events-auto flex flex-col items-center gap-3 transition-all duration-300 map-controls-cluster ${
                    isMobile
                        ? (isNavigating 
                            ? 'right-[max(0.875rem,env(safe-area-inset-right,0px))] bottom-32' 
                            : 'right-[max(1rem,env(safe-area-inset-right,0px))] bottom-48 sm:bottom-52')
                        : (isNavigating ? 'right-6 bottom-32' : 'right-6 bottom-36')
                } landscape:!bottom-[max(6rem,calc(env(safe-area-inset-bottom,0px)+5rem))] landscape:!top-auto landscape:!right-[max(1rem,calc(env(safe-area-inset-right,0px)+0.75rem))]`}
            >
                {/* 1-Tap Road Alert / Incident Reporter Button (Docked cleanly above Zoom controls) */}
                {onOpenAlerts && (
                    <button
                        type="button"
                        onClick={onOpenAlerts}
                        title="Report Road Hazard, Police Trap, or Incident"
                        className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all select-none bg-white hover:bg-amber-50 border border-gray-100 text-amber-500 active:scale-95 shadow-md cursor-pointer"
                    >
                        <AlertTriangle className="w-5 h-5" />
                    </button>
                )}
                {/* Map Style Radial / Layer Picker (slides out to the left when held/toggled) */}
                {showStylePicker && (
                    <div className="absolute right-14 bottom-0 flex items-center gap-1.5 bg-white rounded-2xl p-1.5 border border-gray-100 shadow-xl animate-in slide-in-from-right duration-200">
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
                                        ? 'bg-purple-600 text-white ring-2 ring-purple-400 shadow-md scale-105'
                                        : 'bg-gray-50 border border-gray-100 text-gray-700 hover:bg-gray-100'
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
                <div className="flex flex-col p-1 bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden divide-y divide-gray-100">
                    {/* Zoom In */}
                    <button
                        type="button"
                        onClick={() => map.current?.zoomIn({ duration: 250 })}
                        title="Zoom In"
                        className="w-10 h-10 flex items-center justify-center text-gray-700 hover:text-gray-900 hover:bg-gray-50 active:scale-95 transition-all text-xl font-bold select-none cursor-pointer"
                    >
                        +
                    </button>

                    {/* Zoom Out */}
                    <button
                        type="button"
                        onClick={() => map.current?.zoomOut({ duration: 250 })}
                        title="Zoom Out"
                        className="w-10 h-10 flex items-center justify-center text-gray-700 hover:text-gray-900 hover:bg-gray-50 active:scale-95 transition-all text-xl font-bold select-none cursor-pointer"
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
                                ? 'bg-white text-orange-500 font-bold hover:bg-orange-50/50' 
                                : 'bg-white text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                    >
                        <span className={`text-[11px] font-black leading-none tracking-tight ${
                            is3DMode ? 'text-orange-500' : 'text-gray-900'
                        }`}>
                            {is3DMode ? '3D' : '2D'}
                        </span>
                        <span className={`text-[7px] font-black uppercase tracking-tighter mt-0.5 ${
                            is3DMode ? 'text-orange-500 font-bold' : 'text-gray-500'
                        }`}>
                            {mapStyle === 'satellite' ? 'SAT' : mapStyle === 'terrain' ? 'TER' : 'MAP'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(MapLibre3DView);
