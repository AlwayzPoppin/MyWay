import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Place, Location, EntranceType, EntranceBox, EntrancePrecision } from '../types';
import { getRotatedBoxCoords, DEFAULT_ENTRANCE_BOX } from '../services/geofenceService';
import { getDistanceMeters, getBearing } from '../utils/geo';
import { getPlacePhotoKey, placePhotoService } from '../services/placePhotoService';
import { contributionService } from '../services/contributionService';
import { hapticError, hapticSuccess, hapticTick } from '../utils/haptics';
import BrandIcon from './BrandIcon';
import {
    Home,
    Briefcase,
    GraduationCap,
    Dumbbell,
    Utensils,
    Coffee,
    Fuel,
    MapPin,
    X,
    Car,
    SquareParking,
    LocateFixed,
    RotateCcw,
    RotateCw,
    Save,
    Trash2,
    Camera,
    Loader2
} from 'lucide-react';

export type ActiveZoneType = 'none' | 'driveway' | 'parking';

export const ENTRANCE_CATEGORY_OPTIONS: {
    id: ActiveZoneType;
    label: string;
    icon: string;
    iconComp: React.ComponentType<{ className?: string }>;
    description: string;
}[] = [
    { id: 'none', label: 'Standard', icon: '📍', iconComp: MapPin, description: 'Circular geofence only' },
    { id: 'driveway', label: 'Driveway', icon: '🚗', iconComp: Car, description: 'Driveway access from street' },
    { id: 'parking', label: 'Parking Lot', icon: '🅿️', iconComp: SquareParking, description: 'Lot entrance or gate' }
];

export const ENTRANCE_CATEGORY_RADIUS: Record<ActiveZoneType, number> = {
    none: 50,
    driveway: 15,
    parking: 25
};

interface EditPlaceModalProps {
    place: Place | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (placeId: string, updates: Partial<Place>) => void | Promise<void>;
    onUpdatePlace?: (placeId: string, updates: Partial<Place>) => void;
    onDelete?: (placeId: string) => void;
    onCorrectLocation?: (place: Place) => void;
    userLocation?: Location | null;
    theme?: 'light' | 'dark';
    currentUserId?: string;
    currentUserName?: string;
    currentUserAvatar?: string;
    onPhotoUploaded?: (placeId: string, photoUrl: string) => void;
}

const PLACE_CATEGORIES = [
    { type: 'home', icon: '🏠', iconComp: Home, label: 'Home' },
    { type: 'work', icon: '💼', iconComp: Briefcase, label: 'Work' },
    { type: 'school', icon: '🏫', iconComp: GraduationCap, label: 'School' },
    { type: 'gym', icon: '🏋️', iconComp: Dumbbell, label: 'Gym' },
    { type: 'food', icon: '🍔', iconComp: Utensils, label: 'Food' },
    { type: 'coffee', icon: '☕', iconComp: Coffee, label: 'Coffee' },
    { type: 'gas', icon: '⛽', iconComp: Fuel, label: 'Gas' },
    { type: 'other', icon: '📍', iconComp: MapPin, label: 'Other' },
];

function getDirectionLabel(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
    return directions[index];
}

/**
 * Generates an array of [lng, lat] coordinate pairs forming a closed polygon
 * approximating a circular geofence boundary with the specified radius in meters.
 */
function createCirclePolygonCoords(center: Location, radiusMeters: number, points: number = 64): [number, number][] {
    if (!center.lat || !center.lng || radiusMeters <= 0) return [];
    const coords: [number, number][] = [];
    const km = radiusMeters / 1000;
    const latDelta = km / 110.574;
    const radLat = (center.lat * Math.PI) / 180;
    const lngDelta = km / (111.320 * Math.cos(radLat));

    for (let i = 0; i <= points; i++) {
        const theta = (i / points) * (2 * Math.PI);
        const lng = center.lng + lngDelta * Math.cos(theta);
        const lat = center.lat + latDelta * Math.sin(theta);
        coords.push([parseFloat(lng.toFixed(6)), parseFloat(lat.toFixed(6))]);
    }
    return coords;
}

const EditPlaceModal: React.FC<EditPlaceModalProps> = ({
    place,
    isOpen,
    onClose,
    onSave,
    onUpdatePlace,
    onDelete,
    onCorrectLocation,
    userLocation,
    theme = 'dark',
    currentUserId,
    currentUserName,
    currentUserAvatar,
    onPhotoUploaded
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<maplibregl.Map | null>(null);
    const mapAnchorDotRef = useRef<HTMLDivElement>(null);

    const [name, setName] = useState('');
    const [icon, setIcon] = useState('📍');
    const [type, setType] = useState<string>('other');
    const [radius, setRadius] = useState<number>(0.05);
    // Map move events run outside React's render cycle. Keep the current value
    // available so their geometry update stays in lockstep with the reticle.
    const radiusRef = useRef(radius);
    radiusRef.current = radius;
    const [savedPresetNotice, setSavedPresetNotice] = useState<string | null>(null);
    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Entrance approach and zone footprint state
    const [currentCoords, setCurrentCoords] = useState<Location>({ lat: 0, lng: 0 });
    const [entranceType, setEntranceType] = useState<ActiveZoneType>('none');
    const entranceTypeRef = useRef<ActiveZoneType>('none');
    entranceTypeRef.current = entranceType;
    const [entranceRadius, setEntranceRadius] = useState<number>(15);
    const [rotationDeg, setRotationDeg] = useState<number>(0);
    const [entranceBox, setEntranceBox] = useState<EntranceBox>({
        widthMeters: 10,
        lengthMeters: 22,
        rotationDeg: 0
    });
    const entranceBoxRef = useRef<EntranceBox>({
        ...entranceBox,
        rotationDeg
    });
    entranceBoxRef.current = {
        ...entranceBox,
        rotationDeg
    };

    const [pixelsPerMeter, setPixelsPerMeter] = useState(2.2);
    const [isMapLoaded, setIsMapLoaded] = useState(false);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [photoFeedback, setPhotoFeedback] = useState<string | null>(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
    const photoInputRef = useRef<HTMLInputElement | null>(null);

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';
    const bgColor = isDark ? 'bg-slate-900/98 border-white/10 text-white' : 'bg-white/98 border-slate-200 text-slate-900';

    // Calculate displacement from original place coordinates (house / building pin)
    const originalPlaceCoords = (place?.originalLocation?.lat && place?.originalLocation?.lng)
        ? place.originalLocation
        : (place?.location || { lat: 0, lng: 0 });
    const distanceMeters = currentCoords.lat && originalPlaceCoords.lat
        ? Math.round(getDistanceMeters(originalPlaceCoords, currentCoords))
        : 0;
    const distanceFeet = Math.round(distanceMeters * 3.28084);
    const bearing = currentCoords.lat && originalPlaceCoords.lat
        ? Math.round(getBearing(originalPlaceCoords, currentCoords))
        : 0;
    const direction = getDirectionLabel(bearing);

    const updatePixelsPerMeter = useCallback((map: maplibregl.Map) => {
        try {
            let centerLngLat = map.getCenter();
            if (mapContainerRef.current) {
                const rect = mapContainerRef.current.getBoundingClientRect();
                centerLngLat = map.unproject([rect.width / 2, rect.height / 2]);
            }
            const p1 = map.project([centerLngLat.lng, centerLngLat.lat]);
            const p2 = map.project([centerLngLat.lng, centerLngLat.lat + (10 / 111320)]);
            const distPx = Math.abs(p2.y - p1.y);
            if (distPx > 0) {
                setPixelsPerMeter(distPx / 10);
            }
        } catch {
            // fallback
        }
    }, []);

    // Helper to get screen center point of map container
    const getMapCenterScreenPoint = useCallback(() => {
        if (!mapContainerRef.current) return { x: 0, y: 0 };
        const rect = mapContainerRef.current.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }, []);

    // Interactive Drag Manipulation for Rotation
    const handleRotateStart = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        hapticTick();

        const center = getMapCenterScreenPoint();

        const onPointerMove = (ev: PointerEvent) => {
            const dx = ev.clientX - center.x;
            const dy = ev.clientY - center.y;
            // atan2: 0 is East (+X), -90 is North (-Y). North is 0 deg.
            const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
            const deg = Math.round((angleDeg + 90 + 360) % 360);
            setRotationDeg(deg);
            setEntranceBox(prev => ({ ...prev, rotationDeg: deg }));
        };

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            hapticTick();
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    // Interactive Drag Manipulation for Resizing (Width, Length, or Corner)
    const handleResizeStart = (
        gestureType: 'width' | 'length' | 'corner',
        e: React.PointerEvent
    ) => {
        e.preventDefault();
        e.stopPropagation();
        hapticTick();

        const center = getMapCenterScreenPoint();
        const currentDeg = rotationDeg;

        const onPointerMove = (ev: PointerEvent) => {
            const dx = ev.clientX - center.x;
            const dy = ev.clientY - center.y;

            // Transform screen delta into box's rotated local coordinate space
            const rad = -currentDeg * (Math.PI / 180);
            const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
            const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

            if (gestureType === 'width') {
                const widthM = Math.round((Math.abs(localX) * 2) / pixelsPerMeter);
                const clampedW = Math.max(6, Math.min(35, widthM));
                setEntranceBox(prev => ({ ...prev, widthMeters: clampedW, rotationDeg: currentDeg }));
            } else if (gestureType === 'length') {
                const lengthM = Math.round((Math.abs(localY) * 2) / pixelsPerMeter);
                const clampedL = Math.max(10, Math.min(55, lengthM));
                setEntranceBox(prev => ({ ...prev, lengthMeters: clampedL, rotationDeg: currentDeg }));
            } else if (gestureType === 'corner') {
                const widthM = Math.round((Math.abs(localX) * 2) / pixelsPerMeter);
                const lengthM = Math.round((Math.abs(localY) * 2) / pixelsPerMeter);
                const clampedW = Math.max(6, Math.min(35, widthM));
                const clampedL = Math.max(10, Math.min(55, lengthM));
                setEntranceBox(prev => ({ ...prev, widthMeters: clampedW, lengthMeters: clampedL, rotationDeg: currentDeg }));
            }
        };

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            hapticTick();
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    // Initialize from place props
    useEffect(() => {
        if (place) {
            setStep(1);
            setName(place.name || '');
            setIcon(place.icon || '📍');
            setType(place.type || 'other');
            const rawRadius = (typeof place.radius === 'number' && !isNaN(place.radius) && place.radius > 0)
                ? place.radius
                : (typeof place.departureRadius === 'number' && !isNaN(place.departureRadius) && place.departureRadius > 0)
                    ? place.departureRadius
                    : 0.05;
            setRadius(rawRadius > 5 ? rawRadius / 1000 : rawRadius);
            setSavedPresetNotice(null);

            // Precision coordinates: entrancePrecision.location > entrancePin > entranceLocation > location
            const loc = place.entrancePrecision?.location || place.entrancePin || place.entranceLocation || place.location || { lat: 35.105, lng: -78.966 };
            setCurrentCoords({ lat: loc.lat, lng: loc.lng });

            // Check if place explicitly has an existing custom box configured
            const existingBox = place.entrancePrecision?.box || (place as any).entranceBox;
            const hasCustomBox = Boolean(
                existingBox &&
                typeof existingBox.widthMeters === 'number' &&
                typeof existingBox.lengthMeters === 'number' &&
                existingBox.widthMeters > 0 &&
                existingBox.lengthMeters > 0
            );

            // Category normalization:
            // Only initialize to 'driveway' or 'parking' if the place ALREADY has an explicit custom box or type configured!
            // Normal saved places strictly default to 'none' (Standard Circular Geofence) so users are never surprised by an unrequested driveway box!
            let initialType: ActiveZoneType = 'none';
            if (hasCustomBox) {
                initialType = place.entranceType === 'parking' ? 'parking' : 'driveway';
            } else if (place.entranceType === 'driveway' || place.entranceType === 'parking') {
                initialType = place.entranceType;
            } else {
                initialType = 'none';
            }
            setEntranceType(initialType);
            entranceTypeRef.current = initialType;

            if (place.entrancePrecision?.radius) {
                setEntranceRadius(place.entrancePrecision.radius);
            } else {
                setEntranceRadius(ENTRANCE_CATEGORY_RADIUS[initialType] ?? 50);
            }

            if (hasCustomBox && existingBox) {
                setEntranceBox(existingBox);
                setRotationDeg(existingBox.rotationDeg || 0);
            } else {
                const defBox = (initialType !== 'none' && DEFAULT_ENTRANCE_BOX[initialType as EntranceType])
                    ? DEFAULT_ENTRANCE_BOX[initialType as EntranceType]
                    : DEFAULT_ENTRANCE_BOX.driveway;
                setEntranceBox(defBox);
                setRotationDeg(defBox.rotationDeg || 0);
            }
        }
    }, [place, isOpen]);

    // Live handler for departure radius slider and quick-preset chips
    const handleRadiusChange = useCallback((newRadiusKm: number) => {
        const clampedKm = Math.max(0.015, Math.min(2.0, parseFloat(newRadiusKm.toFixed(3))));
        const radiusMeters = Math.round(clampedKm * 1000);
        setRadius(clampedKm);

        if (entranceType === 'none') {
            setEntranceRadius(radiusMeters);
        }

        // 1. Live update internal modal preview map layers immediately
        if (mapInstanceRef.current && isMapLoaded) {
            const primarySource = mapInstanceRef.current.getSource('primary-geofence-source') as maplibregl.GeoJSONSource;
            if (primarySource) {
                const center = mapInstanceRef.current.getCenter();
                const centerLoc = { lat: center.lat, lng: center.lng };
                const circleCoords = createCirclePolygonCoords(centerLoc, radiusMeters);
                primarySource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'Polygon',
                        coordinates: circleCoords.length > 0 ? [circleCoords] : []
                    }
                });
            }

            // Adjust viewport zoom smoothly so the full circle is visible when moving between 15m and 2km
            let targetZoom: number | null = null;
            if (radiusMeters >= 1500) targetZoom = 13.8;
            else if (radiusMeters >= 800) targetZoom = 14.8;
            else if (radiusMeters >= 250) targetZoom = 16.0;
            else if (radiusMeters >= 100) targetZoom = 16.8;

            if (targetZoom !== null && Math.abs(mapInstanceRef.current.getZoom() - targetZoom) > 0.4) {
                mapInstanceRef.current.easeTo({ zoom: targetZoom, duration: 350 });
            }
        }

        // 2. Live notify parent map component (MapLibre3DView via App.tsx)
        if (place?.id && onUpdatePlace) {
            onUpdatePlace(place.id, {
                radius: clampedKm,
                departureRadius: radiusMeters,
                ...(entranceType === 'none' ? {
                    entrancePrecision: {
                        location: currentCoords.lat ? currentCoords : (place.location || { lat: 0, lng: 0 }),
                        radius: radiusMeters
                    }
                } : {})
            });
        }
    }, [place?.id, onUpdatePlace, entranceType, currentCoords, originalPlaceCoords, isMapLoaded]);

    // Live sync map layers when box dimensions, rotation, or circular geofence radius changes
    useEffect(() => {
        if (!mapInstanceRef.current || !isMapLoaded) return;
        const center = mapInstanceRef.current.getCenter();
        const centerLoc = { lat: center.lat, lng: center.lng };
        const activeBox: EntranceBox = { ...entranceBox, rotationDeg };

        // 1. The editable geofence always follows the one center reticle.
        const primarySource = mapInstanceRef.current.getSource('primary-geofence-source') as maplibregl.GeoJSONSource;
        if (primarySource) {
            const geofenceRadiusMeters = (radius && radius > 5 ? radius : (radius || 0.05) * 1000);
            const circleCoords = createCirclePolygonCoords(centerLoc, geofenceRadiusMeters);
            primarySource.setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'Polygon',
                    coordinates: circleCoords.length > 0 ? [circleCoords] : []
                }
            });
        }

        // 2. Entrance Bounding Box Layer (Active driveway/parking zone)
        const innerSource = mapInstanceRef.current.getSource('reticle-geofence-source') as maplibregl.GeoJSONSource;
        if (innerSource) {
            if (entranceType !== 'none') {
                const boxCoords = getRotatedBoxCoords(centerLoc, activeBox);
                innerSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [boxCoords] }
                });
            } else {
                innerSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [] }
                });
            }
        }

        // 3. Entrance Hysteresis Layer
        const hystSource = mapInstanceRef.current.getSource('reticle-hysteresis-source') as maplibregl.GeoJSONSource;
        if (hystSource) {
            if (entranceType !== 'none') {
                const hystCoords = getRotatedBoxCoords(centerLoc, activeBox, 5);
                hystSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [hystCoords] }
                });
            } else {
                hystSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [] }
                });
            }
        }
    }, [entranceType, entranceBox, rotationDeg, radius, currentCoords.lat, currentCoords.lng, originalPlaceCoords.lat, originalPlaceCoords.lng, isMapLoaded]);

    // Initialize MapLibre Interactive Map Viewport
    useEffect(() => {
        if (!isOpen || !place || step !== 2 || !mapContainerRef.current) return;

        const initialLat = currentCoords.lat || place.entrancePrecision?.location?.lat || place.entrancePin?.lat || place.entranceLocation?.lat || place.location?.lat || 35.105;
        const initialLng = currentCoords.lng || place.entrancePrecision?.location?.lng || place.entrancePin?.lng || place.entranceLocation?.lng || place.location?.lng || -78.966;

        const mapStyleUrl = isDark
            ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: mapStyleUrl,
            center: [initialLng, initialLat],
            zoom: 17.5,
            pitch: 0,
            attributionControl: false
        });

        mapInstanceRef.current = map;

        map.on('load', () => {
            setIsMapLoaded(true);
            map.resize();
            updatePixelsPerMeter(map);

            // 1. One editable geofence boundary centered on the reticle location.
            const geofenceRadiusMeters = (radius && radius > 5 ? radius : (radius || 0.05) * 1000);
            const mapCenter = map.getCenter();
            const editCenter = { lat: mapCenter.lat, lng: mapCenter.lng };
            const circleCoords = createCirclePolygonCoords(editCenter, geofenceRadiusMeters);

            if (!map.getSource('primary-geofence-source')) {
                map.addSource('primary-geofence-source', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'Polygon',
                            coordinates: circleCoords.length > 0 ? [circleCoords] : []
                        }
                    }
                });

                map.addLayer({
                    id: 'primary-geofence-fill',
                    type: 'fill',
                    source: 'primary-geofence-source',
                    paint: {
                        'fill-color': '#8b5cf6',
                        'fill-opacity': isDark ? 0.12 : 0.10
                    }
                });

                map.addLayer({
                    id: 'primary-geofence-outline',
                    type: 'line',
                    source: 'primary-geofence-source',
                    paint: {
                        'line-color': '#8b5cf6',
                        'line-width': 1.5,
                        'line-opacity': 0.6
                    }
                });
            }

            // 2. Secondary Entrance Bounding Box & Hysteresis Buffer (Active driveway/parking zone)
            const center = map.getCenter();
            const centerLoc = { lat: center.lat, lng: center.lng };
            const boxCoords = entranceTypeRef.current !== 'none' ? getRotatedBoxCoords(centerLoc, entranceBoxRef.current) : [];

            if (!map.getSource('reticle-geofence-source')) {
                map.addSource('reticle-geofence-source', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'Polygon', coordinates: boxCoords.length > 0 ? [boxCoords] : [] }
                    }
                });

                map.addLayer({
                    id: 'reticle-geofence-fill',
                    type: 'fill',
                    source: 'reticle-geofence-source',
                    paint: {
                        'fill-color': isDark ? '#14b8a6' : '#0d9488',
                        'fill-opacity': isDark ? 0.22 : 0.18
                    }
                });

                map.addLayer({
                    id: 'reticle-geofence-glow',
                    type: 'line',
                    source: 'reticle-geofence-source',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': isDark ? '#2dd4bf' : '#14b8a6',
                        'line-width': 6.0,
                        'line-opacity': isDark ? 0.35 : 0.25,
                        'line-blur': 3.0
                    }
                });

                map.addLayer({
                    id: 'reticle-geofence-outline',
                    type: 'line',
                    source: 'reticle-geofence-source',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': isDark ? '#2dd4bf' : '#0d9488',
                        'line-width': 2.5,
                        'line-opacity': 0.95
                    }
                });
            }

            const hystCoords = entranceTypeRef.current !== 'none' ? getRotatedBoxCoords(centerLoc, entranceBoxRef.current, 5) : [];
            if (!map.getSource('reticle-hysteresis-source')) {
                map.addSource('reticle-hysteresis-source', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'Polygon', coordinates: hystCoords.length > 0 ? [hystCoords] : [] }
                    }
                });

                map.addLayer({
                    id: 'reticle-hysteresis-outline',
                    type: 'line',
                    source: 'reticle-hysteresis-source',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': isDark ? '#2dd4bf' : '#14b8a6',
                        'line-width': 1.4,
                        'line-opacity': isDark ? 0.45 : 0.35,
                        'line-dasharray': [2, 3]
                    }
                });
            }

            // Ensure reticle-geofence renders above primary-geofence
            try {
                if (map.getLayer('reticle-geofence-fill')) {
                    map.moveLayer('reticle-geofence-fill');
                }
                if (map.getLayer('reticle-geofence-glow')) {
                    map.moveLayer('reticle-geofence-glow');
                }
                if (map.getLayer('reticle-geofence-outline')) {
                    map.moveLayer('reticle-geofence-outline');
                }
            } catch (e) {
                console.debug('Reticle layer reordering skipped:', e);
            }
        });

        map.on('zoom', () => {
            updatePixelsPerMeter(map);
        });

        const t1 = setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.resize();
                updatePixelsPerMeter(mapInstanceRef.current);
            }
        }, 100);

        const t2 = setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.resize();
                updatePixelsPerMeter(mapInstanceRef.current);
            }
        }, 300);

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
            resizeObserver = new ResizeObserver(() => {
                if (mapInstanceRef.current) {
                    mapInstanceRef.current.resize();
                    updatePixelsPerMeter(mapInstanceRef.current);
                }
            });
            resizeObserver.observe(mapContainerRef.current);
        }

        const updateCoordsFromCenter = () => {
            if (!mapContainerRef.current || !mapInstanceRef.current) return null;
            // Use the MapLibre viewport's own center pixel. Its canvas can be a
            // different size from the surrounding DOM during a modal resize.
            // This keeps the stored coordinate, radius, and visible anchor at
            // exactly the same point.
            const centerPoint = mapInstanceRef.current.project(mapInstanceRef.current.getCenter());
            const unprojected = mapInstanceRef.current.unproject(centerPoint);
            if (mapAnchorDotRef.current) {
                mapAnchorDotRef.current.style.left = `${centerPoint.x}px`;
                mapAnchorDotRef.current.style.top = `${centerPoint.y}px`;
            }
            const nextCoords = {
                lat: parseFloat(unprojected.lat.toFixed(6)),
                lng: parseFloat(unprojected.lng.toFixed(6))
            };
            setCurrentCoords(nextCoords);

            // The circular safe zone has one source of truth: the coordinate
            // beneath the fixed reticle. Updating it here prevents a render
            // delay from leaving the radius behind after a pan or fly-to.
            const primarySource = mapInstanceRef.current.getSource('primary-geofence-source') as maplibregl.GeoJSONSource;
            if (primarySource) {
                const radiusMeters = Math.round(Math.max(0.015, Math.min(2, radiusRef.current)) * 1000);
                const circleCoords = createCirclePolygonCoords(nextCoords, radiusMeters);
                primarySource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [circleCoords] }
                });
            }

            // Moving the preview map must not recreate a legacy driveway box
            // while the user has Standard (circle-only) selected.
            const hasEntranceBox = entranceTypeRef.current !== 'none';
            const innerSource = mapInstanceRef.current.getSource('reticle-geofence-source') as maplibregl.GeoJSONSource;
            if (innerSource) {
                const bCoords = hasEntranceBox ? getRotatedBoxCoords(nextCoords, entranceBoxRef.current) : [];
                innerSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: bCoords.length > 0 ? [bCoords] : [] }
                });
            }

            const hystSource = mapInstanceRef.current.getSource('reticle-hysteresis-source') as maplibregl.GeoJSONSource;
            if (hystSource) {
                const hCoords = hasEntranceBox ? getRotatedBoxCoords(nextCoords, entranceBoxRef.current, 5) : [];
                hystSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: hCoords.length > 0 ? [hCoords] : [] }
                });
            }
            return nextCoords;
        };

        // Position the blue anchor correctly on the first render as well as
        // after the user begins panning.
        updateCoordsFromCenter();
        map.once('idle', updateCoordsFromCenter);
        map.on('move', updateCoordsFromCenter);

        map.on('dragend', () => {
            updateCoordsFromCenter();
            hapticTick();
        });

        // Click anywhere on map to reposition pin/zone to exact clicked coordinates
        map.on('click', (e) => {
            if (!mapContainerRef.current || !mapInstanceRef.current) return;
            const rect = mapContainerRef.current.getBoundingClientRect();
            // Client mouse/touch event coordinates factored with container bounding rectangle
            const clientX = e.originalEvent?.clientX ?? (rect.left + e.point.x);
            const clientY = e.originalEvent?.clientY ?? (rect.top + e.point.y);
            const containerX = clientX - rect.left;
            const containerY = clientY - rect.top;
            const unprojected = mapInstanceRef.current.unproject([containerX, containerY]);
            const nextCoords = {
                lat: parseFloat(unprojected.lat.toFixed(6)),
                lng: parseFloat(unprojected.lng.toFixed(6))
            };
            setCurrentCoords(nextCoords);
            hapticTick();
            mapInstanceRef.current.flyTo({
                center: [unprojected.lng, unprojected.lat],
                essential: true
            });
        });

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            if (resizeObserver) resizeObserver.disconnect();
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
            setIsMapLoaded(false);
        };
    }, [isOpen, place, step, isDark, updatePixelsPerMeter]);

    if (!isOpen || !place) return null;

    const handleSnapToGps = () => {
        if (!userLocation || !mapInstanceRef.current) return;
        hapticTick();
        mapInstanceRef.current.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 18,
            essential: true
        });
    };

    const handleResetLocation = () => {
        if (!place || !mapInstanceRef.current) return;
        hapticTick();
        const origLoc = place.location || { lat: 35.105, lng: -78.966 };
        mapInstanceRef.current.flyTo({
            center: [origLoc.lng, origLoc.lat],
            zoom: 17.5,
            essential: true
        });
    };

    const handleResetBox = () => {
        const def = (entranceType !== 'none' && DEFAULT_ENTRANCE_BOX[entranceType as EntranceType])
            ? DEFAULT_ENTRANCE_BOX[entranceType as EntranceType]
            : DEFAULT_ENTRANCE_BOX.driveway;
        setEntranceBox(def);
        setRotationDeg(def.rotationDeg || 0);
        hapticTick();
    };

    const handleSave = async () => {
        if (!name.trim()) return;

        const activeBox: EntranceBox = {
            ...entranceBox,
            rotationDeg
        };

        // The saved location must match the same MapLibre viewport center that
        // drives the blue placement dot and preview radius.
        let finalCoords = currentCoords;
        if (mapInstanceRef.current) {
            const mapCenter = mapInstanceRef.current.getCenter();
            finalCoords = {
                lat: parseFloat(mapCenter.lat.toFixed(6)),
                lng: parseFloat(mapCenter.lng.toFixed(6))
            };
        }

        const hasBox = entranceType === 'driveway' || entranceType === 'parking';

        const precisionData: EntrancePrecision = {
            location: finalCoords,
            radius: hasBox ? entranceRadius : Math.round((radius && radius > 5 ? radius : (radius || 0.05) * 1000)),
            box: hasBox ? activeBox : undefined
        };

        // Determine the true point location of the place (house/building pin)
        // If a custom driveway/parking box is configured, DO NOT overwrite the main place location with the driveway reticle!
        const truePlaceLocation = hasBox
            ? ((originalPlaceCoords.lat && originalPlaceCoords.lng)
                ? originalPlaceCoords
                : (place.originalLocation?.lat ? place.originalLocation : place.location))
            : finalCoords;

        const originalLocationToPersist = (originalPlaceCoords.lat && originalPlaceCoords.lng)
            ? originalPlaceCoords
            : (place.originalLocation || place.location);

        // Save nested metadata directly onto existing place record
        await onSave(place.id, {
            name: name.trim(),
            icon,
            type: type as any,
            radius,
            departureRadius: Math.round((radius && radius > 5 ? radius : (radius || 0.05) * 1000)),
            entranceType: hasBox ? (entranceType as EntranceType) : (null as any),
            location: truePlaceLocation,
            originalLocation: originalLocationToPersist,
            entrancePin: hasBox ? finalCoords : (null as any),
            entranceLocation: hasBox ? finalCoords : (null as any),
            entrancePrecision: hasBox ? precisionData : (null as any),
            entranceBox: hasBox ? activeBox : (null as any),
            // Saving a geofence/pin edit makes this record authoritative if a
            // legacy duplicate exists in another synced store.
            isCorrected: true,
            correctedAt: Date.now()
        });
        onClose();
    };

    const handleDelete = () => {
        if (window.confirm(`Delete "${place.name}" from your circle places?`)) {
            onDelete?.(place.id);
            onClose();
        }
    };

    const handleBuildingPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !place) return;
        if (!file.type.startsWith('image/')) {
            setPhotoFeedback('Choose a photo of the building or storefront.');
            return;
        }
        setIsUploadingPhoto(true);
        const localPreviewUrl = URL.createObjectURL(file);
        setPhotoPreviewUrl(localPreviewUrl);
        setPhotoFeedback('Submitting building photo for review…');
        try {
            const photo = await placePhotoService.uploadPhotoContribution({
                placeId: getPlacePhotoKey({ ...place, isSaved: true }),
                placeName: name.trim() || place.name,
                reportedAddress: place.address || place.description || name.trim() || place.name,
                placeLocation: place.location,
                file,
                userId: currentUserId || 'anonymous',
                userName: currentUserName || 'You',
                userAvatar: currentUserAvatar
            });
            await contributionService.recordTripContribution({
                tripId: `photo_${photo.id}`,
                destinationAddress: name.trim() || place.name,
                destinationName: name.trim() || place.name,
                placeId: place.id,
                rating: 0,
                tags: ['building_photo'],
                placeType: type === 'residential' || type === 'home' ? 'residential' : 'business',
                isAccurate: true,
                type: 'building_photo',
                timestamp: photo.createdAt,
                userId: currentUserId,
                userName: currentUserName,
                userAvatar: currentUserAvatar,
                imageUrl: photo.url,
                reviewStatus: photo.reviewStatus || 'pending'
            });
            setPhotoPreviewUrl(photo.url);
            setPhotoFeedback(photo.isSynced === false ? 'Saved on this device. It will be submitted when storage is available.' : 'Submitted to My Way Operations for review.');
            hapticSuccess();
        } catch (error) {
            console.error('[EditPlaceModal] Community photo upload failed:', error);
            setPhotoFeedback('We could not save that photo. Check your connection and try again.');
            hapticError();
        } finally {
            setIsUploadingPhoto(false);
            event.target.value = '';
        }
    };

    const boxWidthPx = Math.max(20, Math.round(entranceBox.widthMeters * pixelsPerMeter));
    const boxLengthPx = Math.max(24, Math.round(entranceBox.lengthMeters * pixelsPerMeter));
    const hysteresisPx = Math.round(5 * pixelsPerMeter);

    const modalContent = (
        <div 
            className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div 
                className={`relative w-full max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh] transition-all ${bgColor}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Mobile Drag Handle Pill */}
                <div 
                    className="pt-3 pb-1 shrink-0 sm:hidden cursor-grab active:cursor-grabbing flex justify-center"
                    onClick={onClose}
                >
                    <div className={`w-12 h-1.5 rounded-full transition-colors ${isDark ? 'bg-white/20 hover:bg-white/30' : 'bg-slate-300 hover:bg-slate-400'}`} />
                </div>

                {/* Ambient Glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-2 sm:pt-6 pb-3 border-b border-white/10 shrink-0 relative z-10">
                    <div className="flex items-center gap-2.5">
                        <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${isDark ? 'bg-indigo-600/20 border border-indigo-500/30' : 'bg-indigo-50 border border-indigo-200'}`}>
                            <BrandIcon icon={icon} name={name} className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div>
                            <h3 className={`text-base font-black uppercase tracking-wider ${textColor}`}>
                                Edit Place & Geofence
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                Precision Approach & Routing
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                        }`}
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Small drill-down flow: separate the place facts, arrival pin, and geofence decisions. */}
                <div className="px-6 py-3 border-b border-white/10 shrink-0 relative z-10">
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-wider ${subTextColor}`}>Step {step} of 3</span>
                        <span className={`text-[10px] font-bold ${subTextColor}`}>{step === 1 ? 'Place details' : step === 2 ? 'Pin location' : 'Safe zone'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5" aria-label={`Step ${step} of 3`}>
                        {[1, 2, 3].map(item => (
                            <div key={item} className={`h-1.5 rounded-full transition-colors ${item <= step ? 'bg-indigo-600' : isDark ? 'bg-white/10' : 'bg-slate-200'}`} />
                        ))}
                    </div>
                </div>

                {/* Form Fields - Scrollable */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-4 relative z-10 no-scrollbar">
                    {step === 1 && <>
                    {/* Place Name */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                            Place Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Place Name (e.g. Home, Work)"
                            className={`w-full px-4 py-2.5 rounded-xl border text-sm font-bold outline-none focus:border-indigo-500 transition-colors ${
                                isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                            }`}
                        />
                    </div>

                    {/* Category & Icon Picker */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                            Category & Icon
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                            {PLACE_CATEGORIES.map((cat) => {
                                const isSelected = type === cat.type;
                                const IconComp = cat.iconComp;
                                return (
                                    <button
                                        key={cat.type}
                                        type="button"
                                        onClick={() => {
                                            setType(cat.type);
                                            setIcon(cat.icon);
                                        }}
                                        className={`p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer group ${
                                            isSelected
                                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30 ring-1 ring-white/20'
                                                : isDark
                                                    ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                        }`}
                                    >
                                        <IconComp className={`w-6 h-6 shrink-0 transition-colors ${isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-400'}`} />
                                        <span className={`text-[10px] font-bold truncate ${isSelected ? 'text-white' : ''}`}>{cat.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    </>}

                    {step === 3 && <>
                    {/* Geofence Detection Radius Slider */}
                    <div className={`p-3 rounded-2xl border ${
                        isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center justify-between mb-1.5">
                            <div>
                                <span className={`text-[10px] font-black uppercase tracking-wider block ${
                                    isDark ? 'text-indigo-400' : 'text-indigo-600'
                                }`}>
                                    Safe Zone Geofence
                                </span>
                                <p className="text-[9px] text-slate-400">
                                    Departure radius: {radius && radius > 5 ? `${Math.round(radius)}m` : (radius && radius < 0.1 ? `${Math.round(radius * 1000)}m` : `${radius?.toFixed(2)}km`)}
                                </p>
                            </div>
                            {savedPresetNotice ? (
                                <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-pulse">
                                    {savedPresetNotice}
                                </span>
                            ) : (
                                <span className={`text-xs font-black ${textColor}`}>
                                    {Math.round((radius && radius > 5 ? radius : (radius || 0.05) * 1000))}m
                                </span>
                            )}
                        </div>

                        {/* Quick-Preset Radius Chips */}
                        <div className="flex flex-row overflow-x-auto gap-2 mb-3 pb-0.5 scrollbar-none">
                            {[
                                { label: 'Tight', value: 0.015, meters: '15m' },
                                { label: 'Street', value: 0.05, meters: '50m' },
                                { label: 'Neighborhood', value: 0.15, meters: '150m' },
                                { label: 'City Area', value: 1.0, meters: '1km' },
                                { label: 'Metro', value: 2.0, meters: '2km' }
                            ].map((preset) => {
                                const currentKm = radius && radius > 5 ? radius / 1000 : (radius || 0.05);
                                const isActive = Math.round(currentKm * 1000) === Math.round(preset.value * 1000);
                                return (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => {
                                            handleRadiusChange(preset.value);
                                            setSavedPresetNotice(`📍 ${preset.label} (${preset.meters})`);
                                            setTimeout(() => setSavedPresetNotice(null), 2500);
                                        }}
                                        className={`px-2.5 py-1 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all flex items-center gap-1 cursor-pointer shrink-0 border ${
                                            isActive
                                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/40'
                                                : isDark
                                                    ? 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900 shadow-2xs'
                                        }`}
                                    >
                                        <span>{preset.label}</span>
                                        <span className={`text-[9px] ${isActive ? 'text-indigo-200' : 'text-slate-400'}`}>
                                            ({preset.meters})
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <input
                            type="range"
                            min="0.015"
                            max="2.0"
                            step="0.005"
                            value={radius && radius > 5 ? radius / 1000 : (radius || 0.05)}
                            onChange={(e) => handleRadiusChange(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                        />
                        <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                            <span>15m (Tight)</span>
                            <span>1km</span>
                            <span>2km</span>
                        </div>
                    </div>

                    {/* Saved-place building photos are held for Operations review before community publication. */}
                    <div className={`p-3 rounded-2xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                        {photoPreviewUrl && (
                            <div className="relative mb-3 overflow-hidden rounded-xl border border-amber-300/50 bg-slate-950">
                                <img src={photoPreviewUrl} alt="Building photo awaiting review" className="h-28 w-full object-cover opacity-90" />
                                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black text-amber-950 shadow-sm">◷ In review</span>
                            </div>
                        )}
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className={`text-[10px] font-black uppercase tracking-wider ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>Community building photo</p>
                                <p className={`mt-1 text-[10px] leading-snug ${subTextColor}`}>Share a clear storefront or building facade to help drivers recognize this place.</p>
                            </div>
                            <button type="button" onClick={() => photoInputRef.current?.click()} disabled={isUploadingPhoto} className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-white shadow-sm transition-all active:scale-95 disabled:opacity-50">
                                {isUploadingPhoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                                {isUploadingPhoto ? 'Uploading' : photoPreviewUrl ? 'Replace photo' : 'Add building photo'}
                            </button>
                            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={handleBuildingPhoto} />
                        </div>
                        {photoFeedback && <p role="status" className={`mt-2 text-[10px] font-semibold ${photoFeedback.startsWith('We could not') || photoFeedback.startsWith('Choose') ? 'text-rose-500' : 'text-emerald-500'}`}>{photoFeedback}</p>}
                    </div>

                    </>}

                    {step === 2 && <>

                    {/* Entrance Category Selector */}
                    <div className="space-y-1.5">
                        <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                            Entrance Footprint & Zone
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {ENTRANCE_CATEGORY_OPTIONS.map((opt) => {
                                const isSelected = entranceType === opt.id;
                                const IconComp = opt.iconComp;
                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => {
                                            setEntranceType(opt.id);
                                            entranceTypeRef.current = opt.id;
                                            if (opt.id === 'none') {
                                                setEntranceRadius(Math.round(radius && radius > 5 ? radius : (radius || 0.05) * 1000));
                                            } else {
                                                setEntranceRadius(ENTRANCE_CATEGORY_RADIUS[opt.id] ?? 15);
                                                setEntranceBox(prev => ({
                                                    ...(DEFAULT_ENTRANCE_BOX[opt.id as EntranceType] || DEFAULT_ENTRANCE_BOX.driveway),
                                                    rotationDeg: prev.rotationDeg
                                                }));
                                            }
                                        }}
                                        className={`p-2.5 rounded-2xl border text-left flex items-center gap-2 transition-all cursor-pointer group ${
                                            isSelected
                                                ? isDark
                                                    ? 'bg-indigo-600/30 border-indigo-400 shadow-md ring-1 ring-indigo-400/50 text-white'
                                                    : 'bg-indigo-50 border-indigo-600 shadow-md ring-2 ring-indigo-500/30 text-indigo-950'
                                                : isDark
                                                    ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                                                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                        }`}
                                    >
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                            isSelected
                                                ? isDark
                                                    ? 'bg-indigo-500/40 text-white'
                                                    : 'bg-indigo-600 text-white shadow-sm'
                                                : isDark
                                                    ? 'bg-white/10 text-slate-400 group-hover:text-slate-200'
                                                    : 'bg-slate-200/70 text-slate-500 group-hover:text-slate-700'
                                        }`}>
                                            <IconComp className="w-4 h-4 shrink-0" />
                                        </div>
                                        <div className="min-w-0">
                                            <span className={`text-xs font-black block truncate ${
                                                isSelected && !isDark ? 'text-indigo-950' : ''
                                            }`}>{opt.label}</span>
                                            <span className={`text-[9px] block truncate ${
                                                isSelected && !isDark ? 'text-indigo-700 font-semibold' : 'text-slate-400'
                                            }`}>{opt.description}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    </>}

                    {step === 2 && <>
                    {/* Precision Map Viewport Preview with Direct Manipulation Handles */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                                {entranceType === 'none' ? 'Interactive Place Location Map' : `Interactive ${entranceType === 'parking' ? 'Parking' : 'Driveway'} Zone Map`}
                            </label>
                            <span className="text-[10px] font-semibold text-indigo-400">
                                {entranceType === 'none' ? 'Pan map to align center pin' : 'Drag handles to resize & rotate'}
                            </span>
                        </div>

                        <div className="relative w-full h-72 sm:h-80 rounded-3xl overflow-hidden border border-white/15 shadow-inner bg-slate-950">
                            <div ref={mapContainerRef} className="absolute inset-0 w-full h-full rounded-3xl" />

                            {/* Stationary Reticle Crosshair & Direct-Manipulation SVG Overlay */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                {/* Rotated Box Container with Direct-Manipulation Handles */}
                                {entranceType !== 'none' && (
                                <div
                                    className="absolute flex items-center justify-center z-[5] select-none"
                                    style={{
                                        transform: `rotate(${rotationDeg}deg)`,
                                        transformOrigin: '50% 50%',
                                        width: boxWidthPx + hysteresisPx * 2 + 16,
                                        height: boxLengthPx + hysteresisPx * 2 + 16
                                    }}
                                >
                                    {/* SVG Graphic (Visual Box + Hysteresis Buffer) */}
                                    <svg
                                        width={boxWidthPx + hysteresisPx * 2 + 16}
                                        height={boxLengthPx + hysteresisPx * 2 + 16}
                                        viewBox={`0 0 ${boxWidthPx + hysteresisPx * 2 + 16} ${boxLengthPx + hysteresisPx * 2 + 16}`}
                                        className="overflow-visible pointer-events-none"
                                    >
                                        <defs>
                                            <linearGradient id="editDrivewayGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.45" />
                                                <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.22" />
                                            </linearGradient>
                                        </defs>

                                        {/* Outer Hysteresis Departure Buffer (+5m) */}
                                        <rect
                                            x={8}
                                            y={8}
                                            width={boxWidthPx + hysteresisPx * 2}
                                            height={boxLengthPx + hysteresisPx * 2}
                                            rx={10}
                                            fill="rgba(56, 189, 248, 0.08)"
                                            stroke="#38bdf8"
                                            strokeWidth="1.8"
                                            strokeDasharray="4 4"
                                        />

                                        {/* Primary Footprint Bounding Box */}
                                        <rect
                                            x={8 + hysteresisPx}
                                            y={8 + hysteresisPx}
                                            width={boxWidthPx}
                                            height={boxLengthPx}
                                            rx={8}
                                            fill="url(#editDrivewayGrad)"
                                            stroke="#818cf8"
                                            strokeWidth="2.5"
                                        />

                                        {/* Entry Orientation Notch at Top Edge */}
                                        <rect
                                            x={8 + hysteresisPx + (boxWidthPx / 2) - 8}
                                            y={8 + hysteresisPx - 2}
                                            width={16}
                                            height={5}
                                            rx={2.5}
                                            fill="#c7d2fe"
                                        />

                                        {/* Center Alignment Dashed Guideline */}
                                        <line
                                            x1={8 + hysteresisPx + (boxWidthPx / 2)}
                                            y1={8 + hysteresisPx + 6}
                                            x2={8 + hysteresisPx + (boxWidthPx / 2)}
                                            y2={8 + hysteresisPx + Math.max(12, boxLengthPx / 3)}
                                            stroke="#a5b4fc"
                                            strokeWidth="1.5"
                                            strokeDasharray="3 3"
                                        />
                                    </svg>

                                    {/* Interactive Touch/Drag Handles overlay positioned exactly over the primary box */}
                                    <div
                                        className="absolute"
                                        style={{
                                            left: 8 + hysteresisPx,
                                            top: 8 + hysteresisPx,
                                            width: boxWidthPx,
                                            height: boxLengthPx
                                        }}
                                    >
                                        {/* Top Rotation Stem & Knob */}
                                        <div
                                            className="absolute -top-12 left-1/2 -translate-x-1/2 flex flex-col items-center group z-30 pointer-events-none"
                                            title="Drag knob to rotate driveway angle"
                                        >
                                            <div
                                                onPointerDown={handleRotateStart}
                                                className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 border-2 border-white shadow-xl flex items-center justify-center text-white cursor-grab active:cursor-grabbing hover:scale-110 active:scale-95 transition-transform pointer-events-auto touch-none"
                                            >
                                                <RotateCw className="w-4 h-4" />
                                            </div>
                                            <div className="w-0.5 h-4 bg-indigo-400 border-dashed pointer-events-none" />
                                        </div>

                                        {/* Left (West) Edge Width Handle */}
                                        <div
                                            onPointerDown={(e) => handleResizeStart('width', e)}
                                            className="absolute top-1/2 -left-3.5 -translate-y-1/2 w-7 h-10 flex items-center justify-center cursor-ew-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag to adjust width"
                                        >
                                            <div className="w-1.5 h-6 rounded-full bg-white border border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>

                                        {/* Right (East) Edge Width Handle */}
                                        <div
                                            onPointerDown={(e) => handleResizeStart('width', e)}
                                            className="absolute top-1/2 -right-3.5 -translate-y-1/2 w-7 h-10 flex items-center justify-center cursor-ew-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag to adjust width"
                                        >
                                            <div className="w-1.5 h-6 rounded-full bg-white border border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>

                                        {/* Top (North) Edge Length Handle */}
                                        <div
                                            onPointerDown={(e) => handleResizeStart('length', e)}
                                            className="absolute -top-3.5 left-1/2 -translate-x-1/2 w-10 h-7 flex items-center justify-center cursor-ns-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag to adjust length"
                                        >
                                            <div className="w-6 h-1.5 rounded-full bg-white border border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>

                                        {/* Bottom (South) Edge Length Handle */}
                                        <div
                                            onPointerDown={(e) => handleResizeStart('length', e)}
                                            className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-10 h-7 flex items-center justify-center cursor-ns-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag to adjust length"
                                        >
                                            <div className="w-6 h-1.5 rounded-full bg-white border border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>

                                        {/* 4 Corner Scale Knobs */}
                                        <div
                                            onPointerDown={(e) => handleResizeStart('corner', e)}
                                            className="absolute -top-3.5 -left-3.5 w-7 h-7 flex items-center justify-center cursor-nwse-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag corner to scale"
                                        >
                                            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>
                                        <div
                                            onPointerDown={(e) => handleResizeStart('corner', e)}
                                            className="absolute -top-3.5 -right-3.5 w-7 h-7 flex items-center justify-center cursor-nesw-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag corner to scale"
                                        >
                                            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>
                                        <div
                                            onPointerDown={(e) => handleResizeStart('corner', e)}
                                            className="absolute -bottom-3.5 -right-3.5 w-7 h-7 flex items-center justify-center cursor-nwse-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag corner to scale"
                                        >
                                            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>
                                        <div
                                            onPointerDown={(e) => handleResizeStart('corner', e)}
                                            className="absolute -bottom-3.5 -left-3.5 w-7 h-7 flex items-center justify-center cursor-nesw-resize group z-20 pointer-events-auto touch-none"
                                            title="Drag corner to scale"
                                        >
                                            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 shadow-md group-hover:scale-125 group-active:bg-indigo-400 transition-all" />
                                        </div>

                                        {/* Real-Time Footprint Dimensions Badge */}
                                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none z-10">
                                            <span className="text-[9px] font-black text-indigo-100 tracking-tight bg-slate-950/90 px-2 py-0.5 rounded-full border border-indigo-500/50 shadow-md">
                                                {entranceBox.widthMeters}m × {entranceBox.lengthMeters}m • {rotationDeg}°
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                )}

                                {/* One canonical placement point: it follows the map's actual viewport center. */}
                                <div
                                    ref={mapAnchorDotRef}
                                    className="absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.9)]"
                                    style={{ left: '50%', top: '50%' }}
                                    aria-hidden="true"
                                />
                            </div>

                            {/* Dual-Layer Legend Indicator */}
                            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/10 text-[10px] font-bold z-10 shadow-md">
                                <div className="flex items-center gap-1 text-indigo-300">
                                    <span className="w-2 h-2 rounded-full border border-indigo-400 bg-indigo-500/30" />
                                    <span>Property ({Math.round(radius && radius > 5 ? radius : (radius || 0.05) * 1000)}m)</span>
                                </div>
                                {entranceType !== 'none' && (
                                    <>
                                        <span className="text-white/20">•</span>
                                        <div className="flex items-center gap-1 text-slate-200">
                                            <span className="w-2.5 h-1.5 rounded-xs border border-indigo-400 bg-indigo-500/60" />
                                            <span>{entranceType === 'parking' ? 'Parking' : 'Driveway'} Box</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Floating Map Action Buttons */}
                            <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
                                {userLocation && (
                                    <button
                                        type="button"
                                        onClick={handleSnapToGps}
                                        className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                        title="Snap to my exact location"
                                    >
                                        <LocateFixed className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                        <span>My GPS</span>
                                    </button>
                                )}
                                {entranceType !== 'none' && (
                                    <button
                                        type="button"
                                        onClick={handleResetBox}
                                        className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                        title="Reset footprint dimensions and angle"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                        <span>Reset Box</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleResetLocation}
                                    className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                    title="Reset to original map position"
                                >
                                    <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>Reset Pin</span>
                                </button>
                            </div>

                            {/* Status Pill */}
                            <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-black/85 backdrop-blur-md border border-white/15 text-xs font-bold text-white z-10 shadow-lg">
                                <span className="text-slate-300 text-[11px] truncate">
                                    {entranceType === 'none'
                                        ? 'Pan map to reposition center pin'
                                        : 'Drag edges to resize • Drag top knob to rotate'}
                                </span>
                                {distanceFeet > 15 ? (
                                    <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] shrink-0">
                                        Moved {distanceFeet} ft {direction}
                                    </span>
                                ) : (
                                    <span className="text-slate-400 text-[10px] shrink-0">
                                        Original spot
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    </>}

                </div>

                {/* Footer Buttons - Sticky at Bottom */}
                <div className="flex items-center gap-2 px-6 py-4 border-t border-white/10 shrink-0 relative z-10 bg-inherit pb-[max(env(safe-area-inset-bottom,16px),16px)] sm:pb-4">
                    {step > 1 && (
                        <button
                            type="button"
                            onClick={() => setStep(current => (current - 1) as 1 | 2)}
                            className={`px-5 py-3.5 border font-bold rounded-xl text-sm transition-all active:scale-95 cursor-pointer ${isDark ? 'border-white/15 text-slate-200 hover:bg-white/10' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                            Back
                        </button>
                    )}
                    {step < 3 ? (
                        <button
                            type="button"
                            onClick={() => setStep(current => (current + 1) as 2 | 3)}
                            disabled={step === 1 && !name.trim()}
                            className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95 cursor-pointer"
                        >
                            Continue
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!name.trim()}
                            className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                            <Save className="w-4 h-4 shrink-0" />
                            <span>Save Changes</span>
                        </button>
                    )}

                    {onDelete && step === 1 && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="p-3.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold text-sm transition-all active:scale-95 cursor-pointer flex items-center justify-center"
                            title="Delete Place"
                            aria-label="Delete Place"
                        >
                            <Trash2 className="w-4 h-4 shrink-0" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};

export default EditPlaceModal;
