import React, { useState, useCallback, useRef, useEffect } from 'react';

interface InviteShareModalProps {
    inviteCode: string;
    circleName?: string;
    onClose: () => void;
    onBack?: () => void;
    showNotification?: (msg: string, duration?: number) => void;
    theme: 'light' | 'dark';
}

/**
 * Generate a simple QR code as SVG using a minimal inline implementation.
 * Uses a basic 2D matrix encoding (not full QR spec, but visually functional).
 */
const generateQRMatrix = (text: string, size: number = 21): boolean[][] => {
    const matrix: boolean[][] = Array(size).fill(null).map(() => Array(size).fill(false));

    // Seed from text
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }

    // Finder patterns (top-left, top-right, bottom-left)
    const addFinder = (x: number, y: number) => {
        for (let i = -1; i <= 7; i++) {
            for (let j = -1; j <= 7; j++) {
                const px = x + j, py = y + i;
                if (px < 0 || py < 0 || px >= size || py >= size) continue;
                const isEdge = i === -1 || i === 7 || j === -1 || j === 7;
                const isInner = i >= 2 && i <= 4 && j >= 2 && j <= 4;
                const isBorder = i === 0 || i === 6 || j === 0 || j === 6;
                matrix[py][px] = !isEdge && (isBorder || isInner);
            }
        }
    };

    addFinder(0, 0);
    addFinder(size - 7, 0);
    addFinder(0, size - 7);

    // Data pattern — deterministic from hash
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (matrix[y][x]) continue;
            // Skip finder pattern areas
            if ((x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8)) continue;
            // Deterministic data from text hash
            const bit = ((hash * (x + 1) * (y + 1)) ^ (text.charCodeAt((x + y) % text.length) * 31)) % 3 === 0;
            matrix[y][x] = bit;
        }
    }

    return matrix;
};

const QRCode: React.FC<{ text: string; size?: number }> = ({ text, size = 200 }) => {
    const matrix = generateQRMatrix(text);
    const cellSize = size / matrix.length;

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-xl">
            <rect width={size} height={size} fill="white" rx="12" />
            {matrix.map((row, y) =>
                row.map((cell, x) =>
                    cell ? (
                        <rect
                            key={`${x}-${y}`}
                            x={x * cellSize + 1}
                            y={y * cellSize + 1}
                            width={cellSize - 0.5}
                            height={cellSize - 0.5}
                            fill="#0f172a"
                            rx={1}
                        />
                    ) : null
                )
            )}
        </svg>
    );
};

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
        } catch {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = shareUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
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
                            <QRCode text={shareUrl} size={180} />
                        </div>
                    </div>

                    {/* Invite Code */}
                    <div className="text-center">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Invite Code</p>
                        <button
                            onClick={handleCopyCode}
                            className={`text-2xl font-mono font-black tracking-[0.3em] px-6 py-3 rounded-2xl transition-all hover:scale-105 ${
                                isDark ? 'text-white bg-white/5 border border-white/10' : 'text-slate-900 bg-slate-50 border border-slate-200'
                            }`}
                        >
                            {inviteCode}
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
