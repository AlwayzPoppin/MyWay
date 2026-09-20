import React, { useEffect, useState } from 'react';
import { Check, MapPin, Star, X } from 'lucide-react';
import { ArrivalTripData } from '../types';
import { contributionService } from '../services/contributionService';

interface TripReviewCardProps {
    arrivalData: ArrivalTripData | null;
    isOpen: boolean;
    theme: 'light' | 'dark';
    userId?: string;
    userName?: string;
    userAvatar?: string;
    onClose: () => void;
    onReportPin: (place: ArrivalTripData['destinationPlace']) => void;
}

const REVIEW_TAGS = ['Smooth route', 'Accurate ETA', 'Heavy traffic', 'Road hazard'];

const TripReviewCard: React.FC<TripReviewCardProps> = ({
    arrivalData,
    isOpen,
    theme,
    userId,
    userName,
    userAvatar,
    onClose,
    onReportPin
}) => {
    const [rating, setRating] = useState(0);
    const [tags, setTags] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setRating(0);
        setTags([]);
        setIsSaving(false);
    }, [isOpen, arrivalData?.arrivedAt]);

    if (!isOpen || !arrivalData) return null;
    const isDark = theme === 'dark';
    const destinationAddress = arrivalData.destinationPlace?.address
        || arrivalData.destinationPlace?.description
        || arrivalData.destinationName;

    const toggleTag = (tag: string) => {
        setTags(current => current.includes(tag)
            ? current.filter(item => item !== tag)
            : [...current, tag]);
    };

    const submitReview = async () => {
        if (rating === 0 || isSaving) return;
        setIsSaving(true);
        try {
            await contributionService.recordTripContribution({
                tripId: `trip_${arrivalData.arrivedAt || Date.now()}`,
                destinationAddress,
                destinationName: arrivalData.destinationName,
                placeId: arrivalData.destinationPlace?.id,
                rating,
                tags,
                placeType: null,
                isAccurate: true,
                type: 'trip_review',
                timestamp: Date.now(),
                userId,
                userName,
                userAvatar
            });
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[250] flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center sm:p-4">
            <section className={`w-full max-w-md rounded-[2rem] border p-5 shadow-2xl ${isDark ? 'border-white/10 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900'}`} aria-label="Trip review">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-500">Trip complete</p>
                        <h2 className="mt-1 text-lg font-black">How was that arrival?</h2>
                        <p className={`mt-1 truncate text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{arrivalData.destinationName}</p>
                    </div>
                    <button type="button" onClick={onClose} className={`rounded-full p-2 ${isDark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`} aria-label="Skip trip review">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="mb-4 flex justify-center gap-2" aria-label="Rate this trip">
                    {[1, 2, 3, 4, 5].map(value => (
                        <button key={value} type="button" onClick={() => setRating(value)} className="p-1" aria-label={`${value} stars`}>
                            <Star className={`h-8 w-8 transition-transform active:scale-90 ${value <= rating ? 'fill-amber-400 text-amber-400' : isDark ? 'text-slate-700' : 'text-slate-200'}`} />
                        </button>
                    ))}
                </div>

                <div className="mb-5 flex flex-wrap justify-center gap-2">
                    {REVIEW_TAGS.map(tag => (
                        <button key={tag} type="button" onClick={() => toggleTag(tag)} className={`rounded-full border px-3 py-2 text-xs font-bold transition-colors ${tags.includes(tag) ? 'border-emerald-400 bg-emerald-500/15 text-emerald-500' : isDark ? 'border-white/10 text-slate-300 hover:bg-white/5' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            {tag}
                        </button>
                    ))}
                </div>

                <button type="button" onClick={submitReview} disabled={!rating || isSaving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-black text-white shadow-lg shadow-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45">
                    <Check className="h-4 w-4" />
                    {isSaving ? 'Saving review…' : 'Save trip review'}
                </button>
                <button type="button" onClick={() => onReportPin(arrivalData.destinationPlace)} className={`mt-3 flex w-full items-center justify-center gap-2 text-xs font-bold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <MapPin className="h-4 w-4" /> Pin or entrance needs fixing?
                </button>
            </section>
        </div>
    );
};

export default TripReviewCard;
