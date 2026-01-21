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
    avgGasPrice?: string;
    showNotification?: (msg: string, duration?: number) => void;
    onOpenSettings?: () => void;
    weather?: {
        temp: number;
        condition: string;
        icon: string;
    };
}

const BentoSidebar: React.FC<BentoSidebarProps> = ({
    members,
    selectedId,
    onSelect,
    theme,
    hasCircle,
    inviteCode,
    onCreateCircle,
    onJoinCircle,
    avgGasPrice = '$3.45',
    showNotification,
    onOpenSettings,
    weather = { temp: 72, condition: 'Sunny', icon: '☀️' }
}) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

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
        <div className={`relative h-full overflow-y-auto no-scrollbar border-r transition-all duration-500 ease-in-out
          ${isCollapsed ? 'w-20' : 'w-80'}
          ${theme === 'dark'
                ? 'glass-panel'
                : 'bg-white/95 border-slate-200'}`}
        >
            {/* Top buttons row */}
            <div className="absolute top-4 right-4 z-[100] flex items-center gap-2">
                {/* Settings Button */}
                {onOpenSettings && (
                    <button
                        onClick={onOpenSettings}
                        className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-110 active:scale-90
                            ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                        title="Settings"
                    >
                        <span className="text-xs">⚙️</span>
                    </button>
                )}
                {/* Collapse Toggle */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-110 active:scale-90
                        ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    <span className={`text-xs transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}>
                        ◀️
                    </span>
                </button>
            </div>

            <div className={`mt-14 space-y-4 px-3 transition-opacity duration-300 ${isCollapsed ? 'opacity-100' : 'opacity-100'}`}>
                {/* Header Section */}
                {!isCollapsed && (
                    <div className="flex items-center justify-between px-2 animate-in fade-in slide-in-from-left-2">
                        <h2 className={`text-lg font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            Circle
                        </h2>
                        {hasCircle && (
                            <button
                                onClick={() => {
                                    if (inviteCode) {
                                        navigator.clipboard.writeText(inviteCode);
                                        if (showNotification) {
                                            showNotification(`📋 Invite code copied: ${inviteCode}`, 3000);
                                        }
                                    }
                                }}
                                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all
                                    ${theme === 'dark' ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                            >
                                + Add
                            </button>
                        )}
                    </div>
                )}

                {!hasCircle && !isCollapsed ? (
                    <CircleManager
                        theme={theme}
                        onCreateCircle={onCreateCircle}
                        onJoinCircle={onJoinCircle}
                    />
                ) : (
                    <div className="flex flex-col gap-3">
                        {/* Summary Card - Hidden when collapsed */}
                        {!isCollapsed && hasCircle && (
                            <div className={`px-4 py-3 rounded-2xl border transition-all hover:scale-[1.02] flex items-center justify-between animate-in fade-in slide-in-from-top-2
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
                        )}

                        {/* Member Grid/List */}
                        <div className={`grid gap-3 ${isCollapsed ? 'grid-cols-1' : 'grid-cols-1'}`}>
                            {members.map(member => (
                                <div
                                    key={member.id}
                                    onClick={() => onSelect(member.id)}
                                    className={`group relative flex items-center gap-3 rounded-2xl transition-all cursor-pointer border
                                    ${isCollapsed ? 'p-1.5 justify-center' : 'p-3'}
                                    ${selectedId === member.id
                                            ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border-indigo-500/50 glow-primary'
                                            : theme === 'dark'
                                                ? 'glass-card'
                                                : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                                        }`}
                                    title={isCollapsed ? member.name : undefined}
                                >
                                    <div className="relative shrink-0">
                                        <img
                                            src={member.avatar}
                                            className={`rounded-xl object-cover transition-all
                              ${isCollapsed ? 'w-10 h-10' : 'w-12 h-12'}
                              ${selectedId === member.id ? `ring-2 ring-indigo-500 ring-offset-2 ${theme === 'dark' ? 'ring-offset-slate-900' : 'ring-offset-white'}` : ''}
                              ${member.isGhostMode ? 'blur-sm grayscale opacity-70' : ''}
                            `}
                                        />
                                        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${theme === 'dark' ? 'bg-slate-800 border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
                                            {getStatusIcon(member.status)}
                                        </div>

                                        {member.isGhostMode && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl backdrop-blur-[1px]">
                                                <span className="text-base drop-shadow-md">🛡️</span>
                                            </div>
                                        )}
                                    </div>

                                    {!isCollapsed && (
                                        <div className="flex-1 text-left min-w-0 animate-in fade-in slide-in-from-left-2">
                                            <h3 className={`font-black text-sm tracking-tight truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                {member.name}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1
                                                    ${member.battery <= 20 ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
                                                    {member.battery <= 20 ? '🪫' : '🔋'} {member.battery}%
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Stats Row - Compact or Hidden when collapsed */}
                        {!isCollapsed && (
                            <div className={`p-3 rounded-2xl border flex items-center justify-around animate-in fade-in slide-in-from-bottom-2
                      ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-white border-slate-100 shadow-sm'}`}>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-xl">{weather.icon}</span>
                                    <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{weather.temp}°F</span>
                                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-tighter">{weather.condition}</span>
                                </div>
                                <div className={`w-px h-8 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`} />
                                <div className="flex flex-col items-center gap-0.5 text-amber-500">
                                    <span className="text-xl">⛽</span>
                                    <span className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{avgGasPrice}</span>
                                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-tighter">Gas</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div >
    );
};

export default React.memo(BentoSidebar);
