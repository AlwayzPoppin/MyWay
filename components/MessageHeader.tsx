import React from 'react';
import { Trash2, User, Users } from 'lucide-react';
import { FamilyMember } from '../types';
import { FamilyCircle, getCircleColor } from '../services/authService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';

export interface MessageHeaderProps {
    isGroupChat?: boolean;
    isDirectMessage?: boolean;
    activeRecipient?: FamilyMember | null;
    selectedRecipientId?: string | null;
    selectedChannelId?: string | 'all';
    activeChannelCircle?: FamilyCircle | null;
    userCircles?: FamilyCircle[];
    members?: FamilyMember[];
    theme?: 'light' | 'dark';
    onBackToGroup?: () => void;
    onClearConversation?: () => void;
    canClearConversation?: boolean;
    onClose?: () => void;
}

export const MessageHeader: React.FC<MessageHeaderProps> = ({
    isGroupChat: propIsGroupChat,
    isDirectMessage: propIsDirectMessage,
    activeRecipient,
    selectedRecipientId,
    selectedChannelId = 'all',
    activeChannelCircle,
    userCircles = [],
    members = [],
    theme = 'dark',
    onBackToGroup,
    onClearConversation,
    canClearConversation = false,
    onClose,
}) => {
    // Determine whether this active conversation is a group feed or a 1-on-1 direct message
    const isGroupCircle = (id: string | null | undefined): boolean => {
        if (!id) return false;
        return id === 'all' || userCircles.some(c => c.id === id);
    };

    // Explicit Type Guard & Condition:
    // A conversation is strictly a group chat if viewing all groups feed, or a circle channel,
    // or if the recipient evaluates to a group/circle context, or if recipient ID is missing.
    const isGroupChat = propIsGroupChat !== undefined
        ? propIsGroupChat
        : Boolean(
            !selectedRecipientId ||
            selectedRecipientId === 'all' ||
            isGroupCircle(selectedRecipientId) ||
            selectedChannelId === 'all' ||
            activeChannelCircle !== null ||
            (selectedChannelId && isGroupCircle(selectedChannelId)) ||
            !activeRecipient
        );

    // True 1-on-1 direct message ONLY when isGroupChat is false, has an active individual recipient,
    // and the recipient ID is not a circle or group context.
    const isDirect = !isGroupChat && (
        propIsDirectMessage !== undefined
            ? propIsDirectMessage
            : Boolean(
                selectedRecipientId &&
                activeRecipient &&
                selectedRecipientId !== 'all' &&
                !isGroupCircle(selectedRecipientId)
            )
    );

    return (
        <div
            className={`flex items-center justify-between p-3.5 border-b shrink-0 ${
                theme === 'dark' ? 'border-white/10 bg-slate-950/60' : 'border-slate-200 bg-slate-50/80'
            }`}
        >
            <div className="flex items-center gap-3 min-w-0 flex-1">
                {isDirect && activeRecipient ? (
                    <>
                        {onBackToGroup && (
                            <button
                                type="button"
                                onClick={onBackToGroup}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                    theme === 'dark'
                                        ? 'bg-white/5 hover:bg-white/10 text-slate-300'
                                        : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                }`}
                                title="Back to Group Channels"
                            >
                                <span className="text-sm font-bold">←</span>
                            </button>
                        )}
                        <div className="relative shrink-0">
                            {activeRecipient.avatar ? (
                                <img
                                    src={getSafeAvatarUrl(activeRecipient.avatar, activeRecipient.name)}
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(activeRecipient.name);
                                    }}
                                    alt={activeRecipient.name}
                                    className="w-9 h-9 rounded-full object-cover border-2 border-indigo-500 shadow-sm"
                                />
                            ) : (
                                <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-sm flex items-center justify-center border-2 border-indigo-400">
                                    {activeRecipient.name[0]}
                                </div>
                            )}
                            <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                                    activeRecipient.status === 'Driving'
                                        ? 'bg-indigo-500 animate-pulse'
                                        : activeRecipient.status === 'Moving'
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                }`}
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <h3
                                    className={`font-black text-sm truncate ${
                                        theme === 'dark' ? 'text-white' : 'text-slate-900'
                                    }`}
                                >
                                    {activeRecipient.name}
                                </h3>
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 uppercase tracking-wider flex items-center gap-1 shrink-0 shadow-xs">
                                    <User className="w-2.5 h-2.5 text-indigo-400" />
                                    1-ON-1 DM
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">
                                {activeRecipient.status}{' '}
                                {activeRecipient.speed > 0 ? `• ${Math.round(activeRecipient.speed)} MPH` : ''} • 🔋{' '}
                                {activeRecipient.battery}%
                            </p>
                        </div>
                    </>
                ) : selectedChannelId === 'all' ? (
                    <>
                        <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-blue-600 via-purple-600 to-emerald-600 flex items-center justify-center text-lg text-white shadow-md shrink-0">
                            ✨
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <h3
                                    className={`font-black text-sm truncate ${
                                        theme === 'dark' ? 'text-white' : 'text-slate-900'
                                    }`}
                                >
                                    All Groups Feed
                                </h3>
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 uppercase tracking-wider flex items-center gap-1 shrink-0 shadow-xs">
                                    <Users className="w-2.5 h-2.5 text-purple-400" />
                                    GROUP CHAT
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">
                                {userCircles.length} {userCircles.length === 1 ? 'Circle' : 'Circles'} Connected •
                                Unified Live Chat
                            </p>
                        </div>
                    </>
                ) : (
                    (() => {
                        const cHex = activeChannelCircle?.color || getCircleColor(selectedChannelId).hex;
                        const circleMembersCount =
                            activeChannelCircle?.members?.length ||
                            members.filter((m) => m.circleId === selectedChannelId).length ||
                            1;

                        return (
                            <>
                                <div
                                    style={{ backgroundColor: `${cHex}33`, borderColor: cHex }}
                                    className="w-9 h-9 rounded-2xl border flex items-center justify-center text-base shrink-0 shadow-sm"
                                >
                                    {activeChannelCircle?.name.toLowerCase().includes('work')
                                        ? '💼'
                                        : activeChannelCircle?.name.toLowerCase().includes('trip')
                                        ? '🚗'
                                        : activeChannelCircle?.name.toLowerCase().includes('friend')
                                        ? '🎉'
                                        : '🏠'}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cHex }} />
                                        <h3
                                            className={`font-black text-sm truncate ${
                                                theme === 'dark' ? 'text-white' : 'text-slate-900'
                                            }`}
                                        >
                                            {activeChannelCircle?.name || 'Circle Channel'}
                                        </h3>
                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 uppercase tracking-wider flex items-center gap-1 shrink-0 shadow-xs">
                                            <Users className="w-2.5 h-2.5 text-purple-400" />
                                            CIRCLE CHAT
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 truncate">
                                        {circleMembersCount} members • Circle Channel
                                    </p>
                                </div>
                            </>
                        );
                    })()
                )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
                {onClearConversation && (
                    <button
                        type="button"
                        onClick={onClearConversation}
                        disabled={!canClearConversation}
                        className={`p-2 rounded-xl transition-colors ${
                            theme === 'dark' ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
                        } disabled:cursor-not-allowed disabled:opacity-35`}
                        title="Clear conversation from this device"
                        aria-label="Clear conversation from this device"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className={`p-2 rounded-xl transition-colors cursor-pointer ${
                            theme === 'dark' ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
                        }`}
                        title="Close Chat"
                        aria-label="Close chat"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
};

export default MessageHeader;
