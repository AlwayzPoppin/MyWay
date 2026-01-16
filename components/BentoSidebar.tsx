import React from 'react';
import { FamilyMember } from '../types';
import CircleManager from './CircleManager';

interface BentoSidebarProps {
    members: FamilyMember[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    theme: 'light' | 'dark';
    hasCircle: boolean;
    inviteCode?: string;
    onCreateCircle: (name: string) => Promise<any>;
    onJoinCircle: (code: string) => Promise<any>;
}

const BentoSidebar: React.FC<BentoSidebarProps> = ({
    members,
    selectedId,
    onSelect,
    theme,
    hasCircle,
    inviteCode,
    onCreateCircle,
    onJoinCircle
}) => {
    const getBatteryColor = (battery: number) => {
        if (battery <= 20) return '#ef4444';
        if (battery <= 50) return '#f59e0b';
        return '#22c55e';
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Driving': return '🏎️';
            case 'Moving': return '🚶';
            case 'Stationary': return '📍';
            case 'Offline': return '💤';
            default: return '📍';
        }
    };

    return (
        <div className={`w-80 h-full p-4 overflow-y-auto no-scrollbar border-r backdrop-blur-2xl transition-colors duration-500
      ${theme === 'dark'
                ? 'bg-[#050505]/90 border-white/5 backdrop-blur-md'
                : 'bg-white/90 border-slate-200 backdrop-blur-md'}`}
        >
            <div className="mt-14 space-y-4">
                {/* Header with Circle Management */}
                <div className="flex items-center justify-between px-2">
                    <h2 className={`text-lg font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        Circle
                    </h2>
                    {hasCircle && (
                        <button
                            onClick={() => {
                                if (inviteCode) {
                                    navigator.clipboard.writeText(inviteCode);
                                    alert(`Invite Code: ${inviteCode} copied to clipboard!`);
                                }
                            }}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all
                                ${theme === 'dark' ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                        >
                            + Add Family
                        </button>
                    )}
                </div>

                {!hasCircle ? (
                    <CircleManager
                        theme={theme}
                        onCreateCircle={onCreateCircle}
                        onJoinCircle={onJoinCircle}
                    />
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {/* Family Summary Card - Compact */}
                        <div className={`col-span-2 px-4 py-3 rounded-2xl border transition-all hover:scale-[1.02] flex items-center justify-between
                  ${theme === 'dark'
                                ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                : 'bg-slate-50 border-slate-100'}`}
                        >
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Live Status</p>
                                <h3 className={`text-base font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    {members.filter(m => m.status !== 'Offline').length} Active
                                </h3>
                            </div>
                            <div className="flex -space-x-2">
                                {members.slice(0, 3).map(m => (
                                    <img key={m.id} src={m.avatar} className={`w-7 h-7 rounded-full border-2 ${theme === 'dark' ? 'border-slate-800' : 'border-white'} shadow-sm`} />
                                ))}
                            </div>
                        </div>

                        {/* Member Cards */}
                        {members.map(member => (
                            <div
                                key={member.id}
                                onClick={() => onSelect(member.id)}
                                className={`group flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer border
                                ${selectedId === member.id
                                        ? 'bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-indigo-500/50'
                                        : theme === 'dark'
                                            ? 'bg-white/5 border-white/5 hover:bg-white/10'
                                            : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                    }`}
                            >
                                <div className="relative shrink-0">
                                    <img
                                        src={member.avatar}
                                        className={`w-12 h-12 rounded-xl object-cover transition-all
                          ${selectedId === member.id ? `ring-2 ring-indigo-500 ring-offset-2 ${theme === 'dark' ? 'ring-offset-slate-900' : 'ring-offset-white'}` : ''}
                          ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''}
                        `}
                                    />
                                    <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${theme === 'dark' ? 'bg-slate-800 border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
                                        {getStatusIcon(member.status)}
                                    </div>

                                    {/* Privacy Shield Overlay if Ghost Mode */}
                                    {member.isGhostMode && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl backdrop-blur-[1px]">
                                            <span className="text-base drop-shadow-md">🛡️</span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 text-left min-w-0">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className={`font-black text-sm tracking-tight truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                {member.name}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1
                                                    ${member.battery <= 20 ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
                                                    {member.battery <= 20 ? '🪫' : '🔋'} {member.battery}%
                                                </span>
                                            </div>

                                            <p className="text-[10px] text-slate-500 truncate mt-0.5 font-medium">
                                                {member.currentPlace
                                                    ? `Made ${member.wayType ? member.wayType.replace('Way', ' Way') : 'their Way'} to ${member.currentPlace}`
                                                    : (member.status === 'Driving' ? `${member.speed} mph` : member.status)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Dashboard Stats Row */}
                        <div className={`col-span-2 p-3 rounded-2xl border flex items-center justify-around
                  ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-white border-slate-100 shadow-sm'}`}>
                            <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xl">🌤️</span>
                                <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>72°F</span>
                                <span className="text-[10px] text-slate-500">Sunny</span>
                            </div>
                            <div className={`w-px h-8 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`} />
                            <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xl">⛽</span>
                                <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>$3.45</span>
                                <span className="text-[10px] text-slate-500">Avg. Gas</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
};

export default BentoSidebar;
