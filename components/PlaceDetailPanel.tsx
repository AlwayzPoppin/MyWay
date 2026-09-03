
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Place, Location, NavigationRoute, FamilyMember, RouteWaypoint } from '../types';
import { fetchRouteOptions, fetchDetourDeltas } from '../services/osrmService';
import { vehicleFuelService } from '../services/vehicleFuelService';
import { convoyService } from '../services/convoyService';
import { placeCorrectionService } from '../services/placeCorrectionService';
import { searchPlacesText, searchGasStations, searchCoffeeShops, searchRestaurants } from '../services/placesService';
import { audioService } from '../services/audioService';
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
    onEditPlace?: (place: Place) => void;
    onSelectRoutePreview?: (route: NavigationRoute) => void;
    onCorrectLocation?: (place: Place) => void;
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

interface WaypointRowProps {
    wp: RouteWaypoint;
    wIdx: number;
    theme: 'light' | 'dark';
    isDragging: boolean;
    isDragOver: boolean;
    onRemove: (idx: number) => void;
    onDesktopDragStart: (idx: number) => void;
    onDesktopDragOver: (idx: number) => void;
    onDesktopDrop: (fromIdx: number, toIdx: number) => void;
    onDesktopDragEnd: () => void;
    onTouchDragStart: (e: React.TouchEvent, idx: number) => void;
    onTouchDragMove: (e: React.TouchEvent) => void;
    onTouchDragEnd: () => void;
}

const WaypointRow: React.FC<WaypointRowProps> = ({
    wp,
    wIdx,
    theme,
    isDragging,
    isDragOver,
    onRemove,
    onDesktopDragStart,
    onDesktopDragOver,
    onDesktopDrop,
    onDesktopDragEnd,
    onTouchDragStart,
    onTouchDragMove,
    onTouchDragEnd,
}) => {
    const [swipeOffset, setSwipeOffset] = useState<number>(0);
    const [isSwiping, setIsSwiping] = useState<boolean>(false);
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
    const isHorizontalSwipeRef = useRef<boolean | null>(null);

    const handleCardTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
        isHorizontalSwipeRef.current = null;
        setIsSwiping(true);
    };

    const handleCardTouchMove = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;

        if (isHorizontalSwipeRef.current === null) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                isHorizontalSwipeRef.current = true;
            } else if (Math.abs(dy) > 10) {
                isHorizontalSwipeRef.current = false;
                return;
            } else {
                return;
            }
        }

        if (!isHorizontalSwipeRef.current) return;

        // When horizontal swipe delta exceeds 40px leftward, translate the card via inline CSS (transform: translateX(-Xpx))
        if (dx < -40) {
            setSwipeOffset(Math.max(-180, dx));
        } else {
            setSwipeOffset(0);
        }
    };

    const handleCardTouchEnd = () => {
        setIsSwiping(false);
        if (!touchStartRef.current || !isHorizontalSwipeRef.current) {
            setSwipeOffset(0);
            touchStartRef.current = null;
            return;
        }

        const elapsed = Date.now() - touchStartRef.current.time;
        const distance = Math.abs(swipeOffset);
        const velocity = distance / Math.max(elapsed, 1);

        // If released past 120px (or swiped with velocity), trigger handleRemoveStop and fire haptic/audio alert
        if (distance >= 120 || (distance >= 50 && velocity > 0.4)) {
            setSwipeOffset(-350);
            try { navigator.vibrate(40); } catch {}
            try { audioService.playChirp(400, 100); } catch {}
            setTimeout(() => {
                onRemove(wIdx);
            }, 180);
        } else {
            // Snap back smoothly via transition-transform duration-200
            setSwipeOffset(0);
        }

        touchStartRef.current = null;
        isHorizontalSwipeRef.current = null;
    };

    return (
        <div
            data-waypoint-row="true"
            data-idx={wIdx}
            className="relative overflow-hidden rounded-xl select-none"
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(wIdx));
                e.dataTransfer.effectAllowed = 'move';
                onDesktopDragStart(wIdx);
            }}
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                onDesktopDragOver(wIdx);
            }}
            onDrop={(e) => {
                e.preventDefault();
                const fromStr = e.dataTransfer.getData('text/plain');
                const fromIdx = parseInt(fromStr, 10);
                if (!isNaN(fromIdx)) {
                    onDesktopDrop(fromIdx, wIdx);
                }
            }}
            onDragEnd={onDesktopDragEnd}
        >
            {/* Red background tray revealed on left swipe */}
            <div className="absolute inset-0 bg-gradient-to-l from-red-600 via-rose-600 to-red-700 rounded-xl flex items-center justify-end px-4 text-white font-bold gap-1.5 z-0">
                <span className="text-sm">🗑️</span>
                <span className="text-[10px] font-black tracking-wider uppercase">Delete</span>
            </div>

            {/* Sliding foreground card */}
            <div
                style={{
                    transform: `translateX(${swipeOffset}px)`,
                    transition: isSwiping ? 'none' : 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
                }}
                onTouchStart={handleCardTouchStart}
                onTouchMove={handleCardTouchMove}
                onTouchEnd={handleCardTouchEnd}
                onTouchCancel={handleCardTouchEnd}
                className={`relative z-10 flex items-center justify-between p-2.5 rounded-xl border group transition-all ${
                    isDragging
                        ? 'scale-[1.02] z-20 shadow-[0_4px_20px_rgba(0,242,254,0.3)] border-cyan-400 bg-cyan-950/40 ring-1 ring-cyan-400/50'
                        : isDragOver
                            ? 'border-cyan-400/60 bg-cyan-950/20'
                            : theme === 'dark'
                                ? 'bg-[#151922] border-white/10 hover:bg-white/10 hover:border-amber-500/30'
                                : 'bg-white border-slate-200 shadow-sm hover:border-amber-400 hover:shadow-md'
                }`}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {/* Subtle 6-dot drag handle icon (⠿) */}
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label="Drag to reorder"
                        className="w-5 h-6 flex items-center justify-center text-slate-400 hover:text-cyan-300 cursor-grab active:cursor-grabbing shrink-0 select-none touch-none text-base transition-colors"
                        title="Drag to reorder"
                        onTouchStart={(e) => onTouchDragStart(e, wIdx)}
                        onTouchMove={onTouchDragMove}
                        onTouchEnd={onTouchDragEnd}
                        onTouchCancel={onTouchDragEnd}
                    >
                        ⠿
                    </div>

                    {/* Numbered diamond badge */}
                    <div className="relative shrink-0 flex items-center justify-center w-6 h-6">
                        <div className="w-4.5 h-4.5 rounded-sm rotate-45 bg-amber-500 shadow-md flex items-center justify-center" />
                        <span className="absolute inset-0 flex items-center justify-center text-black font-black text-[10px]">
                            {wIdx + 1}
                        </span>
                    </div>

                    <span className={`text-xs font-bold truncate ${
                        theme === 'dark' ? 'text-white' : 'text-slate-800'
                    }`}>
                        {wp.name}
                    </span>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                    {/* Explicit ✕ button on desktop hover for quick removal without dragging */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove(wIdx);
                        }}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold transition-all cursor-pointer opacity-80 md:opacity-0 md:group-hover:opacity-100 ${
                            theme === 'dark'
                                ? 'text-red-400 hover:bg-red-500/25 hover:text-red-300 active:scale-90'
                                : 'text-red-500 hover:bg-red-100 hover:text-red-600 active:scale-90'
                        }`}
                        title="Remove Stop"
                    >
                        ✕
                    </button>
                </div>
            </div>
        </div>
    );
};

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
    onEditPlace,
    onSelectRoutePreview,
    onCorrectLocation,
    members = [],
    currentUserId = ''
}) => {
    const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);
    const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
    const subTextColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';

    // Submitter Attribution & "Helpful" Upvote state
    const [isUpvoting, setIsUpvoting] = useState(false);
    const [localHelpfulCount, setLocalHelpfulCount] = useState(place?.helpfulCount || 0);
    const [hasUpvoted, setHasUpvoted] = useState(() => {
        return Array.isArray(place?.helpfulUserIds) && currentUserId ? place.helpfulUserIds.includes(currentUserId) : false;
    });

    useEffect(() => {
        setLocalHelpfulCount(place?.helpfulCount || 0);
        setHasUpvoted(Array.isArray(place?.helpfulUserIds) && currentUserId ? place.helpfulUserIds.includes(currentUserId) : false);
    }, [place?.id, place?.helpfulCount, place?.helpfulUserIds, currentUserId]);

    const submitterMember = useMemo(() => {
        if (!place?.submitterId || !members.length) return null;
        return members.find(m => m.id === place.submitterId) || null;
    }, [place?.submitterId, members]);

    const submitterDisplayName = useMemo(() => {
        if (place?.submitterId && currentUserId && place.submitterId === currentUserId) return 'You';
        if (submitterMember?.name) return submitterMember.name;
        return place?.submitterName || 'Circle Member';
    }, [place?.submitterId, currentUserId, submitterMember, place?.submitterName]);

    const submitterAvatar = useMemo(() => {
        return submitterMember?.avatar || place?.submitterAvatar || null;
    }, [submitterMember, place?.submitterAvatar]);

    const handleToggleHelpful = async () => {
        if (!place || isUpvoting) return;
        setIsUpvoting(true);
        try {
            const nextCount = await placeCorrectionService.toggleHelpful(place, currentUserId || 'driver');
            setLocalHelpfulCount(nextCount);
            setHasUpvoted(prev => !prev);
        } catch (err) {
            console.error('Failed to toggle helpful upvote:', err);
        } finally {
            setIsUpvoting(false);
        }
    };

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
    const [newPlaceRadius, setNewPlaceRadius] = useState<number>(place.radius || 0.3);

    // Multi-route alternatives & multi-stop waypoints state
    const [routeOptions, setRouteOptions] = useState<NavigationRoute[]>([]);
    const [selectedRouteIdx, setSelectedRouteIdx] = useState<number>(0);
    const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(true);
    const [avoidTolls, setAvoidTolls] = useState<boolean>(() => {
        return localStorage.getItem('myway_avoid_tolls') === 'true';
    });
    const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);
    const [showAddStopDrawer, setShowAddStopDrawer] = useState<boolean>(false);
    const [stopSearchQuery, setStopSearchQuery] = useState<string>('');
    const [isSearchingStops, setIsSearchingStops] = useState<boolean>(false);
    const [stopSearchResults, setStopSearchResults] = useState<Place[]>([]);
    const [detourDeltas, setDetourDeltas] = useState<Map<number, number>>(new Map());

    const activeVehicle = useMemo(() => vehicleFuelService.getActiveVehicle(), []);

    // Reset waypoints when destination place changes
    useEffect(() => {
        setWaypoints([]);
        setShowAddStopDrawer(false);
        setStopSearchQuery('');
        setStopSearchResults([]);
    }, [place.id, place.name]);

    useEffect(() => {
        if (!userLocation || !place.location) {
            setIsLoadingRoutes(false);
            return;
        }
        let isMounted = true;
        setIsLoadingRoutes(true);
        fetchRouteOptions(userLocation, place.name || 'Destination', place.location, { avoidTolls, waypoints })
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
    }, [place.name, place.location, userLocation, avoidTolls, waypoints]);

    const handleAddStop = (p: Place) => {
        if (!p.location) return;
        const newWp: RouteWaypoint = {
            id: p.id || `wp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: p.name || 'Stop',
            location: p.location,
            order: waypoints.length + 1,
            isStop: true
        };
        setWaypoints(prev => [...prev, newWp]);
        setShowAddStopDrawer(false);
        setStopSearchQuery('');
        setStopSearchResults([]);
    };

    const handleRemoveStop = (idx: number) => {
        setWaypoints(prev => prev.filter((_, i) => i !== idx));
    };

    const handleReorderStop = (fromIdx: number, toIdx: number) => {
        if (fromIdx === toIdx) return;
        setWaypoints(prev => {
            const next = [...prev];
            if (fromIdx < 0 || fromIdx >= next.length || toIdx < 0 || toIdx >= next.length) return prev;
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            return next;
        });
    };

    const listContainerRef = useRef<HTMLDivElement | null>(null);
    const touchActiveIdxRef = useRef<number | null>(null);
    const touchDragStartY = useRef<number>(0);
    const rowBoundsRef = useRef<{ top: number; bottom: number; midY: number }[]>([]);
    const [touchDragIndex, setTouchDragIndex] = useState<number | null>(null);
    const [desktopDragIdx, setDesktopDragIdx] = useState<number | null>(null);
    const [desktopDragOverIdx, setDesktopDragOverIdx] = useState<number | null>(null);

    const handleTouchDragStart = (e: React.TouchEvent, idx: number) => {
        e.stopPropagation();
        const touch = e.touches[0];
        touchDragStartY.current = touch.clientY;
        touchActiveIdxRef.current = idx;
        setTouchDragIndex(idx);

        if (listContainerRef.current) {
            const children = Array.from(listContainerRef.current.querySelectorAll('[data-waypoint-row="true"]')) as HTMLElement[];
            rowBoundsRef.current = children.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    top: rect.top,
                    bottom: rect.bottom,
                    midY: (rect.top + rect.bottom) / 2
                };
            });
        }
        try { navigator.vibrate(20); } catch {}
    };

    const handleTouchDragMove = (e: React.TouchEvent) => {
        if (touchActiveIdxRef.current === null) return;
        if (e.cancelable) e.preventDefault();
        const touch = e.touches[0];
        const currentY = touch.clientY;
        const bounds = rowBoundsRef.current;
        const currentIdx = touchActiveIdxRef.current;

        if (!bounds || bounds.length === 0) return;

        for (let i = 0; i < bounds.length; i++) {
            if (i === currentIdx) continue;
            const b = bounds[i];
            if (i > currentIdx && currentY > b.midY) {
                handleReorderStop(currentIdx, i);
                touchActiveIdxRef.current = i;
                setTouchDragIndex(i);
                try { navigator.vibrate(12); } catch {}
                if (listContainerRef.current) {
                    const children = Array.from(listContainerRef.current.querySelectorAll('[data-waypoint-row="true"]')) as HTMLElement[];
                    rowBoundsRef.current = children.map(el => {
                        const rect = el.getBoundingClientRect();
                        return { top: rect.top, bottom: rect.bottom, midY: (rect.top + rect.bottom) / 2 };
                    });
                }
                break;
            }
            if (i < currentIdx && currentY < b.midY) {
                handleReorderStop(currentIdx, i);
                touchActiveIdxRef.current = i;
                setTouchDragIndex(i);
                try { navigator.vibrate(12); } catch {}
                if (listContainerRef.current) {
                    const children = Array.from(listContainerRef.current.querySelectorAll('[data-waypoint-row="true"]')) as HTMLElement[];
                    rowBoundsRef.current = children.map(el => {
                        const rect = el.getBoundingClientRect();
                        return { top: rect.top, bottom: rect.bottom, midY: (rect.top + rect.bottom) / 2 };
                    });
                }
                break;
            }
        }
    };

    const handleTouchDragEnd = () => {
        touchActiveIdxRef.current = null;
        setTouchDragIndex(null);
        rowBoundsRef.current = [];
    };

    const computeDetours = async (results: Place[]) => {
        if (!userLocation || !place.location || results.length === 0) {
            setDetourDeltas(new Map());
            return;
        }
        try {
            const candidateLocs = results
                .map(r => r.location)
                .filter((loc): loc is Location => loc != null);
            const deltas = await fetchDetourDeltas(userLocation, place.location, candidateLocs);
            setDetourDeltas(deltas);
        } catch {
            setDetourDeltas(new Map());
        }
    };

    const handleSearchStops = async (q: string) => {
        if (!q.trim() || !userLocation) {
            setStopSearchResults([]);
            setDetourDeltas(new Map());
            return;
        }
        setIsSearchingStops(true);
        try {
            const results = await searchPlacesText(q, userLocation);
            const sliced = results.slice(0, 5);
            setStopSearchResults(sliced);
            computeDetours(sliced);
        } catch {
            setStopSearchResults([]);
        } finally {
            setIsSearchingStops(false);
        }
    };

    const handleQuickPoiSearch = async (category: string) => {
        if (!userLocation) return;
        setIsSearchingStops(true);
        setDetourDeltas(new Map());
        try {
            let results: Place[] = [];
            if (category === 'gas station') results = await searchGasStations(userLocation);
            else if (category === 'coffee') results = await searchCoffeeShops(userLocation);
            else if (category === 'fast food restaurant') results = await searchRestaurants(userLocation);
            else results = await searchPlacesText(category, userLocation);
            const sliced = results.slice(0, 5);
            setStopSearchResults(sliced);
            computeDetours(sliced);
        } catch {
            setStopSearchResults([]);
        } finally {
            setIsSearchingStops(false);
        }
    };

    useEffect(() => {
        setNewPlaceName(place.name || '');
        setNewPlaceIcon(place.icon || '📍');
        setNewPlaceRadius(place.radius || 0.3);
        if (place.type && place.type !== 'search_result' && place.type !== 'sponsored') {
            setNewPlaceType(place.type as any);
        } else {
            setNewPlaceType('other');
        }
        setIsSavingPlace(false);
    }, [place]);

    const distance = formatDistanceFromUser(userLocation, place.location);
    const canCorrectPin = true; // Anyone can suggest edits or report issues for any place (Waze/Google Maps style)

    // Deduplicate address if the place title is identical to the first line of the address
    const addressSubtitle = useMemo(() => {
        const raw = (place.address || place.description || '').trim();
        if (!raw) return '';

        const title = (place.name || (place as any).title || '').trim().toLowerCase();
        if (!title) return raw;

        // If title matches full raw address (e.g. searching an exact street address)
        if (raw.toLowerCase() === title) {
            return '';
        }

        // Split by comma or newline to check if the first line is redundant with the place name
        const parts = raw.split(/\s*,\s*|\n+/);
        if (parts.length > 1) {
            const firstPart = parts[0].trim().toLowerCase();
            // If the first part matches the title (e.g. "123 Main Street"), omit it and display the rest
            if (firstPart === title || title.startsWith(firstPart) || firstPart.startsWith(title)) {
                return parts.slice(1).join(', ').trim();
            }
        }

        return raw;
    }, [place.name, (place as any).title, place.address, place.description]);

    const handleShare = async () => {
        const shareTitle = place.name || 'Location';
        const shareAddress = addressSubtitle || place.address || place.description || '';
        const shareText = shareAddress ? `${shareTitle} • ${shareAddress}` : shareTitle;
        const shareUrl = `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`;
        if (typeof navigator !== 'undefined' && navigator.share) {
            try {
                await navigator.share({
                    title: shareTitle,
                    text: shareText,
                    url: shareUrl
                });
            } catch {
                // User dismissed share sheet
            }
        } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        }
    };
    const typeLabel = useMemo(() => {
        if (!place.type) return '';
        switch (place.type) {
            case 'gas': return '⛽ Gas Station';
            case 'fire_station': return '🚒 Fire Station';
            case 'hospital': case 'emergency': return '🏥 Hospital / ER';
            case 'police': return '🚓 Police Dept';
            case 'grocery': return '🛒 Supermarket';
            case 'pharmacy': return '💊 Pharmacy';
            case 'food': return '🍔 Food & Dining';
            case 'coffee': return '☕ Coffee';
            case 'home': return '🏠 Home';
            case 'work': return '💼 Work';
            case 'school': return '🏫 School';
            case 'gym': return '💪 Gym';
            case 'maintenance': case 'mechanic': return '🔧 Auto Service';
            default: return place.type.replace('_', ' ');
        }
    }, [place.type]);

    const tagColor = useMemo(() => {
        if (place.type === 'fire_station' || place.type === 'hospital' || place.type === 'emergency') {
            return theme === 'dark' ? 'bg-red-500/25 text-red-300 border border-red-500/40' : 'bg-red-100 text-red-800';
        }
        if (place.type === 'gas') {
            return theme === 'dark' ? 'bg-orange-500/25 text-orange-300 border border-orange-500/40' : 'bg-orange-100 text-orange-800';
        }
        if (place.type === 'police') {
            return theme === 'dark' ? 'bg-blue-500/25 text-blue-300 border border-blue-500/40' : 'bg-blue-100 text-blue-800';
        }
        if (place.type === 'grocery' || place.type === 'pharmacy') {
            return theme === 'dark' ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40' : 'bg-emerald-100 text-emerald-800';
        }
        return theme === 'dark' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-700';
    }, [place.type, theme]);
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

                    {/* Safe Zone Geofence Radius Slider */}
                    <div className={`p-3 rounded-2xl border ${
                        theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center justify-between mb-1.5">
                            <div>
                                <span className={`text-[10px] font-black uppercase tracking-wider block ${
                                    theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'
                                }`}>
                                    Safe Zone Geofence
                                </span>
                                <p className="text-[9px] text-slate-400">Arrival & departure alert radius for circle</p>
                            </div>
                            <span className={`text-xs font-bold ${textColor}`}>
                                {Math.round(newPlaceRadius * 1000)}m
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0.05"
                            max="2.0"
                            step="0.05"
                            value={newPlaceRadius}
                            onChange={(e) => setNewPlaceRadius(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                        />
                        <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                            <span>50m</span>
                            <span>1km</span>
                            <span>2km</span>
                        </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={() => {
                                if (onAddPlace && newPlaceName.trim()) {
                                    onAddPlace({
                                        name: newPlaceName.trim(),
                                        icon: newPlaceIcon,
                                        location: place.location,
                                        radius: newPlaceRadius,
                                        type: newPlaceType,
                                        description: place.description || place.name
                                    });
                                    setIsSavingPlace(false);
                                }
                            }}
                            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95 cursor-pointer"
                        >
                            Save Place
                        </button>
                        <button
                            onClick={() => setIsSavingPlace(false)}
                            className={`px-4 py-3 rounded-xl border font-bold text-sm transition-all active:scale-95 cursor-pointer ${
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

    const renderAddStopButton = () => (
        <button
            type="button"
            onClick={() => setShowAddStopDrawer(prev => !prev)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                showAddStopDrawer || waypoints.length > 0
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm ring-1 ring-amber-500/30'
                    : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
            title="Add Stop / Waypoint along route"
        >
            <span>➕</span>
            <span>{waypoints.length > 0 ? `${waypoints.length} Stop${waypoints.length > 1 ? 's' : ''}` : 'Add Stop'}</span>
        </button>
    );

    const renderWaypointManager = () => {
        if (waypoints.length === 0 && !showAddStopDrawer) return null;

        return (
            <div className={`mt-2 mb-2 p-3 rounded-2xl border transition-all animate-in fade-in duration-200 ${
                theme === 'dark' ? 'bg-black/40 border-white/10' : 'bg-slate-50 border-slate-200'
            }`}>
                <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1">
                        <span>📍</span> Trip Stops ({waypoints.length + 1})
                    </span>
                    <div className="flex items-center gap-2">
                        {waypoints.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setWaypoints([]);
                                    setShowAddStopDrawer(false);
                                }}
                                className="text-[9px] font-bold text-red-400 hover:text-red-300 hover:bg-red-500/20 px-2 py-0.5 rounded-full border border-red-500/30 transition-all cursor-pointer flex items-center gap-1"
                            >
                                <span>🗑️</span> Clear All
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowAddStopDrawer(prev => !prev)}
                            className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer px-2 py-0.5 rounded-full border border-sky-500/30 hover:bg-sky-500/20 transition-all"
                        >
                            {showAddStopDrawer ? '▲ Close' : '➕ Add Stop'}
                        </button>
                    </div>
                </div>

                {/* Ordered Stops List with Drag-to-Reorder & Swipe-to-Delete */}
                <div ref={listContainerRef} className="space-y-1.5 mb-2">
                    {waypoints.map((wp, wIdx) => (
                        <WaypointRow
                            key={wp.id}
                            wp={wp}
                            wIdx={wIdx}
                            theme={theme}
                            isDragging={touchDragIndex === wIdx || desktopDragIdx === wIdx}
                            isDragOver={desktopDragOverIdx === wIdx && desktopDragIdx !== wIdx}
                            onRemove={handleRemoveStop}
                            onDesktopDragStart={(idx) => setDesktopDragIdx(idx)}
                            onDesktopDragOver={(idx) => setDesktopDragOverIdx(idx)}
                            onDesktopDrop={(fromIdx, toIdx) => {
                                handleReorderStop(fromIdx, toIdx);
                                setDesktopDragIdx(null);
                                setDesktopDragOverIdx(null);
                            }}
                            onDesktopDragEnd={() => {
                                setDesktopDragIdx(null);
                                setDesktopDragOverIdx(null);
                            }}
                            onTouchDragStart={handleTouchDragStart}
                            onTouchDragMove={handleTouchDragMove}
                            onTouchDragEnd={handleTouchDragEnd}
                        />
                    ))}

                    {/* Final Destination Pill */}
                    <div className={`flex items-center justify-between p-2.5 rounded-xl border ${
                        theme === 'dark' ? 'bg-sky-500/10 border-sky-500/30' : 'bg-sky-50 border-sky-200 shadow-sm'
                    }`}>
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="w-6 h-6 rounded-lg bg-sky-400 text-black font-black text-[11px] flex items-center justify-center shrink-0 shadow-md">
                                🏁
                            </span>
                            <span className={`text-xs font-bold truncate ${
                                theme === 'dark' ? 'text-sky-200' : 'text-sky-700'
                            }`}>
                                Final: {place.name}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Inline Add Stop Picker Drawer */}
                {showAddStopDrawer && (
                    <div className="pt-2 border-t border-white/10 space-y-2">
                        {/* Quick Ambient POI Chips */}
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                            {[
                                { label: '⛽ Gas', query: 'gas station' },
                                { label: '☕ Coffee', query: 'coffee' },
                                { label: '🍔 Food', query: 'fast food restaurant' },
                                { label: '💊 Pharmacy', query: 'pharmacy' },
                                { label: '🏧 ATM', query: 'atm' }
                            ].map(chip => (
                                <button
                                    key={chip.query}
                                    type="button"
                                    onClick={() => handleQuickPoiSearch(chip.query)}
                                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/10 hover:bg-amber-500/20 text-slate-200 shrink-0 border border-white/10 hover:border-amber-500/30 transition-colors cursor-pointer"
                                >
                                    {chip.label}
                                </button>
                            ))}
                        </div>

                        {/* Search Input Box */}
                        <div className="relative">
                            <input
                                type="text"
                                value={stopSearchQuery}
                                onChange={(e) => {
                                    setStopSearchQuery(e.target.value);
                                    handleSearchStops(e.target.value);
                                }}
                                placeholder="Search place or address to add..."
                                className={`w-full px-3 py-2 rounded-xl border text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all ${
                                    theme === 'dark'
                                        ? 'bg-black/60 border-white/15 text-white focus:border-amber-400'
                                        : 'bg-white border-slate-200 text-slate-900 focus:border-amber-400'
                                }`}
                            />
                            {isSearchingStops && (
                                <span className="absolute right-3 top-2.5 text-xs animate-spin text-amber-400">🔄</span>
                            )}
                        </div>

                        {/* Search Results */}
                        {stopSearchResults.length > 0 && (
                            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                                {stopSearchResults.map((res, rIdx) => {
                                    const detourSec = detourDeltas.get(rIdx);
                                    const detourMin = detourSec != null ? Math.round(detourSec / 60) : null;
                                    const detourColor = detourMin != null
                                        ? detourMin <= 2 ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
                                            : detourMin <= 5 ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
                                            : 'text-red-400 bg-red-500/15 border-red-500/30'
                                        : '';

                                    return (
                                        <button
                                            key={res.id || `${res.name}_${res.location?.lat}`}
                                            type="button"
                                            onClick={() => handleAddStop(res)}
                                            className={`w-full p-2 rounded-xl text-left flex items-center justify-between border transition-all text-xs cursor-pointer ${
                                                theme === 'dark'
                                                    ? 'bg-white/5 hover:bg-amber-500/20 border-white/5 hover:border-amber-500/30'
                                                    : 'bg-white hover:bg-amber-50 border-slate-200 hover:border-amber-400'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className={`font-bold truncate ${
                                                    theme === 'dark' ? 'text-white' : 'text-slate-800'
                                                }`}>{res.name}</span>
                                                {detourMin != null && (
                                                    <span className={`text-[9px] font-black shrink-0 px-1.5 py-0.5 rounded-full border ${detourColor}`}>
                                                        {detourMin <= 0 ? '0 min' : `+${detourMin} min`}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-amber-400 font-extrabold shrink-0 ml-2 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30">➕ Add</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

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
                <div className="px-4 pb-4 pt-1">
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
                                {place.isCorrected && (
                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                        <span>⭐</span> Verified Pin
                                    </span>
                                )}
                                {place.entranceType && (
                                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                                        place.entranceType === 'drive_thru'
                                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                            : place.entranceType === 'parking'
                                            ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                                            : place.entranceType === 'curbside'
                                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    }`}>
                                        <span>
                                            {place.entranceType === 'drive_thru' ? '🚗' :
                                             place.entranceType === 'parking' ? '🅿️' :
                                             place.entranceType === 'curbside' ? '📦' : '🚪'}
                                        </span>
                                        <span>
                                            {place.entranceType === 'drive_thru' ? 'Drive-Thru' :
                                             place.entranceType === 'parking' ? 'Parking' :
                                             place.entranceType === 'curbside' ? 'Curbside' : 'Main Door'}
                                        </span>
                                    </span>
                                )}
                            </div>

                            {/* Entrance Notes (if present) */}
                            {place.entranceNotes && (
                                <p className="text-[10px] text-amber-300/90 font-bold mt-1 px-2 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-1">
                                    <span>🚗</span>
                                    <span className="truncate">{place.entranceNotes}</span>
                                </p>
                            )}

                            {/* Circle Attribution & "👍 Helpful" Inline Row (Mobile) */}
                            {place.isCorrected && (
                                <div className={`flex items-center justify-between gap-2 px-2.5 py-1 rounded-xl border mt-1.5 text-[10px] ${
                                    theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                                }`}>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {submitterAvatar ? (
                                            <img
                                                src={submitterAvatar}
                                                alt={submitterDisplayName}
                                                className="w-4 h-4 rounded-full object-cover border border-amber-400/60 shrink-0"
                                            />
                                        ) : (
                                            <span className="text-xs shrink-0">⭐</span>
                                        )}
                                        <span className={`font-bold truncate ${textColor}`}>
                                            Verified by <span className="text-amber-400 font-black">{submitterDisplayName}</span>
                                        </span>
                                        {place.correctedAt && (
                                            <span className={`text-[9px] font-medium shrink-0 opacity-70 ${subTextColor}`}>
                                                • {formatRelativeTime(place.correctedAt)}
                                            </span>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleToggleHelpful}
                                        disabled={isUpvoting}
                                        className={`px-2 py-0.5 rounded-lg border font-bold text-[9px] flex items-center gap-1 transition-all active:scale-95 cursor-pointer shrink-0 ${
                                            hasUpvoted
                                                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                                                : theme === 'dark'
                                                ? 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-200'
                                                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                        }`}
                                        title="Thank the circle member who verified this entrance"
                                    >
                                        <span>👍</span>
                                        <span>{hasUpvoted ? 'Helpful' : 'Helpful'}</span>
                                        {localHelpfulCount > 0 && (
                                            <span className="text-[8px] font-mono font-black opacity-90">
                                                ({localHelpfulCount})
                                            </span>
                                        )}
                                    </button>
                                </div>
                            )}

                            {/* Storefront / Entrance Photo Preview Banner (Mobile) */}
                            {place.imageUrl && (
                                <div
                                    onClick={() => setIsPhotoLightboxOpen(true)}
                                    className="relative rounded-2xl overflow-hidden border border-white/20 shadow-sm mt-1.5 group cursor-pointer"
                                >
                                    <img
                                        src={place.imageUrl}
                                        alt={place.name}
                                        className="w-full h-20 object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                                    <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between">
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                            📸 Storefront Photo
                                        </span>
                                        <span className="text-[9px] font-bold text-white/80 bg-black/50 px-1.5 py-0.5 rounded-full">
                                            View 🔍
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Edit Place Button (Only for Saved Places) */}
                        {isSaved && onEditPlace && (
                            <button
                                type="button"
                                onClick={() => onEditPlace(place)}
                                className={`p-2 rounded-full shrink-0 transition-all text-base flex items-center justify-center cursor-pointer ${
                                    theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                }`}
                                title="Edit Place & Geofence"
                            >
                                ✏️
                            </button>
                        )}

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
                                {renderAddStopButton()}
                            </div>
                        </div>

                        {/* Multi-Stop Waypoints Drawer */}
                        {renderWaypointManager()}

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
                                                        {route.hasTolls && (
                                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 shrink-0">
                                                                💳 {route.tollCostEstimate}
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

                    {/* Geofence Radius Slider (Only for Saved Circle Places) */}
                    {isSaved && onUpdateRadius && (
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
                    <div className="flex items-center gap-1.5 mt-2.5">
                        <button
                            onClick={() => onNavigate(routeOptions[selectedRouteIdx] || undefined)}
                            className="flex-[1.5] min-w-fit h-10 px-3.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl font-black text-xs sm:text-sm shadow-md shadow-indigo-600/30 transition-all active:scale-95 flex flex-row items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                        >
                            <span className="text-base shrink-0">🚀</span>
                            <span className="whitespace-nowrap">{routeOptions[selectedRouteIdx] ? `Go (${routeOptions[selectedRouteIdx].totalTime})` : 'Go'}</span>
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
                            className="h-10 px-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs shadow-md shadow-purple-600/20 transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap"
                            title="Start Caravan / Convoy with Circle Members"
                        >
                            <span className="text-sm shrink-0">🚗🚗</span>
                            <span className="whitespace-nowrap">Convoy</span>
                        </button>
                        {onCorrectLocation && (
                            <button
                                type="button"
                                onClick={() => onCorrectLocation(place)}
                                className={`h-10 px-2.5 rounded-xl font-bold text-xs border transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap ${
                                    theme === 'dark' ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700'
                                }`}
                                title="Suggest an edit, correct location, or report issue"
                            >
                                <span className="text-sm shrink-0">✏️</span>
                                <span className="whitespace-nowrap">Suggest Edit</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleShare}
                            className={`h-10 px-2.5 rounded-xl font-bold text-xs border transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap ${
                                theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                            }`}
                            title="Share place details"
                        >
                            <span className="text-sm shrink-0">↗️</span>
                            <span className="whitespace-nowrap">Share</span>
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
        <div className={`w-full max-w-full backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 ${bgColor}`}>
            <div className="p-4 sm:p-5">
                {/* Header Row: Place Title & Action Icons (Save & Close) */}
                <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="min-w-0 flex-1">
                        <h3 className={`text-xl font-black leading-tight mb-1 truncate ${textColor}`}>{place.name}</h3>
                        {addressSubtitle && (
                            <p className={`text-xs leading-snug flex items-start gap-1.5 ${subTextColor}`}>
                                <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                                <span className="line-clamp-2">{addressSubtitle}</span>
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        {/* Edit Place Button (Desktop) */}
                        {isSaved && onEditPlace && (
                            <button
                                type="button"
                                onClick={() => onEditPlace(place)}
                                className={`p-2 rounded-full transition-all text-sm flex items-center justify-center cursor-pointer ${
                                    theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                }`}
                                title="Edit Place & Geofence"
                            >
                                ✏️
                            </button>
                        )}

                        {/* Relocated Save / Unsave Star Button */}
                        <button
                            type="button"
                            onClick={() => {
                                if (isSaved) {
                                    if (onDeletePlace) onDeletePlace(place.id);
                                } else {
                                    setIsSavingPlace(true);
                                }
                            }}
                            className={`p-2 rounded-full transition-all text-base flex items-center justify-center cursor-pointer ${
                                isSaved
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                                    : theme === 'dark'
                                    ? 'bg-white/10 hover:bg-white/20 text-white'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                            title={isSaved ? "Saved to Circle (Click to remove)" : "Save Place to Circle"}
                        >
                            {isSaved ? '⭐' : '☆'}
                        </button>

                        {/* Close Button */}
                        <button
                            type="button"
                            onClick={onClose}
                            className={`p-2 rounded-full transition-all cursor-pointer ${
                                theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                            title="Close"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                </div>

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
                    {place.entranceType && (
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                            place.entranceType === 'drive_thru'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : place.entranceType === 'parking'
                                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                                : place.entranceType === 'curbside'
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}>
                            <span>
                                {place.entranceType === 'drive_thru' ? '🚗' :
                                 place.entranceType === 'parking' ? '🅿️' :
                                 place.entranceType === 'curbside' ? '📦' : '🚪'}
                            </span>
                            <span>
                                {place.entranceType === 'drive_thru' ? 'Drive-Thru Lane' :
                                 place.entranceType === 'parking' ? 'Parking Lot' :
                                 place.entranceType === 'curbside' ? 'Curbside' : 'Main Door'}
                            </span>
                        </span>
                    )}
                </div>

                {/* Entrance Guidance (Desktop) */}
                {place.entranceNotes && (
                    <p className="text-xs text-amber-300/90 font-bold mb-2.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-1.5">
                        <span>🚗</span>
                        <span>{place.entranceNotes}</span>
                    </p>
                )}

                {/* Circle Attribution & "👍 Helpful" Inline Row (Desktop) */}
                {place.isCorrected && (
                    <div className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl border mb-2.5 text-xs ${
                        theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center gap-2 min-w-0">
                            {submitterAvatar ? (
                                <img
                                    src={submitterAvatar}
                                    alt={submitterDisplayName}
                                    className="w-5 h-5 rounded-full object-cover border border-amber-400/60 shadow-sm shrink-0"
                                />
                            ) : (
                                <span className="text-sm shrink-0">⭐</span>
                            )}
                            <span className={`font-bold truncate ${textColor}`}>
                                Verified by <span className="text-amber-400 font-black">{submitterDisplayName}</span>
                            </span>
                            {place.correctedAt && (
                                <span className={`text-[10px] font-medium shrink-0 opacity-70 ${subTextColor}`}>
                                    • {formatRelativeTime(place.correctedAt)}
                                </span>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={handleToggleHelpful}
                            disabled={isUpvoting}
                            className={`px-2.5 py-0.5 rounded-lg border font-bold text-xs flex items-center gap-1 transition-all active:scale-95 cursor-pointer shrink-0 ${
                                hasUpvoted
                                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                                    : theme === 'dark'
                                    ? 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-200'
                                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                            }`}
                            title="Thank the circle member who verified this entrance"
                        >
                            <span>👍</span>
                            <span>{hasUpvoted ? 'Helpful' : 'Helpful'}</span>
                            {localHelpfulCount > 0 && (
                                <span className="text-[10px] font-mono font-black opacity-90">
                                    ({localHelpfulCount})
                                </span>
                            )}
                        </button>
                    </div>
                )}

                {/* Storefront Photo Preview (Desktop) */}
                {place.imageUrl && (
                    <div
                        onClick={() => setIsPhotoLightboxOpen(true)}
                        className="relative rounded-2xl overflow-hidden border border-white/20 shadow-sm mb-3 group cursor-pointer"
                    >
                        <img
                            src={place.imageUrl}
                            alt={place.name}
                            className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <div className="absolute bottom-1.5 left-3 right-3 flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1 drop-shadow">
                                <span>📷</span> Storefront Photo
                            </span>
                            <span className="text-[10px] font-bold text-slate-200 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full">
                                Tap to expand
                            </span>
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
                            {renderAddStopButton()}
                        </div>
                    </div>

                    {/* Multi-Stop Waypoints Drawer (Desktop) */}
                    {renderWaypointManager()}

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
                                                    {route.hasTolls && (
                                                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 shrink-0">
                                                            💳 {route.tollCostEstimate}
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

                {/* Geofence Radius Slider (Only for Saved Circle Places) */}
                {isSaved && onUpdateRadius && (
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
                <div className="flex items-center gap-1.5 mt-2.5">
                    <button
                        onClick={() => onNavigate(routeOptions[selectedRouteIdx] || undefined)}
                        className="flex-[1.5] min-w-fit h-10 px-3.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl font-black text-xs sm:text-sm shadow-md shadow-indigo-600/30 transition-all active:scale-95 flex flex-row items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                        <span className="text-base shrink-0">🚀</span>
                        <span className="whitespace-nowrap">{routeOptions[selectedRouteIdx] ? `Go (${routeOptions[selectedRouteIdx].totalTime})` : 'Go'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsConvoySetupOpen(true)}
                        className="h-10 px-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs shadow-md shadow-purple-600/20 transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap"
                        title="Plan Caravan / Convoy with Circle Members"
                    >
                        <span className="text-sm shrink-0">🚗🚗</span>
                        <span className="whitespace-nowrap">Convoy</span>
                    </button>
                    {onCorrectLocation && (
                        <button
                            type="button"
                            onClick={() => onCorrectLocation(place)}
                            className={`h-10 px-2.5 rounded-xl font-bold text-xs border transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap ${
                                theme === 'dark' ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700'
                            }`}
                            title="Suggest an edit, correct location, or report issue"
                        >
                            <span className="text-sm shrink-0">✏️</span>
                            <span className="whitespace-nowrap">Suggest Edit</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleShare}
                        className={`h-10 px-2.5 rounded-xl font-bold text-xs border transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap ${
                            theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                        title="Share place details"
                    >
                        <span className="text-sm shrink-0">↗️</span>
                        <span className="whitespace-nowrap">Share</span>
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

                {/* Storefront Photo Fullscreen Lightbox Modal */}
                {isPhotoLightboxOpen && place.imageUrl && (
                    <div 
                        onClick={() => setIsPhotoLightboxOpen(false)}
                        className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto cursor-zoom-out"
                    >
                        <div 
                            onClick={(e) => e.stopPropagation()}
                            className="relative max-w-2xl w-full rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black"
                        >
                            <img 
                                src={place.imageUrl} 
                                alt={place.name} 
                                className="w-full max-h-[75vh] object-contain"
                            />
                            <div className="p-4 bg-slate-900/90 flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-black text-white">{place.name}</h4>
                                    <p className="text-xs text-slate-400">Storefront & Entrance Photo</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPhotoLightboxOpen(false)}
                                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
                                >
                                    Close
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
