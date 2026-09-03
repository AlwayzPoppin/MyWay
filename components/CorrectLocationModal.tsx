import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Place, Location, EntranceType } from '../types';
import { placeCorrectionService, PlaceCorrection, compressImageFile } from '../services/placeCorrectionService';
import { publicMapReportService } from '../services/publicMapReportService';
import { getDistanceMeters, getBearing } from '../utils/geo';
import { hapticTick, hapticSuccess, hapticError } from '../utils/haptics';
import { getCircleCoords } from './MapLibre3DView';

export const ENTRANCE_CATEGORY_OPTIONS: { id: EntranceType; label: string; icon: string; description: string; defaultNote: string }[] = [
    { id: 'driveway', label: 'Driveway Curb Cut', icon: '🚗', description: 'Driveway access connecting to street', defaultNote: 'Driveway curb cut' },
    { id: 'front_door', label: 'Front Door / Entry', icon: '🚪', description: 'Pedestrian front door or entryway', defaultNote: 'Front door entrance' },
    { id: 'drive_thru', label: 'Drive-Thru Lane', icon: '🚗', description: 'Drive-thru order or pickup', defaultNote: 'Drive-thru entrance lane' },
    { id: 'parking', label: 'Parking Lot / Gate', icon: '🅿️', description: 'Vehicle parking entrance or gate', defaultNote: 'Parking lot entrance / gate' },
    { id: 'main_door', label: 'Main Lobby / Door', icon: '🚪', description: 'Front storefront or lobby', defaultNote: 'Main storefront entrance' },
    { id: 'curbside', label: 'Curbside / Pickup', icon: '📦', description: 'Curbside mobile pickup bays', defaultNote: 'Curbside mobile pickup bays' }
];

interface CorrectLocationModalProps {
    place: Place | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (correctedPlace: Place, correction: PlaceCorrection) => void;
    userLocation?: Location | null;
    theme?: 'light' | 'dark';
    userId?: string;
    userName?: string;
    userAvatar?: string;
}

function getDirectionLabel(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
    return directions[index];
}

const CorrectLocationModal: React.FC<CorrectLocationModalProps> = ({
    place,
    isOpen,
    onClose,
    onSave,
    userLocation,
    theme = 'dark',
    userId,
    userName,
    userAvatar
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<maplibregl.Map | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [currentCoords, setCurrentCoords] = useState<Location>({ lat: 0, lng: 0 });
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [entranceType, setEntranceType] = useState<EntranceType>('main_door');
    const [entranceNotes, setEntranceNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isMapLoaded, setIsMapLoaded] = useState(false);

    const [editMode, setEditMode] = useState<'menu' | 'text' | 'pin' | 'entrance'>('menu');
    const [correctedName, setCorrectedName] = useState('');
    const [correctedAddress, setCorrectedAddress] = useState('');
    const [visibility, setVisibility] = useState<'public' | 'circle'>('public');

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';
    const panelBg = isDark ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';

    // Initialize state from place
    useEffect(() => {
        if (place) {
            const loc = place.location || { lat: 35.105, lng: -78.966 };
            setCurrentCoords({ lat: loc.lat, lng: loc.lng });
            setPhotoPreview(place.imageUrl || null);
            setEntranceType(place.entranceType || 'main_door');
            setEntranceNotes(place.entranceNotes || '');
            setCorrectedName(place.name || '');
            setCorrectedAddress(place.address || place.description || '');
            if (isOpen) {
                setEditMode('menu'); // Reset to menu on open
            }
        }
    }, [place, isOpen]);

    // Initialize MapLibre interactive reticle map
    useEffect(() => {
        if (!isOpen || !place || editMode !== 'pin' || !mapContainerRef.current) return;

        const initialLat = currentCoords.lat || place.location?.lat || 35.105;
        const initialLng = currentCoords.lng || place.location?.lng || -78.966;

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

        const effectiveRadiusM = (place.radius ? (place.radius > 5 ? place.radius : place.radius * 1000) : 15);
        const radiusKm = (effectiveRadiusM / 1000);
        const isMicro = effectiveRadiusM <= 30;

        map.on('load', () => {
            setIsMapLoaded(true);
            map.resize();

            // Render Safe Zone Geofence Circle & Faint Dotted +3m Departure Hysteresis Ring
            const center = map.getCenter();
            const centerLoc = { lat: center.lat, lng: center.lng };
            const innerCoords = getCircleCoords(centerLoc, radiusKm, 64);

            map.addSource('reticle-geofence-source', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [innerCoords] }
                }
            });

            map.addLayer({
                id: 'reticle-geofence-fill',
                type: 'fill',
                source: 'reticle-geofence-source',
                paint: {
                    'fill-color': '#6366f1',
                    'fill-opacity': 0.12
                }
            });

            map.addLayer({
                id: 'reticle-geofence-outline',
                type: 'line',
                source: 'reticle-geofence-source',
                paint: {
                    'line-color': '#818cf8',
                    'line-width': 2,
                    'line-opacity': 0.8
                }
            });

            if (isMicro) {
                const radiusM = radiusKm * 1000;
                const hystBufferM = Math.max(15, Math.round(radiusM * 0.5));
                const hystKm = (radiusM + hystBufferM) / 1000;
                const hystCoords = getCircleCoords(centerLoc, hystKm, 64);
                map.addSource('reticle-hysteresis-source', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'Polygon', coordinates: [hystCoords] }
                    }
                });

                map.addLayer({
                    id: 'reticle-hysteresis-outline',
                    type: 'line',
                    source: 'reticle-hysteresis-source',
                    paint: {
                        'line-color': '#38bdf8',
                        'line-width': 1.8,
                        'line-opacity': 0.85,
                        'line-dasharray': [2, 3] // Faint dotted outer ring
                    }
                });
            }
        });

        // Failsafe for portal-mounting and animation layout delays
        const t1 = setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.resize();
            }
        }, 100);

        const t2 = setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.resize();
            }
        }, 300);

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
            resizeObserver = new ResizeObserver(() => {
                if (mapInstanceRef.current) {
                    mapInstanceRef.current.resize();
                }
            });
            resizeObserver.observe(mapContainerRef.current);
        }

        // Update live coordinates when map moves under the reticle
        map.on('move', () => {
            const center = map.getCenter();
            const nextCoords = {
                lat: parseFloat(center.lat.toFixed(6)),
                lng: parseFloat(center.lng.toFixed(6))
            };
            setCurrentCoords(nextCoords);

            // Sync geofence rings to center of crosshair
            const innerSource = map.getSource('reticle-geofence-source') as maplibregl.GeoJSONSource;
            if (innerSource) {
                const innerCoords = getCircleCoords(nextCoords, radiusKm, 64);
                innerSource.setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Polygon', coordinates: [innerCoords] }
                });
            }

            if (isMicro) {
                const hystSource = map.getSource('reticle-hysteresis-source') as maplibregl.GeoJSONSource;
                if (hystSource) {
                    const radiusM = radiusKm * 1000;
                    const hystBufferM = Math.max(15, Math.round(radiusM * 0.5));
                    const hystKm = (radiusM + hystBufferM) / 1000;
                    const hystCoords = getCircleCoords(nextCoords, hystKm, 64);
                    hystSource.setData({
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'Polygon', coordinates: [hystCoords] }
                    });
                }
            }
        });

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            if (resizeObserver) resizeObserver.disconnect();
            map.remove();
            mapInstanceRef.current = null;
            setIsMapLoaded(false);
        };
    }, [isOpen, place?.id, isDark, editMode]);

    if (!isOpen || !place) return null;

    const originalLoc = place.originalLocation || place.location || { lat: 35.105, lng: -78.966 };
    const distanceMeters = getDistanceMeters(originalLoc, currentCoords);
    const distanceFeet = Math.round(distanceMeters * 3.28084);
    const bearing = getBearing(originalLoc, currentCoords);
    const direction = getDirectionLabel(bearing);

    const handleSnapToGps = () => {
        if (!userLocation || !mapInstanceRef.current) return;
        mapInstanceRef.current.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 18,
            duration: 600
        });
    };

    const handleResetLocation = () => {
        if (!mapInstanceRef.current) return;
        mapInstanceRef.current.flyTo({
            center: [originalLoc.lng, originalLoc.lat],
            zoom: 17.5,
            duration: 600
        });
    };

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingPhoto(true);
        try {
            const compressed = await compressImageFile(file, 1200, 0.82);
            setPhotoPreview(compressed);
        } catch (err) {
            console.error('Failed to process storefront photo:', err);
        } finally {
            setIsUploadingPhoto(false);
            e.target.value = '';
        }
    };

    const handleSave = async () => {
        if (!place) return;
        setIsSaving(true);
        try {
            // Upload photo to storage or keep compressed Data URI
            let finalPhotoUrl = photoPreview || undefined;
            if (photoPreview && photoPreview.startsWith('data:')) {
                finalPhotoUrl = await placeCorrectionService.uploadPlacePhoto(place.id, photoPreview);
            }

            const isPublicReport = visibility === 'public';
            const publicDisplayName = isPublicReport ? 'MyWay Community' : (userName || 'You');
            const publicAvatar = isPublicReport ? undefined : userAvatar;

            const correction = await placeCorrectionService.saveCorrection({
                place,
                correctedLocation: currentCoords,
                correctedName: correctedName.trim() || undefined,
                correctedAddress: correctedAddress.trim() || undefined,
                imageUrl: finalPhotoUrl,
                entranceType,
                entranceNotes: entranceNotes.trim() || undefined,
                userId: isPublicReport ? 'community' : userId,
                submitterName: publicDisplayName,
                submitterAvatar: publicAvatar
            });

            // If Public is selected, route the report to the root-level public_map_reports collection
            if (isPublicReport) {
                const reportType = (editMode === 'entrance' || entranceType) ? 'entrance_fix' : 'pin_move';
                await publicMapReportService.submitReport({
                    reportType,
                    coordinates: currentCoords,
                    userId: userId || 'anonymous',
                    userName: 'MyWay Community',
                    userAvatar: '',
                    placeId: place.id,
                    placeName: correctedName.trim() || place.name,
                    details: correctedAddress.trim() || place.description,
                    imageUrl: finalPhotoUrl,
                    entranceType,
                    entranceNotes: entranceNotes.trim() || undefined,
                    visibility: 'public'
                });
            }

            const updatedPlace: Place = {
                ...place,
                name: correctedName.trim() || place.name,
                description: correctedAddress.trim() || place.description,
                address: correctedAddress.trim() || place.address || place.description,
                originalLocation: place.originalLocation || place.location,
                location: currentCoords,
                entranceLocation: currentCoords, // Anchor micro-geofence to the driveway curb cut
                imageUrl: finalPhotoUrl,
                entranceType,
                entranceNotes: entranceNotes.trim() || undefined,
                isCorrected: true,
                correctedAt: Date.now(),
                submitterId: isPublicReport ? 'community' : userId,
                submitterName: publicDisplayName,
                submitterAvatar: publicAvatar,
                helpfulCount: correction.helpfulCount || 0,
                helpfulUserIds: correction.helpfulUserIds || []
            };

            onSave(updatedPlace, correction);
            hapticSuccess();
            onClose();
        } catch (err) {
            hapticError();
            console.error('Failed to save location correction:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const modalContent = (
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 pointer-events-auto"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                className={`relative w-full max-w-lg rounded-[2.5rem] border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-all ${panelBg}`}
                onClick={(e) => e.stopPropagation()}
            >
                
                {/* Header */}
                <div className="flex items-center justify-between p-5 pb-3 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                        {editMode !== 'menu' && (
                            <button 
                                onClick={() => setEditMode('menu')}
                                className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                                    isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                }`}
                            >
                                ⬅
                            </button>
                        )}
                        {editMode === 'menu' && (
                            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl shadow-inner">
                                🎯
                            </div>
                        )}
                        <div>
                            <h3 className={`text-base sm:text-lg font-black tracking-wide leading-tight ${textColor}`}>
                                {editMode === 'menu' && 'Suggest an Edit'}
                                {editMode === 'text' && 'Edit Name / Address'}
                                {editMode === 'pin' && 'Move Location Pin'}
                                {editMode === 'entrance' && 'Fix Entrance & Photo'}
                            </h3>
                            <p className="text-xs text-slate-400 font-semibold truncate max-w-[240px] sm:max-w-[320px]">
                                {place.name}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                    >
                        ✕
                    </button>
                </div>

                {/* Body Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">

                    {editMode === 'menu' && (
                        <div className="space-y-3">
                            <button
                                type="button"
                                onClick={() => setEditMode('text')}
                                className={`w-full p-4 rounded-3xl border text-left flex items-center gap-4 transition-all cursor-pointer ${
                                    isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                }`}
                            >
                                <span className="text-3xl shrink-0">📝</span>
                                <div className="min-w-0 flex-1">
                                    <span className="text-sm font-black block truncate">Edit Name or Address</span>
                                    <span className="text-[11px] text-slate-400 block">Fix text typos or wrong house numbers</span>
                                </div>
                                <span className="text-slate-400">➔</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setEditMode('pin')}
                                className={`w-full p-4 rounded-3xl border text-left flex items-center gap-4 transition-all cursor-pointer ${
                                    isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                }`}
                            >
                                <span className="text-3xl shrink-0">📍</span>
                                <div className="min-w-0 flex-1">
                                    <span className="text-sm font-black block truncate">Move Location Pin</span>
                                    <span className="text-[11px] text-slate-400 block">Correct the geographic map position</span>
                                </div>
                                <span className="text-slate-400">➔</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setEditMode('entrance')}
                                className={`w-full p-4 rounded-3xl border text-left flex items-center gap-4 transition-all cursor-pointer ${
                                    isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                }`}
                            >
                                <span className="text-3xl shrink-0">🚪</span>
                                <div className="min-w-0 flex-1">
                                    <span className="text-sm font-black block truncate">Fix Entrance/Driveway</span>
                                    <span className="text-[11px] text-slate-400 block">Correct routing access points & photo</span>
                                </div>
                                <span className="text-slate-400">➔</span>
                            </button>
                        </div>
                    )}

                    {editMode === 'text' && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                                    Place Name
                                </label>
                                <input
                                    type="text"
                                    value={correctedName}
                                    onChange={(e) => setCorrectedName(e.target.value)}
                                    placeholder="e.g. Starbucks"
                                    className={`w-full px-4 py-3 rounded-2xl border text-sm font-bold outline-none focus:border-indigo-500 transition-colors ${
                                        isDark ? 'bg-white/5 border-white/10 text-white placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                                    }`}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                                    Address
                                </label>
                                <textarea
                                    value={correctedAddress}
                                    onChange={(e) => setCorrectedAddress(e.target.value)}
                                    placeholder="e.g. 123 Main St, Springfield, IL 62701"
                                    rows={3}
                                    className={`w-full px-4 py-3 rounded-2xl border text-sm font-bold outline-none focus:border-indigo-500 transition-colors resize-none ${
                                        isDark ? 'bg-white/5 border-white/10 text-white placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                                    }`}
                                />
                            </div>
                        </div>
                    )}

                    {editMode === 'pin' && (
                        <>
                            {/* Instruction Hint Banner */}
                            <div className="px-3.5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-indigo-500/15 border border-amber-500/30 flex items-center gap-2.5">
                                <span className="text-lg shrink-0">📍</span>
                                <p className="text-[11px] font-bold text-amber-200/90 leading-snug">
                                    <strong>Precision Adjustment:</strong> Drag and pan the map so the crosshair pin aligns directly with the correct location.
                                </p>
                            </div>

                            {/* Interactive Reticle Map Container */}
                            <div className="relative w-full h-64 sm:h-72 rounded-3xl overflow-hidden border border-white/15 shadow-inner bg-slate-950">
                                <div ref={mapContainerRef} className="absolute inset-0 w-full h-full rounded-3xl" />

                                {/* Stationary Center Target Pin / Crosshair */}
                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                    <div className="relative flex flex-col items-center -translate-y-5">
                                        {/* Animated Pulsing Radar Rings */}
                                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-indigo-400/60 bg-indigo-500/15 animate-ping" />
                                        
                                        {/* Center Pin Badge */}
                                        <div className="relative z-10 w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 border-[3px] border-white shadow-2xl flex items-center justify-center text-xl text-white">
                                            🎯
                                        </div>
                                        
                                        {/* Needle Tip pointing at center */}
                                        <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-purple-600 -mt-0.5 filter drop-shadow(0 2px 4px rgba(0,0,0,0.5))" />

                                        {/* Elevation Shadow underneath */}
                                        <div className="w-5 h-2 rounded-full bg-black/50 blur-[2px] mt-1" />
                                    </div>
                                </div>

                                {/* Geofence & Departure Hysteresis Legend Badge */}
                                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-950/85 border border-white/15 backdrop-blur-md shadow-lg pointer-events-none z-10">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 border border-white/80" />
                                        <span className="text-[10px] font-bold text-white">Safe Zone ({Math.round(place.radius ? (place.radius > 5 ? place.radius : place.radius * 1000) : 15)}m)</span>
                                    </div>
                                    {(place.radius ? (place.radius > 5 ? place.radius : place.radius * 1000) : 15) <= 30 && (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-4 h-0 border-t-2 border-dashed border-sky-400" />
                                            <span className="text-[10px] font-bold text-sky-300">Departure Buffer (+3m)</span>
                                        </div>
                                    )}
                                </div>

                                {/* Map Floating Tools Overlay */}
                                <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
                                    {userLocation && (
                                        <button
                                            type="button"
                                            onClick={handleSnapToGps}
                                            className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95"
                                            title="Snap to my exact location"
                                        >
                                            <span>🎯</span>
                                            <span>My GPS</span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleResetLocation}
                                        className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95"
                                        title="Reset to original map position"
                                    >
                                        <span>↺</span>
                                        <span>Reset</span>
                                    </button>
                                </div>

                                {/* Live Coordinate & Offset Readout Pill */}
                                <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2 px-3 py-1.5 rounded-2xl bg-black/80 backdrop-blur-md border border-white/15 text-[11px] font-bold text-white z-10 shadow-lg">
                                    <span className="truncate font-mono text-slate-300">
                                        {currentCoords.lat.toFixed(5)}, {currentCoords.lng.toFixed(5)}
                                    </span>
                                    {distanceFeet > 15 ? (
                                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] shrink-0">
                                            Moved {distanceFeet} ft {direction}
                                        </span>
                                    ) : (
                                        <span className="text-slate-400 text-[10px] shrink-0">
                                            At original pin
                                        </span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {editMode === 'entrance' && (
                        <>
                            {/* Entrance Category Selector Chips */}
                            <div className="space-y-1.5">
                                <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                                    Entrance Category
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {ENTRANCE_CATEGORY_OPTIONS.map((opt) => {
                                        const isSelected = entranceType === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => {
                                                    setEntranceType(opt.id);
                                                    if (!entranceNotes) {
                                                        setEntranceNotes(opt.defaultNote);
                                                    }
                                                }}
                                                className={`p-2.5 rounded-2xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-indigo-600/30 border-indigo-400 shadow-md ring-1 ring-indigo-400/50 text-white'
                                                        : isDark
                                                            ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                                                            : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                                                }`}
                                            >
                                                <span className="text-xl shrink-0">{opt.icon}</span>
                                                <div className="min-w-0">
                                                    <span className="text-xs font-black block truncate">{opt.label}</span>
                                                    <span className="text-[9px] text-slate-400 block truncate">{opt.description}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Storefront / Entrance Photo Section */}
                            <div className={`p-4 rounded-3xl border space-y-3 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">📸</span>
                                        <div>
                                            <h4 className={`text-xs font-black uppercase tracking-wider ${textColor}`}>
                                                Storefront & Entrance Photo
                                            </h4>
                                            <p className="text-[10px] text-slate-400 font-semibold">
                                                Help drivers instantly recognize the building and entrance
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {photoPreview ? (
                                    <div className="relative rounded-2xl overflow-hidden border border-white/20 shadow-lg group">
                                        <img
                                            src={photoPreview}
                                            alt="Entrance preview"
                                            className="w-full h-40 object-cover"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 opacity-90 transition-opacity" />
                                        
                                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                                            <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-black/60 backdrop-blur-md text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                                                <span>✓</span> Photo Attached
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => fileInputRef.current?.click()}
                                                    className="px-2.5 py-1 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md text-white text-[11px] font-bold transition-all"
                                                >
                                                    Retake
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPhotoPreview(null)}
                                                    className="w-7 h-7 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center transition-all"
                                                    title="Remove Photo"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploadingPhoto}
                                        className={`w-full py-4 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer group ${
                                            isDark
                                                ? 'border-white/20 hover:border-indigo-400 bg-white/5 hover:bg-white/10'
                                                : 'border-slate-300 hover:border-indigo-500 bg-white hover:bg-indigo-50/50'
                                        }`}
                                    >
                                        <span className="text-2xl group-hover:scale-110 transition-transform">
                                            {isUploadingPhoto ? '⏳' : '📷'}
                                        </span>
                                        <span className={`text-xs font-black ${textColor}`}>
                                            {isUploadingPhoto ? 'Processing Camera Capture...' : 'Snap Photo (Camera Only)'}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-semibold">
                                            Live camera capture for storefront, door, or driveway
                                        </span>
                                    </button>
                                )}

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handlePhotoChange}
                                    className="hidden"
                                />
                            </div>

                            {/* Entrance / Driving Notes */}
                            <div className="space-y-1.5">
                                <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                                    Entrance & Parking Guidance (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={entranceNotes}
                                    onChange={(e) => setEntranceNotes(e.target.value)}
                                    placeholder="e.g. Drive-thru is on east side, enter from 2nd light"
                                    className={`w-full px-4 py-2.5 rounded-2xl border text-xs font-bold outline-none focus:border-indigo-500 transition-colors ${
                                        isDark ? 'bg-white/5 border-white/10 text-white placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                                    }`}
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Visibility Toggle (Public Crowdsource vs Circle Only) */}
                <div className="px-5 pt-3 pb-1 shrink-0 border-t border-white/5">
                    <label className={`text-[10px] font-black uppercase tracking-wider block mb-1.5 ${subTextColor}`}>
                        Report Visibility
                    </label>
                    <div className={`p-1 rounded-2xl border flex items-center gap-1 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                        <button
                            type="button"
                            onClick={() => setVisibility('public')}
                            className={`flex-1 py-2 px-2.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                visibility === 'public'
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20 scale-[1.01]'
                                    : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <span>🌐</span>
                            <span>Share Publicly (Help all drivers)</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setVisibility('circle')}
                            className={`flex-1 py-2 px-2.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                visibility === 'circle'
                                    ? (isDark ? 'bg-white/20 text-white shadow-md' : 'bg-white text-slate-900 shadow-sm')
                                    : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <span>🔒</span>
                            <span>Circle Only</span>
                        </button>
                    </div>
                    <p className={`text-[10px] mt-1.5 px-1 font-semibold ${subTextColor}`}>
                        {visibility === 'public'
                            ? '🚀 Community Map Edit: Helps all drivers find the correct spot. Anonymously shared with community.'
                            : '🔒 Private: Only members in your Circle will see this correction.'}
                    </p>
                </div>

                {/* Footer Actions */}
                <div className="p-5 pt-2 border-t border-white/10 flex items-center gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className={`px-5 py-3 rounded-2xl border font-bold text-xs transition-all active:scale-95 ${
                            isDark ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-1 py-3 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl font-black text-xs sm:text-sm shadow-xl shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                        <span>{isSaving ? '⏳' : '💾'}</span>
                        <span>{isSaving ? 'Saving Correction...' : 'Save Corrected Location'}</span>
                    </button>
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default CorrectLocationModal;
