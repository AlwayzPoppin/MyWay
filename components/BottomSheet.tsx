import React, { useState, useRef, useEffect } from 'react';
import { FamilyMember } from '../types';

interface BottomSheetProps {
    members: FamilyMember[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    theme: 'light' | 'dark';
}

const BottomSheet: React.FC<BottomSheetProps> = ({ members, selectedId, onSelect, theme }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const sheetRef = useRef<HTMLDivElement>(null);

    const collapsedHeight = 100; // Shows just faces
    const expandedHeight = 340; // Full stats view

    const handleTouchStart = (e: React.TouchEvent) => {
        setDragStart(e.touches[0].clientY);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (dragStart === null) return;
        const diff = dragStart - e.touches[0].clientY;
        if (diff > 50) setIsExpanded(true);
        if (diff < -50) setIsExpanded(false);
    };

    const handleTouchEnd = () => {
        setDragStart(null);
    };

    const getBatteryColor = (battery: number) => {
        if (battery <= 20) return '#ef4444';
        if (battery <= 50) return '#f59e0b';
        return '#22c55e';
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Driving': return '#6366f1';
            case 'Moving': return '#22c55e';
            case 'Stationary': return '#94a3b8';
            default: return '#6b7280';
        }
    };

    return (
        <div
            ref={sheetRef}
            className={`fixed bottom-0 left-0 right-0 z-[100] bottom-sheet safe-bottom
        ${theme === 'dark'
                    ? 'bg-gradient-to-t from-[#0f172a] via-[#0f172a]/98 to-[#0f172a]/95'
                    : 'bg-gradient-to-t from-white via-white/98 to-white/95'}
        backdrop-blur-2xl border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}
        rounded-t-[28px] shadow-[0_-10px_60px_rgba(0,0,0,0.3)]`}
            style={{
                height: isExpanded ? expandedHeight : collapsedHeight,
                transform: 'translateY(0)'
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Drag handle */}
            <div
                className="bottom-sheet-handle cursor-grab active:cursor-grabbing"
                onClick={() => setIsExpanded(!isExpanded)}
            />

            {/* Collapsed view - faces only */}
            <div className={`px-4 ${isExpanded ? 'h-20' : 'flex-1'}`}>
                <div className="flex items-center justify-center gap-4">
                    {members.map((member, index) => (
                        <button
                            key={member.id}
                            onClick={() => onSelect(member.id)}
                            className={`relative transition-all duration-300 ${selectedId === member.id ? 'scale-110 z-10' : 'hover:scale-105'
                                }`}
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            {/* Status ring */}
                            <div
                                className="absolute -inset-1 rounded-full"
                                style={{
                                    border: `3px solid ${getStatusColor(member.status)}`,
                                    opacity: selectedId === member.id ? 1 : 0.6
                                }}
                            />

                            <img
                                src={member.avatar}
                                alt={member.name}
                                className={`w-14 h-14 rounded-full object-cover border-2 
                  ${theme === 'dark' ? 'border-slate-800' : 'border-white'}
                  shadow-lg`}
                            />

                            {/* Status dot */}
                            <div
                                className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2"
                                style={{
                                    backgroundColor: getStatusColor(member.status),
                                    borderColor: theme === 'dark' ? '#0f172a' : 'white'
                                }}
                            />
                        </button>
                    ))}
                </div>
            </div>

            {/* Expanded view - full stats */}
            {isExpanded && (
                <div className="px-4 py-2 space-y-3 overflow-y-auto" style={{ maxHeight: expandedHeight - 100 }}>
                    {members.map(member => (
                        <button
                            key={member.id}
                            onClick={() => onSelect(member.id)}
                            className={`w-full p-3 rounded-2xl flex items-center gap-4 transition-all duration-200
                ${selectedId === member.id
                                    ? theme === 'dark'
                                        ? 'bg-indigo-600/20 border border-indigo-500/30'
                                        : 'bg-indigo-50 border border-indigo-200'
                                    : theme === 'dark'
                                        ? 'bg-white/5 border border-white/5 hover:bg-white/10'
                                        : 'bg-slate-50 border border-slate-100 hover:bg-slate-100'
                                }`}
                        >
                            {/* Avatar */}
                            <div className="relative">
                                <img
                                    src={member.avatar}
                                    alt={member.name}
                                    className="w-12 h-12 rounded-xl object-cover"
                                />
                                <div
                                    className="absolute -bottom-1 -right-1 w-5 h-5 rounded-lg flex items-center justify-center text-xs"
                                    style={{ backgroundColor: getStatusColor(member.status) }}
                                >
                                    {member.status === 'Driving' ? '🚗' : member.status === 'Moving' ? '🚶' : '📍'}
                                </div>
                            </div>

                            {/* Info */}
                            <div className="flex-1 text-left">
                                <div className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    {member.name}
                                    {member.name === 'You' && <span className="ml-2 text-xs text-indigo-400">(You)</span>}
                                </div>
                                <div className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    {member.status} • {member.currentPlace || 'Unknown location'}
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="flex items-center gap-3">
                                {/* Speed */}
                                {(member.status === 'Driving' || member.status === 'Moving') && member.speed > 0 && (
                                    <div className="text-center">
                                        <div className={`text-sm font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                            {Math.round(member.speed)}
                                        </div>
                                        <div className="text-[10px] text-slate-500">mph</div>
                                    </div>
                                )}

                                {/* Battery */}
                                <div className="text-center">
                                    <div className="w-6 h-3 rounded-sm border border-slate-600 relative overflow-hidden">
                                        <div
                                            className="absolute left-0 top-0 bottom-0 rounded-sm"
                                            style={{
                                                width: `${member.battery}%`,
                                                backgroundColor: getBatteryColor(member.battery)
                                            }}
                                        />
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">{member.battery}%</div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BottomSheet;
