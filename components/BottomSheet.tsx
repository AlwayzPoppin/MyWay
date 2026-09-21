import React, { useState, useRef } from 'react';
import { FamilyMember, Place, Location } from '../types';
import { getDistanceMeters, getDistanceMiles } from '../utils/geo';
import { convoyService } from '../services/convoyService';
import HoldToActivate from './HoldToActivate';
import ActivityLog from './ActivityLog';
import CircleManager from './CircleManager';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { FamilyCircle, getCircleColor } from '../services/authService';
import { getMemberViewerLabel, MemberStatusText } from '../utils/memberStatus';
import { MemberAvatarWithRing, AddMemberButton, CircleMembershipBadge } from './MemberCard';
import { isAtHomePlace } from '../services/locationService';
import { isOlderCircleSyncProtocol } from '../services/appVersionService';
import {
    Shield,
    Fuel,
    Navigation,
    Users,
    MapPin,
    FileText,
    Zap,
    Battery,
    MessageSquare,
    Bell,
    Wrench,
    Trophy,
    AlertTriangle,
    Sparkles,
    ChevronDown,
    Car,
    Radio,
    Home,
    Briefcase,
    Edit3,
    Trash2,
    Settings,
    Clock,
    Building2,
    GraduationCap,
    Dumbbell,
    Utensils,
    Coffee
} from 'lucide-react';

const BOTTOM_SHEET_PLACE_CATEGORIES = [
    { type: 'home', icon: '🏠', iconComp: Home, label: 'Home' },
    { type: 'work', icon: '💼', iconComp: Briefcase, label: 'Work' },
    { type: 'school', icon: '🏫', iconComp: GraduationCap, label: 'School' },
    { type: 'gym', icon: '🏋️', iconComp: Dumbbell, label: 'Gym' },
    { type: 'food', icon: '🍔', iconComp: Utensils, label: 'Food' },
    { type: 'coffee', icon: '☕', iconComp: Coffee, label: 'Coffee' },
    { type: 'gas', icon: '⛽', iconComp: Fuel, label: 'Gas' },
    { type: 'other', icon: '📍', iconComp: MapPin, label: 'Other' },
];

interface BottomSheetProps {
    members: FamilyMember[];
    currentUserId?: string;
    selectedId: string | null;
    onSelect: (id: string) => void;
    theme: 'light' | 'dark';
    hasCircle?: boolean;
    inviteCode?: string;
    onCreateCircle?: (name: string) => Promise<any>;
    onJoinCircle?: (code: string) => Promise<any>;
    circleName?: string;
    userCircles?: FamilyCircle[];
    activeFilterCircleId?: string | 'all';
    onSelectFilterCircle?: (circleId: string | 'all') => void;
    onOpenCircleSettings?: (tab?: 'circles' | 'invite' | 'manage') => void;
    showNotification?: (msg: string, duration?: number) => void;
    onOpenSettings?: () => void;
    onOpenTripHistory?: () => void;
    onOpenNotifications?: () => void;
    onOpenWeeklyReport?: () => void;
    onOpenInviteShare?: () => void;
    onOpenMaintenance?: () => void;
    onOpenContacts?: (recipientId?: string) => void;
    onSOS?: () => void;
    activities?: any[];
    unreadActivityCount?: number;
    onLogViewed?: () => void;
    onResolveSOS?: (id: string, memberId?: string) => void;
    userPlaces?: Place[];
    selectedPlaceId?: string | null;
    onSelectPlace?: (place: Place) => void;
    onAddPlace?: (place: Omit<Place, 'id'>) => void;
    onDeletePlace?: (placeId: string) => void;
    onEditPlace?: (place: Place) => void;
    onNavigatePlace?: (place: Place) => void;
    userLocation?: Location | null;
    isExpanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    className?: string;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
    members,
    currentUserId,
    selectedId,
    onSelect,
    theme,
    className,
    hasCircle = true,
    inviteCode,
    circleName,
    userCircles = [],
    activeFilterCircleId = 'all',
    onSelectFilterCircle,
    onOpenCircleSettings,
    onCreateCircle,
    onJoinCircle,
    showNotification,
    onOpenSettings,
    onOpenTripHistory,
    onOpenNotifications,
    onOpenWeeklyReport,
    onOpenInviteShare,
    onOpenMaintenance,
    onOpenContacts,
    onSOS,
    activities = [],
    unreadActivityCount = 0,
    onLogViewed,
    onResolveSOS = () => {},
    userPlaces = [],
    selectedPlaceId,
    onSelectPlace,
    onAddPlace,
    onDeletePlace,
    onEditPlace,
    onNavigatePlace,
    userLocation,
    isExpanded: controlledExpanded,
    onExpandedChange
}) => {
    const [localExpanded, setLocalExpanded] = useState(false);
    const isControlled = controlledExpanded !== undefined;
    const isExpanded = isControlled ? controlledExpanded : localExpanded;

    const setExpanded = (val: boolean) => {
        if (!isControlled) {
            setLocalExpanded(val);
        }
        onExpandedChange?.(val);
    };

    const [activeTab, setActiveTab] = useState<'members' | 'places' | 'log'>('members');
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const [isDraggingSheet, setIsDraggingSheet] = useState(false);
    const dragOffsetRef = useRef(0);
    const didDragSheetRef = useRef(false);
    const [showAddCustomPlace, setShowAddCustomPlace] = useState(false);
    const [customPlaceName, setCustomPlaceName] = useState('');
    const [customPlaceIcon, setCustomPlaceIcon] = useState('📍');
    const [customPlaceType, setCustomPlaceType] = useState<'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other'>('other');
    const sheetRef = useRef<HTMLDivElement>(null);

    const renderPlaceIcon = (icon?: string, type?: string, name?: string, sizeClass = 'w-5 h-5') => {
        const key = (icon || type || name || '').toLowerCase();
        if (key === '🏠' || key.includes('home') || key === 'house') {
            return <Home className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        if (key === '💼' || key === '🏢' || key.includes('work') || key.includes('office')) {
            return <Briefcase className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        if (key === '🏫' || key === '🎓' || key.includes('school') || key.includes('college') || key.includes('univ')) {
            return <GraduationCap className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        if (key === '🏋️' || key === '💪' || key.includes('gym') || key.includes('fitness')) {
            return <Dumbbell className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        if (key === '🍔' || key.includes('food') || key.includes('restaurant') || key.includes('burger')) {
            return <Utensils className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        if (key === '☕' || key.includes('coffee') || key.includes('cafe')) {
            return <Coffee className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        if (key === '⛽' || key.includes('gas') || key.includes('fuel')) {
            return <Fuel className={`${sizeClass} text-indigo-400 shrink-0`} />;
        }
        return <MapPin className={`${sizeClass} text-indigo-400 shrink-0`} />;
    };

    const dismissKeyboard = () => {
        if (typeof document !== 'undefined') {
            (document.activeElement as HTMLElement)?.blur();
        }
    };

    const getExpandedHeight = () => typeof window === 'undefined' ? 480 : Math.min(window.innerHeight * 0.62, 480);

    const handleTouchStart = (e: React.TouchEvent) => {
        dismissKeyboard();
        setDragStart(e.touches[0].clientY);
        setDragOffset(0);
        dragOffsetRef.current = 0;
        setIsDraggingSheet(true);
        didDragSheetRef.current = false;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (dragStart === null) return;
        const diff = dragStart - e.touches[0].clientY;
        const travel = Math.max(1, getExpandedHeight() - 100);
        const offset = isExpanded
            ? Math.min(travel, Math.max(0, -diff))
            : Math.min(travel, Math.max(0, diff));
        if (offset > 5) {
            dismissKeyboard();
            e.preventDefault();
            didDragSheetRef.current = true;
        }
        setDragOffset(offset);
        dragOffsetRef.current = offset;
    };

    const handleTouchEnd = () => {
        const travel = Math.max(1, getExpandedHeight() - 100);
        if (dragStart !== null && dragOffsetRef.current >= travel * 0.22) {
            setExpanded(!isExpanded);
        }
        setDragStart(null);
        setDragOffset(0);
        dragOffsetRef.current = 0;
        setIsDraggingSheet(false);
    };

    const handleAddMember = () => {
        if (onOpenInviteShare) {
            onOpenInviteShare();
        } else if (onOpenCircleSettings) {
            onOpenCircleSettings('invite');
        } else if (inviteCode) {
            navigator.clipboard?.writeText(inviteCode);
            if (showNotification) showNotification(`Invite code ${inviteCode} copied to clipboard!`);
        }
    };

    const getBatteryColor = (battery: number) => {
        if (battery <= 20) return '#ef4444';
        if (battery <= 50) return '#f59e0b';
        return '#22c55e';
    };

    const renderStatusIcon = (status: string, currentPlace?: string, location?: Location) => {
        // A Home glyph is reserved for the actual Home geofence. currentPlace
        // may be from a previous fix and must never make a moving member appear home.
        if (status === 'Stationary' && location && isAtHomePlace(location)) return <Home className="w-2.5 h-2.5 text-indigo-400 shrink-0" />;
        switch (status) {
            case 'Driving': return <Car className="w-2.5 h-2.5 text-sky-400 shrink-0" />;
            case 'Walking':
            case 'Moving': return <Navigation className="w-2.5 h-2.5 text-emerald-400 shrink-0" />;
            case 'Stationary': return <MapPin className="w-2.5 h-2.5 text-emerald-400 shrink-0" />;
            case 'Offline': return <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />;
            default: return <MapPin className="w-2.5 h-2.5 text-slate-400 shrink-0" />;
        }
    };

    const formatDistance = (placeLoc: Location) => {
        if (!userLocation) return null;
        const miles = getDistanceMiles(userLocation, placeLoc);
        if (miles < 0.1) return `${Math.round(miles * 5280)} ft away`;
        if (miles < 10) return `${miles.toFixed(1)} mi away`;
        return `${Math.round(miles)} mi away`;
    };

    const handleSaveCustomPlace = () => {
        if (!customPlaceName.trim() || !userLocation || !onAddPlace) return;
        onAddPlace({
            name: customPlaceName.trim(),
            location: { lat: userLocation.lat, lng: userLocation.lng },
            type: customPlaceType,
            icon: customPlaceIcon,
            radius: 0.15,
            description: 'Pinned on mobile'
        });
        setCustomPlaceName('');
        setShowAddCustomPlace(false);
        if (showNotification) showNotification(`📍 Saved "${customPlaceName.trim()}"`, 3000);
    };

    const isDark = theme === 'dark';
    // Keep the Hub summary tied to the same GPS freshness contract used by the
    // live map. A stale last-known pin is useful context, but never "active now".
    const isLocationStale = (member: FamilyMember) => {
        if (member.locationStale) return true;
        const updatedAt = Date.parse(member.lastUpdated || '');
        return !Number.isFinite(updatedAt) || Date.now() - updatedAt > 90_000;
    };
    const summaryCircle = activeFilterCircleId !== 'all'
        ? userCircles.find(circle => circle.id === activeFilterCircleId)
        : undefined;
    const summaryMembers = summaryCircle
        ? members.filter(member => member.circleId === summaryCircle.id)
        : members;
    const summaryCircleName = summaryCircle?.name || (userCircles.length > 1 && activeFilterCircleId === 'all' ? 'All circles' : circleName || 'Family Circle');
    const activeCount = summaryMembers.filter(member => member.status !== 'Offline' && !isLocationStale(member)).length;
    const homeCount = summaryMembers.filter(member =>
        member.status === 'Stationary' &&
        !isLocationStale(member) &&
        Boolean(member.location) &&
        isAtHomePlace(member.location, userPlaces)
    ).length;
    const drivingCount = summaryMembers.filter(member => member.status === 'Driving' && !isLocationStale(member)).length;
    const movingCount = summaryMembers.filter(member =>
        (member.status === 'Moving' || member.status === 'Walking') && !isLocationStale(member)
    ).length;
    const staleLocationCount = summaryMembers.filter(isLocationStale).length;
    const isDragPreviewExpanded = isDraggingSheet && !isExpanded && dragOffset > 12;
    const showExpandedPanel = isExpanded || isDragPreviewExpanded;
    const sheetDragHeight = isDraggingSheet
        ? (isExpanded ? getExpandedHeight() - dragOffset : 100 + dragOffset)
        : null;

    return (
        <>
            {/* Backdrop behind expanded bottom sheet to dismiss on click */}
            {isExpanded && (
                <div
                    className="fixed inset-0 z-[95] bg-black/50 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
                    onClick={() => setExpanded(false)}
                />
            )}

            <div
                ref={sheetRef}
                data-map-bottom-obstruction
                className={`fixed bottom-0 left-0 right-0 z-[100] bottom-sheet safe-bottom transition-all duration-300 ease-out
                    ${isDark
                        ? 'bg-gradient-to-t from-[#090d16] via-[#0f172a]/98 to-[#0f172a]/95 text-white'
                        : 'bg-gradient-to-t from-[#f5f2eb] via-[#fdfbf7]/98 to-[#fdfbf7]/95 text-slate-900'}
                    backdrop-blur-2xl border-t ${isDark ? 'border-white/10' : 'border-slate-200/80'}
                    rounded-t-[28px] shadow-[0_-10px_60px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden ${className || ''}`}
                style={{
                    height: sheetDragHeight !== null ? `${sheetDragHeight}px` : (isExpanded ? 'min(62vh, 480px)' : 'calc(100px + env(safe-area-inset-bottom, 0px))'),
                    maxHeight: isExpanded ? 'min(62vh, 480px)' : undefined,
                    transform: 'translateY(0)',
                    transitionDuration: isDraggingSheet ? '0ms' : undefined
                }}
            >
                {/* Drag Handle Bar */}
                <div
                    className="pt-2.5 pb-1 flex items-center justify-center cursor-grab active:cursor-grabbing shrink-0 touch-none"
                    onClick={() => {
                        if (didDragSheetRef.current) {
                            didDragSheetRef.current = false;
                            return;
                        }
                        dismissKeyboard();
                        setExpanded(!isExpanded);
                    }}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                >
                <div className={`w-10 h-1.5 rounded-full transition-colors ${isDark ? 'bg-white/25 hover:bg-white/40' : 'bg-slate-300 hover:bg-slate-400'}`} />
            </div>

            {/* ─── COLLAPSED PEEK VIEW ─── */}
            {!showExpandedPanel && (
                <div className="px-4 flex items-center justify-between gap-2 min-h-[72px] py-1.5 shrink-0">
                    {/* Avatars Carousel */}
                    <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-2 px-1">
                        {members.map((member, index) => {
                            const isUnresolved = !member.companionDeviceLabel && (!member.location || (member.location.lat === 0 && member.location.lng === 0));
                            return (
                            <button
                                key={member.id}
                                onClick={() => {
                                    onSelect(member.id);
                                    setExpanded(true);
                                }}
                                className={`relative p-1 transition-all duration-300 shrink-0 ${
                                    isUnresolved ? 'opacity-70 hover:opacity-100' : ''
                                } ${selectedId === member.id ? 'scale-105 z-10' : 'hover:scale-105 active:scale-95'}`}
                                style={{ animationDelay: `${index * 50}ms` }}
                                title={isUnresolved ? `${member.name} (Locating…)` : `${member.name} (${member.status})`}
                            >
                                <MemberAvatarWithRing
                                    member={member}
                                    size="md"
                                    theme={isDark ? 'dark' : 'light'}
                                    isSelected={selectedId === member.id}
                                    isUnresolved={isUnresolved}
                                    renderBatteryBadge={false}
                                />
                            </button>
                        );})}
                    </div>

                    {/* Quick Places & Hub Toggle on Collapsed Bar */}
                    <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-white/10">
                        {userPlaces.slice(0, 1).map(p => (
                            <button
                                key={p.id}
                                onClick={() => onSelectPlace?.(p)}
                                className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-2 transition-all active:scale-95
                                    ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-100 border-slate-200 text-slate-800'}`}
                            >
                                {renderPlaceIcon(p.icon, p.type, p.name, 'w-3.5 h-3.5')}
                                <span className="truncate max-w-[60px]">{p.name || 'Home'}</span>
                            </button>
                        ))}

                        {/* Open Menu / Hub Button */}
                        <button
                            onClick={() => setExpanded(true)}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 shadow-md transition-all active:scale-95 ${
                                isDark
                                    ? 'bg-indigo-600/30 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/50'
                                    : 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100'
                            }`}
                        >
                            <Zap className="w-3.5 h-3.5 shrink-0" />
                            <span>Hub</span>
                            <span className="text-[10px] opacity-70">▲</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ─── EXPANDED FULL DRAWER (DESKTOP FEATURE PARITY) ─── */}
            {showExpandedPanel && (
                <div className="px-4 flex flex-col flex-1 overflow-hidden">
                    {/* Header Bar */}
                    <div className="flex items-center justify-between pb-3 pt-1 border-b border-white/5 shrink-0">
                        <div className="flex items-center gap-2">
                            <img
                                src="/logo.png"
                                alt="My Way Logo"
                                className="w-6 h-6 rounded-lg object-contain shadow-sm"
                            />
                            <h2 className={`text-base font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                My Way
                            </h2>
                        </div>

                        {/* Quick Header Actions */}
                        <div className="flex items-center gap-2">
                            {hasCircle && (
                                <button
                                    onClick={() => {
                                        if (onOpenCircleSettings) {
                                            onOpenCircleSettings('invite');
                                        } else if (onOpenInviteShare) {
                                            onOpenInviteShare();
                                        } else if (inviteCode) {
                                            navigator.clipboard.writeText(inviteCode);
                                            if (showNotification) showNotification(`📋 Invite code copied: ${inviteCode}`, 3000);
                                        }
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer ${
                                        isDark ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200'
                                    }`}
                                >
                                    + Add
                                </button>
                            )}
                            <button
                                onClick={() => setExpanded(false)}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-all active:scale-90 ${
                                    isDark ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-500'
                                }`}
                                title="Minimize"
                            >
                                <ChevronDown className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Navigation Tabs Bar */}
                    <div className="py-2.5 flex items-center justify-between gap-1.5 shrink-0">
                        <div className={`p-1 rounded-2xl border flex gap-1 flex-1 ${
                            isDark ? 'bg-white/5 border-white/5' : 'bg-slate-100 border-slate-200'
                        }`}>
                            <button
                                onClick={() => setActiveTab('members')}
                                className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 ${
                                    activeTab === 'members'
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <Users className="w-3.5 h-3.5 shrink-0" />
                                <span>{hasCircle ? `MEMBERS (${members.length})` : 'CIRCLE'}</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('places')}
                                className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 ${
                                    activeTab === 'places'
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span>{`PLACES (${userPlaces.length})`}</span>
                            </button>

                            <button
                                onClick={() => {
                                    setActiveTab('activity');
                                    onLogViewed?.();
                                }}
                                className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 ${
                                    activeTab === 'activity'
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span>LOG</span>
                                {unreadActivityCount > 0 && (
                                    <span className="min-w-4 rounded-full bg-violet-500 px-1.5 py-0.5 text-[9px] leading-none text-white">
                                        {unreadActivityCount > 99 ? '99+' : unreadActivityCount}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* ─── TAB CONTENT (SCROLLABLE) ─── */}
                    <div 
                        className="flex-1 overflow-y-auto no-scrollbar space-y-3.5 pb-6"
                        onScroll={dismissKeyboard}
                        onTouchMove={dismissKeyboard}
                    >
                        {!hasCircle ? (
                            onCreateCircle && onJoinCircle ? (
                                <CircleManager
                                    theme={theme}
                                    onCreateCircle={onCreateCircle}
                                    onJoinCircle={onJoinCircle}
                                />
                            ) : null
                        ) : activeTab === 'members' ? (
                            <>
                                {/* Live Status & Circle Management Bar */}
                                <div className={`px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-3 ${
                                    isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100 shadow-sm'
                                }`}>
                                    <div
                                        onClick={() => onOpenCircleSettings && onOpenCircleSettings('circles')}
                                        className={`min-w-0 flex-1 ${onOpenCircleSettings ? 'cursor-pointer group' : ''}`}
                                        title="Switch or Manage Circles"
                                    >
                                        <div className="flex items-center gap-1.5 text-[9px] text-indigo-400 font-bold uppercase tracking-wider group-hover:text-indigo-300 transition-colors">
                                            <Users className="w-3.5 h-3.5 shrink-0" />
                                            <span>{summaryCircleName}</span>
                                            {onOpenCircleSettings && <span className="text-[8px]">▾</span>}
                                        </div>
                                        <h3 className={`text-sm font-black truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                            {activeCount} Active Now
                                        </h3>
                                        <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-500'}`} aria-label="Live circle status">
                                            <span className="inline-flex items-center gap-1">
                                                <Home className="w-2.5 h-2.5 text-indigo-400" />
                                                {homeCount} home
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Car className="w-2.5 h-2.5 text-sky-400" />
                                                {drivingCount} driving
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Navigation className="w-2.5 h-2.5 text-emerald-400" />
                                                {movingCount} moving
                                            </span>
                                            {staleLocationCount > 0 && (
                                                <span className="inline-flex items-center gap-1 text-amber-500" title="Members with an older last-known location">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    {staleLocationCount} stale
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {onOpenCircleSettings && (
                                            <button
                                                onClick={() => onOpenCircleSettings('manage')}
                                                className={`px-2 py-1 rounded-xl text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                                                    isDark ? 'bg-white/10 hover:bg-white/15 text-slate-200' : 'bg-white hover:bg-slate-100 text-slate-700 shadow-sm'
                                                }`}
                                                title="Circle Settings & Management"
                                            >
                                                <Settings className="w-3.5 h-3.5 shrink-0" />
                                                <span>Settings</span>
                                            </button>
                                        )}
                                        <div className="flex -space-x-2">
                                            {summaryMembers.slice(0, 3).map(m => (
                                                <img
                                                    key={m.id}
                                                    src={getSafeAvatarUrl(m.avatar, m.name || m.id)}
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(m.name || m.id);
                                                    }}
                                                    alt={m.name}
                                                    className={`w-7 h-7 rounded-full border-2 ${isDark ? 'border-slate-900 bg-slate-800' : 'border-white bg-slate-100'} shadow-sm object-cover`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Quick Circle Filter Chips (When multiple circles exist) */}
                                {userCircles.length > 1 && (
                                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                                        <button
                                            type="button"
                                            onClick={() => onSelectFilterCircle?.('all')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                                activeFilterCircleId === 'all'
                                                    ? 'bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600 text-white shadow-md'
                                                    : isDark ? 'bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300' : 'bg-slate-100 border border-slate-200 text-slate-700'
                                            }`}
                                        >
                                            <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                            <span>All Groups ({members.length})</span>
                                        </button>
                                        {userCircles.map(c => {
                                            const cColor = c.color || getCircleColor(c.id).hex;
                                            const isSelected = activeFilterCircleId === c.id;
                                            const count = members.filter(m => m.circleId === c.id).length;
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => onSelectFilterCircle?.(c.id)}
                                                    style={{
                                                        borderColor: isSelected ? cColor : undefined,
                                                        backgroundColor: isSelected ? `${cColor}2b` : undefined,
                                                        color: isSelected ? '#ffffff' : undefined
                                                    }}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 border cursor-pointer ${
                                                        isSelected
                                                            ? 'ring-1 shadow-sm'
                                                            : isDark ? 'bg-white/5 border-white/10 text-slate-300 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-700'
                                                    }`}
                                                >
                                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cColor }} />
                                                    <span>{c.name}</span>
                                                    {count > 0 && <span className="opacity-75 text-[10px]">({count})</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Members List */}
                                <div className="space-y-2">
                                    {members.map(member => {
                                        const memberCircle = userCircles.find(circle => circle.id === member.circleId);
                                        const memberCircleHex = memberCircle?.color || member.circleColor || (member.circleId ? getCircleColor(member.circleId).hex : '#6366f1');
                                        const isUnresolved = !member.companionDeviceLabel && (!member.location || (member.location.lat === 0 && member.location.lng === 0));
                                        const needsSyncUpdate = isOlderCircleSyncProtocol(member.syncProtocolVersion);
                                        const isSelf = Boolean(
                                            (currentUserId && member.id === currentUserId) ||
                                            member.id === 'demo-you' ||
                                            (member as any).isSelf
                                        );
                                        const viewerLabel = getMemberViewerLabel(member);
                                        const isDesktopViewer = viewerLabel === 'Desktop';
                                        return (
                                        <div
                                            key={member.id}
                                            onClick={() => onSelect(member.id)}
                                            className={`p-3 rounded-2xl border flex flex-col gap-2 transition-all cursor-pointer ${
                                                isUnresolved
                                                    ? isDark
                                                        ? 'bg-amber-950/10 border-amber-500/25 border-dashed opacity-80 hover:opacity-100'
                                                        : 'bg-amber-50/40 border-amber-300/50 border-dashed opacity-85 hover:opacity-100 shadow-sm'
                                                    : selectedId === member.id
                                                        ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50'
                                                        : isDark
                                                            ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                                    : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                            }`}
                                            style={{
                                                borderColor: selectedId === member.id ? memberCircleHex : `${memberCircleHex}55`,
                                                boxShadow: `inset 4px 0 0 ${memberCircleHex}`
                                            }}
                                        >
                                            <div className="flex items-center gap-3">
                                                {/* Avatar with Status Ring */}
                                                <div className="shrink-0 w-12 flex items-center justify-center relative">
                                                    <MemberAvatarWithRing
                                                        member={member}
                                                        size="md"
                                                        theme={isDark ? 'dark' : 'light'}
                                                        isSelected={selectedId === member.id}
                                                        isUnresolved={isUnresolved}
                                                        renderStatusBadge={true}
                                                    />
                                                </div>

                                                {/* Info */}
                                                <div className="flex-1 text-left min-w-0">
                                                    <div className="flex items-center justify-between gap-1.5">
                                                        <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                                                            {(() => {
                                                                const circleBadgesList = (member.circleBadges && member.circleBadges.length > 0)
                                                                    ? member.circleBadges
                                                                    : (member.circleName || (hasCircle && circleName))
                                                                        ? [{
                                                                            id: member.circleId || 'primary',
                                                                            name: member.circleName || (circleName ? (circleName.toUpperCase().includes('FAMILY') ? 'FAM' : circleName.slice(0, 8)) : 'FAM'),
                                                                            color: memberCircleHex
                                                                        }]
                                                                        : [];
                                                                return (
                                                                    <>
                                                                        <h4 className={`font-black text-sm truncate max-w-[110px] shrink-0 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                                                            {member.name}
                                                                        </h4>
                                                                        {isSelf && (
                                                                            <span className={`text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md border shrink-0 ${
                                                                                isDark ? 'bg-indigo-500/20 border-indigo-400/35 text-indigo-200' : 'bg-indigo-50 border-indigo-200 text-indigo-600'
                                                                            }`}>
                                                                                You
                                                                            </span>
                                                                        )}
                                                                        {circleBadgesList.map(b => (
                                                                            <CircleMembershipBadge key={b.id} name={b.name} color={b.color || memberCircleHex} />
                                                                        ))}
                                                                        {viewerLabel && (
                                                                            <span className={`text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md border shrink-0 flex items-center gap-1 ${
                                                                                isDark ? 'bg-sky-500/20 border-sky-400/35 text-sky-300' : 'bg-sky-50 border-sky-200 text-sky-600'
                                                                            }`}>
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                                                                                <span>{viewerLabel}</span>
                                                                            </span>
                                                                        )}
                                                                    </>
                                                                );
                                                            })()}
                                                            {isUnresolved && (
                                                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 ${
                                                                    isDark
                                                                        ? 'bg-amber-500/25 border-amber-400/50 text-amber-300 font-extrabold shadow-sm'
                                                                        : 'bg-amber-100 border-amber-400 text-amber-900 font-extrabold shadow-sm'
                                                                }`}>
                                                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDark ? 'bg-amber-300' : 'bg-amber-700'} animate-pulse`} />
                                                                    <span>Locating…</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {onOpenContacts && !(
                                                                (currentUserId && member.id === currentUserId) ||
                                                                member.id === 'demo-you' ||
                                                                (member as any).isSelf
                                                            ) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onOpenContacts(member.id);
                                                                    }}
                                                                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-105 active:scale-95 shrink-0 cursor-pointer ${
                                                                        isDark
                                                                            ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 hover:border-indigo-400/50'
                                                                            : 'bg-indigo-50 border-indigo-200/80 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-300 shadow-xs'
                                                                    }`}
                                                                    title={`Text or call ${member.name}`}
                                                                >
                                                                    <MessageSquare className="w-4 h-4 shrink-0" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {(member.companionDeviceLabel && !member.companionDeviceLabel.toLowerCase().includes('desktop')) ? (
                                                        <div className="text-[11px] font-medium text-sky-400/90 flex items-center gap-1.5 truncate mt-0.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block shrink-0" />
                                                            <span className="truncate">{member.companionDeviceLabel}</span>
                                                        </div>
                                                    ) : isUnresolved ? (
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            <div className={`text-[11px] font-semibold flex items-center gap-1.5 truncate ${isDark ? 'text-amber-300/90' : 'text-amber-800'}`}>
                                                                <span className={`w-1.5 h-1.5 rounded-full animate-ping inline-block shrink-0 ${isDark ? 'bg-amber-400' : 'bg-amber-600'}`} />
                                                                <span className="truncate">Waiting for device signal…</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="min-w-0 flex items-center gap-1.5 mt-0.5">
                                                            <MemberStatusText
                                                                member={member}
                                                                places={userPlaces}
                                                                hasDesktopBadge={isDesktopViewer}
                                                                className={`text-[11px] font-medium truncate ${
                                                                    isDark ? 'text-slate-400' : 'text-slate-500'
                                                                }`}
                                                            />
                                                        </div>
                                                    )}
                                                    {needsSyncUpdate && (
                                                        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black text-amber-500">
                                                            <AlertTriangle className="h-3 w-3" />
                                                            Update needed for live sync
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Speed Indicator */}
                                                {(member.status === 'Driving' || member.status === 'Walking' || member.status === 'Moving') && member.speed > 0 && (
                                                    <div className="text-center shrink-0 pl-1">
                                                        <div className={`text-sm font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                                            {Math.round(member.speed)}
                                                        </div>
                                                        <div className="text-[8px] text-slate-500 font-bold uppercase">mph</div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Live Driving / Convoy Action Badge */}
                                            {member.currentTrip && (
                                                <div className={`p-2 rounded-xl border flex items-center gap-2 ${
                                                    isDark
                                                        ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-200'
                                                        : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                                                }`}>
                                                    <Car className="w-3.5 h-3.5 shrink-0 text-indigo-400 animate-pulse" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center justify-between gap-1">
                                                            <p className="text-[9px] font-black uppercase tracking-wider text-indigo-400">
                                                                En Route • {member.currentTrip.totalTime}
                                                            </p>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    convoyService.joinConvoy(member.id);
                                                                    if (showNotification) showNotification(`Linked into convoy with ${member.name}!`);
                                                                }}
                                                                className="px-2 py-0.5 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-[8px] font-black shadow-sm flex items-center gap-1 active:scale-95"
                                                            >
                                                                <Car className="w-3 h-3 shrink-0" />
                                                                <span>Join Convoy</span>
                                                            </button>
                                                        </div>
                                                        <p className="text-xs font-bold truncate mt-0.5">
                                                            {member.currentTrip.destinationName}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                    {/* Add Member / Invite to Circle Button */}
                                    <AddMemberButton
                                        onClick={handleAddMember}
                                        theme={isDark ? 'dark' : 'light'}
                                        label="Add Member"
                                        className="mt-0.5"
                                    />
                                </div>

                                {/* ─── HISTORY & ACCESS SECTION (MOBILE BENTO GRID) ─── */}
                                <div className="space-y-2 pt-2">
                                    <h4 className={`text-[10px] font-black uppercase tracking-wider px-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                        History & Access
                                    </h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {onOpenTripHistory && (
                                            <button
                                                onClick={onOpenTripHistory}
                                                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95 cursor-pointer min-h-[52px] ${
                                                    isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                                title="My Trips"
                                            >
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isDark ? 'bg-indigo-500/15 text-indigo-400' : 'bg-indigo-50 text-indigo-600'
                                                }`}>
                                                    <Navigation className="w-4 h-4" />
                                                </div>
                                                <span className={`text-xs font-bold leading-snug truncate ${isDark ? 'text-white' : 'text-slate-800'}`}>
                                                    My Trips
                                                </span>
                                            </button>
                                        )}
                                        {onOpenWeeklyReport && (
                                            <button
                                                onClick={onOpenWeeklyReport}
                                                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95 cursor-pointer min-h-[52px] ${
                                                    isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                                title="Scorecard"
                                            >
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-600'
                                                }`}>
                                                    <Trophy className="w-4 h-4" />
                                                </div>
                                                <span className={`text-xs font-bold leading-snug truncate ${isDark ? 'text-white' : 'text-slate-800'}`}>
                                                    Scorecard
                                                </span>
                                            </button>
                                        )}
                                        {onOpenNotifications && (
                                            <button
                                                onClick={onOpenNotifications}
                                                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95 cursor-pointer min-h-[52px] ${
                                                    isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                                title="My Alerts"
                                            >
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-sky-50 text-sky-600'
                                                }`}>
                                                    <Bell className="w-4 h-4" />
                                                </div>
                                                <span className={`text-xs font-bold leading-snug truncate ${isDark ? 'text-white' : 'text-slate-800'}`}>
                                                    My Alerts
                                                </span>
                                            </button>
                                        )}
                                        {onOpenMaintenance && (
                                            <button
                                                onClick={onOpenMaintenance}
                                                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95 cursor-pointer min-h-[52px] ${
                                                    isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                                title="My Garage & Maintenance"
                                            >
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isDark ? 'bg-rose-500/15 text-rose-400' : 'bg-rose-50 text-rose-600'
                                                }`}>
                                                    <Wrench className="w-4 h-4" />
                                                </div>
                                                <span className={`text-[11px] font-bold leading-tight line-clamp-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                                                    My Garage & Maintenance
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* ─── EMERGENCY SOS ACTION ─── */}
                                {onSOS && (
                                    <div className="pt-2">
                                        <HoldToActivate
                                            onActivate={onSOS}
                                            duration={1500}
                                            className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl bg-red-500/15 border border-red-500/30 active:scale-95 transition-all shadow-lg active:ring-2 active:ring-red-500/50"
                                        >
                                            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                                            <span className="text-xs text-red-500 font-extrabold uppercase tracking-wider">Emergency SOS (Hold)</span>
                                        </HoldToActivate>
                                    </div>
                                )}
                            </>
                        ) : activeTab === 'places' ? (
                            /* ─── SAVED PLACES TAB ─── */
                            <div className="space-y-3">
                                {/* Header / Add Place Action */}
                                <div className="flex items-center justify-between px-1">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        Saved Geofences ({userPlaces.length})
                                    </p>
                                    {userLocation && onAddPlace && (
                                        <button
                                            onClick={() => setShowAddCustomPlace(!showAddCustomPlace)}
                                            className="px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider bg-indigo-600 text-white active:scale-95 transition-all shadow-sm"
                                        >
                                            {showAddCustomPlace ? 'Cancel' : '+ Pin Current'}
                                        </button>
                                    )}
                                </div>

                                {/* Add Custom Place Inline Form */}
                                {showAddCustomPlace && userLocation && onAddPlace && (
                                    <div className={`p-3.5 rounded-2xl border space-y-2.5 ${
                                        isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                                    }`}>
                                        <p className="text-xs font-black text-indigo-400">Pin Current Location</p>
                                        <input
                                            type="text"
                                            placeholder="Place Name (e.g. Favorite Spot)"
                                            value={customPlaceName}
                                            onChange={(e) => setCustomPlaceName(e.target.value)}
                                            className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${
                                                isDark ? 'bg-slate-800/80 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                            }`}
                                        />
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Category</span>
                                            <div className="grid grid-cols-4 gap-1.5">
                                                {BOTTOM_SHEET_PLACE_CATEGORIES.map((cat) => {
                                                    const isSelected = customPlaceIcon === cat.icon;
                                                    const IconComp = cat.iconComp;
                                                    return (
                                                        <button
                                                            key={cat.type}
                                                            type="button"
                                                            onClick={() => {
                                                                setCustomPlaceIcon(cat.icon);
                                                                setCustomPlaceType(cat.type as any);
                                                            }}
                                                            className={`p-1.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer group ${
                                                                isSelected
                                                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/30'
                                                                    : isDark
                                                                        ? 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                                                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                                                            }`}
                                                            title={cat.label}
                                                        >
                                                            <IconComp className={`w-4 h-4 shrink-0 transition-colors ${isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-400'}`} />
                                                            <span className={`text-[8px] font-bold truncate ${isSelected ? 'text-white' : ''}`}>{cat.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleSaveCustomPlace}
                                            disabled={!customPlaceName.trim()}
                                            className="w-full py-2 bg-indigo-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-all cursor-pointer"
                                        >
                                            Save Place
                                        </button>
                                    </div>
                                )}

                                {/* Places List */}
                                {userPlaces.length === 0 ? (
                                    <div className={`p-6 rounded-2xl border text-center space-y-2 ${
                                        isDark ? 'bg-white/5 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'
                                    }`}>
                                        <div className="w-12 h-12 rounded-2xl bg-slate-800/40 border border-white/5 flex items-center justify-center mx-auto mb-2 text-slate-500">
                                            <MapPin className="w-6 h-6" />
                                        </div>
                                        <p className="text-xs font-bold">No Saved Places Yet</p>
                                        <p className="text-[10px] leading-relaxed">
                                            Search for any location and tap ⭐ Star to save it as a family geofence.
                                        </p>
                                    </div>
                                ) : (
                                    userPlaces.map(place => {
                                        const isSelected = selectedPlaceId === place.id;
                                        const distanceStr = formatDistance(place.location);
                                        const radiusMeters = Math.round((place.radius || 0.15) * 1000);
                                        const membersInside = members.filter(m => {
                                            const dist = getDistanceMeters(m.location, place.location);
                                            return dist <= (place.radius || 0.15) * 1000;
                                        });

                                        return (
                                            <div
                                                key={place.id}
                                                onClick={() => onSelectPlace?.(place)}
                                                className={`p-3 rounded-2xl border flex flex-col gap-2 transition-all active:scale-[0.99] cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-indigo-600/20 border-indigo-500/40'
                                                        : isDark
                                                            ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                                            : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                                        isDark ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'
                                                    }`}>
                                                        {renderPlaceIcon(place.icon, place.type, place.name)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-1">
                                                            <h4 className={`font-black text-sm truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
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

                                                {/* Member presence */}
                                                {membersInside.length > 0 && (
                                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/20">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                                        <span className="text-[10px] font-bold text-emerald-400 truncate">
                                                            {membersInside.map(m => m.name).join(', ')} is here
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Quick Actions Row */}
                                                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                                                    {onNavigatePlace && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onNavigatePlace(place);
                                                            }}
                                                            className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
                                                        >
                                                            <Navigation className="w-3.5 h-3.5 fill-current shrink-0" />
                                                            <span>Navigate Here</span>
                                                        </button>
                                                    )}
                                                    {onEditPlace && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onEditPlace(place);
                                                            }}
                                                            className="p-1.5 px-2.5 rounded-xl border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 text-xs font-bold active:scale-95 transition-all cursor-pointer"
                                                            title="Edit Place & Geofence"
                                                        >
                                                            <Edit3 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {onDeletePlace && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (window.confirm(`Delete "${place.name}" from saved places?`)) {
                                                                    onDeletePlace(place.id);
                                                                }
                                                            }}
                                                            className="p-1.5 px-2.5 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 text-xs font-bold active:scale-95 transition-all"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        ) : (
                            /* ─── ACTIVITY LOG TAB ─── */
                            <ActivityLog
                                activities={activities}
                                members={members}
                                onResolveSOS={onResolveSOS}
                                theme={theme}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    </>
);
};

export default BottomSheet;
