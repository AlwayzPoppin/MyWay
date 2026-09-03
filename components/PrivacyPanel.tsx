import React, { useState, useMemo } from 'react';
import { PrivacyZone } from '../types';
import { FamilyCircle, getCircleColor } from '../services/authService';
import {
    PRIVACY_LEVELS,
    CirclePrivacyMode,
    getCirclePrivacyMode,
    setCirclePrivacyMode
} from '../services/privacyService';

interface PrivacyPanelProps {
    zones?: PrivacyZone[];
    isGhostMode?: boolean;
    onToggleGhost?: () => void;
    userCircles?: FamilyCircle[];
    activeCircleId?: string;
    onClose: () => void;
    theme: 'light' | 'dark';
}

const PrivacyPanel: React.FC<PrivacyPanelProps> = ({
    zones = [],
    isGhostMode = false,
    onToggleGhost,
    userCircles = [],
    activeCircleId,
    onClose,
    theme
}) => {
    const isDark = theme === 'dark';
    const panelBg = isDark ? 'bg-slate-900/98 border-white/10' : 'bg-white/98 border-slate-200';
    const subBg = isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';
    const textColor = isDark ? 'text-white' : 'text-slate-900';

    // Active circle tab for configuring privacy
    const [selectedCircleId, setSelectedCircleId] = useState<string>(() => {
        if (activeCircleId && activeCircleId !== 'all') return activeCircleId;
        if (userCircles.length > 0) return userCircles[0].id;
        return 'default';
    });

    // Track privacy modes per circle in local state for instant reactive UI updates
    const [privacyMap, setPrivacyMap] = useState<Record<string, CirclePrivacyMode>>(() => {
        const map: Record<string, CirclePrivacyMode> = {};
        if (userCircles.length > 0) {
            userCircles.forEach(c => {
                map[c.id] = getCirclePrivacyMode(c.id);
            });
        } else {
            map['default'] = getCirclePrivacyMode('default');
        }
        return map;
    });

    const activeCircle = useMemo(() => {
        return userCircles.find(c => c.id === selectedCircleId) || userCircles[0] || null;
    }, [selectedCircleId, userCircles]);

    const activePrivacyMode = privacyMap[selectedCircleId] || getCirclePrivacyMode(selectedCircleId);

    const handleSelectPrivacyMode = (mode: CirclePrivacyMode) => {
        setCirclePrivacyMode(selectedCircleId, mode);
        setPrivacyMap(prev => ({
            ...prev,
            [selectedCircleId]: mode
        }));
    };

    return (
        <div className={`backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border overflow-hidden animate-in slide-in-from-left duration-300 ${panelBg}`}>
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 p-5 text-white flex justify-between items-center shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-xl shadow-inner">
                        🛡️
                    </div>
                    <div>
                        <h3 className="font-black text-base leading-none">Granular Privacy & Visibility</h3>
                        <p className="text-[10px] opacity-80 mt-1 uppercase tracking-widest font-black">
                            Customize location sharing per circle
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all cursor-pointer"
                >
                    ✕
                </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto no-scrollbar">
                {/* ─── CIRCLE SWITCHER TABS ─── */}
                {userCircles.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                                👥 Choose Circle to Configure
                            </p>
                            <span className="text-[9px] text-slate-500 font-bold">
                                {userCircles.length} {userCircles.length === 1 ? 'Group' : 'Groups'}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                            {userCircles.map(c => {
                                const cHex = c.color || getCircleColor(c.id).hex;
                                const isSelected = selectedCircleId === c.id;
                                const cMode = privacyMap[c.id] || getCirclePrivacyMode(c.id);
                                const modeInfo = PRIVACY_LEVELS.find(l => l.id === cMode);

                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => setSelectedCircleId(c.id)}
                                        style={{
                                            borderColor: isSelected ? cHex : undefined,
                                            backgroundColor: isSelected ? `${cHex}22` : undefined
                                        }}
                                        className={`px-3 py-2 rounded-2xl border text-left transition-all shrink-0 cursor-pointer ${
                                            isSelected
                                                ? 'ring-2 shadow-md'
                                                : isDark
                                                ? 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
                                                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cHex }} />
                                            <span className={`text-xs font-black truncate max-w-[90px] ${isSelected ? textColor : ''}`}>
                                                {c.name}
                                            </span>
                                        </div>
                                        <div className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                                            <span>{modeInfo?.icon}</span>
                                            <span>{modeInfo?.title.split(' ')[0]}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ─── GRANULAR PRIVACY SELECTOR CARDS ─── */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                            🔒 Location Precision in "{activeCircle?.name || 'Circle'}"
                        </p>
                    </div>

                    <div className="space-y-2.5">
                        {PRIVACY_LEVELS.map(level => {
                            const isSelected = activePrivacyMode === level.id;

                            return (
                                <div
                                    key={level.id}
                                    onClick={() => handleSelectPrivacyMode(level.id)}
                                    style={{
                                        borderColor: isSelected ? level.accentHex : undefined,
                                        backgroundColor: isSelected ? `${level.accentHex}15` : undefined
                                    }}
                                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                                        isSelected
                                            ? 'ring-2 shadow-md'
                                            : isDark
                                            ? 'bg-white/5 border-white/5 hover:border-white/20'
                                            : 'bg-white border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <div
                                                style={{ backgroundColor: `${level.accentHex}25` }}
                                                className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0 mt-0.5"
                                            >
                                                {level.icon}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h4 className={`font-black text-sm ${textColor}`}>
                                                        {level.title}
                                                    </h4>
                                                    {isSelected && (
                                                        <span
                                                            style={{
                                                                backgroundColor: `${level.accentHex}30`,
                                                                color: level.accentHex
                                                            }}
                                                            className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full border border-current"
                                                        >
                                                            ACTIVE
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                                                    {level.tagline}
                                                </p>
                                                <p className="text-[10px] text-slate-500 leading-relaxed mt-1">
                                                    {level.description}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Radio Indicator */}
                                        <div
                                            style={{
                                                borderColor: isSelected ? level.accentHex : '#64748b',
                                                backgroundColor: isSelected ? level.accentHex : 'transparent'
                                            }}
                                            className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1"
                                        >
                                            {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ─── LIVE SIMULATION PREVIEW CARD ─── */}
                <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-950/60 border-white/5' : 'bg-slate-100/70 border-slate-200'}`}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                        <span>👁️</span>
                        <span>What Members in {activeCircle?.name || 'this circle'} See:</span>
                    </p>

                    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-black/20 border border-white/5">
                        <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
                                You
                            </div>
                            {activePrivacyMode === 'blurred' && (
                                <span className="absolute -inset-1 rounded-full border border-indigo-400/50 bg-indigo-500/20 animate-pulse" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-black truncate text-white">
                                {activePrivacyMode === 'exact' && '📍 Exact Location • 45 MPH Live Speed'}
                                {activePrivacyMode === 'blurred' && '🛡️ In Neighborhood Bubble (~1.5 mi Area)'}
                                {activePrivacyMode === 'status_only' && '🏷️ At Home (No Live GPS Coordinates)'}
                                {activePrivacyMode === 'frozen' && '❄️ Location Paused (Ghost Mode)'}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                {activePrivacyMode === 'exact' && 'Full street address and live telemetry shared.'}
                                {activePrivacyMode === 'blurred' && 'Precise street address and speed hidden.'}
                                {activePrivacyMode === 'status_only' && 'Map pin removed; only shows milestone status.'}
                                {activePrivacyMode === 'frozen' && 'No location data broadcast to this group.'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Explainer Footer */}
                <div className={`p-3.5 rounded-2xl border ${isDark ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`}>
                    <p className="text-[10px] font-bold text-indigo-400 mb-1 flex items-center gap-1">
                        <span>💡</span>
                        <span>Independent Circle Privacy</span>
                    </p>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                        You can be <strong>Exact Live GPS</strong> with your immediate family in one circle, while staying <strong>Blurred</strong> or <strong>Status Only</strong> in work, carpool, or social circles.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPanel;
