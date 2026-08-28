import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember } from '../types';
import { AppNotification } from './NotificationCenter';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';

interface ActivityLogProps {
    activities: AppNotification[];
    members: FamilyMember[];
    onResolveSOS: (id: string, memberId?: string) => void;
    theme: 'light' | 'dark';
}

const ActivityLog: React.FC<ActivityLogProps> = ({ activities, members, onResolveSOS, theme }) => {
    const isDark = theme === 'dark';
    const textColor = isDark ? 'text-slate-200' : 'text-slate-800';
    
    const [pendingResolveId, setPendingResolveId] = useState<string | null>(null);
    const timeoutRef = useRef<any>(null);

    // Clean up timeout on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const handleResolveClick = (id: string, memberId?: string) => {
        if (pendingResolveId === id) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            setPendingResolveId(null);
            onResolveSOS(id, memberId);
        } else {
            setPendingResolveId(id);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                setPendingResolveId(null);
                timeoutRef.current = null;
            }, 4000);
        }
    };

    const getTimeAgo = (timestamp: number): string => {
        const mins = Math.floor((Date.now() - timestamp) / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    };

    // Partition activities: unresolved SOS on top, rest in chronological order
    const sosUnresolved = activities.filter(a => (a.type === 'sos' || a.type === 'EMERGENCY' || a.type === 'SOS') && !a.isResolved);
    const otherActivities = activities.filter(a => !((a.type === 'sos' || a.type === 'EMERGENCY' || a.type === 'SOS') && !a.isResolved));
    const sortedActivities = [...sosUnresolved, ...otherActivities];

    return (
        <div className="flex flex-col h-[calc(100vh-220px)] animate-in fade-in duration-300">
            {/* Header / Summary */}
            <div className="px-2 mb-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    Recent Incidents & Events
                </span>
                {sosUnresolved.length > 0 && (
                    <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                )}
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-4 no-scrollbar relative pl-3">
                {/* Timeline vertical bar */}
                {sortedActivities.length > 1 && (
                    <div className="absolute left-7 top-6 bottom-6 w-0.5 bg-indigo-500/10 pointer-events-none" />
                )}

                {sortedActivities.length === 0 ? (
                    <div className="text-center py-16 text-slate-500">
                        <span className="text-3xl block mb-2 opacity-50">📋</span>
                        <span className="text-xs font-black uppercase tracking-wider">No activity logged yet</span>
                    </div>
                ) : (
                    sortedActivities.map((act) => {
                        const member = members.find(m => m.id === act.memberId);
                        
                        // Styling based on severity
                        const isSos = (act.type === 'sos' || act.type === 'EMERGENCY' || act.type === 'SOS') && !act.isResolved;
                        const isSafety = act.type === 'safety';

                        let itemStyle = isDark ? "glass-card border border-white/5" : "bg-white border border-slate-100 shadow-sm";
                        if (isSos) {
                          itemStyle = "border-red-500/40 bg-red-950/20 text-red-200 ring-1 ring-red-500/20 animate-pulse shadow-lg shadow-red-900/10";
                        } else if (isSafety) {
                          itemStyle = isDark ? "border-amber-500/20 bg-amber-500/5 text-amber-200" : "border-amber-200 bg-amber-50/50 text-amber-800";
                        }

                        return (
                            <div 
                                key={act.id} 
                                className={`relative flex gap-3 p-3 rounded-2xl transition-all hover:scale-[1.01] ${itemStyle}`}
                            >
                                {/* Avatar or badge */}
                                <div className="relative z-10 shrink-0">
                                    {member ? (
                                        <img 
                                            src={getSafeAvatarUrl(member.avatar, member.name || member.id)} 
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(member.name || member.id);
                                            }}
                                            alt={member.name} 
                                            className="w-9 h-9 rounded-full object-cover border-2 border-indigo-500 shadow-sm bg-slate-800"
                                        />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-indigo-900/30 flex items-center justify-center border-2 border-indigo-500/30">
                                            <span className="text-sm">{act.icon}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${
                                            isSos ? 'text-red-400' : isSafety ? 'text-amber-400' : 'text-indigo-400'
                                        }`}>
                                            {act.title}
                                        </span>
                                        <span className="text-[9px] text-slate-500 whitespace-nowrap">
                                            {getTimeAgo(act.timestamp)}
                                        </span>
                                    </div>
                                    <p className={`text-xs font-medium leading-relaxed mt-1 ${isSos ? 'text-red-200' : textColor}`}>
                                        {act.message}
                                    </p>

                                    {/* Action button for active SOS */}
                                    {isSos && (
                                        <button
                                            onClick={() => handleResolveClick(act.id, act.memberId)}
                                            className={`mt-2.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-md ${
                                                pendingResolveId === act.id
                                                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/20 animate-pulse'
                                                    : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20'
                                            }`}
                                        >
                                            {pendingResolveId === act.id ? 'Tap Again to Confirm' : 'Resolve Emergency'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default React.memo(ActivityLog);
