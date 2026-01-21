import React from 'react';
import { FamilyMember } from '../types';

interface QuickActionsProps {
    member: FamilyMember;
    onCheckIn: () => void;
    onSendEmoji: (emoji: string) => void;
    onCall: () => void;
    onNavigateTo: () => void;
    theme: 'light' | 'dark';
    isCurrentUser?: boolean;
}

const QuickActions: React.FC<QuickActionsProps> = ({
    member,
    onCheckIn,
    onSendEmoji,
    onCall,
    onNavigateTo,
    theme,
    isCurrentUser = false
}) => {
    const reactions = ['👋', '❤️', '👍', '🏠', '☕', '🍕'];

    return (
        <div className={`rounded-2xl p-4 backdrop-blur-xl border shadow-xl
      ${theme === 'dark'
                ? 'bg-slate-900/90 border-white/10'
                : 'bg-white/90 border-slate-200'}`}
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <img
                    src={member.avatar}
                    alt={member.name}
                    className="w-12 h-12 rounded-xl object-cover"
                />
                <div>
                    <h3 className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        {member.name}
                    </h3>
                    <p className="text-xs text-slate-500">{member.status} • Updated just now</p>
                </div>
            </div>

            {/* Quick emoji reactions */}
            <div className="mb-4">
                <p className={`text-xs font-medium uppercase tracking-wide mb-2
          ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                    Quick Reaction
                </p>
                <div className="flex gap-2">
                    {reactions.map(emoji => (
                        <button
                            key={emoji}
                            onClick={() => onSendEmoji(emoji)}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all hover:scale-110 active:scale-95
                ${theme === 'dark'
                                    ? 'bg-white/5 hover:bg-white/10'
                                    : 'bg-slate-100 hover:bg-slate-200'}`}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-2">
                <button
                    onClick={onCheckIn}
                    className="flex flex-col items-center gap-1 p-3 rounded-xl bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-all"
                >
                    <span className="text-lg">✓</span>
                    <span className="text-[10px] font-bold uppercase">Check In</span>
                </button>

                <button
                    onClick={onCall}
                    className="flex flex-col items-center gap-1 p-3 rounded-xl bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all"
                >
                    <span className="text-lg">📞</span>
                    <span className="text-[10px] font-bold uppercase">Call</span>
                </button>

                <button
                    onClick={onNavigateTo}
                    className="flex flex-col items-center gap-1 p-3 rounded-xl bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-all"
                >
                    <span className="text-lg">🧭</span>
                    <span className="text-[10px] font-bold uppercase">Navigate</span>
                </button>
            </div>

            {/* "I'm Safe" button for self */}
            {isCurrentUser && (
                <button
                    onClick={onCheckIn}
                    className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-sm hover:opacity-90 transition-all shadow-lg shadow-green-500/30"
                >
                    ✨ I'm Safe
                </button>
            )}
        </div>
    );
};

export default QuickActions;
