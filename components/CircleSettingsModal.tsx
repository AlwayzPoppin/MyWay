import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { FamilyMember } from '../types';
import { FamilyCircle, CIRCLE_COLORS, getCircleColor, CircleColorInfo } from '../services/authService';
import { getCirclePrivacyMode, PRIVACY_LEVELS } from '../services/privacyService';
import { formatSegmentedInviteCode, cleanInviteCode, isValidInviteCode } from '../utils/inviteCode';

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
    const [newCircleName, setNewCircleName] = useState('');
    const [newCircleColor, setNewCircleColor] = useState<string>(CIRCLE_COLORS[0].hex);
    const [isJoiningCircle, setIsJoiningCircle] = useState(false);
    const [joinInviteCode, setJoinInviteCode] = useState('');
    const [manualInviteCode, setManualInviteCode] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [editingCircleName, setEditingCircleName] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);
    const [editingMemberRole, setEditingMemberRole] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const autoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
            setIsCreatingCircle(false);
            setIsJoiningCircle(false);
            setJoinInviteCode('');
            setManualInviteCode('');
            setJoinError(null);
            if (autoSubmitTimerRef.current) {
                clearTimeout(autoSubmitTimerRef.current);
                autoSubmitTimerRef.current = null;
            }
            setEditingCircleName(currentCircle?.name || '');
            setIsRenaming(false);
            const defaultColor = currentCircle?.color || (currentCircle ? getCircleColor(currentCircle.id).hex : CIRCLE_COLORS[0].hex);
            setNewCircleColor(defaultColor);
        }
    }, [isOpen, initialTab, currentCircle]);

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
        const rawCode = typeof codeToJoin === 'string' ? codeToJoin : joinInviteCode;
        const cleanCode = cleanInviteCode(rawCode);

        if (!cleanCode) {
            setJoinError('Please enter an 8-character invite code.');
            return;
        }

        if (cleanCode.length !== 8) {
            const err = `Invite code must be exactly 8 characters (entered ${cleanCode.length}/8).`;
            setJoinError(err);
            showNotification?.(`⚠️ ${err}`, 3500);
            return;
        }

        // Validate if user is already a member of this circle
        const alreadyInCircle = userCircles.some(c => cleanInviteCode(c.inviteCode) === cleanCode);
        if (alreadyInCircle) {
            const err = 'Already in this circle.';
            setJoinError(err);
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
                showNotification?.(`🎉 Successfully joined circle "${circle.name}"!`, 3000);
                setJoinInviteCode('');
                setManualInviteCode('');
                setIsJoiningCircle(false);
                setActiveTab('circles');
            } else {
                const err = 'Invalid code. No matching circle found.';
                setJoinError(err);
                showNotification?.(`⚠️ ${err}`, 4000);
            }
        } catch (err: any) {
            const errMsg = err?.message || 'Could not join circle';
            setJoinError(errMsg);
            showNotification?.(`⚠️ ${errMsg}`, 4000);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCodeChange = (val: string, target: 'tab1' | 'tab3') => {
        const formatted = formatSegmentedInviteCode(val);
        const cleaned = cleanInviteCode(formatted);

        if (target === 'tab1') {
            setJoinInviteCode(formatted);
        } else {
            setManualInviteCode(formatted);
        }

        if (joinError) setJoinError(null);

        if (autoSubmitTimerRef.current) {
            clearTimeout(autoSubmitTimerRef.current);
            autoSubmitTimerRef.current = null;
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
        const text = `Join my circle "${currentCircle?.name || 'Family'}" on MyWay GPS! Use Invite Code: ${inviteCode}\n${shareUrl}`;
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Join ${currentCircle?.name || 'Family'} on MyWay GPS`,
                    text,
                    url: shareUrl
                });
            } catch {}
        } else {
            handleCopyCode();
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
                {/* Header Ambient Glow */}
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />

                {/* Top Header */}
                <div className="p-5 pb-3 border-b border-white/10 relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl shadow-inner shrink-0">
                            👥
                        </div>
                        <div className="min-w-0">
                            <h2 className={`text-base font-black tracking-tight truncate ${textColor}`}>
                                {currentCircle?.name || 'Circle Settings'}
                            </h2>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                {userCircles.length} {userCircles.length === 1 ? 'Circle' : 'Circles'} Available
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

                {/* Tabs Navigation */}
                <div className="px-5 pt-3 relative z-10">
                    <div className={`p-1 rounded-2xl border flex gap-1 ${
                        isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'
                    }`}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('circles')}
                            className={`flex-1 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                activeTab === 'circles'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <span>🗂️</span>
                            <span>Circles ({userCircles.length})</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('invite')}
                            className={`flex-1 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                activeTab === 'invite'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <span>✉️</span>
                            <span>Invite</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('manage')}
                            className={`flex-1 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                activeTab === 'manage'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-400 hover:text-white'
                            }`}
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

                            {/* Create / Join Actions */}
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                {/* Create Circle Toggle */}
                                {!isCreatingCircle && !isJoiningCircle && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsCreatingCircle(true)}
                                            className="py-3 px-3 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs rounded-2xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            <span>+</span>
                                            <span>Create Circle</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setIsJoiningCircle(true)}
                                            className={`py-3 px-3 border active:scale-95 font-black text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                                isDark ? 'border-white/15 bg-white/5 hover:bg-white/10 text-white' : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-900'
                                            }`}
                                        >
                                            <span>🔗</span>
                                            <span>Join with Code</span>
                                        </button>
                                    </div>
                                )}

                                {/* Create Circle Inline Form */}
                                {isCreatingCircle && (
                                    <form onSubmit={handleCreateCircle} className={`p-4 rounded-2xl border space-y-3 animate-in fade-in duration-150 ${cardBg}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black text-indigo-400 uppercase tracking-wider">
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
                                            className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-bold outline-none focus:border-indigo-500 transition-colors ${
                                                isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                            }`}
                                        />

                                        {/* Color Selection */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                                Circle Theme Color
                                            </label>
                                            <div className="grid grid-cols-4 gap-2">
                                                {CIRCLE_COLORS.map(c => {
                                                    const isSelected = newCircleColor.toLowerCase() === c.hex.toLowerCase();
                                                    return (
                                                        <button
                                                            key={c.id}
                                                            type="button"
                                                            onClick={() => setNewCircleColor(c.hex)}
                                                            className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                                                isSelected
                                                                    ? 'ring-2 ring-white border-transparent scale-105 shadow-md'
                                                                    : 'border-white/10 hover:border-white/20 opacity-80 hover:opacity-100'
                                                            }`}
                                                            style={{ backgroundColor: c.bg }}
                                                        >
                                                            <div className="w-4 h-4 rounded-full border border-white/40 shadow-sm" style={{ backgroundColor: c.hex }} />
                                                            <span className="text-[9px] font-bold text-white truncate max-w-full">{c.name.split(' ')[0]}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={!newCircleName.trim() || isSubmitting}
                                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
                                        >
                                            {isSubmitting ? 'Creating...' : 'Create & Switch to Circle'}
                                        </button>
                                    </form>
                                )}

                                {/* Join Circle Inline Form */}
                                {isJoiningCircle && (
                                    <form onSubmit={(e) => handleJoinCircle(joinInviteCode, e)} className={`p-4 rounded-2xl border space-y-3 animate-in fade-in duration-150 ${cardBg}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black text-purple-400 uppercase tracking-wider">
                                                Join a Circle
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsJoiningCircle(false);
                                                    setJoinError(null);
                                                }}
                                                className="text-xs text-slate-400 hover:text-white"
                                            >
                                                ✕ Cancel
                                            </button>
                                        </div>

                                        <div className="relative">
                                            <input
                                                type="text"
                                                placeholder="XXXX - XXXX"
                                                maxLength={11}
                                                value={joinInviteCode}
                                                onChange={(e) => handleCodeChange(e.target.value, 'tab1')}
                                                autoFocus
                                                className={`w-full px-3.5 py-2.5 pr-16 rounded-xl border text-xs font-mono font-black text-center tracking-[0.2em] uppercase outline-none transition-all duration-300 ${
                                                    cleanInviteCode(joinInviteCode).length === 8
                                                        ? 'border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-500/20 animate-pulse'
                                                        : 'focus:border-purple-500'
                                                } ${
                                                    isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                                }`}
                                            />
                                            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-mono font-black px-1.5 py-0.5 rounded-md transition-all duration-300 ${
                                                cleanInviteCode(joinInviteCode).length === 8
                                                    ? 'bg-emerald-500 text-white shadow-sm scale-105'
                                                    : isDark ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'
                                            }`}>
                                                {isSubmitting && cleanInviteCode(joinInviteCode).length === 8
                                                    ? 'Joining...'
                                                    : cleanInviteCode(joinInviteCode).length === 8
                                                        ? '8/8 ✓'
                                                        : `${cleanInviteCode(joinInviteCode).length}/8`}
                                            </span>
                                        </div>

                                        {joinError && (
                                            <p className="text-[10px] font-bold text-red-400 mt-1">{joinError}</p>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={!cleanInviteCode(joinInviteCode).length || isSubmitting}
                                            className={`w-full py-2.5 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 ${
                                                cleanInviteCode(joinInviteCode).length === 8
                                                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/25 ring-2 ring-emerald-400/40 animate-pulse'
                                                    : 'bg-purple-600 hover:bg-purple-500 disabled:opacity-50'
                                            }`}
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <span className="animate-spin inline-block">⏳</span>
                                                    <span>Joining Circle...</span>
                                                </>
                                            ) : cleanInviteCode(joinInviteCode).length === 8 ? (
                                                <>
                                                    <span>⚡</span>
                                                    <span>Join Now</span>
                                                </>
                                            ) : (
                                                <span>Join</span>
                                            )}
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
                                        isDark ? 'bg-white/5 border-white/10 text-indigo-400' : 'bg-slate-50 border-slate-200 text-indigo-600'
                                    }`}
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
                                    className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-95 text-white font-black text-xs rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
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
                                                className="px-3 py-1.5 bg-indigo-600 text-white font-bold text-xs rounded-xl active:scale-95 shadow"
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
                                        <div className="flex items-center justify-between">
                                            <span className={`text-sm font-black ${textColor}`}>
                                                {currentCircle.name}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingCircleName(currentCircle.name);
                                                    setIsRenaming(true);
                                                }}
                                                className="text-xs font-bold text-indigo-400 hover:underline"
                                            >
                                                ✏️ Rename
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Circle Color Theme Picker (For Owner/Admin) */}
                            {currentCircle && (
                                <div className={`p-3.5 rounded-2xl border space-y-2.5 ${cardBg}`}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                            Circle Base Color Theme
                                        </span>
                                        <span
                                            style={{ backgroundColor: `${currentCircle.color || getCircleColor(currentCircle.id).hex}33`, color: currentCircle.color || getCircleColor(currentCircle.id).hex }}
                                            className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md border border-current"
                                        >
                                            {getCircleColor(currentCircle.id, currentCircle.color).name}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        {CIRCLE_COLORS.map(c => {
                                            const isSelected = (currentCircle.color || getCircleColor(currentCircle.id).hex).toLowerCase() === c.hex.toLowerCase();
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => onUpdateCircleColor?.(currentCircle.id, c.hex)}
                                                    className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                                        isSelected
                                                            ? 'ring-2 ring-white border-transparent scale-105 shadow-md'
                                                            : 'border-white/10 hover:border-white/20 opacity-80 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: c.bg }}
                                                >
                                                    <div className="w-4 h-4 rounded-full border border-white/40 shadow-sm" style={{ backgroundColor: c.hex }} />
                                                    <span className="text-[9px] font-bold text-white truncate max-w-full">{c.name.split(' ')[0]}</span>
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

                            {/* Join a Circle Section */}
                            <div className={`p-3.5 rounded-2xl border space-y-3 ${cardBg}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">🔗</span>
                                        <div>
                                            <h4 className={`text-xs font-black uppercase tracking-wider ${textColor}`}>
                                                Join a Circle
                                            </h4>
                                            <p className={`text-[10px] ${subTextColor}`}>
                                                Enter an 8-character invite code (e.g. ABCD - 1234)
                                            </p>
                                        </div>
                                    </div>
                                    <span className={`text-[9px] font-mono font-black px-2 py-0.5 rounded-md ${
                                        cleanInviteCode(manualInviteCode).length === 8
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                            : isDark ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        {cleanInviteCode(manualInviteCode).length === 8 ? '8/8 ✓' : `${cleanInviteCode(manualInviteCode).length} / 8`}
                                    </span>
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="XXXX - XXXX"
                                        maxLength={11}
                                        value={manualInviteCode}
                                        onChange={(e) => handleCodeChange(e.target.value, 'tab3')}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
                                                handleJoinCircle(manualInviteCode);
                                            }
                                        }}
                                        className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-mono font-black tracking-[0.2em] text-center uppercase outline-none transition-all duration-300 ${
                                            cleanInviteCode(manualInviteCode).length === 8
                                                ? 'border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-500/20 animate-pulse'
                                                : 'focus:border-indigo-500'
                                        } ${
                                            isDark ? 'bg-slate-800 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                                        }`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
                                            handleJoinCircle(manualInviteCode);
                                        }}
                                        disabled={isSubmitting || cleanInviteCode(manualInviteCode).length === 0}
                                        className={`px-5 py-2.5 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer shrink-0 flex items-center justify-center gap-1.5 ${
                                            cleanInviteCode(manualInviteCode).length === 8
                                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/25 ring-2 ring-emerald-400/40 animate-pulse'
                                                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50'
                                        }`}
                                    >
                                        {isSubmitting ? 'Joining...' : cleanInviteCode(manualInviteCode).length === 8 ? '⚡ Join' : 'Join'}
                                    </button>
                                </div>
                                {joinError && (
                                    <p className="text-[10px] font-bold text-red-400 mt-1">{joinError}</p>
                                )}
                            </div>

                            {/* Danger Zone: Leave / Delete Circle */}
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                <button
                                    type="button"
                                    onClick={handleLeaveCurrentCircle}
                                    className="w-full py-2.5 px-4 rounded-2xl border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>🚪</span>
                                    <span>Leave This Circle</span>
                                </button>

                                {isOwner && members.length <= 1 && (
                                    <button
                                        type="button"
                                        onClick={handleDeleteCurrentCircle}
                                        className="w-full py-2 px-4 text-red-500 hover:text-red-400 font-bold text-[10px] transition-all text-center cursor-pointer"
                                    >
                                        🗑️ Delete Circle Permanently
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CircleSettingsModal;
