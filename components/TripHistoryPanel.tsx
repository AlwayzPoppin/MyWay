import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Trip, TripPoint } from '../types';
import { getSavedTrips, deleteTrip, clearTripHistory, formatDuration } from '../services/tripHistoryService';
import { vehicleFuelService, RollingFuelReport } from '../services/vehicleFuelService';

interface TripHistoryPanelProps {
    onClose: () => void;
    onBack?: () => void;
    onReplayTrip?: (trip: Trip) => void;
}

const TripHistoryPanel: React.FC<TripHistoryPanelProps> = ({ onClose, onBack, onReplayTrip }) => {
    const [trips, setTrips] = useState<Trip[]>([]);
    const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
    const [activeTab, setActiveTab] = useState<'trips' | 'fuel_analytics'>('trips');
    const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'thisWeek' | 'thisMonth' | 'thisYear'>('thisWeek');
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayIndex, setReplayIndex] = useState(0);
    const replayTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setTrips(getSavedTrips());
    }, []);

    const fuelReport = useMemo(() => {
        return vehicleFuelService.getRollingFuelReport(trips);
    }, [trips]);

    const handleDelete = useCallback((tripId: string) => {
        deleteTrip(tripId);
        setTrips(getSavedTrips());
        if (selectedTrip?.id === tripId) setSelectedTrip(null);
    }, [selectedTrip]);

    const handleClearAll = useCallback(() => {
        if (confirm('Delete all trip history?')) {
            clearTripHistory();
            setTrips([]);
            setSelectedTrip(null);
        }
    }, []);

    const startReplay = useCallback((trip: Trip) => {
        setIsReplaying(true);
        setReplayIndex(0);
        onReplayTrip?.(trip);

        // Animate through path points
        let idx = 0;
        replayTimerRef.current = setInterval(() => {
            idx++;
            if (idx >= trip.path.length) {
                clearInterval(replayTimerRef.current!);
                setIsReplaying(false);
                return;
            }
            setReplayIndex(idx);
        }, 100); // ~10x speed
    }, [onReplayTrip]);

    const stopReplay = useCallback(() => {
        if (replayTimerRef.current) clearInterval(replayTimerRef.current);
        setIsReplaying(false);
        setReplayIndex(0);
    }, []);

    useEffect(() => {
        return () => {
            if (replayTimerRef.current) clearInterval(replayTimerRef.current);
        };
    }, []);

    const getScoreColor = (score: number): string => {
        if (score >= 90) return 'text-emerald-400';
        if (score >= 70) return 'text-amber-400';
        return 'text-red-400';
    };

    const getScoreGrade = (score: number): string => {
        if (score >= 95) return 'A+';
        if (score >= 90) return 'A';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
    };

    const getEventIcon = (type: string): string => {
        switch (type) {
            case 'hard_brake': return '🛑';
            case 'rapid_accel': return '🏎️';
            case 'speeding': return '⚡';
            default: return '⚠️';
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-8 h-8 rounded-full bg-white/5 hover:bg-indigo-500/20 hover:text-indigo-400 flex items-center justify-center transition-all mr-1"
                            title="Back to Settings"
                        >
                            <span className="text-lg">←</span>
                        </button>
                    )}
                    <span className="text-2xl">🛣️</span>
                    <div>
                        <h2 className="text-lg font-bold text-white">My Trips</h2>
                        <p className="text-xs text-slate-400">{trips.length} trips recorded</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {trips.length > 0 && (
                        <button
                            onClick={handleClearAll}
                            className="text-xs text-red-400/60 hover:text-red-400 transition-colors px-2 py-1 rounded"
                        >
                            Clear All
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 transition-all"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* View Tabs */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-white/10 shrink-0">
                <button
                    type="button"
                    onClick={() => setActiveTab('trips')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                        activeTab === 'trips'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    <span>🛣️</span>
                    <span>Trips ({trips.length})</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('fuel_analytics')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                        activeTab === 'fuel_analytics'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    <span>⛽</span>
                    <span>Fuel & Savings</span>
                </button>
            </div>

            {/* Trip List or Trip Detail or Fuel Analytics */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'fuel_analytics' ? (
                    /* Fuel & Savings Analytics Dashboard */
                    <div className="p-4 space-y-4">
                        {/* Active Vehicle & Gas Price Banner */}
                        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-teal-950/40 to-slate-900/40 border border-emerald-500/30">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <span className="text-2xl">
                                        {fuelReport.activeVehicle.fuelType === 'electric' ? '⚡' : fuelReport.activeVehicle.fuelType === 'hybrid' ? '🌿' : '🚗'}
                                    </span>
                                    <div>
                                        <h3 className="text-sm font-black text-white">
                                            {fuelReport.activeVehicle.name}
                                        </h3>
                                        <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                                            {fuelReport.activeVehicle.mpg} {fuelReport.activeVehicle.fuelType === 'electric' ? 'MPGe' : 'MPG'} • ${fuelReport.gasPricePerGallon.toFixed(2)}/gal
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300">
                                    Active Car
                                </span>
                            </div>
                        </div>

                        {/* Period Selector Tabs */}
                        <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-xl border border-white/5">
                            {[
                                { id: 'today', label: 'Today' },
                                { id: 'thisWeek', label: 'This Week' },
                                { id: 'thisMonth', label: 'This Month' },
                                { id: 'thisYear', label: 'Yearly' }
                            ].map(period => (
                                <button
                                    key={period.id}
                                    type="button"
                                    onClick={() => setSelectedPeriod(period.id as any)}
                                    className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all text-center ${
                                        selectedPeriod === period.id
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {period.label}
                                </button>
                            ))}
                        </div>

                        {/* 4 Metric Cards */}
                        {(() => {
                            const summary = fuelReport[selectedPeriod];
                            return (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                                            <div className="flex items-center justify-between text-slate-400 mb-1">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">Gas Spent</span>
                                                <span>⛽</span>
                                            </div>
                                            <p className="text-xl font-black text-white">${summary.totalCost.toFixed(2)}</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">{summary.tripCount} trips recorded</p>
                                        </div>

                                        <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                                            <div className="flex items-center justify-between text-slate-400 mb-1">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">Fuel Burned</span>
                                                <span>🛢️</span>
                                            </div>
                                            <p className="text-xl font-black text-amber-400">{summary.totalGallons} gal</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Avg {summary.avgMpg} MPG</p>
                                        </div>

                                        <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                                            <div className="flex items-center justify-between text-slate-400 mb-1">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">Money Saved</span>
                                                <span>🌿</span>
                                            </div>
                                            <p className="text-xl font-black text-emerald-400">${summary.totalMoneySaved.toFixed(2)}</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Eco & Toll routing</p>
                                        </div>

                                        <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                                            <div className="flex items-center justify-between text-slate-400 mb-1">
                                                <span className="text-[10px] font-bold uppercase tracking-wider">Distance</span>
                                                <span>🚗</span>
                                            </div>
                                            <p className="text-xl font-black text-indigo-300">{summary.totalDistanceMiles} mi</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Driven in period</p>
                                        </div>
                                    </div>

                                    {/* Annual Projection Banner */}
                                    <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-indigo-300">Annual Gas Forecast</span>
                                            <span className="text-xs font-black text-white">~${fuelReport.projectedAnnualCost.toFixed(2)}/yr</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                                            <span>Est. MyWay Routing Savings</span>
                                            <span className="font-bold text-emerald-400">~${(fuelReport.projectedAnnualCost * 0.12).toFixed(2)}/yr</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                ) : selectedTrip ? (
                    /* Trip Detail View */
                    <div className="p-4 space-y-4">
                        <button
                            onClick={() => { setSelectedTrip(null); stopReplay(); }}
                            className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                            ← Back to trips
                        </button>

                        {/* Trip Summary Card */}
                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-white font-semibold">
                                        {selectedTrip.destinationName || 'Free Drive'}
                                    </h3>
                                    <p className="text-xs text-slate-400">
                                        {new Date(selectedTrip.startTime).toLocaleDateString('en-US', {
                                            weekday: 'short', month: 'short', day: 'numeric'
                                        })}
                                        {' · '}
                                        {new Date(selectedTrip.startTime).toLocaleTimeString('en-US', {
                                            hour: 'numeric', minute: '2-digit'
                                        })}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <span className={`text-3xl font-black ${getScoreColor(selectedTrip.safetyScore)}`}>
                                        {getScoreGrade(selectedTrip.safetyScore)}
                                    </span>
                                    <p className="text-xs text-slate-500">Safety</p>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-4 gap-2 mt-3">
                                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                                    <p className="text-base font-bold text-white">{selectedTrip.totalDistanceMiles}</p>
                                    <p className="text-[10px] text-slate-400">miles</p>
                                </div>
                                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                                    <p className="text-base font-bold text-white">
                                        {selectedTrip.endTime
                                            ? formatDuration(selectedTrip.startTime, selectedTrip.endTime)
                                            : '—'
                                        }
                                    </p>
                                    <p className="text-[10px] text-slate-400">duration</p>
                                </div>
                                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                                    <p className="text-base font-bold text-emerald-400">
                                        ${(selectedTrip.fuelCost || (selectedTrip.totalDistanceMiles / (fuelReport.activeVehicle.mpg || 28) * fuelReport.gasPricePerGallon)).toFixed(2)}
                                    </p>
                                    <p className="text-[10px] text-slate-400">gas cost</p>
                                </div>
                                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                                    <p className="text-base font-bold text-teal-400">
                                        ${(selectedTrip.moneySaved || (selectedTrip.totalDistanceMiles / (fuelReport.activeVehicle.mpg || 28) * fuelReport.gasPricePerGallon * 0.12)).toFixed(2)}
                                    </p>
                                    <p className="text-[10px] text-slate-400">saved</p>
                                </div>
                            </div>
                        </div>

                        {/* Replay Controls */}
                        <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-2xl p-4 border border-indigo-500/30">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-white font-semibold text-sm">Trip Replay</p>
                                    <p className="text-xs text-slate-400">
                                        {isReplaying
                                            ? `Point ${replayIndex + 1} of ${selectedTrip.path.length}`
                                            : `${selectedTrip.path.length} GPS points recorded`
                                        }
                                    </p>
                                </div>
                                <button
                                    onClick={() => isReplaying ? stopReplay() : startReplay(selectedTrip)}
                                    className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all ${
                                        isReplaying
                                            ? 'bg-red-500/80 hover:bg-red-500 text-white'
                                            : 'bg-indigo-500 hover:bg-indigo-400 text-white'
                                    }`}
                                >
                                    {isReplaying ? '⏹ Stop' : '▶ Replay'}
                                </button>
                            </div>
                            {isReplaying && (
                                <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-100"
                                        style={{ width: `${(replayIndex / selectedTrip.path.length) * 100}%` }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Drive Events */}
                        {selectedTrip.driveEvents.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold text-slate-300 mb-2">Drive Events</h4>
                                <div className="space-y-2">
                                    {selectedTrip.driveEvents.map((event, i) => (
                                        <div key={i} className="flex items-center gap-3 bg-white/5 rounded-xl p-3">
                                            <span className="text-lg">{getEventIcon(event.type)}</span>
                                            <div className="flex-1">
                                                <p className="text-sm text-white capitalize">
                                                    {event.type.replace('_', ' ')}
                                                </p>
                                                <p className="text-xs text-slate-400">
                                                    {new Date(event.timestamp).toLocaleTimeString('en-US', {
                                                        hour: 'numeric', minute: '2-digit', second: '2-digit'
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Trip List View */
                    <div className="p-4 space-y-3">
                        {trips.length === 0 ? (
                            <div className="text-center py-12">
                                <span className="text-4xl block mb-3">🗺️</span>
                                <p className="text-slate-400 text-sm">No trips recorded yet</p>
                                <p className="text-slate-500 text-xs mt-1">Start navigating to record your first trip</p>
                            </div>
                        ) : (
                            trips.map(trip => {
                                const tripCost = trip.fuelCost !== undefined
                                    ? trip.fuelCost
                                    : (trip.totalDistanceMiles / (fuelReport.activeVehicle.mpg || 28) * fuelReport.gasPricePerGallon);
                                const tripSaved = trip.moneySaved !== undefined
                                    ? trip.moneySaved
                                    : (tripCost * 0.12);

                                return (
                                    <button
                                        key={trip.id}
                                        onClick={() => setSelectedTrip(trip)}
                                        className="w-full text-left bg-white/5 hover:bg-white/8 rounded-2xl p-4 border border-white/8 hover:border-white/15 transition-all group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-white font-medium text-sm truncate">
                                                        {trip.destinationName || 'Free Drive'}
                                                    </h3>
                                                    <span className={`text-xs font-bold ${getScoreColor(trip.safetyScore)}`}>
                                                        {getScoreGrade(trip.safetyScore)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                                                    <span>
                                                        {new Date(trip.startTime).toLocaleDateString('en-US', {
                                                            month: 'short', day: 'numeric'
                                                        })}
                                                    </span>
                                                    <span>•</span>
                                                    <span>{trip.totalDistanceMiles} mi</span>
                                                    <span>•</span>
                                                    <span className="text-emerald-400 font-bold">⛽ ${tripCost.toFixed(2)}</span>
                                                    <span className="text-teal-400 text-[10px] font-bold">🌿 ${tripSaved.toFixed(2)} saved</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {trip.driveEvents.length > 0 && (
                                                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                                                        {trip.driveEvents.length} events
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(trip.id); }}
                                                    className="opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400 text-xs transition-all"
                                                    title="Delete trip"
                                                >
                                                    🗑️
                                                </button>
                                                <span className="text-slate-500 group-hover:text-slate-300 transition-colors">→</span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TripHistoryPanel;
