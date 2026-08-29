
import React, { useEffect, useState, useMemo } from 'react';
import { Place, Location, NavigationRoute, FamilyMember } from '../types';
import { fetchRouteOptions } from '../services/osrmService';
import { vehicleFuelService } from '../services/vehicleFuelService';
import { convoyService } from '../services/convoyService';
import BrandIcon from './BrandIcon';

interface PlaceDetailPanelProps {
    place: Place;
    onClose: () => void;
    onNavigate: (selectedRoute?: NavigationRoute) => void;
    theme: 'light' | 'dark';
    userLocation?: Location | null;
    isMobile?: boolean;
    onUpdateRadius?: (placeId: string, radius: number) => void;
    isSaved?: boolean;
    onAddPlace?: (place: Omit<Place, 'id'>) => void;
    onDeletePlace?: (placeId: string) => void;
    onSelectRoutePreview?: (route: NavigationRoute) => void;
    candidatePlaces?: Place[];
    onSelectCandidate?: (place: Place) => void;
    members?: FamilyMember[];
    currentUserId?: string;
}

/**
 * Formats the straight-line distance between user and place.
 */
function formatDistanceFromUser(userLoc: Location | null | undefined, placeLoc: Location): string | null {
    if (!userLoc) return null;
    const R = 3958.8; // Earth radius in miles
    const dLat = (placeLoc.lat - userLoc.lat) * Math.PI / 180;
    const dLng = (placeLoc.lng - userLoc.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(userLoc.lat * Math.PI / 180) * Math.cos(placeLoc.lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
}

const PlaceDetailPanel: React.FC<PlaceDetailPanelProps> = ({
    place,
    onClose,
    onNavigate,
    theme,
    userLocation,
    isMobile = false,
    onUpdateRadius,
    isSaved = false,
    onAddPlace,
    onDeletePlace,
    onSelectRoutePreview,
    candidatePlaces = [],
    onSelectCandidate,
    members = [],
    currentUserId = ''
}) => {
    const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
    const subTextColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';
    const tagColor = theme === 'dark' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-700';

    const [isSavingPlace, setIsSavingPlace] = useState(false);
    const [isConvoySetupOpen, setIsConvoySetupOpen] = useState(false);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(() => {
        return members.filter(m => m.id !== currentUserId).map(m => m.id);
    });

    useEffect(() => {
        setSelectedMemberIds(members.filter(m => m.id !== currentUserId).map(m => m.id));
    }, [members, currentUserId]);
    const [newPlaceName, setNewPlaceName] = useState(place.name || '');
    const [newPlaceIcon, setNewPlaceIcon] = useState(place.icon || '📍');
    const [newPlaceType, setNewPlaceType] = useState<'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other'>(() => {
        if (place.type && place.type !== 'search_result' && place.type !== 'sponsored') {
            return place.type as any;
        }
        return 'other';
    });

    // Multi-route alternatives state
    const [routeOptions, setRouteOptions] = useState<NavigationRoute[]>([]);
    const [selectedRouteIdx, setSelectedRouteIdx] = useState<number>(0);
    const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(true);
    const [avoidTolls, setAvoidTolls] = useState<boolean>(() => {
        return localStorage.getItem('myway_avoid_tolls') === 'true';
    });

    const activeVehicle = useMemo(() => vehicleFuelService.getActiveVehicle(), []);

    useEffect(() => {
        if (!userLocation || !place.location) {
            setIsLoadingRoutes(false);
            return;
        }
        let isMounted = true;
        setIsLoadingRoutes(true);
        fetchRouteOptions(userLocation, place.name || 'Destination', place.location, { avoidTolls })
            .then(routes => {
                if (isMounted) {
                    setRouteOptions(routes);
                    setSelectedRouteIdx(0);
                    setIsLoadingRoutes(false);
                    if (routes.length > 0 && onSelectRoutePreview) {
                        onSelectRoutePreview(routes[0]);
                    }
                }
            })
            .catch(() => {
                if (isMounted) setIsLoadingRoutes(false);
            });

        return () => { isMounted = false; };
    }, [place.name, place.location, userLocation, avoidTolls]);

    useEffect(() => {
        setNewPlaceName(place.name || '');
        setNewPlaceIcon(place.icon || '📍');
        if (place.type && place.type !== 'search_result' && place.type !== 'sponsored') {
            setNewPlaceType(place.type as any);
        } else {
            setNewPlaceType('other');
        }
        setIsSavingPlace(false);
    }, [place]);

    const distance = formatDistanceFromUser(userLocation, place.location);
    const addressSubtitle = place.description || '';
    const typeLabel = place.type?.replace('_', ' ') || '';
    const bgColor = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';

    if (isSavingPlace) {
        return (
            <div
                className={`w-full max-w-sm rounded-[2rem] shadow-[0_10px_50px_rgba(0,0,0,0.5)] border backdrop-blur-2xl overflow-hidden p-6 animate-in fade-in duration-200 ${bgColor}`}
                style={isMobile ? { paddingBottom: 'env(safe-area-inset-bottom, 16px)' } : {}}
            >
                <div className="flex justify-between items-center mb-4">
                    <h3 className={`text-base font-black uppercase tracking-wider ${textColor}`}>Save to Circle</h3>
                    <button
                        onClick={() => setIsSavingPlace(false)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                            theme === 'dark' ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                        ✕
                    </button>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Place Name</label>
                        <input
                            type="text"
                            value={newPlaceName}
                            onChange={(e) => setNewPlaceName(e.target.value)}
                            className={`w-full px-4 py-2.5 rounded-xl border text-sm font-semibold outline-none focus:border-indigo-500 ${
                                theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                            }`}
                            placeholder="e.g. Grandma's House"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Category & Icon</label>
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { type: 'home', icon: '🏠', label: 'Home' },
                                { type: 'work', icon: '💼', label: 'Work' },
                                { type: 'school', icon: '🏫', label: 'School' },
                                { type: 'gym', icon: '🏋️', label: 'Gym' },
                                { type: 'food', icon: '🍔', label: 'Food' },
                                { type: 'coffee', icon: '☕', label: 'Coffee' },
                                { type: 'gas', icon: '⛽', label: 'Gas' },
                                { type: 'other', icon: '📍', label: 'Other' },
                            ].map((item) => (
                                <button
                                    key={item.type}
                                    type="button"
                                    onClick={() => {
                                        setNewPlaceType(item.type as any);
                                        setNewPlaceIcon(item.icon);
                                    }}
                                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                                        newPlaceType === item.type
                                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                                            : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    <span className="text-xl">{item.icon}</span>
                                    <span className="text-[10px] font-bold">{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={() => {
                                if (onAddPlace && newPlaceName.trim()) {
                                    onAddPlace({
                                        name: newPlaceName.trim(),
                                        icon: newPlaceIcon,
                                        location: place.location,
                                        radius: place.radius || 0.3,
                                        type: newPlaceType,
                                        description: place.description || place.name
                                    });
                                    setIsSavingPlace(false);
                                }
                            }}
                            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95"
                        >
                            Save Place
                        </button>
                        <button
                            onClick={() => setIsSavingPlace(false)}
                            className={`px-4 py-3 rounded-xl border font-bold text-sm transition-all active:scale-95 ${
                                theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                            }`}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ──────────────────────────────────────────
    // MOBILE BOTTOM SHEET LAYOUT
    // ──────────────────────────────────────────
    if (isMobile) {
        const sheetBg = theme === 'dark'
            ? 'bg-[#0f172a]/98 border-white/10'
            : 'bg-white/98 border-slate-200';

        return (
            <div
                className={`w-full rounded-t-[2rem] shadow-[0_-10px_50px_rgba(0,0,0,0.5)] border-t backdrop-blur-2xl overflow-hidden animate-in slide-in-from-bottom duration-300 ${sheetBg}`}
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
            >
                {/* Drag Handle Pill */}
                <div className="pt-3 pb-1">
                    <div className={`w-12 h-1 rounded-full mx-auto ${theme === 'dark' ? 'bg-white/20' : 'bg-slate-300'}`} />
                </div>

                {/* Content */}
                <div className="px-5 pb-5 pt-1">
                    {/* Top Row: Icon + Info + Close */}
                    <div className="flex items-start gap-4">
                        {/* Place Icon */}
                        <BrandIcon placeName={place.name} defaultIcon={place.icon} size="xl" className="shadow-lg" />

                        {/* Place Info */}
                        <div className="flex-1 min-w-0">
                            <h3 className={`text-lg font-black leading-tight truncate ${textColor}`}>{place.name}</h3>

                            {addressSubtitle && (
                                <p className={`text-xs leading-snug mt-0.5 flex items-start gap-1 ${subTextColor}`}>
                                    <svg className="w-3 h-3 mt-0.5 shrink-0 opacity-60" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                                    <span className="line-clamp-2">{addressSubtitle}</span>
                                </p>
                            )}

                            {/* Tags Row */}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {typeLabel && (
                                    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${tagColor}`}>
                                        {typeLabel}
                                    </span>
                                )}
                                {distance && (
                                    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${theme === 'dark' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                                        📏 {distance}
                                    </span>
                                )}
                            </div>

                            {/* Matching Search Candidates Switcher (Mobile) */}
                            {candidatePlaces && candidatePlaces.length > 1 && (
                                <div className="mt-2.5">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-[9px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`}>
                                            📍 {candidatePlaces.length} Matches Found (Nearest First)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                                        {candidatePlaces.map((cand) => {
                                            const isSelected = cand.id === place.id || (cand.location.lat === place.location.lat && cand.location.lng === place.location.lng);
                                            const candDist = formatDistanceFromUser(userLocation, cand.location);
                                            return (
                                                <button
                                                    key={cand.id}
                                                    type="button"
                                                    onClick={() => onSelectCandidate?.(cand)}
                                                    className={`px-2.5 py-1 rounded-xl text-[10px] font-bold shrink-0 transition-all flex items-center gap-1.5 border
                                                        ${isSelected
                                                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-1 ring-indigo-400/50'
                                                            : theme === 'dark'
                                                                ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                                                                : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                                                        }`}
                                                >
                                                    <span className="truncate max-w-[140px]">{cand.name}</span>
                                                    {candDist && (
                                                        <span className={`text-[8px] px-1 py-0.5 rounded ${isSelected ? 'bg-indigo-700 text-white' : 'bg-black/20 text-emerald-400'}`}>
                                                            {candDist}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Save / Unsave Star Button */}
                        <button
                            onClick={() => {
                                if (isSaved) {
                                    if (onDeletePlace) onDeletePlace(place.id);
                                } else {
                                    setIsSavingPlace(true);
                                }
                            }}
                            className={`p-2 rounded-full shrink-0 transition-all text-base flex items-center justify-center ${
                                theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                            title={isSaved ? "Remove from Saved Places" : "Save Place"}
                        >
                            {isSaved ? '⭐' : '☆'}
                        </button>

                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className={`p-2 rounded-full shrink-0 transition-all ${theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    {/* Route Options Selection Header */}
                    <div className="mt-3 mb-2">
                        <div className="flex items-center justify-between mb-1.5 px-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[10px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                    Route Choices {routeOptions.length > 1 ? `(${routeOptions.length})` : ''}
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                    theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
                                }`} title={`Calculated with ${activeVehicle.name} (${activeVehicle.mpg} MPG)`}>
                                    🚗 {activeVehicle.mpg} MPG
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !avoidTolls;
                                        setAvoidTolls(next);
                                        localStorage.setItem('myway_avoid_tolls', String(next));
                                    }}
                                    className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all flex items-center gap-1 ${
                                        avoidTolls
                                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm ring-1 ring-emerald-500/30'
                                            : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    <span>{avoidTolls ? '🟢' : '💳'}</span>
                                    <span>{avoidTolls ? 'Avoiding Tolls' : 'Avoid Tolls'}</span>
                                </button>
                            </div>
                            {routeOptions[selectedRouteIdx] && (
                                <span className="text-[10px] font-bold text-emerald-400">
                                    {routeOptions[selectedRouteIdx].totalTime} • {routeOptions[selectedRouteIdx].totalDistance}
                                </span>
                            )}
                        </div>

                        {isLoadingRoutes ? (
                            <div className={`p-3 rounded-2xl border animate-pulse flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                                <span className="text-sm">🔄</span>
                                <span className="text-xs font-bold">Calculating toll & gas route options...</span>
                            </div>
                        ) : routeOptions.length > 0 ? (
                            <div className="space-y-1.5 max-h-52 overflow-y-auto no-scrollbar">
                                {routeOptions.map((route, idx) => {
                                    const isSelected = selectedRouteIdx === idx;
                                    return (
                                        <button
                                            key={route.id || idx}
                                            type="button"
                                            onClick={() => {
                                                setSelectedRouteIdx(idx);
                                                if (onSelectRoutePreview) onSelectRoutePreview(route);
                                            }}
                                            className={`w-full p-2.5 rounded-2xl border transition-all text-left flex items-center justify-between gap-2.5
                                                ${isSelected
                                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                                                    : theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 font-bold ${
                                                    route.routeType === 'fastest' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                                    route.routeType === 'toll_free' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                                    route.routeType === 'eco' ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' :
                                                    route.routeType === 'scenic' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                    'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                                }`}>
                                                    {route.routeType === 'fastest' ? '⚡' : route.routeType === 'toll_free' ? '🟢' : route.routeType === 'eco' ? '🌿' : route.routeType === 'scenic' ? '🌲' : '🛣️'}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className={`text-xs font-black truncate ${textColor}`}>
                                                            {route.routeLabel || 'Route'}
                                                        </span>
                                                        {route.savingsLabel && (
                                                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                                                route.routeType === 'fastest' ? 'bg-amber-500/15 text-amber-400' :
                                                                route.routeType === 'toll_free' ? 'bg-emerald-500/15 text-emerald-400' :
                                                                route.routeType === 'eco' ? 'bg-teal-500/15 text-teal-400' :
                                                                'bg-indigo-500/15 text-indigo-400'
                                                            }`}>
                                                                {route.savingsLabel}
                                                            </span>
                                                        )}
                                                        {route.hasTolls ? (
                                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 shrink-0">
                                                                💳 {route.tollCostEstimate}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0">
                                                                🟢 No Tolls
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mt-0.5 truncate">
                                                        <span className="font-semibold">{route.summary}</span>
                                                        {route.fuelCostEstimate && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="text-slate-300">⛽ {route.fuelCostEstimate}</span>
                                                            </>
                                                        )}
                                                        {route.hasTolls && route.totalEstimatedTripCost && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="text-indigo-400 font-bold">Total ~{route.totalEstimatedTripCost}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-right shrink-0">
                                                <p className={`text-xs font-black ${isSelected ? 'text-indigo-400' : textColor}`}>
                                                    {route.totalTime}
                                                </p>
                                                <p className="text-[9px] text-slate-400">
                                                    {route.totalDistance}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>

                    {/* Geofence Radius Slider */}
                    {onUpdateRadius && (
                        <div className={`mt-2 mb-1 p-2.5 rounded-2xl border ${
                            theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                        }`}>
                            <div className="flex items-center justify-between mb-1">
                                <span className={`text-[10px] font-black uppercase tracking-wider ${
                                    theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'
                                }`}>
                                    Geofence Zone
                                </span>
                                <span className={`text-xs font-bold ${textColor}`}>
                                    {Math.round((place.radius || 0.3) * 1000)}m
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0.05"
                                max="2.0"
                                step="0.05"
                                value={place.radius || 0.3}
                                onChange={(e) => onUpdateRadius(place.id, parseFloat(e.target.value))}
                                className="w-full h-1 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                            />
                            <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                                <span>50m</span>
                                <span>1km</span>
                                <span>2km</span>
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => onNavigate(routeOptions[selectedRouteIdx] || undefined)}
                            className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-base shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            <span>🚀</span> {routeOptions[selectedRouteIdx] ? `Go (${routeOptions[selectedRouteIdx].totalTime})` : 'Go'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                convoyService.startConvoy(
                                    place.name || 'Destination',
                                    place.location,
                                    'self',
                                    'You'
                                );
                                onNavigate(routeOptions[selectedRouteIdx] || undefined);
                            }}
                            className="px-3.5 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-2xl font-bold text-xs shadow-lg shadow-purple-600/30 transition-all active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
                            title="Start Caravan / Convoy with Circle Members"
                        >
                            <span>🚗🚗</span>
                            <span>Convoy</span>
                        </button>
                        <button
                            className={`px-3 py-3.5 rounded-2xl font-bold border transition-all active:scale-95 ${theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                        >
                            Share
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ──────────────────────────────────────────
    // DESKTOP FLOATING CARD LAYOUT
    // ──────────────────────────────────────────

    return (
        <div className={`w-92 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border overflow-hidden animate-in slide-in-from-left duration-300 ${bgColor}`}>
            <div className="relative h-28 bg-indigo-600 flex items-center justify-center overflow-hidden">
                {/* Abstract Background */}
                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>

                <div className="relative z-10 text-5xl drop-shadow-lg transform hover:scale-110 transition-transform duration-300">
                    {place.icon}
                </div>

                {/* Save / Unsave Star Button */}
                <button
                    onClick={() => {
                        if (isSaved) {
                            if (onDeletePlace) onDeletePlace(place.id);
                        } else {
                            setIsSavingPlace(true);
                        }
                    }}
                    className="absolute top-4 left-4 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition-all text-lg flex items-center justify-center animate-in fade-in"
                    title={isSaved ? "Remove from Saved Places" : "Save Place"}
                >
                    {isSaved ? '⭐' : '☆'}
                </button>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition-all"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div className="p-5">
                {/* Place Name */}
                <h3 className={`text-xl font-black leading-tight mb-1 ${textColor}`}>{place.name}</h3>

                {/* Address Subtitle */}
                {addressSubtitle && (
                    <p className={`text-xs leading-snug mb-2 flex items-start gap-1.5 ${subTextColor}`}>
                        <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                        <span className="line-clamp-2">{addressSubtitle}</span>
                    </p>
                )}

                {/* Type Tag + Distance Badge */}
                <div className="flex items-center gap-2 mb-3">
                    {typeLabel && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${tagColor}`}>
                            {typeLabel}
                        </span>
                    )}
                    {distance && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${theme === 'dark' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                            📏 {distance}
                        </span>
                    )}
                </div>

                {/* Matching Search Candidates Switcher (Desktop) */}
                {candidatePlaces && candidatePlaces.length > 1 && (
                    <div className="mb-3.5 p-2.5 rounded-2xl bg-white/5 border border-white/10">
                        <div className="flex items-center justify-between mb-1.5 px-0.5">
                            <span className={`text-[10px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`}>
                                📍 {candidatePlaces.length} Matches Found (Nearest First)
                            </span>
                            <span className={`text-[9px] font-semibold ${subTextColor}`}>
                                Select address
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                            {candidatePlaces.map((cand) => {
                                const isSelected = cand.id === place.id || (cand.location.lat === place.location.lat && cand.location.lng === place.location.lng);
                                const candDist = formatDistanceFromUser(userLocation, cand.location);
                                return (
                                    <button
                                        key={cand.id}
                                        type="button"
                                        onClick={() => onSelectCandidate?.(cand)}
                                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold shrink-0 transition-all flex items-center gap-1.5 border
                                            ${isSelected
                                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-1 ring-indigo-400/50'
                                                : theme === 'dark'
                                                    ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                                                    : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                                            }`}
                                    >
                                        <span className="truncate max-w-[150px]">{cand.name}</span>
                                        {candDist && (
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${isSelected ? 'bg-indigo-700 text-white' : 'bg-black/20 text-emerald-400'}`}>
                                                {candDist}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Route Options Selection (Desktop) */}
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-1.5 px-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                Route Choices {routeOptions.length > 1 ? `(${routeOptions.length})` : ''}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
                            }`} title={`Calculated with ${activeVehicle.name} (${activeVehicle.mpg} MPG)`}>
                                🚗 {activeVehicle.mpg} MPG
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    const next = !avoidTolls;
                                    setAvoidTolls(next);
                                    localStorage.setItem('myway_avoid_tolls', String(next));
                                }}
                                className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all flex items-center gap-1 ${
                                    avoidTolls
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm ring-1 ring-emerald-500/30'
                                        : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                                }`}
                                title="Toggle Avoid Tolls"
                            >
                                <span>{avoidTolls ? '🟢' : '💳'}</span>
                                <span>{avoidTolls ? 'Avoiding Tolls' : 'Avoid Tolls'}</span>
                            </button>
                        </div>
                        {routeOptions[selectedRouteIdx] && (
                            <span className="text-[10px] font-bold text-emerald-400">
                                {routeOptions[selectedRouteIdx].totalTime} • {routeOptions[selectedRouteIdx].totalDistance}
                            </span>
                        )}
                    </div>

                    {isLoadingRoutes ? (
                        <div className={`p-3 rounded-2xl border animate-pulse flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                            <span className="text-sm">🔄</span>
                            <span className="text-xs font-bold">Finding routes & toll costs...</span>
                        </div>
                    ) : routeOptions.length > 0 ? (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto no-scrollbar">
                            {routeOptions.map((route, idx) => {
                                const isSelected = selectedRouteIdx === idx;
                                return (
                                    <button
                                        key={route.id || idx}
                                        type="button"
                                        onClick={() => {
                                            setSelectedRouteIdx(idx);
                                            if (onSelectRoutePreview) onSelectRoutePreview(route);
                                        }}
                                        className={`w-full p-2.5 rounded-2xl border transition-all text-left flex items-center justify-between gap-2.5
                                            ${isSelected
                                                ? 'bg-indigo-600/20 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                                                : theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                                    >
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs shrink-0 font-bold ${
                                                route.routeType === 'fastest' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                                route.routeType === 'toll_free' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                                route.routeType === 'eco' ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' :
                                                route.routeType === 'scenic' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                            }`}>
                                                {route.routeType === 'fastest' ? '⚡' : route.routeType === 'toll_free' ? '🟢' : route.routeType === 'eco' ? '🌿' : route.routeType === 'scenic' ? '🌲' : '🛣️'}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className={`text-xs font-black truncate ${textColor}`}>
                                                        {route.routeLabel || 'Route'}
                                                    </span>
                                                    {route.savingsLabel && (
                                                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                                            route.routeType === 'fastest' ? 'bg-amber-500/15 text-amber-400' :
                                                            route.routeType === 'toll_free' ? 'bg-emerald-500/15 text-emerald-400' :
                                                            route.routeType === 'eco' ? 'bg-teal-500/15 text-teal-400' :
                                                            'bg-indigo-500/15 text-indigo-400'
                                                        }`}>
                                                            {route.savingsLabel}
                                                        </span>
                                                    )}
                                                    {route.hasTolls ? (
                                                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 shrink-0">
                                                            💳 {route.tollCostEstimate}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0">
                                                            🟢 No Tolls
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mt-0.5 truncate">
                                                    <span>{route.summary}</span>
                                                    {route.fuelCostEstimate && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-slate-300">⛽ {route.fuelCostEstimate}</span>
                                                        </>
                                                    )}
                                                    {route.hasTolls && route.totalEstimatedTripCost && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-indigo-400 font-bold">Total ~{route.totalEstimatedTripCost}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className={`text-xs font-black ${isSelected ? 'text-indigo-400' : textColor}`}>
                                                {route.totalTime}
                                            </p>
                                            <p className="text-[9px] text-slate-400">
                                                {route.totalDistance}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                {/* Geofence Radius Slider */}
                {onUpdateRadius && (
                    <div className={`mb-4 p-3 rounded-2xl border ${
                        theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center justify-between mb-1">
                            <span className={`text-[10px] font-black uppercase tracking-wider ${
                                theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'
                            }`}>
                                Geofence Zone
                            </span>
                            <span className={`text-xs font-bold ${textColor}`}>
                                {Math.round((place.radius || 0.3) * 1000)}m
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0.05"
                            max="2.0"
                            step="0.05"
                            value={place.radius || 0.3}
                            onChange={(e) => onUpdateRadius(place.id, parseFloat(e.target.value))}
                            className="w-full h-1 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                        />
                        <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                            <span>50m</span>
                            <span>1km</span>
                            <span>2km</span>
                        </div>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={() => onNavigate(routeOptions[selectedRouteIdx] || undefined)}
                        className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-base shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>🚀</span> {routeOptions[selectedRouteIdx] ? `Go (${routeOptions[selectedRouteIdx].totalTime})` : 'Go'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsConvoySetupOpen(true)}
                        className="px-3.5 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-2xl font-bold text-xs shadow-lg shadow-purple-600/30 transition-all active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
                        title="Plan Caravan / Convoy with Circle Members"
                    >
                        <span>🚗🚗</span>
                        <span>Convoy</span>
                    </button>
                    <button
                        className={`px-3 py-3.5 rounded-2xl font-bold border transition-all active:scale-95 ${theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                    >
                        Share
                    </button>
                </div>

                {/* Caravan Member Selection Modal */}
                {isConvoySetupOpen && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 pointer-events-auto">
                        <div className={`w-full max-w-sm rounded-3xl p-5 border shadow-2xl space-y-4 ${
                            theme === 'dark' ? 'bg-slate-900 border-purple-500/40 text-white' : 'bg-white border-purple-200 text-slate-900'
                        }`}>
                            <div className="flex items-center justify-between border-b pb-3 border-white/10">
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl animate-pulse">🚗🚗</span>
                                    <div>
                                        <h3 className="text-base font-black">Plan Caravan Trip</h3>
                                        <p className="text-xs text-purple-400">Select Circle Members</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsConvoySetupOpen(false)}
                                    className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Destination Summary */}
                            <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                                <BrandIcon placeName={place.name} defaultIcon={place.icon || '📍'} size="lg" />
                                <div className="min-w-0 flex-1">
                                    <h4 className="text-sm font-black truncate">{place.name}</h4>
                                    <p className="text-xs text-slate-400">
                                        {routeOptions[selectedRouteIdx]?.totalTime || 'Ready to drive'} • {routeOptions[selectedRouteIdx]?.totalDistance || ''}
                                    </p>
                                </div>
                            </div>

                            {/* Member Selection List */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">
                                        Who is in this caravan?
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const otherIds = (members || []).filter(m => m.id !== currentUserId).map(m => m.id);
                                            if (selectedMemberIds.length === otherIds.length) {
                                                setSelectedMemberIds([]);
                                            } else {
                                                setSelectedMemberIds(otherIds);
                                            }
                                        }}
                                        className="text-[10px] font-bold text-purple-400 hover:underline"
                                    >
                                        {selectedMemberIds.length === (members || []).filter(m => m.id !== currentUserId).length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>

                                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                    {(members || []).filter(m => m.id !== currentUserId).length === 0 ? (
                                        <div className="p-4 text-center text-xs text-slate-400 bg-white/5 rounded-xl">
                                            No other circle members found. You can still start Convoy mode and invite them mid-trip!
                                        </div>
                                    ) : (
                                        (members || []).filter(m => m.id !== currentUserId).map(member => {
                                            const isChecked = selectedMemberIds.includes(member.id);
                                            return (
                                                <div
                                                    key={member.id}
                                                    onClick={() => {
                                                        setSelectedMemberIds(prev => 
                                                            prev.includes(member.id) 
                                                                ? prev.filter(id => id !== member.id)
                                                                : [...prev, member.id]
                                                        );
                                                    }}
                                                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                                                        isChecked
                                                            ? 'bg-purple-500/20 border-purple-500/50 shadow-sm'
                                                            : 'bg-white/5 border-white/5 opacity-70 hover:opacity-100'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                        <img
                                                            src={member.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${member.id}`}
                                                            className="w-8 h-8 rounded-full object-cover border border-purple-400"
                                                        />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-bold truncate">{member.name}</p>
                                                            <p className="text-[10px] text-slate-400 truncate">
                                                                {member.status} • 🔋 {member.battery}%
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-xs ${
                                                        isChecked ? 'bg-purple-600 text-white' : 'border border-white/20'
                                                    }`}>
                                                        {isChecked ? '✓' : ''}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Action buttons */}
                            <div className="pt-2 border-t border-white/10 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsConvoySetupOpen(false)}
                                    className="flex-1 py-3 rounded-xl border border-white/10 text-xs font-bold hover:bg-white/5 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        convoyService.startConvoy(
                                            place.name || 'Destination',
                                            place.location,
                                            currentUserId || 'self',
                                            'You',
                                            selectedMemberIds
                                        );
                                        setIsConvoySetupOpen(false);
                                        onNavigate(routeOptions[selectedRouteIdx] || undefined);
                                    }}
                                    className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-black shadow-lg shadow-purple-600/30 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                                >
                                    <span>🚀</span> Launch Caravan ({selectedMemberIds.length})
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PlaceDetailPanel;
