import React, { useState } from 'react';
import { ParkedVehiclePlace, Location } from '../types';
import { formatDistanceFromUser } from '../utils/geo';
import { parkingService } from '../services/parkingService';
import {
    Car,
    Navigation,
    Share2,
    X,
    Clock,
    MapPin,
    ShieldCheck,
    Trash2,
    CheckCircle2,
    Radio,
    Copy,
    Check
} from 'lucide-react';

export interface ParkedVehicleCardProps {
    place: ParkedVehiclePlace;
    onClose: () => void;
    onNavigate: () => void;
    theme: 'light' | 'dark';
    userLocation?: Location | null;
    isMobile?: boolean;
}

function formatRelativeTime(timestamp?: number): string {
    if (!timestamp) return 'recently';
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

export const ParkedVehicleCard: React.FC<ParkedVehicleCardProps> = ({
    place,
    onClose,
    onNavigate,
    theme,
    userLocation,
    isMobile = false
}) => {
    const [copied, setCopied] = useState(false);

    const isDark = theme === 'dark';
    const bgClass = isDark
        ? 'bg-[#0f172a]/95 text-white border-white/10'
        : 'bg-white/95 text-slate-900 border-slate-200/80 shadow-2xl';

    const subTextClass = isDark ? 'text-slate-400' : 'text-slate-600';
    const cardBgClass = isDark ? 'bg-slate-800/60 border-white/5' : 'bg-slate-50 border-slate-200/60';

    const distanceText = userLocation
        ? formatDistanceFromUser(userLocation, place.location)
        : null;

    const timeAgoText = formatRelativeTime(place.parkedAt);

    const handleClear = () => {
        parkingService.clearParkedVehicle();
        onClose();
    };

    const handleShare = async () => {
        const text = `My car is parked near ${place.nearestAddress || 'this location'}: https://maps.google.com/?q=${place.location.lat},${place.location.lng}`;
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Parked Vehicle Location',
                    text,
                    url: `https://maps.google.com/?q=${place.location.lat},${place.location.lng}`
                });
                return;
            } catch (e) {}
        }
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch (e) {}
    };

    return (
        <div
            className={`w-full max-w-full landscape:top-16 landscape:bottom-4 landscape:max-h-[calc(100dvh-5.5rem)] landscape:sm:max-h-[calc(100dvh-5.5rem)] landscape:my-auto flex flex-col backdrop-blur-2xl ${
                isMobile
                    ? 'rounded-t-[2.25rem] landscape:rounded-[2rem] border-t landscape:border shadow-[0_-10px_50px_rgba(0,0,0,0.4)]'
                    : 'rounded-[2rem] border shadow-[0_25px_60px_rgba(0,0,0,0.4)]'
            } overflow-hidden animate-in fade-in slide-in-from-bottom duration-300 opacity-100 pointer-events-auto ${bgClass}`}
        >
            {/* Mobile Drag Pill */}
            {isMobile && (
                <div
                    className="pt-2.5 pb-1 landscape:pt-1.5 landscape:pb-0.5 cursor-grab active:cursor-grabbing flex justify-center shrink-0"
                    onClick={onClose}
                >
                    <div className={`w-12 h-1.5 landscape:w-8 landscape:h-1 rounded-full mx-auto ${isDark ? 'bg-white/20' : 'bg-slate-300'}`} />
                </div>
            )}

            <div className="p-4 sm:p-5 flex-1 overflow-y-auto overscroll-contain no-scrollbar flex flex-col gap-3.5">
                {/* Header: Title & Close */}
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/10">
                            <Car className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg sm:text-xl font-black leading-tight truncate">Parked Vehicle</h3>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                                    Active
                                </span>
                            </div>
                            <p className={`text-xs sm:text-sm font-medium truncate ${subTextClass}`}>
                                {place.nearestAddress ? `Near ${place.nearestAddress}` : 'Location saved away from Home'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Telemetry Stats Grid */}
                <div className="grid grid-cols-3 gap-2">
                    <div className={`p-2.5 rounded-2xl border flex flex-col items-center text-center ${cardBgClass}`}>
                        <Clock className="w-4 h-4 text-cyan-400 mb-1" />
                        <span className={`text-[10px] font-medium ${subTextClass}`}>Parked</span>
                        <span className="text-xs font-bold truncate">{timeAgoText}</span>
                    </div>

                    <div className={`p-2.5 rounded-2xl border flex flex-col items-center text-center ${cardBgClass}`}>
                        <MapPin className="w-4 h-4 text-emerald-400 mb-1" />
                        <span className={`text-[10px] font-medium ${subTextClass}`}>Distance</span>
                        <span className="text-xs font-bold truncate">{distanceText || 'Nearby'}</span>
                    </div>

                    <div className={`p-2.5 rounded-2xl border flex flex-col items-center text-center ${cardBgClass}`}>
                        <Radio className="w-4 h-4 text-purple-400 mb-1" />
                        <span className={`text-[10px] font-medium ${subTextClass}`}>Geofence</span>
                        <span className="text-xs font-bold truncate">~82 ft (25m)</span>
                    </div>
                </div>

                {/* Circle Broadcast Status */}
                <div className={`p-3 rounded-2xl border flex items-start gap-2.5 ${cardBgClass}`}>
                    <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                        {place.hasWalkedAway ? (
                            <CheckCircle2 className="w-4 h-4" />
                        ) : (
                            <ShieldCheck className="w-4 h-4" />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold flex items-center gap-1.5">
                            {place.hasReturned ? (
                                <span className="text-emerald-400">Returned to Vehicle</span>
                            ) : place.hasWalkedAway ? (
                                <span className="text-emerald-400">Circle Notified of Parking</span>
                            ) : (
                                <span>Parking Geofence Armed</span>
                            )}
                        </div>
                        <p className={`text-[11px] leading-relaxed mt-0.5 ${subTextClass}`}>
                            {place.hasReturned
                                ? 'Circle was notified that you returned to your vehicle.'
                                : place.hasWalkedAway
                                ? `Alerted circle when you stepped away from the ~82 ft perimeter.`
                                : 'Will notify your circle and send a reminder when you walk away (> 82 ft).'}
                        </p>
                    </div>
                </div>

                {/* Primary & Secondary Action Buttons */}
                <div className="flex flex-col gap-2 pt-1">
                    <button
                        onClick={onNavigate}
                        className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 transition-all transform active:scale-[0.98] bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500"
                    >
                        <Navigation className="w-4 h-4 fill-white" />
                        <span>Walk to Vehicle</span>
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={handleShare}
                            className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                                isDark
                                    ? 'bg-slate-800/80 hover:bg-slate-700/80 border-white/10 text-slate-200'
                                    : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                            }`}
                        >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                            <span>{copied ? 'Copied!' : 'Share'}</span>
                        </button>

                        <button
                            onClick={handleClear}
                            className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                                isDark
                                    ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20 text-red-400'
                                    : 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600'
                            }`}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove Pin</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ParkedVehicleCard;
