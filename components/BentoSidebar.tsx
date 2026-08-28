import React from 'react';
import { FamilyMember, Place, Location } from '../types';
import CircleManager from './CircleManager';
import HoldToActivate from './HoldToActivate';
import ActivityLog from './ActivityLog';
import { getDistanceMeters, getDistanceMiles } from '../utils/geo';
import { convoyService } from '../services/convoyService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';

interface BentoSidebarProps {
    members: FamilyMember[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    theme: 'light' | 'dark';
    hasCircle: boolean;
    inviteCode?: string;
    onCreateCircle: (name: string) => Promise<any>;
    onJoinCircle: (code: string) => Promise<any>;
    avgGasPrice?: string;
    showNotification?: (msg: string, duration?: number) => void;
    onOpenSettings?: () => void;
    onOpenTripHistory?: () => void;
    onOpenNotifications?: () => void;
    onOpenWeeklyReport?: () => void;
    onOpenInviteShare?: () => void;
    onSOS?: () => void;
    activities?: any[];
    onResolveSOS?: (id: string, memberId?: string) => void;
    userPlaces?: Place[];
    selectedPlaceId?: string | null;
    onSelectPlace?: (place: Place) => void;
    onAddPlace?: (place: Omit<Place, 'id'>) => void;
    onDeletePlace?: (placeId: string) => void;
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
    inviteCode,
    onCreateCircle,
    onJoinCircle,
    avgGasPrice = '$3.45',
    showNotification,
    onOpenSettings,
    onOpenTripHistory,
    onOpenNotifications,
    onOpenWeeklyReport,
    onOpenInviteShare,
    onSOS,
    activities = [],
    onResolveSOS = () => {},
    userPlaces = [],
    selectedPlaceId,
    onSelectPlace,
    onAddPlace,
    onDeletePlace,
    onNavigatePlace,
    userLocation,
    onOpenMaintenance
}) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const [sidebarTab, setSidebarTab] = React.useState<'members' | 'places' | 'log'>('members');
    const [showAddCustomPlace, setShowAddCustomPlace] = React.useState(false);
    const [customPlaceName, setCustomPlaceName] = React.useState('');
    const [customPlaceIcon, setCustomPlaceIcon] = React.useState('📍');
    const [customPlaceType, setCustomPlaceType] = React.useState<'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other'>('other');

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Driving': return '🏎️';
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
                        <span className="text-xs">⚙️</span>
                    </button>
                )}
                {/* Collapse Toggle */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-110 active:scale-90
                        ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    <span className={`text-xs transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}>
                        ◀️
                    </span>
                </button>
            </div>

            <div className={`mt-14 space-y-4 px-3 transition-opacity duration-300 ${isCollapsed ? 'opacity-100' : 'opacity-100'}`}>
                {/* Header Section */}
                {!isCollapsed && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between px-2 animate-in fade-in slide-in-from-left-2">
                            <h2 className={`text-lg font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                My Way
                            </h2>
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
                                    <div className={`px-4 py-3 rounded-2xl border transition-all hover:scale-[1.01] flex items-center justify-between animate-in fade-in slide-in-from-top-2
                                      ${theme === 'dark'
                                            ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                            : 'bg-slate-50 border-slate-100 shadow-sm'}`}
                                    >
                                        <div>
                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Live Status</p>
                                            <h3 className={`text-base font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                {members.filter(m => m.status !== 'Offline').length} Active
                                            </h3>
                                        </div>
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
                                )}

                                {/* Divider */}
                                {!isCollapsed && <div className={`h-px mx-4 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200/50'}`} />}

                                {/* Member Grid/List */}
                                <div className={`grid gap-3 ${isCollapsed ? 'grid-cols-1' : 'grid-cols-1'}`}>
                                    {members.map(member => (
                                        <div
                                            key={member.id}
                                            onClick={() => onSelect(member.id)}
                                            className={`group relative flex items-center gap-3 rounded-2xl transition-all cursor-pointer border
                                            ${isCollapsed ? 'p-1.5 justify-center' : 'p-3'}
                                            ${selectedId === member.id
                                                    ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50 glow-primary'
                                                    : theme === 'dark'
                                                        ? 'glass-card'
                                                        : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                                }`}
                                            title={isCollapsed 
                                                ? (member.currentTrip ? `${member.name} • 🚗 Driving to ${member.currentTrip.destinationName} (${member.currentTrip.totalTime})` : member.name)
                                                : undefined}
                                        >
                                            <div className="relative shrink-0">
                                                <img
                                                    src={getSafeAvatarUrl(member.avatar, member.name || member.id)}
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(member.name || member.id);
                                                    }}
                                                    alt={member.name}
                                                    className={`rounded-xl object-cover transition-all ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}
                                                      ${isCollapsed ? 'w-10 h-10' : 'w-12 h-12'}
                                                      ${selectedId === member.id ? `ring-2 ring-indigo-500 ring-offset-2 ${theme === 'dark' ? 'ring-offset-slate-900' : 'ring-offset-white'}` : ''}
                                                      ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''}
                                                    `}
                                                />
                                                <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
                                                    member.currentTrip 
                                                        ? 'bg-indigo-600 border-white text-white animate-pulse shadow-md' 
                                                        : theme === 'dark' ? 'bg-slate-800 border-white/10' : 'bg-white border-slate-200 shadow-sm'
                                                }`}>
                                                    {member.currentTrip ? '🚗' : getStatusIcon(member.status)}
                                                </div>

                                                {member.isGhostMode && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl backdrop-blur-[1px]">
                                                        <span className="text-base drop-shadow-md">🛡️</span>
                                                    </div>
                                                )}
                                            </div>

                                            {!isCollapsed && (
                                                <div className="flex-1 text-left min-w-0 animate-in fade-in slide-in-from-left-2">
                                                    <div className="flex items-center justify-between gap-1">
                                                        <h3 className={`font-black text-sm tracking-tight truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                            {member.name}
                                                        </h3>
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0
                                                            ${member.battery <= 20 ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
                                                            {member.battery <= 20 ? '🪫' : '🔋'} {member.battery}%
                                                        </span>
                                                    </div>

                                                    {member.currentTrip ? (
                                                        <div className={`mt-1.5 p-2 rounded-xl border flex items-center gap-2 transition-all ${
                                                            theme === 'dark'
                                                                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-200'
                                                                : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                                                        }`}>
                                                            <span className="text-sm shrink-0 animate-pulse">🚗</span>
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
                                                                        <span>🚗🚗</span>
                                                                        <span>Join Convoy</span>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                            <span className={`text-[10px] font-bold ${
                                                                member.status === 'Driving' ? 'text-indigo-400' :
                                                                member.status === 'Moving' ? 'text-amber-400' :
                                                                member.status === 'Stationary' ? 'text-emerald-400' : 'text-slate-500'
                                                            }`}>
                                                                {member.status} {member.speed > 0 ? `• ${member.speed} MPH` : ''}
                                                            </span>
                                                            {member.privacyMode === 'blurred' && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-purple-500/20 text-purple-300">
                                                                    👻 ~1.5 mi
                                                                </span>
                                                            )}
                                                            {member.privacyMode === 'status_only' && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300">
                                                                    🏫 Milestones
                                                                </span>
                                                            )}
                                                            {member.privacyMode === 'frozen' && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-sky-500/20 text-sky-300">
                                                                    ❄️ Frozen
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Divider */}
                                {!isCollapsed && <div className={`h-px mx-4 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200/50'}`} />}

                                {/* Stats Row - Compact or Hidden when collapsed */}
                                {!isCollapsed && (
                                    <div className={`p-3 rounded-2xl border flex items-center justify-around animate-in fade-in slide-in-from-bottom-2
                                      ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-white border-slate-100 shadow-sm'}`}>
                                        <div className="flex flex-col items-center gap-0.5 text-emerald-500">
                                            <span className="text-xl">🛡️</span>
                                            <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{members.length} {members.length === 1 ? 'Member' : 'Members'}</span>
                                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-tighter">Protected</span>
                                        </div>
                                        <div className={`w-px h-8 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`} />
                                        <div className="flex flex-col items-center gap-0.5 text-amber-500">
                                            <span className="text-xl">⛽</span>
                                            <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{avgGasPrice}</span>
                                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-tighter">Gas Avg</span>
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
                                                <span className="text-lg">🛣️</span>
                                            </button>
                                        )}
                                        {onOpenWeeklyReport && (
                                            <button
                                                onClick={onOpenWeeklyReport}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Logs"
                                            >
                                                <span className="text-lg">📊</span>
                                            </button>
                                        )}
                                        {onOpenNotifications && (
                                            <button
                                                onClick={onOpenNotifications}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Alerts"
                                            >
                                                <span className="text-lg">🔔</span>
                                            </button>
                                        )}
                                        {onOpenInviteShare && (
                                            <button
                                                onClick={onOpenInviteShare}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Invites"
                                            >
                                                <span className="text-lg">📤</span>
                                            </button>
                                        )}
                                        {onOpenMaintenance && (
                                            <button
                                                onClick={onOpenMaintenance}
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all hover:scale-115 active:scale-90
                                                    ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                                                title="My Maintenance"
                                            >
                                                <span className="text-lg">🔧</span>
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
                                                    <span className="text-lg">🛣️</span>
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
                                                    <span className="text-lg">📊</span>
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Logs</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Insights</p>
                                                    </div>
                                                </button>
                                            )}
                                            {onOpenNotifications && (
                                                <button
                                                    onClick={onOpenNotifications}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <span className="text-lg">🔔</span>
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Alerts</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Alerts</p>
                                                    </div>
                                                </button>
                                            )}
                                            {onOpenInviteShare && (
                                                <button
                                                    onClick={onOpenInviteShare}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <span className="text-lg">📤</span>
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Invites</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Access</p>
                                                    </div>
                                                </button>
                                            )}
                                            {onOpenMaintenance && (
                                                <button
                                                    onClick={onOpenMaintenance}
                                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-95
                                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100 shadow-sm'}`}
                                                >
                                                    <span className="text-lg">🔧</span>
                                                    <div>
                                                        <p className={`text-xs font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>My Maintenance</p>
                                                        <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">Expenses</p>
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
                                            <span className="text-xl">🚨</span>
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
                                        {userLocation && onAddPlace && (
                                            <button
                                                onClick={() => setShowAddCustomPlace(!showAddCustomPlace)}
                                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all
                                                    ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'}`}
                                            >
                                                {showAddCustomPlace ? 'Cancel' : '+ Pin Current'}
                                            </button>
                                        )}
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
                                        <div className="flex gap-2">
                                            <select
                                                value={customPlaceIcon}
                                                onChange={(e) => setCustomPlaceIcon(e.target.value)}
                                                className={`px-2 py-1.5 rounded-xl border text-xs outline-none ${
                                                    theme === 'dark' ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
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
                                                className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-md transition-all active:scale-95"
                                            >
                                                Save Place
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Places List */}
                                {userPlaces.length === 0 ? (
                                    <div className={`p-6 rounded-2xl border text-center space-y-2
                                        ${theme === 'dark' ? 'bg-white/5 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}
                                    >
                                        <span className="text-3xl block">📍</span>
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
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border relative ${
                                                            theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'
                                                        }`}>
                                                            {place.icon || '📍'}
                                                            {membersEnRoute.length > 0 && (
                                                                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-600 border border-white text-[8px] flex items-center justify-center text-white animate-pulse shadow-md">
                                                                    🚗
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
                                                            <span className="text-xs animate-bounce shrink-0">🚗</span>
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
                                                                    className="flex-1 py-1 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] flex items-center justify-center gap-1 transition-all active:scale-95"
                                                                >
                                                                    <span>🚀</span> Navigate
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
                                                                    🗑️
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
