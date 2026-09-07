
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Place, Location, NavigationRoute, FamilyMember, RouteWaypoint } from '../types';
import { fetchRouteOptions, fetchDetourDeltas } from '../services/osrmService';
import { getDistanceMeters } from '../utils/geo';
import { vehicleFuelService } from '../services/vehicleFuelService';
import { convoyService } from '../services/convoyService';
import { placeCorrectionService } from '../services/placeCorrectionService';
import { publicMapReportService, PublicMapReport } from '../services/publicMapReportService';
import { searchPlacesText, searchGasStations, searchCoffeeShops, searchRestaurants } from '../services/placesService';
import { audioService } from '../services/audioService';
import { placePhotoService, PlacePhotoContribution } from '../services/placePhotoService';
import { hapticSuccess, hapticTick } from '../utils/haptics';
import BrandIcon from './BrandIcon';
import {
    Navigation,
    Car,
    Edit3,
    Share2,
    Star,
    X,
    Plus,
    Trash2,
    Camera,
    AlertCircle,
    Expand,
    ThumbsUp,
    ThumbsDown,
    Check,
    GripVertical,
    CheckCircle2,
    MapPin,
    Fuel,
    CreditCard,
    RefreshCw,
    Zap,
    Leaf,
    TreePine,
    Route,
    Globe,
    Crosshair,
    ShieldCheck,
    Home,
    Briefcase,
    GraduationCap,
    Dumbbell,
    Utensils,
    Coffee,
    Pill,
    DollarSign,
    Flag,
    Battery,
    Loader2,
    Images
} from 'lucide-react';
import SavedPlaceHubCard from './SavedPlaceHubCard';
import ParkedVehicleCard from './ParkedVehicleCard';

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
    userPlaces?: Place[];
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

const GEOFENCE_PRESETS = [
    { label: 'Tight', value: 0.015, meters: '15m' },
    { label: 'Street', value: 0.05, meters: '50m' },
    { label: 'Neighborhood', value: 0.15, meters: '150m' },
    { label: 'City Area', value: 1.0, meters: '1km' },
    { label: 'Metro', value: 2.0, meters: '2km' }
];

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
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                isHorizontalSwipeRef.current = Math.abs(dx) > Math.abs(dy);
            }
        }

        if (isHorizontalSwipeRef.current === true) {
            e.preventDefault();
            if (dx < 0) {
                const resisted = -Math.pow(-dx, 0.88);
                setSwipeOffset(Math.max(-140, resisted));
            } else {
                setSwipeOffset(Math.min(20, dx * 0.2));
            }
        }
    };

    const handleCardTouchEnd = () => {
        setIsSwiping(false);
        if (swipeOffset < -70) {
            hapticSuccess();
            onRemove(wIdx);
        }
        setSwipeOffset(0);
        touchStartRef.current = null;
        isHorizontalSwipeRef.current = null;
    };

    return (
        <div
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
                <Trash2 className="w-4 h-4 text-white shrink-0" />
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
                    {/* Subtle 6-dot drag handle icon */}
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
                        <GripVertical className="w-4 h-4 shrink-0" />
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
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer opacity-80 md:opacity-0 md:group-hover:opacity-100 ${
                            theme === 'dark'
                                ? 'text-red-400 hover:bg-red-500/25 hover:text-red-300 active:scale-90'
                                : 'text-red-500 hover:bg-red-100 hover:text-red-600 active:scale-90'
                        }`}
                        title="Remove Stop"
                    >
                        <X className="w-4 h-4 shrink-0" />
                    </button>
                </div>
            </div>
        </div>
    );
};

interface GlobalRouteCalcCacheEntry {
    destKey: string;
    origin: Location;
    avoidTolls: boolean;
    waypointsKey: string;
    routes: NavigationRoute[];
}
const globalRouteCalcCache = new Map<string, GlobalRouteCalcCacheEntry>();

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
    currentUserId = '',
    userPlaces = []
}) => {
    const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);
    const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
    const subTextColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';

    // Check if the current place is a saved/favorite location (Home, Work, etc.)
    const isSavedLocation = useMemo(() => {
        if (place?.type === 'parked_vehicle' || place?.id === 'temp-parked-vehicle') return false;
        if (isSaved) return true;
        if (place?.isSaved) return true;
        const savedTypes = ['home', 'residential', 'work', 'school', 'gym'];
        if (place?.type && savedTypes.includes(place.type)) return true;
        const nameLower = (place?.name || '').trim().toLowerCase();
        if (['home', 'house', 'work', 'office', 'school', 'gym'].includes(nameLower)) return true;
        if (userPlaces && userPlaces.length > 0) {
            return userPlaces.some(p => 
                p.id === place.id || 
                ((p.name || '').trim().toLowerCase() === nameLower) ||
                (p.location && place.location && Math.abs(p.location.lat - place.location.lat) < 0.0005 && Math.abs(p.location.lng - place.location.lng) < 0.0005)
            );
        }
        return false;
    }, [isSaved, place, userPlaces]);

    // Location Photo Contributions (Firestore & Firebase Storage)
    const [photos, setPhotos] = useState<PlacePhotoContribution[]>([]);
    const [photoUrls, setPhotoUrls] = useState<string[]>(() => {
        return place?.imageUrl ? [place.imageUrl] : [];
    });
    const [activePhotoIndex, setActivePhotoIndex] = useState<number>(0);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);
    const [isManagePhotosOpen, setIsManagePhotosOpen] = useState<boolean>(false);
    const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
    const [editingCaptionText, setEditingCaptionText] = useState<string>('');
    const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);

    // Current user member details for attribution
    const currentUserMember = useMemo(() => {
        return members.find(m => m.id === currentUserId);
    }, [members, currentUserId]);

    const myContributions = useMemo(() => {
        return photos.filter(p => p.userId && p.userId === currentUserId);
    }, [photos, currentUserId]);

    // Fetch photos from Firestore & Storage cache
    useEffect(() => {
        if (!place?.id) return;
        let isMounted = true;
        placePhotoService.getPhotosForPlace(place.id).then((fetched) => {
            if (!isMounted) return;
            setPhotos(fetched);
            const urls = fetched.map(p => p.url);
            if (place.imageUrl && !urls.includes(place.imageUrl)) {
                urls.unshift(place.imageUrl);
            }
            setPhotoUrls(urls);
            setActivePhotoIndex(0);
        });
        return () => {
            isMounted = false;
        };
    }, [place?.id, place?.imageUrl]);

    // Secure Camera Capture Trigger (No File System / Library Access)
    const handleTriggerCamera = () => {
        if (isUploadingPhoto) return;
        cameraInputRef.current?.click();
    };

    const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !place?.id) return;

        setIsUploadingPhoto(true);
        try {
            const newContribution = await placePhotoService.uploadPhotoContribution({
                placeId: place.id,
                placeName: place.name,
                file,
                userId: currentUserId || 'anonymous',
                userName: currentUserMember?.name || 'You',
                userAvatar: currentUserMember?.avatar
            });

            // Instant photo rendering on detail card:
            setPhotoUrls(prev => [newContribution.url, ...prev.filter(u => u !== newContribution.url)]);
            setPhotos(prev => [newContribution, ...prev.filter(p => p.id !== newContribution.id)]);
            setActivePhotoIndex(0);
            place.imageUrl = newContribution.url;
            hapticSuccess();
        } catch (err) {
            console.error('[PlaceDetailPanel] Photo contribution failed:', err);
        } finally {
            setIsUploadingPhoto(false);
            if (cameraInputRef.current) {
                cameraInputRef.current.value = '';
            }
        }
    };

    const handleStartEditCaption = (photo: PlacePhotoContribution) => {
        setEditingCaptionId(photo.id);
        setEditingCaptionText(photo.caption || '');
    };

    const handleSaveCaption = async (photo: PlacePhotoContribution) => {
        try {
            await placePhotoService.updatePhotoCaption(photo.id, place.id, editingCaptionText.trim());
            setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, caption: editingCaptionText.trim() } : p));
            setEditingCaptionId(null);
            hapticTick();
        } catch (err) {
            console.error('[PlaceDetailPanel] Failed to update caption:', err);
        }
    };

    const handleDeletePhoto = async (photo: PlacePhotoContribution) => {
        if (!window.confirm('Delete this photo contribution? This cannot be undone.')) return;
        setDeletingPhotoId(photo.id);
        try {
            await placePhotoService.deletePhotoContribution(photo);
            setPhotos(prev => prev.filter(p => p.id !== photo.id));
            setPhotoUrls(prev => {
                const next = prev.filter(u => u !== photo.url);
                if (place.imageUrl === photo.url) {
                    place.imageUrl = next[0] || undefined;
                }
                return next;
            });
            hapticSuccess();
        } catch (err) {
            console.error('[PlaceDetailPanel] Failed to delete photo:', err);
        } finally {
            setDeletingPhotoId(null);
        }
    };

    const renderPhotoSection = (isMobileView: boolean) => {
        const hasPhotos = photoUrls.length > 0;
        const currentUrl = hasPhotos ? (photoUrls[activePhotoIndex] || photoUrls[0]) : null;
        const currentPhotoObj = photos.find(p => p.url === currentUrl);

        return (
            <div className={`mt-1.5 mb-2 landscape:mt-1 landscape:mb-1.5 select-none ${isMobileView ? '' : 'mb-2.5'}`}>
                {hasPhotos && currentUrl ? (
                    <div
                        className={`relative rounded-xl border p-1.5 sm:p-2 landscape:p-1.5 flex items-center justify-between gap-2.5 landscape:gap-1.5 transition-all shadow-xs ${
                            theme === 'dark'
                                ? 'bg-white/5 border-white/10 hover:border-white/20'
                                : 'bg-slate-50/90 border-slate-200 hover:border-slate-300'
                        }`}
                    >
                        {/* Small square thumbnail with lightbox trigger */}
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setIsPhotoLightboxOpen(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsPhotoLightboxOpen(true);
                                }
                            }}
                            className="relative w-10 h-10 sm:w-11 sm:h-11 landscape:w-8 landscape:h-8 rounded-lg overflow-hidden shrink-0 border border-black/10 dark:border-white/15 cursor-pointer group shadow-sm"
                            title="Tap thumbnail to view photo"
                        >
                            <img
                                src={currentUrl}
                                alt={place.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Expand className="w-3 h-3 text-white drop-shadow" />
                            </div>
                            {photoUrls.length > 1 && (
                                <span className="absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded bg-black/75 text-white backdrop-blur-xs leading-tight">
                                    {photoUrls.length}
                                </span>
                            )}
                        </div>

                        {/* Text label alongside thumbnail */}
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setIsPhotoLightboxOpen(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsPhotoLightboxOpen(true);
                                }
                            }}
                            className="min-w-0 flex-1 cursor-pointer"
                            title="Tap to view photo"
                        >
                            <div className="flex items-center gap-1.5">
                                <Camera className="w-3 h-3 text-emerald-400 shrink-0" />
                                <span className={`text-xs landscape:text-[11px] font-bold truncate ${textColor}`}>
                                    Building & Access
                                </span>
                            </div>
                            <p className="text-[10px] landscape:text-[9px] text-slate-400 font-medium truncate mt-0.5">
                                {currentPhotoObj?.caption ? (
                                    `"${currentPhotoObj.caption}"`
                                ) : photoUrls.length > 1 ? (
                                    `${photoUrls.length} photos • Tap to preview`
                                ) : currentPhotoObj?.userName ? (
                                    `By ${currentPhotoObj.userName}`
                                ) : (
                                    'Tap thumbnail to view'
                                )}
                            </p>
                        </div>

                        {/* Actions: Add Photo & Discrete Edit Icon */}
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={handleTriggerCamera}
                                disabled={isUploadingPhoto}
                                className={`px-2 py-1 sm:px-2.5 sm:py-1 rounded-lg font-bold text-[10px] flex items-center gap-1 transition-all active:scale-95 cursor-pointer disabled:opacity-50 shrink-0 ${
                                    theme === 'dark'
                                        ? 'bg-white/10 hover:bg-white/15 text-slate-200 border border-white/10'
                                        : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-xs'
                                }`}
                                title="Snap another building photo"
                            >
                                {isUploadingPhoto ? (
                                    <Loader2 className="w-3 h-3 animate-spin shrink-0 text-cyan-400" />
                                ) : (
                                    <Camera className="w-3 h-3 shrink-0 text-cyan-400" />
                                )}
                                <span>{isUploadingPhoto ? 'Uploading...' : 'Snap Photo'}</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setIsManagePhotosOpen(true)}
                                className={`p-1.5 rounded-lg border transition-all active:scale-95 cursor-pointer shrink-0 ${
                                    myContributions.length > 0
                                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                        : theme === 'dark'
                                        ? 'border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white'
                                        : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-800'
                                }`}
                                title={myContributions.length > 0 ? `Manage photos (${myContributions.length})` : 'Manage photos'}
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Clean single button row taking minimal height */
                    <button
                        type="button"
                        onClick={handleTriggerCamera}
                        disabled={isUploadingPhoto}
                        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border transition-all active:scale-[0.99] cursor-pointer group disabled:opacity-50 ${
                            theme === 'dark'
                                ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-200 hover:text-white'
                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900'
                        }`}
                        title="Add Building Photo"
                    >
                        <div
                            className={`p-1 rounded-md shrink-0 ${
                                theme === 'dark' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'
                            }`}
                        >
                            {isUploadingPhoto ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Camera className="w-3.5 h-3.5" />
                            )}
                        </div>
                        <span className="text-xs font-semibold truncate">
                            {isUploadingPhoto ? 'Uploading Photo...' : 'Add Building Photo'}
                        </span>
                    </button>
                )}
            </div>
        );
    };

    // Submitter Attribution & "Helpful" / "Not there" Voting state
    const [isVoting, setIsVoting] = useState(false);
    const [hasDownvoted, setHasDownvoted] = useState(false);
    const [localHelpfulCount, setLocalHelpfulCount] = useState(place?.helpfulCount || 0);
    const [hasUpvoted, setHasUpvoted] = useState(() => {
        return Array.isArray(place?.helpfulUserIds) && currentUserId ? place.helpfulUserIds.includes(currentUserId) : false;
    });

    // Look up crowdsourced public map report for this place
    const [publicReport, setPublicReport] = useState<PublicMapReport | null>(() => {
        return publicMapReportService.getReportForPlace(place);
    });

    useEffect(() => {
        setPublicReport(publicMapReportService.getReportForPlace(place));
        const unsub = publicMapReportService.subscribe(() => {
            setPublicReport(publicMapReportService.getReportForPlace(place));
        });
        return unsub;
    }, [place?.id, place?.name]);

    useEffect(() => {
        setLocalHelpfulCount(place?.helpfulCount || 0);
        setHasUpvoted(Array.isArray(place?.helpfulUserIds) && currentUserId ? place.helpfulUserIds.includes(currentUserId) : false);
    }, [place?.id, place?.helpfulCount, place?.helpfulUserIds, currentUserId]);

    const isVerified = Boolean(place?.isCommunityVerified || place?.isCorrected || publicReport);
    const hasPrecisionPin = Boolean(
        place?.isCommunityVerified ||
        place?.isCorrected ||
        publicReport ||
        place?.tags?.includes('Verified Precision Pin') ||
        (place as any)?.isPrecisionPin
    );

    const isPrivatePlace = useMemo(() => {
        if (!place) return false;
        if (isSaved) return true;
        if (place.category === 'home' || place.icon === 'home' || place.name?.toLowerCase().includes('home')) return true;
        if (place.tags?.includes('home') || place.tags?.includes('private')) return true;
        if (place.visibility === 'private' || (place as any)?.isPrivate) return true;
        if (userPlaces && userPlaces.some(p => p.id === place.id || (p.location?.lat === place.location?.lat && p.location?.lng === place.location?.lng))) return true;
        return false;
    }, [place, isSaved, userPlaces]);

    const isPrecisionNotes = Boolean(
        place?.entranceNotes && (
            place.entranceNotes.toLowerCase().includes('precision front door') ||
            place.entranceNotes.toLowerCase().includes('driveway routing pin') ||
            place.entranceNotes.toLowerCase().includes('precision pin')
        )
    );

    const trustScore = useMemo(() => {
        if (publicReport?.trustScore !== undefined) return publicReport.trustScore;
        return (localHelpfulCount ? localHelpfulCount + 1 : 1);
    }, [publicReport?.trustScore, localHelpfulCount]);

    const isCommunityReport = useMemo(() => {
        if (place?.visibility === 'public') return true;
        if (publicReport && publicReport.visibility === 'public') return true;
        if (place?.submitterName === 'MyWay Community') return true;
        return false;
    }, [place?.visibility, publicReport, place?.submitterName]);

    const submitterMember = useMemo(() => {
        if (!place?.submitterId || !members.length) return null;
        return members.find(m => m.id === place.submitterId) || null;
    }, [place?.submitterId, members]);

    const submitterDisplayName = useMemo(() => {
        // Enforce anonymous community branding for public reports
        if (isCommunityReport) return 'MyWay Community';
        if (place?.submitterId && currentUserId && place.submitterId === currentUserId) return 'You';
        if (submitterMember?.name) return submitterMember.name;
        return place?.submitterName || 'MyWay Community';
    }, [isCommunityReport, place?.submitterId, currentUserId, submitterMember, place?.submitterName]);

    const submitterAvatar = useMemo(() => {
        if (isCommunityReport) return null; // Anonymize avatar for public reports
        return submitterMember?.avatar || place?.submitterAvatar || null;
    }, [isCommunityReport, submitterMember, place?.submitterAvatar]);

    const handleToggleHelpful = async () => {
        if (!place || isVoting) return;
        setIsVoting(true);
        try {
            hapticSuccess();
            if (publicReport) {
                const updated = await publicMapReportService.voteReport(publicReport.id, currentUserId || 'driver', 'up');
                if (updated) setPublicReport(updated);
            }
            const nextCount = await placeCorrectionService.toggleHelpful(place, currentUserId || 'driver');
            setLocalHelpfulCount(nextCount);
            setHasUpvoted(true);
            setHasDownvoted(false);
        } catch (err) {
            console.error('Failed to toggle helpful upvote:', err);
        } finally {
            setIsVoting(false);
        }
    };

    const handleDownvote = async () => {
        if (!place || isVoting) return;
        setIsVoting(true);
        try {
            hapticTick();
            if (publicReport) {
                const updated = await publicMapReportService.voteReport(publicReport.id, currentUserId || 'driver', 'down');
                if (updated) setPublicReport(updated);
            } else {
                setLocalHelpfulCount(prev => Math.max(0, prev - 1));
            }
            setHasDownvoted(true);
            setHasUpvoted(false);
        } catch (err) {
            console.error('Failed to submit downvote:', err);
        } finally {
            setIsVoting(false);
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
    const [newPlaceRadius, setNewPlaceRadius] = useState<number>(() => {
        if (!place.radius) return 0.05;
        return place.radius > 5 ? place.radius / 1000 : place.radius;
    });

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
    const [isStopSearchFocused, setIsStopSearchFocused] = useState<boolean>(false);
    const [isSearchingStops, setIsSearchingStops] = useState<boolean>(false);
    const [stopSearchResults, setStopSearchResults] = useState<Place[]>([]);
    const [detourDeltas, setDetourDeltas] = useState<Map<number, number>>(new Map());

    const activeVehicle = useMemo(() => vehicleFuelService.getActiveVehicle(), []);

    const lastCalculatedParamsRef = useRef<{
        destKey: string;
        origin: Location;
        avoidTolls: boolean;
        waypointsKey: string;
    } | null>(null);
    const isCalculatingRoutesRef = useRef(false);
    const lastPreviewedRouteIdRef = useRef<string>('');
    const isComponentAliveRef = useRef(true);
    const activeRequestIdRef = useRef(0);
    const [retryTrigger, setRetryTrigger] = useState(0);

    // Track component mounting lifecycle to prevent setting state on unmounted component
    useEffect(() => {
        isComponentAliveRef.current = true;
        return () => {
            isComponentAliveRef.current = false;
        };
    }, []);

    // Manual retry handler to re-trigger route calculation
    const handleRetryRoutes = useCallback(() => {
        lastCalculatedParamsRef.current = null;
        isCalculatingRoutesRef.current = false;
        setRouteOptions([]);
        setIsLoadingRoutes(true);
        setRetryTrigger(prev => prev + 1);
    }, []);

    // Reset waypoints and cached calculation when destination place changes
    useEffect(() => {
        setWaypoints([]);
        setShowAddStopDrawer(false);
        setStopSearchQuery('');
        setStopSearchResults([]);
        lastCalculatedParamsRef.current = null;
        setRouteOptions([]);
        setIsLoadingRoutes(true);
    }, [place.id, place.name, place.location?.lat, place.location?.lng]);

    // Safety watchdog: ensure loader never remains permanently stuck if network promise hangs
    useEffect(() => {
        if (!isLoadingRoutes) return;
        const timer = setTimeout(() => {
            if (isComponentAliveRef.current && isLoadingRoutes) {
                console.warn('⚠️ [PlaceDetailPanel] Route calculation watchdog timed out after 8s - resetting loader');
                setIsLoadingRoutes(false);
                isCalculatingRoutesRef.current = false;
            }
        }, 8000);
        return () => clearTimeout(timer);
    }, [isLoadingRoutes]);

    useEffect(() => {
        if (!userLocation || !place.location) {
            setIsLoadingRoutes(false);
            return;
        }

        const destKey = `${place.id || place.name}_${place.location.lat.toFixed(5)}_${place.location.lng.toFixed(5)}`;
        const waypointsKey = waypoints.map(w => `${w.id}_${w.location.lat.toFixed(5)}_${w.location.lng.toFixed(5)}`).join('|');
        const cached = globalRouteCalcCache.get(destKey);
        const lastParams = lastCalculatedParamsRef.current || cached;

        // Check if destination, tolls setting, or waypoints changed
        const isParamChange = !lastParams || 
            lastParams.destKey !== destKey || 
            lastParams.avoidTolls !== avoidTolls || 
            lastParams.waypointsKey !== waypointsKey;

        // Check if user has moved significantly (> 100 meters) from the origin where routes were calculated
        const hasMovedSignificantly = !lastParams || 
            getDistanceMeters(lastParams.origin, userLocation) > 100;

        // If neither parameters changed nor significant movement occurred, skip recalculation to prevent flicker
        if (!isParamChange && !hasMovedSignificantly) {
            if (cached && routeOptions.length === 0) {
                setRouteOptions(cached.routes);
                setIsLoadingRoutes(false);
            }
            return;
        }

        // Prevent redundant concurrent in-flight fetches for the same request
        if (isCalculatingRoutesRef.current && !isParamChange) {
            return;
        }

        const requestId = ++activeRequestIdRef.current;
        isCalculatingRoutesRef.current = true;

        // Non-destructive loading: only show the full loading placeholder if we have no routes yet.
        // If routes already exist on screen, keep them visible so the user can see & tap them without flickering!
        if (routeOptions.length === 0 || isParamChange) {
            setIsLoadingRoutes(true);
        }

        lastCalculatedParamsRef.current = {
            destKey,
            origin: { ...userLocation },
            avoidTolls,
            waypointsKey
        };

        fetchRouteOptions(userLocation, place.name || 'Destination', place.location, { avoidTolls, waypoints })
            .then(routes => {
                globalRouteCalcCache.set(destKey, {
                    destKey,
                    origin: { ...userLocation },
                    avoidTolls,
                    waypointsKey,
                    routes
                });
                // Ensure state only updates if the component is still mounted and this is the latest in-flight request
                if (isComponentAliveRef.current && activeRequestIdRef.current === requestId) {
                    setRouteOptions(routes);
                    setIsLoadingRoutes(false);
                    isCalculatingRoutesRef.current = false;

                    // Preserve selected route index if still valid
                    setSelectedRouteIdx(prevIdx => (prevIdx >= 0 && prevIdx < routes.length ? prevIdx : 0));

                    if (routes.length > 0 && onSelectRoutePreview) {
                        const targetRoute = routes[0];
                        const routeKey = `${targetRoute.id || targetRoute.summary}_${targetRoute.totalDistance}`;
                        if (lastPreviewedRouteIdRef.current !== routeKey) {
                            lastPreviewedRouteIdRef.current = routeKey;
                            onSelectRoutePreview(targetRoute);
                        }
                    }
                }
            })
            .catch(() => {
                if (isComponentAliveRef.current && activeRequestIdRef.current === requestId) {
                    setIsLoadingRoutes(false);
                    isCalculatingRoutesRef.current = false;
                }
            });
    }, [place.name, place.id, place.location?.lat, place.location?.lng, userLocation?.lat, userLocation?.lng, avoidTolls, waypoints, onSelectRoutePreview, retryTrigger]);

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
        setNewPlaceRadius(place.radius ? (place.radius > 5 ? place.radius / 1000 : place.radius) : 0.05);
        if (place.type && place.type !== 'search_result' && place.type !== 'sponsored') {
            setNewPlaceType(place.type as any);
        } else {
            setNewPlaceType('other');
        }
        setIsSavingPlace(false);
    }, [place]);

    const distance = formatDistanceFromUser(userLocation, place.location);
    const canCorrectPin = true; // Anyone can suggest edits or report issues for any place (Community-driven)

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
            case 'gas': return 'Gas Station';
            case 'fire_station': return 'Fire Station';
            case 'hospital': case 'emergency': return 'Hospital / ER';
            case 'police': return 'Police Dept';
            case 'grocery': return 'Supermarket';
            case 'pharmacy': return 'Pharmacy';
            case 'food': return 'Food & Dining';
            case 'coffee': return 'Coffee';
            case 'home': return 'Home';
            case 'work': return 'Work';
            case 'school': return 'School';
            case 'gym': return 'Gym';
            case 'maintenance': case 'mechanic': return 'Auto Service';
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
    const bgColor = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10 text-white' : 'bg-[#fdfbf7]/95 border-slate-200/80 shadow-2xl text-slate-900';

    if (isSavingPlace) {
        return (
            <div
                className={`w-full max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden rounded-t-[2.5rem] sm:rounded-[2rem] shadow-[0_10px_50px_rgba(0,0,0,0.5)] border backdrop-blur-2xl animate-in fade-in duration-200 ${bgColor}`}
            >
                {/* Mobile Drag Handle Pill */}
                {isMobile && (
                    <div 
                        className="pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0 flex justify-center"
                        onClick={() => setIsSavingPlace(false)}
                    >
                        <div className={`w-12 h-1.5 rounded-full mx-auto ${theme === 'dark' ? 'bg-white/20 hover:bg-white/30' : 'bg-slate-300 hover:bg-slate-400'}`} />
                    </div>
                )}
                <div className="flex justify-between items-center px-6 pt-3 pb-3 border-b border-white/10 shrink-0">
                    <h3 className={`text-base font-black uppercase tracking-wider ${textColor}`}>Save to Circle</h3>
                    <button
                        type="button"
                        onClick={() => setIsSavingPlace(false)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                            theme === 'dark' ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 shrink-0" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-4 no-scrollbar">
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
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Category & Icon</label>
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { type: 'home', icon: '🏠', iconComp: Home, label: 'Home' },
                                { type: 'work', icon: '💼', iconComp: Briefcase, label: 'Work' },
                                { type: 'school', icon: '🏫', iconComp: GraduationCap, label: 'School' },
                                { type: 'gym', icon: '🏋️', iconComp: Dumbbell, label: 'Gym' },
                                { type: 'food', icon: '🍔', iconComp: Utensils, label: 'Food' },
                                { type: 'coffee', icon: '☕', iconComp: Coffee, label: 'Coffee' },
                                { type: 'gas', icon: '⛽', iconComp: Fuel, label: 'Gas' },
                                { type: 'other', icon: '📍', iconComp: MapPin, label: 'Other' },
                            ].map((item) => {
                                const IconComp = item.iconComp;
                                const isSelected = newPlaceType === item.type;
                                return (
                                    <button
                                        key={item.type}
                                        type="button"
                                        onClick={() => {
                                            setNewPlaceType(item.type as any);
                                            setNewPlaceIcon(item.icon);
                                        }}
                                        className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 group ${
                                            isSelected
                                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                                                : theme === 'dark'
                                                    ? 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/10'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                        }`}
                                    >
                                        <IconComp className={`w-6 h-6 shrink-0 transition-colors ${
                                            isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-400'
                                        }`} />
                                        <span className={`text-[11px] font-bold tracking-tight ${isSelected ? 'text-white' : 'text-slate-400'}`}>
                                            {item.label}
                                        </span>
                                    </button>
                                );
                            })}
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

                        {/* Quick-Preset Radius Chips */}
                        <div className="flex flex-row overflow-x-auto gap-2 mb-3 pb-0.5 scrollbar-none">
                            {GEOFENCE_PRESETS.map((preset) => {
                                const isActive = Math.round(newPlaceRadius * 1000) === Math.round(preset.value * 1000);
                                return (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => setNewPlaceRadius(preset.value)}
                                        className={`px-2.5 py-1 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all flex items-center gap-1 cursor-pointer shrink-0 border ${
                                            isActive
                                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/40'
                                                : theme === 'dark'
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
                            value={newPlaceRadius}
                            onChange={(e) => setNewPlaceRadius(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-indigo-500/30 rounded-lg appearance-none cursor-pointer accent-indigo-600 outline-none"
                        />
                        <div className="flex justify-between text-[8px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">
                            <span>15m (Tight)</span>
                            <span>1km</span>
                            <span>2km</span>
                        </div>
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-white/10 shrink-0 pb-[max(env(safe-area-inset-bottom,16px),16px)] sm:pb-2">
                        <button
                            onClick={() => {
                                if (onAddPlace && newPlaceName.trim()) {
                                    onAddPlace({
                                        name: newPlaceName.trim(),
                                        icon: newPlaceIcon,
                                        location: place.location,
                                        radius: newPlaceRadius,
                                        departureRadius: Math.round(newPlaceRadius * 1000),
                                        type: newPlaceType,
                                        description: place.description || place.name
                                    });
                                    setIsSavingPlace(false);
                                }
                            }}
                            className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm shadow-md transition-all active:scale-95 cursor-pointer"
                        >
                            Save Place
                        </button>
                        <button
                            onClick={() => setIsSavingPlace(false)}
                            className={`px-5 py-3.5 rounded-xl border font-bold text-sm transition-all active:scale-95 cursor-pointer ${
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
                    : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 shadow-2xs'
            }`}
            title="Add Stop / Waypoint along route"
        >
            <Plus className="w-3 h-3 shrink-0" />
            <span>{waypoints.length > 0 ? `${waypoints.length} Stop${waypoints.length > 1 ? 's' : ''}` : 'Add Stop'}</span>
        </button>
    );

    const renderWaypointManager = () => {
        if (waypoints.length === 0 && !showAddStopDrawer) return null;

        return (
            <div className={`mx-2.5 mb-2 p-3 rounded-2xl border transition-all animate-in fade-in duration-200 ${
                theme === 'dark' ? 'bg-black/40 border-white/10' : 'bg-white border-slate-200 shadow-2xs'
            }`}>
                <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Trip Stops ({waypoints.length + 1})</span>
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
                                <Trash2 className="w-3 h-3 text-red-400 shrink-0" />
                                <span>Clear All</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowAddStopDrawer(prev => !prev)}
                            className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer px-2 py-0.5 rounded-full border border-sky-500/30 hover:bg-sky-500/20 transition-all"
                        >
                            {showAddStopDrawer ? (
                                <>
                                    <X className="w-3 h-3 shrink-0" />
                                    <span>Close</span>
                                </>
                            ) : (
                                <>
                                    <Plus className="w-3 h-3 shrink-0" />
                                    <span>Add Stop</span>
                                </>
                            )}
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
                                <Flag className="w-3.5 h-3.5 text-black shrink-0" />
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
                                { iconComp: Fuel, label: 'Gas', query: 'gas station' },
                                { iconComp: Coffee, label: 'Coffee', query: 'coffee' },
                                { iconComp: Utensils, label: 'Food', query: 'fast food restaurant' },
                                { iconComp: Pill, label: 'Pharmacy', query: 'pharmacy' },
                                { iconComp: DollarSign, label: 'ATM', query: 'atm' }
                            ].map(chip => {
                                const ChipIcon = chip.iconComp;
                                return (
                                    <button
                                        key={chip.query}
                                        type="button"
                                        onClick={() => handleQuickPoiSearch(chip.query)}
                                        className="px-2 sm:px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/10 hover:bg-amber-500/20 text-slate-200 shrink-0 border border-white/10 hover:border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1"
                                        title={chip.label}
                                    >
                                        <ChipIcon className="w-3 h-3 text-amber-400 shrink-0" />
                                        <span className={isStopSearchFocused ? 'hidden min-[420px]:inline' : 'hidden min-[376px]:inline'}>
                                            {chip.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Search Input Box */}
                        <div className="relative">
                            <input
                                type="text"
                                value={stopSearchQuery}
                                onFocus={() => setIsStopSearchFocused(true)}
                                onBlur={() => setIsStopSearchFocused(false)}
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
                                <RefreshCw className="absolute right-3 top-2.5 w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
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
                                            <span className="text-[10px] text-amber-400 font-extrabold shrink-0 ml-2 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center gap-1">
                                                <Plus className="w-2.5 h-2.5 shrink-0" />
                                                <span>Add</span>
                                            </span>
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
    // PARKED VEHICLE CARD (MOBILE & DESKTOP)
    // ──────────────────────────────────────────
    const isParkedVehicle = place?.type === 'parked_vehicle' || place?.id === 'temp-parked-vehicle';
    if (isParkedVehicle) {
        return (
            <ParkedVehicleCard
                place={place as any}
                onClose={onClose}
                onNavigate={() => onNavigate(routeOptions[0])}
                theme={theme}
                userLocation={userLocation}
                isMobile={isMobile}
            />
        );
    }

    // ──────────────────────────────────────────
    // MOBILE BOTTOM SHEET LAYOUT
    // ──────────────────────────────────────────
    if (isMobile) {
        if (isSavedLocation) {
            return (
                <SavedPlaceHubCard
                    place={place}
                    onClose={onClose}
                    onNavigate={onNavigate}
                    theme={theme}
                    userLocation={userLocation}
                    isMobile={true}
                    onEditPlace={onEditPlace}
                    members={members}
                    currentUserId={currentUserId}
                    routeOptions={routeOptions}
                    selectedRouteIdx={selectedRouteIdx}
                    onSelectRoutePreview={onSelectRoutePreview}
                    isLoadingRoutes={isLoadingRoutes}
                    userPlaces={userPlaces}
                />
            );
        }

        const sheetBg = theme === 'dark'
            ? 'bg-[#0f172a]/98 border-white/10 text-white'
            : 'bg-[#fdfbf7]/98 border-slate-200/80 shadow-2xl text-slate-900';

        return (
            <div
                className={`w-full max-h-[85vh] sm:max-h-[90vh] landscape:top-16 landscape:bottom-4 landscape:max-h-[calc(100dvh-5.5rem)] landscape:sm:max-h-[calc(100dvh-5.5rem)] landscape:my-auto flex flex-col overflow-hidden rounded-t-[2.5rem] landscape:rounded-[2rem] shadow-[0_-10px_50px_rgba(0,0,0,0.5)] border-t landscape:border backdrop-blur-2xl animate-in slide-in-from-bottom landscape:slide-in-from-left duration-300 pb-[max(env(safe-area-inset-bottom,10px),10px)] landscape:pb-0 opacity-100 pointer-events-auto ${sheetBg}`}
            >
                {/* Drag Handle Pill */}
                <div 
                    className="pt-2.5 pb-1 landscape:pt-1.5 landscape:pb-0.5 cursor-grab active:cursor-grabbing flex justify-center shrink-0"
                    onClick={onClose}
                    onTouchStart={() => (document.activeElement as HTMLElement)?.blur()}
                    onMouseDown={() => (document.activeElement as HTMLElement)?.blur()}
                >
                    <div className={`w-12 h-1.5 landscape:w-8 landscape:h-1 rounded-full mx-auto transition-colors ${theme === 'dark' ? 'bg-white/20 hover:bg-white/30' : 'bg-slate-300 hover:bg-slate-400'}`} />
                </div>

                {/* Content - Scrollable */}
                <div 
                    className="flex-1 overflow-y-auto overscroll-contain no-scrollbar px-4 pb-4 pt-1 landscape:px-3 landscape:pb-2.5 landscape:pt-0.5 flex flex-col"
                    onScroll={() => (document.activeElement as HTMLElement)?.blur()}
                    onTouchMove={() => (document.activeElement as HTMLElement)?.blur()}
                >
                    {/* Top Row: Icon + Info + Close */}
                    <div className="flex items-start gap-3.5 landscape:gap-2.5">
                        {/* Place Icon */}
                        <div className="shrink-0 scale-100 landscape:scale-90 origin-top-left">
                            <BrandIcon placeName={place.name} defaultIcon={place.icon} size="xl" className="shadow-lg" />
                        </div>

                        {/* Place Info */}
                        <div className="flex-1 min-w-0">
                            <h3 className={`text-lg landscape:text-base font-black leading-tight truncate ${textColor}`}>{place.name}</h3>

                            {addressSubtitle && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5 landscape:mt-0">
                                    <p className={`text-xs landscape:text-[11px] leading-snug flex items-start gap-1 ${subTextColor}`}>
                                        <svg className="w-3 h-3 mt-0.5 shrink-0 opacity-60" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                                        <span className="line-clamp-2 landscape:line-clamp-1">{addressSubtitle}</span>
                                    </p>
                                    {place.isCommunityVerified && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] landscape:text-[8px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                                            <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                            <span>📍 Community Verified</span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {!addressSubtitle && place.isCommunityVerified && (
                                <div className="mt-1 landscape:mt-0.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] landscape:text-[8px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                                        <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                        <span>📍 Community Verified</span>
                                    </span>
                                </div>
                            )}

                            {/* Tags Row */}
                            <div className="flex flex-row flex-wrap items-center gap-1.5 sm:gap-2 mt-1.5 landscape:mt-1">
                                {place.isCommunityVerified && (
                                    <span className="text-[9px] landscape:text-[8px] font-black uppercase tracking-wider px-2.5 landscape:px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                                        <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                        <span>Community Verified Pin</span>
                                    </span>
                                )}
                                {typeLabel && (
                                    <span className={`text-[9px] landscape:text-[8px] font-bold uppercase tracking-widest px-2 landscape:px-1.5 py-0.5 rounded-full ${tagColor}`}>
                                        {typeLabel}
                                    </span>
                                )}
                                {distance && (
                                    <span className={`text-[9px] landscape:text-[8px] font-bold uppercase tracking-widest px-2 landscape:px-1.5 py-0.5 rounded-full flex items-center gap-1 ${theme === 'dark' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                                        <Navigation className="w-2.5 h-2.5 shrink-0" />
                                        <span>{distance}</span>
                                    </span>
                                )}
                                {hasPrecisionPin && (
                                    <span className="text-[9px] landscape:text-[8px] font-black uppercase tracking-wider px-2.5 landscape:px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                                        <Crosshair className="w-3 h-3 text-amber-400 shrink-0" />
                                        <span>Precision Routing Pin</span>
                                    </span>
                                )}
                                {!isPrivatePlace && isVerified && (
                                    <span className="text-[9px] landscape:text-[8px] font-black uppercase tracking-widest px-2.5 landscape:px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40 flex items-center gap-1">
                                        <ShieldCheck className="w-3 h-3 text-amber-400 shrink-0" />
                                        <span>Trust: {trustScore}</span>
                                    </span>
                                )}
                            </div>

                            {/* Entrance Notes (if present and not redundant default precision pin note) */}
                            {place.entranceNotes && !isPrecisionNotes && (
                                <p className="text-[10px] landscape:text-[9px] text-amber-300/90 font-bold mt-1 px-2 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-1.5">
                                    <Car className="w-3 h-3 shrink-0 text-amber-400" />
                                    <span className="truncate">{place.entranceNotes}</span>
                                </p>
                            )}

                            {/* Crowdsourced Verification & Voting Row (Mobile - Hidden for private places) */}
                            {!isPrivatePlace && isVerified && (
                                <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border mt-1.5 text-[10px] ${
                                    theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                                }`}>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {submitterAvatar && !isCommunityReport ? (
                                            <img
                                                src={submitterAvatar}
                                                alt={submitterDisplayName}
                                                className="w-4 h-4 rounded-full object-cover border border-amber-400/60 shrink-0"
                                            />
                                        ) : (
                                            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        )}
                                        <span className={`font-bold truncate ${textColor}`}>
                                            Reported by <span className="text-amber-400 font-black">{isCommunityReport ? 'MyWay Community' : submitterDisplayName}</span>
                                        </span>
                                        {place.correctedAt && (
                                            <span className={`text-[9px] font-medium shrink-0 opacity-70 ${subTextColor}`}>
                                                • {formatRelativeTime(place.correctedAt)}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                                        <button
                                            type="button"
                                            onClick={handleToggleHelpful}
                                            disabled={isVoting}
                                            className={`px-2.5 py-1 rounded-lg border font-bold text-[9px] flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                                                hasUpvoted
                                                    ? 'bg-emerald-500/25 border-emerald-400/70 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                                                    : theme === 'dark'
                                                    ? 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-200'
                                                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                            }`}
                                            title="Confirm location is accurate and helpful"
                                        >
                                            <ThumbsUp className="w-3 h-3 shrink-0" />
                                            <span>Helpful</span>
                                            {trustScore > 0 && (
                                                <span className="text-[8px] font-mono font-black opacity-90">
                                                    ({trustScore})
                                                </span>
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={handleDownvote}
                                            disabled={isVoting}
                                            className={`px-2.5 py-1 rounded-lg border font-bold text-[9px] flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                                                hasDownvoted
                                                    ? 'bg-rose-500/25 border-rose-400/70 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                                    : theme === 'dark'
                                                    ? 'bg-white/5 hover:bg-white/10 border-white/15 text-slate-400'
                                                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-600'
                                            }`}
                                            title="Report location is incorrect or not there"
                                        >
                                            <ThumbsDown className="w-3 h-3 shrink-0" />
                                            <span>Not there</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Location Photo Contributions & Gallery (Mobile) */}
                            {renderPhotoSection(true)}
                        </div>

                        {/* Edit Place Button (Only for Saved Places) */}
                        {isSaved && onEditPlace && (
                            <button
                                type="button"
                                onClick={() => onEditPlace(place)}
                                className={`p-2 landscape:p-1.5 rounded-full shrink-0 transition-all flex items-center justify-center cursor-pointer ${
                                    theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                }`}
                                title="Edit Place & Geofence"
                            >
                                <Edit3 className="w-4 h-4 landscape:w-3.5 landscape:h-3.5 shrink-0" />
                            </button>
                        )}

                        <button
                            onClick={() => {
                                if (isSaved) {
                                    const savedMatch = userPlaces?.find(p => p.id === place.id || (
                                        p.location && place.location &&
                                        Math.abs(p.location.lat - place.location.lat) < 0.001 &&
                                        Math.abs(p.location.lng - place.location.lng) < 0.001
                                    ));
                                    const idToDelete = savedMatch?.id || place.id;
                                    if (onDeletePlace) onDeletePlace(idToDelete);
                                } else {
                                    setIsSavingPlace(true);
                                }
                            }}
                            className={`p-2 landscape:p-1.5 rounded-full shrink-0 transition-all flex items-center justify-center cursor-pointer ${
                                isSaved
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                                    : theme === 'dark'
                                    ? 'bg-white/10 hover:bg-white/20 text-white'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                            title={isSaved ? "Remove from Saved Places" : "Save Place"}
                        >
                            <Star className={`w-4 h-4 landscape:w-3.5 landscape:h-3.5 shrink-0 ${isSaved ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
                        </button>

                        {/* Close Button */}
                        <button
                            type="button"
                            onClick={onClose}
                            className={`w-9 h-9 landscape:w-7 landscape:h-7 rounded-full shrink-0 transition-all flex items-center justify-center cursor-pointer ${theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                            title="Close"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5 landscape:w-4 landscape:h-4 shrink-0" />
                        </button>
                    </div>

                    {/* Single Contiguous Trip-Planning & Route Choices Container (Mobile) */}
                    <div className={`mt-2.5 landscape:mt-1.5 mb-2 landscape:mb-1 rounded-2xl sm:rounded-3xl border transition-all overflow-hidden ${
                        theme === 'dark'
                            ? 'bg-slate-900/90 border-white/10 shadow-inner'
                            : 'bg-slate-50 border-slate-200 shadow-xs'
                    }`}>
                        {/* Route Choices Header & Filter Toolbar */}
                        <div className="p-2.5 pb-2 landscape:p-2 landscape:pb-1 flex items-center justify-between gap-1.5 flex-wrap">
                            <div className="flex items-center gap-1.5">
                                <span className={`text-[10px] landscape:text-[9px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                    Route Choices {routeOptions.length > 1 ? `(${routeOptions.length})` : ''}
                                </span>
                                {isLoadingRoutes && routeOptions.length > 0 && (
                                    <RefreshCw className="w-2.5 h-2.5 text-indigo-400 animate-spin shrink-0" title="Updating routes in background" />
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[9px] landscape:text-[8px] font-bold px-2 landscape:px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${
                                    theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-white border-slate-200 text-slate-700 shadow-2xs'
                                }`} title={`Calculated with ${activeVehicle.name} (${activeVehicle.mpg} MPG)`}>
                                    <Fuel className="w-3 h-3 text-amber-400 shrink-0" />
                                    <span>{activeVehicle.mpg} MPG</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !avoidTolls;
                                        setAvoidTolls(next);
                                        localStorage.setItem('myway_avoid_tolls', String(next));
                                    }}
                                    className={`px-2 landscape:px-1.5 py-0.5 rounded-full text-[9px] landscape:text-[8px] font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                                        avoidTolls
                                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm ring-1 ring-emerald-500/30'
                                            : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 shadow-2xs'
                                    }`}
                                    title="Toggle Avoid Tolls"
                                >
                                    <CreditCard className={`w-3 h-3 shrink-0 ${avoidTolls ? 'text-emerald-400' : 'text-slate-400'}`} />
                                    <span>{avoidTolls ? 'Avoiding Tolls' : 'Avoid Tolls'}</span>
                                </button>
                                {renderAddStopButton()}
                            </div>
                        </div>

                        {/* Multi-Stop Waypoints Drawer */}
                        {renderWaypointManager()}

                        {/* Route Options List */}
                        <div className="px-2.5 pb-2.5 pt-0 landscape:px-2 landscape:pb-1.5">
                            {isLoadingRoutes && routeOptions.length === 0 ? (
                                <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                                        <span className="text-xs font-bold truncate">Finding routes & toll costs...</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRetryRoutes}
                                        className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-black border border-indigo-400/30 flex items-center gap-1 active:scale-95 transition-all cursor-pointer shrink-0"
                                        title="Retry route calculation"
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                        <span>Retry</span>
                                    </button>
                                </div>
                            ) : routeOptions.length > 0 ? (
                                <div className="space-y-1.5 landscape:space-y-1 max-h-52 landscape:max-h-24 overflow-y-auto no-scrollbar">
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
                                                className={`w-full p-2.5 landscape:p-1.5 rounded-xl landscape:rounded-lg border transition-all text-left flex items-center justify-between gap-2.5 landscape:gap-1.5 cursor-pointer ${
                                                    isSelected
                                                        ? (theme === 'dark'
                                                            ? 'bg-indigo-600/25 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/40'
                                                            : 'bg-white border-indigo-300 shadow-xs ring-1 ring-indigo-500/30')
                                                        : (theme === 'dark'
                                                            ? 'bg-white/[0.03] border-white/5 hover:bg-white/[0.07] hover:border-white/10'
                                                            : 'bg-white/70 border-slate-200/80 hover:bg-white hover:border-slate-300')
                                                }`}
                                            >
                                                <div className="flex items-center gap-2 landscape:gap-1.5 min-w-0 flex-1">
                                                    <div className={`w-8 h-8 landscape:w-6 landscape:h-6 rounded-xl landscape:rounded-md flex items-center justify-center text-sm landscape:text-xs shrink-0 font-bold ${
                                                        route.routeType === 'fastest' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                                        route.routeType === 'toll_free' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                                        route.routeType === 'eco' ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' :
                                                        route.routeType === 'scenic' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                        'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                                    }`}>
                                                        {route.routeType === 'fastest' ? <Zap className="w-4 h-4 landscape:w-3 landscape:h-3 shrink-0" /> :
                                                         route.routeType === 'toll_free' ? <CheckCircle2 className="w-4 h-4 landscape:w-3 landscape:h-3 shrink-0" /> :
                                                         route.routeType === 'eco' ? <Leaf className="w-4 h-4 landscape:w-3 landscape:h-3 shrink-0" /> :
                                                         route.routeType === 'scenic' ? <TreePine className="w-4 h-4 landscape:w-3 landscape:h-3 shrink-0" /> :
                                                         <Route className="w-4 h-4 landscape:w-3 landscape:h-3 shrink-0" />}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className={`text-xs landscape:text-[11px] font-black truncate ${textColor}`}>
                                                                {route.routeLabel || 'Route'}
                                                            </span>
                                                            {route.savingsLabel && (
                                                                <span className={`text-[8px] landscape:text-[7px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                                                    route.routeType === 'fastest' ? 'bg-amber-500/15 text-amber-400' :
                                                                    route.routeType === 'toll_free' ? 'bg-emerald-500/15 text-emerald-400' :
                                                                    route.routeType === 'eco' ? 'bg-teal-500/15 text-teal-400' :
                                                                    'bg-indigo-500/15 text-indigo-400'
                                                                }`}>
                                                                    {route.savingsLabel}
                                                                </span>
                                                            )}
                                                            {route.hasTolls && (
                                                                <span className="text-[8px] landscape:text-[7px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 shrink-0 flex items-center gap-1">
                                                                    <CreditCard className="w-2.5 h-2.5 shrink-0" />
                                                                    <span>{route.tollCostEstimate}</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[9px] landscape:text-[8px] text-slate-400 mt-0.5 truncate">
                                                            <span className="font-semibold">{route.summary}</span>
                                                            {route.fuelCostEstimate && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span className="text-slate-300 flex items-center gap-0.5">
                                                                        <Fuel className="w-2.5 h-2.5 shrink-0 text-amber-400" />
                                                                        <span>{route.fuelCostEstimate}</span>
                                                                    </span>
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
                                                    <p className={`text-xs landscape:text-[11px] font-black ${isSelected ? 'text-indigo-400' : textColor}`}>
                                                        {route.totalTime}
                                                    </p>
                                                    <p className="text-[9px] landscape:text-[8px] text-slate-400">
                                                        {route.totalDistance}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : !isLoadingRoutes && routeOptions.length === 0 ? (
                                <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                                        <span className="text-xs font-medium truncate">No direct route found</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRetryRoutes}
                                        className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-black border border-indigo-400/30 flex items-center gap-1 active:scale-95 transition-all cursor-pointer shrink-0"
                                        title="Retry route calculation"
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                        <span>Retry</span>
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1.5 mt-2 landscape:mt-1 shrink-0 sticky bottom-0 pt-1.5 pb-0.5 backdrop-blur-md bg-inherit/95">
                        <button
                            onClick={() => onNavigate(routeOptions[selectedRouteIdx] || undefined)}
                            className="flex-[1.5] min-w-fit h-10 landscape:h-8.5 px-3.5 landscape:px-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl landscape:rounded-lg font-black text-xs sm:text-sm landscape:text-xs shadow-md shadow-indigo-600/30 transition-all active:scale-95 flex flex-row items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                            <Navigation className="w-4 h-4 landscape:w-3.5 landscape:h-3.5 shrink-0 fill-current" />
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
                            className="h-10 landscape:h-8.5 px-2.5 landscape:px-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl landscape:rounded-lg font-bold text-xs landscape:text-[11px] shadow-md shadow-purple-600/20 transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap"
                            title="Start Caravan / Convoy with Circle Members"
                        >
                            <Car className="w-4 h-4 landscape:w-3.5 landscape:h-3.5 shrink-0" />
                            <span className="whitespace-nowrap">Convoy</span>
                        </button>
                        {onCorrectLocation && (
                            <button
                                type="button"
                                onClick={() => onCorrectLocation(place)}
                                className={`h-10 landscape:h-8.5 px-2.5 landscape:px-2 rounded-xl landscape:rounded-lg font-bold text-xs landscape:text-[11px] border transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap ${
                                    theme === 'dark' ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700'
                                }`}
                                title="Update place details, entrance, or building photo"
                            >
                                <Edit3 className="w-3.5 h-3.5 landscape:w-3 landscape:h-3 shrink-0" />
                                <span className="whitespace-nowrap">Update Place Details</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleShare}
                            className={`h-10 landscape:h-8.5 px-2.5 landscape:px-2 rounded-xl landscape:rounded-lg font-bold text-xs landscape:text-[11px] border transition-all active:scale-95 flex flex-row items-center justify-center gap-1 shrink-0 cursor-pointer whitespace-nowrap ${
                                theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                            }`}
                            title="Share place details"
                        >
                            <Share2 className="w-3.5 h-3.5 landscape:w-3 landscape:h-3 shrink-0" />
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

    if (isSavedLocation) {
        return (
            <SavedPlaceHubCard
                place={place}
                onClose={onClose}
                onNavigate={onNavigate}
                theme={theme}
                userLocation={userLocation}
                isMobile={false}
                onEditPlace={onEditPlace}
                members={members}
                currentUserId={currentUserId}
                routeOptions={routeOptions}
                selectedRouteIdx={selectedRouteIdx}
                onSelectRoutePreview={onSelectRoutePreview}
                isLoadingRoutes={isLoadingRoutes}
                userPlaces={userPlaces}
            />
        );
    }

    return (
        <div className={`w-full max-w-full landscape:top-16 landscape:bottom-4 landscape:max-h-[calc(100dvh-5.5rem)] landscape:sm:max-h-[calc(100dvh-5.5rem)] landscape:my-auto flex flex-col backdrop-blur-2xl rounded-[1.75rem] sm:rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 opacity-100 pointer-events-auto ${bgColor}`}>
            <div className="p-3.5 sm:p-5 landscape:p-3 flex-1 overflow-y-auto overscroll-contain no-scrollbar flex flex-col">
                {/* Header Row: Place Title & Action Icons (Save & Close) */}
                <div className="flex items-start justify-between gap-3 mb-1.5 landscape:mb-1">
                    <div className="min-w-0 flex-1">
                        <h3 className={`text-lg sm:text-xl font-black leading-tight mb-0.5 sm:mb-1 truncate ${textColor}`}>{place.name}</h3>
                        {addressSubtitle && (
                            <div className="flex flex-wrap items-center gap-2">
                                <p className={`text-xs leading-snug flex items-start gap-1.5 ${subTextColor}`}>
                                    <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                                    <span className="line-clamp-2">{addressSubtitle}</span>
                                </p>
                                {place.isCommunityVerified && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                                        <span>📍 Community Verified</span>
                                    </span>
                                )}
                            </div>
                        )}
                        {!addressSubtitle && place.isCommunityVerified && (
                            <div className="mt-1">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span>📍 Community Verified</span>
                                </span>
                            </div>
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
                                <Edit3 className="w-4 h-4 shrink-0" />
                            </button>
                        )}

                        {/* Relocated Save / Unsave Star Button */}
                        <button
                            type="button"
                            onClick={() => {
                                if (isSaved) {
                                    const savedMatch = userPlaces?.find(p => p.id === place.id || (
                                        p.location && place.location &&
                                        Math.abs(p.location.lat - place.location.lat) < 0.001 &&
                                        Math.abs(p.location.lng - place.location.lng) < 0.001
                                    ));
                                    const idToDelete = savedMatch?.id || place.id;
                                    if (onDeletePlace) onDeletePlace(idToDelete);
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
                            <Star className={`w-4 h-4 shrink-0 ${isSaved ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
                        </button>

                        {/* Close Button */}
                        <button
                            type="button"
                            onClick={onClose}
                            className={`w-9 h-9 rounded-full transition-all flex items-center justify-center cursor-pointer ${
                                theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                            title="Close"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5 shrink-0" />
                        </button>
                    </div>
                </div>

                {/* Type Tag + Distance Badge + Consolidated Badges Row */}
                <div className="flex flex-row flex-wrap items-center gap-2 mb-3">
                    {place.isCommunityVerified && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Community Verified Pin</span>
                        </span>
                    )}
                    {typeLabel && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${tagColor}`}>
                            {typeLabel}
                        </span>
                    )}
                    {distance && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full flex items-center gap-1 ${theme === 'dark' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                            <Navigation className="w-2.5 h-2.5 shrink-0" />
                            <span>{distance}</span>
                        </span>
                    )}
                    {hasPrecisionPin && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                            <Crosshair className="w-3 h-3 text-amber-400 shrink-0" />
                            <span>Precision Routing Pin</span>
                        </span>
                    )}
                    {!isPrivatePlace && isVerified && (
                        <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-amber-400 shrink-0" />
                            <span>Trust: {trustScore}</span>
                        </span>
                    )}
                </div>

                {/* Entrance Guidance (Desktop - if not redundant default precision pin note) */}
                {place.entranceNotes && !isPrecisionNotes && (
                    <p className="text-xs text-amber-300/90 font-bold mb-2.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-1.5">
                        <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>{place.entranceNotes}</span>
                    </p>
                )}

                {/* Crowdsourced Verification & Voting Row (Desktop - Hidden for private places) */}
                {!isPrivatePlace && isVerified && (
                    <div className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl border mb-2.5 text-xs ${
                        theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center gap-2 min-w-0">
                            {submitterAvatar && !isCommunityReport ? (
                                <img
                                    src={submitterAvatar}
                                    alt={submitterDisplayName}
                                    className="w-5 h-5 rounded-full object-cover border border-amber-400/60 shadow-sm shrink-0"
                                />
                            ) : (
                                <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className={`font-bold truncate ${textColor}`}>
                                Reported by <span className="text-amber-400 font-black">{isCommunityReport ? 'MyWay Community' : submitterDisplayName}</span>
                            </span>
                            {place.correctedAt && (
                                <span className={`text-[10px] font-medium shrink-0 opacity-70 ${subTextColor}`}>
                                    • {formatRelativeTime(place.correctedAt)}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={handleToggleHelpful}
                                disabled={isVoting}
                                className={`px-2.5 py-1 rounded-lg border font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                                    hasUpvoted
                                        ? 'bg-emerald-500/25 border-emerald-400/70 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                                        : theme === 'dark'
                                        ? 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-200'
                                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                }`}
                                title="Confirm location is accurate and helpful"
                            >
                                <ThumbsUp className="w-3.5 h-3.5 shrink-0" />
                                <span>Helpful</span>
                                {trustScore > 0 && (
                                    <span className="text-[10px] font-mono font-black opacity-90">
                                        ({trustScore})
                                    </span>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={handleDownvote}
                                disabled={isVoting}
                                className={`px-2.5 py-1 rounded-lg border font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                                    hasDownvoted
                                        ? 'bg-rose-500/25 border-rose-400/70 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                                        : theme === 'dark'
                                        ? 'bg-white/5 hover:bg-white/10 border-white/15 text-slate-400'
                                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-600'
                                }`}
                                title="Report location is incorrect or not there"
                            >
                                <ThumbsDown className="w-3.5 h-3.5 shrink-0" />
                                <span>Not there</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Location Photo Contributions & Gallery (Desktop) */}
                {renderPhotoSection(false)}

                {/* Single Contiguous Trip-Planning & Route Choices Container (Desktop) */}
                <div className={`mb-3 sm:mb-4 landscape:mb-2 rounded-2xl sm:rounded-3xl border transition-all overflow-hidden ${
                    theme === 'dark'
                        ? 'bg-slate-900/90 border-white/10 shadow-inner'
                        : 'bg-slate-50 border-slate-200 shadow-xs'
                }`}>
                    {/* Route Choices Header & Filter Toolbar */}
                    <div className="p-3 pb-2 flex items-center justify-between gap-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                Route Choices {routeOptions.length > 1 ? `(${routeOptions.length})` : ''}
                            </span>
                            {isLoadingRoutes && routeOptions.length > 0 && (
                                <RefreshCw className="w-2.5 h-2.5 text-indigo-400 animate-spin shrink-0" title="Updating routes in background" />
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                                theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-white border-slate-200 text-slate-700 shadow-2xs'
                            }`} title={`Calculated with ${activeVehicle.name} (${activeVehicle.mpg} MPG)`}>
                                <Fuel className="w-3 h-3 text-amber-400 shrink-0" />
                                <span>{activeVehicle.mpg} MPG</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    const next = !avoidTolls;
                                    setAvoidTolls(next);
                                    localStorage.setItem('myway_avoid_tolls', String(next));
                                }}
                                className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                                    avoidTolls
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm ring-1 ring-emerald-500/30'
                                        : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 shadow-2xs'
                                }`}
                                title="Toggle Avoid Tolls"
                            >
                                <CreditCard className={`w-3 h-3 shrink-0 ${avoidTolls ? 'text-emerald-400' : 'text-slate-400'}`} />
                                <span>{avoidTolls ? 'Avoiding Tolls' : 'Avoid Tolls'}</span>
                            </button>
                            {renderAddStopButton()}
                        </div>
                    </div>

                    {/* Multi-Stop Waypoints Drawer (Desktop) */}
                    {renderWaypointManager()}

                    {/* Route Options List */}
                    <div className="px-2.5 pb-2.5 pt-0">
                        {isLoadingRoutes && routeOptions.length === 0 ? (
                            <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
                                <div className="flex items-center gap-2 min-w-0">
                                    <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                                    <span className="text-xs font-bold truncate">Finding routes & toll costs...</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRetryRoutes}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-black border border-indigo-400/30 flex items-center gap-1 active:scale-95 transition-all cursor-pointer shrink-0"
                                    title="Retry route calculation"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>Retry</span>
                                </button>
                            </div>
                        ) : routeOptions.length > 0 ? (
                            <div className="space-y-1 sm:space-y-1.5 max-h-36 sm:max-h-48 landscape:max-h-24 overflow-y-auto no-scrollbar">
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
                                            className={`w-full p-2 sm:p-2.5 rounded-xl border transition-all text-left flex items-center justify-between gap-2.5 cursor-pointer ${
                                                isSelected
                                                    ? (theme === 'dark'
                                                        ? 'bg-indigo-600/25 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/40'
                                                        : 'bg-white border-indigo-300 shadow-xs ring-1 ring-indigo-500/30')
                                                    : (theme === 'dark'
                                                        ? 'bg-white/[0.03] border-white/5 hover:bg-white/[0.07] hover:border-white/10'
                                                        : 'bg-white/70 border-slate-200/80 hover:bg-white hover:border-slate-300')
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs shrink-0 font-bold ${
                                                    route.routeType === 'fastest' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                                    route.routeType === 'toll_free' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                                    route.routeType === 'eco' ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' :
                                                    route.routeType === 'scenic' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                    'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                                }`}>
                                                    {route.routeType === 'fastest' ? <Zap className="w-3.5 h-3.5 shrink-0" /> :
                                                     route.routeType === 'toll_free' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> :
                                                     route.routeType === 'eco' ? <Leaf className="w-3.5 h-3.5 shrink-0" /> :
                                                     route.routeType === 'scenic' ? <TreePine className="w-3.5 h-3.5 shrink-0" /> :
                                                     <Route className="w-3.5 h-3.5 shrink-0" />}
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
                                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 shrink-0 flex items-center gap-1">
                                                                <CreditCard className="w-2.5 h-2.5 shrink-0" />
                                                                <span>{route.tollCostEstimate}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mt-0.5 truncate">
                                                        <span>{route.summary}</span>
                                                        {route.fuelCostEstimate && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="text-slate-300 flex items-center gap-0.5">
                                                                    <Fuel className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                                                    <span>{route.fuelCostEstimate}</span>
                                                                </span>
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
                        ) : !isLoadingRoutes && routeOptions.length === 0 ? (
                            <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
                                <div className="flex items-center gap-2 min-w-0">
                                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                                    <span className="text-xs font-medium truncate">No direct route found</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRetryRoutes}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-black border border-indigo-400/30 flex items-center gap-1 active:scale-95 transition-all cursor-pointer shrink-0"
                                    title="Retry route calculation"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>Retry</span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5 mt-2 sm:mt-2.5 landscape:mt-1.5 shrink-0 sticky bottom-0 pt-1.5 pb-0.5 bg-inherit/95 backdrop-blur-md">
                    <button
                        onClick={() => onNavigate(routeOptions[selectedRouteIdx] || undefined)}
                        className="flex-[1.5] min-w-fit h-10 landscape:h-8.5 px-3.5 landscape:px-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl font-black text-xs sm:text-sm landscape:text-xs shadow-md shadow-indigo-600/30 transition-all active:scale-95 flex flex-row items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                        <Navigation className="w-4 h-4 landscape:w-3.5 landscape:h-3.5 shrink-0 fill-current" />
                        <span className="whitespace-nowrap">{routeOptions[selectedRouteIdx] ? `Go (${routeOptions[selectedRouteIdx].totalTime})` : 'Go'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsConvoySetupOpen(true)}
                        className="h-10 landscape:h-8.5 px-2.5 landscape:px-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs landscape:text-[11px] shadow-md shadow-purple-600/20 transition-all active:scale-95 flex flex-row items-center justify-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
                        title="Plan Caravan / Convoy with Circle Members"
                    >
                        <Car className="w-4 h-4 landscape:w-3.5 landscape:h-3.5 shrink-0" />
                        <span className="whitespace-nowrap">Convoy</span>
                    </button>
                    {onCorrectLocation && (
                        <button
                            type="button"
                            onClick={() => onCorrectLocation(place)}
                            className={`h-10 landscape:h-8.5 px-2.5 landscape:px-2 rounded-xl font-bold text-xs landscape:text-[11px] border transition-all active:scale-95 flex flex-row items-center justify-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap ${
                                theme === 'dark' ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700'
                            }`}
                            title="Update place details, entrance, or building photo"
                        >
                            <Edit3 className="w-3.5 h-3.5 landscape:w-3 landscape:h-3 shrink-0" />
                            <span className="whitespace-nowrap">Update Place Details</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleShare}
                        className={`h-10 landscape:h-8.5 px-2.5 landscape:px-2 rounded-xl font-bold text-xs landscape:text-[11px] border transition-all active:scale-95 flex flex-row items-center justify-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap ${
                            theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                        title="Share place details"
                    >
                        <Share2 className="w-3.5 h-3.5 landscape:w-3 landscape:h-3 shrink-0" />
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
                                    <div className="w-10 h-10 rounded-2xl bg-purple-500/20 flex items-center justify-center shrink-0 border border-purple-500/30">
                                        <Car className="w-5 h-5 text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black">Plan Caravan Trip</h3>
                                        <p className="text-xs text-purple-400">Select Circle Members</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsConvoySetupOpen(false)}
                                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                                >
                                    <X className="w-4 h-4 shrink-0" />
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
                                                            <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                                                                <span>{member.status}</span>
                                                                <span>•</span>
                                                                <span className="flex items-center gap-0.5">
                                                                    <Battery className="w-3 h-3 text-emerald-400 shrink-0" />
                                                                    <span>{member.battery}%</span>
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-xs ${
                                                        isChecked ? 'bg-purple-600 text-white' : 'border border-white/20'
                                                    }`}>
                                                        {isChecked ? <Check className="w-3.5 h-3.5 text-white" /> : null}
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
                                    <Navigation className="w-4 h-4 shrink-0 fill-current" />
                                    <span>Launch Caravan ({selectedMemberIds.length})</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Hidden Secure Camera-Only Input (No Library / Browse Access) */}
                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCameraCapture}
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                />

                {/* Storefront Photo Fullscreen Lightbox Modal */}
                {isPhotoLightboxOpen && (photoUrls[activePhotoIndex] || place.imageUrl) && (
                    <div 
                        onClick={() => setIsPhotoLightboxOpen(false)}
                        className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto cursor-zoom-out"
                    >
                        <div 
                            onClick={(e) => e.stopPropagation()}
                            className="relative max-w-2xl w-full rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black flex flex-col cursor-default"
                        >
                            {/* Main Lightbox Image with Nav Arrows */}
                            <div className="relative flex items-center justify-center bg-black/95 min-h-[40vh] max-h-[70vh]">
                                <img 
                                    src={photoUrls[activePhotoIndex] || place.imageUrl} 
                                    alt={place.name} 
                                    className="w-full max-h-[70vh] object-contain select-none"
                                />

                                {/* Prev Arrow */}
                                {photoUrls.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : photoUrls.length - 1));
                                        }}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-md border border-white/20 transition-all cursor-pointer select-none"
                                        title="Previous Photo"
                                    >
                                        ◀
                                    </button>
                                )}

                                {/* Next Arrow */}
                                {photoUrls.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActivePhotoIndex((prev) => (prev < photoUrls.length - 1 ? prev + 1 : 0));
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-md border border-white/20 transition-all cursor-pointer select-none"
                                        title="Next Photo"
                                    >
                                        ▶
                                    </button>
                                )}

                                {/* Photo counter badge */}
                                {photoUrls.length > 1 && (
                                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/70 border border-white/20 text-white text-[11px] font-bold backdrop-blur-md">
                                        {activePhotoIndex + 1} / {photoUrls.length}
                                    </div>
                                )}
                            </div>

                            {/* Lightbox Footer */}
                            <div className="p-4 bg-slate-900/95 flex items-center justify-between gap-4 border-t border-white/10">
                                <div className="min-w-0 flex-1">
                                    <h4 className="text-sm font-black text-white truncate">{place.name}</h4>
                                    {photos[activePhotoIndex]?.caption ? (
                                        <p className="text-xs text-slate-200 mt-0.5">
                                            "{photos[activePhotoIndex].caption}"
                                        </p>
                                    ) : (
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            {photos[activePhotoIndex]?.userName ? `Contributed by ${photos[activePhotoIndex].userName}` : 'Building & Access Photo'}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleTriggerCamera}
                                        disabled={isUploadingPhoto}
                                        className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Camera className="w-3.5 h-3.5 shrink-0" />
                                        <span>Snap Photo</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsPhotoLightboxOpen(false)}
                                        className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* User Contribution Management Modal */}
                {isManagePhotosOpen && (
                    <div
                        onClick={() => setIsManagePhotosOpen(false)}
                        className="fixed inset-0 z-[320] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className={`relative max-w-lg w-full rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
                                theme === 'dark' ? 'bg-[#0f172a] border-white/15 text-white' : 'bg-white border-slate-200 text-slate-900'
                            }`}
                        >
                            {/* Modal Header */}
                            <div className={`p-4 border-b flex items-center justify-between shrink-0 ${
                                theme === 'dark' ? 'border-white/10 bg-slate-900/60' : 'border-slate-200 bg-slate-50'
                            }`}>
                                <div>
                                    <h3 className="text-sm font-black flex items-center gap-2">
                                        <Camera className="w-4 h-4 text-indigo-400 shrink-0" />
                                        <span>My Photo Contributions</span>
                                    </h3>
                                    <p className="text-[11px] text-slate-400 font-medium truncate max-w-xs">
                                        {place.name}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsManagePhotosOpen(false)}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all cursor-pointer ${
                                        theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                    }`}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Modal Body: List of user's contributed photos */}
                            <div className="p-4 overflow-y-auto space-y-3 flex-1">
                                {myContributions.length === 0 ? (
                                    <div className="text-center py-8">
                                        <div className="w-12 h-12 rounded-2xl bg-slate-800/40 border border-white/5 flex items-center justify-center mx-auto mb-2 text-slate-500">
                                            <Camera className="w-6 h-6" />
                                        </div>
                                        <p className="text-xs font-bold text-slate-400">No photo contributions yet for this place.</p>
                                    </div>
                                ) : (
                                    myContributions.map((photo) => (
                                        <div
                                            key={photo.id}
                                            className={`p-3 rounded-2xl border flex gap-3 transition-all ${
                                                theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                                            }`}
                                        >
                                            {/* Thumbnail */}
                                            <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-white/10">
                                                <img src={photo.url} alt="Contribution" className="w-full h-full object-cover" />
                                            </div>

                                            {/* Metadata & Caption Editor */}
                                            <div className="min-w-0 flex-1 flex flex-col justify-between">
                                                <div>
                                                    <div className="flex items-center justify-between gap-1">
                                                        <span className="text-[10px] font-bold text-slate-400">
                                                            {formatRelativeTime(photo.createdAt)}
                                                        </span>
                                                        <div className="flex items-center gap-1">
                                                            {/* Edit Caption Button */}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleStartEditCaption(photo)}
                                                                className="p-1.5 rounded-lg hover:bg-white/10 text-cyan-400 transition-colors cursor-pointer"
                                                                title="Edit Caption"
                                                            >
                                                                <Edit3 className="w-3.5 h-3.5" />
                                                            </button>
                                                            {/* Delete Button */}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeletePhoto(photo)}
                                                                disabled={deletingPhotoId === photo.id}
                                                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-rose-400 transition-colors cursor-pointer disabled:opacity-50"
                                                                title="Delete Photo"
                                                            >
                                                                {deletingPhotoId === photo.id ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                                                                ) : (
                                                                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Caption display or inline edit */}
                                                    {editingCaptionId === photo.id ? (
                                                        <div className="mt-1.5 flex items-center gap-1.5">
                                                            <input
                                                                type="text"
                                                                value={editingCaptionText}
                                                                onChange={(e) => setEditingCaptionText(e.target.value)}
                                                                placeholder="Add a caption..."
                                                                className={`flex-1 px-2.5 py-1 rounded-xl text-xs font-bold border outline-none ${
                                                                    theme === 'dark' ? 'bg-black/50 border-cyan-400/50 text-white' : 'bg-white border-cyan-400 text-slate-900'
                                                                }`}
                                                                autoFocus
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSaveCaption(photo)}
                                                                className="px-2.5 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-black font-black text-xs cursor-pointer flex items-center justify-center"
                                                            >
                                                                <Check className="w-3.5 h-3.5 text-black stroke-[3]" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditingCaptionId(null)}
                                                                className="px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs cursor-pointer flex items-center justify-center"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs font-semibold mt-1 text-slate-200 line-clamp-2">
                                                            {photo.caption ? `"${photo.caption}"` : <span className="text-slate-500 italic text-[11px]">No caption added</span>}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className={`p-4 border-t flex items-center justify-between shrink-0 ${
                                theme === 'dark' ? 'border-white/10 bg-slate-900/60' : 'border-slate-200 bg-slate-50'
                            }`}>
                                <button
                                    type="button"
                                    onClick={handleTriggerCamera}
                                    disabled={isUploadingPhoto}
                                    className="px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer disabled:opacity-50"
                                >
                                    {isUploadingPhoto ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                    ) : (
                                        <Camera className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    <span>{isUploadingPhoto ? 'Uploading...' : 'Snap Another Photo'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsManagePhotosOpen(false)}
                                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
                                >
                                    Done
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
