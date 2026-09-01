import React, { useState, useEffect } from 'react';
import { Place } from '../types';

interface EditPlaceModalProps {
    place: Place | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (placeId: string, updates: Partial<Place>) => void;
    onDelete?: (placeId: string) => void;
    theme?: 'light' | 'dark';
}

const PLACE_CATEGORIES = [
    { type: 'home', icon: '🏠', label: 'Home' },
    { type: 'work', icon: '💼', label: 'Work' },
    { type: 'school', icon: '🏫', label: 'School' },
    { type: 'gym', icon: '🏋️', label: 'Gym' },
    { type: 'food', icon: '🍔', label: 'Food' },
    { type: 'coffee', icon: '☕', label: 'Coffee' },
    { type: 'gas', icon: '⛽', label: 'Gas' },
    { type: 'other', icon: '📍', label: 'Other' },
];

const EditPlaceModal: React.FC<EditPlaceModalProps> = ({
    place,
    isOpen,
    onClose,
    onSave,
    onDelete,
    theme = 'dark'
}) => {
    const [name, setName] = useState('');
    const [icon, setIcon] = useState('📍');
    const [type, setType] = useState<string>('other');
    const [radius, setRadius] = useState<number>(0.3);

    useEffect(() => {
        if (place) {
            setName(place.name || '');
            setIcon(place.icon || '📍');
            setType(place.type || 'other');
            setRadius(place.radius || 0.3);
        }
    }, [place]);

    if (!isOpen || !place) return null;

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const bgColor = isDark ? 'bg-slate-900/98 border-white/10 text-white' : 'bg-white/98 border-slate-200 text-slate-900';

    const handleSave = () => {
        if (!name.trim()) return;
        onSave(place.id, {
            name: name.trim(),
            icon,
            type: type as any,
            radius
        });
        onClose();
    };

    const handleDelete = () => {
        if (window.confirm(`Delete "${place.name}" from your circle places?`)) {
            onDelete?.(place.id);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto">
            <div className={`relative w-full max-w-sm rounded-[2rem] border p-6 shadow-2xl overflow-hidden transition-all ${bgColor}`}>
                {/* Ambient Glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-white/10 relative z-10">
                    <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{icon}</span>
                        <div>
                            <h3 className={`text-base font-black uppercase tracking-wider ${textColor}`}>
                                Edit Place & Geofence
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                Circle Safe Zone
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                    >
                        ✕
                    </button>
                </div>

                {/* Form Fields */}
                <div className="py-4 space-y-4 relative z-10">
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
                                return (
                                    <button
                                        key={cat.type}
                                        type="button"
                                        onClick={() => {
                                            setType(cat.type);
                                            setIcon(cat.icon);
                                        }}
                                        className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                            isSelected
                                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                                                : isDark
                                                    ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                        }`}
                                    >
                                        <span className="text-lg leading-none">{cat.icon}</span>
                                        <span className="text-[9px] font-bold truncate">{cat.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

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
                                <p className="text-[9px] text-slate-400">Arrival & departure alert radius</p>
                            </div>
                            <span className={`text-xs font-black ${textColor}`}>
                                {Math.round(radius * 1000)}m
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0.05"
                            max="2.0"
                            step="0.05"
                            value={radius}
                            onChange={(e) => setRadius(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                        />
                        <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                            <span>50m</span>
                            <span>1km</span>
                            <span>2km</span>
                        </div>
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-white/10 relative z-10">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!name.trim()}
                        className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                        <span>💾</span>
                        <span>Save Changes</span>
                    </button>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="p-3 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold text-sm transition-all active:scale-95 cursor-pointer"
                            title="Delete Place"
                        >
                            🗑️
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EditPlaceModal;
