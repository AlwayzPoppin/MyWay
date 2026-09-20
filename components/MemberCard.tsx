import React, { useState } from 'react';
import { FamilyMember, Place } from '../types';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { getMemberViewerLabel, MemberStatusText } from '../utils/memberStatus';
import { classifyMovementMode, getMovementVisuals } from '../utils/movementUtils';
import { checkTier2SavedPlace } from '../services/locationService';
import {
    Radio,
    Car,
    Home,
    Navigation,
    Footprints,
    MapPin,
    Circle,
    EyeOff,
    GraduationCap,
    Shield,
    MessageSquare,
    Zap,
    UserPlus,
    Briefcase,
    Clock,
    Monitor
} from 'lucide-react';

/**
 * Determine the conditional Tailwind border classes for the member avatar status ring:
 * - Critical State (Red): user.isSOSActive is true OR user.batteryLevel < 10
 * - Driving/Moving (Blue Pulsing): user.isDriving is true
 * - Safely at Geofenced Place (Green): user.isStationary is true AND user.atSavedPlace is true
 * - Stale/Offline (Muted Gray): Subtle border indicating cached location
 * - Default: border-2 border-transparent p-0.5 (preserves layout spacing)
 */
export function getMemberStatusRingClass(user: {
    id?: string;
    isStationary?: boolean;
    atSavedPlace?: boolean;
    isDriving?: boolean;
    isSOSActive?: boolean;
    sosActive?: boolean;
    batteryLevel?: number;
    battery?: number;
    status?: string;
    currentPlace?: string;
    speed?: number;
    locationStale?: boolean;
    lastUpdated?: string;
}): string {
    const isSOSActive = Boolean(user.isSOSActive ?? user.sosActive);
    const batteryLevel = user.batteryLevel !== undefined ? user.batteryLevel : (user.battery !== undefined ? user.battery : 100);
    const lastFixMs = Date.parse(user.lastUpdated || '');
    const locationAgeMs = Number.isFinite(lastFixMs) ? Math.max(0, Date.now() - lastFixMs) : Infinity;
    const isStale = user.locationStale === true || locationAgeMs > 90_000 || user.status === 'Offline';
    const isDriving = !isStale && Boolean(user.isDriving ?? (user.status === 'Driving' || (user.speed || 0) >= 15 || (user.status === 'Moving' && (user.speed || 0) > 5)));
    const isStationary = !isStale && Boolean(user.isStationary ?? (user.status === 'Stationary' || (user.speed || 0) <= 0.6));
    const atSavedPlace = !isStale && Boolean(user.atSavedPlace ?? Boolean(user.currentPlace));

    // 1. Critical State (Red): If user.isSOSActive is true OR user.batteryLevel < 10 is true
    if (isSOSActive || batteryLevel < 10) {
        return 'border-2 border-red-600 p-0.5';
    }

    // 2. Stale/Offline (Muted Gray): Subtle border indicating cached location
    if (isStale) {
        return 'border-2 border-slate-400/40 p-0.5';
    }

    const mode = classifyMovementMode(user.id || 'default', user.speed || 0);
    switch (mode) {
        case 'driving':
            return 'border-2 border-blue-500 p-0.5 animate-pulse';
        case 'vehicle_stopped':
            return 'border-2 border-amber-500 p-0.5';
        case 'walking':
            return 'border-2 border-emerald-500 p-0.5';
        case 'standing':
        default:
            return 'border-2 border-teal-500/80 dark:border-teal-400/80 p-0.5';
    }
}

/**
 * Ring Container Wrapper Component
 * Wraps any avatar div with the conditional status ring styling.
 */
export const MemberStatusRing: React.FC<{
    user: {
        id?: string;
        isStationary?: boolean;
        atSavedPlace?: boolean;
        isDriving?: boolean;
        isSOSActive?: boolean;
        sosActive?: boolean;
        batteryLevel?: number;
        battery?: number;
        status?: string;
        currentPlace?: string;
        speed?: number;
    };
    className?: string;
    children?: React.ReactNode;
}> = ({ user, className = '', children }) => {
    const ringClass = getMemberStatusRingClass(user);
    return (
        <div className={`rounded-full shrink-0 transition-all ${ringClass} ${className}`}>
            {children}
        </div>
    );
};

/**
 * Circle identity is intentionally separate from a member's live/offline state.
 * The color strip and label remain readable even when a member has a cached location.
 */
export const CircleMembershipBadge: React.FC<{ name: string; color: string; className?: string }> = ({
    name,
    color,
    className = ''
}) => (
    <span
        title={`Circle: ${name}`}
        style={{
            background: `linear-gradient(90deg, ${color}2e, ${color}12)`,
            borderColor: `${color}88`,
            color
        }}
        className={`inline-flex max-w-[112px] items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide shadow-sm ${className}`}
    >
        <span className="h-2 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{name}</span>
    </span>
);

/**
 * Circular Member Avatar with Dedicated Status Ring Wrapper
 * Provides instant visual feedback on member state:
 * - Safely at Geofenced Place: solid green border (border-2 border-emerald-500 p-0.5)
 * - Driving/Moving: pulsing blue border (border-2 border-blue-500 p-0.5 animate-pulse)
 * - Critical State: solid red border (border-2 border-red-600 p-0.5)
 * - Default: transparent 2px border + 2px padding (border-2 border-transparent p-0.5) to preserve layout.
 */
export const MemberAvatarWithRing: React.FC<{
    member: FamilyMember;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    theme?: 'light' | 'dark';
    isSelected?: boolean;
    isUnresolved?: boolean;
    renderStatusBadge?: boolean;
    renderBatteryBadge?: boolean;
    children?: React.ReactNode;
}> = ({
    member,
    size = 'md',
    className = '',
    theme = 'dark',
    isSelected = false,
    isUnresolved = false,
    renderStatusBadge = true,
    renderBatteryBadge = true,
    children,
}) => {
    const [imgFailed, setImgFailed] = useState(false);
    // Do not trust currentPlace by itself: it can lag one location update behind.
    // The visual badge must agree with the member's actual current coordinates.
    const lastFixMs = Date.parse(member.lastUpdated || '');
    const locationAgeMs = Number.isFinite(lastFixMs) ? Math.max(0, Date.now() - lastFixMs) : Infinity;
    const isStale = member.locationStale === true || locationAgeMs > 90_000 || member.status === 'Offline';
    const viewerLabel = getMemberViewerLabel(member);
    const isDesktopViewer = viewerLabel === 'Desktop';
    const matchedSavedPlace = member.location ? checkTier2SavedPlace(member.location) : null;
    const ringClass = isDesktopViewer
        ? 'border-2 border-sky-400/80 p-0.5'
        : getMemberStatusRingClass({
        ...member,
        locationStale: isStale,
        atSavedPlace: Boolean(matchedSavedPlace)
    });
    const sizeClasses = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-14 h-14' : 'w-12 h-12';
    const memberInitial = (member.name || 'M').trim().charAt(0).toUpperCase() || 'M';
    const hasCustomAvatarUrl = Boolean(
        member.avatar &&
        typeof member.avatar === 'string' &&
        member.avatar.trim() !== '' &&
        !imgFailed
    );

    const batteryVal = member.batteryLevel !== undefined ? member.batteryLevel : (member.battery !== undefined ? member.battery : 100);
    const isLow = batteryVal < 20;
    const isOffline = member.status === 'Offline' || isStale || locationAgeMs > 180_000;
    const isCharging = !isOffline && (
        (member as any).batteryCharging === true ||
        (member.isCharging === true && (member as any).batteryCharging !== false)
    );
    const batteryColorClass = isOffline
        ? (theme === 'dark'
            ? 'bg-zinc-800 text-zinc-200 border-zinc-700 shadow-sm'
            : 'bg-zinc-100 text-zinc-700 border-zinc-300 shadow-sm')
        : isLow
            ? 'bg-red-600 text-white border-white dark:border-slate-900 shadow-sm'
            : 'bg-emerald-600 text-white border-white dark:border-slate-900 shadow-sm';

    const statusBadgeSize = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-6 h-6' : 'w-5.5 h-5.5';
    const batteryPillPos = size === 'sm' ? 'text-[8px] px-1 py-0.2 -bottom-1.5' : size === 'lg' ? 'text-[10px] px-2 py-0.5 -bottom-2.5' : 'text-[9px] px-1.5 py-0.5 -bottom-2';

    return (
        /* Parent container wrapping the avatar and its status ring with relative positioning */
        <div className={`relative shrink-0 flex items-center justify-center ${className}`}>
            {/* Status Ring Container Wrapper */}
            <div className={`rounded-full shrink-0 transition-all ${ringClass}`}>
                {children ? (
                    children
                ) : (
                    /* Avatar Div Container (e.g., circular avatar or teal div with character letter 'M') */
                    <div
                        className={`relative shrink-0 rounded-full flex items-center justify-center ${sizeClasses} ${
                            isSelected
                                ? `ring-2 ring-indigo-500 ring-offset-2 ${
                                      theme === 'dark' ? 'ring-offset-slate-900' : 'ring-offset-white'
                                  }`
                                : ''
                        }`}
                    >
                        {hasCustomAvatarUrl ? (
                            <img
                                src={getSafeAvatarUrl(member.avatar, member.name || member.id)}
                                onError={() => setImgFailed(true)}
                                alt={member.name}
                                className={`w-full h-full rounded-full object-cover transition-all border-2 border-white dark:border-slate-900 ${
                                    theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'
                                } ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''} ${
                                    isOffline ? 'grayscale brightness-75 opacity-70' : ''
                                } ${
                                    isUnresolved ? 'saturate-75' : ''
                                }`}
                            />
                        ) : (
                            /* Circular member avatar fallback (teal div with character letter 'M' / initial) */
                            <div
                                className={`w-full h-full rounded-full flex items-center justify-center font-black text-white border-2 border-white dark:border-slate-900 select-none transition-all shadow-inner bg-gradient-to-tr from-teal-600 to-teal-400 ${
                                    size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
                                } ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''} ${
                                    isOffline ? 'grayscale brightness-75 opacity-70' : ''
                                } ${
                                    isUnresolved ? 'saturate-75' : ''
                                }`}
                            >
                                {memberInitial}
                            </div>
                        )}

                        {/* Ghost Mode Overlay */}
                        {member.isGhostMode && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full backdrop-blur-[1px]">
                                <EyeOff className="w-4 h-4 text-purple-300 drop-shadow-md" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Physical Movement Activity Status Badge */}
            {renderStatusBadge && (
                (() => {
                    const mode = classifyMovementMode(member.id, member.speed || 0);
                    const visuals = getMovementVisuals(mode, member.speed || 0);
                    return (
                        <div
                            className={`absolute -top-1 -right-1 z-20 ${statusBadgeSize} rounded-full border-2 border-white dark:border-slate-900 shadow-md flex items-center justify-center shrink-0 transition-transform hover:scale-110 pointer-events-auto`}
                            style={{ backgroundColor: isDesktopViewer ? '#0284c7' : isUnresolved ? '#f59e0b' : (isStale || member.status === 'Offline') ? '#64748b' : visuals.badgeBg }}
                            title={isDesktopViewer ? 'Desktop companion' : isUnresolved ? 'Locating…' : (isStale || member.status === 'Offline') ? 'Offline' : visuals.label}
                        >
                            {isDesktopViewer ? (
                                <Monitor className="w-3.5 h-3.5 text-white shrink-0" />
                            ) : isUnresolved ? (
                                <Radio className="w-3.5 h-3.5 text-slate-950 animate-pulse shrink-0" />
                            ) : (isStale || member.status === 'Offline') ? (
                                <Clock className="w-3.5 h-3.5 text-white shrink-0" />
                            ) : (
                                <div
                                    className="w-full h-full flex items-center justify-center"
                                    dangerouslySetInnerHTML={{ __html: visuals.iconSvg }}
                                />
                            )}
                        </div>
                    );
                })()
            )}

            {/* Battery Indicator Pill (Strictly horizontally centered directly beneath the circular avatar) */}
            {renderBatteryBadge && !viewerLabel && (
                <div
                    className={`absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 font-bold leading-none select-none shrink-0 whitespace-nowrap pointer-events-none rounded-full border ${batteryPillPos} ${batteryColorClass}`}
                    title={`Battery: ${batteryVal}%${isCharging ? ' (Charging)' : ''}`}
                >
                    <span>{batteryVal}%</span>
                    {isCharging && (
                        <Zap className="w-2.5 h-2.5 shrink-0 fill-current text-amber-300 animate-pulse" />
                    )}
                </div>
            )}
        </div>
    );
};

export interface MemberCardProps {
    member: FamilyMember;
    places?: Place[];
    selectedId?: string | null;
    currentUserId?: string | null;
    theme?: 'light' | 'dark';
    circleColor?: string;
    onSelect: (id: string) => void;
    onOpenContacts?: (memberId: string) => void;
    isCollapsed?: boolean;
    className?: string;
    showDistance?: boolean;
    userLocation?: { lat: number; lng: number } | null;
}

/**
 * Circle Member Card Component with Colored Status Ring, Name, Badges,
 * Live Battery Pill, and Contextual Status Line.
 */
export const MemberCard: React.FC<MemberCardProps> = ({
    member,
    places = [],
    selectedId,
    currentUserId,
    theme = 'dark',
    circleColor,
    onSelect,
    onOpenContacts,
    isCollapsed = false,
    className = '',
    showDistance = true,
    userLocation = null,
}) => {
    const isSelected = selectedId === member.id;
    const isSelf = Boolean((currentUserId && member.id === currentUserId) || member.id === 'demo-you' || (member as any).isSelf);
    const memberCircleHex = circleColor || member.circleColor || '#6366f1';
    const isUnresolved = !member.companionDeviceLabel && (!member.location || (member.location.lat === 0 && member.location.lng === 0));
    const isStale = member.locationStale === true;
    const staleLocationLabel = isStale ? 'Stale Signal' : 'Locating…';
    const viewerLabel = getMemberViewerLabel(member);
    const isDesktopViewer = viewerLabel === 'Desktop';

    const circleBadgesList = (member.circleBadges && member.circleBadges.length > 0)
        ? member.circleBadges
        : member.circleName
            ? [{ id: member.circleId || 'primary', name: member.circleName, color: memberCircleHex }]
            : [];

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(member.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(member.id);
                }
            }}
            className={`group relative flex items-center gap-3 rounded-2xl transition-all cursor-pointer border select-none
            ${isCollapsed ? 'p-1.5 justify-center' : 'p-3'}
            ${isUnresolved
                ? theme === 'dark'
                    ? 'bg-amber-950/10 border-amber-500/30 border-dashed opacity-80 hover:opacity-100'
                    : 'bg-amber-50/50 border-amber-300/60 border-dashed opacity-85 hover:opacity-100 shadow-sm'
                : isSelected
                    ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50 glow-primary'
                    : theme === 'dark'
                        ? 'glass-card'
                        : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
            } ${className}`}
            style={!isCollapsed ? {
                borderColor: isSelected ? memberCircleHex : `${memberCircleHex}55`,
                boxShadow: `inset 4px 0 0 ${memberCircleHex}`
            } : undefined}
        >
            <div
                className={`cursor-pointer shrink-0 transition-transform group-hover:scale-105 active:scale-95 flex items-center justify-center relative ${
                    isCollapsed ? 'w-10' : 'w-12'
                }`}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(member.id);
                }}
            >
                <MemberAvatarWithRing
                    member={member}
                    size={isCollapsed ? 'sm' : 'md'}
                    theme={theme}
                    isSelected={isSelected}
                    isUnresolved={isUnresolved}
                />
            </div>

            {!isCollapsed && (
                <div className="flex-1 text-left min-w-0">
                    {/* Header Row: Name, Circle badges, YOU, Desktop badge */}
                    <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                            <h4 className={`font-black text-sm tracking-tight truncate max-w-[110px] shrink-0 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                {member.name}
                            </h4>
                            {isSelf && (
                                <span className={`text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md border shrink-0 ${
                                    theme === 'dark' ? 'bg-indigo-500/20 border-indigo-400/35 text-indigo-200' : 'bg-indigo-50 border-indigo-200 text-indigo-600'
                                }`}>
                                    You
                                </span>
                            )}
                            {isUnresolved ? (
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 ${
                                    theme === 'dark'
                                        ? 'bg-amber-500/25 border-amber-400/50 text-amber-300 font-extrabold shadow-sm'
                                        : 'bg-amber-100 border-amber-400 text-amber-900 font-extrabold shadow-sm'
                                }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${theme === 'dark' ? 'bg-amber-300' : 'bg-amber-700'} animate-pulse`} />
                                    <span>{staleLocationLabel}</span>
                                </span>
                            ) : circleBadgesList.length > 0 ? (
                                circleBadgesList.map(b => (
                                    <CircleMembershipBadge key={b.id} name={b.name} color={b.color || memberCircleHex} />
                                ))
                            ) : null}
                            {viewerLabel && (
                                <span className={`text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md border shrink-0 flex items-center gap-1 ${
                                    theme === 'dark' ? 'bg-sky-500/20 border-sky-400/35 text-sky-300' : 'bg-sky-50 border-sky-200 text-sky-600'
                                }`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                                    <span>{viewerLabel}</span>
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            {onOpenContacts && !isSelf && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenContacts(member.id);
                                    }}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-105 active:scale-95 shrink-0 cursor-pointer ${
                                        theme === 'dark'
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

                    {/* Status Row: Contextual Telemetry Text & Privacy Badges */}
                    {isUnresolved ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <div className={`text-[10px] font-semibold flex items-center gap-1.5 truncate ${theme === 'dark' ? 'text-amber-300/90' : 'text-amber-800'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full animate-ping inline-block shrink-0 ${theme === 'dark' ? 'bg-amber-400' : 'bg-amber-600'}`} />
                                <span className="truncate">Waiting for device signal…</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <MemberStatusText
                                member={member}
                                places={places}
                                hasDesktopBadge={isDesktopViewer}
                                className={`text-[10px] font-medium truncate ${
                                    theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                                }`}
                            />
                                {member.privacyMode === 'blurred' && (
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 ${theme === 'dark' ? 'bg-purple-500/20 text-purple-200 border-purple-400/30' : 'bg-purple-100 text-purple-800 border-purple-300'}`}>
                                        <EyeOff className="w-2.5 h-2.5 shrink-0" />
                                        <span>~1.5 mi</span>
                                    </span>
                                )}
                                {member.privacyMode === 'status_only' && (
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 ${theme === 'dark' ? 'bg-amber-500/20 text-amber-200 border-amber-400/30' : 'bg-amber-100 text-amber-900 border-amber-300'}`}>
                                        <GraduationCap className="w-2.5 h-2.5 shrink-0" />
                                        <span>Milestones</span>
                                    </span>
                                )}
                                {member.privacyMode === 'frozen' && (
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 ${theme === 'dark' ? 'bg-sky-500/20 text-sky-200 border-sky-400/30' : 'bg-sky-100 text-sky-900 border-sky-300'}`}>
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
};

export interface AddMemberButtonProps {
    onClick?: () => void;
    theme?: 'light' | 'dark';
    isCollapsed?: boolean;
    className?: string;
    label?: string;
}

/**
 * Add Member / Invite to Circle Button
 * Clean, subtle, and inviting full-width button with dashed borders and hover states.
 */
export const AddMemberButton: React.FC<AddMemberButtonProps> = ({
    onClick,
    theme = 'dark',
    isCollapsed = false,
    className = '',
    label = 'Add Member',
}) => {
    if (isCollapsed) {
        return (
            <button
                type="button"
                onClick={onClick}
                title="Add Member / Invite to Circle"
                className={`w-10 h-10 mx-auto rounded-xl border-2 border-dashed flex items-center justify-center transition-all cursor-pointer active:scale-95 group ${
                    theme === 'dark'
                        ? 'border-indigo-500/30 hover:border-indigo-400 bg-white/[0.02] hover:bg-slate-800/80 text-indigo-400 hover:text-indigo-300'
                        : 'border-indigo-300 hover:border-indigo-500 bg-slate-100/70 hover:bg-slate-200 text-indigo-600 hover:text-indigo-700 shadow-xs'
                } ${className}`}
            >
                <UserPlus className="w-4 h-4 transition-transform group-hover:scale-110" />
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full py-3 px-4 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer select-none active:scale-[0.98] group ${
                theme === 'dark'
                    ? 'border-indigo-500/30 hover:border-indigo-400/70 bg-white/[0.02] hover:bg-slate-800/80 text-slate-300 hover:text-white shadow-xs'
                    : 'border-slate-300 hover:border-indigo-400 bg-slate-100/70 hover:bg-slate-200 text-slate-700 hover:text-slate-900 shadow-xs'
            } ${className}`}
        >
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                theme === 'dark'
                    ? 'bg-indigo-500/15 text-indigo-400 group-hover:bg-indigo-500/25 group-hover:text-indigo-300'
                    : 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 group-hover:text-indigo-700'
            }`}>
                <UserPlus className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
            </div>
            <span>{label}</span>
        </button>
    );
};

export default MemberCard;
