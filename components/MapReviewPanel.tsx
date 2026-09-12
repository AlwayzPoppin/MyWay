import React, { useEffect, useState, useMemo } from 'react';
import {
    Check,
    Loader2,
    MapPin,
    ShieldCheck,
    X,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Camera,
    Compass,
    Copy,
    RefreshCw,
    AlertTriangle,
    Navigation2,
    Eye
} from 'lucide-react';
import {
    PendingAccessPointReview,
    listPendingAccessPointReviews,
    moderateAccessPoint
} from '../services/mapReviewService';
import { ACCESS_POINT_TYPE_CONFIG } from './PlaceDetailPanel';
import { AccessPointType } from '../types';

interface MapReviewPanelProps {
    onClose: () => void;
    theme: 'light' | 'dark';
}

const formatSubmittedAt = (timestamp?: number) => {
    if (!timestamp) return 'Recently submitted';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }).format(timestamp);
};

const formatDistance = (meters?: number): string => {
    if (meters === undefined || meters === null) return 'Offset from place center';
    const feet = Math.round(meters * 3.28084);
    if (feet < 1000) {
        return `${feet} ft from place center`;
    }
    const miles = (meters / 1609.34).toFixed(2);
    return `${miles} mi from place center`;
};

const MapReviewPanel: React.FC<MapReviewPanelProps> = ({ onClose, theme }) => {
    const [items, setItems] = useState<PendingAccessPointReview[]>([]);
    const [currentIndex, setCurrentIndex] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [actionId, setActionId] = useState<string | null>(null);
    const [copiedCoord, setCopiedCoord] = useState(false);
    const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
    const [statusToast, setStatusToast] = useState<string | null>(null);
    const isDark = theme === 'dark';

    const load = async () => {
        setIsLoading(true);
        try {
            const submissions = await listPendingAccessPointReviews();
            setItems(submissions);
            setCurrentIndex(0);
        } catch (err) {
            console.error('[MapReview] Failed to load pending queue:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const currentItem: PendingAccessPointReview | undefined = items[currentIndex];

    const decide = async (item: PendingAccessPointReview, decision: 'approve' | 'reject') => {
        setActionId(item.accessPointId);
        try {
            await moderateAccessPoint(item.normalizedKey, item.accessPointId, decision);
            const remaining = items.filter(
                candidate => candidate.accessPointId !== item.accessPointId || candidate.normalizedKey !== item.normalizedKey
            );
            setItems(remaining);
            if (currentIndex >= remaining.length && remaining.length > 0) {
                setCurrentIndex(remaining.length - 1);
            }
            setStatusToast(decision === 'approve' ? 'Entrance approved into live routing' : 'Submission rejected');
            setTimeout(() => setStatusToast(null), 3000);
        } catch (err: any) {
            console.error(`[MapReview] Failed to ${decision}:`, err);
            alert(`Could not ${decision} entrance: ${err?.message || 'Permission denied'}`);
        } finally {
            setActionId(null);
        }
    };

    const copyCoordinates = (lat: number, lng: number) => {
        const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        navigator.clipboard.writeText(text);
        setCopiedCoord(true);
        setTimeout(() => setCopiedCoord(false), 2000);
    };

    const config = useMemo(() => {
        if (!currentItem) return null;
        const key = currentItem.type as AccessPointType;
        return ACCESS_POINT_TYPE_CONFIG[key] || { label: currentItem.name, icon: '📍' };
    }, [currentItem]);

    const distanceBadgeClass = useMemo(() => {
        if (!currentItem?.moveDistanceMeters) return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
        if (currentItem.moveDistanceMeters < 30) {
            return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
        }
        if (currentItem.moveDistanceMeters < 100) {
            return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
        }
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    }, [currentItem]);

    return (
        <div className="fixed inset-0 z-[300] bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
            <section
                className={`w-full sm:max-w-xl max-h-[92dvh] sm:max-h-[88dvh] flex flex-col rounded-t-[2.25rem] sm:rounded-[2rem] overflow-hidden shadow-2xl border ${
                    isDark ? 'bg-slate-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                }`}
            >
                {/* Header with Title, Progress Counter & Close */}
                <header className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-violet-500/20">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="font-black text-base">Map Review Queue</h2>
                                {items.length > 0 && (
                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                        {currentIndex + 1} of {items.length}
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-400">Moderation for exceptional place entrances</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => void load()}
                            disabled={isLoading}
                            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 grid place-items-center text-slate-300 transition-colors"
                            title="Refresh Queue"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 grid place-items-center text-slate-300 transition-colors cursor-pointer"
                            title="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </header>

                {/* Status Notification Toast */}
                {statusToast && (
                    <div className="px-4 py-2 bg-emerald-500/20 border-b border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>{statusToast}</span>
                    </div>
                )}

                {/* Content Area: Card Stack */}
                <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
                    {isLoading ? (
                        <div className="py-24 text-center space-y-3">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-400" />
                            <p className="text-xs font-bold text-slate-400">Loading pending entrance submissions...</p>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="py-20 text-center space-y-3 px-6">
                            <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mx-auto flex items-center justify-center shadow-lg">
                                <Check className="w-8 h-8" />
                            </div>
                            <h3 className="font-black text-base text-white">Review Queue is Clear</h3>
                            <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                                No exceptional map entrance submissions are pending review. Routine entrances automatically graduate into the live routing dataset after three independent driver confirmations.
                            </p>
                            <button
                                type="button"
                                onClick={onClose}
                                className="mt-4 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-black text-slate-200 transition-colors"
                            >
                                Return to Settings
                            </button>
                        </div>
                    ) : currentItem && (
                        <div className="space-y-3.5 animate-in fade-in duration-200">
                            {/* Card Stack Navigation Pill Bar */}
                            {items.length > 1 && (
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-[11px] font-bold text-slate-400">
                                        Reviewing item {currentIndex + 1} of {items.length}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            disabled={currentIndex === 0}
                                            onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                                            className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                            title="Previous Candidate"
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={currentIndex === items.length - 1}
                                            onClick={() => setCurrentIndex(i => Math.min(items.length - 1, i + 1))}
                                            className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                            title="Next Candidate"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Main Review Card */}
                            <div className={`rounded-2xl border p-4 sm:p-5 space-y-4 shadow-xl ${
                                isDark ? 'bg-white/[0.03] border-white/10' : 'bg-slate-50 border-slate-200'
                            }`}>
                                {/* Header: Place Name & Department Badge */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="text-sm">{config?.icon || '📍'}</span>
                                            <span className="text-xs font-black px-2 py-0.5 rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                                {config?.label || currentItem.name}
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                {currentItem.confirmations} confirmation{currentItem.confirmations === 1 ? '' : 's'}
                                            </span>
                                        </div>
                                        <h3 className="font-black text-lg text-white leading-snug truncate">
                                            {currentItem.placeName || currentItem.name}
                                        </h3>
                                        <p className="text-[11px] text-slate-400">
                                            {formatSubmittedAt(currentItem.submittedAt)}
                                        </p>
                                    </div>

                                    {/* Move Distance Pill */}
                                    <div className={`shrink-0 text-right px-2.5 py-1.5 rounded-xl border flex flex-col items-end ${distanceBadgeClass}`}>
                                        <div className="flex items-center gap-1 text-[11px] font-black">
                                            <Compass className="w-3 h-3 shrink-0" />
                                            <span>
                                                {currentItem.moveDistanceMeters !== undefined
                                                    ? `${Math.round(currentItem.moveDistanceMeters * 3.28084)} ft`
                                                    : 'Entrance Pin'}
                                            </span>
                                        </div>
                                        <span className="text-[9px] font-semibold opacity-80">Shift Distance</span>
                                    </div>
                                </div>

                                {/* Map Coordinate Visual Card */}
                                <div className="rounded-xl border border-white/10 overflow-hidden bg-slate-900/60 p-3 space-y-2.5">
                                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                                        <div className="flex items-center gap-1.5">
                                            <Navigation2 className="w-3.5 h-3.5 text-emerald-400" />
                                            <span>Proposed Navigation Target</span>
                                        </div>
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${currentItem.location.lat},${currentItem.location.lng}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                                        >
                                            <span>View on Satellite</span>
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>

                                    {/* Coordinate Readout with One-Tap Copy */}
                                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-black/40 border border-white/5 text-xs font-mono">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <MapPin className="w-4 h-4 text-violet-400 shrink-0" />
                                            <span className="truncate text-slate-200">
                                                {currentItem.location.lat.toFixed(6)}, {currentItem.location.lng.toFixed(6)}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => copyCoordinates(currentItem.location.lat, currentItem.location.lng)}
                                            className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-sans font-bold text-slate-300 flex items-center gap-1 shrink-0 transition-colors"
                                        >
                                            {copiedCoord ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                            <span>{copiedCoord ? 'Copied' : 'Copy'}</span>
                                        </button>
                                    </div>

                                    {/* Move Distance Description Banner */}
                                    <div className="flex items-center gap-2 text-[11px] text-slate-300 px-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                        <span>
                                            Routes will route drivers directly to this entrance rather than the generalized building center.
                                        </span>
                                    </div>
                                </div>

                                {/* Evidence Section: Notes & Storefront Photo */}
                                <div className="space-y-2">
                                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
                                        Driver Evidence
                                    </h4>

                                    {/* Submitter Notes */}
                                    {currentItem.notes ? (
                                        <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-200 leading-relaxed flex items-start gap-2">
                                            <span className="text-violet-400 font-black text-sm leading-none shrink-0 mt-0.5">“</span>
                                            <p className="font-medium italic flex-1">{currentItem.notes}</p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-500 italic">No additional notes provided by driver.</p>
                                    )}

                                    {/* Photo Proof Thumbnail */}
                                    {currentItem.imageUrl ? (
                                        <div className="mt-2">
                                            <div
                                                onClick={() => setExpandedPhoto(currentItem.imageUrl!)}
                                                className="group relative rounded-xl border border-white/10 overflow-hidden cursor-pointer aspect-video bg-black/40 max-h-48"
                                            >
                                                <img
                                                    src={currentItem.imageUrl}
                                                    alt="Storefront entrance proof"
                                                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end justify-between p-2.5">
                                                    <span className="text-[10px] font-bold text-white flex items-center gap-1">
                                                        <Camera className="w-3 h-3 text-violet-400" />
                                                        <span>Storefront Photo Attached</span>
                                                    </span>
                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-white/20 text-white backdrop-blur-sm flex items-center gap-1">
                                                        <Eye className="w-2.5 h-2.5" /> Tap to zoom
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-2.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center gap-2 text-xs text-slate-500">
                                            <Camera className="w-3.5 h-3.5 opacity-40 shrink-0" />
                                            <span>No storefront photo attached</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sticky Bottom Action Bar (Thumb Reachable on Mobile) */}
                {currentItem && (
                    <footer className="p-4 border-t border-white/10 shrink-0 bg-white/[0.02]">
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                disabled={actionId === currentItem.accessPointId}
                                onClick={() => void decide(currentItem, 'reject')}
                                className="py-3 px-4 rounded-xl border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 text-sm font-black flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                                <span>{actionId === currentItem.accessPointId ? 'Processing…' : 'Reject'}</span>
                            </button>

                            <button
                                type="button"
                                disabled={actionId === currentItem.accessPointId}
                                onClick={() => void decide(currentItem, 'approve')}
                                className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                            >
                                {actionId === currentItem.accessPointId ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Check className="w-4 h-4 stroke-[3]" />
                                )}
                                <span>{actionId === currentItem.accessPointId ? 'Saving…' : 'Approve'}</span>
                            </button>
                        </div>
                    </footer>
                )}
            </section>

            {/* Photo Lightbox Modal */}
            {expandedPhoto && (
                <div
                    onClick={() => setExpandedPhoto(null)}
                    className="fixed inset-0 z-[350] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-150"
                >
                    <div className="relative max-w-2xl w-full max-h-[85vh] flex flex-col items-center">
                        <button
                            type="button"
                            onClick={() => setExpandedPhoto(null)}
                            className="absolute -top-12 right-0 w-9 h-9 rounded-full bg-white/10 text-white grid place-items-center hover:bg-white/20 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <img
                            src={expandedPhoto}
                            alt="Full resolution entrance evidence"
                            className="max-h-[75vh] w-auto rounded-2xl shadow-2xl border border-white/20 object-contain"
                        />
                        <p className="text-xs text-slate-300 mt-3 font-medium">Entrance photo verification proof</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MapReviewPanel;
