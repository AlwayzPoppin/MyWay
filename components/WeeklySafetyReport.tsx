import React, { useState, useEffect } from 'react';
import { Trip } from '../types';
import { getSavedTrips, formatDuration } from '../services/tripHistoryService';

interface WeeklySafetyReportProps {
    onClose: () => void;
    onBack?: () => void;
    memberName?: string;
    theme: 'light' | 'dark';
}

interface WeekStats {
    totalTrips: number;
    totalMiles: number;
    totalDriveMinutes: number;
    avgSafetyScore: number;
    totalEvents: { hard_brake: number; rapid_accel: number; speeding: number };
    bestTrip: Trip | null;
    worstTrip: Trip | null;
    trend: 'improving' | 'stable' | 'declining';
}

const calculateWeekStats = (): WeekStats => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const allTrips = getSavedTrips();
    const thisWeek = allTrips.filter(t => t.startTime >= weekAgo);
    const lastWeek = allTrips.filter(t => t.startTime >= twoWeeksAgo && t.startTime < weekAgo);

    const totalMiles = Math.round(thisWeek.reduce((sum, t) => sum + t.totalDistanceMiles, 0) * 10) / 10;
    const totalDriveMs = thisWeek.reduce((sum, t) => sum + ((t.endTime || t.startTime) - t.startTime), 0);
    const avgScore = thisWeek.length > 0
        ? Math.round(thisWeek.reduce((sum, t) => sum + t.safetyScore, 0) / thisWeek.length)
        : 100;

    const lastWeekAvg = lastWeek.length > 0
        ? Math.round(lastWeek.reduce((sum, t) => sum + t.safetyScore, 0) / lastWeek.length)
        : 100;

    const events = { hard_brake: 0, rapid_accel: 0, speeding: 0 };
    thisWeek.forEach(t => {
        t.driveEvents.forEach(e => {
            if (e.type in events) events[e.type as keyof typeof events]++;
        });
    });

    const sorted = [...thisWeek].sort((a, b) => b.safetyScore - a.safetyScore);

    return {
        totalTrips: thisWeek.length,
        totalMiles,
        totalDriveMinutes: Math.floor(totalDriveMs / 60000),
        avgSafetyScore: avgScore,
        totalEvents: events,
        bestTrip: sorted[0] || null,
        worstTrip: sorted[sorted.length - 1] || null,
        trend: avgScore > lastWeekAvg + 5 ? 'improving' : avgScore < lastWeekAvg - 5 ? 'declining' : 'stable'
    };
};

const WeeklySafetyReport: React.FC<WeeklySafetyReportProps> = ({ onClose, onBack, memberName = 'You', theme }) => {
    const [stats, setStats] = useState<WeekStats | null>(null);
    const isDark = theme === 'dark';

    useEffect(() => {
        setStats(calculateWeekStats());
    }, []);

    if (!stats) return null;

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'text-emerald-400';
        if (score >= 70) return 'text-amber-400';
        return 'text-red-400';
    };

    const getTrendEmoji = (trend: string) => {
        switch (trend) {
            case 'improving': return '📈';
            case 'declining': return '📉';
            default: return '➡️';
        }
    };

    return (
        <div className="h-full flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all"
                            title="Back to Settings"
                        >
                            <span className="text-lg">←</span>
                        </button>
                    )}
                    <div>
                        <h2 className="text-lg font-black text-white">📊 My Logs — Weekly Report</h2>
                        <p className="text-indigo-200 text-xs mt-0.5">{memberName}'s driving summary</p>
                    </div>
                </div>
                <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {stats.totalTrips === 0 ? (
                    <div className="text-center py-12">
                        <span className="text-4xl block mb-3">🚗</span>
                        <p className="text-slate-400">No trips this week</p>
                        <p className="text-slate-500 text-xs mt-1">Start driving to generate your safety report</p>
                    </div>
                ) : (
                    <>
                        {/* Safety Score Hero */}
                        <div className={`text-center p-6 rounded-2xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                            <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2">My Safety Score</p>
                            <span className={`text-6xl font-black ${getScoreColor(stats.avgSafetyScore)}`}>
                                {stats.avgSafetyScore}
                            </span>
                            <p className="text-slate-400 text-sm mt-2">
                                {getTrendEmoji(stats.trend)} {stats.trend === 'improving' ? 'Up from last week!' : stats.trend === 'declining' ? 'Down from last week' : 'Consistent with last week'}
                            </p>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className={`p-3 rounded-2xl border text-center ${isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100'}`}>
                                <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{stats.totalTrips}</p>
                                <p className="text-xs text-slate-400">Trips</p>
                            </div>
                            <div className={`p-3 rounded-2xl border text-center ${isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100'}`}>
                                <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{stats.totalMiles}</p>
                                <p className="text-xs text-slate-400">Miles</p>
                            </div>
                            <div className={`p-3 rounded-2xl border text-center ${isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100'}`}>
                                <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{stats.totalDriveMinutes}m</p>
                                <p className="text-xs text-slate-400">Drive Time</p>
                            </div>
                        </div>

                        {/* Drive Events Breakdown */}
                        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100'}`}>
                            <h3 className={`text-sm font-bold mb-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>Drive Events</h3>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-400">🛑 Hard Brakes</span>
                                    <span className={`font-bold ${stats.totalEvents.hard_brake > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {stats.totalEvents.hard_brake}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-400">🏎️ Rapid Acceleration</span>
                                    <span className={`font-bold ${stats.totalEvents.rapid_accel > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {stats.totalEvents.rapid_accel}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-400">⚡ Speeding Events</span>
                                    <span className={`font-bold ${stats.totalEvents.speeding > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {stats.totalEvents.speeding}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* AI Summary Placeholder */}
                        <div className={`p-4 rounded-2xl border bg-gradient-to-br ${isDark ? 'from-indigo-500/10 to-purple-500/10 border-indigo-500/20' : 'from-indigo-50 to-purple-50 border-indigo-200'}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm">🤖</span>
                                <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>AI Safety Insight</h3>
                            </div>
                            <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                                {stats.avgSafetyScore >= 90
                                    ? `Excellent driving this week! ${stats.totalTrips} trips with an average safety score of ${stats.avgSafetyScore}. Keep it up! 🌟`
                                    : stats.avgSafetyScore >= 70
                                        ? `Good week overall. Watch for ${stats.totalEvents.hard_brake > stats.totalEvents.speeding ? 'hard braking' : 'speeding'} events — ${stats.totalEvents.hard_brake + stats.totalEvents.speeding} detected this week.`
                                        : `Safety needs attention. ${stats.totalEvents.hard_brake + stats.totalEvents.rapid_accel + stats.totalEvents.speeding} drive events detected. Consider more defensive driving techniques.`
                                }
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default WeeklySafetyReport;
