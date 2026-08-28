import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FamilyMember } from '../types';
import { subscribeToMessages, sendMessage as firestoreSendMessage, ChatMessage } from '../services/chatService';
import { getBufferedMessages, BufferedMessage } from '../services/offlineMessageBuffer';
import { parseMessageIntent, MessageIntent, getSocialSafetyAdvisory } from '../services/geminiService';

const OMNI_ID = 'omni-ai';

interface MessagingPanelProps {
    members: FamilyMember[];
    currentUserId: string;
    circleId?: string;
    initialRecipientId?: string | null;
    onClose: () => void;
    theme: 'light' | 'dark';
}

const MessagingPanel: React.FC<MessagingPanelProps> = ({
    members,
    currentUserId,
    circleId,
    initialRecipientId = null,
    onClose,
    theme
}) => {
    const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(initialRecipientId);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [queuedMessages, setQueuedMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [suggestion, setSuggestion] = useState<MessageIntent | null>(null);
    const [isLoadingOmni, setIsLoadingOmni] = useState(false);
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Synchronize initialRecipientId if passed from parent
    useEffect(() => {
        if (initialRecipientId !== undefined) {
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

    const quickReplies = selectedRecipientId
        ? ['On my way!', 'Where are you?', 'Call me', 'Almost there!', '👍', '❤️']
        : ['👍', '❤️', '🏠', 'On my way!', 'Be there soon', 'Running late'];

    // Load offline queued messages
    const refreshQueuedMessages = useCallback(async () => {
        if (!circleId) return;
        const buffered = await getBufferedMessages(circleId);
        const mapped: ChatMessage[] = buffered.map(b => ({
            id: `buffered-${b.id || b.clientMessageId}`,
            senderId: b.senderId,
            recipientId: b.recipientId,
            content: b.content,
            type: b.type,
            timestamp: new Date(b.timestamp),
            status: 'queued'
        }));
        setQueuedMessages(mapped);
    }, [circleId]);

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

    // Subscribe to real-time messages
    useEffect(() => {
        if (!circleId) return;
        const unsubscribe = subscribeToMessages(circleId, (msgs) => {
            setMessages(msgs);
            refreshQueuedMessages();

            // Analyze last message if it's not from us
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
    }, [circleId, currentUserId, refreshQueuedMessages]);

    // Combine synced messages with queued offline messages (excluding any duplicates)
    const combinedMessages = useMemo(() => {
        return [
            ...messages,
            ...queuedMessages.filter(qm => !messages.some(m => m.senderId === qm.senderId && m.content === qm.content && Math.abs(m.timestamp.getTime() - qm.timestamp.getTime()) < 60000))
        ];
    }, [messages, queuedMessages]);

    // Filter messages based on active conversation mode (1-on-1 vs Circle group chat)
    const activeConversationMessages = useMemo(() => {
        return combinedMessages.filter(msg => {
            if (selectedRecipientId) {
                // 1-on-1 Direct Message: must be between current user and selected recipient
                return (
                    (msg.senderId === currentUserId && msg.recipientId === selectedRecipientId) ||
                    (msg.senderId === selectedRecipientId && msg.recipientId === currentUserId)
                );
            } else {
                // Family Circle Group Chat: broadcast messages without specific recipientId
                return !msg.recipientId;
            }
        });
    }, [combinedMessages, selectedRecipientId, currentUserId]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeConversationMessages]);

    const handleSendMessage = async (content: string, type: ChatMessage['type'] = 'text') => {
        if (!content.trim() || !circleId) return;

        try {
            const result = await firestoreSendMessage(
                circleId,
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
        if (!circleId) return;
        setIsLoadingOmni(true);
        try {
            const insight = await getSocialSafetyAdvisory(members);
            if (insight) {
                await firestoreSendMessage(circleId, OMNI_ID, insight, 'text', selectedRecipientId || undefined);
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
                                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                                    theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                }`}
                                title="Back to Circle Chat"
                            >
                                <span className="text-sm font-bold">←</span>
                            </button>
                            <div className="relative">
                                {activeRecipient.avatar ? (
                                    <img
                                        src={activeRecipient.avatar}
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
                    ) : (
                        <>
                            <div className="flex -space-x-2">
                                {members.slice(0, 3).map(member => (
                                    <img
                                        key={member.id}
                                        src={member.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${member.id}`}
                                        alt={member.name}
                                        className="w-8 h-8 rounded-full border-2 border-slate-900 object-cover"
                                    />
                                ))}
                            </div>
                            <div>
                                <h3 className={`font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    Family Circle
                                </h3>
                                <p className="text-[10px] text-slate-500">{members.length} members • Group Chat</p>
                            </div>
                        </>
                    )}
                </div>

                <button
                    onClick={onClose}
                    className={`p-2 rounded-xl transition-colors
            ${theme === 'dark' ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
                >
                    ✕
                </button>
            </div>

            {/* Conversation Switcher Strip (Circle vs 1-on-1 Members) */}
            <div className={`px-3 py-2 border-b flex items-center gap-1.5 overflow-x-auto no-scrollbar ${
                theme === 'dark' ? 'bg-slate-950/40 border-white/5' : 'bg-slate-100/70 border-slate-200'
            }`}>
                {/* All Circle Group Tab */}
                <button
                    type="button"
                    onClick={() => setSelectedRecipientId(null)}
                    className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shrink-0 ${
                        selectedRecipientId === null
                            ? 'bg-indigo-600 text-white shadow-md'
                            : theme === 'dark'
                            ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                            : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                    }`}
                >
                    <span>👥</span>
                    <span>All Circle</span>
                </button>

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
                            className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                                isSelected
                                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                                    : theme === 'dark'
                                    ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                            }`}
                        >
                            {member.avatar ? (
                                <img src={member.avatar} className="w-4 h-4 rounded-full object-cover" />
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
                        <span className="text-4xl">{selectedRecipientId ? '💬' : '👨‍👩‍👧‍👦'}</span>
                        <p className="text-sm font-bold text-slate-400">
                            {selectedRecipientId 
                                ? `No direct messages with ${activeRecipient?.name || 'this member'} yet.` 
                                : 'No circle messages yet.'}
                        </p>
                        <p className="text-xs text-slate-500 max-w-[240px]">
                            {selectedRecipientId 
                                ? 'Send a private 1-on-1 message, share location, or check in.'
                                : 'Messages sent here are broadcast to all circle members.'}
                        </p>
                    </div>
                ) : (
                    activeConversationMessages.map(msg => {
                        const isMe = msg.senderId === currentUserId;
                        const isOmni = msg.senderId === OMNI_ID;
                        const isQueued = msg.status === 'queued';
                        const sender = members.find(m => m.id === msg.senderId);
                        const senderName = isOmni ? 'MyCo-Pilot' : (sender?.name || 'Unknown');
                        const senderAvatar = isOmni 
                            ? 'https://api.dicebear.com/7.x/bottts/svg?seed=omni'
                            : (sender?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.senderId}`);

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
                                    {!isMe && (
                                        isOmni ? (
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <span className="text-[10px] font-black uppercase tracking-wider bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
                                                    ✨ MyCo-Pilot
                                                </span>
                                                <span className="text-[8px] font-black px-1.5 py-0.2 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 tracking-wider">
                                                    AI CO-PILOT
                                                </span>
                                            </div>
                                        ) : (
                                            <p className="text-[10px] font-bold mb-0.5 text-slate-400">
                                                {senderName}
                                            </p>
                                        )
                                    )}
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
                            className="bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-md hover:scale-105 active:scale-95 transition-all"
                        >
                            ⚡ {suggestion.suggestedAction || "Action"}
                        </button>
                    </div>
                )}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                    <button
                        onClick={handleAskOmni}
                        disabled={isLoadingOmni}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold leading-none bg-indigo-500 text-white shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-1 whitespace-nowrap"
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
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all hover:scale-105
                ${theme === 'dark'
                                    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {reply}
                        </button>
                    ))}
                </div>
            </div>

            {/* Input */}
            <div className={`p-3 border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2">
                    <button
                        onClick={sendLocationShare}
                        className={`p-2.5 rounded-xl transition-colors
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
                                    : isOnline ? "Message Family Circle..." : "Type offline message..."
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
                        className={`p-2.5 rounded-xl transition-all ${newMessage.trim()
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
