import React, { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatSegmentedInviteCode } from '../utils/inviteCode';

interface InviteShareModalProps {
    inviteCode: string;
    circleName?: string;
    onClose: () => void;
    onBack?: () => void;
    showNotification?: (msg: string, duration?: number) => void;
    theme: 'light' | 'dark';
}

const InviteShareModal: React.FC<InviteShareModalProps> = ({
    inviteCode,
    circleName = 'My Family',
    onClose,
    onBack,
    showNotification,
    theme
}) => {
    const isDark = theme === 'dark';
    const shareUrl = `https://myway-gps.com/join/${inviteCode}`;
    const [copied, setCopied] = useState(false);

    const handleCopyLink = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            showNotification?.('📋 Invite link copied!', 2000);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.warn('[InviteShareModal] Clipboard write failed:', err);
        }
    }, [shareUrl, showNotification]);

    const handleCopyCode = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(inviteCode);
            showNotification?.(`📋 Code copied: ${inviteCode}`, 2000);
        } catch { /* noop */ }
    }, [inviteCode, showNotification]);

    const handleShare = useCallback(async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Join ${circleName} on MyWay GPS`,
                    text: `Join my family circle on MyWay! Use code: ${inviteCode}`,
                    url: shareUrl
                });
            } catch { /* user cancelled */ }
        } else {
            handleCopyLink();
        }
    }, [circleName, inviteCode, shareUrl, handleCopyLink]);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className={`relative max-w-sm w-full mx-4 rounded-3xl overflow-hidden border shadow-2xl ${
                    isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'
                }`}
                onClick={e => e.stopPropagation()}
            >
                {/* Header gradient */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-center relative">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all shadow-sm"
                            title="Back to Settings"
                        >
                            <span className="text-lg">←</span>
                        </button>
                    )}
                    <h2 className="text-xl font-black text-white">My Invites — {circleName}</h2>
                    <p className="text-indigo-200 text-sm mt-1">Share this code to add family members</p>
                </div>

                <div className="p-6 space-y-5">
                    {/* QR Code */}
                    <div className="flex justify-center">
                        <div className="p-3 bg-white rounded-2xl shadow-lg">
                            <QRCodeSVG value={shareUrl} size={180} level="H" includeMargin={false} />
                        </div>
                    </div>

                    {/* Invite Code */}
                    <div className="text-center">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Invite Code</p>
                        <button
                            onClick={handleCopyCode}
                            className={`text-2xl font-mono font-black tracking-[0.2em] px-6 py-3 rounded-2xl transition-all hover:scale-105 ${
                                isDark ? 'text-white bg-white/5 border border-white/10' : 'text-slate-900 bg-slate-50 border border-slate-200'
                            }`}
                        >
                            {formatSegmentedInviteCode(inviteCode)}
                        </button>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleCopyLink}
                            className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${
                                copied
                                    ? 'bg-emerald-500 text-white'
                                    : isDark
                                        ? 'bg-white/10 text-white hover:bg-white/20'
                                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
                            {copied ? '✓ Copied!' : '🔗 Copy Link'}
                        </button>
                        <button
                            onClick={handleShare}
                            className="flex-1 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:opacity-90 transition-all"
                        >
                            📤 Share
                        </button>
                    </div>
                </div>

                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all"
                >
                    ✕
                </button>
            </div>
        </div>
    );
};

export default InviteShareModal;
