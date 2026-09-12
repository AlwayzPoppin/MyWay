import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode } from 'lucide-react';
import { FamilyMember } from '../types';
import { FamilyCircle, CIRCLE_COLORS, getCircleColor, CircleColorInfo } from '../services/authService';
import { getCirclePrivacyMode, PRIVACY_LEVELS } from '../services/privacyService';
import { formatSegmentedInviteCode, cleanInviteCode, isValidInviteCode } from '../utils/inviteCode';
import { hapticTick, hapticMilestone, hapticSuccess, hapticError } from '../utils/haptics';
import QRScannerModal from './QRScannerModal';

interface CircleSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentCircle: FamilyCircle | null;
    userCircles: FamilyCircle[];
    members: FamilyMember[];
    currentUserId?: string;
    activeFilterCircleId?: string | 'all';
    onSelectFilterCircle?: (circleId: string | 'all') => void;
    onSwitchCircle: (circleId: string) => Promise<void> | void;
    onCreateCircle: (name: string, color?: string) => Promise<any>;
    onJoinCircle: (code: string) => Promise<any>;
    onRenameCircle?: (circleId: string, name: string) => Promise<void> | void;
    onUpdateCircleColor?: (circleId: string, color: string) => Promise<void> | void;
    onLeaveCircle: (circleId: string) => Promise<void> | void;
    onDeleteCircle?: (circleId: string) => Promise<void> | void;
    onRemoveMember?: (memberId: string) => void;
    onUpdateRole?: (memberId: string, role: string) => void;
    showNotification?: (msg: string, duration?: number) => void;
    theme?: 'light' | 'dark';
    initialTab?: 'circles' | 'invite' | 'manage';
}

const ROLES = ['Admin', 'Member', 'Child', 'Guest'] as const;

const CircleSettingsModal: React.FC<CircleSettingsModalProps> = ({
    isOpen,
    onClose,
    currentCircle,
    userCircles = [],
    members = [],
    currentUserId = '',
    activeFilterCircleId = 'all',
    onSelectFilterCircle,
    onSwitchCircle,
    onCreateCircle,
    onJoinCircle,
    onRenameCircle,
    onUpdateCircleColor,
    onLeaveCircle,
    onDeleteCircle,
    onRemoveMember,
    onUpdateRole,
    showNotification,
    theme = 'dark',
    initialTab = 'circles'
}) => {
    const [activeTab, setActiveTab] = useState<'circles' | 'invite' | 'manage'>(initialTab);
    const [isCreatingCircle, setIsCreatingCircle] = useState(false);
    const defaultColor = currentCircle?.color || (currentCircle ? getCircleColor(currentCircle.id).hex : CIRCLE_COLORS[0].hex);
    const [newCircleName, setNewCircleName] = useState('');
    const [newCircleColor, setNewCircleColor] = useState<string>(defaultColor);
    const [activeThemeColor, setActiveThemeColor] = useState<string>(defaultColor);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [manualInviteCode, setManualInviteCode] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [editingCircleName, setEditingCircleName] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);
    const [editingMemberRole, setEditingMemberRole] = useState<string | null>(null);
    const [isDangerZoneOpen, setIsDangerZoneOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const autoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
            setIsCreatingCircle(false);
            setIsScannerOpen(false);
            setManualInviteCode('');
            setJoinError(null);
            if (autoSubmitTimerRef.current) {
                clearTimeout(autoSubmitTimerRef.current);
                autoSubmitTimerRef.current = null;
            }
            setEditingCircleName(currentCircle?.name || '');
            setIsRenaming(false);
            setIsDangerZoneOpen(false);
            const currentColor = currentCircle?.color || (currentCircle ? getCircleColor(currentCircle.id).hex : CIRCLE_COLORS[0].hex);
            setNewCircleColor(currentColor);
            setActiveThemeColor(currentColor);
        }
    }, [isOpen, initialTab, currentCircle]);

    const selectedColorInfo = useMemo(() => {
        return getCircleColor(currentCircle?.id, activeThemeColor);
    }, [currentCircle?.id, activeThemeColor]);

    const handleSelectColorTheme = (hex: string) => {
        hapticTick();
        setActiveThemeColor(hex);
        if (currentCircle && onUpdateCircleColor) {
            onUpdateCircleColor(currentCircle.id, hex);
        }
    };

    useEffect(() => {
        return () => {
            if (autoSubmitTimerRef.current) {
                clearTimeout(autoSubmitTimerRef.current);
            }
        };
    }, []);

    if (!isOpen) return null;

    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-white' : 'text-slate-900';
    const subTextColor = isDark ? 'text-slate-400' : 'text-slate-500';
    const cardBg = isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200';
    const isOwner = currentCircle ? currentUserId === currentCircle.ownerId : false;
    const circleOwnerName = currentCircle
        ? (members.find(member => member.id === currentCircle.ownerId)?.name || 'the circle owner')
        : 'the circle owner';
    const managedMemberCount = currentCircle?.members?.length ?? members.length;
    const inviteCode = currentCircle?.inviteCode || '------';
    const shareUrl = `https://myway-gps.com/join/${inviteCode}`;

    const handleCreateCircle = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCircleName.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onCreateCircle(newCircleName.trim(), newCircleColor);
            showNotification?.(`🎉 Created circle "${newCircleName.trim()}"!`, 3000);
            setNewCircleName('');
            setIsCreatingCircle(false);
            setActiveTab('circles');
        } catch (err: any) {
            showNotification?.(`⚠️ Failed to create circle: ${err.message || err}`, 4000);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleJoinCircle = async (codeToJoin?: string, e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const rawCode = typeof codeToJoin === 'string' ? codeToJoin : manualInviteCode;
        const cleanCode = cleanInviteCode(rawCode);

        if (!cleanCode) {
            setJoinError('Please enter an 8-character invite code.');
            hapticError();
            return;
        }

        if (cleanCode.length !== 8) {
            const err = `Invite code must be exactly 8 characters (entered ${cleanCode.length}/8).`;
            setJoinError(err);
            hapticError();
            showNotification?.(`⚠️ ${err}`, 3500);
            return;
        }

        // Validate if user is already a member of this circle
        const alreadyInCircle = userCircles.some(c => cleanInviteCode(c.inviteCode) === cleanCode);
        if (alreadyInCircle) {
            const err = 'Already in this circle.';
            setJoinError(err);
            hapticError();
            showNotification?.(`⚠️ ${err}`, 3500);
            return;
        }

        setIsSubmitting(true);
        setJoinError(null);
        if (autoSubmitTimerRef.current) {
            clearTimeout(autoSubmitTimerRef.current);
            autoSubmitTimerRef.current = null;
        }
        try {
            const circle = await onJoinCircle(cleanCode);
            if (circle) {
                hapticSuccess();
                showNotification?.(`🎉 Successfully joined circle "${circle.name}"!`, 3000);
                setManualInviteCode('');
                setActiveTab('circles');
            } else {
                const err = 'Invalid code. No matching circle found.';
                setJoinError(err);
                hapticError();
                showNotification?.(`⚠️ ${err}`, 4000);
            }
        } catch (err: any) {
            const errMsg = err?.message || 'Could not join circle';
            setJoinError(errMsg);
            hapticError();
            showNotification?.(`⚠️ ${errMsg}`, 4000);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleScanResult = (scannedInviteCode: string) => {
        setIsScannerOpen(false);
        const cleaned = cleanInviteCode(scannedInviteCode);
        if (cleaned) {
            const formatted = formatSegmentedInviteCode(cleaned);
            setManualInviteCode(formatted);
            if (cleaned.length === 8) {
                handleJoinCircle(cleaned);
            }
        }
    };

    const handleCodeChange = (val: string) => {
        const formatted = formatSegmentedInviteCode(val);
        const cleaned = cleanInviteCode(formatted);
        setManualInviteCode(formatted);

        if (joinError) setJoinError(null);

        if (autoSubmitTimerRef.current) {
            clearTimeout(autoSubmitTimerRef.current);
            autoSubmitTimerRef.current = null;
        }

        // Haptic feedback: milestone vibration on 8th char, light tick on keystrokes
        if (cleaned.length === 8) {
            hapticMilestone();
        } else if (val.length > 0) {
            hapticTick();
        }

        // Auto-submit when exactly 8 valid characters are typed or pasted
        if (cleaned.length === 8 && !isSubmitting) {
            autoSubmitTimerRef.current = setTimeout(() => {
                handleJoinCircle(cleaned);
            }, 450);
        }
    };

    const handleSaveRename = async () => {
        if (!currentCircle || !editingCircleName.trim()) return;
        try {
            if (onRenameCircle) {
                await onRenameCircle(currentCircle.id, editingCircleName.trim());
            }
            showNotification?.(`✅ Circle renamed to "${editingCircleName.trim()}"`, 3000);
            setIsRenaming(false);
        } catch (err: any) {
            showNotification?.(`⚠️ Failed to rename circle: ${err.message || err}`, 3000);
        }
    };

    const handleLeaveCurrentCircle = async () => {
        if (!currentCircle) return;
        const msg = isOwner && members.length > 1
            ? `Leave "${currentCircle.name}"? Ownership will be automatically transferred to the next member.`
            : `Leave "${currentCircle.name}"? You can rejoin anytime with the invite code.`;

        if (window.confirm(msg)) {
            try {
                await onLeaveCircle(currentCircle.id);
                showNotification?.(`🚪 Left "${currentCircle.name}"`, 3000);
                onClose();
            } catch (err: any) {
                showNotification?.(`⚠️ Error leaving circle: ${err.message || err}`, 3000);
            }
        }
    };

    const handleDeleteCurrentCircle = async () => {
        if (!currentCircle) return;
        if (window.confirm(`Permanently delete "${currentCircle.name}" and remove all members & geofences? This cannot be undone.`)) {
            try {
                if (onDeleteCircle) {
                    await onDeleteCircle(currentCircle.id);
                } else {
                    await onLeaveCircle(currentCircle.id);
                }
                showNotification?.(`🗑️ Deleted "${currentCircle.name}"`, 3000);
                onClose();
            } catch (err: any) {
                showNotification?.(`⚠️ Error deleting circle: ${err.message || err}`, 3000);
            }
        }
    };

    const handleCopyCode = async () => {
        try {
            await navigator.clipboard.writeText(inviteCode);
            showNotification?.(`📋 Copied Invite Code: ${inviteCode}`, 2500);
        } catch {}
    };

    const handleShareInvite = async () => {
        const inviteUrl = shareUrl;
        const shareText = `Join my circle on My Way! Use my code: ${inviteCode} or tap the link to join:`;
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Join ${currentCircle?.name || 'Circle'} on My Way`,
                    text: shareText,
                    url: inviteUrl
                });
            } catch (err: any) {
                // Ignore silent cancellation by user
                if (err?.name !== 'AbortError') {
                    try {
                        await navigator.clipboard.writeText(`${shareText} ${inviteUrl}`);
                        showNotification?.('📋 Copied invite link & message to clipboard!', 2500);
                    } catch {
                        handleCopyCode();
                    }
                }
            }
        } else {
            try {
                await navigator.clipboard.writeText(`${shareText} ${inviteUrl}`);
                showNotification?.('📋 Copied invite link & message to clipboard!', 2500);
            } catch {
                handleCopyCode();
            }
        }
    };

    const getRoleBadgeColor = (role: string): string => {
        switch (role) {
            case 'Admin': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            case 'Child': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'Guest': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
            default: return 'bg-white/10 text-white/70 border-white/20';
        }
    };

    return (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto">
            <div className={`relative w-full max-w-md rounded-[2.5rem] border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-all ${
                isDark ? 'bg-slate-900/98 border-white/10 text-white' : 'bg-white/98 border-slate-200 text-slate-900'
            }`}>
                {/* Header Ambient Glow with live theme preview */}
                <div
                    className="absolute -top-24 -left-24 w-48 h-48 rounded-full blur-3xl pointer-events-none transition-colors duration-500"
                    style={{ backgroundColor: `${activeThemeColor}25` }}
                />
                <div
                    className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full blur-3xl pointer-events-none transition-colors duration-500"
                    style={{ backgroundColor: `${activeThemeColor}20` }}
                />

                {/* Top Header */}
                <div className="p-5 pb-3 border-b border-white/10 relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className="w-10 h-10 rounded-2xl border flex items-center justify-center text-xl shadow-inner shrink-0 transition-colors duration-200"
                            style={{
                                backgroundColor: `${activeThemeColor}20`,
                                borderColor: `${activeThemeColor}40`
                            }}
                        >
                            👥
                        </div>
                        <div className="min-w-0">
                            <h2 className={`text-base font-black tracking-tight truncate ${textColor}`}>
                                {currentCircle?.name || 'Circle Settings'}
                            </h2>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                {currentCircle
                                    ? `${isOwner ? 'You’re the owner' : 'Circle member'} · ${managedMemberCount} ${managedMemberCount === 1 ? 'member' : 'members'}`
                                    : `${userCircles.length} ${userCircles.length === 1 ? 'Circle' : 'Circles'} Available`}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                            isDark ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                    >
                        ✕
                    </button>
                </div>

                {/* Tabs Navigation with Live Theme Preview */}
                <div className="px-5 pt-3 relative z-10">
                    <div className={`p-1 rounded-2xl border flex gap-1 ${
                        isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'
                    }`}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('circles')}
                            className={`flex-1 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                activeTab === 'circles'
                                    ? 'text-white shadow-md'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                            style={activeTab === 'circles' ? { backgroundColor: activeThemeColor, boxShadow: `0 2px 10px ${activeThemeColor}40` } : undefined}
                        >
                            <span>🗂️</span>
                            <span>Circles ({userCircles.length})</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('invite')}
                            className={`flex-1 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                activeTab === 'invite'
                                    ? 'text-white shadow-md'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                            style={activeTab === 'invite' ? { backgroundColor: activeThemeColor, boxShadow: `0 2px 10px ${activeThemeColor}40` } : undefined}
                        >
                            <span>✉️</span>
                            <span>Invite</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('manage')}
                            className={`flex-1 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                activeTab === 'manage'
                                    ? 'text-white shadow-md'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                            style={activeTab === 'manage' ? { backgroundColor: activeThemeColor, boxShadow: `0 2px 10px ${activeThemeColor}40` } : undefined}
                        >
                            <span>⚙️</span>
                            <span>Manage</span>
                        </button>
                    </div>
                </div>

                {/* Tab Content Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 relative z-10 custom-scrollbar">
                    {/* ────────────────────────────────────────────────────────── */}
                    {/* TAB 1: CIRCLES (Multi-Circle Switcher & Creator)          */}
                    {/* ────────────────────────────────────────────────────────── */}
                    {activeTab === 'circles' && (
                        <div className="space-y-4">
                            {/* Multi-Circle Visibility Toggle */}
                            <div className={`p-3.5 rounded-2xl border space-y-2 ${cardBg}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <h4 className={`text-xs font-black flex items-center gap-1.5 ${textColor}`}>
                                            <span>🌐</span>
                                            <span>Map View Filter</span>
                                        </h4>
                                        <p className="text-[10px] text-slate-400 truncate">
                                            {activeFilterCircleId === 'all'
                                                ? 'Showing all circles simultaneously'
                                                : `Focused only on ${currentCircle?.name || 'active circle'}`}
                                        </p>
                                    </div>
                                    <div className="flex rounded-xl p-0.5 bg-black/30 border border-white/10 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => onSelectFilterCircle?.('all')}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${
                                                activeFilterCircleId === 'all'
                                                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow'
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            ✨ All Groups
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onSelectFilterCircle?.(currentCircle?.id || 'all')}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${
                                                activeFilterCircleId !== 'all'
                                                    ? 'bg-indigo-600 text-white shadow'
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            🎯 Single Focus
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Circle List */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                        Your Groups & Circles ({userCircles.length})
                                    </span>
                                </div>

                                {userCircles.length === 0 ? (
                                    <div className={`p-4 rounded-2xl border text-center space-y-1.5 ${cardBg}`}>
                                        <p className="text-xs font-bold">No Circles Joined Yet</p>
                                        <p className="text-[10px] text-slate-400">
                                            Create a family or friend circle below to start sharing live locations & safety alerts.
                                        </p>
                                    </div>
                                ) : (
                                    userCircles.map((circle) => {
                                        const isAllMode = activeFilterCircleId === 'all';
                                        const isSingleFocused = !isAllMode && (activeFilterCircleId === circle.id || (!activeFilterCircleId && currentCircle?.id === circle.id));
                                        const isPrimary = currentCircle?.id === circle.id;
                                        const isCardInView = isAllMode || isSingleFocused;
                                        const circleMemberCount = circle.members?.length || 1;
                                        const circleColorInfo = getCircleColor(circle.id, circle.color);
                                        const circleHex = circle.color || circleColorInfo.hex;

                                        return (
                                            <div
                                                key={circle.id}
                                                onClick={() => {
                                                    if (!isPrimary) {
                                                        onSwitchCircle(circle.id);
                                                    }
                                                }}
                                                style={{
                                                    borderColor: isCardInView ? circleHex : undefined,
                                                    boxShadow: isCardInView ? `0 0 16px ${circleHex}33` : undefined
                                                }}
                                                className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                                                    isCardInView
                                                        ? 'bg-white/10 ring-1 shadow-md'
                                                        : isDark
                                                            ? 'bg-white/5 border-white/10 hover:bg-white/10'
                                                            : 'bg-white border-slate-200 hover:bg-slate-50'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                                    <div
                                                        style={{ backgroundColor: `${circleHex}33`, borderColor: circleHex }}
                                                        className="w-10 h-10 rounded-xl border flex items-center justify-center text-lg shrink-0 shadow-sm"
                                                    >
                                                        {circle.name.toLowerCase().includes('work') ? '💼' :
                                                         circle.name.toLowerCase().includes('trip') || circle.name.toLowerCase().includes('caravan') ? '🚗' :
                                                         circle.name.toLowerCase().includes('friend') ? '🎉' : '🏠'}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: circleHex }} />
                                                            <h4 className={`text-sm font-black truncate ${textColor}`}>
                                                                {circle.name}
                                                            </h4>
                                                            {circle.ownerId === currentUserId && (
                                                                <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                                                                    Owner
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <p className="text-[10px] text-slate-400 truncate">
                                                                {circleMemberCount} {circleMemberCount === 1 ? 'member' : 'members'} • <span className="font-mono">{circle.inviteCode}</span>
                                                            </p>
                                                            {(() => {
                                                                const privMode = getCirclePrivacyMode(circle.id);
                                                                const privInfo = PRIVACY_LEVELS.find(l => l.id === privMode);
                                                                return (
                                                                    <span
                                                                        style={{ color: privInfo?.accentHex, backgroundColor: `${privInfo?.accentHex}20`, borderColor: `${privInfo?.accentHex}40` }}
                                                                        className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded border shrink-0 flex items-center gap-0.5"
                                                                    >
                                                                        <span>{privInfo?.icon}</span>
                                                                        <span>{privInfo?.title.split(' ')[0]}</span>
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="shrink-0">
                                                    {isAllMode ? (
                                                        <div className="flex items-center gap-1.5">
                                                            {isPrimary && (
                                                                <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-white/10 text-slate-300 border border-white/15">
                                                                    Primary
                                                                </span>
                                                            )}
                                                            <span
                                                                style={{ color: circleHex, backgroundColor: `${circleHex}22`, borderColor: `${circleHex}44` }}
                                                                className="text-xs font-black flex items-center gap-1 px-2.5 py-1 rounded-lg border shadow-sm"
                                                            >
                                                                <span>✓</span> In View
                                                            </span>
                                                        </div>
                                                    ) : isSingleFocused ? (
                                                        <span
                                                            style={{ color: circleHex, backgroundColor: `${circleHex}22`, borderColor: `${circleHex}44` }}
                                                            className="text-xs font-black flex items-center gap-1 px-2.5 py-1 rounded-lg border shadow-sm"
                                                        >
                                                            <span>✓</span> Focused
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onSelectFilterCircle?.(circle.id);
                                                                onSwitchCircle(circle.id);
                                                            }}
                                                            className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-all flex items-center gap-1 cursor-pointer"
                                                        >
                                                            <span>Focus</span> ➔
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Create Circle */}
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                {!isCreatingCircle && (
                                    <button
                                        type="button"
                                        onClick={() => setIsCreatingCircle(true)}
                                        className="w-full py-3 px-3 active:scale-95 text-white font-black text-xs rounded-2xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                        style={{
                                            backgroundColor: activeThemeColor,
                                            boxShadow: `0 4px 14px ${activeThemeColor}40`
                                        }}
                                    >
                                        <span>+</span>
                                        <span>Create Circle</span>
                                    </button>
                                )}

                                {/* Create Circle Inline Form */}
                                {isCreatingCircle && (
                                    <form onSubmit={handleCreateCircle} className={`p-4 rounded-2xl border space-y-3 animate-in fade-in duration-150 ${cardBg}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black uppercase tracking-wider" style={{ color: newCircleColor }}>
                                                Create New Circle
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setIsCreatingCircle(false)}
                                                className="text-xs text-slate-400 hover:text-white"
                                            >
                                                ✕ Cancel
                                            </button>
                                        </div>

                                        <input
                                            type="text"
                                            placeholder="e.g. Friends Squad, Work Commute"
                                            value={newCircleName}
                                            onChange={(e) => setNewCircleName(e.target.value)}
                                            autoFocus
                                            className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-bold outline-none transition-colors ${
                                                isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                            }`}
                                        />

                                        {/* Color Selection - Circular Swatches */}
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                                    Circle Theme Color
                                                </label>
                                                <span
                                                    style={{
                                                        backgroundColor: `${newCircleColor}20`,
                                                        color: newCircleColor,
                                                        borderColor: `${newCircleColor}50`
                                                    }}
                                                    className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border transition-all duration-200 tracking-wider"
                                                >
                                                    {getCircleColor(undefined, newCircleColor).name}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                                                {CIRCLE_COLORS.map(c => {
                                                    const isSelected = newCircleColor.toLowerCase() === c.hex.toLowerCase();
                                                    return (
                                                        <button
                                                            key={c.id}
                                                            type="button"
                                                            onClick={() => {
                                                                hapticTick();
                                                                setNewCircleColor(c.hex);
                                                            }}
                                                            aria-label={c.name}
                                                            title={c.name}
                                                            className={`w-9 h-9 rounded-full transition-all duration-200 flex items-center justify-center cursor-pointer relative shrink-0 ${
                                                                isSelected
                                                                    ? 'ring-2 ring-white ring-offset-2 scale-110 shadow-lg'
                                                                    : 'opacity-80 hover:opacity-100 hover:scale-105 active:scale-95'
                                                            } ${isDark ? 'ring-offset-slate-900' : 'ring-offset-white'}`}
                                                            style={{
                                                                backgroundColor: c.hex,
                                                                boxShadow: isSelected ? `0 0 14px ${c.hex}90` : undefined
                                                            }}
                                                        >
                                                            {isSelected && (
                                                                <span className="text-white text-xs font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                                                    ✓
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={!newCircleName.trim() || isSubmitting}
                                            className="w-full py-2.5 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                                            style={{
                                                backgroundColor: newCircleColor,
                                                boxShadow: `0 4px 14px ${newCircleColor}40`
                                            }}
                                        >
                                            {isSubmitting ? 'Creating...' : 'Create & Switch to Circle'}
                                        </button>
                                    </form>
                                )}

                            </div>
                        </div>
                    )}

                    {/* ────────────────────────────────────────────────────────── */}
                    {/* TAB 2: INVITE (Share Code, SMS, QR Code)                   */}
                    {/* ────────────────────────────────────────────────────────── */}
                    {activeTab === 'invite' && (
                        <div className="space-y-4 text-center">
                            {currentCircle && (
                                <>
                            {/* QR Code Card */}
                            <div className="flex justify-center pt-2">
                                <div className="p-3 bg-white rounded-3xl shadow-xl border border-white/20">
                                    <QRCodeSVG value={shareUrl} size={150} level="H" includeMargin={false} />
                                </div>
                            </div>

                            {/* Invite Code Box */}
                            <div>
                                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">
                                    Circle Invite Code
                                </p>
                                <div
                                    onClick={handleCopyCode}
                                    className={`py-3 px-6 rounded-2xl border font-mono font-black text-2xl tracking-[0.15em] cursor-pointer transition-all hover:scale-105 active:scale-95 inline-flex items-center gap-2 ${
                                        isDark ? 'bg-white/5' : 'bg-slate-50'
                                    }`}
                                    style={{
                                        color: activeThemeColor,
                                        borderColor: `${activeThemeColor}40`,
                                        boxShadow: `0 0 16px ${activeThemeColor}20`
                                    }}
                                    title="Click to copy code"
                                >
                                    <span>{formatSegmentedInviteCode(inviteCode)}</span>
                                    <span className="text-xs">📋</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1">Tap code to copy</p>
                            </div>

                            {/* Action Buttons */}
                            <div className="space-y-2 pt-1">
                                <button
                                    type="button"
                                    onClick={handleShareInvite}
                                    className="w-full py-3 px-4 active:scale-95 text-white font-black text-xs rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                                    style={{
                                        backgroundColor: activeThemeColor,
                                        boxShadow: `0 6px 20px ${activeThemeColor}40`
                                    }}
                                >
                                    <span>✉️</span>
                                    <span>Share Invite Link / SMS</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleCopyCode}
                                    className={`w-full py-2.5 px-4 rounded-2xl border text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${
                                        isDark ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'
                                    }`}
                                >
                                    <span>📋</span>
                                    <span>Copy Code Only</span>
                                </button>
                            </div>
                                </>
                            )}

                            {/* Joining lives beside invitation sharing, not current-circle management. */}
                            <form onSubmit={(event) => handleJoinCircle(manualInviteCode, event)} className={`pt-4 mt-4 border-t space-y-2.5 text-left ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h4 className={`text-xs font-black ${textColor}`}>Join another Circle</h4>
                                        <p className={`text-[10px] ${subTextColor}`}>{currentCircle ? 'Enter an invite code or scan a QR code.' : 'Enter an invite code or scan a QR code to get started.'}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsScannerOpen(true)}
                                        className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${isDark ? 'border-purple-500/30 bg-purple-500/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700'}`}
                                        title="Scan a Circle QR code"
                                        aria-label="Scan a Circle QR code"
                                    >
                                        <QrCode className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="XXXX - XXXX"
                                        maxLength={11}
                                        value={manualInviteCode}
                                        onChange={(event) => handleCodeChange(event.target.value)}
                                        className={`min-w-0 flex-1 px-3 py-2.5 rounded-xl border text-xs font-mono font-black tracking-[0.16em] text-center uppercase outline-none ${isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                                    />
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || cleanInviteCode(manualInviteCode).length !== 8}
                                        className="px-4 rounded-xl text-white font-black text-xs disabled:opacity-50"
                                        style={{ backgroundColor: activeThemeColor }}
                                    >
                                        {isSubmitting ? 'Joining...' : 'Join'}
                                    </button>
                                </div>
                                {joinError && <p className="text-[10px] font-bold text-red-400">{joinError}</p>}
                            </form>
                        </div>
                    )}

                    {/* ────────────────────────────────────────────────────────── */}
                    {/* TAB 3: MANAGE (Rename, Members, Roles, Leave/Delete)       */}
                    {/* ────────────────────────────────────────────────────────── */}
                    {activeTab === 'manage' && (
                        <div className="space-y-4">
                            {/* Rename Circle */}
                            {currentCircle && (
                                <div className={`p-3.5 rounded-2xl border space-y-2 ${cardBg}`}>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                        Circle Name
                                    </span>
                                    {isRenaming ? (
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={editingCircleName}
                                                onChange={(e) => setEditingCircleName(e.target.value)}
                                                className={`flex-1 px-3 py-1.5 rounded-xl border text-xs font-bold outline-none focus:border-indigo-500 ${
                                                    isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                                }`}
                                            />
                                            <button
                                                type="button"
                                                onClick={handleSaveRename}
                                                className="px-3 py-1.5 text-white font-bold text-xs rounded-xl active:scale-95 shadow cursor-pointer"
                                                style={{ backgroundColor: activeThemeColor }}
                                            >
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsRenaming(false)}
                                                className="px-2 py-1.5 text-xs text-slate-400 hover:text-white"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={!isOwner}
                                            onClick={() => {
                                                if (!isOwner) return;
                                                setEditingCircleName(currentCircle.name);
                                                setIsRenaming(true);
                                            }}
                                            className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors ${isOwner ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}
                                            title={isOwner ? 'Rename Circle' : 'Only the owner can rename this Circle'}
                                        >
                                            <span className={`text-sm font-black ${textColor}`}>
                                                {currentCircle.name}
                                            </span>
                                            <span className="text-xs font-black" style={{ color: activeThemeColor }}>
                                                {isOwner ? 'Edit ›' : 'Owner managed'}
                                            </span>
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Circle Color Theme Picker (For Owner/Admin) */}
                            {currentCircle && (
                                <div
                                    className={`p-3.5 rounded-2xl border space-y-2.5 transition-all duration-200 ${cardBg}`}
                                    style={{ borderColor: `${activeThemeColor}40` }}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                            Circle Color
                                        </span>
                                        <span
                                            style={{
                                                backgroundColor: `${activeThemeColor}20`,
                                                color: activeThemeColor,
                                                borderColor: `${activeThemeColor}50`
                                            }}
                                            className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full border transition-all duration-200 tracking-wider shadow-sm"
                                        >
                                            {selectedColorInfo.name}
                                        </span>
                                    </div>

                                    {!isOwner && (
                                        <p className={`text-[10px] font-semibold ${subTextColor}`}>
                                            {circleOwnerName} manages the shared circle name and color.
                                        </p>
                                    )}

                                    {/* Compact row of circular color swatches */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                        {CIRCLE_COLORS.map(c => {
                                            const isSelected = activeThemeColor.toLowerCase() === c.hex.toLowerCase();
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    disabled={!isOwner}
                                                    onClick={() => handleSelectColorTheme(c.hex)}
                                                    aria-label={c.name}
                                                    title={isOwner ? c.name : `${circleOwnerName} manages the circle color`}
                                                    className={`w-10 h-10 rounded-full transition-all duration-200 flex items-center justify-center cursor-pointer relative shrink-0 ${
                                                        isSelected
                                                            ? 'ring-2 ring-white ring-offset-2 scale-110 shadow-lg'
                                                            : 'opacity-80 hover:opacity-100 hover:scale-105 active:scale-95'
                                                    } ${isDark ? 'ring-offset-slate-900' : 'ring-offset-white'} ${!isOwner ? 'cursor-not-allowed opacity-55 hover:scale-100' : ''}`}
                                                    style={{
                                                        backgroundColor: c.hex,
                                                        boxShadow: isSelected ? `0 0 16px ${c.hex}90` : undefined
                                                    }}
                                                >
                                                    {isSelected && (
                                                        <span className="text-white text-xs font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                                            ✓
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Circle Members & Roles */}
                            <div className="space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block px-1">
                                    Circle Members ({members.length})
                                </span>

                                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                    {members.map((member) => (
                                        <div
                                            key={member.id}
                                            className={`p-2.5 rounded-2xl border flex items-center justify-between gap-3 ${cardBg}`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                <img
                                                    src={member.avatar}
                                                    className="w-9 h-9 rounded-xl object-cover border border-white/10"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <h5 className={`text-xs font-bold truncate ${textColor}`}>
                                                            {member.name}
                                                        </h5>
                                                        {member.id === currentCircle?.ownerId && (
                                                            <span className="text-[7px] font-black uppercase px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                                                OWNER
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[9px] text-slate-400 truncate">
                                                        {member.status} • 🔋 {member.battery}%
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Role & Actions */}
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {editingMemberRole === member.id ? (
                                                    <div className="flex gap-1 flex-wrap">
                                                        {ROLES.map(role => (
                                                            <button
                                                                key={role}
                                                                onClick={() => {
                                                                    onUpdateRole?.(member.id, role);
                                                                    setEditingMemberRole(null);
                                                                    showNotification?.(`Role updated to ${role}`, 2000);
                                                                }}
                                                                className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md border transition-all ${getRoleBadgeColor(role)}`}
                                                            >
                                                                {role}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => isOwner && setEditingMemberRole(member.id)}
                                                        className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border transition-all ${getRoleBadgeColor(member.role)} ${
                                                            isOwner ? 'cursor-pointer hover:scale-105' : 'cursor-default'
                                                        }`}
                                                    >
                                                        {member.role} {isOwner && '▾'}
                                                    </button>
                                                )}

                                                {isOwner && member.id !== currentUserId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (window.confirm(`Remove ${member.name} from "${currentCircle?.name}"?`)) {
                                                                onRemoveMember?.(member.id);
                                                                showNotification?.(`Removed ${member.name}`, 3000);
                                                            }
                                                        }}
                                                        className="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center text-xs transition-all cursor-pointer"
                                                        title="Remove Member"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Leave and deletion are intentionally separated. */}
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                {isOwner && managedMemberCount <= 1 ? (
                                    <button
                                        type="button"
                                        onClick={handleDeleteCurrentCircle}
                                        className="w-full py-2.5 px-4 rounded-2xl border border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <span>🗑️</span>
                                        <span>Delete Circle</span>
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleLeaveCurrentCircle}
                                        className="w-full py-2.5 px-4 rounded-2xl border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <span>🚪</span>
                                        <span>Leave This Circle</span>
                                    </button>
                                )}

                                {isOwner && managedMemberCount > 1 && (
                                    <div className="rounded-2xl border border-red-500/20 overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setIsDangerZoneOpen(open => !open)}
                                            className="w-full px-4 py-2.5 flex items-center justify-between text-left text-[10px] font-black uppercase tracking-wider text-red-400 hover:bg-red-500/5"
                                            aria-expanded={isDangerZoneOpen}
                                        >
                                            <span>Advanced danger zone</span>
                                            <span>{isDangerZoneOpen ? '⌃' : '⌄'}</span>
                                        </button>
                                        {isDangerZoneOpen && (
                                            <div className="px-4 pb-3 space-y-2 animate-in fade-in duration-150">
                                                <p className="text-[10px] leading-relaxed text-slate-400">
                                                    Deleting removes this Circle, its shared places, and access for all {managedMemberCount} members.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={handleDeleteCurrentCircle}
                                                    className="w-full py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-black text-xs transition-colors"
                                                >
                                                    Delete Circle Permanently
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Camera QR Scanner Modal */}
            <QRScannerModal
                isOpen={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onScan={handleScanResult}
                theme={theme}
                title="Scan Circle QR Code"
                description="Point your camera at another family member's screen to join their Circle instantly"
            />
        </div>
    );
};

export default CircleSettingsModal;
