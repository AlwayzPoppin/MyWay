import React, { useState } from 'react';
import { FamilyMember, Place } from '../types';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';
import { MemberStatusText } from '../utils/memberStatus';
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
    Clock
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

    // 2. Driving/Moving (Blue Pulsing): If user.isDriving is true (speed over threshold)
    if (isDriving) {
        return 'border-2 border-blue-500 p-0.5 animate-pulse';
    }

    // 3. Safely at Geofenced Place (Green): If user.isStationary is true AND user.atSavedPlace is true
    if (isStationary && atSavedPlace) {
        return 'border-2 border-emerald-500 p-0.5';
    }

    // 4. Stale/Offline (Muted Gray): Subtle border indicating cached location
    if (isStale) {
        return 'border-2 border-slate-400/40 p-0.5';
    }

    // 5. Default: Preserve layout with matching 2px border and 2px padding
    return 'border-2 border-transparent p-0.5';
}

/**
 * Ring Container Wrapper Component
 * Wraps any avatar div with the conditional status ring styling.
 */
export const MemberStatusRing: React.FC<{
    user: {
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
    circleColor?: string;
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
    circleColor,
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
    const matchedSavedPlace = member.location ? checkTier2SavedPlace(member.location) : null;
    const ringClass = getMemberStatusRingClass({
        ...member,
        locationStale: isStale,
        atSavedPlace: Boolean(matchedSavedPlace)
    });
    const sizeClasses = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-14 h-14' : 'w-12 h-12';
    const memberCircleHex = circleColor || member.circleColor || '#6366f1';
    const memberInitial = (member.name || 'M').trim().charAt(0).toUpperCase() || 'M';
    const hasCustomAvatarUrl = Boolean(
        member.avatar &&
        typeof member.avatar === 'string' &&
        member.avatar.trim() !== '' &&
        !imgFailed
    );

    const batteryVal = member.batteryLevel !== undefined ? member.batteryLevel : (member.battery !== undefined ? member.battery : 100);
    const isLow = batteryVal < 20;
    const isCharging = Boolean(member.isCharging);
    const batteryColorClass = isLow
        ? 'bg-red-600 text-white'
        : 'bg-emerald-600 text-white';

    return (
        /* Parent container wrapping the avatar and its status ring with relative positioning */
        <div className={`relative shrink-0 ${className}`}>
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
                                style={{ borderColor: isUnresolved ? '#f59e0b' : memberCircleHex }}
                                className={`w-full h-full rounded-full object-cover transition-all border-2 ${
                                    theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'
                                } ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''} ${
                                    isUnresolved ? 'saturate-75' : ''
                                }`}
                            />
                        ) : (
                            /* Circular member avatar fallback (teal div with character letter 'M' / initial) */
                            <div
                                style={{ borderColor: isUnresolved ? '#f59e0b' : memberCircleHex }}
                                className={`w-full h-full rounded-full flex items-center justify-center font-black text-white border-2 select-none transition-all shadow-inner bg-gradient-to-tr from-teal-600 to-teal-400 ${
                                    size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
                                } ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''} ${
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

            {/* Stacked Corner Badges: Distinct Location Badge (Top) right-aligned directly above Battery Indicator (Bottom) */}
            {(renderBatteryBadge || renderStatusBadge) && (
                <div
                    className="absolute -bottom-1.5 -right-1.5 z-10 flex flex-col items-end gap-0.5 select-none shrink-0"
                    title={`${matchedSavedPlace?.place.name ? `${matchedSavedPlace.place.name} • ` : ''}${member.status || 'Location'} • Battery: ${batteryVal}%${isCharging ? ' (Charging)' : ''}`}
                >
                    {/* Location Badge (Top): Enlarged circular badge brought down slightly above the battery pill */}
                    {renderStatusBadge && (
                        <div
                            className="w-6 h-6 rounded-full bg-white dark:bg-slate-800 border-2 border-white dark:border-slate-900 shadow-md flex items-center justify-center shrink-0 translate-y-1 z-10 transition-transform hover:scale-110"
                            title={matchedSavedPlace?.place.name || member.status || 'Location'}
                        >
                            {isUnresolved ? (
                                <Radio className="w-3.5 h-3.5 text-amber-500 animate-pulse shrink-0" />
                            ) : (isStale || member.status === 'Offline') ? (
                                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : member.currentTrip ? (
                                <Car className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            ) : matchedSavedPlace && member.status === 'Stationary' ? (
                                (matchedSavedPlace.place.type?.toLowerCase() === 'work' || matchedSavedPlace.place.name?.toLowerCase().includes('work') || matchedSavedPlace.place.name?.toLowerCase().includes('office')) ? (
                                    <Briefcase className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                ) : matchedSavedPlace.place.type?.toLowerCase() === 'home' || matchedSavedPlace.place.name?.toLowerCase() === 'home' ? (
                                    <Home className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                                ) : (
                                    <MapPin className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                                )
                            ) : member.status === 'Driving' ? (
                                <Navigation className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            ) : member.status === 'Walking' ? (
                                <Footprints className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : member.status === 'Stationary' ? (
                                <MapPin className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                            ) : (
                                <Circle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                        </div>
                    )}

                    {/* Battery Pill (Bottom): Standalone pill with dynamic color logic (green/red) and charging bolt */}
                    {renderBatteryBadge && (
                        <div
                            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-white dark:border-gray-900 font-bold leading-none shadow-sm select-none shrink-0 whitespace-nowrap ${batteryColorClass}`}
                            title={`Battery: ${batteryVal}%${isCharging ? ' (Charging)' : ''}`}
                        >
                            <span>{batteryVal}%</span>
                            {isCharging && (
                                <Zap className="w-2.5 h-2.5 shrink-0 fill-current text-amber-300 animate-pulse" />
                            )}
                        </div>
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
    onSelectMember?: (memberId: string) => void;
    onOpenMessages?: (memberId: string) => void;
    theme?: 'light' | 'dark';
    circleColor?: string;
    isCollapsed?: boolean;
    currentUserId?: string;
}

/**
 * Circle Member Card Component with Colored Status Ring, Name, Badges,
 * Live Battery Pill, and Contextual Status Line.
 */
export const MemberCard: React.FC<MemberCardProps> = ({
    member,
    places,
    selectedId,
    onSelectMember,
    onOpenMessages,
    theme = 'dark',
    circleColor,
    isCollapsed = false,
    currentUserId,
}) => {
    const lastFixMs = Date.parse(member.lastUpdated || '');
    const locationAgeMs = Number.isFinite(lastFixMs) ? Math.max(0, Date.now() - lastFixMs) : Infinity;
    const isUnresolved = member.locationStale === true || locationAgeMs > 90_000;
    const staleLocationLabel = locationAgeMs < 60_000
        ? 'Locating…'
        : locationAgeMs < 3_600_000
            ? `Updated ${Math.floor(locationAgeMs / 60_000)}m ago`
            : `Updated ${Math.floor(locationAgeMs / 3_600_000)}h ago`;
    const isSelected = selectedId === member.id;
    const memberCircleHex = circleColor || member.circleColor || '#6366f1';
    const isSelf = Boolean((currentUserId && member.id === currentUserId) || member.id === 'demo-you' || (member as any).isSelf);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => {
                if (onSelectMember) onSelectMember(member.id);
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (onSelectMember) onSelectMember(member.id);
                }
            }}
            className={`w-full p-2.5 rounded-2xl border transition-all cursor-pointer group text-left ${
                isUnresolved
                    ? theme === 'dark'
                        ? 'bg-amber-950/15 border-amber-500/30 border-dashed opacity-85 hover:opacity-100'
                        : 'bg-amber-50/50 border-amber-300/60 border-dashed opacity-90 hover:opacity-100 shadow-sm'
                    : isSelected
                        ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/60 shadow-md'
                        : theme === 'dark'
                            ? 'bg-white/[0.03] hover:bg-white/[0.07] border-white/5 hover:border-white/10'
                            : 'bg-white hover:bg-slate-50 border-slate-200/80 hover:border-slate-300 shadow-xs'
            }`}
        >
            <div className="flex items-center gap-3">
                {/* Avatar with Status Ring */}
                <MemberAvatarWithRing
                    member={member}
                    size={isCollapsed ? 'sm' : 'md'}
                    theme={theme}
                    isSelected={isSelected}
                    isUnresolved={isUnresolved}
                    circleColor={memberCircleHex}
                />

                {!isCollapsed && (
                    <div className="flex-1 text-left min-w-0">
                        {/* Header Row: Name, Circle badges, Battery pill */}
                        <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <h4 className={`font-black text-sm tracking-tight truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
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
                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 bg-amber-500/15 border-amber-500/40 text-amber-400 animate-pulse">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        <span>{staleLocationLabel}</span>
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
                                {onOpenMessages && !isSelf && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onOpenMessages(member.id);
                                        }}
                                        className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all hover:scale-110 active:scale-95 shrink-0 ${
                                            theme === 'dark'
                                                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30'
                                                : 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100 shadow-sm'
                                        }`}
                                        title={`Direct message with ${member.name}`}
                                    >
                                        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Status Row: Contextual Telemetry Text & Privacy Badges */}
                        {isUnresolved ? (
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
                                    places={places}
                                    className={`text-[10px] font-medium truncate ${
                                        theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                                    }`}
                                />
                                {member.privacyMode === 'blurred' && (
                                    <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-purple-500/20 text-purple-300 flex items-center gap-1 shrink-0">
                                        <EyeOff className="w-2.5 h-2.5 shrink-0" />
                                        <span>~1.5 mi</span>
                                    </span>
                                )}
                                {member.privacyMode === 'status_only' && (
                                    <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 flex items-center gap-1 shrink-0">
                                        <GraduationCap className="w-2.5 h-2.5 shrink-0" />
                                        <span>Milestones</span>
                                    </span>
                                )}
                                {member.privacyMode === 'frozen' && (
                                    <span className="text-[8px] font-black px-1.5 py-0.2 rounded-md bg-sky-500/20 text-sky-300 flex items-center gap-1 shrink-0">
                                        <Shield className="w-2.5 h-2.5 shrink-0" />
                                        <span>Frozen</span>
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
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
