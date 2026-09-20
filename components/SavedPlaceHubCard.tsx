import React, { useState, useEffect, useMemo } from 'react';
import { Place, FamilyMember, Location, NavigationRoute } from '../types';
import { getDistanceMeters, getDistanceMiles } from '../utils/geo';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { convoyService } from '../services/convoyService';
import {
    Home,
    Briefcase,
    GraduationCap,
    Dumbbell,
    MapPin,
    Navigation,
    MessageSquare,
    Share2,
    Edit3,
    X,
    Users,
    CheckCircle2,
    Clock,
    Send,
    Trash2,
    Plus,
    Car,
    Radio,
    Sparkles,
    Shield,
    Pin
} from 'lucide-react';

export interface SavedPlaceHubCardProps {
    place: Place;
    onClose: () => void;
    onNavigate: (selectedRoute?: NavigationRoute) => void;
    theme: 'light' | 'dark';
    userLocation?: Location | null;
    isMobile?: boolean;
    onEditPlace?: (place: Place) => void;
    members?: FamilyMember[];
    currentUserId?: string;
    routeOptions?: NavigationRoute[];
    selectedRouteIdx?: number;
    onSelectRoutePreview?: (route: NavigationRoute) => void;
    isLoadingRoutes?: boolean;
    userPlaces?: Place[];
}

interface PlaceNote {
    text: string;
    authorName: string;
    timestamp: number;
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
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
}

const SavedPlaceHubCard: React.FC<SavedPlaceHubCardProps> = ({
    place,
    onClose,
    onNavigate,
    theme,
    userLocation,
    isMobile = false,
    onEditPlace,
    members = [],
    currentUserId = '',
    routeOptions = [],
    selectedRouteIdx = 0,
    onSelectRoutePreview,
    isLoadingRoutes = false
}) => {
    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';

    // Note storage key
    const noteStorageKey = `myway_hub_note_${place.id || place.name.toLowerCase().replace(/\s+/g, '_')}`;

    // Pinned Note state
    const [pinnedNote, setPinnedNote] = useState<PlaceNote | null>(() => {
        try {
            const raw = localStorage.getItem(noteStorageKey);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });

    const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
    const [noteInputText, setNoteInputText] = useState('');
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 2500);
    };

    // Current user's name
    const currentMember = useMemo(() => {
        return members.find(m => m.id === currentUserId);
    }, [members, currentUserId]);
    const currentUserName = currentMember?.name || 'You';

    // Handle note submission
    const handleSaveNote = () => {
        if (!noteInputText.trim()) return;
        const newNote: PlaceNote = {
            text: noteInputText.trim(),
            authorName: currentUserName,
            timestamp: Date.now()
        };
        try {
            localStorage.setItem(noteStorageKey, JSON.stringify(newNote));
        } catch {}
        setPinnedNote(newNote);
        setNoteInputText('');
        setIsNoteEditorOpen(false);
        showToast('📌 Note pinned to ' + place.name);
    };

    const handleDeleteNote = () => {
        try {
            localStorage.removeItem(noteStorageKey);
        } catch {}
        setPinnedNote(null);
        showToast('Note cleared');
    };

    // Calculate member presence relative to this saved place
    const memberPresences = useMemo(() => {
        const placeRadiusMeters = Math.max((place.radius || 0.15) * 1609.34, 120);
        const placeNameLower = (place.name || '').trim().toLowerCase();
        const placeType = place.type;

        return members.map(member => {
            // Check if member is at this place
            let isHere = false;
            if (member.currentPlace) {
                const memPlace = member.currentPlace.trim().toLowerCase();
                if (memPlace === placeNameLower) isHere = true;
                if (placeType === 'home' && (memPlace === 'home' || memPlace.includes('home'))) isHere = true;
                if (placeType === 'work' && (memPlace === 'work' || memPlace.includes('work') || memPlace.includes('office'))) isHere = true;
            }

            let distMiles: number | null = null;
            if (member.location && place.location && (member.location.lat !== 0 || member.location.lng !== 0)) {
                const distM = getDistanceMeters(member.location, place.location);
                distMiles = getDistanceMiles(member.location, place.location);
                if (distM <= placeRadiusMeters) {
                    isHere = true;
                }
            }

            // Check if member is en route to this place
            let isEnRoute = false;
            let etaLabel = '';
            if (!isHere && member.currentTrip) {
                const dest = (member.currentTrip.destinationName || '').toLowerCase();
                if (dest && (dest === placeNameLower || dest.includes(placeNameLower) || (placeType === 'home' && dest.includes('home')))) {
                    isEnRoute = true;
                    etaLabel = member.currentTrip.eta ? `${member.currentTrip.eta}` : 'En Route';
                } else if (member.currentTrip.destinationLoc && place.location) {
                    const distDest = getDistanceMeters(member.currentTrip.destinationLoc, place.location);
                    if (distDest < 200) {
                        isEnRoute = true;
                        etaLabel = member.currentTrip.eta ? `${member.currentTrip.eta}` : 'En Route';
                    }
                }
            }

            let statusCategory: 'here' | 'en_route' | 'away' = 'away';
            let statusTag = 'Away';

            if (isHere) {
                statusCategory = 'here';
                statusTag = placeType === 'home' ? 'Home' : placeType === 'work' ? 'At Work' : 'Here';
            } else if (isEnRoute) {
                statusCategory = 'en_route';
                statusTag = etaLabel || 'En Route';
            } else {
                statusCategory = 'away';
                if (distMiles !== null) {
                    statusTag = distMiles < 0.2 ? 'Nearby' : `${distMiles < 10 ? distMiles.toFixed(1) : Math.round(distMiles)} mi away`;
                } else {
                    statusTag = 'Away';
                }
            }

            return {
                member,
                statusCategory,
                statusTag,
                distMiles
            };
        });
    }, [members, place]);

    const hereList = memberPresences.filter(p => p.statusCategory === 'here');
    const enRouteList = memberPresences.filter(p => p.statusCategory === 'en_route');

    // Header presence status string
    const presenceStatusText = useMemo(() => {
        const count = hereList.length;
        const isHome = place.type === 'home' || place.name.toLowerCase().includes('home');
        const isWork = place.type === 'work' || place.name.toLowerCase().includes('work');
        const suffix = isHome ? 'home' : isWork ? 'at work' : 'here';

        if (count === 0) {
            if (enRouteList.length > 0) {
                const enNames = enRouteList.map(e => e.member.name).join(', ');
                return `${enNames} heading ${suffix}`;
            }
            return `Nobody currently ${suffix}`;
        }
        if (count === 1) {
            const name = hereList[0].member.name;
            return `${name === currentUserName ? 'You are' : `${name} is`} currently ${suffix}`;
        }
        if (count === 2) {
            return `${hereList[0].member.name} & ${hereList[1].member.name} are ${suffix}`;
        }
        return `${count} people currently ${suffix}`;
    }, [hereList, enRouteList, place.type, place.name, currentUserName]);

    // Compute activity footer string
    const activityFooterText = useMemo(() => {
        // Look for any notification in localStorage for this place
        try {
            const rawNotes = localStorage.getItem('myway_notifications');
            if (rawNotes) {
                const notifications = JSON.parse(rawNotes);
                if (Array.isArray(notifications)) {
                    const placeMatch = notifications.find((n: any) => 
                        (n.type === 'arrival' || n.type === 'departure') &&
                        (n.message?.toLowerCase().includes(place.name.toLowerCase()) || n.title?.toLowerCase().includes(place.name.toLowerCase()))
                    );
                    if (placeMatch && placeMatch.timestamp) {
                        return `Last activity: ${placeMatch.message || placeMatch.title} • ${formatRelativeTime(placeMatch.timestamp)}`;
                    }
                }
            }
        } catch {}

        if (hereList.length > 0) {
            return `Active presence: ${hereList.map(h => h.member.name).join(', ')} currently checked in`;
        }
        return `Place verified • Monitored for Circle protection`;
    }, [place.name, hereList]);

    // Handle Share
    const handleSharePlace = async () => {
        const shareData = {
            title: `MyWay: ${place.name}`,
            text: `📍 Saved Circle Location: ${place.name}${place.description ? ` (${place.description})` : ''}`,
            url: `https://maps.google.com/?q=${place.location.lat},${place.location.lng}`
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else {
                await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
                showToast(`📋 Location copied to clipboard`);
            }
        } catch {
            try {
                await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
                showToast(`📋 Location copied to clipboard`);
            } catch {}
        }
    };

    // Primary action button label
    const navigateButtonLabel = useMemo(() => {
        const isHome = place.type === 'home' || place.name.toLowerCase().includes('home');
        const isWork = place.type === 'work' || place.name.toLowerCase().includes('work');
        const prefix = isHome ? 'Navigate Home' : isWork ? 'Navigate to Work' : `Navigate to ${place.name}`;
        
        const activeRoute = routeOptions[selectedRouteIdx] || routeOptions[0];
        if (activeRoute?.totalTime) {
            return `${prefix} (${activeRoute.totalTime})`;
        }
        return prefix;
    }, [place.type, place.name, routeOptions, selectedRouteIdx]);

    const placeIcon = place.icon || (place.type === 'home' ? '🏠' : place.type === 'work' ? '💼' : place.type === 'school' ? '🏫' : place.type === 'gym' ? '🏋️' : '📍');
    const cleanPlaceName = (place.name || '').replace(/^[🏠🏡🏢🏫🏋️📍💼]\s*/u, '').trim() || place.name;

    const cardBg = isDark
        ? 'bg-[#0f172a]/95 border-white/10 text-white'
        : 'bg-[#fdfbf7]/98 border-slate-200/80 shadow-2xl text-slate-900';

    const rootClasses = isMobile
        ? `w-full max-h-[85vh] sm:max-h-[90vh] landscape:top-16 landscape:bottom-4 landscape:max-h-[calc(100dvh-5.5rem)] landscape:sm:max-h-[calc(100dvh-5.5rem)] landscape:my-auto flex flex-col overflow-hidden rounded-t-[2.5rem] landscape:rounded-[2rem] shadow-[0_-10px_50px_rgba(0,0,0,0.5)] border-t landscape:border backdrop-blur-2xl animate-in slide-in-from-bottom landscape:slide-in-from-left duration-300 pb-[max(env(safe-area-inset-bottom,10px),10px)] landscape:pb-0 opacity-100 pointer-events-auto ${cardBg}`
        : `w-full max-w-full landscape:top-16 landscape:bottom-4 landscape:max-h-[calc(100dvh-5.5rem)] landscape:sm:max-h-[calc(100dvh-5.5rem)] landscape:my-auto flex flex-col overflow-hidden backdrop-blur-2xl rounded-[1.75rem] sm:rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border animate-in fade-in slide-in-from-top-2 duration-300 opacity-100 pointer-events-auto ${cardBg}`;

    return (
        <div className={rootClasses}>
            
            {/* Toast notification banner */}
            {toastMessage && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[150] px-3.5 py-1.5 rounded-full bg-slate-900/95 border border-indigo-500/40 text-white text-xs font-bold shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
                    {toastMessage}
                </div>
            )}

            {/* Drag Handle Pill (Mobile Only) */}
            {isMobile && (
                <div 
                    className="pt-2.5 pb-1 landscape:pt-1.5 landscape:pb-0.5 cursor-grab active:cursor-grabbing flex justify-center shrink-0"
                    onClick={onClose}
                >
                    <div className={`w-12 h-1.5 landscape:w-8 landscape:h-1 rounded-full mx-auto transition-colors ${isDark ? 'bg-white/20 hover:bg-white/30' : 'bg-slate-300 hover:bg-slate-400'}`} />
                </div>
            )}

            {/* Scrollable Hub Content Container */}
            <div className={`flex-1 overflow-y-auto overscroll-contain no-scrollbar px-4 pb-3.5 flex flex-col gap-3 ${isMobile ? 'pt-0.5 landscape:pt-0.5' : 'pt-4 landscape:pt-3'}`}>
                
                {/* ─── 1. HEADER ROW: Title + Live Status + Actions ─── */}
                <div className="flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h2 className={`text-xl landscape:text-lg font-black tracking-tight truncate ${textColor}`}>
                                {cleanPlaceName}
                            </h2>
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shrink-0">
                                Family Hub
                            </span>
                        </div>

                        {/* Live Occupant & Presence Indicator */}
                        <div className="flex items-center gap-2 mt-1">
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                                {hereList.length > 0 && (
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                )}
                                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${hereList.length > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            </span>
                            <span className={`text-xs landscape:text-[11px] font-bold truncate ${hereList.length > 0 ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : subTextColor}`}>
                                {presenceStatusText}
                            </span>
                        </div>
                    </div>

                    {/* Header Controls: Edit & Close */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {onEditPlace && (
                            <button
                                type="button"
                                onClick={() => onEditPlace(place)}
                                className={`p-2 landscape:p-1.5 rounded-full transition-all text-sm flex items-center justify-center cursor-pointer ${
                                    isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                                title="Edit place details or geofence radius"
                            >
                                <Edit3 className="w-4 h-4 landscape:w-3.5 landscape:h-3.5" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className={`p-2 landscape:p-1.5 rounded-full transition-all text-sm flex items-center justify-center cursor-pointer ${
                                isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                            title="Close"
                        >
                            <X className="w-4 h-4 landscape:w-3.5 landscape:h-3.5" />
                        </button>
                    </div>
                </div>

                {/* ─── 2. FAMILY STATUS ROW: Avatars with Live Status Badges ─── */}
                <div className={`p-2.5 landscape:p-2 rounded-2xl border transition-all ${
                    isDark ? 'bg-white/[0.03] border-white/10' : 'bg-white/80 border-slate-200 shadow-xs'
                }`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            <Users className="w-3 h-3 text-indigo-400" />
                            <span>Circle Presence ({members.length})</span>
                        </span>
                        {enRouteList.length > 0 && (
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                                {enRouteList.length} en route
                            </span>
                        )}
                    </div>

                    {/* Member Avatars Horizontal Deck */}
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                        {memberPresences.length > 0 ? (
                            memberPresences.map(({ member, statusCategory, statusTag }) => {
                                const isHere = statusCategory === 'here';
                                const isEnRoute = statusCategory === 'en_route';

                                return (
                                    <div
                                        key={member.id}
                                        className={`flex flex-col items-center gap-1 min-w-[64px] max-w-[76px] shrink-0 p-1.5 rounded-xl transition-all ${
                                            isHere
                                                ? (isDark ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-emerald-50 border border-emerald-200')
                                                : isEnRoute
                                                ? (isDark ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-amber-50 border border-amber-200')
                                                : (isDark ? 'bg-white/[0.02] border border-white/5 opacity-75' : 'bg-slate-50 border border-slate-100 opacity-80')
                                        }`}
                                    >
                                        <div className="relative">
                                            <img
                                                src={getSafeAvatarUrl(member.avatar, member.name)}
                                                alt={member.name}
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(member.name);
                                                }}
                                                className={`w-9 h-9 landscape:w-8 landscape:h-8 rounded-full object-cover border-2 ${
                                                    isHere
                                                        ? 'border-emerald-400 ring-2 ring-emerald-500/30'
                                                        : isEnRoute
                                                        ? 'border-amber-400 ring-2 ring-amber-500/30'
                                                        : (isDark ? 'border-slate-700' : 'border-slate-200')
                                                }`}
                                            />
                                            {isHere ? (
                                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border border-white flex items-center justify-center text-[7px] text-white">
                                                    ✓
                                                </span>
                                            ) : isEnRoute ? (
                                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-500 border border-white flex items-center justify-center text-[7px] text-white">
                                                    🚗
                                                </span>
                                            ) : null}
                                        </div>

                                        <span className={`text-[11px] landscape:text-[10px] font-bold truncate max-w-full ${textColor}`}>
                                            {member.name.split(' ')[0]}
                                        </span>

                                        <span className={`text-[9px] landscape:text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tight truncate max-w-full ${
                                            isHere
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : isEnRoute
                                                ? 'bg-amber-500/20 text-amber-400'
                                                : (isDark ? 'bg-white/10 text-slate-400' : 'bg-slate-200 text-slate-600')
                                        }`}>
                                            {statusTag}
                                        </span>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-xs text-slate-400 py-1">No circle members found</p>
                        )}
                    </div>
                </div>

                {/* ─── 3. FAMILY NOTE PINBOARD ─── */}
                <div className={`p-3 landscape:p-2 rounded-2xl border transition-all ${
                    pinnedNote
                        ? (isDark ? 'bg-amber-500/10 border-amber-500/30 shadow-xs' : 'bg-amber-50/80 border-amber-200 shadow-xs')
                        : (isDark ? 'bg-white/[0.03] border-white/10' : 'bg-slate-50 border-slate-200')
                }`}>
                    {pinnedNote && !isNoteEditorOpen ? (
                        <div className="flex items-start justify-between gap-2.5">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                                <Pin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <p className={`text-xs landscape:text-[11px] font-bold leading-snug break-words ${isDark ? 'text-amber-200' : 'text-amber-900'}`}>
                                        "{pinnedNote.text}"
                                    </p>
                                    <p className={`text-[10px] landscape:text-[9px] font-medium mt-1 ${isDark ? 'text-amber-400/80' : 'text-amber-700'}`}>
                                        — {pinnedNote.authorName} • {formatRelativeTime(pinnedNote.timestamp)}
                                    </p>
                                </div>
                            </div>

                            {/* Note Actions: Edit / Delete */}
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNoteInputText(pinnedNote.text);
                                        setIsNoteEditorOpen(true);
                                    }}
                                    className={`p-1.5 rounded-lg text-xs transition-all ${isDark ? 'hover:bg-white/10 text-amber-300' : 'hover:bg-amber-100 text-amber-800'}`}
                                    title="Edit note"
                                >
                                    <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteNote}
                                    className={`p-1.5 rounded-lg text-xs transition-all ${isDark ? 'hover:bg-rose-500/20 text-rose-400' : 'hover:bg-rose-100 text-rose-600'}`}
                                    title="Clear note"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ) : isNoteEditorOpen ? (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase text-amber-400 flex items-center gap-1">
                                    <Pin className="w-3 h-3" />
                                    <span>Pin Note for House</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setIsNoteEditorOpen(false)}
                                    className="text-xs opacity-60 hover:opacity-100"
                                >
                                    Cancel
                                </button>
                            </div>
                            <textarea
                                value={noteInputText}
                                onChange={(e) => setNoteInputText(e.target.value)}
                                placeholder="e.g. Left the key under the flowerpot, dinner in the fridge..."
                                rows={2}
                                className={`w-full p-2 rounded-xl text-xs resize-none border focus:outline-hidden focus:ring-1 focus:ring-amber-400 ${
                                    isDark ? 'bg-black/40 border-amber-500/30 text-white placeholder-slate-500' : 'bg-white border-amber-200 text-slate-900 placeholder-slate-400'
                                }`}
                                autoFocus
                            />
                            <div className="flex justify-end gap-1.5">
                                <button
                                    type="button"
                                    onClick={handleSaveNote}
                                    disabled={!noteInputText.trim()}
                                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                                >
                                    <Send className="w-3 h-3" />
                                    <span>Pin Note</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => {
                                setNoteInputText('');
                                setIsNoteEditorOpen(true);
                            }}
                            className={`w-full py-1.5 px-2 flex items-center justify-center gap-1.5 text-xs font-bold transition-all border border-dashed rounded-xl cursor-pointer ${
                                isDark
                                    ? 'border-white/15 text-slate-400 hover:border-amber-400/50 hover:text-amber-300 bg-white/[0.01]'
                                    : 'border-slate-300 text-slate-600 hover:border-amber-500 hover:text-amber-800 bg-white/50'
                            }`}
                        >
                            <Plus className="w-3.5 h-3.5 text-amber-400" />
                            <span>Leave Note for Family</span>
                        </button>
                    )}
                </div>

                {/* ─── 4. ROUTE PREVIEW CHIPS (Dedicated fixed-height slot to eliminate CLS) ─── */}
                <div className="h-8 min-h-[32px] flex items-center overflow-hidden shrink-0">
                    {routeOptions.length > 0 ? (
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 w-full animate-in fade-in duration-300">
                            {routeOptions.map((route, idx) => {
                                const isSelected = selectedRouteIdx === idx;
                                const isFastest = idx === 0 || (route.routeLabel && route.routeLabel.toLowerCase().includes('fastest'));
                                const labelText = route.routeLabel || (isFastest ? 'Fastest Route' : 'Route');
                                return (
                                    <button
                                        key={route.id || idx}
                                        type="button"
                                        onClick={() => onSelectRoutePreview?.(route)}
                                        className={`px-2.5 py-1 rounded-xl text-xs font-black border transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                            isSelected
                                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-1 ring-indigo-400/30'
                                                : (isDark ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-white')
                                        }`}
                                    >
                                        <Navigation className="w-3 h-3 shrink-0" />
                                        <span>{labelText} • {route.totalTime}</span>
                                        {route.totalDistance && <span className="opacity-75 font-normal text-[10px]">({route.totalDistance})</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] text-slate-400 dark:text-slate-500 shrink-0 select-none animate-in fade-in duration-200">
                            <Navigation className="w-3 h-3 shrink-0 opacity-40 animate-pulse" />
                            <span className="text-[11px] font-bold">
                                {isLoadingRoutes ? 'Calculating fastest route…' : 'Fastest Route • Ready'}
                            </span>
                        </div>
                    )}
                </div>

                {/* ─── 5. ACTION GRID ─── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0 bg-transparent pt-2 border-t border-slate-100 dark:border-slate-700">
                    {/* Primary Button: Navigate Home / Work */}
                    <button
                        type="button"
                        onClick={() => onNavigate(routeOptions[selectedRouteIdx] || routeOptions[0] || undefined)}
                        className="sm:col-span-3 h-11 landscape:h-9 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-sm landscape:text-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        <Navigation className="w-4 h-4 landscape:w-3.5 landscape:h-3.5 fill-current shrink-0" />
                        <span className="truncate">{navigateButtonLabel}</span>
                    </button>

                    {/* Secondary Actions Row */}
                    <div className="sm:col-span-3 flex items-center gap-2 bg-transparent">
                        {/* Leave Note Trigger */}
                        <button
                            type="button"
                            onClick={() => {
                                setNoteInputText(pinnedNote?.text || '');
                                setIsNoteEditorOpen(true);
                            }}
                            className={`flex-1 h-9 px-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer truncate ${
                                isDark
                                    ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                                    : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800'
                            }`}
                        >
                            <MessageSquare className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                            <span className="truncate">Leave Note</span>
                        </button>

                        {/* Share Location */}
                        <button
                            type="button"
                            onClick={handleSharePlace}
                            className={`flex-1 h-9 px-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer truncate ${
                                isDark
                                    ? 'border-white/10 hover:bg-white/10 text-slate-300'
                                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}
                        >
                            <Share2 className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                            <span className="truncate">Share Location</span>
                        </button>

                        {/* Plan Convoy */}
                        <button
                            type="button"
                            onClick={() => {
                                convoyService.startConvoy(
                                    place.name || 'Destination',
                                    place.location,
                                    'self',
                                    currentUserName
                                );
                                onNavigate(routeOptions[selectedRouteIdx] || routeOptions[0] || undefined);
                            }}
                            className={`h-9 px-3 rounded-xl border text-xs font-bold shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 shrink-0 cursor-pointer ${
                                isDark
                                    ? 'border-indigo-500/30 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300'
                                    : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                            }`}
                            title="Start Caravan / Convoy with Circle Members"
                        >
                            <Car className="w-3.5 h-3.5 shrink-0" />
                            <span>Convoy</span>
                        </button>
                    </div>
                </div>

                {/* ─── 6. ACTIVITY FOOTER ─── */}
                <div className={`pt-2 border-t flex items-center justify-between gap-2 text-[10px] landscape:text-[9px] font-medium shrink-0 ${
                    isDark ? 'border-white/5 text-slate-500' : 'border-slate-200 text-slate-400'
                }`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Clock className="w-3 h-3 shrink-0 opacity-70" />
                        <span className="truncate">{activityFooterText}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-emerald-400 font-bold">
                        <Shield className="w-3 h-3 shrink-0" />
                        <span>Protected</span>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SavedPlaceHubCard;
