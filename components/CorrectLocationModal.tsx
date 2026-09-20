import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Place, Location } from '../types';
import { placeCorrectionService, PlaceCorrection } from '../services/placeCorrectionService';
import { contributionService } from '../services/contributionService';
import { getDistanceMeters, getBearing } from '../utils/geo';
import { hapticSuccess, hapticError, hapticTick } from '../utils/haptics';
import {
    FileEdit,
    MapPin,
    LocateFixed,
    RotateCcw,
    Loader2,
    X,
    Globe,
    Lock,
    Save,
    Home,
    Utensils,
    Coffee,
    Fuel,
    ShoppingCart,
    Briefcase,
    Dumbbell,
    Pill,
} from 'lucide-react';

export const PUBLIC_PLACE_CATEGORIES: {
    type: Place['type'];
    label: string;
    icon: string;
    iconComp: React.ComponentType<{ className?: string }>;
}[] = [
    { type: 'residential', label: 'Residential', icon: '🏠', iconComp: Home },
    { type: 'food', label: 'Food & Dining', icon: '🍔', iconComp: Utensils },
    { type: 'coffee', label: 'Coffee & Cafe', icon: '☕', iconComp: Coffee },
    { type: 'gas', label: 'Gas Station', icon: '⛽', iconComp: Fuel },
    { type: 'grocery', label: 'Store / Market', icon: '🛒', iconComp: ShoppingCart },
    { type: 'work', label: 'Office / Work', icon: '💼', iconComp: Briefcase },
    { type: 'gym', label: 'Gym / Fitness', icon: '🏋️', iconComp: Dumbbell },
    { type: 'pharmacy', label: 'Pharmacy / Health', icon: '💊', iconComp: Pill },
    { type: 'other', label: 'Other / Landmark', icon: '📍', iconComp: MapPin },
];

interface CorrectLocationModalProps {
    place: Place | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (correctedPlace: Place, correction: PlaceCorrection) => void;
    onPendingSubmitted?: (placeName: string, status: 'pending' | 'approved') => void;
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
    userAvatar,
    onPendingSubmitted
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<maplibregl.Map | null>(null);

    const [currentCoords, setCurrentCoords] = useState<Location>({ lat: 0, lng: 0 });
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Public reporting essential fields
    const [correctedName, setCorrectedName] = useState('');
    const [correctedAddress, setCorrectedAddress] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<Place['type']>('other');
    const [visibility, setVisibility] = useState<'public' | 'circle'>('public');

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';
    const panelBg = isDark ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';

    // Initialize state from place props
    useEffect(() => {
        if (place) {
            const loc = place.location || { lat: 35.105, lng: -78.966 };
            setCurrentCoords({ lat: loc.lat, lng: loc.lng });
            setCorrectedName(place.name || '');
            setCorrectedAddress(place.address || place.description || '');
            setSelectedCategory(place.type === 'home' ? 'residential' : (place.type || 'residential'));
            setVisibility('public');
            setStep(1);
        }
    }, [place, isOpen]);

    // Initialize clean MapLibre pin placement map
    useEffect(() => {
        if (!isOpen || !place || step !== 2 || !mapContainerRef.current) return;

        // A correction dialog can open consecutively for different search
        // results. Always seed its map from the place being edited, never from
        // the previous dialog's retained center-pin state.
        const initialLat = place.location?.lat || currentCoords.lat || 35.105;
        const initialLng = place.location?.lng || currentCoords.lng || -78.966;

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

        const updateCoordsFromCenter = () => {
            if (!mapContainerRef.current || !mapInstanceRef.current) return null;
            const rect = mapContainerRef.current.getBoundingClientRect();
            const unprojected = mapInstanceRef.current.unproject([rect.width / 2, rect.height / 2]);
            const nextCoords = {
                lat: parseFloat(unprojected.lat.toFixed(6)),
                lng: parseFloat(unprojected.lng.toFixed(6))
            };
            setCurrentCoords(nextCoords);
            return nextCoords;
        };

        map.on('move', updateCoordsFromCenter);

        map.on('dragend', () => {
            updateCoordsFromCenter();
            hapticTick();
        });

        // Click anywhere on map to reposition pin to exact clicked coordinates
        map.on('click', (e) => {
            if (!mapContainerRef.current || !mapInstanceRef.current) return;
            const rect = mapContainerRef.current.getBoundingClientRect();
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
            map.remove();
            mapInstanceRef.current = null;
        };
    }, [isOpen, step, place?.id, place?.location?.lat, place?.location?.lng, isDark]);

    if (!isOpen || !place) return null;

    // Reset returns to the selected place's current search/result pin. Its
    // historical originalLocation is for audit data, not this edit target.
    const originalLoc = place.location || place.originalLocation || { lat: 35.105, lng: -78.966 };
    const distanceMeters = getDistanceMeters(originalLoc, currentCoords);
    const distanceFeet = Math.round(distanceMeters * 3.28084);
    const bearing = getBearing(originalLoc, currentCoords);
    const direction = getDirectionLabel(bearing);

    const handleSnapToGps = () => {
        if (!userLocation || !mapInstanceRef.current) return;
        mapInstanceRef.current.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 18,
            duration: 500
        });
    };

    const handleResetLocation = () => {
        if (!mapInstanceRef.current) return;
        mapInstanceRef.current.flyTo({
            center: [originalLoc.lng, originalLoc.lat],
            zoom: 17.5,
            duration: 500
        });
    };

    const handleSave = async () => {
        if (!place) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            // Recompute exact unprojected coordinates right at save time
            let finalCoords = currentCoords;
            if (mapInstanceRef.current && mapContainerRef.current) {
                const rect = mapContainerRef.current.getBoundingClientRect();
                const unprojected = mapInstanceRef.current.unproject([rect.width / 2, rect.height / 2]);
                finalCoords = {
                    lat: parseFloat(unprojected.lat.toFixed(6)),
                    lng: parseFloat(unprojected.lng.toFixed(6))
                };
            }

            const isPublicReport = visibility === 'public';
            const publicDisplayName = isPublicReport ? 'MyWay Community' : (userName || 'You');
            const publicAvatar = isPublicReport ? undefined : userAvatar;

            // Community updates affect shared navigation. They must not update
            // a public target until My Way Operations has approved them.
            if (isPublicReport) {
                const accessPoint = await placeCorrectionService.saveAccessPoint(place, {
                    name: correctedName.trim() || place.name,
                    type: 'main_entrance',
                    entranceType: 'main_door',
                    location: finalCoords,
                    notes: [
                        correctedAddress.trim() ? `Address reported: ${correctedAddress.trim()}` : '',
                        selectedCategory ? `Category reported: ${selectedCategory}` : ''
                    ].filter(Boolean).join(' · ')
                });
                await contributionService.recordTripContribution({
                    tripId: `access_point_${accessPoint.id}`,
                    destinationAddress: correctedAddress.trim() || place.address || place.description || place.name,
                    destinationName: correctedName.trim() || place.name,
                    placeId: place.id,
                    rating: 0,
                    tags: ['shared_navigation_update', selectedCategory],
                    placeType: selectedCategory === 'home' || selectedCategory === 'residential' ? 'residential' : 'business',
                    isAccurate: false,
                    correctedCoordinates: [finalCoords.lng, finalCoords.lat],
                    correctedLocation: finalCoords,
                    type: 'pin_correction',
                    timestamp: Date.now(),
                    userId,
                    userName,
                    userAvatar,
                    entranceType: 'main_door',
                    reviewStatus: accessPoint.status === 'approved' ? 'approved' : 'pending'
                });
                onPendingSubmitted?.(correctedName.trim() || place.name, accessPoint.status);
                hapticSuccess();
                onClose();
                return;
            }

            // Submit correction record
            const correction = await placeCorrectionService.saveCorrection({
                place,
                correctedLocation: finalCoords,
                correctedName: correctedName.trim() || undefined,
                correctedAddress: correctedAddress.trim() || undefined,
                category: selectedCategory,
                userId: isPublicReport ? 'community' : userId,
                submitterName: publicDisplayName,
                submitterAvatar: publicAvatar
            });

            // Construct updated place preserving any personal circle tracking attributes (entranceBox, entrancePin, radius)
            const updatedPlace: Place = {
                ...place,
                name: correctedName.trim() || place.name,
                description: correctedAddress.trim() || place.description,
                address: correctedAddress.trim() || place.address || place.description,
                type: selectedCategory || place.type,
                category: selectedCategory,
                location: finalCoords,
                entrancePin: finalCoords,
                entranceLocation: finalCoords,
                entrancePrecision: place.entrancePrecision ? {
                    ...place.entrancePrecision,
                    location: finalCoords
                } : undefined,
                imageUrl: place.imageUrl,
                isCorrected: true,
                isCommunityVerified: isPublicReport,
                visibility: visibility,
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
            console.error('Failed to save public place suggestion:', err);
            setSaveError('We could not send this update to My Way Operations. Please try again.');
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
                        <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-xl shadow-inner">
                            <FileEdit className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                            <h3 className={`text-base sm:text-lg font-black tracking-wide leading-tight ${textColor}`}>
                                Update Place Details
                            </h3>
                            <p className="text-xs text-slate-400 font-semibold truncate max-w-[240px] sm:max-w-[320px]">
                                {place.name} • Community Place Update
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-5 py-3 border-b border-white/10 shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-wider ${subTextColor}`}>Step {step} of 3</span>
                        <span className={`text-[10px] font-bold ${subTextColor}`}>
                            {step === 1 ? 'Place details' : step === 2 ? 'Pin location' : 'Sharing'}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5" aria-label={`Step ${step} of 3`}>
                        {[1, 2, 3].map((item) => (
                            <div key={item} className={`h-1.5 rounded-full transition-colors ${item <= step ? 'bg-amber-500' : isDark ? 'bg-white/10' : 'bg-slate-200'}`} />
                        ))}
                    </div>
                </div>

                {/* Body Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
                    {step === 1 && <>
                    {/* Place Name Input */}
                    <div>
                        <label className={`text-[10px] font-black uppercase tracking-wider block mb-1 ${subTextColor}`}>
                            Place Name
                        </label>
                        <input
                            type="text"
                            value={correctedName}
                            onChange={(e) => setCorrectedName(e.target.value)}
                            placeholder="e.g. Starbucks, Target, Local Market"
                            className={`w-full px-4 py-2.5 rounded-xl border text-sm font-bold outline-none focus:border-amber-400 transition-colors ${
                                isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                            }`}
                        />
                    </div>

                    {/* Category Selector */}
                    <div>
                        <label className={`text-[10px] font-black uppercase tracking-wider block mb-1.5 ${subTextColor}`}>
                            Place Category
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {PUBLIC_PLACE_CATEGORIES.map((cat) => {
                                const isSelected = selectedCategory === cat.type;
                                const IconComp = cat.iconComp;
                                return (
                                    <button
                                        key={cat.type}
                                        type="button"
                                        onClick={() => setSelectedCategory(cat.type)}
                                        className={`p-2 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                            isSelected
                                                ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-md ring-1 ring-amber-400/40'
                                                : isDark
                                                    ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                        }`}
                                    >
                                        <IconComp className={`w-5 h-5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
                                        <span className="text-[10px] font-bold truncate">{cat.label.split(' ')[0]}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Address Accuracy */}
                    <div>
                        <label className={`text-[10px] font-black uppercase tracking-wider block mb-1 ${subTextColor}`}>
                            Address & Street Details
                        </label>
                        <textarea
                            value={correctedAddress}
                            onChange={(e) => setCorrectedAddress(e.target.value)}
                            placeholder="e.g. 123 Main St, Suite 400, City, State"
                            rows={2}
                            className={`w-full px-4 py-2 rounded-xl border text-xs font-bold outline-none focus:border-amber-400 transition-colors resize-none ${
                                isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                            }`}
                        />
                    </div>

                    </>}

                    {/* Interactive Map Pin Placement */}
                    {step === 2 && <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className={`text-[10px] font-black uppercase tracking-wider block ${subTextColor}`}>
                                Exact Storefront / Entrance Pin
                            </label>
                            <span className="text-[10px] text-slate-400">
                                Drag map to center crosshair
                            </span>
                        </div>

                        <div className="relative w-full h-[52vh] min-h-[360px] max-h-[520px] rounded-3xl overflow-hidden border border-white/15 shadow-inner bg-slate-950">
                            <div ref={mapContainerRef} className="absolute inset-0 w-full h-full rounded-3xl" />

                            {/* Clean Pin Reticle Centered over map */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="relative pointer-events-none flex flex-col items-center">
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border-2 border-amber-400/60 bg-amber-500/15 animate-ping" />
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-white shadow-[0_0_10px_rgba(251,191,36,1)] z-20" />

                                    <div className="relative flex flex-col items-center -translate-y-[calc(100%+2px)]">
                                        <div className="relative z-10 w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 border-[3px] border-white shadow-2xl flex items-center justify-center text-white">
                                            <MapPin className="w-5 h-5 shrink-0" />
                                        </div>
                                        <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-amber-600 -mt-0.5 filter drop-shadow(0 2px 4px rgba(0,0,0,0.5))" />
                                        <div className="w-5 h-2 rounded-full bg-black/50 blur-[2px] mt-1" />
                                    </div>
                                </div>
                            </div>

                            {/* Map Floating Tools */}
                            <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
                                {userLocation && (
                                    <button
                                        type="button"
                                        onClick={handleSnapToGps}
                                        className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                        title="Snap to my exact location"
                                    >
                                        <LocateFixed className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                        <span>My GPS</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleResetLocation}
                                    className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-white/20 shadow-lg backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                    title="Reset to original map position"
                                >
                                    <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>Reset</span>
                                </button>
                            </div>

                            {/* Distance Displaced Status Pill */}
                            <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-black/85 backdrop-blur-md border border-white/15 text-xs font-bold text-white z-10 shadow-lg">
                                <span className="text-slate-300 text-[11px]">
                                    Place pin at main storefront
                                </span>
                                {distanceFeet > 15 ? (
                                    <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] shrink-0">
                                        Moved {distanceFeet} ft {direction}
                                    </span>
                                ) : (
                                    <span className="text-slate-400 text-[10px] shrink-0">
                                        Original location
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    }

                </div>

                {/* Visibility Toggle */}
                {step === 3 && <div className="px-5 py-5 flex-1 overflow-y-auto border-t border-white/5">
                    <label className={`text-[10px] font-black uppercase tracking-wider block mb-1.5 ${subTextColor}`}>
                        Who Can See This
                    </label>
                    <div className={`p-1 rounded-2xl border flex items-center gap-1 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                        <button
                            type="button"
                            onClick={() => setVisibility('public')}
                            className={`flex-1 py-2 px-2.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                visibility === 'public'
                                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/20 scale-[1.01]'
                                    : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <Globe className="w-3.5 h-3.5 shrink-0" />
                            <span>Share with Community</span>
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
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>Circle Only</span>
                        </button>
                    </div>
                    <p className={`text-[10px] mt-1.5 px-1 font-semibold ${subTextColor}`}>
                        {visibility === 'public'
                            ? 'Public Community Map Edit: Anonymously shared to help all drivers recognize and locate this place.'
                            : 'Private: Only members in your Circle will see this correction.'}
                    </p>
                </div>}

                {saveError && (
                    <div role="alert" className="mx-5 mb-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        {saveError}
                    </div>
                )}

                {/* Footer Actions */}
                <div className="p-5 pt-2 border-t border-white/10 flex items-center gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={() => step === 1 ? onClose() : setStep((step - 1) as 1 | 2 | 3)}
                        className={`px-5 py-3 rounded-2xl border font-bold text-xs transition-all active:scale-95 ${
                            isDark ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                    >
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>
                    <button
                        type="button"
                        onClick={() => step === 3 ? handleSave() : setStep((step + 1) as 1 | 2 | 3)}
                        disabled={isSaving}
                        className="flex-1 py-3 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-600 text-white rounded-2xl font-black text-xs sm:text-sm shadow-xl shadow-amber-600/30 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                        {step === 3 && isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : step === 3 ? (
                            <Save className="w-4 h-4 shrink-0" />
                        ) : null}
                        <span>{step === 3 ? (isSaving ? 'Submitting...' : visibility === 'public' ? 'Submit for Review' : 'Update Place Details') : 'Continue'}</span>
                    </button>
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default CorrectLocationModal;
