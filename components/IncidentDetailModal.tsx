import React from 'react';
import { IncidentReport } from '../types';
import { incidentService } from '../services/incidentService';
import { hapticTick, hapticMilestone, hapticSuccess } from '../utils/haptics';

interface IncidentDetailModalProps {
    incident: IncidentReport | null;
    onClose: () => void;
    currentUserId?: string;
    currentUserName?: string;
    showNotification?: (msg: string, duration?: number) => void;
    theme?: 'light' | 'dark';
}

const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({
    incident,
    onClose,
    currentUserId,
    showNotification,
    theme = 'dark'
}) => {
    if (!incident) return null;

    const isDark = theme === 'dark';
    const panelBg = isDark ? 'bg-slate-900/98 border-white/10 text-white' : 'bg-white/98 border-slate-200 text-slate-900';
    const subBg = isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';

    const getIncidentMeta = (type: string) => {
        switch (type) {
            case 'police':
                return { icon: '🚔', title: 'Police Radar Trap', color: '#3b82f6', badge: 'Speed Enforcement' };
            case 'hazard':
                return { icon: '⚠️', title: 'Road Hazard', color: '#f59e0b', badge: 'Obstruction Ahead' };
            case 'shoulder':
                return { icon: '🚗', title: 'Vehicle on Shoulder', color: '#a855f7', badge: 'Stationary Vehicle' };
            case 'construction':
                return { icon: '🚧', title: 'Road Work Zone', color: '#f97316', badge: 'Construction' };
            case 'traffic':
                return { icon: '🚙', title: 'Traffic Jam', color: '#ef4444', badge: 'Heavy Congestion' };
            default:
                return { icon: '🛡️', title: 'Community Alert', color: '#10b981', badge: 'Road Alert' };
        }
    };

    const meta = getIncidentMeta(incident.type);
    const isReporter = !incident.reporterId || incident.reporterId === currentUserId || incident.reporterId === 'anonymous' || incident.reporterName === 'You';

    const handleRemoveIncident = async () => {
        try {
            hapticTick();
            await incidentService.removeIncident(incident.id, currentUserId);
            showNotification?.(`🗑️ Removed "${meta.title}" from map`, 3000);
            onClose();
        } catch (e: any) {
            showNotification?.(`⚠️ Could not remove alert: ${e.message || e}`, 3000);
        }
    };

    const handleClearIncident = async () => {
        try {
            hapticMilestone();
            await incidentService.clearIncident(incident.id, currentUserId || 'driver');
            showNotification?.(`✅ Marked alert as cleared`, 3000);
            onClose();
        } catch (e: any) {
            showNotification?.(`⚠️ Error: ${e.message || e}`, 3000);
        }
    };

    const handleConfirmIncident = async () => {
        try {
            hapticSuccess();
            await incidentService.upvoteIncident(incident.id, currentUserId || 'driver');
            showNotification?.(`👍 Confirmed "${meta.title}" (Verified)`, 3000);
            onClose();
        } catch (e: any) {
            showNotification?.(`⚠️ Error: ${e.message || e}`, 3000);
        }
    };

    const formatTimeAgo = (timestamp?: string) => {
        if (!timestamp) return 'Just now';
        const ms = Date.now() - new Date(timestamp).getTime();
        const mins = Math.floor(ms / 60000);
        if (mins < 1) return 'Just now';
        if (mins === 1) return '1 min ago';
        if (mins < 60) return `${mins} mins ago`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ago`;
    };

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 pointer-events-auto">
            <div className={`relative w-full max-w-sm rounded-[2.5rem] border shadow-2xl overflow-hidden flex flex-col transition-all ${panelBg}`}>
                {/* Header Ambient Glow */}
                <div
                    style={{ backgroundColor: `${meta.color}30` }}
                    className="absolute -top-20 -left-20 w-40 h-40 rounded-full blur-3xl pointer-events-none"
                />

                {/* Top Header */}
                <div className="p-5 pb-3 border-b border-white/10 relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            style={{ backgroundColor: `${meta.color}25`, borderColor: `${meta.color}50` }}
                            className="w-12 h-12 rounded-2xl border flex items-center justify-center text-2xl shadow-inner shrink-0"
                        >
                            {meta.icon}
                        </div>
                        <div className="min-w-0">
                            <span
                                style={{ color: meta.color, backgroundColor: `${meta.color}20`, borderColor: `${meta.color}40` }}
                                className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border tracking-wider inline-block mb-1"
                            >
                                {meta.badge}
                            </span>
                            <h3 className="text-base font-black truncate leading-tight">
                                {meta.title}
                            </h3>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm transition-all cursor-pointer shrink-0"
                    >
                        ✕
                    </button>
                </div>

                {/* Content Body */}
                <div className="p-5 space-y-4 relative z-10">
                    {/* Location & Time Info */}
                    <div className={`p-3.5 rounded-2xl border space-y-2 ${subBg}`}>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-bold">Reported by:</span>
                            <span className="font-bold text-indigo-400 truncate max-w-[150px]">
                                {incident.reporterName || 'You'} {isReporter ? '(You)' : ''}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-bold">Time:</span>
                            <span className="font-bold text-slate-300">
                                {formatTimeAgo(incident.timestamp)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-bold">Confirmations:</span>
                            <span className="font-black text-emerald-400">
                                {incident.upvotes || 1} {incident.upvotes === 1 ? 'confirmation' : 'confirmations'}
                            </span>
                        </div>
                        {incident.details && (
                            <div className="pt-2 border-t border-white/5 text-xs text-slate-300">
                                <span className="text-slate-500 font-bold">Note: </span>
                                {incident.details}
                            </div>
                        )}
                    </div>

                    {/* Actions Grid */}
                    <div className="space-y-2">
                        {/* 1. Direct Remove Button (For accidental placement or creator) */}
                        <button
                            type="button"
                            onClick={handleRemoveIncident}
                            className="w-full py-3 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 active:scale-95 transition-all cursor-pointer"
                        >
                            <span>🗑️</span>
                            <span>Remove / Placed by Accident</span>
                        </button>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                            {/* 2. Still There Button */}
                            <button
                                type="button"
                                onClick={handleConfirmIncident}
                                className="py-2.5 px-3 rounded-2xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                            >
                                <span>👍</span>
                                <span>Still There</span>
                            </button>

                            {/* 3. Cleared Button */}
                            <button
                                type="button"
                                onClick={handleClearIncident}
                                className="py-2.5 px-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                            >
                                <span>✅</span>
                                <span>Cleared</span>
                            </button>
                        </div>
                    </div>

                    <p className="text-[10px] text-center text-slate-500 font-medium">
                        Alerts are shared live with all circle members & nearby drivers.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default IncidentDetailModal;
