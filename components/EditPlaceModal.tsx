import React, { useState, useEffect, useRef } from 'react';
import { Place } from '../types';
import { compressImageFile, placeCorrectionService } from '../services/placeCorrectionService';

interface EditPlaceModalProps {
    place: Place | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (placeId: string, updates: Partial<Place>) => void;
    onDelete?: (placeId: string) => void;
    onCorrectLocation?: (place: Place) => void;
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
    onCorrectLocation,
    theme = 'dark'
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState('');
    const [icon, setIcon] = useState('📍');
    const [type, setType] = useState<string>('other');
    const [radius, setRadius] = useState<number>(0.3);
    const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

    useEffect(() => {
        if (place) {
            setName(place.name || '');
            setIcon(place.icon || '📍');
            setType(place.type || 'other');
            setRadius(place.radius ? (place.radius > 5 ? place.radius / 1000 : place.radius) : 0.05);
            setImageUrl(place.imageUrl || undefined);
        }
    }, [place]);

    if (!isOpen || !place) return null;

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const bgColor = isDark ? 'bg-slate-900/98 border-white/10 text-white' : 'bg-white/98 border-slate-200 text-slate-900';

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingPhoto(true);
        try {
            const compressed = await compressImageFile(file);
            setImageUrl(compressed);
        } catch (err) {
            console.error('Failed to process photo:', err);
        } finally {
            setIsUploadingPhoto(false);
            e.target.value = '';
        }
    };

    const handleSave = async () => {
        if (!name.trim()) return;

        let finalPhotoUrl = imageUrl;
        if (imageUrl && imageUrl.startsWith('data:')) {
            try {
                finalPhotoUrl = await placeCorrectionService.uploadPlacePhoto(place.id, imageUrl);
            } catch (err) {
                console.warn('Failed to upload photo to storage, keeping local:', err);
            }
        }

        onSave(place.id, {
            name: name.trim(),
            icon,
            type: type as any,
            radius,
            imageUrl: finalPhotoUrl
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
                                {Math.round((radius && radius > 5 ? radius : (radius || 0.05) * 1000))}m
                            </span>
                        </div>

                        {/* Quick-Preset Radius Chips */}
                        <div className="flex flex-row overflow-x-auto gap-2 mb-3 pb-0.5 scrollbar-none">
                            {[
                                { label: 'Driveway', value: 0.015, meters: '15m' },
                                { label: 'Street', value: 0.05, meters: '50m' },
                                { label: 'Neighborhood', value: 0.15, meters: '150m' },
                                { label: 'City Area', value: 1.0, meters: '1km' }
                            ].map((preset) => {
                                const currentKm = radius && radius > 5 ? radius / 1000 : (radius || 0.05);
                                const isActive = Math.round(currentKm * 1000) === Math.round(preset.value * 1000);
                                return (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => setRadius(preset.value)}
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
                            onChange={(e) => setRadius(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                        />
                        <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                            <span>15m (Driveway)</span>
                            <span>1km</span>
                            <span>2km</span>
                        </div>
                    </div>

                    {/* Precision Adjust Pin Location on Map Button */}
                    {onCorrectLocation && (
                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                onCorrectLocation(place);
                            }}
                            className={`w-full py-2.5 px-3.5 rounded-2xl border flex items-center justify-between transition-all cursor-pointer ${
                                isDark ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700'
                            }`}
                        >
                            <div className="flex items-center gap-2.5">
                                <span className="text-lg">🎯</span>
                                <div className="text-left">
                                    <span className="text-xs font-black block">Adjust Pin Location</span>
                                    <span className="text-[10px] opacity-80 block">Fix entrance, driveway, or parking coordinate</span>
                                </div>
                            </div>
                            <span className="text-sm font-bold">→</span>
                        </button>
                    )}

                    {/* Storefront / Entrance Photo */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                            Storefront & Entrance Photo
                        </label>
                        {imageUrl ? (
                            <div className="relative rounded-2xl overflow-hidden border border-white/10 group">
                                <img src={imageUrl} alt="Place photo" className="w-full h-28 object-cover" />
                                <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="px-2.5 py-1 rounded-lg bg-black/70 text-white text-[10px] font-bold backdrop-blur-md hover:bg-black/90 cursor-pointer"
                                    >
                                        Change
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setImageUrl(undefined)}
                                        className="w-6 h-6 rounded-lg bg-red-500/80 text-white text-xs font-bold flex items-center justify-center hover:bg-red-500 cursor-pointer"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingPhoto}
                                className={`w-full py-3 border border-dashed rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    isDark ? 'border-white/20 hover:border-indigo-400 bg-white/5' : 'border-slate-300 hover:border-indigo-500 bg-slate-50'
                                }`}
                            >
                                <span>{isUploadingPhoto ? '⏳' : '📷'}</span>
                                <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                    {isUploadingPhoto ? 'Compressing...' : 'Take or Upload Place Photo'}
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
