import React from 'react';
import { FamilyMember, Place, Location, ParkedVehiclePlace } from '../types';
import { parkingService } from '../services/parkingService';
import CircleManager from './CircleManager';
import HoldToActivate from './HoldToActivate';
import ActivityLog from './ActivityLog';
import { getDistanceMeters, getDistanceMiles } from '../utils/geo';
import { convoyService } from '../services/convoyService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { FamilyCircle, getCircleColor } from '../services/authService';
import { MemberStatusText } from '../utils/memberStatus';
import { MemberAvatarWithRing, AddMemberButton } from './MemberCard';
import {
    Settings,
    Shield,
    Fuel,
    Navigation,
    Users,
    MapPin,
    Battery,
    MessageSquare,
    Bell,
    Share2,
    Wrench,
    Trophy,
    AlertTriangle,
    Sparkles,
    ChevronLeft,
    Car,
    Radio,
    Home,
    Briefcase,
    Edit3,
    Trash2,
    EyeOff,
    GraduationCap,
    Clock,
    Building2,
    Dumbbell,
    Utensils,
    Coffee
} from 'lucide-react';

const SIDEBAR_PLACE_CATEGORIES = [
    { type: 'home', icon: '🏠', iconComp: Home, label: 'Home' },
    { type: 'work', icon: '💼', iconComp: Briefcase, label: 'Work' },
    { type: 'school', icon: '🏫', iconComp: GraduationCap, label: 'School' },
    { type: 'gym', icon: '🏋️', iconComp: Dumbbell, label: 'Gym' },
    { type: 'food', icon: '🍔', iconComp: Utensils, label: 'Food' },
    { type: 'coffee', icon: '☕', iconComp: Coffee, label: 'Coffee' },
    { type: 'gas', icon: '⛽', iconComp: Fuel, label: 'Gas' },
    { type: 'other', icon: '📍', iconComp: MapPin, label: 'Other' },
];

interface BentoSidebarProps {
    members: FamilyMember[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    theme: 'light' | 'dark';
    hasCircle: boolean;
    circleName?: string;
    userCircles?: FamilyCircle[];
    activeFilterCircleId?: string | 'all';
    onSelectFilterCircle?: (circleId: string | 'all') => void;
    onOpenCircleSettings?: (tab?: 'circles' | 'invite' | 'manage') => void;
    inviteCode?: string;
    onCreateCircle: (name: string) => Promise<any>;
    onJoinCircle: (code: string) => Promise<any>;
    showNotification?: (msg: string, duration?: number) => void;
    onOpenSettings?: () => void;
    onOpenTripHistory?: () => void;
    onOpenNotifications?: () => void;
    onOpenWeeklyReport?: () => void;
    onOpenInviteShare?: () => void;
    onOpenMessages?: (recipientId?: string) => void;
    unreadMessagesCount?: number;
    onSOS?: () => void;
    activities?: any[];
    onResolveSOS?: (id: string, memberId?: string) => void;
    userPlaces?: Place[];
    parkedVehicle?: ParkedVehiclePlace | null;
    selectedPlaceId?: string | null;
    onSelectPlace?: (place: Place) => void;
    onAddPlace?: (place: Omit<Place, 'id'>) => void;
    onDeletePlace?: (placeId: string) => void;
    onEditPlace?: (place: Place) => void;
    onNavigatePlace?: (place: Place) => void;
    userLocation?: Location | null;
    onOpenMaintenance?: () => void;
}

const BentoSidebar: React.FC<BentoSidebarProps> = ({
    members,
    selectedId,
    onSelect,
    theme,
    hasCircle,
    circleName,
    userCircles = [],
    activeFilterCircleId = 'all',
    onSelectFilterCircle,
    onOpenCircleSettings,
    inviteCode,
    onCreateCircle,
    onJoinCircle,
    showNotification,
    onOpenSettings,
    onOpenTripHistory,
    onOpenNotifications,
    onOpenWeeklyReport,
    onOpenInviteShare,
    onOpenMessages,
    unreadMessagesCount,
    onSOS,
    activities = [],
    onResolveSOS = () => {},
    userPlaces = [],
    parkedVehicle,
    selectedPlaceId,
    onSelectPlace,
    onAddPlace,
    onDeletePlace,
    onEditPlace,
    onNavigatePlace,
    userLocation,
    onOpenMaintenance
}) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const [sidebarTab, setSidebarTab] = React.useState<'members' | 'places' | 'log'>('members');
    const [showAddCustomPlace, setShowAddCustomPlace] = React.useState(false);
    const [customPlaceName, setCustomPlaceName] = React.useState('');
    const [customPlaceIcon, setCustomPlaceIcon] = React.useState('📍');
    const [customPlaceType, setCustomPlaceType] = React.useState<Place['type']>('custom');

    const renderPlaceIcon = (icon?: string) => {
        switch (icon) {
            case '🏠': return <Home className="w-5 h-5 text-indigo-400 shrink-0" />;
            case '💼':
            case '🏢': return <Briefcase className="w-5 h-5 text-indigo-400 shrink-0" />;
            case '🏫':
            case '🎓': return <GraduationCap className="w-5 h-5 text-indigo-400 shrink-0" />;
            case '🏋️':
            case '💪': return <Dumbbell className="w-5 h-5 text-indigo-400 shrink-0" />;
            case '🍔': return <Utensils className="w-5 h-5 text-indigo-400 shrink-0" />;
            case '☕': return <Coffee className="w-5 h-5 text-indigo-400 shrink-0" />;
            case '⛽': return <Fuel className="w-5 h-5 text-indigo-400 shrink-0" />;
            default: return <MapPin className="w-5 h-5 text-indigo-400 shrink-0" />;
        }
    };

    const renderStatusIcon = (status: string, currentPlace?: string) => {
        if (currentPlace && status === 'Stationary') return <Home className="w-2.5 h-2.5 text-indigo-400 shrink-0" />;
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

    return (
        <div className={`relative h-full overflow-y-auto no-scrollbar border-r transition-all duration-500 ease-in-out
          ${isCollapsed ? 'w-20' : 'w-80'}
          ${theme === 'dark'
                ? 'glass-panel'
                : 'bg-white/95 border-slate-200'}`}
        >
            {/* Top buttons row */}
            <div className="absolute top-4 right-4 z-[100] flex items-center gap-2">
                {/* Settings Button */}
                {onOpenSettings && (
                    <button
                        onClick={onOpenSettings}
                        className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-110 active:scale-90
                            ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                        title="Settings"
                    >
                        <Settings className="w-4 h-4 text-slate-400" />
                    </button>
                )}
                {/* Collapse Toggle */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-110 active:scale-90
                        ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    <ChevronLeft className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
                </button>
            </div>

            <div className={`mt-14 space-y-4 px-3 transition-opacity duration-300 ${isCollapsed ? 'opacity-100' : 'opacity-100'}`}>
                {/* Header Section */}
                {!isCollapsed && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between px-2 animate-in fade-in slide-in-from-left-2">
                            <div className="flex items-center gap-2.5">
                                <img
                                    src="/logo.png"
                                    alt="My Way Logo"
                                    className="w-8 h-8 rounded-xl object-contain shadow-md drop-shadow transition-transform hover:scale-105"
                                />
                                <h2 className={`text-lg font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    My Way
                                </h2>
                            </div>
                            {hasCircle && (
                                <button
                                    onClick={() => {
                                        if (inviteCode) {
                                            navigator.clipboard.writeText(inviteCode);
                                            if (showNotification) {
                                                showNotification(`📋 Invite code copied: ${inviteCode}`, 3000);
                                            }
                                        }
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all
                                        ${theme === 'dark' ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                                >
                                    + Add
                                </button>
                            )}
                        </div>

                        {/* Tabs: Circle | Places | Log */}
                        {hasCircle && (
                            <div className={`flex p-1 rounded-xl border gap-1 mx-1
                              ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}
                            >
                                <button
                                    onClick={() => setSidebarTab('members')}
                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                                        sidebarTab === 'members' 
                                            ? 'bg-indigo-600 text-white shadow-md' 
                                            : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    Circle
                                </button>
                                <button
                                    onClick={() => setSidebarTab('places')}
                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                                        sidebarTab === 'places' 
                                            ? 'bg-indigo-600 text-white shadow-md' 
                                            : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    Places ({userPlaces.length})
                                </button>
                                <button
                                    onClick={() => setSidebarTab('log')}
                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                                        sidebarTab === 'log' 
                                            ? 'bg-indigo-600 text-white shadow-md' 
                                            : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    Log
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {!hasCircle && !isCollapsed ? (
                    <CircleManager
                        theme={theme}
                        onCreateCircle={onCreateCircle}
                        onJoinCircle={onJoinCircle}
                    />
                ) : (
                    <div className="flex flex-col gap-4">
                        {sidebarTab === 'members' ? (
                            <>
                                {/* Summary Card - Hidden when collapsed */}
                                {!isCollapsed && hasCircle && (
                                    <div className={`px-4 py-3 rounded-2xl border transition-all flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2
                                      ${theme === 'dark'
                                            ? 'bg-white/5 border-white/5'
                                            : 'bg-slate-50 border-slate-100 shadow-sm'}`}
                                    >
                                        <div
                                            onClick={() => onOpenCircleSettings && onOpenCircleSettings('circles')}
                                            className={`min-w-0 flex-1 ${onOpenCircleSettings ? 'cursor-pointer group' : ''}`}
                                            title="Switch or Manage Circles"
                                        >
                                            <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 font-bold uppercase tracking-wider group-hover:text-indigo-300 transition-colors">
                                                <Users className="w-3.5 h-3.5 shrink-0" />
                                                <span>{circleName || 'Family Circle'}</span>
                                                {onOpenCircleSettings && <span className="text-[8px]">▾</span>}
                                            </div>
                                            <h3 className={`text-sm font-black truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                {members.filter(m => m.status !== 'Offline').length} Active Now
                                            </h3>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {onOpenCircleSettings && (
                                                <button
                                                    onClick={() => onOpenCircleSettings('manage')}
                                                    className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                                                        theme === 'dark' ? 'bg-white/10 hover:bg-white/15 text-slate-200' : 'bg-white hover:bg-slate-100 text-slate-700 shadow-sm'
                                                    }`}
                                                    title="Circle Settings & Management"
                                                >
                                                    <Settings className="w-3.5 h-3.5 shrink-0" />
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
                                                        className={`w-7 h-7 rounded-full border-2 ${theme === 'dark' ? 'border-slate-800 bg-slate-800' : 'border-white bg-slate-100'} shadow-sm object-cover`}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Quick Circle Filter Chips (When multiple circles exist & not collapsed) */}
                                {!isCollapsed && userCircles.length > 1 && (
                                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1">
                                        <button
                                            type="button"
                                            onClick={() => onSelectFilterCircle?.('all')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                                activeFilterCircleId === 'all'
                                                    ? 'bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600 text-white shadow-md'
                                                    : theme === 'dark' ? 'bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300' : 'bg-slate-100 border border-slate-200 text-slate-700'
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
                                                            : theme === 'dark' ? 'bg-white/5 border-white/10 text-slate-300 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-700'
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

                                {/* Divider */}
                                {!isCollapsed && <div className={`h-px mx-4 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200/50'}`} />}

                                {/* Member Grid/List */}
                                <div className={`grid gap-3 ${isCollapsed ? 'grid-cols-1' : 'grid-cols-1'}`}>
                                    {members.map(member => {
                                        const memberCircleHex = member.circleColor || '#6366f1';
                                        const isUnresolved = !member.location || (member.location.lat === 0 && member.location.lng === 0);
                                        return (
                                        <div
                                            key={member.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => onSelect(member.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onSelect(member.id);
                                                }
                                            }}
                                            className={`group relative flex items-center gap-3 rounded-2xl transition-all cursor-pointer border
                                            ${isCollapsed ? 'p-1.5 justify-center' : 'p-3'}
                                            ${isUnresolved
                                                ? theme === 'dark'
                                                    ? 'bg-amber-950/10 border-amber-500/30 border-dashed opacity-80 hover:opacity-100'
                                                    : 'bg-amber-50/50 border-amber-300/60 border-dashed opacity-85 hover:opacity-100 shadow-sm'
                                                : selectedId === member.id
                                                    ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50 glow-primary'
                                                    : theme === 'dark'
                                                        ? 'glass-card'
                                                        : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                                }`}
                                            title={isCollapsed 
                                                ? (isUnresolved
                                                    ? `${member.name} • Locating…`
                                                    : member.currentTrip
                                                        ? `${member.name} • Driving to ${member.currentTrip.destinationName} (${member.currentTrip.totalTime})`
                                                        : member.name)
                                                : undefined}
                                        >
                                            <div 
                                                className="cursor-pointer shrink-0 transition-transform group-hover:scale-105 active:scale-95"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSelect(member.id);
                                                }}
                                            >
                                                <MemberAvatarWithRing
                                                    member={member}
                                                    size={isCollapsed ? 'sm' : 'md'}
                                                    theme={theme}
                                                    isSelected={selectedId === member.id}
                                                    isUnresolved={isUnresolved}
                                                    circleColor={memberCircleHex}
                                                    renderStatusBadge={true}
                                                />
                                            </div>

                                            {!isCollapsed && (
                                                <div className="flex-1 text-left min-w-0 animate-in fade-in slide-in-from-left-2">
                                                    <div className="flex items-center justify-between gap-1">
                                                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                                            <h3 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onSelect(member.id);
                                                                }}
                                                                className={`font-black text-sm tracking-tight truncate cursor-pointer hover:underline ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}
                                                            >
                                                                {member.name}
                                                            </h3>
                                                            {isUnresolved ? (
                                                                <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 bg-amber-500/15 border-amber-500/40 text-amber-400 animate-pulse">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                                                    <span>Locating…</span>
                                                                </span>
                                                            ) : member.circleBadges && member.circleBadges.length > 0 ? (
                                                                member.circleBadges.map(b => (
                                                                    <span
                                                                        key={b.id}
                                                                        style={{
                                                                            backgroundColor: `${b.color}22`,
                                                                            borderColor: `${b.color}44`,
                                                                            color: b.color
                                                                        }}
                                                                        className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded border flex items-center gap-1 shrink-0"
                                                                    >
                                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: b.color }} />
                                                                        <span className="truncate max-w-[70px]">{b.name}</span>
                                                                    </span>
                                                                ))
                                                            ) : member.circleName ? (
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
                                                            ) : null}
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {onOpenMessages && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onOpenMessages(member.id);
                                                                    }}
                                                                    className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all hover:scale-110 active:scale-95 shrink-0
                                                                        ${theme === 'dark' ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30' : 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100 shadow-sm'}`}
                                                                    title={`Direct message with ${member.name}`}
                                                                >
                                                                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {member.currentTrip ? (
                                                        <div className={`mt-1.5 p-2 rounded-xl border flex items-center gap-2 transition-all ${
                                                            theme === 'dark'
                                                                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-200'
                                                                : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                                                        }`}>
                                                            <Car className="w-3.5 h-3.5 shrink-0 text-indigo-400 animate-pulse" />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400">
                                                                        En Route
                                                                    </p>
                                                                    <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-md ${
                                                                        theme === 'dark' ? 'bg-indigo-500/30 text-indigo-300' : 'bg-indigo-200/70 text-indigo-900'
                                                                    }`}>
                                                                        {member.currentTrip.totalTime}
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs font-bold truncate leading-tight mt-0.5">
                                                                    {member.currentTrip.destinationName}
                                                                </p>
                                                                <div className="flex items-center justify-between gap-1 mt-1">
                                                                    <p className={`text-[9px] font-semibold opacity-80 ${
                                                                        theme === 'dark' ? 'text-indigo-300' : 'text-indigo-600'
                                                                    }`}>
                                                                        {member.currentTrip.totalDistance} remaining
                                                                    </p>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            convoyService.joinConvoy(member.id);
                                                                            if (showNotification) showNotification(`Linked into convoy with ${member.name}!`);
                                                                        }}
                                                                        className="px-2 py-0.5 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-[8px] font-black shadow-sm flex items-center gap-1 transition-all active:scale-95"
                                                                    >
                                                                        <Car className="w-3 h-3 shrink-0" />
                                                                        <span>Join Convoy</span>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : isUnresolved ? (
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            <div className="text-[10px] font-medium text-amber-400/90 flex items-center gap-1.5 truncate">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block shrink-0" />
                                                                <span className="truncate">Waiting for device signal…</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                                            <MemberStatusText
                                                                member={member}
                                                                className={`text-[10px] font-medium truncate ${
                                                                    theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                                                                }`}
                                                            />
                                                            {member.privacyMode === 'blurred' && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-purple-500/20 text-purple-300 flex items-center gap-1">
                                                                    <EyeOff className="w-2.5 h-2.5 shrink-0" />
                                                                    <span>~1.5 mi</span>
                                                                </span>
                                                            )}
                                                            {member.privacyMode === 'status_only' && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 flex items-center gap-1">
                                                                    <GraduationCap className="w-2.5 h-2.5 shrink-0" />
                                                                    <span>Milestones</span>
                                                                </span>
                                                            )}
                                                            {member.privacyMode === 'frozen' && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-sky-500/20 text-sky-300 flex items-center gap-1">
                                                                    <Shield className="w-2.5 h-2.5 shrink-0" />
                                                                    <span>Frozen</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                    {/* Add Member / Invite to Circle Button */}
                                    <AddMemberButton
                                        onClick={handleAddMember}
                                        theme={theme}
                                        isCollapsed={isCollapsed}
                                        label="Add Member"
                                    />
                                </div>

                                {/* Divider */}
                                {!isCollapsed && <div className={`h-px mx-4 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200/50'}`} />}

                                {/* Stats Row - Compact or Hidden when collapsed */}
                                {!isCollapsed && (
                                    <div className={`p-3 rounded-2xl border flex items-center justify-center animate-in fade-in slide-in-from-bottom-2
                                      ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-white border-slate-100 shadow-sm'}`}>
                                        <div className="flex items-center gap-2.5 text-emerald-500">
                                            <Shield className="w-5 h-5 text-emerald-400 shrink-0" />
                                            <div className="flex flex-col">
                                                <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{members.length} {members.length === 1 ? 'Member' : 'Members'}</span>
                                                <span className="text-[10px] text-slate-500 uppercase font-black tracking-tighter">Protected</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* History & Access Section */}
                                {isCollapsed ? (
                                    <div className="flex flex-col items-center gap-3 py-2 border-t border-white/5 mt-2">
                                        {onOpenTripHistory && (
                                            <button
                                                onClick={onOpenTripHistory}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Trips"
                                            >
                                                <Navigation className="w-5 h-5 text-indigo-400" />
                                            </button>
                                        )}
                                        {onOpenWeeklyReport && (
                                            <button
                                                onClick={onOpenWeeklyReport}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Logs"
                                            >
                                                <Trophy className="w-5 h-5 text-amber-400" />
                                            </button>
                                        )}
                                        {onOpenMessages && (
                                            <button
                                                onClick={() => onOpenMessages()}
                                                className={`relative w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Messages"
                                            >
                                                <MessageSquare className="w-5 h-5 text-indigo-400" />
                                                {typeof unreadMessagesCount === 'number' && unreadMessagesCount > 0 && (
                                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full ring-2 ring-slate-900" />
                                                )}
                                            </button>
                                        )}
                                        {onOpenNotifications && (
                                            <button
                                                onClick={onOpenNotifications}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Alerts"
                                            >
                                                <Bell className="w-5 h-5 text-sky-400" />
                                            </button>
                                        )}
                                        {onOpenInviteShare && (
                                            <button
                                                onClick={onOpenInviteShare}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Invites"
                                            >
                                                <Share2 className="w-5 h-5 text-emerald-400" />
                                            </button>
                                        )}
                                        {onOpenMaintenance && (
                                            <button
                                                onClick={onOpenMaintenance}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Garage & Maintenance"
                                            >
                                                <Wrench className="w-5 h-5 text-rose-400" />
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2 px-1">
                                        <h4 className={`text-[10px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                            History & Access
                                        </h4>
                                        <div className="grid grid-cols-2 gap-2">
                                            {onOpenTripHistory && (
                                                <button
                                                    onClick={onOpenTripHistory}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <Navigation className="w-5 h-5 text-indigo-400 shrink-0" />
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Trips</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Journeys</p>
                                                    </div>
                                                </button>
                                            )}
                                            {onOpenWeeklyReport && (
                                                <button
                                                    onClick={onOpenWeeklyReport}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>Scorecard</p>
                                                        <span className="flex items-center gap-1 text-[9px] text-amber-400 font-bold mt-1 uppercase tracking-tighter">
                                                            <Trophy className="w-2.5 h-2.5 shrink-0" />
                                                            <span>Badges</span>
                                                        </span>
                                                    </div>
                                                </button>
                                            )}
                                            {onOpenNotifications && (
                                                <button
                                                    onClick={onOpenNotifications}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <Bell className="w-5 h-5 text-sky-400 shrink-0" />
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Alerts</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Alerts</p>
                                                    </div>
                                                </button>
                                            )}
                                            {onOpenMaintenance && (
                                                <button
                                                    onClick={onOpenMaintenance}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <Wrench className="w-5 h-5 text-rose-400 shrink-0" />
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Garage & Maintenance</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Garage & Logs</p>
                                                    </div>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Emergency SOS Row - Persistent Safety Action */}
                                {onSOS && (
                                    <div className="px-2 pb-4">
                                        <HoldToActivate
                                            onActivate={onSOS}
                                            duration={1500}
                                            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-red-500/10 border border-red-500/20 active:scale-95 transition-all shadow-lg active:ring-2 active:ring-red-500/50"
                                        >
                                            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                                            {!isCollapsed && <span className="text-xs text-red-500 font-extrabold uppercase tracking-tighter">Emergency SOS</span>}
                                        </HoldToActivate>
                                    </div>
                                )}
                            </>
                        ) : sidebarTab === 'places' ? (
                            /* ──────────────────────────────────────────
                               SAVED PLACES & GEOFENCES TAB
                               ────────────────────────────────────────── */
                            <div className="flex flex-col gap-3 animate-in fade-in duration-200">
                                {/* Header / Add Place Action */}
                                {!isCollapsed && (
                                    <div className="flex items-center justify-between px-1">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                            Saved Geofences ({userPlaces.length})
                                        </p>
                                        <div className="flex items-center gap-1.5">
                                            {!parkedVehicle && userLocation && (
                                                <button
                                                    onClick={() => {
                                                        parkingService.setParkedVehicle({
                                                            id: 'temp-parked-vehicle',
                                                            name: 'Parked Vehicle',
                                                            type: 'parked_vehicle',
                                                            category: 'parked_vehicle',
                                                            icon: '🚗',
                                                            location: { lat: userLocation.lat, lng: userLocation.lng },
                                                            radius: 25,
                                                            departureRadius: 25,
                                                            isSaved: false,
                                                            parkedAt: Date.now(),
                                                            hasWalkedAway: false,
                                                            hasReturned: false,
                                                            nearestAddress: 'Current Location',
                                                            description: 'Parked near Current Location'
                                                        });
                                                        showNotification?.('📍 Marked vehicle as parked here.', 4000);
                                                    }}
                                                    className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm flex items-center gap-1 cursor-pointer"
                                                    title="Mark where you parked your car"
                                                >
                                                    <Car className="w-3 h-3" />
                                                    <span>Park</span>
                                                </button>
                                            )}
                                            {userLocation && onAddPlace && (
                                                <button
                                                    onClick={() => setShowAddCustomPlace(!showAddCustomPlace)}
                                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer
                                                        ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'}`}
                                                >
                                                    {showAddCustomPlace ? 'Cancel' : '+ Pin'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Quick Add Custom Place Form */}
                                {showAddCustomPlace && userLocation && onAddPlace && !isCollapsed && (
                                    <div className={`p-3 rounded-2xl border space-y-2.5 animate-in slide-in-from-top-2 duration-200
                                        ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}
                                    >
                                        <p className="text-xs font-bold text-indigo-400">Pin Current Location</p>
                                        <input
                                            type="text"
                                            placeholder="Place Name (e.g. Favorite Spot)"
                                            value={customPlaceName}
                                            onChange={(e) => setCustomPlaceName(e.target.value)}
                                            className={`w-full px-3 py-1.5 rounded-xl border text-xs outline-none ${
                                                theme === 'dark' ? 'bg-slate-800/80 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                            }`}
                                        />
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Category</span>
                                            <div className="grid grid-cols-4 gap-1.5">
                                                {SIDEBAR_PLACE_CATEGORIES.map((cat) => {
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
                                                                    : theme === 'dark'
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
                                            onClick={() => {
                                                if (customPlaceName.trim()) {
                                                    onAddPlace({
                                                        name: customPlaceName.trim(),
                                                        icon: customPlaceIcon,
                                                        location: userLocation,
                                                        radius: 0.15,
                                                        type: customPlaceType,
                                                        description: 'Saved Location'
                                                    });
                                                    setCustomPlaceName('');
                                                    setShowAddCustomPlace(false);
                                                }
                                            }}
                                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-md transition-all active:scale-95 cursor-pointer"
                                        >
                                            Save Place
                                        </button>
                                    </div>
                                )}

                                {/* Places List */}
                                {parkedVehicle && (
                                    <div
                                        onClick={() => onSelectPlace?.(parkedVehicle)}
                                        className={`p-3 rounded-2xl border transition-all cursor-pointer mb-2.5 flex items-center justify-between gap-3 ${
                                            selectedPlaceId === parkedVehicle.id
                                                ? 'bg-cyan-500/20 border-cyan-500/40 shadow-lg shadow-cyan-500/10'
                                                : theme === 'dark'
                                                ? 'bg-slate-800/80 hover:bg-slate-800 border-cyan-500/30'
                                                : 'bg-cyan-50/70 hover:bg-cyan-100/70 border-cyan-200'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center shrink-0">
                                                <Car className="w-5 h-5" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold truncate">Parked Vehicle</span>
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                                                        Active
                                                    </span>
                                                </div>
                                                <p className={`text-[11px] truncate ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                                                    {parkedVehicle.nearestAddress || 'Saved away from Home'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onNavigatePlace?.(parkedVehicle);
                                            }}
                                            className="p-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white shadow-md shrink-0 transition-transform active:scale-95"
                                            title="Walk to vehicle"
                                        >
                                            <Navigation className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                )}

                                {userPlaces.length === 0 && !parkedVehicle ? (
                                    <div className={`p-6 rounded-2xl border text-center space-y-2
                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-slate-800/40 border border-white/5 flex items-center justify-center mx-auto mb-2 text-slate-500">
                                            <MapPin className="w-6 h-6" />
                                        </div>
                                        <p className="text-xs font-bold">No Saved Places Yet</p>
                                        <p className="text-[10px] leading-relaxed">
                                            Search for any location (like Taco Bell or Home) and tap ⭐ to save it as a family geofence.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid gap-2.5">
                                        {userPlaces.map((place) => {
                                            const isSelected = selectedPlaceId === place.id;
                                            const distanceStr = formatDistance(place.location);
                                            const radiusMeters = Math.round((place.radius || 0.15) * 1000);

                                            // Determine which circle members are currently inside this place's geofence
                                            const membersInside = members.filter(m => {
                                                const dist = getDistanceMeters(m.location, place.location);
                                                return dist <= (place.radius || 0.15) * 1000;
                                            });

                                            // Determine which circle members are currently en route to this saved place
                                            const membersEnRoute = members.filter(m => {
                                                if (!m.currentTrip) return false;
                                                const dest = (m.currentTrip.destinationName || '').toLowerCase();
                                                const placeName = place.name.toLowerCase();
                                                const placeDesc = (place.description || '').toLowerCase();

                                                const nameMatches = dest.includes(placeName) || placeName.includes(dest) || (placeDesc && dest.includes(placeDesc));
                                                let coordsMatch = false;
                                                if (m.currentTrip.destinationCoords) {
                                                    const dist = getDistanceMeters(m.currentTrip.destinationCoords, place.location);
                                                    coordsMatch = dist < 300;
                                                }
                                                return nameMatches || coordsMatch;
                                            });

                                            return (
                                                <div
                                                    key={place.id}
                                                    onClick={() => onSelectPlace?.(place)}
                                                    className={`group relative flex flex-col gap-2 rounded-2xl transition-all cursor-pointer border
                                                        ${isCollapsed ? 'p-2 items-center' : 'p-3'}
                                                        ${isSelected
                                                            ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50 glow-primary'
                                                            : theme === 'dark'
                                                                ? 'glass-card hover:bg-white/10'
                                                                : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                                        }`}
                                                    title={isCollapsed 
                                                        ? `${place.name}${membersInside.length > 0 ? ` • ${membersInside.length} here` : ''}${membersEnRoute.length > 0 ? ` • ${membersEnRoute.length} en route` : ''}`
                                                        : undefined}
                                                >
                                                    <div className="flex items-center gap-3 w-full">
                                                        {/* Place Icon */}
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border relative ${
                                                            theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'
                                                        }`}>
                                                            {renderPlaceIcon(place.icon)}
                                                            {membersEnRoute.length > 0 && (
                                                                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-600 border border-white flex items-center justify-center text-white animate-pulse shadow-md">
                                                                    <Car className="w-2.5 h-2.5 text-white" />
                                                                </span>
                                                            )}
                                                        </div>

                                                        {!isCollapsed && (
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <h3 className={`font-black text-xs tracking-tight truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                                        {place.name}
                                                                    </h3>
                                                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 shrink-0">
                                                                        {radiusMeters}m
                                                                    </span>
                                                                </div>

                                                                {place.description && (
                                                                    <p className="text-[9px] text-slate-500 truncate mt-0.5">
                                                                        {place.description}
                                                                    </p>
                                                                )}

                                                                {distanceStr && (
                                                                    <p className="text-[9px] font-bold text-indigo-400 mt-0.5">
                                                                        {distanceStr}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Member Presence Badge (Inside Geofence) */}
                                                    {!isCollapsed && membersInside.length > 0 && (
                                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/20">
                                                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                                            <span className="text-[9px] font-bold text-emerald-400 truncate">
                                                                {membersInside.map(m => m.name).join(', ')} {membersInside.length === 1 ? 'is here' : 'are here'}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Members En Route Auto-ETA Badge */}
                                                    {!isCollapsed && membersEnRoute.length > 0 && (
                                                        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all ${
                                                            theme === 'dark'
                                                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200 shadow-sm'
                                                                : 'bg-indigo-50 border-indigo-200 text-indigo-800 shadow-sm'
                                                        }`}>
                                                            <Car className="w-3.5 h-3.5 text-indigo-400 animate-bounce shrink-0" />
                                                            <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                                                                <span className="text-[10px] font-bold truncate">
                                                                    {membersEnRoute.map(m => m.name).join(', ')} en route
                                                                </span>
                                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${
                                                                    theme === 'dark' ? 'bg-indigo-500/40 text-indigo-200' : 'bg-indigo-200 text-indigo-900'
                                                                }`}>
                                                                    ETA: {membersEnRoute[0]?.currentTrip?.totalTime}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Quick Actions Row */}
                                                    {!isCollapsed && (
                                                        <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                                                            {onNavigatePlace && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onNavigatePlace(place);
                                                                    }}
                                                                    className="flex-1 py-1 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-95"
                                                                >
                                                                    <Navigation className="w-3 h-3 fill-current shrink-0" />
                                                                    <span>Navigate</span>
                                                                </button>
                                                            )}
                                                            {onEditPlace && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onEditPlace(place);
                                                                    }}
                                                                    className="p-1 px-2 rounded-lg border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 text-[10px] font-bold transition-all cursor-pointer"
                                                                    title="Edit Place & Geofence"
                                                                >
                                                                    <Edit3 className="w-3 h-3" />
                                                                </button>
                                                            )}
                                                            {onDeletePlace && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (window.confirm(`Remove "${place.name}" from saved places?`)) {
                                                                            onDeletePlace(place.id);
                                                                        }
                                                                    }}
                                                                    className="p-1 px-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 text-[10px] font-bold transition-all"
                                                                    title="Delete Place"
                                                                >
                                                                    <Trash2 className="w-3 h-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <ActivityLog
                                activities={activities}
                                members={members}
                                onResolveSOS={onResolveSOS}
                                theme={theme}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(BentoSidebar);
