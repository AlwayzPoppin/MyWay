import React, { useState, useMemo } from 'react';
import { FamilyMember } from '../types';
import { FamilyCircle, getCircleColor } from '../services/authService';
import {
    calculateFamilyLeaderboard,
    FamilyLeaderboard,
    MemberDrivingStats,
    SafetyBadge,
    SAFETY_BADGE_DEFINITIONS
} from '../services/safetyScoreService';

interface WeeklySafetyReportProps {
    onClose: () => void;
    onBack?: () => void;
    members?: FamilyMember[];
    userCircles?: FamilyCircle[];
    currentCircle?: FamilyCircle | null;
    currentUserId?: string;
    theme: 'light' | 'dark';
}

const WeeklySafetyReport: React.FC<WeeklySafetyReportProps> = ({
    onClose,
    onBack,
    members = [],
    userCircles = [],
    currentCircle = null,
    currentUserId,
    theme
}) => {
    const isDark = theme === 'dark';
    const panelBg = isDark ? 'bg-slate-900/98 border-white/10' : 'bg-white/98 border-slate-200';
    const subBg = isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';
    const textColor = isDark ? 'text-white' : 'text-slate-900';

    const [activeTab, setActiveTab] = useState<'leaderboard' | 'myscore' | 'badges'>('leaderboard');
    const [selectedCircleId, setSelectedCircleId] = useState<string>(() => {
        return currentCircle?.id || (userCircles[0]?.id) || 'all';
    });

    const activeCircle = useMemo(() => {
        return userCircles.find(c => c.id === selectedCircleId) || currentCircle || null;
    }, [selectedCircleId, userCircles, currentCircle]);

    // Calculate leaderboard data
    const leaderboard: FamilyLeaderboard = useMemo(() => {
        return calculateFamilyLeaderboard(members, currentUserId, activeCircle?.name || 'Family Circle');
    }, [members, currentUserId, activeCircle]);

    const selfStats: MemberDrivingStats | undefined = useMemo(() => {
        return leaderboard.members.find(m => m.memberId === currentUserId || m.memberId === 'current_user' || m.memberId === 'demo-you') || leaderboard.members[0];
    }, [leaderboard, currentUserId]);

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'text-emerald-400';
        if (score >= 75) return 'text-amber-400';
        return 'text-rose-400';
    };

    const getScoreBg = (score: number) => {
        if (score >= 90) return 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400';
        if (score >= 75) return 'bg-amber-500/20 border-amber-500/30 text-amber-400';
        return 'bg-rose-500/20 border-rose-500/30 text-rose-400';
    };

    const handleShareLeaderboard = async () => {
        const text = `🏆 MyWay GPS Weekly Driving Safety Leaderboard (${leaderboard.weekRange})\n` +
            `🥇 Rank 1: ${leaderboard.members[0]?.name} (${leaderboard.members[0]?.safetyScore}% Score)\n` +
            `🌟 Smooth Operator: ${leaderboard.featuredAwards[0]?.winnerName}\n` +
            `⚡ Road Warrior: ${leaderboard.featuredAwards[1]?.winnerName} (${leaderboard.featuredAwards[1]?.metricValue})\n` +
            `🔋 Eco Cruiser: ${leaderboard.featuredAwards[2]?.winnerName} (${leaderboard.featuredAwards[2]?.metricValue})\n` +
            `🚀 Group Total: ${leaderboard.totalGroupMiles} miles navigated safely!`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `MyWay Safety Leaderboard - ${leaderboard.circleName}`,
                    text
                });
            } catch {}
        } else {
            try {
                await navigator.clipboard.writeText(text);
                alert('📋 Copied Weekly Safety Scorecard to clipboard!');
            } catch {}
        }
    };

    return (
        <div className={`h-full flex flex-col max-h-[85vh] rounded-[2.5rem] overflow-hidden shadow-2xl border ${panelBg}`}>
            {/* Header with gradient banner */}
            <div className="bg-gradient-to-r from-amber-500 via-indigo-600 to-purple-600 p-5 text-white flex justify-between items-center shadow-lg shrink-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all cursor-pointer"
                        >
                            ←
                        </button>
                    )}
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-xl">🏆</span>
                            <h2 className="text-base font-black tracking-tight text-white leading-none">
                                Family Driving Scorecard
                            </h2>
                        </div>
                        <p className="text-[10px] text-amber-200 mt-1 uppercase tracking-wider font-bold">
                            {leaderboard.circleName} • Week of {leaderboard.weekRange}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleShareLeaderboard}
                        title="Share Weekly Scorecard"
                        className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                        <span>📤</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all cursor-pointer"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Circle Switcher Strip (if user has circles) */}
            {userCircles.length > 1 && (
                <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2 overflow-x-auto no-scrollbar bg-black/10 shrink-0">
                    {userCircles.map(c => {
                        const cHex = c.color || getCircleColor(c.id).hex;
                        const isSelected = selectedCircleId === c.id;
                        return (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setSelectedCircleId(c.id)}
                                style={{
                                    borderColor: isSelected ? cHex : undefined,
                                    backgroundColor: isSelected ? `${cHex}25` : undefined
                                }}
                                className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all shrink-0 cursor-pointer ${
                                    isSelected
                                        ? 'text-white shadow-sm'
                                        : isDark
                                        ? 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                                        : 'bg-white border-slate-200 text-slate-600'
                                }`}
                            >
                                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: cHex }} />
                                {c.name}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex border-b border-white/10 px-4 pt-2 shrink-0">
                <button
                    onClick={() => setActiveTab('leaderboard')}
                    className={`flex-1 pb-2.5 text-xs font-black uppercase tracking-wider text-center transition-all cursor-pointer border-b-2 ${
                        activeTab === 'leaderboard'
                            ? 'border-amber-400 text-amber-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                    🏆 Leaderboard
                </button>
                <button
                    onClick={() => setActiveTab('myscore')}
                    className={`flex-1 pb-2.5 text-xs font-black uppercase tracking-wider text-center transition-all cursor-pointer border-b-2 ${
                        activeTab === 'myscore'
                            ? 'border-indigo-400 text-indigo-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                    📊 My Telemetry
                </button>
                <button
                    onClick={() => setActiveTab('badges')}
                    className={`flex-1 pb-2.5 text-xs font-black uppercase tracking-wider text-center transition-all cursor-pointer border-b-2 ${
                        activeTab === 'badges'
                            ? 'border-purple-400 text-purple-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                    🎖️ Awards ({leaderboard.featuredAwards.length})
                </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
                {/* ─── TAB 1: LEADERBOARD & PODIUM ─── */}
                {activeTab === 'leaderboard' && (
                    <div className="space-y-4">
                        {/* Weekly Awards Highlights Strip */}
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                🌟 Weekly Award Winners
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                {leaderboard.featuredAwards.map(award => (
                                    <div
                                        key={award.id}
                                        style={{ borderColor: `${award.accentHex}40`, backgroundColor: `${award.accentHex}10` }}
                                        className="p-2.5 rounded-2xl border flex flex-col items-center text-center relative overflow-hidden"
                                    >
                                        <div className="text-2xl mb-1">{award.icon}</div>
                                        <p className="text-[10px] font-black leading-tight truncate w-full" style={{ color: award.accentHex }}>
                                            {award.title}
                                        </p>
                                        <p className="text-xs font-black text-white truncate w-full mt-0.5">
                                            {award.winnerName}
                                        </p>
                                        <span className="text-[8px] font-bold text-slate-400 mt-1">
                                            {award.metricValue}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Top Group Summary Stats */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className={`p-3 rounded-2xl border ${subBg} text-center`}>
                                <p className="text-2xl font-black text-white">{leaderboard.totalGroupMiles} mi</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                    🚗 Circle Miles Driven
                                </p>
                            </div>
                            <div className={`p-3 rounded-2xl border ${subBg} text-center`}>
                                <p className="text-2xl font-black text-emerald-400">{leaderboard.avgGroupScore}%</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                    🛡️ Group Safety Score
                                </p>
                            </div>
                        </div>

                        {/* Member Rankings List */}
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                🏅 Family Safety Rankings
                            </p>

                            <div className="space-y-2">
                                {leaderboard.members.map((member, idx) => {
                                    const isSelf = member.memberId === currentUserId || member.memberId === 'current_user' || member.memberId === 'demo-you';
                                    const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;

                                    return (
                                        <div
                                            key={member.memberId}
                                            className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                                                isSelf
                                                    ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/40 ring-1'
                                                    : subBg
                                            }`}
                                        >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className="w-7 text-center font-black text-base shrink-0">
                                                    {rankBadge}
                                                </div>

                                                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-black text-white text-xs shrink-0 shadow-inner overflow-hidden border border-white/20">
                                                    {member.avatar ? (
                                                        <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        member.name.charAt(0).toUpperCase()
                                                    )}
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <h4 className={`text-xs font-black truncate ${textColor}`}>
                                                            {member.name}
                                                        </h4>
                                                        {isSelf && (
                                                            <span className="text-[8px] font-black uppercase px-1.5 py-0.2 rounded bg-indigo-500 text-white shrink-0">
                                                                YOU
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                                        <span>{member.totalMiles} mi</span>
                                                        <span>•</span>
                                                        <span>{member.totalTrips} trips</span>
                                                        {member.hardBrakes === 0 && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="text-emerald-400 font-bold">0 Brakes</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Safety Score Pill */}
                                            <div className="text-right shrink-0">
                                                <div className={`px-2.5 py-1 rounded-xl border text-xs font-black ${getScoreBg(member.safetyScore)}`}>
                                                    {member.safetyScore}%
                                                </div>
                                                <div className="flex items-center justify-end gap-1 mt-1">
                                                    {member.badges.slice(0, 3).map(b => (
                                                        <span key={b.id} title={b.title} className="text-xs">
                                                            {b.icon}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── TAB 2: MY DRIVING SCORECARD & TELEMETRY ─── */}
                {activeTab === 'myscore' && selfStats && (
                    <div className="space-y-4">
                        {/* Hero Score Box */}
                        <div className={`p-6 rounded-[2rem] border text-center relative overflow-hidden ${
                            isDark ? 'bg-gradient-to-b from-indigo-950/40 to-slate-900/60 border-indigo-500/20' : 'bg-slate-50 border-slate-200'
                        }`}>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                                Your Driving Safety Rating
                            </p>
                            <div className="flex items-center justify-center gap-1 my-2">
                                <span className={`text-6xl font-black ${getScoreColor(selfStats.safetyScore)}`}>
                                    {selfStats.safetyScore}
                                </span>
                                <span className="text-2xl font-bold text-slate-500 mt-4">%</span>
                            </div>
                            <p className="text-xs font-bold text-slate-300">
                                {selfStats.safetyScore >= 95
                                    ? '🏆 Elite Driver — Smooth and predictive braking'
                                    : selfStats.safetyScore >= 85
                                    ? '⭐ Safe Driver — Solid speed consistency'
                                    : '⚠️ Needs Attention — Moderate hard braking events'}
                            </p>
                        </div>

                        {/* Telemetry Breakdown Grid */}
                        <div className="grid grid-cols-3 gap-2.5">
                            <div className={`p-3 rounded-2xl border text-center ${subBg}`}>
                                <p className={`text-xl font-black ${selfStats.hardBrakes === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {selfStats.hardBrakes}
                                </p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">🛑 Hard Brakes</p>
                            </div>
                            <div className={`p-3 rounded-2xl border text-center ${subBg}`}>
                                <p className={`text-xl font-black ${selfStats.rapidAccels <= 1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {selfStats.rapidAccels}
                                </p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">🏎️ Rapid Accels</p>
                            </div>
                            <div className={`p-3 rounded-2xl border text-center ${subBg}`}>
                                <p className={`text-xl font-black ${selfStats.speedingEvents === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {selfStats.speedingEvents}
                                </p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">⚡ Speeding</p>
                            </div>
                        </div>

                        {/* Eco Efficiency & Gas Savings */}
                        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-cyan-50 border-cyan-100'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">🔋</span>
                                    <h4 className="text-xs font-black text-cyan-400 uppercase tracking-wider">
                                        Eco & Fuel Efficiency
                                    </h4>
                                </div>
                                <span className="text-xs font-black text-cyan-400">
                                    {selfStats.ecoScore}% Score
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                Your smooth throttle management helped conserve an estimated ~1.2 gallons of fuel and $4.20 in energy costs across your recent drives.
                            </p>
                        </div>

                        {/* AI Driving Coach Insight */}
                        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">🤖</span>
                                <h4 className="text-xs font-black text-indigo-400 uppercase tracking-wider">
                                    AI Co-Pilot Coach
                                </h4>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                {selfStats.hardBrakes === 0
                                    ? "Flawless braking technique! Maintaining a 3-second buffer ahead allows for smooth deceleration into highway off-ramps."
                                    : "Tip: Increase following distance on arterial roads like Carson Drive to reduce sudden braking when approaching traffic signals."}
                            </p>
                        </div>
                    </div>
                )}

                {/* ─── TAB 3: AWARDS & BADGES SHOWCASE ─── */}
                {activeTab === 'badges' && (
                    <div className="space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            🎖️ Circle Achievement Badges
                        </p>

                        <div className="space-y-2.5">
                            {Object.values(SAFETY_BADGE_DEFINITIONS).map(badge => {
                                const awardInfo = leaderboard.featuredAwards.find(a => a.id === badge.id);
                                const isWonBySelf = selfStats?.badges.some(b => b.id === badge.id);

                                return (
                                    <div
                                        key={badge.id}
                                        style={{ borderColor: `${badge.accentHex}40`, backgroundColor: `${badge.accentHex}10` }}
                                        className="p-3.5 rounded-2xl border flex items-start gap-3 relative overflow-hidden"
                                    >
                                        <div
                                            style={{ backgroundColor: `${badge.accentHex}25` }}
                                            className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-inner"
                                        >
                                            {badge.icon}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-1">
                                                <h4 className="text-xs font-black text-white truncate">
                                                    {badge.title}
                                                </h4>
                                                {isWonBySelf && (
                                                    <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                                                        UNLOCKED 🌟
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-[10px] font-bold text-slate-300 mt-0.5">
                                                {badge.tagline}
                                            </p>
                                            <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                                                {badge.description}
                                            </p>

                                            {awardInfo?.winnerName && (
                                                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[9px] font-bold text-slate-400">
                                                    <span>Current Holder: <strong className="text-white">{awardInfo.winnerName}</strong></span>
                                                    <span style={{ color: badge.accentHex }}>{awardInfo.metricValue}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WeeklySafetyReport;
