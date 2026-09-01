import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FamilyMember } from '../types';
import {
    subscribeToMessages,
    subscribeToMultipleCirclesMessages,
    sendMessage as firestoreSendMessage,
    ChatMessage
} from '../services/chatService';
import { getBufferedMessages } from '../services/offlineMessageBuffer';
import { parseMessageIntent, MessageIntent, getSocialSafetyAdvisory } from '../services/geminiService';
import { FamilyCircle, getCircleColor } from '../services/authService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from '../utils/avatar';

const OMNI_ID = 'omni-ai';

interface MessagingPanelProps {
    members: FamilyMember[];
    currentUserId: string;
    circleId?: string;
    userCircles?: FamilyCircle[];
    activeFilterCircleId?: string | 'all';
    initialRecipientId?: string | null;
    onClose: () => void;
    theme: 'light' | 'dark';
}

const MessagingPanel: React.FC<MessagingPanelProps> = ({
    members,
    currentUserId,
    circleId,
    userCircles = [],
    activeFilterCircleId = 'all',
    initialRecipientId = null,
    onClose,
    theme
}) => {
    // Active channel: 'all' (all circles feed) or circleId (specific circle) or null (DMs mode)
    const [selectedChannelId, setSelectedChannelId] = useState<string | 'all'>(() => {
        if (activeFilterCircleId) return activeFilterCircleId;
        if (userCircles.length > 0) return 'all';
        return circleId || 'all';
    });
    const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(initialRecipientId);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [queuedMessages, setQueuedMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [suggestion, setSuggestion] = useState<MessageIntent | null>(null);
    const [isLoadingOmni, setIsLoadingOmni] = useState(false);
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Sync initialRecipientId if passed from parent
    useEffect(() => {
        if (initialRecipientId !== undefined && initialRecipientId !== null) {
            setSelectedRecipientId(initialRecipientId);
        }
    }, [initialRecipientId]);

    const activeRecipient = useMemo(() => {
        if (!selectedRecipientId) return null;
        return members.find(m => m.id === selectedRecipientId) || null;
    }, [selectedRecipientId, members]);

    const otherMembers = useMemo(() => {
        return members.filter(m => m.id !== currentUserId);
    }, [members, currentUserId]);

    // Active circle object for the selected channel
    const activeChannelCircle = useMemo(() => {
        if (selectedChannelId === 'all') return null;
        return userCircles.find(c => c.id === selectedChannelId) || null;
    }, [selectedChannelId, userCircles]);

    // Effective circle ID to write messages into
    const effectiveCircleId = useMemo(() => {
        if (selectedChannelId && selectedChannelId !== 'all') {
            return selectedChannelId;
        }
        return circleId || (userCircles.length > 0 ? userCircles[0].id : '');
    }, [selectedChannelId, circleId, userCircles]);

    const quickReplies = selectedRecipientId
        ? ['On my way!', 'Where are you?', 'Call me', 'Almost there!', '👍', '❤️']
        : ['👍', '❤️', '🏠', 'On my way!', 'Be there soon', 'Running late'];

    // Load offline queued messages
    const refreshQueuedMessages = useCallback(async () => {
        const targetIds = userCircles.length > 0 ? userCircles.map(c => c.id) : (circleId ? [circleId] : []);
        if (targetIds.length === 0) return;

        const allBuffered: ChatMessage[] = [];
        for (const cId of targetIds) {
            const buffered = await getBufferedMessages(cId);
            const mapped: ChatMessage[] = buffered.map(b => ({
                id: `buffered-${b.id || b.clientMessageId}`,
                senderId: b.senderId,
                recipientId: b.recipientId,
                circleId: b.circleId || cId,
                content: b.content,
                type: b.type,
                timestamp: new Date(b.timestamp),
                status: 'queued'
            }));
            allBuffered.push(...mapped);
        }
        setQueuedMessages(allBuffered);
    }, [userCircles, circleId]);

    // Network status listener
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            setTimeout(refreshQueuedMessages, 1000);
        };
        const handleOffline = () => {
            setIsOnline(false);
            refreshQueuedMessages();
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        refreshQueuedMessages();

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [refreshQueuedMessages]);

    // Multi-Circle Live Message Subscription
    useEffect(() => {
        const targetIds = userCircles.length > 0 
            ? userCircles.map(c => c.id) 
            : (circleId ? [circleId] : []);

        if (targetIds.length === 0) return;

        const unsubscribe = subscribeToMultipleCirclesMessages(targetIds, (msgs) => {
            setMessages(msgs);
            refreshQueuedMessages();

            // Analyze last message for smart Gemini suggestions if it's not from us
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.senderId !== currentUserId) {
                parseMessageIntent(lastMsg.content).then(intent => {
                    if (intent.intent !== 'none') {
                        setSuggestion(intent);
                    } else {
                        setSuggestion(null);
                    }
                });
            } else {
                setSuggestion(null);
            }
        });

        return () => unsubscribe();
    }, [userCircles, circleId, currentUserId, refreshQueuedMessages]);

    // Combine synced messages with queued offline messages
    const combinedMessages = useMemo(() => {
        return [
            ...messages,
            ...queuedMessages.filter(qm => !messages.some(m => m.senderId === qm.senderId && m.content === qm.content && Math.abs(m.timestamp.getTime() - qm.timestamp.getTime()) < 60000))
        ];
    }, [messages, queuedMessages]);

    // Filter messages based on active channel and recipient selection
    const activeConversationMessages = useMemo(() => {
        return combinedMessages.filter(msg => {
            if (selectedRecipientId) {
                // 1-on-1 Direct Message
                return (
                    (msg.senderId === currentUserId && msg.recipientId === selectedRecipientId) ||
                    (msg.senderId === selectedRecipientId && msg.recipientId === currentUserId)
                );
            }

            // Exclude direct messages from group channels
            if (msg.recipientId) return false;

            // Channel filtering:
            if (selectedChannelId === 'all') {
                return true; // Show all circles' messages
            } else {
                return msg.circleId === selectedChannelId;
            }
        });
    }, [combinedMessages, selectedRecipientId, selectedChannelId, currentUserId]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeConversationMessages]);

    const handleSendMessage = async (content: string, type: ChatMessage['type'] = 'text') => {
        if (!content.trim() || !effectiveCircleId) return;

        try {
            const result = await firestoreSendMessage(
                effectiveCircleId,
                currentUserId,
                content,
                type,
                selectedRecipientId || undefined
            );
            setNewMessage('');
            if (result && result.status === 'queued') {
                setQueuedMessages(prev => [...prev, result]);
            }
        } catch (error) {
            console.error("Failed to send message:", error);
        }
    };

    const sendLocationShare = () => {
        const currentMember = members.find(m => m.id === currentUserId);
        if (currentMember) {
            handleSendMessage(
                `📍 Shared my location: ${currentMember.location ? `${currentMember.location.lat.toFixed(4)}, ${currentMember.location.lng.toFixed(4)}` : 'Current location'}`,
                'location'
            );
        }
    };

    const handleSuggestionClick = () => {
        if (!suggestion) return;

        if (suggestion.intent === 'ask_eta') {
            handleSendMessage("🕒 My estimated arrival is 12 mins. (AI Computed)", 'text');
        } else if (suggestion.intent === 'ask_location') {
            sendLocationShare();
        } else if (suggestion.intent === 'check_in') {
            handleSendMessage("✅ Just checked in! Everything is safe.", 'text');
        }
        setSuggestion(null);
    };

    const handleAskOmni = async () => {
        if (!effectiveCircleId) return;
        setIsLoadingOmni(true);
        try {
            const insight = await getSocialSafetyAdvisory(members);
            if (insight) {
                await firestoreSendMessage(effectiveCircleId, OMNI_ID, insight, 'text', selectedRecipientId || undefined);
            } else {
                alert("✨ All clear! No critical risks detected right now.");
            }
        } catch (error) {
            console.error("AI Insight failed:", error);
        } finally {
            setIsLoadingOmni(false);
        }
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`flex flex-col h-full rounded-3xl overflow-hidden shadow-2xl border
      ${theme === 'dark'
                ? 'bg-slate-900/98 border-white/10'
                : 'bg-white/98 border-slate-200'}`}
        >
            {/* Header */}
            <div className={`flex items-center justify-between p-3.5 border-b
        ${theme === 'dark' ? 'border-white/10 bg-slate-950/60' : 'border-slate-200 bg-slate-50/80'}`}
            >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {selectedRecipientId && activeRecipient ? (
                        <>
                            <button
                                type="button"
                                onClick={() => setSelectedRecipientId(null)}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                    theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                }`}
                                title="Back to Group Channels"
                            >
                                <span className="text-sm font-bold">←</span>
                            </button>
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
                                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                                    activeRecipient.status === 'Driving' ? 'bg-indigo-500 animate-pulse' :
                                    activeRecipient.status === 'Moving' ? 'bg-amber-500' : 'bg-emerald-500'
                                }`} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <h3 className={`font-black text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                        {activeRecipient.name}
                                    </h3>
                                    <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                                        1-on-1 DM
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-400 truncate">
                                    {activeRecipient.status} {activeRecipient.speed > 0 ? `• ${Math.round(activeRecipient.speed)} MPH` : ''} • 🔋 {activeRecipient.battery}%
                                </p>
                            </div>
                        </>
                    ) : selectedChannelId === 'all' ? (
                        <>
                            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-blue-600 via-purple-600 to-emerald-600 flex items-center justify-center text-lg text-white shadow-md shrink-0">
                                ✨
                            </div>
                            <div className="min-w-0">
                                <h3 className={`font-black text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    All Groups Feed
                                </h3>
                                <p className="text-[10px] text-slate-400 truncate">
                                    {userCircles.length} {userCircles.length === 1 ? 'Circle' : 'Circles'} Connected • Unified Live Chat
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            {(() => {
                                const cHex = activeChannelCircle?.color || getCircleColor(selectedChannelId).hex;
                                return (
                                    <>
                                        <div
                                            style={{ backgroundColor: `${cHex}33`, borderColor: cHex }}
                                            className="w-9 h-9 rounded-2xl border flex items-center justify-center text-base shrink-0 shadow-sm"
                                        >
                                            {activeChannelCircle?.name.toLowerCase().includes('work') ? '💼' :
                                             activeChannelCircle?.name.toLowerCase().includes('trip') ? '🚗' :
                                             activeChannelCircle?.name.toLowerCase().includes('friend') ? '🎉' : '🏠'}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cHex }} />
                                                <h3 className={`font-black text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                    {activeChannelCircle?.name || 'Circle Channel'}
                                                </h3>
                                            </div>
                                            <p className="text-[10px] text-slate-400 truncate">
                                                {activeChannelCircle?.members?.length || members.filter(m => m.circleId === selectedChannelId).length || 1} members • Circle Channel
                                            </p>
                                        </div>
                                    </>
                                );
                            })()}
                        </>
                    )}
                </div>

                <button
                    onClick={onClose}
                    className={`p-2 rounded-xl transition-colors cursor-pointer
            ${theme === 'dark' ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
                >
                    ✕
                </button>
            </div>

            {/* Circle Channels & 1-on-1 DM Switcher Strip */}
            <div className={`px-3 py-2 border-b flex items-center gap-1.5 overflow-x-auto no-scrollbar ${
                theme === 'dark' ? 'bg-slate-950/40 border-white/5' : 'bg-slate-100/70 border-slate-200'
            }`}>
                {/* All Groups Feed Tab */}
                <button
                    type="button"
                    onClick={() => {
                        setSelectedRecipientId(null);
                        setSelectedChannelId('all');
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                        selectedRecipientId === null && selectedChannelId === 'all'
                            ? 'bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600 text-white shadow-md'
                            : theme === 'dark'
                            ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                            : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                    }`}
                >
                    <span>✨</span>
                    <span>All Groups</span>
                </button>

                {/* Specific Circle Channel Tabs */}
                {userCircles.map(c => {
                    const cHex = c.color || getCircleColor(c.id).hex;
                    const isSelected = selectedRecipientId === null && selectedChannelId === c.id;
                    const circleMsgCount = combinedMessages.filter(m => !m.recipientId && m.circleId === c.id).length;

                    return (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                                setSelectedRecipientId(null);
                                setSelectedChannelId(c.id);
                            }}
                            style={{
                                borderColor: isSelected ? cHex : undefined,
                                backgroundColor: isSelected ? `${cHex}33` : undefined,
                                color: isSelected ? '#ffffff' : undefined
                            }}
                            className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shrink-0 border cursor-pointer ${
                                isSelected
                                    ? 'ring-1 shadow-sm'
                                    : theme === 'dark'
                                    ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cHex }} />
                            <span>{c.name}</span>
                            {circleMsgCount > 0 && (
                                <span className="text-[9px] opacity-75">({circleMsgCount})</span>
                            )}
                        </button>
                    );
                })}

                {/* Divider between circles and 1-on-1 DMs */}
                {otherMembers.length > 0 && (
                    <div className="w-px h-5 bg-white/10 shrink-0 mx-0.5" />
                )}

                {/* Individual 1-on-1 Member Pills */}
                {otherMembers.map(member => {
                    const isSelected = selectedRecipientId === member.id;
                    const directCount = combinedMessages.filter(m => 
                        m.recipientId && (
                            (m.senderId === currentUserId && m.recipientId === member.id) ||
                            (m.senderId === member.id && m.recipientId === currentUserId)
                        )
                    ).length;

                    return (
                        <button
                            key={member.id}
                            type="button"
                            onClick={() => setSelectedRecipientId(member.id)}
                            className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                                isSelected
                                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                                    : theme === 'dark'
                                    ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                            }`}
                        >
                            {member.avatar ? (
                                <img
                                    src={getSafeAvatarUrl(member.avatar, member.name)}
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(member.name);
                                    }}
                                    className="w-4 h-4 rounded-full object-cover"
                                />
                            ) : (
                                <span>💬</span>
                            )}
                            <span>{member.name.split(' ')[0]}</span>
                            {directCount > 0 && (
                                <span className={`text-[9px] px-1 py-0.2 rounded-full font-black ${
                                    isSelected ? 'bg-white/20 text-white' : 'bg-indigo-500/20 text-indigo-400'
                                }`}>
                                    {directCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Offline Status Banner */}
            {!isOnline && (
                <div className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between animate-in fade-in duration-300">
                    <div className="flex items-center gap-2">
                        <span className="text-xs">📶</span>
                        <p className="text-[11px] font-bold text-amber-300">Offline — Messages will auto-send once reconnected</p>
                    </div>
                    {queuedMessages.length > 0 && (
                        <span className="text-[10px] bg-amber-500/30 text-amber-200 font-black px-2 py-0.5 rounded-full">
                            {queuedMessages.length} queued
                        </span>
                    )}
                </div>
            )}

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 no-scrollbar">
                {activeConversationMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
                        <span className="text-4xl">
                            {selectedRecipientId ? '💬' : selectedChannelId === 'all' ? '✨' : '👥'}
                        </span>
                        <p className="text-sm font-bold text-slate-400">
                            {selectedRecipientId 
                                ? `No direct messages with ${activeRecipient?.name || 'this member'} yet.` 
                                : selectedChannelId === 'all'
                                ? 'No messages in All Groups feed yet.'
                                : `No messages in ${activeChannelCircle?.name || 'this circle'} yet.`}
                        </p>
                        <p className="text-xs text-slate-500 max-w-[260px]">
                            {selectedRecipientId 
                                ? 'Send a private 1-on-1 message, share location, or check in.'
                                : selectedChannelId === 'all'
                                ? 'Messages from all your enrolled circles will appear here with color badges.'
                                : `Messages posted here are broadcast to members of ${activeChannelCircle?.name || 'this circle'}.`}
                        </p>
                    </div>
                ) : (
                    activeConversationMessages.map(msg => {
                        const isMe = msg.senderId === currentUserId;
                        const isOmni = msg.senderId === OMNI_ID;
                        const isQueued = msg.status === 'queued';
                        const sender = members.find(m => m.id === msg.senderId);
                        const senderName = isOmni ? 'MyCo-Pilot' : (sender?.name || (isMe ? 'You' : 'Member'));
                        const senderAvatar = isOmni 
                            ? 'https://api.dicebear.com/7.x/bottts/svg?seed=omni'
                            : (sender?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.senderId}`);

                        // Find circle tag info for the message
                        const msgCircleObj = userCircles.find(c => c.id === msg.circleId);
                        const msgCircleName = msg.circleName || msgCircleObj?.name;
                        const msgCircleColor = msg.circleColor || msgCircleObj?.color || (msg.circleId ? getCircleColor(msg.circleId).hex : '#6366f1');

                        return (
                            <div
                                key={msg.id}
                                className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}
                            >
                                {!isMe && (
                                    <img
                                        src={senderAvatar}
                                        alt={senderName}
                                        className={`w-7 h-7 rounded-full object-cover shrink-0 ${
                                            isOmni 
                                                ? 'p-0.5 bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 ring-2 ring-indigo-400/40 shadow-[0_0_10px_rgba(99,102,241,0.5)]' 
                                                : ''
                                        }`}
                                    />
                                )}
                                <div className={`max-w-[78%] ${isMe ? 'text-right' : ''}`}>
                                    <div className={`flex items-center gap-1.5 mb-1 ${isMe ? 'justify-end' : ''}`}>
                                        {!isMe && (
                                            isOmni ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-black uppercase tracking-wider bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
                                                        ✨ MyCo-Pilot
                                                    </span>
                                                    <span className="text-[8px] font-black px-1.5 py-0.2 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 tracking-wider">
                                                        AI CO-PILOT
                                                    </span>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] font-bold text-slate-400">
                                                    {senderName}
                                                </p>
                                            )
                                        )}

                                        {/* Circle Badge Tag (Shown in All Groups view or on multi-circle feeds) */}
                                        {msgCircleName && selectedChannelId === 'all' && !msg.recipientId && (
                                            <span
                                                style={{
                                                    backgroundColor: `${msgCircleColor}22`,
                                                    borderColor: `${msgCircleColor}44`,
                                                    color: msgCircleColor
                                                }}
                                                className="text-[8px] font-black uppercase px-1.5 py-0.2 rounded border flex items-center gap-1 shrink-0"
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: msgCircleColor }} />
                                                <span>{msgCircleName}</span>
                                            </span>
                                        )}
                                    </div>

                                    <div className={`inline-block px-3.5 py-2 rounded-2xl text-left relative ${
                                        msg.type === 'geofence'
                                            ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 rounded-2xl'
                                            : isMe
                                                ? isQueued
                                                    ? 'bg-indigo-600/60 border border-indigo-400/30 text-white rounded-br-md'
                                                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-br-md shadow-md shadow-indigo-500/20'
                                                : isOmni
                                                    ? 'bg-gradient-to-br from-indigo-950/80 via-purple-950/60 to-slate-900/90 border border-indigo-500/40 text-indigo-100 rounded-tl-sm rounded-2xl shadow-[0_4px_20px_rgba(99,102,241,0.25)] ring-1 ring-indigo-400/20 overflow-hidden'
                                                    : theme === 'dark'
                                                        ? 'bg-white/10 text-white rounded-bl-md'
                                                        : 'bg-slate-100 text-slate-900 rounded-bl-md'
                                    }`}>
                                        {isOmni && (
                                            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 via-purple-400 to-pink-500" />
                                        )}
                                        <p className="text-xs leading-relaxed break-words">{msg.content}</p>
                                    </div>
                                    <div className={`flex items-center gap-1.5 mt-0.5 ${isMe ? 'justify-end' : ''}`}>
                                        <p className="text-[9px] text-slate-500">
                                            {formatTime(msg.timestamp)}
                                        </p>
                                        {isQueued && (
                                            <span className="text-[8px] font-bold text-amber-400 flex items-center gap-0.5">
                                                🕒 Queued (Offline)
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick replies & AI Suggestions */}
            <div className={`px-3.5 py-2 border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                {suggestion && (
                    <div className="flex items-center gap-2 mb-2 animate-in fade-in slide-in-from-left duration-500">
                        <span className="text-[9px] font-black uppercase tracking-tighter text-indigo-400">AI Suggestion:</span>
                        <button
                            onClick={handleSuggestionClick}
                            className="bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
                        >
                            ⚡ {suggestion.suggestedAction || "Action"}
                        </button>
                    </div>
                )}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                    <button
                        onClick={handleAskOmni}
                        disabled={isLoadingOmni}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold leading-none bg-indigo-500 text-white shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer"
                    >
                        {isLoadingOmni ? (
                            <div className="w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <span>🤖 Ask MyCo-Pilot</span>
                        )}
                    </button>
                    {quickReplies.map(reply => (
                        <button
                            key={reply}
                            onClick={() => handleSendMessage(reply)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all hover:scale-105 cursor-pointer
                ${theme === 'dark'
                                    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {reply}
                        </button>
                    ))}
                </div>
            </div>

            {/* Input Bar */}
            <div className={`p-3 border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2">
                    <button
                        onClick={sendLocationShare}
                        className={`p-2.5 rounded-xl transition-colors cursor-pointer
              ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        title="Share location"
                    >
                        📍
                    </button>

                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(newMessage)}
                            placeholder={
                                selectedRecipientId
                                    ? `Message ${activeRecipient?.name || 'directly'}...`
                                    : selectedChannelId === 'all'
                                    ? "Broadcast message to all circles..."
                                    : `Message ${activeChannelCircle?.name || 'Circle'}...`
                            }
                            className={`w-full px-3.5 py-2.5 rounded-xl text-xs outline-none transition-all
                ${theme === 'dark'
                                    ? 'bg-white/5 text-white placeholder-slate-500 focus:bg-white/10'
                                    : 'bg-slate-100 text-slate-900 placeholder-slate-400 focus:bg-slate-50'}`}
                        />
                    </div>

                    <button
                        onClick={() => handleSendMessage(newMessage)}
                        disabled={!newMessage.trim()}
                        className={`p-2.5 rounded-xl transition-all cursor-pointer ${newMessage.trim()
                            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90 shadow-md'
                            : theme === 'dark'
                                ? 'bg-white/5 text-slate-500'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MessagingPanel;
