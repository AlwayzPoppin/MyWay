import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Place, Location, FamilyMember } from '../types';
import { getDistanceMeters, getDistanceMiles } from '../utils/geo';

interface QuickStopGridProps {
    onSearch: (query: string) => void;
    onClose: () => void;
    theme: 'light' | 'dark';
    userPlaces?: Place[];
    onSelectPlace?: (place: Place) => void;
    onNavigatePlace?: (place: Place) => void;
    onAddPlace?: (place: Omit<Place, 'id'>) => void;
    userLocation?: Location | null;
    members?: FamilyMember[];
}

const QuickStopGrid: React.FC<QuickStopGridProps> = ({
    onSearch,
    onClose,
    theme,
    userPlaces = [],
    onSelectPlace,
    onNavigatePlace,
    onAddPlace,
    userLocation,
    members = []
}) => {
    const [activeTab, setActiveTab] = useState<'saved' | 'quick'>('saved');
    const [showAddForm, setShowAddForm] = useState(false);
    const [placeName, setPlaceName] = useState('');
    const [selectedIcon, setSelectedIcon] = useState('📍');
    const [selectedRadius, setSelectedRadius] = useState(0.15); // in km

    const iconPresets = [
        { icon: '📍', label: 'Pin' },
        { icon: '🏠', label: 'Home' },
        { icon: '💼', label: 'Work' },
        { icon: '🏋️', label: 'Gym' },
        { icon: '☕', label: 'Cafe' },
        { icon: '🍔', label: 'Food' },
        { icon: '🎓', label: 'School' },
        { icon: '⛽', label: 'Gas' },
        { icon: '⭐', label: 'Fav' },
    ];

    const radiusPresets = [
        { label: '150m (Tight)', value: 0.15 },
        { label: '300m (Block)', value: 0.3 },
        { label: '500m (Area)', value: 0.5 },
        { label: '800m (Wide)', value: 0.8 },
    ];

    const categories = [
        { id: 'gas', icon: '⛽', label: 'Gas', query: 'Gas Station', color: '#f97316' },
        { id: 'coffee', icon: '☕', label: 'Coffee', query: 'Coffee Shop', color: '#22c55e' },
        { id: 'food', icon: '🍔', label: 'Food', query: 'Restaurant', color: '#ef4444' },
        { id: 'grocery', icon: '🛒', label: 'Grocery', query: 'Grocery Store', color: '#3b82f6' },
        { id: 'parking', icon: '🅿️', label: 'Parking', query: 'Parking', color: '#8b5cf6' },
        { id: 'pharmacy', icon: '💊', label: 'Pharmacy', query: 'Pharmacy', color: '#ec4899' },
        { id: 'atm', icon: '🏧', label: 'ATM', query: 'ATM', color: '#14b8a6' },
        { id: 'hospital', icon: '🏥', label: 'Hospital', query: 'Hospital', color: '#dc2626' },
    ];

    const handleSelectCategory = (query: string) => {
        onSearch(query);
        onClose();
    };

    const handleSaveCurrentLocation = () => {
        if (!userLocation) return;
        const nameToSave = placeName.trim() || `${selectedIcon} Current Spot`;
        if (onAddPlace) {
            onAddPlace({
                name: nameToSave,
                icon: selectedIcon,
                location: userLocation,
                radius: selectedRadius,
                type: 'custom',
                description: `Saved at GPS (${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})`
            });
        }
        setPlaceName('');
        setShowAddForm(false);
    };

    const formatDistance = (placeLoc: Location) => {
        if (!userLocation) return null;
        const miles = getDistanceMiles(userLocation, placeLoc);
        if (miles < 0.1) return `${Math.round(miles * 5280)} ft away`;
        if (miles < 10) return `${miles.toFixed(1)} mi away`;
        return `${Math.round(miles)} mi away`;
    };

    const modalContent = (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Container */}
            <div className={`relative w-full max-w-md rounded-3xl p-5 shadow-[0_20px_70px_rgba(0,0,0,0.5)] overflow-hidden max-h-[85vh] flex flex-col z-10 animate-in zoom-in-95 duration-200
                ${theme === 'dark'
                    ? 'bg-gradient-to-br from-slate-900 via-[#0f172a] to-slate-900 border border-white/15'
                    : 'bg-white border border-slate-200'}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">⭐</span>
                        <h3 className={`text-base font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            Saved Places & Quick Stops
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors
                            ${theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                    >
                        ✕
                    </button>
                </div>

                {/* Segmented Control Tabs */}
                <div className={`flex p-1 rounded-xl border gap-1 mb-3 shrink-0
                    ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}
                >
                    <button
                        onClick={() => setActiveTab('saved')}
                        className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                            activeTab === 'saved'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        ⭐ Saved Places ({userPlaces.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('quick')}
                        className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                            activeTab === 'quick'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        ⚡ Quick Stops
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
                    {activeTab === 'saved' ? (
                        /* ──────────────────────────────────────────
                           SAVED PLACES TAB
                           ────────────────────────────────────────── */
                        <>
                            {/* Pin Current Location Banner / Quick Creator */}
                            {userLocation && onAddPlace && (
                                <div className={`rounded-2xl border p-3 transition-all ${
                                    showAddForm 
                                        ? (theme === 'dark' ? 'bg-indigo-950/40 border-indigo-500/40 shadow-lg' : 'bg-indigo-50/70 border-indigo-200 shadow-md')
                                        : (theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100')
                                }`}>
                                    {!showAddForm ? (
                                        <button
                                            onClick={() => setShowAddForm(true)}
                                            className="w-full flex items-center justify-between gap-2 text-left"
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-base shadow-md shrink-0">
                                                    📍
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className={`text-xs font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                        Add Current Location
                                                    </h4>
                                                    <p className="text-[10px] text-slate-400 truncate">
                                                        Bookmark live GPS as a family geofence
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold shrink-0 shadow-sm">
                                                + Pin
                                            </span>
                                        </button>
                                    ) : (
                                        <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                                    <span className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                        Save Live Location
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => setShowAddForm(false)}
                                                    className="text-xs text-slate-400 hover:text-slate-200 font-bold px-1"
                                                >
                                                    Cancel
                                                </button>
                                            </div>

                                            {/* Name Input */}
                                            <input
                                                type="text"
                                                value={placeName}
                                                onChange={(e) => setPlaceName(e.target.value)}
                                                placeholder="Name (e.g. Home, Work, Gym)"
                                                autoFocus
                                                className={`w-full px-3 py-2 rounded-xl text-xs font-bold outline-none border transition-all ${
                                                    theme === 'dark'
                                                        ? 'bg-slate-900/90 border-white/15 text-white placeholder-slate-500 focus:border-indigo-400'
                                                        : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-indigo-500'
                                                }`}
                                            />

                                            {/* Icon Presets */}
                                            <div className="space-y-1">
                                                <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">
                                                    Choose Icon
                                                </span>
                                                <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                                                    {iconPresets.map(preset => (
                                                        <button
                                                            key={preset.label}
                                                            onClick={() => setSelectedIcon(preset.icon)}
                                                            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1 shrink-0 transition-all ${
                                                                selectedIcon === preset.icon
                                                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-md scale-105'
                                                                    : theme === 'dark'
                                                                        ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                                                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                                                            }`}
                                                        >
                                                            <span>{preset.icon}</span>
                                                            <span className="text-[10px]">{preset.label}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Geofence Zone Presets */}
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
                                                    <span>Geofence Zone</span>
                                                    <span className="text-indigo-400">{Math.round(selectedRadius * 1000)}m</span>
                                                </div>
                                                <div className="grid grid-cols-4 gap-1.5">
                                                    {radiusPresets.map(preset => (
                                                        <button
                                                            key={preset.label}
                                                            onClick={() => setSelectedRadius(preset.value)}
                                                            className={`py-1 rounded-lg border text-[10px] font-bold transition-all ${
                                                                selectedRadius === preset.value
                                                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                                                                    : theme === 'dark'
                                                                        ? 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                                                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                                                            }`}
                                                        >
                                                            {Math.round(preset.value * 1000)}m
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Save Button */}
                                            <button
                                                onClick={handleSaveCurrentLocation}
                                                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/30 active:scale-95 transition-all"
                                            >
                                                <span>⭐</span> Save to Circle Geofences
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Places List */}
                            {userPlaces.length === 0 ? (
                                <div className={`py-6 px-4 rounded-2xl border text-center space-y-2
                                    ${theme === 'dark' ? 'bg-white/5 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}
                                >
                                    <span className="text-3xl block">📍</span>
                                    <p className="text-xs font-bold">No Saved Places Yet</p>
                                    <p className="text-[11px] leading-relaxed">
                                        Use the "+ Pin" button above or search for any location and tap ⭐ to save it as a family geofence.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid gap-2.5">
                                    {userPlaces.map((place) => {
                                        const distanceStr = formatDistance(place.location);
                                        const radiusMeters = Math.round((place.radius || 0.15) * 1000);
                                        const membersInside = members.filter(m => {
                                            const dist = getDistanceMeters(m.location, place.location);
                                            return dist <= (place.radius || 0.15) * 1000;
                                        });

                                        return (
                                            <div
                                                key={place.id}
                                                onClick={() => {
                                                    if (onSelectPlace) onSelectPlace(place);
                                                    onClose();
                                                }}
                                                className={`p-3 rounded-2xl border flex flex-col gap-2 transition-all cursor-pointer hover:scale-[1.01] active:scale-95
                                                    ${theme === 'dark'
                                                        ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                                        : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border ${
                                                        theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'
                                                    }`}>
                                                        {place.icon || '📍'}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-1">
                                                            <h4 className={`font-black text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                                {place.name}
                                                            </h4>
                                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 shrink-0">
                                                                {radiusMeters}m
                                                            </span>
                                                        </div>

                                                        {place.description && (
                                                            <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                                                {place.description}
                                                            </p>
                                                        )}

                                                        {distanceStr && (
                                                            <p className="text-[10px] font-bold text-indigo-400 mt-0.5">
                                                                {distanceStr}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Member Presence */}
                                                {membersInside.length > 0 && (
                                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/20">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                                        <span className="text-[10px] font-bold text-emerald-400 truncate">
                                                            {membersInside.map(m => m.name).join(', ')} is here
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Quick Actions */}
                                                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (onSelectPlace) onSelectPlace(place);
                                                            onClose();
                                                        }}
                                                        className={`flex-1 py-1.5 px-2 rounded-xl border text-[11px] font-bold transition-all text-center ${
                                                            theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-white border-slate-200 text-slate-800'
                                                        }`}
                                                    >
                                                        🗺️ View on Map
                                                    </button>
                                                    {onNavigatePlace && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onNavigatePlace(place);
                                                                onClose();
                                                            }}
                                                            className="flex-1 py-1.5 px-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow-md transition-all active:scale-95"
                                                        >
                                                            <span>🚀</span> Navigate
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    ) : (
                        /* ──────────────────────────────────────────
                           QUICK STOPS TAB
                           ────────────────────────────────────────── */
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3 py-2">
                            {categories.map((cat, index) => (
                                <button
                                    key={cat.id}
                                    onClick={() => handleSelectCategory(cat.query)}
                                    className={`group flex flex-col items-center gap-2 p-2.5 sm:p-3 rounded-2xl transition-all duration-200
                                        hover:scale-105 active:scale-95
                                        ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border border-white/5' : 'bg-slate-50 hover:bg-slate-100 border border-slate-100'}`}
                                    style={{ animationDelay: `${index * 30}ms` }}
                                >
                                    <div
                                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110"
                                        style={{
                                            backgroundColor: `${cat.color}20`,
                                            boxShadow: `0 4px 12px ${cat.color}30`
                                        }}
                                    >
                                        {cat.icon}
                                    </div>
                                    <span className={`text-[10px] font-semibold uppercase tracking-wide
                                        ${theme === 'dark' ? 'text-slate-400 group-hover:text-white' : 'text-slate-500 group-hover:text-slate-900'}`}>
                                        {cat.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default QuickStopGrid;
