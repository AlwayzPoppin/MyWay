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
import {
    Trophy,
    Share2,
    X,
    ArrowLeft,
    Car,
    ShieldCheck
} from 'lucide-react';

interface WeeklySafetyReportProps {
    onClose: () => void;
    onBack?: () => void;
    members?: FamilyMember[];
    userCircles?: FamilyCircle[];
    currentCircle?: FamilyCircle | null;
    currentUserId?: string;
    theme?: 'light' | 'dark';
}

const WeeklySafetyReport: React.FC<WeeklySafetyReportProps> = ({
    onClose,
    onBack,
    members = [],
    userCircles = [],
    currentCircle = null,
    currentUserId
}) => {
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

    const hasDrives = Boolean(selfStats && selfStats.totalTrips > 0 && selfStats.totalMiles > 0);

    const estimatedFuelSaved = useMemo(() => {
        if (!selfStats || !hasDrives) return '0.0';
        return Math.max(0.1, Math.round(((selfStats.totalMiles / 26) * (selfStats.ecoScore / 100) * 0.14) * 10) / 10).toFixed(1);
    }, [selfStats, hasDrives]);

    const estimatedCostSaved = useMemo(() => {
        return (parseFloat(estimatedFuelSaved) * 3.65).toFixed(2);
    }, [estimatedFuelSaved]);

    const aiCoachTip = useMemo(() => {
        if (!selfStats || !hasDrives) {
            return "Ready when you are! Your AI Coach will analyze your habits once you hit the road.";
        }
        if (selfStats.hardBrakes > 0 && selfStats.hardBrakes >= selfStats.rapidAccels) {
            return `Tip: Detected ${selfStats.hardBrakes} hard braking ${selfStats.hardBrakes === 1 ? 'event' : 'events'}. Increasing following distance on arterial corridors will help smooth out deceleration into traffic signals.`;
        }
        if (selfStats.speedingEvents > 0) {
            return `Tip: Logged ${selfStats.speedingEvents} speeding ${selfStats.speedingEvents === 1 ? 'instance' : 'instances'}. Keeping close to posted limits on surface streets and highway exits maintains a top safety tier.`;
        }
        if (selfStats.rapidAccels > 1) {
            return `Tip: Logged ${selfStats.rapidAccels} rapid accelerations. Smoother throttle modulation when merging optimizes fuel conservation and extends brake life.`;
        }
        return `Flawless braking technique! Maintaining a 3-second buffer ahead allows for smooth deceleration into highway off-ramps and optimal flow across your ${selfStats.totalMiles} miles.`;
    }, [selfStats, hasDrives]);

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'text-emerald-600';
        if (score >= 75) return 'text-amber-600';
        return 'text-rose-600';
    };

    const getScoreBg = (score: number) => {
        if (score >= 90) return 'bg-emerald-50 border-emerald-300 text-emerald-800';
        if (score >= 75) return 'bg-amber-50 border-amber-300 text-amber-800';
        return 'bg-rose-50 border-rose-300 text-rose-800';
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
        <div className="h-full flex flex-col max-h-[85vh] rounded-3xl overflow-hidden shadow-2xl border border-slate-200 bg-white">
            {/* Header: Clean, solid light background with subtle bottom border */}
            <div className="bg-white px-5 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    {onBack && (
                        <button
                            onClick={onBack}
                            aria-label="Back"
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-700 transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                    )}
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
                            <h2 className="text-base font-black tracking-tight text-slate-900 leading-none truncate">
                                Family Driving Scorecard
                            </h2>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-bold truncate">
                            {leaderboard.circleName} • Week of {leaderboard.weekRange}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleShareLeaderboard}
                        title="Share Weekly Scorecard"
                        aria-label="Share Weekly Scorecard"
                        className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                    >
                        <Share2 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-700 transition-all cursor-pointer shadow-xs active:scale-95"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Circle Switcher Strip (if user has multiple circles) */}
            {userCircles.length > 1 && (
                <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 overflow-x-auto no-scrollbar bg-slate-50 shrink-0">
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
                                    backgroundColor: isSelected ? `${cHex}15` : undefined
                                }}
                                className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all shrink-0 cursor-pointer ${
                                    isSelected
                                        ? 'text-slate-900 shadow-xs bg-white border-slate-300'
                                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: cHex }} />
                                {c.name}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Modern Light Bento Segmented Control Tabs */}
            <div className="px-4 py-2.5 border-b border-slate-200 shrink-0 bg-slate-50/80">
                <div className="flex p-1 bg-slate-200/80 rounded-2xl gap-1 border border-slate-200/70">
                    <button
                        onClick={() => setActiveTab('leaderboard')}
                        className={`flex-1 py-2 px-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            activeTab === 'leaderboard'
                                ? 'bg-white text-purple-700 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 font-bold'
                        }`}
                    >
                        <span>🏆</span>
                        <span>Leaderboard</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('myscore')}
                        className={`flex-1 py-2 px-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            activeTab === 'myscore'
                                ? 'bg-white text-purple-700 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 font-bold'
                        }`}
                    >
                        <span>📊</span>
                        <span>My Telemetry</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('badges')}
                        className={`flex-1 py-2 px-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            activeTab === 'badges'
                                ? 'bg-white text-purple-700 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 font-bold'
                        }`}
                    >
                        <span>🎖️</span>
                        <span>Awards</span>
                    </button>
                </div>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-slate-50/40">
                {/* ─── TAB 1: LEADERBOARD & PODIUM ─── */}
                {activeTab === 'leaderboard' && (
                    <div className="space-y-4">
                        {/* Weekly Awards Highlights: Light Bento Cards with High-Contrast Legible Labels */}
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                🌟 Weekly Award Winners
                            </p>
                            <div className="grid grid-cols-3 gap-2.5 items-stretch">
                                {leaderboard.featuredAwards.map(award => {
                                    const hasWinner = Boolean(award.winnerId && award.winnerName && award.winnerName !== '');
                                    return (
                                        <div
                                            key={award.id}
                                            className={`h-full bg-white rounded-xl border border-slate-200 p-3 flex flex-col items-center text-center justify-between relative shadow-sm border-l-[3px] transition-all hover:border-slate-300 hover:shadow-md ${
                                                !hasWinner ? 'opacity-75' : ''
                                            }`}
                                            style={{ borderLeftColor: hasWinner ? (award.accentHex || '#8b5cf6') : '#cbd5e1' }}
                                        >
                                            <div className="flex flex-col items-center w-full">
                                                <div
                                                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-1.5 shadow-xs shrink-0 ${
                                                        !hasWinner ? 'grayscale opacity-50' : ''
                                                    }`}
                                                    style={{ backgroundColor: hasWinner ? `${award.accentHex || '#8b5cf6'}15` : '#f1f5f9' }}
                                                >
                                                    {award.icon}
                                                </div>
                                                <p className="text-xs font-black uppercase tracking-wider text-slate-500 leading-tight break-words w-full">
                                                    {award.title}
                                                </p>
                                                <p className={`text-sm font-bold leading-tight break-words w-full mt-1 ${hasWinner ? 'text-slate-900' : 'text-slate-400'}`}>
                                                    {hasWinner ? award.winnerName : 'Unclaimed'}
                                                </p>
                                            </div>
                                            <span
                                                className="text-[10px] font-black mt-2 px-2 py-0.5 rounded-md break-words max-w-full leading-tight shadow-2xs"
                                                style={{
                                                    color: hasWinner ? (award.accentHex || '#8b5cf6') : '#94a3b8',
                                                    backgroundColor: hasWinner ? `${award.accentHex || '#8b5cf6'}12` : '#f1f5f9',
                                                    border: `1px solid ${hasWinner ? `${award.accentHex || '#8b5cf6'}30` : '#e2e8f0'}`
                                                }}
                                            >
                                                {hasWinner ? award.metricValue : 'No drives yet'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Top Group Summary Stats: Side-by-Side Light Bento Tiles */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm flex flex-col justify-between">
                                <div className="flex items-center justify-center gap-1.5 text-slate-500 mb-1">
                                    <Car className="w-4 h-4 text-slate-600" />
                                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                                        Circle Miles Driven
                                    </p>
                                </div>
                                <p className="text-2xl font-black text-slate-900 tracking-tight">
                                    {leaderboard.totalGroupMiles} <span className="text-sm font-bold text-slate-500">mi</span>
                                </p>
                                <p className="text-[10px] font-bold text-slate-500 mt-1">
                                    This Week's Distance
                                </p>
                            </div>
                            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm flex flex-col justify-between">
                                <div className="flex items-center justify-center gap-1.5 text-slate-500 mb-1">
                                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                                        Group Safety Score
                                    </p>
                                </div>
                                <p className={`text-2xl font-black tracking-tight ${getScoreColor(leaderboard.avgGroupScore)}`}>
                                    {leaderboard.avgGroupScore}<span className="text-sm font-bold opacity-75">%</span>
                                </p>
                                <p className="text-[10px] font-bold text-emerald-600 mt-1">
                                    {leaderboard.avgGroupScore >= 90 ? 'Excellent Group Rating' : leaderboard.avgGroupScore >= 75 ? 'Good Group Rating' : 'Needs Group Focus'}
                                </p>
                            </div>
                        </div>

                        {/* Family Safety Rankings: MemberCard Light Bento Style */}
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                🏅 Family Safety Rankings
                            </p>

                            <div className="space-y-2">
                                {leaderboard.members.map((member, idx) => {
                                    const isSelf = member.memberId === currentUserId || member.memberId === 'current_user' || member.memberId === 'demo-you';
                                    const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;

                                    return (
                                        <div
                                            key={member.memberId}
                                            className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 shadow-xs ${
                                                isSelf
                                                    ? 'bg-purple-50/60 border-purple-300 ring-1 ring-purple-400/30'
                                                    : 'bg-white border-slate-200/90 hover:bg-slate-50 hover:border-slate-300'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-black text-xs text-slate-800 shrink-0">
                                                    {rankBadge}
                                                </div>

                                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-900 text-xs shrink-0 shadow-xs overflow-hidden border-2 border-white ring-1 ring-slate-200">
                                                    {member.avatar ? (
                                                        <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        member.name.charAt(0).toUpperCase()
                                                    )}
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <h4 className="text-sm font-black text-slate-900 truncate">
                                                            {member.name}
                                                        </h4>
                                                        {isSelf && (
                                                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-600 text-white shrink-0 shadow-xs">
                                                                YOU
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                                        {member.totalTrips > 0 ? (
                                                            <>
                                                                <span className="font-bold text-slate-900">{member.totalMiles} mi</span>
                                                                <span className="text-slate-300">•</span>
                                                                <span className="font-medium text-slate-600">{member.totalTrips} {member.totalTrips === 1 ? 'trip' : 'trips'}</span>
                                                                {member.hardBrakes === 0 && (
                                                                    <>
                                                                        <span className="text-slate-300">•</span>
                                                                        <span className="text-emerald-600 font-bold">0 Brakes</span>
                                                                    </>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="font-medium text-slate-400">No drives this week</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Safety Score Pill */}
                                            <div className="text-right shrink-0">
                                                {member.totalTrips > 0 ? (
                                                    <div className={`px-2.5 py-1 rounded-xl border text-xs font-black shadow-xs ${getScoreBg(member.safetyScore)}`}>
                                                        {member.safetyScore}%
                                                    </div>
                                                ) : (
                                                    <div className="px-2.5 py-1 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-xs font-bold shadow-xs">
                                                        —
                                                    </div>
                                                )}
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
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center relative overflow-hidden shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                                Your Driving Safety Rating
                            </p>
                            <div className="flex items-center justify-center gap-1 my-2">
                                <span className={`text-6xl font-black ${hasDrives ? getScoreColor(selfStats.safetyScore) : 'text-slate-300'}`}>
                                    {hasDrives ? selfStats.safetyScore : '—'}
                                </span>
                                {hasDrives && <span className="text-2xl font-bold text-slate-400 mt-4">%</span>}
                            </div>
                            <p className="text-xs font-bold text-slate-700">
                                {!hasDrives
                                    ? 'Awaiting your first drive.'
                                    : selfStats.safetyScore >= 95
                                    ? '🏆 Elite Driver — Smooth and predictive braking'
                                    : selfStats.safetyScore >= 85
                                    ? '⭐ Safe Driver — Solid speed consistency'
                                    : '⚠️ Needs Attention — Moderate hard braking events'}
                            </p>
                        </div>

                        {/* Telemetry Breakdown Grid */}
                        <div className="grid grid-cols-3 gap-2.5">
                            <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                                <p className={`text-xl font-black ${!hasDrives ? 'text-slate-300' : selfStats.hardBrakes === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {hasDrives ? selfStats.hardBrakes : '—'}
                                </p>
                                <p className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">🛑 Hard Brakes</p>
                            </div>
                            <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                                <p className={`text-xl font-black ${!hasDrives ? 'text-slate-300' : selfStats.rapidAccels <= 1 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {hasDrives ? selfStats.rapidAccels : '—'}
                                </p>
                                <p className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">🏎️ Rapid Accels</p>
                            </div>
                            <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                                <p className={`text-xl font-black ${!hasDrives ? 'text-slate-300' : selfStats.speedingEvents === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {hasDrives ? selfStats.speedingEvents : '—'}
                                </p>
                                <p className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">⚡ Speeding</p>
                            </div>
                        </div>

                        {/* Eco Efficiency & Gas Savings */}
                        <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">🔋</span>
                                    <h4 className="text-xs font-black text-emerald-800 uppercase tracking-wider">
                                        Eco & Fuel Efficiency
                                    </h4>
                                </div>
                                {hasDrives && (
                                    <span className="text-xs font-black text-emerald-700">
                                        {selfStats.ecoScore}% Score
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-700 leading-relaxed">
                                {hasDrives
                                    ? `Your smooth throttle management helped conserve an estimated ~${estimatedFuelSaved} gallons of fuel and $${estimatedCostSaved} in energy costs across your recent ${selfStats.totalMiles} miles.`
                                    : "No driving data yet. Complete a trip to see your estimated fuel savings."}
                            </p>
                        </div>

                        {/* AI Driving Coach Insight */}
                        <div className="bg-indigo-50/80 border border-indigo-200 rounded-xl p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">🤖</span>
                                <h4 className="text-xs font-black text-indigo-800 uppercase tracking-wider">
                                    AI Co-Pilot Coach
                                </h4>
                            </div>
                            <p className="text-[11px] text-slate-700 leading-relaxed">
                                {aiCoachTip}
                            </p>
                        </div>
                    </div>
                )}

                {/* ─── TAB 3: AWARDS & BADGES SHOWCASE ─── */}
                {activeTab === 'badges' && (
                    <div className="space-y-3">
                        {/* Empty State Bento tile if user has zero recorded drives or no badges */}
                        {!hasDrives && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 text-center shadow-sm">
                                <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center text-2xl mx-auto mb-2.5 shadow-2xs">
                                    🎯
                                </div>
                                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                                    No Awards Yet
                                </h4>
                                <p className="text-xs text-slate-600 mt-1 font-medium max-w-xs mx-auto leading-relaxed">
                                    No awards yet! Hit the road to start earning driving badges for safety and efficiency.
                                </p>
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                🎖️ Circle Achievement Badges
                            </p>
                            {hasDrives && selfStats && selfStats.badges.length > 0 && (
                                <span className="text-[10px] font-black text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                                    {selfStats.badges.length} Unlocked
                                </span>
                            )}
                        </div>

                        <div className="space-y-2.5">
                            {Object.values(SAFETY_BADGE_DEFINITIONS).map(badge => {
                                const awardInfo = leaderboard.featuredAwards.find(a => a.id === badge.id);
                                const hasHolder = Boolean(awardInfo?.winnerId && awardInfo?.winnerName && awardInfo.winnerName !== '');
                                const isWonBySelf = Boolean(hasDrives && selfStats?.badges.some(b => b.id === badge.id));

                                return (
                                    <div
                                        key={badge.id}
                                        className={`rounded-xl border p-3.5 flex items-start gap-3 relative overflow-hidden transition-all ${
                                            isWonBySelf
                                                ? 'bg-white border-slate-200 border-l-[3px] shadow-sm'
                                                : 'bg-slate-50/80 border-slate-200 border-l-[3px] opacity-75'
                                        }`}
                                        style={{ borderLeftColor: isWonBySelf ? (badge.accentHex || '#8b5cf6') : '#cbd5e1' }}
                                    >
                                        <div
                                            style={{
                                                backgroundColor: isWonBySelf ? `${badge.accentHex || '#8b5cf6'}15` : '#f1f5f9'
                                            }}
                                            className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 shadow-xs ${
                                                !isWonBySelf ? 'grayscale opacity-50' : ''
                                            }`}
                                        >
                                            {badge.icon}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-1">
                                                <h4 className={`text-xs font-black truncate ${isWonBySelf ? 'text-slate-900' : 'text-slate-600'}`}>
                                                    {badge.title}
                                                </h4>
                                                {isWonBySelf ? (
                                                    <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 font-bold">
                                                        UNLOCKED 🌟
                                                    </span>
                                                ) : (
                                                    <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 shrink-0 font-bold">
                                                        LOCKED 🔒
                                                    </span>
                                                )}
                                            </div>

                                            <p className={`text-[11px] font-bold mt-0.5 ${isWonBySelf ? 'text-slate-700' : 'text-slate-500'}`}>
                                                {badge.tagline}
                                            </p>
                                            <p className={`text-[11px] leading-relaxed mt-1 ${isWonBySelf ? 'text-slate-600' : 'text-slate-400'}`}>
                                                {badge.description}
                                            </p>

                                            {hasHolder && (
                                                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] font-semibold text-slate-500">
                                                    <span>Current Holder: <strong className="text-slate-900 font-bold">{awardInfo.winnerName}</strong></span>
                                                    <span style={{ color: badge.accentHex || '#8b5cf6' }} className="font-bold">{awardInfo.metricValue}</span>
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
