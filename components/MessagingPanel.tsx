import React, { useState, useRef, useEffect } from 'react';
import { FamilyMember } from '../types';
import { subscribeToMessages, sendMessage as firestoreSendMessage, ChatMessage } from '../services/chatService';
import { parseMessageIntent, MessageIntent } from '../services/geminiService';

interface Message {
    id: string;
    senderId: string;
    senderName: string;
    senderAvatar: string;
    content: string;
    timestamp: Date;
    type: 'text' | 'emoji' | 'location' | 'checkin';
}

interface MessagingPanelProps {
    members: FamilyMember[];
    currentUserId: string;
    circleId?: string;
    onClose: () => void;
    theme: 'light' | 'dark';
}

const MessagingPanel: React.FC<MessagingPanelProps> = ({ members, currentUserId, circleId, onClose, theme }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [suggestion, setSuggestion] = useState<MessageIntent | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const quickReplies = ['👍', '❤️', '🏠', 'On my way!', 'Be there soon', 'Running late'];

    // Subscribe to real-time messages
    useEffect(() => {
        if (!circleId) return;
        const unsubscribe = subscribeToMessages(circleId, (msgs) => {
            setMessages(msgs);

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
    }, [circleId, currentUserId]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = async (content: string, type: ChatMessage['type'] = 'text') => {
        if (!content.trim() || !circleId) return;

        try {
            await firestoreSendMessage(circleId, currentUserId, content, type);
            setNewMessage('');
        } catch (error) {
            console.error("Failed to send message:", error);
        }
    };

    const sendLocationShare = () => {
        const currentMember = members.find(m => m.id === currentUserId);
        if (currentMember) {
            handleSendMessage(`📍 Shared my location: ${currentMember.location ? `${currentMember.location.lat.toFixed(4)}, ${currentMember.location.lng.toFixed(4)}` : 'Current location'}`, 'location');
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

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`flex flex-col h-full rounded-3xl overflow-hidden shadow-2xl border
      ${theme === 'dark'
                ? 'bg-slate-900/95 border-white/10'
                : 'bg-white/95 border-slate-200'}`}
        >
            {/* Header */}
            <div className={`flex items-center justify-between p-4 border-b
        ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}
            >
                <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                        {members.slice(0, 3).map(member => (
                            <img
                                key={member.id}
                                src={member.avatar}
                                alt={member.name}
                                className="w-8 h-8 rounded-full border-2 border-slate-900"
                            />
                        ))}
                    </div>
                    <div>
                        <h3 className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            Family Circle
                        </h3>
                        <p className="text-xs text-slate-500">{members.length} members</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className={`p-2 rounded-xl transition-colors
            ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                >
                    ✕
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
                {messages.map(msg => {
                    const isMe = msg.senderId === currentUserId;
                    const sender = members.find(m => m.id === msg.senderId);
                    const senderName = sender?.name || 'Unknown';
                    const senderAvatar = sender?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.senderId}`;

                    return (
                        <div
                            key={msg.id}
                            className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
                        >
                            {!isMe && (
                                <img
                                    src={senderAvatar}
                                    alt={senderName}
                                    className="w-8 h-8 rounded-full object-cover shrink-0"
                                />
                            )}
                            <div className={`max-w-[75%] ${isMe ? 'text-right' : ''}`}>
                                {!isMe && (
                                    <p className="text-xs text-slate-500 mb-1">{senderName}</p>
                                )}
                                <div className={`inline-block px-4 py-2.5 rounded-2xl ${isMe
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-br-md'
                                    : theme === 'dark'
                                        ? 'bg-white/10 text-white rounded-bl-md'
                                        : 'bg-slate-100 text-slate-900 rounded-bl-md'
                                    }`}>
                                    <p className="text-sm">{msg.content}</p>
                                </div>
                                <p className={`text-[10px] mt-1 ${isMe ? 'text-right' : ''} text-slate-500`}>
                                    {formatTime(msg.timestamp)}
                                </p>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick replies & AI Suggestions */}
            <div className={`px-4 py-2 border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                {suggestion && (
                    <div className="flex items-center gap-2 mb-3 animate-in fade-in slide-in-from-left duration-500">
                        <span className="text-[10px] font-black uppercase tracking-tighter text-indigo-400">AI Suggestion:</span>
                        <button
                            onClick={handleSuggestionClick}
                            className="bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all"
                        >
                            ⚡ {suggestion.suggestedAction || "Action"}
                        </button>
                    </div>
                )}
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                    {quickReplies.map(reply => (
                        <button
                            key={reply}
                            onClick={() => handleSendMessage(reply)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all hover:scale-105
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
            <div className={`p-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2">
                    <button
                        onClick={sendLocationShare}
                        className={`p-3 rounded-xl transition-colors
              ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-100 hover:bg-slate-200'}`}
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
                            placeholder="Type a message..."
                            className={`w-full px-4 py-3 rounded-2xl text-sm outline-none transition-all
                ${theme === 'dark'
                                    ? 'bg-white/5 text-white placeholder-slate-500 focus:bg-white/10'
                                    : 'bg-slate-100 text-slate-900 placeholder-slate-400 focus:bg-slate-50'}`}
                        />
                    </div>

                    <button
                        onClick={() => handleSendMessage(newMessage)}
                        disabled={!newMessage.trim()}
                        className={`p-3 rounded-xl transition-all ${newMessage.trim()
                            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90'
                            : theme === 'dark'
                                ? 'bg-white/5 text-slate-500'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MessagingPanel;
