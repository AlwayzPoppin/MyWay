import React, { useState, useRef } from 'react';
import { FamilyMember, Place, Location } from '../types';
import { getDistanceMeters, getDistanceMiles } from '../utils/geo';
import { convoyService } from '../services/convoyService';
import HoldToActivate from './HoldToActivate';
import ActivityLog from './ActivityLog';
import CircleManager from './CircleManager';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { FamilyCircle, getCircleColor } from '../services/authService';

interface BottomSheetProps {
    members: FamilyMember[];
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
    avgGasPrice?: string;
    showNotification?: (msg: string, duration?: number) => void;
    onOpenSettings?: () => void;
    onOpenTripHistory?: () => void;
    onOpenNotifications?: () => void;
    onOpenWeeklyReport?: () => void;
    onOpenInviteShare?: () => void;
    onOpenMaintenance?: () => void;
    onSOS?: () => void;
    activities?: any[];
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
}

const BottomSheet: React.FC<BottomSheetProps> = ({
    members,
    selectedId,
    onSelect,
    theme,
    hasCircle = true,
    inviteCode,
    circleName,
    userCircles = [],
    activeFilterCircleId = 'all',
    onSelectFilterCircle,
    onOpenCircleSettings,
    onCreateCircle,
    onJoinCircle,
    avgGasPrice = '$3.45',
    showNotification,
    onOpenSettings,
    onOpenTripHistory,
    onOpenNotifications,
    onOpenWeeklyReport,
    onOpenInviteShare,
    onOpenMaintenance,
    onSOS,
    activities = [],
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
    const [showAddCustomPlace, setShowAddCustomPlace] = useState(false);
    const [customPlaceName, setCustomPlaceName] = useState('');
    const [customPlaceIcon, setCustomPlaceIcon] = useState('📍');
    const [customPlaceType, setCustomPlaceType] = useState<'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other'>('other');
    const sheetRef = useRef<HTMLDivElement>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        setDragStart(e.touches[0].clientY);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (dragStart === null) return;
        const diff = dragStart - e.touches[0].clientY;
        if (diff > 45 && !isExpanded) setExpanded(true);
        if (diff < -45 && isExpanded) setExpanded(false);
    };

    const handleTouchEnd = () => {
        setDragStart(null);
    };

    const getBatteryColor = (battery: number) => {
        if (battery <= 20) return '#ef4444';
        if (battery <= 50) return '#f59e0b';
        return '#22c55e';
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Driving': return '#818cf8';
            case 'Walking': return '#38bdf8';
            case 'Moving': return '#38bdf8';
            case 'Stationary': return '#34d399';
            case 'Offline': return '#64748b';
            default: return '#6b7280';
        }
    };

    const getStatusIcon = (status: string, currentPlace?: string) => {
        if (currentPlace && status === 'Stationary') return '🏠';
        switch (status) {
            case 'Driving': return '🚗';
            case 'Walking': return '🚶';
            case 'Moving': return '🚶';
            case 'Stationary': return '📍';
            case 'Offline': return '💤';
            default: return '📍';
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
    const activeCount = members.filter(m => m.status !== 'Offline').length;

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
                className={`fixed bottom-0 left-0 right-0 z-[100] bottom-sheet safe-bottom transition-all duration-300 ease-out
                    ${isDark
                        ? 'bg-gradient-to-t from-[#090d16] via-[#0f172a]/98 to-[#0f172a]/95'
                        : 'bg-gradient-to-t from-slate-50 via-white/98 to-white/95'}
                    backdrop-blur-2xl border-t ${isDark ? 'border-white/10' : 'border-slate-200'}
                    rounded-t-[28px] shadow-[0_-10px_60px_rgba(0,0,0,0.35)] flex flex-col`}
                style={{
                    height: isExpanded ? '78vh' : '100px',
                    transform: 'translateY(0)'
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Drag Handle Bar */}
                <div
                    className="pt-2.5 pb-1 flex items-center justify-center cursor-grab active:cursor-grabbing shrink-0"
                    onClick={() => setExpanded(!isExpanded)}
                >
                <div className={`w-10 h-1.5 rounded-full transition-colors ${isDark ? 'bg-white/25 hover:bg-white/40' : 'bg-slate-300 hover:bg-slate-400'}`} />
            </div>

            {/* ─── COLLAPSED PEEK VIEW ─── */}
            {!isExpanded && (
                <div className="px-4 flex items-center justify-between gap-2 h-16 shrink-0">
                    {/* Avatars Carousel */}
                    <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
                        {members.map((member, index) => (
                            <button
                                key={member.id}
                                onClick={() => {
                                    onSelect(member.id);
                                    setExpanded(true);
                                }}
                                className={`relative transition-all duration-300 shrink-0 ${selectedId === member.id ? 'scale-110 z-10' : 'hover:scale-105 active:scale-95'}`}
                                style={{ animationDelay: `${index * 50}ms` }}
                                title={`${member.name} (${member.status})`}
                            >
                                {/* Status Ring */}
                                <div
                                    className="absolute -inset-1 rounded-full"
                                    style={{
                                        border: `2.5px solid ${getStatusColor(member.status)}`,
                                        opacity: selectedId === member.id ? 1 : 0.65
                                    }}
                                />

                                <img
                                    src={getSafeAvatarUrl(member.avatar, member.name || member.id)}
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(member.name || member.id);
                                    }}
                                    alt={member.name}
                                    className={`w-11 h-11 rounded-full object-cover border-2 ${
                                        isDark ? 'border-slate-800 bg-slate-800' : 'border-white bg-slate-100'
                                    } shadow-md ${member.isGhostMode ? 'blur-[1.5px] grayscale opacity-75' : ''}`}
                                />

                                {/* Status Icon Badge */}
                                <div
                                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border flex items-center justify-center text-[8px]"
                                    style={{
                                        backgroundColor: getStatusColor(member.status),
                                        borderColor: isDark ? '#0f172a' : 'white'
                                    }}
                                >
                                    {member.currentTrip ? '🚗' : getStatusIcon(member.status, member.currentPlace)}
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Quick Places & Hub Toggle on Collapsed Bar */}
                    <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-white/10">
                        {userPlaces.slice(0, 1).map(p => (
                            <button
                                key={p.id}
                                onClick={() => onSelectPlace?.(p)}
                                className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95
                                    ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-100 border-slate-200 text-slate-800'}`}
                            >
                                <span>{p.icon}</span>
                                <span className="truncate max-w-[60px]">{p.name}</span>
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
                            <span>⚡</span>
                            <span>Hub</span>
                            <span className="text-[10px] opacity-70">▲</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ─── EXPANDED FULL DRAWER (DESKTOP FEATURE PARITY) ─── */}
            {isExpanded && (
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
                            {hasCircle && (
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                        🛡️ {members.length} Protected
                                    </span>
                                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                        ⛽ {avgGasPrice}
                                    </span>
                                </div>
                            )}
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
                                <span className="text-xs">▼</span>
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
                                <span>👥</span>
                                <span>CIRCLE ({members.length})</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('places')}
                                className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 ${
                                    activeTab === 'places'
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <span>📍</span>
                                <span>PLACES ({userPlaces.length})</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('activity')}
                                className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 ${
                                    activeTab === 'activity'
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <span>📜</span>
                                <span>LOG ({activities.length})</span>
                            </button>
                        </div>
                    </div>

                    {/* ─── TAB CONTENT (SCROLLABLE) ─── */}
                    <div className="flex-1 overflow-y-auto no-scrollbar space-y-3.5 pb-6">
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
                                        <div className="flex items-center gap-1 text-[9px] text-indigo-400 font-bold uppercase tracking-wider group-hover:text-indigo-300 transition-colors">
                                            <span>👥 {circleName || 'Family Circle'}</span>
                                            {onOpenCircleSettings && <span className="text-[8px]">▾</span>}
                                        </div>
                                        <h3 className={`text-sm font-black truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                            {activeCount} Active Now
                                        </h3>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {onOpenCircleSettings && (
                                            <button
                                                onClick={() => onOpenCircleSettings('manage')}
                                                className={`px-2 py-1 rounded-xl text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer ${
                                                    isDark ? 'bg-white/10 hover:bg-white/15 text-slate-200' : 'bg-white hover:bg-slate-100 text-slate-700 shadow-sm'
                                                }`}
                                                title="Circle Settings & Management"
                                            >
                                                <span>⚙️</span>
                                                <span>Settings</span>
                                            </button>
                                        )}
                                        <div className="flex -space-x-2">
                                            {members.slice(0, 3).map(m => (
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
                                            <span>✨</span>
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
                                        const memberCircleHex = member.circleColor || '#6366f1';
                                        return (
                                        <div
                                            key={member.id}
                                            onClick={() => onSelect(member.id)}
                                            className={`p-3 rounded-2xl border flex flex-col gap-2 transition-all cursor-pointer ${
                                                selectedId === member.id
                                                    ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50'
                                                    : isDark
                                                        ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                                        : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                {/* Avatar */}
                                                <div className="relative shrink-0">
                                                    <img
                                                        src={getSafeAvatarUrl(member.avatar, member.name || member.id)}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(member.name || member.id);
                                                        }}
                                                        alt={member.name}
                                                        style={{ borderColor: memberCircleHex }}
                                                        className={`w-11 h-11 rounded-xl object-cover border-2 ${isDark ? 'bg-slate-800' : 'bg-slate-100'} ${
                                                            selectedId === member.id ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900' : ''
                                                        } ${member.isGhostMode ? 'blur-[1.5px] grayscale opacity-75' : ''}`}
                                                    />
                                                    <div
                                                        className="absolute -bottom-1 -right-1 w-4.5 h-4.5 rounded-lg flex items-center justify-center text-[10px] border border-slate-900"
                                                        style={{ backgroundColor: getStatusColor(member.status) }}
                                                    >
                                                        {member.currentTrip ? '🚗' : getStatusIcon(member.status, member.currentPlace)}
                                                    </div>
                                                </div>

                                                {/* Info */}
                                                <div className="flex-1 text-left min-w-0">
                                                    <div className="flex items-center justify-between gap-1">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <h4 className={`font-black text-sm truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                                                {member.name}
                                                                {member.name === 'You' && <span className="ml-1 text-xs text-indigo-400 font-bold">(You)</span>}
                                                            </h4>
                                                            {member.circleName && (
                                                                <span
                                                                    style={{
                                                                        backgroundColor: `${memberCircleHex}22`,
                                                                        borderColor: `${memberCircleHex}44`,
                                                                        color: memberCircleHex
                                                                    }}
                                                                    className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded border flex items-center gap-1 shrink-0"
                                                                >
                                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: memberCircleHex }} />
                                                                    <span className="truncate max-w-[70px]">{member.circleName}</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0 ${
                                                            member.battery <= 20 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                                        }`}>
                                                            {member.battery <= 20 ? '🪫' : '🔋'} {member.battery}%
                                                        </span>
                                                    </div>
                                                    <div className={`text-[11px] font-medium truncate ${
                                                        member.currentPlace && member.status === 'Stationary' ? 'text-emerald-400 font-semibold' :
                                                        member.status === 'Driving' ? 'text-indigo-400' :
                                                        member.status === 'Walking' || member.status === 'Moving' ? 'text-sky-400' :
                                                        member.status === 'Stationary' ? 'text-emerald-400' :
                                                        isDark ? 'text-slate-400' : 'text-slate-500'
                                                    }`}>
                                                        {member.currentPlace
                                                            ? (member.status === 'Stationary' ? `At ${member.currentPlace}` : `${member.status} • ${member.currentPlace}`)
                                                            : (member.status === 'Driving' ? `Driving ${member.speed > 0 ? `• ${member.speed} MPH` : ''}` :
                                                               member.status === 'Walking' || member.status === 'Moving' ? `Walking ${member.speed > 0 ? `• ${member.speed} MPH` : ''}` :
                                                               'Stationary')}
                                                    </div>
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
                                                    <span className="text-sm shrink-0 animate-pulse">🚗</span>
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
                                                                    if (showNotification) showNotification(`🚗 Linked into convoy with ${member.name}!`);
                                                                }}
                                                                className="px-2 py-0.5 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-[8px] font-black shadow-sm flex items-center gap-1 active:scale-95"
                                                            >
                                                                <span>🚗🚗</span>
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
                                                className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                                                    isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                            >
                                                <span className="text-xl">🛣️</span>
                                                <div>
                                                    <p className={`text-xs font-bold leading-none ${isDark ? 'text-white' : 'text-slate-800'}`}>My Trips</p>
                                                    <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Journeys</p>
                                                </div>
                                            </button>
                                        )}
                                        {onOpenWeeklyReport && (
                                            <button
                                                onClick={onOpenWeeklyReport}
                                                className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                                                    isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                            >
                                                <span className="text-xl">📊</span>
                                                <div>
                                                    <p className={`text-xs font-bold leading-none ${isDark ? 'text-white' : 'text-slate-800'}`}>My Logs</p>
                                                    <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Insights</p>
                                                </div>
                                            </button>
                                        )}
                                        {onOpenNotifications && (
                                            <button
                                                onClick={onOpenNotifications}
                                                className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                                                    isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                            >
                                                <span className="text-xl">🔔</span>
                                                <div>
                                                    <p className={`text-xs font-bold leading-none ${isDark ? 'text-white' : 'text-slate-800'}`}>My Alerts</p>
                                                    <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Alerts</p>
                                                </div>
                                            </button>
                                        )}
                                        {onOpenInviteShare && (
                                            <button
                                                onClick={onOpenInviteShare}
                                                className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                                                    isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                            >
                                                <span className="text-xl">📤</span>
                                                <div>
                                                    <p className={`text-xs font-bold leading-none ${isDark ? 'text-white' : 'text-slate-800'}`}>My Invites</p>
                                                    <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Access</p>
                                                </div>
                                            </button>
                                        )}
                                        {onOpenMaintenance && (
                                            <button
                                                onClick={onOpenMaintenance}
                                                className={`col-span-2 flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all active:scale-95 ${
                                                    isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'
                                                }`}
                                            >
                                                <span className="text-xl">🔧</span>
                                                <div className="flex-1">
                                                    <p className={`text-xs font-bold leading-none ${isDark ? 'text-white' : 'text-slate-800'}`}>My Maintenance</p>
                                                    <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Mileage, Fuel & Health</p>
                                                </div>
                                                <span className="text-xs text-indigo-400 font-bold">Open →</span>
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
                                            <span className="text-xl">🚨</span>
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
                                        <div className="flex gap-2">
                                            <select
                                                value={customPlaceIcon}
                                                onChange={(e) => setCustomPlaceIcon(e.target.value)}
                                                className={`px-2.5 py-1.5 rounded-xl border text-xs outline-none ${
                                                    isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                                }`}
                                            >
                                                <option value="📍">📍 Pin</option>
                                                <option value="🏠">🏠 Home</option>
                                                <option value="🏢">🏢 Work</option>
                                                <option value="🎓">🎓 School</option>
                                                <option value="💪">💪 Gym</option>
                                                <option value="🍔">🍔 Food</option>
                                                <option value="☕">☕ Coffee</option>
                                            </select>
                                            <select
                                                value={customPlaceType}
                                                onChange={(e) => setCustomPlaceType(e.target.value as any)}
                                                className={`flex-1 px-2.5 py-1.5 rounded-xl border text-xs outline-none ${
                                                    isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                                }`}
                                            >
                                                <option value="other">General</option>
                                                <option value="home">Home</option>
                                                <option value="work">Work</option>
                                                <option value="school">School</option>
                                                <option value="gym">Gym</option>
                                                <option value="food">Food</option>
                                                <option value="gas">Gas Station</option>
                                            </select>
                                            <button
                                                onClick={handleSaveCustomPlace}
                                                disabled={!customPlaceName.trim()}
                                                className="px-4 py-1.5 bg-indigo-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-all"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Places List */}
                                {userPlaces.length === 0 ? (
                                    <div className={`p-6 rounded-2xl border text-center space-y-2 ${
                                        isDark ? 'bg-white/5 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'
                                    }`}>
                                        <span className="text-3xl block">📍</span>
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
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border ${
                                                        isDark ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'
                                                    }`}>
                                                        {place.icon || '📍'}
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
                                                            <span>🚀</span> Navigate Here
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
                                                            ✏️
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
                                                            🗑️
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
