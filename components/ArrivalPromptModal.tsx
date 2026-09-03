import React, { useState } from 'react';
import { ArrivalTripData, Place } from '../types';

interface ArrivalPromptModalProps {
    arrivalData: ArrivalTripData | null;
    isOpen: boolean;
    onClose: () => void;
    onFixLocation: (place: Place) => void;
    theme?: 'light' | 'dark';
}

const FEEDBACK_TAGS = [
    { id: 'smooth', label: 'Smooth route', icon: '🛣️' },
    { id: 'accurate_eta', label: 'Accurate ETA', icon: '⏱️' },
    { id: 'wrong_entrance', label: 'Wrong entrance / pin', icon: '📍', isPinIssue: true },
    { id: 'traffic', label: 'Heavy traffic', icon: '🚗' },
    { id: 'hazard', label: 'Road hazard on way', icon: '⚠️' },
];

const ArrivalPromptModal: React.FC<ArrivalPromptModalProps> = ({
    arrivalData,
    isOpen,
    onClose,
    onFixLocation,
    theme = 'dark'
}) => {
    const [rating, setRating] = useState<number>(0);
    const [hoverRating, setHoverRating] = useState<number>(0);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [hasSubmitted, setHasSubmitted] = useState(false);

    if (!isOpen || !arrivalData) return null;

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';
    const panelBg = isDark ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';

    const handleTagToggle = (tagId: string) => {
        setSelectedTags(prev => 
            prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
        );
    };

    const hasPinIssue = selectedTags.includes('wrong_entrance') || (rating > 0 && rating <= 3);

    const handleDone = () => {
        setHasSubmitted(true);
        // Save rating to localStorage or analytics if desired
        try {
            const ratings = JSON.parse(localStorage.getItem('myway_drive_ratings') || '[]');
            ratings.push({
                destination: arrivalData.destinationName,
                rating,
                tags: selectedTags,
                timestamp: Date.now()
            });
            localStorage.setItem('myway_drive_ratings', JSON.stringify(ratings.slice(-50)));
        } catch (e) {
            console.warn('Failed to cache drive rating:', e);
        }
        onClose();
    };

    const handleAdjustPin = () => {
        onClose();
        onFixLocation(arrivalData.destinationPlace);
    };

    return (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300 pointer-events-auto">
            <div className={`relative w-full max-w-md rounded-[2.5rem] border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-all ${panelBg}`}>
                
                {/* Ambient Glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

                {/* Header with Checkered Flag celebration */}
                <div className="p-6 pb-4 text-center relative z-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-3xl shadow-xl shadow-emerald-500/30 mb-3 animate-bounce">
                        🏁
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400 block mb-1">
                        Trip Completed
                    </span>
                    <h2 className={`text-xl sm:text-2xl font-black tracking-tight leading-tight ${textColor}`}>
                        Arrived at {arrivalData.destinationName}
                    </h2>
                    {arrivalData.destinationPlace?.description && (
                        <p className={`text-xs mt-1 truncate max-w-xs mx-auto ${subTextColor}`}>
                            {arrivalData.destinationPlace.description}
                        </p>
                    )}
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4 no-scrollbar relative z-10">

                    {/* Trip Metrics Row */}
                    <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/10 text-center">
                        <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Distance</span>
                            <span className={`text-sm font-black ${textColor}`}>
                                {arrivalData.totalDistance || 'Arrived'}
                            </span>
                        </div>
                        <div className="border-x border-white/10">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Drive Time</span>
                            <span className={`text-sm font-black ${textColor}`}>
                                {arrivalData.totalTime || 'Completed'}
                            </span>
                        </div>
                        <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Safety Score</span>
                            <span className="text-sm font-black text-emerald-400">
                                {arrivalData.safetyScore !== undefined ? `${arrivalData.safetyScore}%` : '100%'}
                            </span>
                        </div>
                    </div>

                    {/* Optional: Rate Your Drive (1-5 Stars) */}
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center space-y-2">
                        <span className={`text-xs font-black uppercase tracking-wider block ${textColor}`}>
                            Rate this drive (Optional)
                        </span>

                        {/* Interactive Stars */}
                        <div className="flex items-center justify-center gap-2 py-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(star)}
                                    onMouseEnter={() => setHoverRating(star)}
                                    onMouseLeave={() => setHoverRating(0)}
                                    className="text-2xl sm:text-3xl transition-transform hover:scale-125 active:scale-95 focus:outline-none cursor-pointer"
                                    title={`${star} Star${star > 1 ? 's' : ''}`}
                                >
                                    {(hoverRating || rating) >= star ? '⭐' : '☆'}
                                </button>
                            ))}
                        </div>

                        {/* Quick Feedback Tags */}
                        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                            {FEEDBACK_TAGS.map((tag) => {
                                const isSelected = selectedTags.includes(tag.id);
                                return (
                                    <button
                                        key={tag.id}
                                        type="button"
                                        onClick={() => handleTagToggle(tag.id)}
                                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all flex items-center gap-1 border cursor-pointer ${
                                            isSelected
                                                ? tag.isPinIssue
                                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-md ring-1 ring-amber-400/40'
                                                    : 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                                                : isDark
                                                    ? 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                        }`}
                                    >
                                        <span>{tag.icon}</span>
                                        <span>{tag.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Waze-Style Location & Storefront Photo Section */}
                    <div className={`p-4 rounded-3xl border transition-all ${
                        hasPinIssue
                            ? 'bg-amber-500/15 border-amber-500/40 ring-1 ring-amber-500/30'
                            : isDark ? 'bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-transparent border-white/10' : 'bg-gradient-to-br from-indigo-50 via-purple-50 to-white border-indigo-100'
                    }`}>
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl text-white shadow-md shrink-0 mt-0.5">
                                🎯
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className={`text-xs font-black uppercase tracking-wider ${textColor}`}>
                                    Fix Pin Location or Add Photo
                                </h3>
                                <p className="text-[11px] text-slate-400 font-semibold leading-relaxed mt-0.5">
                                    Since you are here at the destination, you can align the pin directly with the true entrance/driveway and take a storefront photo.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleAdjustPin}
                            className="w-full mt-3 py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <span>📍 Adjust Pin & Take Photo (Waze Style)</span>
                            <span>📸</span>
                        </button>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-5 pt-3 border-t border-white/10 flex items-center gap-3 relative z-10">
                    <button
                        type="button"
                        onClick={handleDone}
                        className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-black text-sm transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        <span>✓ Done</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ArrivalPromptModal;
